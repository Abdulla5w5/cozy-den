import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { STAFF_WHATSAPP, STAFF_WHATSAPP_URL } from '../community';
import { useI18n } from '../i18n';
import { Booking, formatHours, TableAvailability } from '../types';
import { CafeFloorPlan, tablePhoto } from '../components/CafeFloorPlan';
import { isKuwaitPhone } from '../phone';
import { checkoutToken } from '../checkoutToken';
import { HostChoice, HostKind, HostPicker, hostFee } from '../components/HostPicker';
import { TermsBody, termsTitle } from './TermsPage';

// POST /bookings returns one of two shapes: the finished booking (direct/mock
// provider) or a gateway redirect URL (Tap). One handler covers both.
type CheckoutResponse = { booking?: Booking; redirectUrl?: string };

type Step = 1 | 2;

// Café hours, mirrored from the server's utils/slots. These only shape what the
// form offers; the server re-derives length, price and capacity on checkout, so
// nothing here can be leaned on to buy a longer sitting than was paid for.
const SESSION_MIN = 120;
const MAX_SESSION_MIN = 360; // six hours
const CLOSE_MIN = 27 * 60; // 03:00
const OPEN_MIN = 14 * 60;
// Mirrors BOOKING_LENGTHS in backend/src/utils/slots.ts: two, three, four, five
// or six hours. A late seating is the exception and runs to closing instead.
const BOOKING_LENGTHS = [120, 180, 240, 300, 360];
// Mirrors MAX_PARTY in backend/src/utils/pricing.ts: an online booking is for
// up to eight people, whatever the table seats.
const MAX_PARTY = 8;

// Mirrors MIN_SEATS_LADDER in backend/src/utils/pricing.ts: a big table is not
// worth taking out of service for a pair, so each size takes a minimum party.
// The server enforces it — this exists so the form can say so before the
// customer fills in their details and gets refused at the last step. A table
// with its own minimum (the server's `minParty`) uses that instead.
const MIN_SEATS_LADDER: [number, number][] = [
  [12, 5],
  [8, 4],
  [6, 3],
  [4, 2],
];
const minSeatsFor = (tb: TableAvailability) =>
  tb.minParty ?? MIN_SEATS_LADDER.find(([seats]) => tb.capacity >= seats)?.[1] ?? 1;

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
  guestPhone: string;
  durationMin: number;
  partySize: number;
  promoCode?: string;
  hostKind?: HostKind;
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
/** The date's prices, as the availability endpoint sends them. */
interface Fee {
  /** One seat, one 2-hour block. */
  cents: number;
  /** One seat, exactly six hours, where the day has a flat price; else null. */
  sixHourCents: number | null;
  /** One seat, the odd hour of a 3- or 5-hour booking; null means half a block. */
  extraHourCents: number | null;
  peak: boolean;
  reason: string | null;
  lateCents: number;
}

/** One seat for this many minutes — the same rule as the server's
 *  perSeatForLength (backend/src/utils/pricing.ts). */
function perSeatForLength(fee: Fee, durationMin: number): number {
  if (durationMin === 360 && fee.sixHourCents !== null) return fee.sixHourCents;
  const minutes = Math.max(SESSION_MIN, durationMin);
  const blocks = Math.floor(minutes / SESSION_MIN);
  const oddMin = minutes - blocks * SESSION_MIN;
  const odd =
    oddMin === 0
      ? 0
      : fee.extraHourCents !== null
        ? Math.round((fee.extraHourCents * oddMin) / 60)
        : Math.round((fee.cents * oddMin) / SESSION_MIN);
  return fee.cents * blocks + odd;
}

/** A date's prices under a promo code's hourly price set. */
interface CodeFee {
  cents: number;
  extraHourCents: number;
  sixHourCents: number | null;
}
interface AppliedPromo {
  code: string;
  /** Who may use it. group: a big enough party; newcomer: a signed-in member's
   *  first booking. What it charges is percentOff or fee, whichever it has. */
  kind: 'group' | 'newcomer';
  minParty: number;
  percentOff: number | null;
  /** Why the server will not take a newcomer code; null when it will. */
  refusal: 'sign_in' | 'verify_email' | 'first_only' | null;
  /** An hourly code's prices that day; null on a day it has none, a holiday
   *  priced by hand, or for a percentage code. */
  fee: CodeFee | null;
}

/** One seat at a code's hourly prices — the server's codePerSeat. */
function codePerSeat(g: CodeFee, durationMin: number): number {
  if (durationMin === 360 && g.sixHourCents !== null) return g.sixHourCents;
  return Math.round(g.cents + (g.extraHourCents * Math.max(0, durationMin - SESSION_MIN)) / 60);
}

/**
 * The length picker (the café's list, item 27): starts at two hours, with a
 * minus and a plus around it, stepping through the lengths this table and
 * start time allow. The pips underneath fill up like a game meter.
 */
function HourStepper({
  choices,
  value,
  onChange,
  until,
}: {
  choices: number[];
  value: number;
  onChange: (d: number) => void;
  until: (d: number) => string;
}) {
  const { t } = useI18n();
  const index = Math.max(0, choices.indexOf(value));
  const canLess = index > 0;
  const canMore = index < choices.length - 1;
  return (
    <div className="hour-stepper">
      <button
        type="button"
        className="hour-step"
        onClick={() => canLess && onChange(choices[index - 1])}
        disabled={!canLess}
        aria-label={t('bk.lessTime')}
      >
        −
      </button>
      <div className="hour-readout" aria-live="polite">
        <strong>{formatHours(value)}</strong>
        <span>{t('bk.hoursWord')}</span>
        <small>
          {t('bk.stayUntil')} <b dir="ltr">{until(value)}</b>
        </small>
        {choices.length > 1 && (
          <span className="hour-pips" aria-hidden="true">
            {choices.map((d, i) => (
              <i key={d} className={i <= index ? 'on' : ''} />
            ))}
          </span>
        )}
      </div>
      <button
        type="button"
        className="hour-step"
        onClick={() => canMore && onChange(choices[index + 1])}
        disabled={!canMore}
        aria-label={t('bk.moreTime')}
      >
        +
      </button>
    </div>
  );
}

export function BookingFlow() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, money, lang } = useI18n();
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
  // Two, not one: the smallest table on the floor seats four and so takes a
  // party of two, which makes one an opening state no table would accept.
  const [partySize, setPartySize] = useState<number>(draft?.partySize ?? 2);
  // A private game host for the sitting, if the customer adds one.
  const [host, setHost] = useState<HostChoice | null>(null);
  // Back from a failed payment: Pay waits while the chosen option is checked again.
  const [hostChecking, setHostChecking] = useState(!!draft?.hostKind);
  const [hostLost, setHostLost] = useState(false);
  const hostTouched = useRef(false);
  const chooseHost = useCallback((h: HostChoice | null) => {
    hostTouched.current = true;
    setHostLost(false);
    setHost(h);
  }, []);

  const [guestName, setGuestName] = useState(draft?.guestName ?? '');
  const [guestPhone, setGuestPhone] = useState(draft?.guestPhone ?? '');
  // Only a signed-in customer's: it links the booking to their history and
  // receives the receipt. A booking without an account goes by phone alone.
  const [accountEmail, setAccountEmail] = useState<string | undefined>(undefined);
  const phoneOk = isKuwaitPhone(guestPhone);
  // Not kept in the draft: agreeing is asked for again on every checkout.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [promoInput, setPromoInput] = useState(draft?.promoCode ?? '');
  // Pay waits while a code is being checked: the price on it may be about to change.
  const [promoChecking, setPromoChecking] = useState(!!draft?.promoCode);
  const promoRequest = useRef(0);
  const promoPending = useRef<string | null>(null);
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Priced by date on the server (Thu/Fri/Sat and Kuwait national holidays cost
  // more). Display only — checkout re-derives it, so this can never set a price.
  const [fee, setFee] = useState<Fee>({
    cents: 275,
    sixHourCents: 590,
    extraHourCents: 135,
    peak: false,
    reason: null,
    lateCents: 200,
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
        fee: Fee;
      }>(`/tables/availability?date=${date}`)
      .then((r) => {
        setSlots(r.slots);
        setAvailability(r.availability);
        // Older API instances did not include fee details in availability.
        // Keep the safe display default until checkout when that field is absent.
        // An instance from before the six-hour and extra-hour prices sends
        // neither.
        if (r.fee)
          setFee({
            ...r.fee,
            sixHourCents: r.fee.sixHourCents ?? null,
            extraHourCents: r.fee.extraHourCents ?? null,
          });
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
      .get<{ user: { name: string; email: string; phone: string | null } }>('/auth/me')
      .then((r) => {
        setGuestName(r.user.name);
        setAccountEmail(r.user.email);
        if (r.user.phone) setGuestPhone((typed) => typed || r.user.phone!);
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
  const durationChoices = late ? [floorMin] : BOOKING_LENGTHS.filter((d) => d <= roomMin);

  // Charged per SEAT: one seat's fare (the block rate per two hours, so five
  // hours is two and a half; six hours Sunday to Wednesday is a flat price; a
  // late seating is one flat rate) times the party. The big tables carry a minimum party, so
  // they never bill fewer seats than that. The server recomputes all of this
  // at checkout — what follows is the customer-facing preview.
  const normalPerSeat = late ? fee.lateCents : perSeatForLength(fee, durationMin);
  // The same rules checkout applies, for a customer the code is open to. Hourly
  // prices: never dearer than normal, and not on a late seating. A percentage:
  // not on the flat six-hour price — offers do not stack.
  const flatSixHours = !late && durationMin === 360 && fee.sixHourCents !== null;
  const promoOpen = !!promo && !promo.refusal && partySize >= promo.minParty;
  const hourlyApplies = promoOpen && !!promo?.fee && !late;
  const percentApplies = promoOpen && !flatSixHours && !!promo?.percentOff;
  const perSeatCents =
    hourlyApplies && promo?.fee
      ? Math.min(normalPerSeat, codePerSeat(promo.fee, durationMin))
      : percentApplies && promo?.percentOff
        ? Math.round((normalPerSeat * (100 - promo.percentOff)) / 100)
        : normalPerSeat;
  const promoApplies = perSeatCents < normalPerSeat;
  const minParty = selectedTable ? minSeatsFor(selectedTable) : 1;
  // Too small a party for this table: the server would refuse the booking, so
  // the panel blocks it here and names the tables that would take them.
  const partyTooSmall = partySize < minParty;
  const fittingTables = availability
    .filter((tb) => partySize <= tb.capacity && partySize >= minSeatsFor(tb))
    .map((tb) => tb.label);
  const seats = Math.max(minParty, partySize);
  const seatsTotalCents = perSeatCents * seats;
  // A host is per hour for the whole group, on top of the seats.
  const hostFeeCents = host && !late ? hostFee(host.hourlyCents, durationMin) : 0;
  const totalCents = seatsTotalCents + hostFeeCents;

  useEffect(() => {
    // A new table or start time can allow a different range, so re-seat the
    // length inside it rather than carrying an now-impossible choice forward.
    if (!timeSlot) return;
    setDurationMin((current) => (durationChoices.includes(current) ? current : floorMin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSlot, tableId, floorMin, roomMin]);

  useEffect(() => {
    // The headcount cannot exceed the table actually chosen, nor the online cap
    // of eight. A headcount BELOW
    // the table's minimum is left alone on purpose: quietly raising it would
    // charge for seats nobody asked for, so the panel says so instead and
    // offers the tables that do fit.
    const most = selectedTable ? Math.min(selectedTable.capacity, MAX_PARTY) : MAX_PARTY;
    if (partySize > most) setPartySize(most);
  }, [selectedTable, partySize]);

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

  // Hourly code prices depend on the day, so a code applied for one date is
  // checked again for another.
  // Signing in changes whether a newcomer code may be used.
  useEffect(() => {
    const code = promoPending.current ?? promo?.code;
    if (code) void applyPromo(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, accountEmail]);

  // Back from a failed payment: the code comes back too, checked again as it
  // may have been switched off or used up in the meantime.
  useEffect(() => {
    if (draft?.promoCode) void applyPromo(draft.promoCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The host comes back too, at today's price, if one is still free for this
  // sitting. Otherwise say so, rather than the total just dropping.
  useEffect(() => {
    const kind = draft?.hostKind;
    if (!draft || !kind) return;
    api
      .get<{ options: HostChoice[] }>(
        `/hosts/available?date=${draft.date}&timeSlot=${encodeURIComponent(draft.timeSlot)}` +
          `&durationMin=${draft.durationMin}&retry=${checkoutToken()}`,
      )
      .then((r) => r.options.find((o) => o.kind === kind) ?? null)
      .catch(() => null)
      .then((option) => {
        setHostChecking(false);
        // They have already picked again on the table step.
        if (hostTouched.current) return;
        setHost(option);
        setHostLost(!option);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyPromo(code: string) {
    // Only the newest check counts: an older answer may be for another date.
    const request = ++promoRequest.current;
    setPromoError(null);
    if (!code.trim()) {
      promoPending.current = null;
      setPromoChecking(false);
      return setPromo(null);
    }
    promoPending.current = code;
    setPromoChecking(true);
    try {
      const r = await api.get<AppliedPromo>(
        `/bookings/promo-check?code=${encodeURIComponent(code.trim())}&date=${date}`,
      );
      if (request !== promoRequest.current) return;
      setPromo(r);
    } catch (e) {
      if (request !== promoRequest.current) return;
      setPromo(null);
      setPromoError(e instanceof ApiError && e.status === 404 ? t('bk.promoInvalid') : t('bk.wrong'));
    } finally {
      if (request === promoRequest.current) {
        promoPending.current = null;
        setPromoChecking(false);
      }
    }
  }

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
        guestPhone,
        guestEmail: accountEmail,
        acceptedTerms,
        durationMin,
        partySize,
        promoCode: promoApplies ? promo?.code : undefined,
        retryToken: checkoutToken(),
        hostKind: host && !late ? host.kind : undefined,
      });
      if (res.redirectUrl) {
        // Redirect gateway (Tap): hand the browser to the hosted payment page.
        // A full navigation, not a route change, so we leave our SPA entirely.
        // Save the selection first so a failed/abandoned payment returns to a
        // ready-to-retry checkout rather than a blank form.
        saveDraft({
          tableId,
          date,
          timeSlot,
          guestName,
          guestPhone,
          durationMin,
          partySize,
          promoCode: promoApplies ? promo?.code : undefined,
          hostKind: host && !late ? host.kind : undefined,
        });
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
            <div className="booking-side">
              <div className="booking-hours" aria-label={t('bk.hours')}>
                <span className="booking-status-dot" aria-hidden="true" />
                <div>
                  <strong>{t('bk.hours')}</strong>
                  <span>{t('bk.lastSeating')}</span>
                </div>
              </div>
              <a
                className="booking-hours booking-whatsapp"
                href={STAFF_WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="booking-wa-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" focusable="false">
                    <path
                      fill="currentColor"
                      d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"
                    />
                  </svg>
                </span>
                <div>
                  <strong>{t('bk.whatsapp')}</strong>
                  <span dir="ltr">{STAFF_WHATSAPP}</span>
                </div>
              </a>
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

              <CafeFloorPlan
                tables={availability}
                selectedId={tableId}
                onSelect={selectTable}
                loading={loadingAvailability}
                loadError={!loadingAvailability && availability.length === 0}
                onRetry={() => setAvailabilityRetry((n) => n + 1)}
                decorate={(tb) => {
                  const avail = availability.find((a) => a.tableId === tb.tableId);
                  const free = avail?.freeSlots ?? [];
                  const soldOut = free.length === 0;
                  return {
                    className: soldOut ? 'sold-out' : '',
                    ariaLabel: t('bk.tableMapLabel', {
                      table: tb.label,
                      seats: tb.capacity,
                      slots: free.length,
                    }),
                    tooltip: (
                      <>
                        <strong>{tb.label}</strong>
                        <small>
                          {soldOut ? t('bk.noOpenSlots') : t('bk.openSlots', { n: free.length })}
                        </small>
                        {!soldOut && <em>{free.slice(0, 3).join(' · ')}</em>}
                      </>
                    ),
                  };
                }}
              />

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
                    {/* A small framed photograph of the table just picked, with
                        the logo on its corner. Keyed by table so choosing
                        another swaps the picture rather than reusing the old
                        one while the new one loads; hidden if it fails. */}
                    {tablePhoto(selectedTable.label) && (
                      <figure className="table-photo" key={selectedTable.tableId}>
                        <img
                          src={tablePhoto(selectedTable.label)!}
                          alt={selectedTable.label}
                          width={640}
                          height={400}
                          decoding="async"
                          onError={(e) => {
                            e.currentTarget.parentElement!.hidden = true;
                          }}
                        />
                        <img className="table-photo-logo" src="/brand/cd-mark.png" alt="" aria-hidden="true" />
                      </figure>
                    )}
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
                      {slots
                        // A time that has already gone by is not "taken" — it
                        // is simply over. Leave it out rather than grey it.
                        .filter((slot) => !selectedTable.pastSlots?.includes(slot))
                        .map((slot) => {
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
                      {/* A div, not a label: a label hands its clicks to the
                          first button inside it, so tapping "How long?" would
                          have taken an hour off. */}
                      <div className="sitting-field" role="group" aria-labelledby="stay-length">
                        <span id="stay-length">{t('bk.stayLength')}</span>
                        {late ? (
                          <em className="sitting-fixed">
                            {t('bk.lateSeating')} · {timeSlot}–{endLabel(timeSlot, durationMin)}
                          </em>
                        ) : (
                          <HourStepper
                            choices={durationChoices}
                            value={durationMin}
                            onChange={setDurationMin}
                            until={(d) => endLabel(timeSlot, d)}
                          />
                        )}
                      </div>

                      <label className="sitting-field">
                        <span>{t('bk.partySize')}</span>
                        <select
                          value={partySize}
                          onChange={(e) => setPartySize(Number(e.target.value))}
                        >
                          {Array.from(
                            { length: Math.min(selectedTable.capacity, MAX_PARTY) },
                            (_, i) => i + 1,
                          ).map(
                            (n) => (
                              <option key={n} value={n}>
                                {n === 1 ? t('bk.onePerson') : t('bk.people', { n })}
                              </option>
                            ),
                          )}
                        </select>
                      </label>

                      {partyTooSmall ? (
                        <p className="sitting-note warn" role="status">
                          {t('bk.partyTooSmall', {
                            seats: selectedTable.capacity,
                            n: minParty,
                          })}{' '}
                          {fittingTables.length > 0
                            ? t('bk.tryTables', { tables: fittingTables.join(', ') })
                            : t('bk.tryFewerTables')}
                        </p>
                      ) : (
                        <p className="sitting-note">
                          {t('bk.perSeat', { amount: money(perSeatCents) })}
                          {minParty > 1 ? ` · ${t('bk.minParty', { n: minParty })}` : ''}
                        </p>
                      )}
                      {late && <p className="sitting-note">{t('bk.lateSeatingHint')}</p>}
                      <HostPicker
                        date={date}
                        timeSlot={timeSlot}
                        durationMin={durationMin}
                        late={late}
                        selected={host}
                        onSelect={chooseHost}
                      />
                    </div>
                  )}

                  <div className="slot-panel-action">
                    <div>
                      <span>{t('bk.selection')}</span>
                      <strong>
                        {partyTooSmall
                          ? t('bk.minParty', { n: minParty })
                          : timeSlot
                            ? `${selectedTable.label} · ${timeSlot}–${endLabel(timeSlot, durationMin)} · ${money(totalCents)}`
                            : t('bk.chooseTime')}
                      </strong>
                    </div>
                    <button
                      className="primary"
                      disabled={!timeSlot || partyTooSmall}
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
                {late ? t('bk.lateSeating') : t('bk.sessionHours', { n: formatHours(durationMin) })}{' '}
                — {t('bk.seatMath', {
                  seats: String(seats),
                  each: money(perSeatCents),
                  total: money(seatsTotalCents),
                })}
                {!late && fee.peak && (
                  <span className="pill">
                    {fee.reason === 'weekend' ? t('bk.peakWeekend') : fee.reason}
                  </span>
                )}
              </li>
              {host && hostFeeCents > 0 && (
                <li>
                  {t('host.summary', {
                    name: t(`host.kind.${host.kind}`),
                    hours: formatHours(durationMin),
                    amount: money(hostFeeCents),
                  })}
                </li>
              )}
            </ul>
            {hostLost &&
              date === draft?.date &&
              timeSlot === draft?.timeSlot &&
              durationMin === draft?.durationMin && (
                <p className="field-hint is-error">{t('host.lostOnRetry')}</p>
              )}
            <p className="total">
              {t('bk.total')} {money(totalCents)}
            </p>

            <form
              className="promo-code"
              onSubmit={(e) => {
                e.preventDefault();
                void applyPromo(promoInput);
              }}
            >
              <label className="field inline">
                {t('bk.promo')}
                <input
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value)}
                  autoCapitalize="characters"
                  dir="ltr"
                />
              </label>
              <button type="submit">{t('bk.promoApply')}</button>
            </form>
            {promoError && <p className="field-hint is-error">{promoError}</p>}
            {promo && (
              <p className={`field-hint ${promo.refusal ? 'is-error' : 'muted'}`}>
                {promo.refusal === 'sign_in'
                  ? t('bk.promoSignIn')
                  : promo.refusal === 'verify_email'
                    ? t('bk.promoVerify')
                    : promo.refusal
                      ? t('bk.promoFirstOnly')
                      : partySize < promo.minParty
                        ? t('bk.promoTooSmall', { n: String(promo.minParty) })
                        : promo.percentOff
                          ? flatSixHours
                            ? t('bk.promoNotSixHour')
                            : t(promo.kind === 'newcomer' ? 'bk.promoNewcomer' : 'bk.promoPercent', {
                                code: promo.code,
                                n: String(promo.percentOff),
                              })
                          : !promo.fee
                            ? t('bk.promoNotToday')
                            : late
                              ? t('bk.promoNotLate')
                              : promoApplies
                                ? t('bk.promoApplied', { code: promo.code })
                                : t('bk.promoSamePrice', { code: promo.code })}
              </p>
            )}
          </div>

          <label className="field">
            {t('bk.name')}
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          </label>
          <label className="field">
            {t('bk.phone')}
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder={t('auth.phonePh')}
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              aria-invalid={guestPhone !== '' && !phoneOk}
            />
            <small className={`muted field-hint ${guestPhone !== '' && !phoneOk ? 'is-error' : ''}`}>
              {guestPhone !== '' && !phoneOk ? t('bk.phoneInvalid') : t('bk.phoneHint')}
            </small>
          </label>

          {payError && (
            <div className="alert error" onClick={dismissPayStatus}>
              {payError}
            </div>
          )}

          {/* The café's refund and no-show rules hang on this, so payment
              waits for it. The terms open in a pop-up over the form — a new
              tab or page left no way back to the booking on a phone. */}
          <label className="terms-check">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
            />
            <span>
              {t('bk.terms1')}{' '}
              <a
                href="/terms"
                onClick={(e) => {
                  e.preventDefault();
                  setTermsOpen(true);
                }}
              >
                {t('bk.terms2')}
              </a>{' '}
              {t('bk.terms3')}
            </span>
          </label>

          {termsOpen && (
            <TermsDialog
              title={termsTitle(lang)}
              onClose={() => setTermsOpen(false)}
              onAgree={() => {
                setAcceptedTerms(true);
                setTermsOpen(false);
              }}
            />
          )}

          <div className="pay-note">
            <span aria-hidden="true">🔒</span>
            <p className="muted">{t('bk.paySecure')}</p>
          </div>

          <div className="actions">
            <button onClick={() => setStep(1)}>{t('bk.back')}</button>
            <button
              className="primary"
              disabled={submitting || promoChecking || hostChecking || !guestName || !phoneOk || !acceptedTerms || !tableId || !timeSlot}
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

/** The terms over the booking form: read, then close or agree. */
function TermsDialog({
  title,
  onClose,
  onAgree,
}: {
  title: string;
  onClose: () => void;
  onAgree: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // The page behind stays put while the terms scroll.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="terms-backdrop" onClick={onClose}>
      <div
        className="terms-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="terms-dialog-head">
          <h2 id="terms-dialog-title">{title}</h2>
          <button type="button" className="terms-dialog-x" onClick={onClose} aria-label={t('bk.termsClose')}>
            ✕
          </button>
        </div>
        <div className="terms-dialog-body">
          <TermsBody />
        </div>
        <div className="terms-dialog-actions">
          <button type="button" onClick={onClose}>
            {t('bk.termsClose')}
          </button>
          <button type="button" className="primary" onClick={onAgree} autoFocus>
            {t('bk.termsAgree')}
          </button>
        </div>
      </div>
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
