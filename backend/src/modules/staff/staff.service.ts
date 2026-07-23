import { query } from '../../db/pool';
import { ApiError } from '../../middleware/error';

export interface TodayBooking {
  id: number;
  verificationCode: string;
  timeSlot: string;
  guestName: string;
  guestContact: string;
  tableLabel: string;
  status: string;
  source: string;
  totalCents: number;
  items: { name: string; quantity: number }[];
}

export async function getBookingsForDate(date: string): Promise<TodayBooking[]> {
  const { rows } = await query<{
    id: number;
    verification_code: string;
    time_slot: string;
    guest_name: string;
    guest_email: string;
    table_label: string;
    status: string;
    source: string;
    total_cents: number;
  }>(
    `SELECT b.id, b.verification_code, b.time_slot, b.guest_name, b.guest_email,
            t.label AS table_label, b.status, b.source, b.total_cents
       FROM bookings b
       JOIN tables t ON t.id = b.table_id
      WHERE b.booking_date = $1
        AND b.status <> 'cancelled'
      ORDER BY b.time_slot, t.label`,
    [date]
  );

  if (rows.length === 0) return [];

  // Legacy line items (pre-overhaul bookings) in one query, grouped in memory.
  const ids = rows.map((r) => r.id);
  const { rows: itemRows } = await query<{
    booking_id: number;
    name: string;
    quantity: number;
  }>(
    `SELECT bi.booking_id, m.name, bi.quantity
       FROM booking_items bi
       JOIN menu_items m ON m.id = bi.menu_item_id
      WHERE bi.booking_id = ANY($1::int[])
      ORDER BY m.name`,
    [ids]
  );
  const itemsByBooking = new Map<number, { name: string; quantity: number }[]>();
  for (const it of itemRows) {
    if (!itemsByBooking.has(it.booking_id)) itemsByBooking.set(it.booking_id, []);
    itemsByBooking.get(it.booking_id)!.push({ name: it.name, quantity: it.quantity });
  }

  return rows.map((r) => ({
    id: r.id,
    verificationCode: r.verification_code,
    timeSlot: r.time_slot,
    guestName: r.guest_name,
    guestContact: r.guest_email,
    tableLabel: r.table_label,
    status: r.status,
    source: r.source,
    totalCents: r.total_cents,
    items: itemsByBooking.get(r.id) ?? [],
  }));
}

/**
 * Status workflow: pending -> (staff confirms on arrival) -> print_receipt
 * (auto-advanced, system-driven) -> (staff clicks after printing) ->
 * order_complete. The 'confirmed' state is transient by design: confirming
 * lands directly on 'print_receipt' so the dashboard can surface outstanding
 * receipts at a glance.
 */
async function transition(
  where: { id?: number; code?: string },
  from: string,
  to: string,
  fromLabel: string
): Promise<number> {
  const byId = where.id != null;
  const { rows } = await query<{ id: number; status: string }>(
    `SELECT id, status FROM bookings WHERE ${byId ? 'id = $1' : 'verification_code = $1'}`,
    [byId ? where.id : where.code!.toUpperCase()]
  );
  const booking = rows[0];
  if (!booking) throw new ApiError(404, 'No booking matches.');
  if (booking.status !== from) {
    throw new ApiError(409, `Booking is '${booking.status}', expected '${fromLabel}'.`);
  }
  await query(`UPDATE bookings SET status = $1 WHERE id = $2`, [to, booking.id]);
  return booking.id;
}

/** Staff confirms arrival — auto-advances straight to 'print_receipt'. */
export async function confirmBooking(where: { id?: number; code?: string }): Promise<number> {
  return transition(where, 'pending', 'print_receipt', 'pending');
}

/** Staff clicks after physically printing the receipt. */
export async function markPrinted(id: number): Promise<number> {
  return transition({ id }, 'print_receipt', 'order_complete', 'print_receipt');
}
