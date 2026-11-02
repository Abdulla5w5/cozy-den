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
 * Exceptions to the 2-hour blocks: the odd hour of a 3- or 5-hour booking has
 * its own price (see extraHourCents), and six hours Sunday to Wednesday is a
 * flat per-seat price (5.900 KD, the café's list item 29) — see sixHourCents.
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
const SATURDAY = 6;

/**
 * A big table is not worth taking out of service for a pair, so each size takes
 * a minimum party — roughly half its seats. Kept here, next to the per-seat
 * rates, because it is the same idea from the other end: the floor is both the
 * smallest party allowed and the fewest seats ever charged.
 *
 * Read as a ladder, largest first, so an odd capacity still lands somewhere
 * sensible: a 7-seater takes 3 like a 6-seater, and a 5-seater takes 2 like a
 * 4-seater. Anything under four seats has no floor at all.
 */
const MIN_SEATS_LADDER: readonly (readonly [capacity: number, minSeats: number])[] = [
  [12, 5],
  [8, 4],
  [6, 3],
  [4, 2],
];

/** The most people one online booking may be for, whatever the table seats
 *  (the café's list, Oct 2026). Staff entering a booking by hand are not held
 *  to it: a bigger group arranged by phone still fits a 12-seat table. */
export const MAX_PARTY = 8;

/**
 * The smallest party this table accepts — and so the fewest seats it bills.
 * A table's own `min_party` (set by migration, e.g. the Floor Table's 2) wins
 * over the ladder.
 */
export function minSeatsFor(capacity: number, minParty?: number | null): number {
  return minParty ?? MIN_SEATS_LADDER.find(([seats]) => capacity >= seats)?.[1] ?? 1;
}

/** Seats a booking is billed for: what was asked, or the table's floor. */
export function billableSeats(capacity: number, partySize: number, minParty?: number | null): number {
  return Math.max(minSeatsFor(capacity, minParty), partySize);
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
  /** Flat per-seat price for exactly six hours, Sunday to Wednesday; null on
   *  other days, on a date staff have priced by hand, or when switched off. */
  sixHourCents: number | null;
  /** Per-seat price of the odd hour on a 3- or 5-hour booking; null on a date
   *  staff have priced by hand, or when switched off — half a block then. */
  extraHourCents: number | null;
}

/** What a specific booking costs, once its start and length are known. */
export interface BookingQuote extends TableFee {
  /** The amount actually charged: perSeatCents x seats. */
  totalCents: number;
  /** What one seat costs for this sitting, before multiplying by the party. */
  perSeatCents: number;
  /** Seats charged for — the party, or the table's minimum, whichever is more. */
  seats: number;
  /** 2-hour blocks charged (1.5 for three hours, 2.5 for five); 0 for a late seating, which
   *  is a flat rate. */
  blocks: number;
  late: boolean;
  /** Priced at the group rates, through a promo code. */
  group: boolean;
  /** Percentage taken off through a newcomer code; 0 when none. */
  percentOff: number;
}

/** A date's group prices (promo code, parties of six or more): the first two
 *  hours, each hour after, and a flat six-hour price where there is one. */
export interface GroupFee {
  cents: number;
  extraHourCents: number;
  sixHourCents: number | null;
}

/** Null until staff set them: a code changes nothing on that day. */
export interface GroupRates {
  offPeakCents: number | null;
  extraOffPeakCents: number | null;
  saturdayCents: number | null;
  extraSaturdayCents: number | null;
}

export interface Rates {
  peakCents: number;
  offPeakCents: number;
  latePeakCents: number;
  lateOffPeakCents: number;
  /** Null when there is no flat six-hour price. */
  sixHourOffPeakCents: number | null;
  /** The odd hour's price; null means half a block. */
  extraHourPeakCents: number | null;
  extraHourOffPeakCents: number | null;
}

const SIX_HOURS = 360;

/**
 * One seat's price for a sitting of this length: the 2-hour block rate for
 * each whole block, plus the extra-hour price for an odd hour (three hours is
 * a block and an hour, five is two blocks and an hour), except exactly six
 * hours where the day has a flat six-hour price. Without an extra-hour price
 * the odd hour is half a block. Shared by table bookings and Wanted Board
 * listings so the two never price the same hours apart.
 */
export function perSeatForLength(
  blockCents: number,
  sixHourCents: number | null,
  extraHourCents: number | null,
  durationMin: number,
): number {
  if (durationMin === SIX_HOURS && sixHourCents !== null) return sixHourCents;
  const minutes = Math.max(SESSION_MIN, durationMin);
  const blocks = Math.floor(minutes / SESSION_MIN);
  const oddMin = minutes - blocks * SESSION_MIN;
  const odd =
    oddMin === 0
      ? 0
      : extraHourCents !== null
        ? Math.round((extraHourCents * oddMin) / 60)
        : Math.round((blockCents * oddMin) / SESSION_MIN);
  return blockCents * blocks + odd;
}

/** A per-seat price with a percentage off, to the nearest 1/100 KD. */
export function discounted(cents: number, percentOff: number): number {
  return percentOff > 0 ? Math.round((cents * (100 - percentOff)) / 100) : cents;
}

/**
 * One seat at the group prices: the first two hours, then the extra-hour price
 * for each hour after (not 2-hour blocks), or the flat six-hour price.
 */
export function groupPerSeat(g: GroupFee, durationMin: number): number {
  if (durationMin === SIX_HOURS && g.sixHourCents !== null) return g.sixHourCents;
  const extraHours = Math.max(0, durationMin - SESSION_MIN) / 60;
  return Math.round(g.cents + g.extraHourCents * extraHours);
}

export async function getGroupRates(): Promise<GroupRates> {
  const { rows } = await query<{
    group_offpeak_cents: number | null;
    group_extra_offpeak_cents: number | null;
    group_saturday_cents: number | null;
    group_extra_saturday_cents: number | null;
  }>(
    `SELECT group_offpeak_cents, group_extra_offpeak_cents,
            group_saturday_cents, group_extra_saturday_cents
       FROM pricing_rates WHERE id`,
  );
  return {
    offPeakCents: rows[0].group_offpeak_cents,
    extraOffPeakCents: rows[0].group_extra_offpeak_cents,
    saturdayCents: rows[0].group_saturday_cents,
    extraSaturdayCents: rows[0].group_extra_saturday_cents,
  };
}

export async function setGroupRates(g: GroupRates): Promise<void> {
  await query(
    `UPDATE pricing_rates
        SET group_offpeak_cents = $1, group_extra_offpeak_cents = $2,
            group_saturday_cents = $3, group_extra_saturday_cents = $4,
            updated_at = now()
      WHERE id`,
    [g.offPeakCents, g.extraOffPeakCents, g.saturdayCents, g.extraSaturdayCents],
  );
}

/**
 * The group prices on a date, or null on a date staff have priced by hand —
 * a holiday's price wins over a code — or whose group prices are not set.
 * Thursday and Friday have no group price: they charge the normal weekend
 * price.
 */
export async function getGroupFee(date: string): Promise<GroupFee | null> {
  const { rows } = await query<{
    dow: number;
    overridden: boolean;
    six_hour_offpeak_cents: number | null;
    group_offpeak_cents: number | null;
    group_extra_offpeak_cents: number | null;
    group_saturday_cents: number | null;
    group_extra_saturday_cents: number | null;
  }>(
    `SELECT EXTRACT(DOW FROM $1::date)::int AS dow,
            o.override_date IS NOT NULL AS overridden,
            r.six_hour_offpeak_cents, r.group_offpeak_cents, r.group_extra_offpeak_cents,
            r.group_saturday_cents, r.group_extra_saturday_cents
       FROM pricing_rates r
       LEFT JOIN price_overrides o ON o.override_date = $1::date
      WHERE r.id`,
    [date],
  );
  const row = rows[0];
  if (row.overridden) return null;
  if (row.dow === SATURDAY) {
    if (row.group_saturday_cents === null || row.group_extra_saturday_cents === null) return null;
    return {
      cents: row.group_saturday_cents,
      extraHourCents: row.group_extra_saturday_cents,
      sixHourCents: null,
    };
  }
  // Thursday and Friday: the normal weekend price, so no group price at all.
  if (PEAK_DAYS.has(row.dow)) return null;
  if (row.group_offpeak_cents === null || row.group_extra_offpeak_cents === null) return null;
  return {
    cents: row.group_offpeak_cents,
    extraHourCents: row.group_extra_offpeak_cents,
    sixHourCents: row.six_hour_offpeak_cents,
  };
}

export async function getRates(): Promise<Rates> {
  const { rows } = await query<{
    peak_cents: number;
    offpeak_cents: number;
    late_peak_cents: number;
    late_offpeak_cents: number;
    six_hour_offpeak_cents: number | null;
    extra_hour_peak_cents: number | null;
    extra_hour_offpeak_cents: number | null;
  }>(
    `SELECT peak_cents, offpeak_cents, late_peak_cents, late_offpeak_cents,
            six_hour_offpeak_cents, extra_hour_peak_cents, extra_hour_offpeak_cents
       FROM pricing_rates WHERE id`,
  );
  return {
    peakCents: rows[0].peak_cents,
    offPeakCents: rows[0].offpeak_cents,
    latePeakCents: rows[0].late_peak_cents,
    lateOffPeakCents: rows[0].late_offpeak_cents,
    sixHourOffPeakCents: rows[0].six_hour_offpeak_cents,
    extraHourPeakCents: rows[0].extra_hour_peak_cents,
    extraHourOffPeakCents: rows[0].extra_hour_offpeak_cents,
  };
}

/**
 * One seat on a Wanted Board listing of this length, priced from its preferred
 * days rather than the day it happens to be viewed or reserved on. Peak only
 * if EVERY preferred day is a peak day; otherwise off-peak — the cheaper day
 * the customer could pick — which also takes the flat six-hour price, as a
 * Sunday-to-Wednesday table booking does. A listing carries no date, so date
 * overrides (holidays) do not apply.
 *
 * This is why a Monday listing stays off-peak even when reserved on a Saturday.
 */
export function listingPerSeat(preferredDays: number[], rates: Rates, durationMin: number): number {
  const peak = preferredDays.length > 0 && preferredDays.every((d) => PEAK_DAYS.has(d));
  return perSeatForLength(
    peak ? rates.peakCents : rates.offPeakCents,
    peak ? null : rates.sixHourOffPeakCents,
    peak ? rates.extraHourPeakCents : rates.extraHourOffPeakCents,
    durationMin,
  );
}

/**
 * One seat on a Wanted Board listing that has a session date: priced from
 * that date exactly as a table booking on it would be — a staff override for
 * the date (a holiday) wins, then the weekday's normal prices. Listings
 * without a date fall back to listingPerSeat's preferred-days rule.
 */
export function listingPerSeatOn(
  sessionDate: string | null,
  preferredDays: number[],
  rates: Rates,
  overrides: Map<string, number>,
  durationMin: number,
): number {
  if (!sessionDate) return listingPerSeat(preferredDays, rates, durationMin);
  const override = overrides.get(sessionDate);
  if (override !== undefined) return perSeatForLength(override, null, null, durationMin);
  const dow = new Date(`${sessionDate}T00:00:00Z`).getUTCDay();
  return PEAK_DAYS.has(dow)
    ? perSeatForLength(rates.peakCents, null, rates.extraHourPeakCents, durationMin)
    : perSeatForLength(
        rates.offPeakCents,
        rates.sixHourOffPeakCents,
        rates.extraHourOffPeakCents,
        durationMin,
      );
}

/** Upcoming date overrides as date -> per-seat block price (from yesterday on,
 *  so a service night past midnight UTC is still covered). */
export async function getOverrideMap(): Promise<Map<string, number>> {
  const { rows } = await query<{ d: string; fee_cents: number }>(
    `SELECT to_char(override_date, 'YYYY-MM-DD') AS d, fee_cents
       FROM price_overrides WHERE override_date >= current_date - 1`,
  );
  return new Map(rows.map((r) => [r.d, r.fee_cents]));
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
    six_hour_offpeak_cents: number | null;
    extra_hour_peak_cents: number | null;
    extra_hour_offpeak_cents: number | null;
  }>(
    `SELECT EXTRACT(DOW FROM $1::date)::int AS dow,
            o.label, o.fee_cents, r.peak_cents, r.offpeak_cents,
            r.late_peak_cents, r.late_offpeak_cents, r.six_hour_offpeak_cents,
            r.extra_hour_peak_cents, r.extra_hour_offpeak_cents
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
    // No flat six-hour or extra-hour price on a date staff have priced by
    // hand: they belong to the normal rates, and would undercut a holiday
    // upcharge. The odd hour is half the override's block instead.
    return {
      cents: row.fee_cents,
      peak: row.fee_cents > baseline,
      reason: row.label,
      lateCents,
      sixHourCents: null,
      extraHourCents: null,
    };
  }
  if (peakDay) {
    return {
      cents: row.peak_cents,
      peak: true,
      reason: 'weekend',
      lateCents,
      sixHourCents: null,
      extraHourCents: row.extra_hour_peak_cents,
    };
  }
  return {
    cents: row.offpeak_cents,
    peak: false,
    reason: null,
    lateCents,
    sixHourCents: row.six_hour_offpeak_cents,
    extraHourCents: row.extra_hour_offpeak_cents,
  };
}

/**
 * Price a specific booking.
 *
 * One seat is charged the block rate for every two hours: a 4-hour booking is
 * two blocks, and three and five hours — the lengths that are not whole
 * blocks — add the extra-hour price for the odd hour. Late seatings — starts after
 * 01:00, which run to the 03:00 close and so cannot fill a block — pay the flat
 * late rate once. That per-seat figure is then multiplied by the party, floored
 * at the table's minimum seats.
 *
 * A party with a group promo code (checked by the caller) pays the group
 * prices instead — see getGroupFee. Late seatings keep their flat rate.
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
  { group = false, percentOff = 0 }: { group?: boolean; percentOff?: number } = {},
): Promise<BookingQuote> {
  const fee = await getTableFee(date);
  const billed = Math.max(1, seats);
  if (isLateStart(timeSlot)) {
    const perSeatCents = discounted(fee.lateCents, percentOff);
    return {
      ...fee,
      perSeatCents,
      seats: billed,
      totalCents: perSeatCents * billed,
      blocks: 0,
      late: true,
      group: false,
      percentOff: perSeatCents < fee.lateCents ? percentOff : 0,
    };
  }
  const blocks = Math.max(1, durationMin / SESSION_MIN);
  const normal = perSeatForLength(fee.cents, fee.sixHourCents, fee.extraHourCents, durationMin);
  // A code never makes a booking dearer, whatever staff set the rates to.
  const groupFee = group ? await getGroupFee(date) : null;
  const grouped = groupFee ? Math.min(normal, groupPerSeat(groupFee, durationMin)) : normal;
  // Offers do not stack: the flat six-hour price takes no percentage off.
  const flatSixHours = durationMin === SIX_HOURS && fee.sixHourCents !== null;
  const perSeatCents = flatSixHours ? grouped : discounted(grouped, percentOff);
  return {
    ...fee,
    perSeatCents,
    seats: billed,
    totalCents: perSeatCents * billed,
    blocks,
    late: false,
    group: grouped < normal,
    percentOff: perSeatCents < grouped ? percentOff : 0,
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
            late_peak_cents = $3, late_offpeak_cents = $4,
            six_hour_offpeak_cents = $5,
            extra_hour_peak_cents = $6, extra_hour_offpeak_cents = $7,
            updated_at = now()
      WHERE id`,
    [
      r.peakCents,
      r.offPeakCents,
      r.latePeakCents,
      r.lateOffPeakCents,
      r.sixHourOffPeakCents,
      r.extraHourPeakCents,
      r.extraHourOffPeakCents,
    ],
  );
}
