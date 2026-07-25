import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { Booking, TableAvailability } from '../types';

// POST /bookings returns one of two shapes: the finished booking (direct/mock
// provider) or a gateway redirect URL (Tap). One handler covers both.
type CheckoutResponse = { booking?: Booking; redirectUrl?: string };

type Step = 1 | 2;

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

  // Captured once, synchronously on first render, so the availability effect
  // below can re-apply the saved table/time after it reloads.
  const [draft] = useState<BookingDraft | null>(readDraftOnReturn);
  const restoreRef = useRef<BookingDraft | null>(draft);

  const [step, setStep] = useState<Step>(draft ? 2 : 1);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(draft?.date ?? todayIso());
  const [availability, setAvailability] = useState<TableAvailability[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [tableId, setTableId] = useState<number | null>(null);
  const [timeSlot, setTimeSlot] = useState<string | null>(null);

  const [guestName, setGuestName] = useState(draft?.guestName ?? '');
  const [guestEmail, setGuestEmail] = useState(draft?.guestEmail ?? '');
  const [submitting, setSubmitting] = useState(false);

  const TABLE_FEE_CENTS = 500; // display only; server is the source of truth

  useEffect(() => {
    setError(null);
    // Clear a prior selection only on a genuine user date change — not while
    // restoring a draft for this same date after a returned payment.
    if (restoreRef.current?.date !== date) {
      setTableId(null);
      setTimeSlot(null);
    }
    api
      .get<{ slots: string[]; availability: TableAvailability[] }>(
        `/tables/availability?date=${date}`
      )
      .then((r) => {
        setSlots(r.slots);
        setAvailability(r.availability);
        // Re-apply the saved table/time once the grid for its date has loaded.
        if (restoreRef.current && restoreRef.current.date === date) {
          setTableId(restoreRef.current.tableId);
          setTimeSlot(restoreRef.current.timeSlot);
          restoreRef.current = null;
        }
      })
      .catch((e) => setError(e.message));
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

  const selectedTable = availability.find((tb) => tb.tableId === tableId) || null;

  // Surface a failed/cancelled return from the payment gateway. (The step is
  // already set to 2 on first render when a draft was restored.)
  const payStatus = searchParams.get('payment');
  const payError =
    payStatus === 'failed'
      ? t('bk.payFailed')
      : payStatus === 'error'
        ? t('bk.payError')
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
    <div className="card">
      <Stepper step={step} />
      {error && <div className="alert error">{error}</div>}

      {step === 1 && (
        <section>
          <h2>{t('bk.s1title')}</h2>
          <p className="muted">{t('bk.sessionHint')}</p>
          <label className="field">
            {t('bk.date')}
            <input
              type="date"
              min={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <div className="table-grid">
            {availability.map((tb) => (
              <div key={tb.tableId} className={`table-card ${tableId === tb.tableId ? 'sel' : ''}`}>
                <div className="table-head">
                  <strong>{tb.label}</strong>
                  <span className="pill">{t('bk.seats', { n: tb.capacity })}</span>
                </div>
                <div className="slots">
                  {slots.map((s) => {
                    const free = tb.freeSlots.includes(s);
                    const active = tableId === tb.tableId && timeSlot === s;
                    return (
                      <button
                        key={s}
                        disabled={!free}
                        className={`slot ${active ? 'active' : ''}`}
                        onClick={() => {
                          setTableId(tb.tableId);
                          setTimeSlot(s);
                        }}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="actions">
            <button className="primary" disabled={!tableId || !timeSlot} onClick={() => setStep(2)}>
              {t('bk.nextDetails')}
            </button>
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
                {t('bk.tableFee')} — {money(TABLE_FEE_CENTS)}
              </li>
            </ul>
            <p className="total">
              {t('bk.total')} {money(TABLE_FEE_CENTS)}
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
              {submitting ? t('bk.processing') : t('bk.pay', { amount: money(TABLE_FEE_CENTS) })}
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
