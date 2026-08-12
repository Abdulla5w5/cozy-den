// Café hours + session rules.
//
// A booking is a start time plus a length the customer chooses. Two hours is
// the default and the minimum, extendable in 30-minute steps up to closing.
//
// Intake runs later than the last full session: the café takes customers until
// 02:00 but closes at 03:00, so a start after 01:00 cannot fit two hours. Those
// are "late seatings" — they run to closing and are priced at their own flat
// rate rather than as a 2-hour block (see utils/pricing).
//
// Changing the café's hours = edit these constants; everything else derives.
export const OPEN_MIN = 14 * 60; // 14:00
export const CLOSE_MIN = 27 * 60; // 03:00 the following morning
export const LAST_INTAKE_MIN = 26 * 60; // 02:00 — latest a customer may start
export const SESSION_MIN = 120; // one block: the default and minimum session
export const MAX_SESSION_MIN = 360; // six hours, the longest a customer may hold a table
export const STEP_MIN = 30; // start-time granularity

/**
 * The only lengths a normal booking may be: two, four or six hours.
 *
 * Sittings are sold in whole 2-hour blocks, so there is no half-block to offer
 * and nothing between them to choose. A late seating is the one exception — it
 * runs to closing, whatever that leaves.
 */
export const BLOCK_DURATIONS: readonly number[] = [SESSION_MIN, SESSION_MIN * 2, SESSION_MIN * 3];

function fmt(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** All valid starts: 14:00, 14:30, ... 01:30, 02:00. */
export const START_TIMES: string[] = (() => {
  const out: string[] = [];
  for (let t = OPEN_MIN; t <= LAST_INTAKE_MIN; t += STEP_MIN) out.push(fmt(t));
  return out;
})();

export function isValidStart(value: string): boolean {
  return START_TIMES.includes(value);
}

/**
 * Minutes from the start of the service day. Slots before opening belong to the
 * small hours of the *following* morning, so they sort after the evening rather
 * than 13 hours before it.
 */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const minutes = h * 60 + m;
  return minutes < OPEN_MIN ? minutes + 24 * 60 : minutes;
}

/** A start too late to fit a full session; it runs to closing instead. */
export function isLateStart(start: string): boolean {
  return toMinutes(start) > CLOSE_MIN - SESSION_MIN;
}

/**
 * The longest bookable length from this start, ignoring other bookings.
 * Bounded by closing time and by the six-hour ceiling, whichever bites first.
 */
export function maxDurationFor(start: string): number {
  const toClose = CLOSE_MIN - toMinutes(start);
  return isLateStart(start) ? toClose : Math.min(toClose, MAX_SESSION_MIN);
}

/**
 * The shortest bookable length from this start. Normally the 2-hour session;
 * for a late seating, whatever remains until closing — there is no shorter
 * option to offer, and no longer one either.
 */
export function minDurationFor(start: string): number {
  return isLateStart(start) ? maxDurationFor(start) : SESSION_MIN;
}

/**
 * The lengths actually offered from this start.
 *
 * A late seating has exactly one: the remainder to closing. Everything else
 * gets whichever whole blocks still fit before the café shuts.
 */
export function allowedDurations(start: string): number[] {
  if (isLateStart(start)) return [maxDurationFor(start)];
  const ceiling = maxDurationFor(start);
  return BLOCK_DURATIONS.filter((d) => d <= ceiling);
}

/** Whether a customer-supplied length is legal for this start. */
export function isValidDuration(start: string, durationMin: number): boolean {
  if (!Number.isInteger(durationMin)) return false;
  return allowedDurations(start).includes(durationMin);
}

/** Do two bookings, each a start plus a length, collide? */
export function overlaps(
  startA: string,
  durationA: number,
  startB: string,
  durationB: number,
): boolean {
  const a = toMinutes(startA);
  const b = toMinutes(startB);
  return a < b + durationB && b < a + durationA;
}
