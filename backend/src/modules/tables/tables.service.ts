import { query } from '../../db/pool';
import {
  START_TIMES,
  allowedDurations,
  maxDurationFor,
  minDurationFor,
  overlaps,
  toMinutes,
} from '../../utils/slots';
import { getTableFee, TableFee } from '../../utils/pricing';

export interface TableRow {
  id: number;
  label: string;
  capacity: number;
}

export async function getTables(): Promise<TableRow[]> {
  const { rows } = await query<TableRow>(
    'SELECT id, label, capacity FROM tables WHERE is_active ORDER BY capacity, id'
  );
  return rows;
}

export interface TableAvailability {
  tableId: number;
  label: string;
  capacity: number;
  freeSlots: string[];
  takenSlots: string[];
  /**
   * Start time -> the longest booking that still fits there, in minutes. The
   * form uses this to bound its end-time picker, so a customer is never offered
   * a length that would collide with the next booking on that table.
   */
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
 */
export async function getAvailability(
  date: string,
): Promise<{ tables: TableAvailability[]; fee: TableFee }> {
  const tables = await getTables();
  // Returned with availability so the booking form always shows the price for
  // the date being viewed, rather than a figure baked into the build.
  const fee = await getTableFee(date);

  const { rows: booked } = await query<{
    table_id: number;
    time_slot: string;
    duration_min: number;
  }>(
    `SELECT table_id, time_slot, duration_min
       FROM bookings
      WHERE booking_date = $1
        AND status <> 'cancelled'`,
    [date]
  );

  const byTable = new Map<number, { start: string; duration: number }[]>();
  for (const b of booked) {
    if (!byTable.has(b.table_id)) byTable.set(b.table_id, []);
    byTable.get(b.table_id)!.push({ start: b.time_slot, duration: b.duration_min });
  }

  const mapped = tables.map((t) => {
    const existing = byTable.get(t.id) ?? [];
    const freeSlots: string[] = [];
    const takenSlots: string[] = [];
    const maxDuration: Record<string, number> = {};

    for (const s of START_TIMES) {
      const shortest = minDurationFor(s);
      if (existing.some((b) => overlaps(s, shortest, b.start, b.duration))) {
        takenSlots.push(s);
        continue;
      }
      // Room runs out at whichever comes first: closing, the six-hour ceiling,
      // or the next booking on this table.
      const sMin = toMinutes(s);
      const nextStart = existing
        .map((b) => toMinutes(b.start))
        .filter((m) => m >= sMin)
        .reduce((lo, m) => Math.min(lo, m), Number.POSITIVE_INFINITY);
      const room = Math.min(maxDurationFor(s), nextStart - sMin);
      // Report the longest length actually on offer, not the raw gap: sittings
      // are sold in whole blocks, so a 5-hour gap still only sells 4 hours.
      const fits = allowedDurations(s).filter((d) => d <= room);
      freeSlots.push(s);
      maxDuration[s] = fits.length ? fits[fits.length - 1] : shortest;
    }

    return {
      tableId: t.id,
      label: t.label,
      capacity: t.capacity,
      freeSlots,
      takenSlots,
      maxDuration,
    };
  });
  return { tables: mapped, fee };
}
