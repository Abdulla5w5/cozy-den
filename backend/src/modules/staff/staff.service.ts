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
  durationMin: number;
  partySize: number;
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
    duration_min: number;
    party_size: number;
  }>(
    `SELECT b.id, b.verification_code, b.time_slot, b.guest_name, b.guest_email,
            t.label AS table_label, b.status, b.source, b.total_cents,
            b.duration_min, b.party_size
       FROM bookings b
       JOIN tables t ON t.id = b.table_id
      WHERE b.booking_date = $1
        AND b.status <> 'cancelled'
        -- Event table holds live in this table so the exclusion constraint can
        -- police them, but they are not customers: nobody arrives, pays or
        -- needs a receipt. Listing them gave staff rows to "confirm" and print.
        AND b.source <> 'event'
      ORDER BY CASE WHEN b.time_slot::time < TIME '03:00' THEN 1 ELSE 0 END,
               b.time_slot,
               t.label`,
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
    durationMin: r.duration_min,
    partySize: r.party_size,
    items: itemsByBooking.get(r.id) ?? [],
  }));
}

/**
 * Status workflow: pending -> (staff confirms the guest arrived) -> arrived ->
 * (staff marks the session finished) -> order_complete.
 *
 * Printing a receipt is deliberately absent from this. It used to be a stage —
 * the order could not complete until someone printed, and the browser's
 * `afterprint` event advanced it — which meant cancelling the print dialog
 * finished the order and nothing could ever be reprinted. Printing is now a
 * capability available on any confirmed, paid booking and changes no state.
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

/** Staff confirms the guest turned up. */
export async function confirmBooking(where: { id?: number; code?: string }): Promise<number> {
  return transition(where, 'pending', 'arrived', 'pending');
}

/** Staff marks the session finished. */
export async function completeBooking(id: number): Promise<number> {
  return transition({ id }, 'arrived', 'order_complete', 'arrived');
}
