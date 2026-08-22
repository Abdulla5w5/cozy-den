import { query } from '../db/pool';
import { isLateStart, SESSION_MIN } from './slots';

/**
 * What a seat costs for a two-hour session on a given evening.
 *
 * Every rate here is PER SEAT: a party of four on an off-peak evening pays four
 * times the off-peak rate. The table itself is not priced — only the chairs
 * actually taken — so the same table costs a pair half of what it costs four
 * people.
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

/**
 * The bigger tables are not worth taking out of service for a pair, so a party
 * below this floor cannot book one. Kept here, next to the per-seat rates,
 * because it is the same idea from the other end: the floor is both the
 * smallest party allowed and the fewest seats ever charged.
 */
export const LARGE_TABLE_CAPACITY = 12;
export const LARGE_TABLE_MIN_SEATS = 4;

/** The smallest party this table accepts — and so the fewest seats it bills. */
export function minSeatsFor(capacity: number): number {
  return capacity >= LARGE_TABLE_CAPACITY ? LARGE_TABLE_MIN_SEATS : 1;
}

/** Seats a booking is billed for: what was asked, or the table's floor. */
export function billableSeats(capacity: number, partySize: number): number {
  return Math.max(minSeatsFor(capacity), partySize);
}

export interface TableFee {
  /** What one seat costs for one 2-hour block on this date. */
  cents: number;
  peak: boolean;
  /** Why this price: a staff label, 'weekend', or null for the normal rate. */
  reason: string | null;
  /** Flat per-seat price for a late seating — a start after 01:00, which runs
   *  to close. */
  lateCents: number;
}

/** What a specific booking costs, once its start and length are known. */
export interface BookingQuote extends TableFee {
  /** The amount actually charged: perSeatCents x seats. */
  totalCents: number;
  /** What one seat costs for this sitting, before multiplying by the party. */
  perSeatCents: number;
  /** Seats charged for — the party, or the table's minimum, whichever is more. */
  seats: number;
  /** 2-hour blocks charged; 0 for a late seating, which is a flat rate. */
  blocks: number;
  late: boolean;
}

export interface Rates {
  peakCents: number;
  offPeakCents: number;
  latePeakCents: number;
  lateOffPeakCents: number;
}

export async function getRates(): Promise<Rates> {
  const { rows } = await query<{
    peak_cents: number;
    offpeak_cents: number;
    late_peak_cents: number;
    late_offpeak_cents: number;
  }>(
    `SELECT peak_cents, offpeak_cents, late_peak_cents, late_offpeak_cents
       FROM pricing_rates WHERE id`,
  );
  return {
    peakCents: rows[0].peak_cents,
    offPeakCents: rows[0].offpeak_cents,
    latePeakCents: rows[0].late_peak_cents,
    lateOffPeakCents: rows[0].late_offpeak_cents,
  };
}

/**
 * Per-seat block rate for a Wanted Board listing, chosen from its preferred days rather
 * than the day it happens to be viewed or reserved on. Peak only if EVERY
 * preferred day is a peak day; otherwise off-peak — the cheaper day the
 * customer could pick. A listing carries no date, so date overrides (holidays)
 * do not apply.
 *
 * This is why a Monday listing stays off-peak even when reserved on a Saturday.
 */
export function blockCentsForDays(preferredDays: number[], rates: Rates): number {
  const allPeak = preferredDays.length > 0 && preferredDays.every((d) => PEAK_DAYS.has(d));
  return allPeak ? rates.peakCents : rates.offPeakCents;
}

export async function getTableFee(date: string): Promise<TableFee> {
  const { rows } = await query<{
    dow: number;
    label: string | null;
    fee_cents: number | null;
    peak_cents: number;
    offpeak_cents: number;
    late_peak_cents: number;
    late_offpeak_cents: number;
  }>(
    `SELECT EXTRACT(DOW FROM $1::date)::int AS dow,
            o.label, o.fee_cents, r.peak_cents, r.offpeak_cents,
            r.late_peak_cents, r.late_offpeak_cents
       FROM pricing_rates r
       LEFT JOIN price_overrides o ON o.override_date = $1::date
      WHERE r.id`,
    [date],
  );
  const row = rows[0];
  const peakDay = PEAK_DAYS.has(row.dow);
  // A staff override sets the block rate for the evening. Late seatings keep
  // their own flat rate: it is already a reduced price for a shortened sitting,
  // and scaling it by an unrelated override would make a holiday cheaper or
  // dearer than intended in a way nobody asked for.
  const lateCents = peakDay ? row.late_peak_cents : row.late_offpeak_cents;

  if (row.fee_cents !== null) {
    // An override can be cheaper OR dearer than the normal rate, so "peak" here
    // means "costs more than this day otherwise would", not "is a weekend".
    const baseline = peakDay ? row.peak_cents : row.offpeak_cents;
    return {
      cents: row.fee_cents,
      peak: row.fee_cents > baseline,
      reason: row.label,
      lateCents,
    };
  }
  if (peakDay) {
    return { cents: row.peak_cents, peak: true, reason: 'weekend', lateCents };
  }
  return { cents: row.offpeak_cents, peak: false, reason: null, lateCents };
}

/**
 * Price a specific booking.
 *
 * One seat is charged per 2-hour block, rounded up: a 4-hour booking is two
 * blocks, and an odd 2.5 hours still pays for two. Late seatings — starts after
 * 01:00, which run to the 03:00 close and so cannot fill a block — pay the flat
 * late rate once. That per-seat figure is then multiplied by the party, floored
 * at the table's minimum seats.
 *
 * Derived entirely from the date, start, length and headcount the customer
 * chose, with the headcount already checked against the table. Nothing about
 * the price comes from the request, so a tampered client cannot buy six hours
 * for the price of two, or seat six people on one seat's fee.
 */
export async function quoteBooking(
  date: string,
  timeSlot: string,
  durationMin: number,
  seats = 1,
): Promise<BookingQuote> {
  const fee = await getTableFee(date);
  const billed = Math.max(1, seats);
  if (isLateStart(timeSlot)) {
    return {
      ...fee,
      perSeatCents: fee.lateCents,
      seats: billed,
      totalCents: fee.lateCents * billed,
      blocks: 0,
      late: true,
    };
  }
  const blocks = Math.max(1, Math.ceil(durationMin / SESSION_MIN));
  const perSeatCents = fee.cents * blocks;
  return {
    ...fee,
    perSeatCents,
    seats: billed,
    totalCents: perSeatCents * billed,
    blocks,
    late: false,
  };
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
    `UPDATE pricing_rates
        SET peak_cents = $1, offpeak_cents = $2,
            late_peak_cents = $3, late_offpeak_cents = $4, updated_at = now()
      WHERE id`,
    [r.peakCents, r.offPeakCents, r.latePeakCents, r.lateOffPeakCents],
  );
}
