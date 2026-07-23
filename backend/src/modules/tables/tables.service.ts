import { query } from '../../db/pool';
import { START_TIMES, overlaps } from '../../utils/slots';

export interface TableRow {
  id: number;
  label: string;
  capacity: number;
}

export async function getTables(): Promise<TableRow[]> {
  const { rows } = await query<TableRow>(
    'SELECT id, label, capacity FROM tables ORDER BY capacity, id'
  );
  return rows;
}

export interface TableAvailability {
  tableId: number;
  label: string;
  capacity: number;
  freeSlots: string[];
  takenSlots: string[];
}

/**
 * For a given date, compute which 30-minute start times each table still has
 * open. A start is free iff its 2-hour window overlaps no live booking's
 * 2-hour window on that table (back-to-back sessions are fine).
 */
export async function getAvailability(date: string): Promise<TableAvailability[]> {
  const tables = await getTables();

  const { rows: booked } = await query<{ table_id: number; time_slot: string }>(
    `SELECT table_id, time_slot
       FROM bookings
      WHERE booking_date = $1
        AND status <> 'cancelled'`,
    [date]
  );

  const startsByTable = new Map<number, string[]>();
  for (const b of booked) {
    if (!startsByTable.has(b.table_id)) startsByTable.set(b.table_id, []);
    startsByTable.get(b.table_id)!.push(b.time_slot);
  }

  return tables.map((t) => {
    const existing = startsByTable.get(t.id) ?? [];
    const blocked = (s: string) => existing.some((b) => overlaps(s, b));
    return {
      tableId: t.id,
      label: t.label,
      capacity: t.capacity,
      freeSlots: START_TIMES.filter((s) => !blocked(s)),
      takenSlots: START_TIMES.filter(blocked),
    };
  });
}
