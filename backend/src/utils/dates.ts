import { z } from 'zod';

/**
 * Date validation that checks the date EXISTS, not merely that it is shaped
 * like one.
 *
 * `^\d{4}-\d{2}-\d{2}$` happily accepts 2026-99-99 and 2026-02-31. Those pass
 * the schema, reach Postgres as a ::date cast, and blow up as an unhandled
 * driver error — a 500 on plainly invalid user input. Round-tripping through
 * Date is the cheap way to reject the impossible ones: 2026-02-31 normalises to
 * March 3, so the formatted result no longer matches what was sent.
 */

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isRealMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/** `YYYY-MM-DD` that names a real calendar day. */
export const isoDate = () =>
  z.string().trim().refine(isRealDate, 'must be a real date in YYYY-MM-DD format');

/** `YYYY-MM` that names a real month. */
export const isoMonth = () =>
  z.string().trim().refine(isRealMonth, 'must be a real month in YYYY-MM format');
