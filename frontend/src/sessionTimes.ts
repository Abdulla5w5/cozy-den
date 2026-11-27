/** Wanted Board session times, shared by the board and the staff page. */

// The café's starts that fit a 2-hour session: 14:00 to 01:00.
export const SESSION_STARTS = Array.from({ length: 23 }, (_, i) => {
  const m = (14 * 60 + i * 30) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});
export const SESSION_LENGTHS = [120, 180, 240, 300, 360];

/** Minutes into the night: before 14:00 is the small hours after it. */
export function nightMinutes(slot: string): number {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m + (h < 14 ? 24 * 60 : 0);
}

/** The moment a session starts, in Kuwait time. */
export const sessionStartsAt = (night: string, slot: string) =>
  Date.parse(`${night}T00:00:00+03:00`) + nightMinutes(slot) * 60_000;

/** Starts that end by closing (03:00) and are at least `noticeMs` away. */
export function startsFor(night: string, durationMin: number, noticeMs: number): string[] {
  return SESSION_STARTS.filter(
    (s) =>
      nightMinutes(s) + durationMin <= 27 * 60 &&
      (!night || sessionStartsAt(night, s) - Date.now() >= noticeMs),
  );
}

/** The calendar day it starts: 00:30 is the day after the night it belongs to. */
export function calendarDay(night: string, start: string | null): string {
  if (!start || Number(start.slice(0, 2)) >= 14) return night;
  return new Date(Date.parse(`${night}T00:00:00Z`) + 24 * 3600_000).toISOString().slice(0, 10);
}
