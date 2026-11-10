import { query } from '../../db/pool';
import { ApiError } from '../../middleware/error';

export interface TodayBooking {
  id: number;
  verificationCode: string;
  timeSlot: string;
  guestName: string;
  guestContact: string;
  tableId: number;
  tableLabel: string;
  status: string;
  source: string;
  totalCents: number;
  durationMin: number;
  partySize: number;
  notes: string;
  counterCents: number;
  /** 1 or 2 for half of a shared table; null for the whole table. */
  half: 1 | 2 | null;
  items: { name: string; quantity: number }[];
}

/** Record what has been taken by hand for a booking, as a running total. */
export async function setCounterMoney(
  id: number,
  counterCents: number,
  expectedCents: number,
  staffId: number,
): Promise<void> {
  const { rowCount } = await query(
    `UPDATE bookings SET counter_cents = $2
      WHERE id = $1 AND counter_cents = $3 AND source <> 'event'
        AND status IN ('pending', 'arrived', 'order_complete')`,
    [id, counterCents, expectedCents],
  );
  if (rowCount) {
    console.log(`[counter-money] booking=${id} staff=${staffId} ${expectedCents}->${counterCents}`);
    return;
  }
  const { rows } = await query<{ counter_cents: number; status: string; source: string }>(
    'SELECT counter_cents, status, source FROM bookings WHERE id = $1',
    [id],
  );
  if (!rows[0]) throw new ApiError(404, 'No booking matches.');
  const { status, source } = rows[0];
  if (source === 'event' || !['pending', 'arrived', 'order_complete'].includes(status)) {
    throw new ApiError(409, 'Money cannot be recorded on this booking.');
  }
  throw new ApiError(409, 'Someone else just updated this amount. Check it and try again.');
}

/** Set a booking's staff notes; empty clears them. False if there is no such booking. */
export async function setBookingNotes(id: number, notes: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE bookings SET staff_notes = $2 WHERE id = $1 AND source <> 'event'`,
    [id, notes || null],
  );
  return (rowCount ?? 0) > 0;
}

export async function getBookingsForDate(date: string): Promise<TodayBooking[]> {
  const { rows } = await query<{
    id: number;
    verification_code: string;
    time_slot: string;
    guest_name: string;
    guest_email: string | null;
    guest_phone: string | null;
    table_id: number;
    table_label: string;
    status: string;
    source: string;
    total_cents: number;
    duration_min: number;
    party_size: number;
    staff_notes: string | null;
    counter_cents: number;
    half: 1 | 2 | null;
    host_fee_cents: number;
    host_name: string | null;
  }>(
    `SELECT b.id, b.verification_code, b.time_slot, b.guest_name, b.guest_email, b.guest_phone,
            b.table_id, t.label AS table_label, b.status, b.source, b.total_cents,
            b.duration_min, b.party_size, b.staff_notes, b.counter_cents, b.half, b.host_fee_cents, h.display_name AS host_name
       FROM bookings b
       JOIN tables t ON t.id = b.table_id
       LEFT JOIN hosts h ON h.user_id = b.host_id
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
    // The phone first: it is how the counter reaches a customer.
    guestContact: r.guest_phone ?? r.guest_email ?? '',
    tableId: r.table_id,
    tableLabel: r.table_label,
    status: r.status,
    source: r.source,
    totalCents: r.total_cents,
    durationMin: r.duration_min,
    partySize: r.party_size,
    notes: r.staff_notes ?? '',
    counterCents: r.counter_cents,
    half: r.half,
    hostName: r.host_name,
    hostFeeCents: r.host_fee_cents,
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
  // Guarded on the status just read: a Cancel landing between the two
  // statements must not be undone by a Confirm or Mark done.
  const { rowCount } = await query(
    `UPDATE bookings SET status = $1 WHERE id = $2 AND status = $3`,
    [to, booking.id, from],
  );
  if (!rowCount) {
    throw new ApiError(409, 'This booking was just changed by someone else. Refresh and try again.');
  }
  return booking.id;
}

/** Staff confirms the guest turned up. */
export async function confirmBooking(where: { id?: number; code?: string }): Promise<number> {
  return transition(where, 'pending', 'arrived', 'pending');
}

/**
 * Staff cancels a booking that is waiting for its guests or already seated.
 * The table (and any host) frees straight away. Nothing is refunded and no
 * one is emailed: staff refund in Tap or by hand, and tell the customer.
 * One conditional UPDATE, so two staff pressing at once cancel it once.
 */
export async function cancelBooking(id: number, staffId: number): Promise<void> {
  const { rows } = await query<{ status: string; total_cents: number; counter_cents: number }>(
    `UPDATE bookings
        SET status = 'cancelled', staff_cancelled_at = now(), staff_cancelled_by = $2
      WHERE id = $1 AND status IN ('pending', 'arrived') AND source <> 'event'
      RETURNING status, total_cents, counter_cents`,
    [id, staffId],
  );
  if (rows[0]) {
    console.log(
      `[staff] booking ${id} cancelled by user ${staffId} ` +
        `(paid online ${rows[0].total_cents}, by hand ${rows[0].counter_cents})`,
    );
    return;
  }
  const { rows: now } = await query<{ status: string; source: string }>(
    'SELECT status, source FROM bookings WHERE id = $1',
    [id],
  );
  if (!now[0]) throw new ApiError(404, 'No such booking.');
  if (now[0].source === 'event') {
    throw new ApiError(409, 'This is an event hold. Change it from the Events tab.');
  }
  if (now[0].status === 'cancelled') throw new ApiError(409, 'This booking is already cancelled.');
  if (now[0].status === 'order_complete') {
    throw new ApiError(409, 'This booking is already done, so it cannot be cancelled.');
  }
  throw new ApiError(409, 'This booking is still being paid for, so it cannot be cancelled yet.');
}

/** Staff marks the session finished. */
export async function completeBooking(id: number): Promise<number> {
  // Done frees the table, and cannot be undone: never for a day still to come.
  const { rows } = await query<{ upcoming: boolean }>(
    `SELECT to_char(booking_date, 'YYYY-MM-DD') > $2 AS upcoming FROM bookings WHERE id = $1`,
    [id, new Date().toISOString().slice(0, 10)],
  );
  if (rows[0]?.upcoming) {
    throw new ApiError(409, 'This booking is on a later day, so it cannot be marked done yet.');
  }
  return transition({ id }, 'arrived', 'order_complete', 'arrived');
}
