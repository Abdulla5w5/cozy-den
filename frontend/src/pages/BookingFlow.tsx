import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { Booking, TableAvailability } from '../types';

// POST /bookings returns one of two shapes: the finished booking (direct/mock
// provider) or a gateway redirect URL (Tap). One handler covers both.
type CheckoutResponse = { booking?: Booking; redirectUrl?: string };

type Step = 1 | 2;

type FloorShape = 'small' | 'round' | 'wide' | 'communal' | 'floor';

interface FloorPlacement {
  x: number;
  y: number;
  shape: FloorShape;
  angle?: number;
}

// These coordinates describe the physical cafe sketch, not booking data. The
// API remains the source of truth for which tables exist and which slots are
// free; an unknown future table still receives a sensible fallback position.
const FLOOR_PLACEMENTS: Record<string, FloorPlacement> = {
  'Small Table 1': { x: 18, y: 24, shape: 'small', angle: -4 },
  'Small Table 2': { x: 43, y: 19, shape: 'small', angle: 3 },
  'Small Table 3': { x: 78, y: 23, shape: 'small', angle: -2 },
  'Big Table 1': { x: 24, y: 61, shape: 'wide', angle: 2 },
  'Big Table 2': { x: 49, y: 43, shape: 'round', angle: -2 },
  'Big Table 3': { x: 72, y: 67, shape: 'wide', angle: -2 },
  'Big Table 4 (D&D)': { x: 45, y: 76, shape: 'communal', angle: 1 },
  'Floor Table': { x: 83, y: 46, shape: 'floor', angle: 3 },
};

const FALLBACK_PLACEMENTS: FloorPlacement[] = [
  { x: 16, y: 20, shape: 'small' },
  { x: 40, y: 20, shape: 'small' },
  { x: 68, y: 20, shape: 'small' },
  { x: 20, y: 58, shape: 'wide' },
  { x: 50, y: 47, shape: 'round' },
  { x: 75, y: 62, shape: 'wide' },
  { x: 45, y: 78, shape: 'communal' },
  { x: 84, y: 42, shape: 'floor' },
];

function floorPlacement(label: string, index: number) {
  return FLOOR_PLACEMENTS[label] ?? FALLBACK_PLACEMENTS[index % FALLBACK_PLACEMENTS.length];
}

function mapTableName(label: string) {
  if (label.includes('(D&D)')) return 'D&D';
  return label
    .replace('Small Table ', 'S')
    .replace('Big Table ', 'B')
    .replace('Floor Table', 'Floor');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Booking is table-only: select table & start time -> guest info + payment.
// Booking selection persisted across the payment redirect, so a failed/abandoned
// payment returns the customer to a ready-to-retry checkout instead of a blank
// form. sessionStorage can throw (private mode / sandbox) — never let it break
// the flow.
const DRAFT_KEY = 'cd_booking_draft';
interface BookingDraft {
  tableId: number;
  date: string;
  timeSlot: string;
  guestName: string;
  guestEmail: string;
}
function saveDraft(d: BookingDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}
function readDraftOnReturn(): BookingDraft | null {
  try {
    // Only restore when we've actually come back from the gateway.
    if (!new URLSearchParams(window.location.search).get('payment')) return null;
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as BookingDraft) : null;
  } catch {
    return null;
  }
}

// Sessions are a fixed 2 hours with rolling 30-minute start times.
export function BookingFlow() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, money } = useI18n();
  const bookingCardRef = useRef<HTMLDivElement | null>(null);
  const hasRenderedStepRef = useRef(false);

  // Captured once, synchronously on first render, so the availability effect
  // below can re-apply the saved table/time after it reloads.
  const [draft] = useState<BookingDraft | null>(readDraftOnReturn);
  const restoreRef = useRef<BookingDraft | null>(draft);

  const [step, setStep] = useState<Step>(draft ? 2 : 1);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(draft?.date ?? todayIso());
  const [availability, setAvailability] = useState<TableAvailability[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [slots, setSlots] = useState<string[]>([]);
  const [tableId, setTableId] = useState<number | null>(null);
  const [timeSlot, setTimeSlot] = useState<string | null>(null);

  const [guestName, setGuestName] = useState(draft?.guestName ?? '');
  const [guestEmail, setGuestEmail] = useState(draft?.guestEmail ?? '');
  const [submitting, setSubmitting] = useState(false);

  // Priced by date on the server (Thu/Fri/Sat and Kuwait national holidays cost
  // more). Display only — checkout re-derives it, so this can never set a price.
  const [fee, setFee] = useState<{ cents: number; peak: boolean; reason: string | null }>({
    cents: 275,
    peak: false,
    reason: null,
  });

  useEffect(() => {
    setError(null);
    setLoadingAvailability(true);
    // Clear a prior selection only on a genuine user date change — not while
    // restoring a draft for this same date after a returned payment.
    if (restoreRef.current?.date !== date) {
      setTableId(null);
      setTimeSlot(null);
    }
    api
      .get<{
        slots: string[];
        availability: TableAvailability[];
        fee: { cents: number; peak: boolean; reason: string | null };
      }>(`/tables/availability?date=${date}`)
      .then((r) => {
        setSlots(r.slots);
        setAvailability(r.availability);
        // Older API instances did not include fee details in availability.
        // Keep the safe display default until checkout when that field is absent.
        if (r.fee) setFee(r.fee);
        // Re-apply the saved table/time once the grid for its date has loaded.
        if (restoreRef.current && restoreRef.current.date === date) {
          setTableId(restoreRef.current.tableId);
          setTimeSlot(restoreRef.current.timeSlot);
          restoreRef.current = null;
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingAvailability(false));
  }, [date]);

  useEffect(() => {
    // Prefill from the signed-in account so bookings link to their history.
    api
      .get<{ user: { name: string; email: string } }>('/auth/me')
      .then((r) => {
        setGuestName(r.user.name);
        setGuestEmail(r.user.email);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // The map can be much taller than checkout. Keep a step change from leaving
    // the customer stranded at the old scroll offset below the shorter panel.
    if (!hasRenderedStepRef.current) {
      hasRenderedStepRef.current = true;
      return;
    }
    bookingCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  const selectedTable = availability.find((tb) => tb.tableId === tableId) || null;

  // Surface a failed/cancelled return from the payment gateway. (The step is
  // already set to 2 on first render when a draft was restored.)
  const payStatus = searchParams.get('payment');
  const payError =
    payStatus === 'failed'
      ? t('bk.payFailed')
      : payStatus === 'error'
        ? t('bk.payError')
        : payStatus === 'review'
          ? t('bk.payReview')
          : payStatus === 'pending'
            ? t('bk.payPending')
            : null;

  async function submit() {
    if (!tableId || !timeSlot) return; // guarded by the button, belt-and-braces
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<CheckoutResponse>('/bookings', {
        tableId,
        date,
        timeSlot,
        guestName,
        guestEmail,
      });
      if (res.redirectUrl) {
        // Redirect gateway (Tap): hand the browser to the hosted payment page.
        // A full navigation, not a route change, so we leave our SPA entirely.
        // Save the selection first so a failed/abandoned payment returns to a
        // ready-to-retry checkout rather than a blank form.
        saveDraft({ tableId, date, timeSlot, guestName, guestEmail });
        window.location.assign(res.redirectUrl);
        return; // keep the spinner up while the browser navigates away
      }
      if (res.booking) {
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
        navigate(`/confirmation/${res.booking.verificationCode}`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('bk.wrong'));
      setSubmitting(false);
    }
  }

  // Clear the ?payment marker once seen, so a refresh doesn't re-show the banner.
  function dismissPayStatus() {
    searchParams.delete('payment');
    setSearchParams(searchParams, { replace: true });
  }

  return (
    <div ref={bookingCardRef} className={`card booking-card ${step === 2 ? 'booking-checkout' : ''}`}>
      <Stepper step={step} />
      {error && <div className="alert error">{error}</div>}

      {step === 1 && (
        <section className="floor-booking-step">
          <header className="booking-intro">
            <div>
              <span className="booking-kicker">{t('bk.mapKicker')}</span>
              <h1>{t('bk.mapTitle')}</h1>
              <p>{t('bk.mapSub')}</p>
            </div>
            <div className="booking-hours" aria-label={t('bk.hours')}>
              <span className="booking-status-dot" aria-hidden="true" />
              <div>
                <strong>{t('bk.hours')}</strong>
                <span>{t('bk.lastSeating')}</span>
              </div>
            </div>
          </header>

          <div className="booking-date-tray">
            <div className="booking-date-copy">
              <span>{t('bk.chooseDate')}</span>
              <strong>{t('bk.chooseDateHint')}</strong>
            </div>
            <label className="booking-date-field">
              <span>{t('bk.date')}</span>
              <input
                type="date"
                min={todayIso()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>

          <div className="floor-booking-layout">
            <div className="cafe-map-shell">
              <div className="map-heading">
                <div>
                  <span className="map-title">{t('bk.floorPlan')}</span>
                  <span className="map-hint">{t('bk.floorHint')}</span>
                </div>
                <span className="map-live-badge">
                  <i aria-hidden="true" /> {t('bk.liveAvailability')}
                </span>
              </div>

              <div className="cafe-floor-plan" aria-label={t('bk.floorPlan')}>
                <div className="floor-window floor-window-one" aria-hidden="true" />
                <div className="floor-window floor-window-two" aria-hidden="true" />
                <div className="floor-counter" aria-hidden="true">
                  <span>{t('bk.counter')}</span>
                  <i>☕</i>
                </div>
                <div className="floor-shelf" aria-hidden="true">
                  <i>♟</i>
                  <span>{t('bk.gameWall')}</span>
                </div>
                <span className="floor-plant plant-one" aria-hidden="true">✦</span>
                <span className="floor-plant plant-two" aria-hidden="true">✦</span>
                <span className="floor-entrance" aria-hidden="true">{t('bk.entrance')}</span>

                {loadingAvailability && (
                  <div className="floor-loading" aria-live="polite">
                    <span className="floor-loading-die" aria-hidden="true">⚄</span>
                    {t('bk.loadingTables')}
                  </div>
                )}

                {!loadingAvailability && availability.map((tb, index) => {
                  const placement = floorPlacement(tb.label, index);
                  const selected = tableId === tb.tableId;
                  const soldOut = tb.freeSlots.length === 0;
                  const style = {
                    '--table-x': `${placement.x}%`,
                    '--table-y': `${placement.y}%`,
                    '--table-angle': `${placement.angle ?? 0}deg`,
                  } as CSSProperties;
                  return (
                    <button
                      key={tb.tableId}
                      type="button"
                      style={style}
                      className={`floor-table floor-table-${placement.shape} ${selected ? 'selected' : ''} ${soldOut ? 'sold-out' : ''}`}
                      aria-pressed={selected}
                      aria-label={t('bk.tableMapLabel', {
                        table: tb.label,
                        seats: tb.capacity,
                        slots: tb.freeSlots.length,
                      })}
                      onClick={() => {
                        if (tableId !== tb.tableId) setTimeSlot(null);
                        setTableId(tb.tableId);
                      }}
                    >
                      <span className="floor-table-surface">
                        <strong>{mapTableName(tb.label)}</strong>
                        <small>{t('bk.seatsShort', { n: tb.capacity })}</small>
                      </span>
                      <span className="floor-table-tooltip" aria-hidden="true">
                        <strong>{tb.label}</strong>
                        <small>
                          {soldOut ? t('bk.noOpenSlots') : t('bk.openSlots', { n: tb.freeSlots.length })}
                        </small>
                        {!soldOut && <em>{tb.freeSlots.slice(0, 3).join(' · ')}</em>}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="floor-legend" aria-label={t('bk.legend')}>
                <span><i className="available" />{t('bk.available')}</span>
                <span><i className="selected" />{t('bk.selected')}</span>
                <span><i className="unavailable" />{t('bk.unavailable')}</span>
              </div>
            </div>

            <aside className={`booking-slot-panel ${selectedTable ? 'has-table' : ''}`} aria-live="polite">
              {selectedTable ? (
                <>
                  <div className="slot-panel-head">
                    <span className="slot-panel-kicker">{t('bk.yourTable')}</span>
                    <h2>{selectedTable.label}</h2>
                    <div className="slot-panel-meta">
                      <span>♟ {t('bk.seats', { n: selectedTable.capacity })}</span>
                      <span className={selectedTable.freeSlots.length ? 'open' : 'closed'}>
                        <i aria-hidden="true" />
                        {selectedTable.freeSlots.length
                          ? t('bk.openSlots', { n: selectedTable.freeSlots.length })
                          : t('bk.noOpenSlots')}
                      </span>
                    </div>
                  </div>

                  <div className="slot-panel-body">
                    <div className="slot-panel-title">
                      <div>
                        <strong>{t('bk.pickTime')}</strong>
                        <span>{t('bk.sessionHint')}</span>
                      </div>
                      {timeSlot && <span className="chosen-time">{timeSlot}</span>}
                    </div>

                    <div className="booking-slots">
                      {slots.map((slot) => {
                        const free = selectedTable.freeSlots.includes(slot);
                        const active = timeSlot === slot;
                        return (
                          <button
                            key={slot}
                            type="button"
                            disabled={!free}
                            className={`booking-slot ${active ? 'active' : ''}`}
                            aria-pressed={active}
                            onClick={() => setTimeSlot(slot)}
                          >
                            <span>{slot}</span>
                            <small>{free ? t('bk.open') : t('bk.taken')}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="slot-panel-action">
                    <div>
                      <span>{t('bk.selection')}</span>
                      <strong>
                        {timeSlot ? `${selectedTable.label} · ${timeSlot}` : t('bk.chooseTime')}
                      </strong>
                    </div>
                    <button
                      className="primary"
                      disabled={!timeSlot}
                      onClick={() => setStep(2)}
                    >
                      {t('bk.nextDetails')} <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="slot-panel-empty">
                  <span className="empty-map-pin" aria-hidden="true">⌖</span>
                  <h2>{t('bk.selectPrompt')}</h2>
                  <p>{t('bk.selectPromptSub')}</p>
                  <div className="empty-tip">
                    <span aria-hidden="true">↗</span>
                    {t('bk.hoverTip')}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2>{t('bk.s2checkout')}</h2>

          <div className="summary">
            <h3>{t('bk.summary')}</h3>
            <p>
              {selectedTable?.label} · {date} · {timeSlot} {t('bk.seating')}
            </p>
            <ul>
              <li>
                {t('bk.tableFee')} — {money(fee.cents)}
                {fee.peak && (
                  <span className="pill">
                    {fee.reason === 'weekend' ? t('bk.peakWeekend') : fee.reason}
                  </span>
                )}
              </li>
            </ul>
            <p className="total">
              {t('bk.total')} {money(fee.cents)}
            </p>
          </div>

          <label className="field">
            {t('bk.name')}
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          </label>
          <label className="field">
            {t('bk.email')}
            <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
          </label>

          {payError && (
            <div className="alert error" onClick={dismissPayStatus}>
              {payError}
            </div>
          )}

          <div className="pay-note">
            <span aria-hidden="true">🔒</span>
            <p className="muted">{t('bk.paySecure')}</p>
          </div>

          <div className="actions">
            <button onClick={() => setStep(1)}>{t('bk.back')}</button>
            <button
              className="primary"
              disabled={submitting || !guestName || !guestEmail || !tableId || !timeSlot}
              onClick={submit}
            >
              {submitting ? t('bk.processing') : t('bk.pay', { amount: money(fee.cents) })}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const { t } = useI18n();
  const labels = ['bk.table', 'bk.checkout'];
  return (
    <ol className="stepper">
      {labels.map((l, i) => (
        <li key={l} className={step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}>
          {i + 1}. {t(l)}
        </li>
      ))}
    </ol>
  );
}
