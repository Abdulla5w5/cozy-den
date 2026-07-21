import { query } from '../../db/pool';
import { TIME_SLOTS, TimeSlot } from '../../utils/slots';

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
  freeSlots: TimeSlot[];
  takenSlots: TimeSlot[];
}

/**
 * For a given date, compute which of the fixed slots each table still has open.
 * A slot is "taken" if a non-cancelled booking exists for that table+date+slot.
 */
export async function getAvailability(date: string): Promise<TableAvailability[]> {
  const tables = await getTables();

  const { rows: booked } = await query<{ table_id: number; time_slot: TimeSlot }>(
    `SELECT table_id, time_slot
       FROM bookings
      WHERE booking_date = $1
        AND status <> 'cancelled'`,
    [date]
  );

  const takenByTable = new Map<number, Set<string>>();
  for (const b of booked) {
    if (!takenByTable.has(b.table_id)) takenByTable.set(b.table_id, new Set());
    takenByTable.get(b.table_id)!.add(b.time_slot);
  }

  return tables.map((t) => {
    const taken = takenByTable.get(t.id) ?? new Set<string>();
    return {
      tableId: t.id,
      label: t.label,
      capacity: t.capacity,
      freeSlots: TIME_SLOTS.filter((s) => !taken.has(s)),
      takenSlots: TIME_SLOTS.filter((s) => taken.has(s)),
    };
  });
}
