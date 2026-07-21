import bcrypt from 'bcryptjs';
import { query } from '../../db/pool';
import { ApiError } from '../../middleware/error';
import { StaffClaims } from '../../middleware/auth';

export async function authenticateStaff(
  email: string,
  password: string
): Promise<StaffClaims> {
  const { rows } = await query<{
    id: number;
    email: string;
    name: string;
    password_hash: string;
  }>('SELECT id, email, name, password_hash FROM staff_users WHERE email = $1', [
    email.toLowerCase(),
  ]);

  const user = rows[0];
  // Compare even when the user is missing to keep timing roughly constant and
  // return one generic message so we don't reveal which emails exist.
  const hash = user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) throw new ApiError(401, 'Invalid email or password.');

  return { sub: user.id, email: user.email, name: user.name };
}

export interface TodayBooking {
  id: number;
  verificationCode: string;
  timeSlot: string;
  guestName: string;
  tableLabel: string;
  gameTitle: string | null;
  status: string;
  totalCents: number;
  items: { name: string; quantity: number }[];
}

export async function getBookingsForDate(date: string): Promise<TodayBooking[]> {
  const { rows } = await query<{
    id: number;
    verification_code: string;
    time_slot: string;
    guest_name: string;
    table_label: string;
    game_title: string | null;
    status: string;
    total_cents: number;
  }>(
    `SELECT b.id, b.verification_code, b.time_slot, b.guest_name,
            t.label AS table_label, g.title AS game_title, b.status, b.total_cents
       FROM bookings b
       JOIN tables t ON t.id = b.table_id
       LEFT JOIN games g ON g.id = b.game_id
      WHERE b.booking_date = $1
        AND b.status <> 'cancelled'
      ORDER BY b.time_slot, t.label`,
    [date]
  );

  if (rows.length === 0) return [];

  // Pull all items for these bookings in one query, then group in memory.
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
    tableLabel: r.table_label,
    gameTitle: r.game_title,
    status: r.status,
    totalCents: r.total_cents,
    items: itemsByBooking.get(r.id) ?? [],
  }));
}

/** Mark a confirmed booking as arrived (check-in). Returns the new status. */
export async function checkInByCode(code: string): Promise<TodayBooking> {
  const { rows } = await query<{ id: number; status: string; booking_date: string }>(
    `SELECT id, status, to_char(booking_date,'YYYY-MM-DD') AS booking_date
       FROM bookings WHERE verification_code = $1`,
    [code.toUpperCase()]
  );
  const booking = rows[0];
  if (!booking) throw new ApiError(404, 'No booking matches that code.');
  if (booking.status === 'cancelled') throw new ApiError(409, 'That booking was cancelled.');
  if (booking.status === 'arrived') throw new ApiError(409, 'Already checked in.');

  await query(`UPDATE bookings SET status = 'arrived' WHERE id = $1`, [booking.id]);

  const dayBookings = await getBookingsForDate(booking.booking_date);
  const updated = dayBookings.find((b) => b.id === booking.id);
  if (!updated) throw new ApiError(500, 'Booking not found after check-in.');
  return updated;
}
