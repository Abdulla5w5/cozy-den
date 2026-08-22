import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { Booking, TableAvailability } from '../types';

// POST /bookings returns one of two shapes: the finished booking (direct/mock
// provider) or a gateway redirect URL (Tap). One handler covers both.
type CheckoutResponse = { booking?: Booking; redirectUrl?: string };

type Step = 1 | 2;

type FloorShape = 'small' | 'round' | 'wide' | 'communal' | 'floor' | 'hall';

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
  'Small Table 1': { x: 52, y: 39, shape: 'communal', angle: 0 },
  'Small Table 2': { x: 80, y: 50, shape: 'small', angle: 1 },
  'Small Table 3': { x: 65, y: 18, shape: 'small', angle: -1 },
  'Big Table 1': { x: 38, y: 18, shape: 'wide', angle: 0 },
  'Big Table 2': { x: 53, y: 65, shape: 'round', angle: 0 },
  'Big Table 3': { x: 72, y: 82, shape: 'wide', angle: 0 },
  'Big Table 4 (D&D)': { x: 20, y: 80, shape: 'hall', angle: 0 },
  'Floor Table': { x: 85, y: 19, shape: 'floor', angle: 2 },
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

interface ChairPosition {
  x: number;
  y: number;
  angle: number;
}

function chairPositions(shape: FloorShape, count: number): ChairPosition[] {
  // Round, floor and D&D tables read best with seats following their silhouette.
  if (shape === 'round' || shape === 'floor' || shape === 'communal') {
    const start = shape === 'communal' ? -90 : -90;
    return Array.from({ length: count }, (_, index) => {
      const degrees = start + (360 / count) * index;
      const radians = (degrees * Math.PI) / 180;
      const radiusX = shape === 'round' ? 60 : shape === 'communal' ? 59 : 57;
      const radiusY = shape === 'round' ? 60 : shape === 'communal' ? 59 : 61;
      return {
        x: 50 + Math.cos(radians) * radiusX,
        y: 50 + Math.sin(radians) * radiusY,
        angle: degrees + 90,
      };
    });
  }

  // Rectangular tables place extension chairs along their long edges, with the
  // remaining chairs at the ends. This keeps 12-seat tables readable as tables
  // that extend beyond their standard eight-seat setup.
  const sideCount = Math.min(2, count);
  const edgeCount = count - sideCount;
  const topCount = Math.ceil(edgeCount / 2);
  const bottomCount = Math.floor(edgeCount / 2);
  const positions: ChairPosition[] = [];
  const addEdge = (amount: number, y: number, angle: number) => {
    for (let index = 0; index < amount; index += 1) {
      positions.push({ x: ((index + 1) / (amount + 1)) * 100, y, angle });
    }
  };
  addEdge(topCount, -10, 0);
  addEdge(bottomCount, 110, 180);
  if (sideCount >= 1) positions.push({ x: -8, y: 50, angle: 90 });
  if (sideCount >= 2) positions.push({ x: 108, y: 50, angle: -90 });
  return positions;
}

// Café hours, mirrored from the server's utils/slots. These only shape what the
// form offers; the server re-derives length, price and capacity on checkout, so
// nothing here can be leaned on to buy a longer sitting than was paid for.
const SESSION_MIN = 120;
const MAX_SESSION_MIN = 360; // six hours
const CLOSE_MIN = 27 * 60; // 03:00
const OPEN_MIN = 14 * 60;
// Sittings are sold in whole 2-hour blocks: two, four or six hours, and nothing
// in between. A late seating is the exception and runs to closing instead.
const BLOCK_DURATIONS = [SESSION_MIN, SESSION_MIN * 2, SESSION_MIN * 3];

// Mirrors backend/src/utils/pricing.ts: the twelve-seaters are not worth taking
// out of service for a pair, so they take parties of four or more. The server
// enforces it — this only keeps the form from offering an impossible choice.
const LARGE_TABLE_CAPACITY = 12;
const LARGE_TABLE_MIN_SEATS = 4;
const minSeatsFor = (capacity: number) =>
  capacity >= LARGE_TABLE_CAPACITY ? LARGE_TABLE_MIN_SEATS : 1;

function slotToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const mins = h * 60 + m;
  return mins < OPEN_MIN ? mins + 24 * 60 : mins;
}

/** A start too late to fit a full session — it runs to closing instead. */
function isLateStart(start: string) {
  return slotToMinutes(start) > CLOSE_MIN - SESSION_MIN;
}

function minDurationFor(start: string) {
  return isLateStart(start) ? CLOSE_MIN - slotToMinutes(start) : SESSION_MIN;
}

function maxDurationFor(start: string) {
  const toClose = CLOSE_MIN - slotToMinutes(start);
  return isLateStart(start) ? toClose : Math.min(toClose, MAX_SESSION_MIN);
}

/** Clock time a sitting ends, for the "until 18:00" label. */
function endLabel(start: string, durationMin: number) {
  const end = (slotToMinutes(start) + durationMin) % (24 * 60);
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

function formatHours(mins: number) {
  const h = mins / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// The header is sticky and changes height between one and two rows, so any
// scrolling we do has to measure it rather than assume a fixed offset.
function stickyHeaderOffset() {
  const header = document.querySelector<HTMLElement>('.topbar');
  return (header?.getBoundingClientRect().height ?? 0) + 14;
}

// `behavior: 'auto'` is not "jump" — it defers to CSS, and this site sets
// `scroll-behavior: smooth` globally, so 'auto' would still animate. Only
// 'instant' actually overrides it.
function scrollInstantly(top: number) {
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
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
  durationMin: number;
  partySize: number;
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
  const slotPanelRef = useRef<HTMLElement | null>(null);
  const slotListRef = useRef<HTMLDivElement | null>(null);
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
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [slots, setSlots] = useState<string[]>([]);
  const [tableId, setTableId] = useState<number | null>(null);
  const [timeSlot, setTimeSlot] = useState<string | null>(null);
  const [durationMin, setDurationMin] = useState<number>(draft?.durationMin ?? SESSION_MIN);
  const [partySize, setPartySize] = useState<number>(draft?.partySize ?? 1);

  const [guestName, setGuestName] = useState(draft?.guestName ?? '');
  const [guestEmail, setGuestEmail] = useState(draft?.guestEmail ?? '');
  const [submitting, setSubmitting] = useState(false);

  // Priced by date on the server (Thu/Fri/Sat and Kuwait national holidays cost
  // more). Display only — checkout re-derives it, so this can never set a price.
  const [fee, setFee] = useState<{
    cents: number;
    peak: boolean;
    reason: string | null;
    lateCents: number;
  }>({ cents: 275, peak: false, reason: null, lateCents: 200 });

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
        fee: { cents: number; peak: boolean; reason: string | null; lateCents: number };
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
  }, [date, availabilityRetry]);

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
    // Jump rather than animate: the content under the viewport has already been
    // replaced, so a 400ms smooth scroll only delays a view the customer has
    // asked for, and reads as lag on the step they most want to be quick.
    if (!hasRenderedStepRef.current) {
      hasRenderedStepRef.current = true;
      return;
    }
    const card = bookingCardRef.current;
    if (!card) return;
    const top = card.getBoundingClientRect().top + window.scrollY - stickyHeaderOffset();
    scrollInstantly(top);
  }, [step]);

  const selectedTable = availability.find((tb) => tb.tableId === tableId) || null;

  // What this table can still give us from the chosen start, and therefore what
  // lengths the form may offer. `maxDuration` comes from the server, which knows
  // the next booking on this table; falling back to the minimum keeps an older
  // API (or a table with no entry) at the plain 2-hour session.
  const late = timeSlot ? isLateStart(timeSlot) : false;
  const floorMin = timeSlot ? minDurationFor(timeSlot) : SESSION_MIN;
  const roomMin = timeSlot
    ? Math.min(selectedTable?.maxDuration?.[timeSlot] ?? floorMin, maxDurationFor(timeSlot))
    : floorMin;
  const durationChoices = late ? [floorMin] : BLOCK_DURATIONS.filter((d) => d <= roomMin);

  // Charged per SEAT: one seat's fare (per 2-hour block, rounded up; a late
  // seating is one flat rate) times the party. The big tables carry a minimum
  // party, so they never bill fewer seats than that. The server recomputes all
  // of this at checkout — what follows is the customer-facing preview.
  const blocks = Math.max(1, Math.ceil(durationMin / SESSION_MIN));
  const perSeatCents = late ? fee.lateCents : fee.cents * blocks;
  const minParty = selectedTable ? minSeatsFor(selectedTable.capacity) : 1;
  const seats = Math.max(minParty, partySize);
  const totalCents = perSeatCents * seats;

  useEffect(() => {
    // A new table or start time can allow a different range, so re-seat the
    // length inside it rather than carrying an now-impossible choice forward.
    if (!timeSlot) return;
    setDurationMin((current) => (durationChoices.includes(current) ? current : floorMin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSlot, tableId, floorMin, roomMin]);

  useEffect(() => {
    // Likewise the headcount has to fit the table actually chosen — under its
    // capacity, and at or above its minimum party.
    if (!selectedTable) return;
    if (partySize > selectedTable.capacity) setPartySize(selectedTable.capacity);
    else if (partySize < minParty) setPartySize(minParty);
  }, [selectedTable, partySize, minParty]);

  useEffect(() => {
    // A different table can have a different availability pattern. Always show
    // its earliest times first instead of preserving another table's scroll.
    if (slotListRef.current) slotListRef.current.scrollTop = 0;
  }, [tableId, date]);

  function selectTable(nextTableId: number) {
    if (tableId !== nextTableId) setTimeSlot(null);
    setTableId(nextTableId);
    if (slotListRef.current) slotListRef.current.scrollTop = 0;

    // Mobile stacks the times under the map, so they can land off-screen. Nudge
    // only when the panel is genuinely out of view, and jump instead of
    // animating: a smooth scroll fired on every tap is what makes picking a
    // table feel laggy, and it fights the customer if they are already
    // scrolling themselves.
    if (!window.matchMedia('(max-width: 960px)').matches) return;
    window.requestAnimationFrame(() => {
      const panel = slotPanelRef.current;
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      const offset = stickyHeaderOffset();
      if (box.top >= offset && box.top < window.innerHeight * 0.75) return; // already visible
      scrollInstantly(box.top + window.scrollY - offset);
    });
  }

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
        durationMin,
        partySize,
      });
      if (res.redirectUrl) {
        // Redirect gateway (Tap): hand the browser to the hosted payment page.
        // A full navigation, not a route change, so we leave our SPA entirely.
        // Save the selection first so a failed/abandoned payment returns to a
        // ready-to-retry checkout rather than a blank form.
        saveDraft({ tableId, date, timeSlot, guestName, guestEmail, durationMin, partySize });
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

              <div className="cafe-floor-viewport">
                <div className="cafe-floor-plan" aria-label={t('bk.floorPlan')}>
                  <div className="floor-window floor-window-one" aria-hidden="true" />
                  <div className="floor-window floor-window-two" aria-hidden="true" />
                  <div className="floor-counter" aria-hidden="true">
                    <span>{t('bk.counter')}</span>
                    <i /><i /><i />
                  </div>
                  <div className="floor-shelf" aria-hidden="true">
                    <span>{t('bk.gameWall')}</span>
                  </div>
                  {/* The D&D table sits in its own walled room, gated off from
                      the main hall with a doorway — as in the real cafe. */}
                  <div className="floor-room-dnd" aria-hidden="true">
                    <span>{t('bk.dndRoom')}</span>
                  </div>
                  <img
                    className="floor-brand-mark"
                    src="/brand/cd-mark.png"
                    alt=""
                    aria-hidden="true"
                  />
                  <span className="floor-plant plant-one" aria-hidden="true">✦</span>
                  <span className="floor-plant plant-two" aria-hidden="true">✦</span>
                  <span className="floor-game-prop floor-die-prop" aria-hidden="true">
                    <i /><i /><i /><i />
                  </span>
                  <span className="floor-game-prop floor-card-prop" aria-hidden="true">
                    <b>A</b><em>♠</em>
                  </span>
                  <span className="floor-game-prop floor-door-prop" aria-hidden="true" />
                  <span className="floor-game-prop floor-domino-prop" aria-hidden="true">
                    <i /><i /><i /><i />
                  </span>
                  <span className="floor-entrance" aria-hidden="true">{t('bk.entrance')}</span>

                  {loadingAvailability && (
                    <div className="floor-loading" aria-live="polite">
                      <span className="floor-loading-die" aria-hidden="true">⚄</span>
                      {t('bk.loadingTables')}
                    </div>
                  )}

                  {!loadingAvailability && availability.length === 0 && (
                    <div className="floor-loading floor-load-error" role="alert">
                      <span className="floor-loading-die" aria-hidden="true">⚀</span>
                      <strong>{t('bk.tablesUnavailable')}</strong>
                      <span>{t('bk.tablesUnavailableSub')}</span>
                      <button type="button" onClick={() => setAvailabilityRetry((n) => n + 1)}>
                        {t('bk.retryTables')}
                      </button>
                    </div>
                  )}

                  {!loadingAvailability && availability.map((tb, index) => {
                    const placement = floorPlacement(tb.label, index);
                    const selected = tableId === tb.tableId;
                    const soldOut = tb.freeSlots.length === 0;
                    const chairs = chairPositions(placement.shape, tb.capacity);
                    // Tables low in the room would push their tooltip past the
                    // floor's clipped edge, so those flip it above instead.
                    const tipAbove = placement.y > 58;
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
                        className={`floor-table floor-table-${placement.shape} ${selected ? 'selected' : ''} ${soldOut ? 'sold-out' : ''} ${tipAbove ? 'tip-above' : ''}`}
                        aria-pressed={selected}
                        aria-label={t('bk.tableMapLabel', {
                          table: tb.label,
                          seats: tb.capacity,
                          slots: tb.freeSlots.length,
                        })}
                        onClick={() => selectTable(tb.tableId)}
                      >
                        <span className="table-shape-halo" aria-hidden="true" />
                        <span className="table-seats" aria-hidden="true">
                          {chairs.map((chair, chairIndex) => (
                            <i
                              key={chairIndex}
                              style={{
                                '--chair-x': `${chair.x}%`,
                                '--chair-y': `${chair.y}%`,
                                '--chair-angle': `${chair.angle}deg`,
                              } as CSSProperties}
                            />
                          ))}
                        </span>
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
              </div>

              <div className="floor-legend" aria-label={t('bk.legend')}>
                <span><i className="available" />{t('bk.available')}</span>
                <span><i className="selected" />{t('bk.selected')}</span>
                <span><i className="unavailable" />{t('bk.unavailable')}</span>
              </div>
            </div>

            <aside
              ref={slotPanelRef}
              className={`booking-slot-panel ${selectedTable ? 'has-table' : ''}`}
              aria-live="polite"
            >
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

                    <div ref={slotListRef} className="booking-slots">
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
                            // Without this the button reads as "14:00Open",
                            // the two child elements run together.
                            aria-label={`${slot} — ${free ? t('bk.open') : t('bk.taken')}`}
                            onClick={() => setTimeSlot(slot)}
                          >
                            <span>{slot}</span>
                            <small>{free ? t('bk.open') : t('bk.taken')}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {timeSlot && (
                    <div className="sitting-options">
                      <label className="sitting-field">
                        <span>{t('bk.stayLength')}</span>
                        {late ? (
                          <em className="sitting-fixed">
                            {t('bk.lateSeating')} · {timeSlot}–{endLabel(timeSlot, durationMin)}
                          </em>
                        ) : (
                          <select
                            value={durationMin}
                            onChange={(e) => setDurationMin(Number(e.target.value))}
                          >
                            {durationChoices.map((d) => (
                              <option key={d} value={d}>
                                {t('bk.hoursShort', { n: formatHours(d) })} · {t('bk.stayUntil')}{' '}
                                {endLabel(timeSlot, d)}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>

                      <label className="sitting-field">
                        <span>{t('bk.partySize')}</span>
                        <select
                          value={partySize}
                          onChange={(e) => setPartySize(Number(e.target.value))}
                        >
                          {Array.from(
                            { length: selectedTable.capacity - minParty + 1 },
                            (_, i) => i + minParty,
                          ).map(
                            (n) => (
                              <option key={n} value={n}>
                                {n === 1 ? t('bk.onePerson') : t('bk.people', { n })}
                              </option>
                            ),
                          )}
                        </select>
                      </label>

                      <p className="sitting-note">
                        {t('bk.perSeat', { amount: money(perSeatCents) })}
                        {minParty > 1 ? ` · ${t('bk.minParty', { n: minParty })}` : ''}
                      </p>
                      {late && <p className="sitting-note">{t('bk.lateSeatingHint')}</p>}
                    </div>
                  )}

                  <div className="slot-panel-action">
                    <div>
                      <span>{t('bk.selection')}</span>
                      <strong>
                        {timeSlot
                          ? `${selectedTable.label} · ${timeSlot}–${endLabel(timeSlot, durationMin)} · ${money(totalCents)}`
                          : t('bk.chooseTime')}
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
              {selectedTable?.label} · {date} ·{' '}
              {timeSlot && `${timeSlot}–${endLabel(timeSlot, durationMin)}`} ·{' '}
              {partySize === 1 ? t('bk.onePerson') : t('bk.people', { n: partySize })}
            </p>
            <ul>
              <li>
                {late
                  ? t('bk.lateSeating')
                  : blocks === 1
                    ? t('bk.blocks', { n: blocks })
                    : t('bk.blocksPlural', { n: blocks })}{' '}
                — {t('bk.seatMath', {
                  seats: String(seats),
                  each: money(perSeatCents),
                  total: money(totalCents),
                })}
                {!late && fee.peak && (
                  <span className="pill">
                    {fee.reason === 'weekend' ? t('bk.peakWeekend') : fee.reason}
                  </span>
                )}
              </li>
            </ul>
            <p className="total">
              {t('bk.total')} {money(totalCents)}
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
              {submitting ? t('bk.processing') : t('bk.pay', { amount: money(totalCents) })}
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
