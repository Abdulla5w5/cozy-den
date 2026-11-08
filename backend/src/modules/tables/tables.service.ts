import { query } from '../../db/pool';
import {
  START_TIMES,
  allowedDurations,
  maxDurationFor,
  minDurationFor,
  overlaps,
  toMinutes,
  slotHasStarted,
  currentSlot,
} from '../../utils/slots';
import { getTableFee, TableFee } from '../../utils/pricing';
import { isShareable } from '../../utils/share';

export interface TableRow {
  id: number;
  label: string;
  capacity: number;
  min_party: number | null;
}

export async function getTables(): Promise<TableRow[]> {
  const { rows } = await query<TableRow>(
    'SELECT id, label, capacity, min_party FROM tables WHERE is_active ORDER BY capacity, id'
  );
  return rows;
}

export interface TableAvailability {
  tableId: number;
  label: string;
  capacity: number;
  /** This table's own minimum party, or null for the size-based one. */
  minParty: number | null;
  freeSlots: string[];
  takenSlots: string[];
  /**
   * Starts that have already passed. Reported separately rather than folded
   * into takenSlots, so the form can hide them instead of labelling a time
   * that is simply over as "taken".
   */
  pastSlots: string[];
  /**
   * The half hour running now, when this table is free for a sitting from it.
   * Only staff may book it, for a walk-in; customers are offered freeSlots.
   */
  walkInSlot: string | null;
  /**
   * Start time -> the longest booking that still fits there, in minutes. The
   * form uses this to bound its end-time picker, so a customer is never offered
   * a length that would collide with the next booking on that table.
   */
  maxDuration: Record<string, number>;
  /**
   * On a table of 6+ seats: booking half of it, to share with another small
   * group. A start is open if either half is free; `otherHalfBooked` lists the
   * open starts where the other half is already taken, which customers are told.
   */
  share?: PartSlots & { otherHalfBooked: string[] };
  /** Each half on its own, for staff moving a booking onto a particular half. */
  halves?: (PartSlots & { half: 1 | 2 })[];
}

export interface PartSlots {
  freeSlots: string[];
  takenSlots: string[];
  walkInSlot: string | null;
  maxDuration: Record<string, number>;
}

/**
 * For a given date, compute which 30-minute start times each table still has
 * open, and how long a booking may run from each.
 *
 * A start is free iff the *shortest* booking allowed there — two hours, or the
 * remainder to closing for a late seating — clears every live booking on that
 * table. Anything longer is offered only up to the next booking's start, so
 * back-to-back sessions still work while overlaps cannot be selected.
 *
 * For staff changing a booking: `exceptBookingId` leaves that booking out, so it
 * does not block itself, and `keepSlot` is its own start, which stays in
 * maxDuration even once it has passed, so it can move table mid-session.
 */
export async function getAvailability(
  date: string,
  {
    exceptBookingId,
    keepSlot,
    alsoTableId,
    withHalves = false,
  }: { exceptBookingId?: number; keepSlot?: string; alsoTableId?: number; withHalves?: boolean } = {},
): Promise<{ tables: TableAvailability[]; fee: TableFee }> {
  const tables = await getTables();
  // A booking on a table since retired can still be edited where it stands.
  if (alsoTableId !== undefined && !tables.some((t) => t.id === alsoTableId)) {
    const { rows } = await query<TableRow>(
      'SELECT id, label, capacity, min_party FROM tables WHERE id = $1',
      [alsoTableId],
    );
    tables.push(...rows);
  }
  // Returned with availability so the booking form always shows the price for
  // the date being viewed, rather than a figure baked into the build.
  const fee = await getTableFee(date);

  const { rows: booked } = await query<{
    table_id: number;
    time_slot: string;
    duration_min: number;
    half: 1 | 2 | null;
  }>(
    `SELECT table_id, time_slot, duration_min, half
       FROM bookings
      WHERE booking_date = $1
        AND status NOT IN ('cancelled', 'order_complete')
        AND id IS DISTINCT FROM $2`,
    [date, exceptBookingId ?? null]
  );

  // One clock reading for the whole response, so every table agrees on what
  // "now" is even if building the list straddles a slot boundary.
  const now = Date.now();
  const running = currentSlot(date, now);

  type Held = { start: string; duration: number; half: 1 | 2 | null };
  const byTable = new Map<number, Held[]>();
  for (const b of booked) {
    if (!byTable.has(b.table_id)) byTable.set(b.table_id, []);
    byTable.get(b.table_id)!.push({ start: b.time_slot, duration: b.duration_min, half: b.half });
  }

  const pastSlots = START_TIMES.filter((s) => slotHasStarted(date, s, now));

  /** The starts open for one part of a table, given the bookings that block it. */
  const slotsFor = (existing: Held[]): PartSlots => {
    const freeSlots: string[] = [];
    const takenSlots: string[] = [];
    const maxDuration: Record<string, number> = {};
    let walkInSlot: string | null = null;
    for (const s of START_TIMES) {
      const started = pastSlots.includes(s);
      if (started && s !== running && s !== keepSlot) continue;
      const shortest = minDurationFor(s);
      if (existing.some((b) => overlaps(s, shortest, b.start, b.duration))) {
        if (!started) takenSlots.push(s);
        continue;
      }
      // Room runs out at whichever comes first: closing, the six-hour ceiling,
      // or the next booking on this part of the table.
      const sMin = toMinutes(s);
      const nextStart = existing
        .map((b) => toMinutes(b.start))
        .filter((m) => m >= sMin)
        .reduce((lo, m) => Math.min(lo, m), Number.POSITIVE_INFINITY);
      const room = Math.min(maxDurationFor(s), nextStart - sMin);
      // Report the longest length actually on offer, not the raw gap: sittings
      // come in fixed lengths, so a 5.5-hour gap still only sells 5 hours.
      const fits = allowedDurations(s).filter((d) => d <= room);
      if (!started) freeSlots.push(s);
      else if (s === running) walkInSlot = s;
      maxDuration[s] = fits.length ? fits[fits.length - 1] : shortest;
    }
    return { freeSlots, takenSlots, walkInSlot, maxDuration };
  };

  const mapped = tables.map((t) => {
    const existing = byTable.get(t.id) ?? [];
    // The whole table is blocked by anything on it, either half included.
    const whole = slotsFor(existing);
    const row: TableAvailability = {
      tableId: t.id,
      label: t.label,
      capacity: t.capacity,
      minParty: t.min_party,
      ...whole,
      pastSlots,
    };
    if (isShareable(t.capacity)) {
      // A half is blocked by a whole-table booking or one on the same half.
      const halves = ([1, 2] as const).map((half) => ({
        half,
        ...slotsFor(existing.filter((b) => b.half === null || b.half === half)),
      }));
      const open = (s: string) => halves.filter((h) => h.maxDuration[s] !== undefined);
      const freeSlots = START_TIMES.filter((s) => halves.some((h) => h.freeSlots.includes(s)));
      const maxDuration: Record<string, number> = {};
      for (const s of START_TIMES) {
        const free = open(s);
        if (free.length) maxDuration[s] = Math.max(...free.map((h) => h.maxDuration[s]));
      }
      // Which half is booked when is staff detail: customers get only `share`.
      if (withHalves) row.halves = halves;
      row.share = {
        freeSlots,
        takenSlots: START_TIMES.filter((s) => !pastSlots.includes(s) && !freeSlots.includes(s)),
        walkInSlot: halves.find((h) => h.walkInSlot)?.walkInSlot ?? null,
        maxDuration,
        otherHalfBooked: freeSlots.filter((s) => halves.filter((h) => h.freeSlots.includes(s)).length === 1),
      };
    }
    return row;
  });
  return { tables: mapped, fee };
}
