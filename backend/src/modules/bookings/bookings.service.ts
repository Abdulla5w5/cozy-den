import { query } from '../../db/pool';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';
import { generateVerificationCode } from '../../utils/code';
import { paymentProvider } from '../../payment';
import { mailer, formatReceiptEmail } from '../../notifications/mailer';
import { CreateBookingInput, StaffCreateBookingInput } from './bookings.schema';

// Legacy line items are still surfaced for pre-overhaul bookings; new bookings
// have none (menu ordering was removed from checkout).
export interface BookingItemView {
  menuItemId: number;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface BookingView {
  id: number;
  tableId: number;
  tableLabel: string;
  date: string;
  timeSlot: string;
  guestName: string;
  guestEmail: string;
  verificationCode: string;
  status: string;
  source: string;
  tableFeeCents: number;
  totalCents: number;
  items: BookingItemView[];
  createdAt: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function assertTableExists(tableId: number): Promise<void> {
  const { rows } = await query<{ id: number }>('SELECT id FROM tables WHERE id = $1', [tableId]);
  if (!rows[0]) throw new ApiError(404, 'Table not found.');
}

interface InsertParams {
  tableId: number;
  date: string;
  timeSlot: string;
  guestName: string;
  guestEmail: string;
  status: 'pending_payment' | 'pending';
  source: 'online' | 'staff_manual';
  feeCents: number;
  totalCents: number;
}

/**
 * Insert a booking row. The bookings_no_overlap exclusion constraint makes the
 * 2-hour-window reservation atomic — a concurrent overlapping insert loses with
 * SQLSTATE 23P01, which we surface as a 409. Retries only cover the
 * astronomically-rare verification-code collision (23505).
 */
async function insertBooking(p: InsertParams): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateVerificationCode();
    try {
      const { rows } = await query<{ id: number }>(
        `INSERT INTO bookings
           (table_id, booking_date, time_slot, guest_name, guest_email,
            verification_code, status, source, table_fee_cents, items_total_cents, total_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10)
         RETURNING id`,
        [p.tableId, p.date, p.timeSlot, p.guestName, p.guestEmail, code, p.status, p.source, p.feeCents, p.totalCents]
      );
      return rows[0].id;
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code === '23P01' && e.constraint === 'bookings_no_overlap') {
        throw new ApiError(409, 'That table is already booked for an overlapping 2-hour session.');
      }
      if (e.code === '23505') continue; // verification_code collision — retry
      throw err;
    }
  }
  throw new ApiError(500, 'Could not allocate a unique verification code.');
}

/**
 * Guest checkout: table only. Flow (never charge without a reserved window,
 * never strand a charge):
 *   1. Reserve the 2h window with a 'pending_payment' row (atomic via the
 *      exclusion constraint).
 *   2. Charge the flat table-holding fee via the configured provider.
 *   3. Success -> 'pending' (awaiting arrival); decline -> 'cancelled' (frees
 *      the window) and 402.
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingView> {
  if (input.date < todayIso()) throw new ApiError(400, 'Cannot book a date in the past.');
  await assertTableExists(input.tableId);

  const feeCents = env.tableFeeCents;
  const bookingId = await insertBooking({
    tableId: input.tableId,
    date: input.date,
    timeSlot: input.timeSlot,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    status: 'pending_payment',
    source: 'online',
    feeCents,
    totalCents: feeCents,
  });

  const charge = await paymentProvider.charge({
    amountCents: feeCents,
    currency: 'KWD',
    paymentToken: input.paymentToken,
    description: `Cozy Den table-holding fee, booking #${bookingId}`,
    metadata: { bookingId: String(bookingId) },
  });

  if (!charge.success) {
    await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    throw new ApiError(402, charge.declineReason || 'Payment was declined.');
  }

  await query(`UPDATE bookings SET status = 'pending', payment_ref = $1 WHERE id = $2`, [
    charge.reference,
    bookingId,
  ]);

  const view = await getBookingById(bookingId);
  if (!view) throw new ApiError(500, 'Booking vanished after creation.');

  // Fire-and-forget receipt email (stubbed); a mail failure must not fail a
  // paid booking.
  const email = formatReceiptEmail(view);
  mailer
    .send({ to: view.guestEmail, subject: email.subject, text: email.text })
    .catch((e) => console.error('[mailer] failed to send receipt', e));

  return view;
}

/**
 * Staff manual entry for phone/WhatsApp bookings: no payment step, created
 * directly as 'pending' with source 'staff_manual'. Contact may be a phone
 * number or email — no receipt email is attempted.
 */
export async function createStaffBooking(input: StaffCreateBookingInput): Promise<BookingView> {
  if (input.date < todayIso()) throw new ApiError(400, 'Cannot book a date in the past.');
  await assertTableExists(input.tableId);

  const bookingId = await insertBooking({
    tableId: input.tableId,
    date: input.date,
    timeSlot: input.timeSlot,
    guestName: input.guestName,
    guestEmail: input.contact,
    status: 'pending',
    source: 'staff_manual',
    feeCents: 0,
    totalCents: 0,
  });

  const view = await getBookingById(bookingId);
  if (!view) throw new ApiError(500, 'Booking vanished after creation.');
  return view;
}

const BOOKING_SELECT = `
  SELECT b.id, b.table_id, t.label AS table_label,
         to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
         b.time_slot, b.guest_name, b.guest_email, b.verification_code, b.status,
         b.source, b.table_fee_cents, b.total_cents, b.created_at
    FROM bookings b
    JOIN tables t ON t.id = b.table_id`;

interface BookingRow {
  id: number;
  table_id: number;
  table_label: string;
  booking_date: string;
  time_slot: string;
  guest_name: string;
  guest_email: string;
  verification_code: string;
  status: string;
  source: string;
  table_fee_cents: number;
  total_cents: number;
  created_at: Date;
}

async function hydrate(row: BookingRow): Promise<BookingView> {
  const { rows: itemRows } = await query<{
    menu_item_id: number;
    name: string;
    quantity: number;
    unit_price_cents: number;
  }>(
    `SELECT bi.menu_item_id, m.name, bi.quantity, bi.unit_price_cents
       FROM booking_items bi
       JOIN menu_items m ON m.id = bi.menu_item_id
      WHERE bi.booking_id = $1
      ORDER BY m.name`,
    [row.id]
  );

  return {
    id: row.id,
    tableId: row.table_id,
    tableLabel: row.table_label,
    date: row.booking_date,
    timeSlot: row.time_slot,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    verificationCode: row.verification_code,
    status: row.status,
    source: row.source,
    tableFeeCents: row.table_fee_cents,
    totalCents: row.total_cents,
    items: itemRows.map((i) => ({
      menuItemId: i.menu_item_id,
      name: i.name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      lineTotalCents: i.unit_price_cents * i.quantity,
    })),
    createdAt: row.created_at.toISOString(),
  };
}

export async function getBookingById(id: number): Promise<BookingView | null> {
  const { rows } = await query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  return rows[0] ? hydrate(rows[0]) : null;
}

/** Public lookup by verification code (the code itself is the capability). */
export async function getBookingByCode(code: string): Promise<BookingView | null> {
  const { rows } = await query<BookingRow>(`${BOOKING_SELECT} WHERE b.verification_code = $1`, [
    code.toUpperCase(),
  ]);
  return rows[0] ? hydrate(rows[0]) : null;
}

/** All bookings made with a given email (a signed-in customer's history). */
export async function getBookingsByEmail(email: string): Promise<BookingView[]> {
  const { rows } = await query<BookingRow>(
    `${BOOKING_SELECT}
      WHERE lower(b.guest_email) = lower($1)
      ORDER BY b.booking_date DESC, b.time_slot DESC`,
    [email]
  );
  return Promise.all(rows.map(hydrate));
}
