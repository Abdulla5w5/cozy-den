import { query } from '../../db/pool';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';
import { generateVerificationCode } from '../../utils/code';
import { getTableFee } from '../../utils/pricing';
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

  const feeCents = (await getTableFee(input.date)).cents;
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
    paymentToken: input.paymentToken ?? '',
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
  sendReceipt(view);
  return view;
}

// Fire-and-forget receipt; a mail failure must never fail a paid booking.
function sendReceipt(view: BookingView) {
  const email = formatReceiptEmail(view);
  mailer
    .send({ to: view.guestEmail, subject: email.subject, text: email.text })
    .catch((e) => console.error('[mailer] failed to send receipt', e));
}

export interface CheckoutStart {
  /** Send the customer's browser here to pay. */
  redirectUrl: string;
  /** So the caller can build the eventual /confirmation/{code} link. */
  code: string;
}

/**
 * Redirect checkout (Tap). Reserve the window as 'pending_payment', open a
 * gateway charge, and hand back the hosted-payment URL. The booking is NOT
 * confirmed here — that happens in finalizeCharge() once the customer has paid
 * and we've verified it with the gateway.
 */
export async function startBookingCheckout(
  input: CreateBookingInput,
  base: { returnUrl: string; webhookUrl: string },
): Promise<CheckoutStart> {
  if (!paymentProvider.createCharge || !paymentProvider.retrieveCharge) {
    throw new ApiError(500, 'Configured payment provider does not support redirect checkout.');
  }
  if (input.date < todayIso()) throw new ApiError(400, 'Cannot book a date in the past.');
  await assertTableExists(input.tableId);

  const feeCents = (await getTableFee(input.date)).cents;
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

  const { rows } = await query<{ verification_code: string }>(
    'SELECT verification_code FROM bookings WHERE id = $1',
    [bookingId],
  );
  const code = rows[0].verification_code;

  try {
    const charge = await paymentProvider.createCharge({
      amountCents: feeCents,
      currency: 'KWD',
      description: `Cozy Den table-holding fee, booking #${bookingId}`,
      redirectUrl: base.returnUrl,
      webhookUrl: base.webhookUrl,
      customer: { name: input.guestName, email: input.guestEmail },
      metadata: { bookingId: String(bookingId), code },
    });
    // Store the gateway charge id so the return/webhook can find this booking.
    await query('UPDATE bookings SET payment_ref = $1 WHERE id = $2', [charge.chargeId, bookingId]);
    return { redirectUrl: charge.transactionUrl, code };
  } catch (err) {
    // Couldn't open a charge — free the window rather than stranding it.
    await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    throw err;
  }
}

/**
 * Confirm (or reject) a redirect charge by asking the gateway for the truth.
 * Idempotent and race-safe: the return redirect and the webhook may both fire,
 * but the conditional UPDATE only transitions the first time. Returns the
 * booking code so the return route can redirect to /confirmation/{code}.
 */
export async function finalizeCharge(
  chargeId: string,
): Promise<{ outcome: 'paid' | 'failed' | 'pending'; code: string | null }> {
  if (!paymentProvider.retrieveCharge) {
    throw new ApiError(500, 'Configured payment provider cannot retrieve charges.');
  }

  const { rows } = await query<{
    id: number;
    status: string;
    verification_code: string;
    total_cents: number;
  }>(
    'SELECT id, status, verification_code, total_cents FROM bookings WHERE payment_ref = $1',
    [chargeId],
  );
  const booking = rows[0];
  if (!booking) return { outcome: 'failed', code: null };

  // Already resolved by the other path — report the settled state, no re-work.
  if (booking.status === 'pending' || booking.status === 'order_complete') {
    return { outcome: 'paid', code: booking.verification_code };
  }
  if (booking.status === 'cancelled') {
    return { outcome: 'failed', code: booking.verification_code };
  }

  const status = await paymentProvider.retrieveCharge(chargeId);

  // A 'paid' status alone only says money moved — not that the RIGHT money
  // moved. Confirming a booking against a charge for some other amount or
  // currency would hand out a table for whatever the payer chose, so treat a
  // mismatch as unresolved: never confirm, never cancel (the money is real and
  // belongs to someone), and leave it for staff to look at.
  if (status.paid && status.amountCents !== undefined) {
    const wrongAmount = status.amountCents !== booking.total_cents;
    const wrongCurrency = (status.currency || '').toUpperCase() !== 'KWD';
    if (wrongAmount || wrongCurrency) {
      console.error(
        `[tap] charge ${chargeId} settled ${status.amountCents} ${status.currency} but ` +
          `booking ${booking.id} expects ${booking.total_cents} KWD — refusing to confirm`,
      );
      return { outcome: 'pending', code: booking.verification_code };
    }
  }

  if (status.paid) {
    // Only the first caller flips it; the WHERE guard makes this idempotent.
    const upd = await query(
      `UPDATE bookings SET status = 'pending'
        WHERE id = $1 AND status = 'pending_payment'
        RETURNING id`,
      [booking.id],
    );
    if (upd.rows.length > 0) {
      const view = await getBookingById(booking.id);
      if (view) sendReceipt(view);
    }
    return { outcome: 'paid', code: booking.verification_code };
  }

  if (status.failed) {
    await query(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'pending_payment'`,
      [booking.id],
    );
    return { outcome: 'failed', code: booking.verification_code };
  }

  // Still in flight (INITIATED / IN_PROGRESS) — leave it held.
  return { outcome: 'pending', code: booking.verification_code };
}

/**
 * Release a reservation whose payment never completed. The exclusion constraint
 * counts every non-cancelled row, so a 'pending_payment' row holds its 2-hour
 * window against everyone else — and an abandoned Tap charge sits at INITIATED
 * indefinitely, which finalizeCharge reads as "still in flight" and never
 * settles. Without this the window is held forever, for free, by anyone.
 *
 * Guarded on 'pending_payment' so it can never race a confirmation: if the
 * customer paid a moment earlier, the row is already 'pending' and this no-ops.
 */
export async function expireHold(bookingId: number): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE bookings SET status = 'cancelled'
      WHERE id = $1 AND status = 'pending_payment'`,
    [bookingId],
  );
  return (rowCount ?? 0) > 0;
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

/**
 * Line items for a set of bookings, in ONE query rather than one per booking.
 *
 * Menu ordering was removed from checkout, so every booking made since the
 * overhaul has none — but the read path still has to serve the legacy rows that
 * do. Fetching per booking meant a customer's history cost 1 + N round trips to
 * find nothing; batching makes it a flat 2. Mirrors what the staff day view
 * already does.
 */
async function loadItems(bookingIds: number[]): Promise<Map<number, BookingItemView[]>> {
  const byBooking = new Map<number, BookingItemView[]>();
  if (bookingIds.length === 0) return byBooking;

  const { rows } = await query<{
    booking_id: number;
    menu_item_id: number;
    name: string;
    quantity: number;
    unit_price_cents: number;
  }>(
    `SELECT bi.booking_id, bi.menu_item_id, m.name, bi.quantity, bi.unit_price_cents
       FROM booking_items bi
       JOIN menu_items m ON m.id = bi.menu_item_id
      WHERE bi.booking_id = ANY($1::int[])
      ORDER BY m.name`,
    [bookingIds]
  );

  for (const i of rows) {
    const list = byBooking.get(i.booking_id) ?? [];
    list.push({
      menuItemId: i.menu_item_id,
      name: i.name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      lineTotalCents: i.unit_price_cents * i.quantity,
    });
    byBooking.set(i.booking_id, list);
  }
  return byBooking;
}

function hydrate(row: BookingRow, items: BookingItemView[]): BookingView {
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
    items,
    createdAt: row.created_at.toISOString(),
  };
}

/** Fetch one booking row plus its items in two queries. */
async function hydrateOne(row: BookingRow | undefined): Promise<BookingView | null> {
  if (!row) return null;
  const items = await loadItems([row.id]);
  return hydrate(row, items.get(row.id) ?? []);
}

export async function getBookingById(id: number): Promise<BookingView | null> {
  const { rows } = await query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  return hydrateOne(rows[0]);
}

/** Public lookup by verification code (the code itself is the capability). */
export async function getBookingByCode(code: string): Promise<BookingView | null> {
  const { rows } = await query<BookingRow>(`${BOOKING_SELECT} WHERE b.verification_code = $1`, [
    code.toUpperCase(),
  ]);
  return hydrateOne(rows[0]);
}

/** All bookings made with a given email (a signed-in customer's history). */
export async function getBookingsByEmail(email: string): Promise<BookingView[]> {
  const { rows } = await query<BookingRow>(
    `${BOOKING_SELECT}
      WHERE lower(b.guest_email) = lower($1)
      ORDER BY b.booking_date DESC, b.time_slot DESC`,
    [email]
  );
  const items = await loadItems(rows.map((r) => r.id));
  return rows.map((r) => hydrate(r, items.get(r.id) ?? []));
}
