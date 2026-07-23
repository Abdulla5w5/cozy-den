// Café hours + session rules. Every booking is a fixed 2-hour session that can
// start every 30 minutes from opening until (closing - 2h). Changing the café's
// hours = edit OPEN_MIN / CLOSE_MIN here; everything else derives from them.
export const OPEN_MIN = 12 * 60; // 12:00
export const CLOSE_MIN = 22 * 60; // 22:00
export const SESSION_MIN = 120; // fixed 2-hour session
const STEP_MIN = 30; // rolling start-time granularity

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** All valid start times: 12:00, 12:30, ... 20:00 (last start = close - 2h). */
export const START_TIMES: string[] = (() => {
  const out: string[] = [];
  for (let t = OPEN_MIN; t <= CLOSE_MIN - SESSION_MIN; t += STEP_MIN) out.push(fmt(t));
  return out;
})();

export function isValidStart(value: string): boolean {
  return START_TIMES.includes(value);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Two 2-hour sessions overlap iff their starts are less than 2h apart. */
export function overlaps(startA: string, startB: string): boolean {
  return Math.abs(toMinutes(startA) - toMinutes(startB)) < SESSION_MIN;
}
