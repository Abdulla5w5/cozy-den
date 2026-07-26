import { query } from '../db/pool';
import { env } from '../config/env';

/**
 * What a table costs for a two-hour session on a given evening.
 *
 * Peak — KD 3.500 — on Thursday, Friday, Saturday and Kuwait national holidays.
 * Off-peak — KD 2.750 — every other day.
 *
 * The date is the booking_date, which identifies the EVENING a session belongs
 * to rather than the wall-clock calendar day. The café's service day runs to
 * 03:00, so a 01:00 start on Friday morning is part of Thursday evening and is
 * priced as Thursday. Using booking_date gets that right for free.
 *
 * Always resolved server-side from the date the customer actually booked. The
 * price is never read from the request, so a tampered client cannot buy a
 * Friday table at the Monday rate.
 */

// Postgres DOW: 0 = Sunday .. 6 = Saturday.
const PEAK_DAYS = new Set([4, 5, 6]); // Thursday, Friday, Saturday

export interface TableFee {
  cents: number;
  peak: boolean;
  /** Why it is peak, when it is: 'weekend', a holiday name, or null. */
  reason: string | null;
}

export async function getTableFee(date: string): Promise<TableFee> {
  const { rows } = await query<{ dow: number; holiday: string | null }>(
    `SELECT EXTRACT(DOW FROM $1::date)::int AS dow,
            (SELECT name FROM holidays WHERE holiday_date = $1::date) AS holiday`,
    [date],
  );
  const { dow, holiday } = rows[0];

  if (holiday) {
    return { cents: env.tableFeePeakCents, peak: true, reason: holiday };
  }
  if (PEAK_DAYS.has(dow)) {
    return { cents: env.tableFeePeakCents, peak: true, reason: 'weekend' };
  }
  return { cents: env.tableFeeOffPeakCents, peak: false, reason: null };
}
