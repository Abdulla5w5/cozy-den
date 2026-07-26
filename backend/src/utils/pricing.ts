import { query } from '../db/pool';

/**
 * What a table costs for a two-hour session on a given evening.
 *
 * Resolution order:
 *   1. A staff-set override for that exact date — a holiday, a discount day, a
 *      one-off event rate. Whatever staff typed wins outright.
 *   2. Thursday / Friday / Saturday — the peak rate.
 *   3. Everything else — the off-peak rate.
 *
 * The date is the booking_date, which identifies the EVENING a session belongs
 * to rather than the wall-clock calendar day. The café's service day runs to
 * 03:00, so a 01:00 start on Friday morning is part of Thursday evening and is
 * priced as Thursday.
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
  /** Why this price: a staff label, 'weekend', or null for the normal rate. */
  reason: string | null;
}

export interface Rates {
  peakCents: number;
  offPeakCents: number;
}

export async function getRates(): Promise<Rates> {
  const { rows } = await query<{ peak_cents: number; offpeak_cents: number }>(
    'SELECT peak_cents, offpeak_cents FROM pricing_rates WHERE id',
  );
  return { peakCents: rows[0].peak_cents, offPeakCents: rows[0].offpeak_cents };
}

export async function getTableFee(date: string): Promise<TableFee> {
  const { rows } = await query<{
    dow: number;
    label: string | null;
    fee_cents: number | null;
    peak_cents: number;
    offpeak_cents: number;
  }>(
    `SELECT EXTRACT(DOW FROM $1::date)::int AS dow,
            o.label, o.fee_cents, r.peak_cents, r.offpeak_cents
       FROM pricing_rates r
       LEFT JOIN price_overrides o ON o.override_date = $1::date
      WHERE r.id`,
    [date],
  );
  const row = rows[0];

  if (row.fee_cents !== null) {
    // An override can be cheaper OR dearer than the normal rate, so "peak" here
    // means "costs more than this day otherwise would", not "is a weekend".
    const baseline = PEAK_DAYS.has(row.dow) ? row.peak_cents : row.offpeak_cents;
    return { cents: row.fee_cents, peak: row.fee_cents > baseline, reason: row.label };
  }
  if (PEAK_DAYS.has(row.dow)) {
    return { cents: row.peak_cents, peak: true, reason: 'weekend' };
  }
  return { cents: row.offpeak_cents, peak: false, reason: null };
}

// ---------- Staff editor ----------

export interface Override {
  date: string;
  label: string;
  feeCents: number;
}

export async function listOverrides(fromDate: string): Promise<Override[]> {
  const { rows } = await query<{ d: string; label: string; fee_cents: number }>(
    `SELECT to_char(override_date, 'YYYY-MM-DD') AS d, label, fee_cents
       FROM price_overrides
      WHERE override_date >= $1::date
      ORDER BY override_date`,
    [fromDate],
  );
  return rows.map((r) => ({ date: r.d, label: r.label, feeCents: r.fee_cents }));
}

export async function upsertOverride(o: Override): Promise<void> {
  await query(
    `INSERT INTO price_overrides (override_date, label, fee_cents)
     VALUES ($1::date, $2, $3)
     ON CONFLICT (override_date)
       DO UPDATE SET label = EXCLUDED.label, fee_cents = EXCLUDED.fee_cents,
                     updated_at = now()`,
    [o.date, o.label, o.feeCents],
  );
}

export async function deleteOverride(date: string): Promise<boolean> {
  const { rowCount } = await query('DELETE FROM price_overrides WHERE override_date = $1::date', [
    date,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function setRates(r: Rates): Promise<void> {
  await query(
    'UPDATE pricing_rates SET peak_cents = $1, offpeak_cents = $2, updated_at = now() WHERE id',
    [r.peakCents, r.offPeakCents],
  );
}
