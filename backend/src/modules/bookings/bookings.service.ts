import { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';
import { generateVerificationCode } from '../../utils/code';
import { paymentProvider } from '../../payment';
import { mailer, formatReceiptEmail } from '../../notifications/mailer';
import { CreateBookingInput } from './bookings.schema';

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
  gameId: number | null;
  gameTitle: string | null;
  date: string;
  timeSlot: string;
  guestName: string;
  guestEmail: string;
  verificationCode: string;
  status: string;
  tableFeeCents: number;
  itemsTotalCents: number;
  totalCents: number;
  items: BookingItemView[];
  createdAt: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create a booking (guest checkout).
 *
 * Flow, so we never charge a card without a reserved table and never leave a
 * charge stranded:
 *   1. Re-price everything on the SERVER from the DB (ignore any client prices).
 *   2. Reserve the slot by inserting a `pending_payment` row (a partial unique
 *      index makes the reservation atomic — concurrent duplicates get a 409).
 *   3. Charge via the configured payment provider.
 *   4. On success -> confirm; on decline -> cancel (frees the slot) and 402.
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingView> {
  if (input.date < todayIso()) {
    throw new ApiError(400, 'Cannot book a date in the past.');
  }

  // --- validate table & game exist -----------------------------------------
  const table = (
    await query<{ id: number; label: string; capacity: number }>(
      'SELECT id, label, capacity FROM tables WHERE id = $1',
      [input.tableId]
    )
  ).rows[0];
  if (!table) throw new ApiError(404, 'Table not found.');

  let game: { id: number; title: string } | null = null;
  if (input.gameId != null) {
    game =
      (
        await query<{ id: number; title: string }>(
          'SELECT id, title FROM games WHERE id = $1',
          [input.gameId]
        )
      ).rows[0] ?? null;
    if (!game) throw new ApiError(404, 'Game not found.');
  }

  // --- re-price items from the DB (never trust client-sent prices) ----------
  const priced: { menuItemId: number; name: string; quantity: number; unitPriceCents: number }[] =
    [];
  if (input.items.length > 0) {
    const ids = [...new Set(input.items.map((i) => i.menuItemId))];
    const { rows } = await query<{ id: number; name: string; price_cents: number }>(
      `SELECT id, name, price_cents FROM menu_items
        WHERE id = ANY($1::int[]) AND available = TRUE`,
      [ids]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const item of input.items) {
      const m = byId.get(item.menuItemId);
      if (!m) throw new ApiError(400, `Menu item ${item.menuItemId} is unavailable.`);
      priced.push({
        menuItemId: m.id,
        name: m.name,
        quantity: item.quantity,
        unitPriceCents: m.price_cents,
      });
    }
  }

  const itemsTotalCents = priced.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const tableFeeCents = env.tableFeeCents;
  const totalCents = itemsTotalCents + tableFeeCents;

  // --- step 2: reserve the slot with a pending row --------------------------
  const bookingId = await reserveSlot(input, tableFeeCents, itemsTotalCents, totalCents, priced);

  // --- step 3: charge -------------------------------------------------------
  const charge = await paymentProvider.charge({
    amountCents: totalCents,
    currency: 'GBP',
    paymentToken: input.paymentToken,
    description: `Cozy Den booking #${bookingId}`,
    metadata: { bookingId: String(bookingId) },
  });

  // --- step 4: settle -------------------------------------------------------
  if (!charge.success) {
    await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    throw new ApiError(402, charge.declineReason || 'Payment was declined.');
  }

  await query(
    `UPDATE bookings SET status = 'confirmed', payment_ref = $1 WHERE id = $2`,
    [charge.reference, bookingId]
  );

  const view = await getBookingById(bookingId);
  if (!view) throw new ApiError(500, 'Booking vanished after creation.');

  // Fire-and-forget the receipt email (stubbed). A mail failure must not fail
  // an already-paid booking, so we swallow errors here and just log them.
  const email = formatReceiptEmail(view);
  mailer
    .send({ to: view.guestEmail, subject: email.subject, text: email.text })
    .catch((e) => console.error('[mailer] failed to send receipt', e));

  return view;
}

async function reserveSlot(
  input: CreateBookingInput,
  tableFeeCents: number,
  itemsTotalCents: number,
  totalCents: number,
  priced: { menuItemId: number; quantity: number; unitPriceCents: number }[]
): Promise<number> {
  // Retry only on verification-code collisions (astronomically rare).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateVerificationCode();
    try {
      return await withTransaction(async (client: PoolClient) => {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO bookings
             (table_id, game_id, booking_date, time_slot, guest_name, guest_email,
              verification_code, status, table_fee_cents, items_total_cents, total_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_payment',$8,$9,$10)
           RETURNING id`,
          [
            input.tableId,
            input.gameId ?? null,
            input.date,
            input.timeSlot,
            input.guestName,
            input.guestEmail,
            code,
            tableFeeCents,
            itemsTotalCents,
            totalCents,
          ]
        );
        const bookingId = inserted.rows[0].id;

        for (const it of priced) {
          await client.query(
            `INSERT INTO booking_items (booking_id, menu_item_id, quantity, unit_price_cents)
             VALUES ($1,$2,$3,$4)`,
            [bookingId, it.menuItemId, it.quantity, it.unitPriceCents]
          );
        }
        return bookingId;
      });
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === 'bookings_slot_unique') {
        throw new ApiError(409, 'That table is already booked for this time slot.');
      }
      if (e.code === '23505') {
        // verification_code collision — regenerate and retry
        continue;
      }
      throw err;
    }
  }
  throw new ApiError(500, 'Could not allocate a unique verification code.');
}

const BOOKING_SELECT = `
  SELECT b.id, b.table_id, t.label AS table_label,
         b.game_id, g.title AS game_title,
         to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
         b.time_slot, b.guest_name, b.guest_email, b.verification_code, b.status,
         b.table_fee_cents, b.items_total_cents, b.total_cents, b.created_at
    FROM bookings b
    JOIN tables t ON t.id = b.table_id
    LEFT JOIN games g ON g.id = b.game_id`;

interface BookingRow {
  id: number;
  table_id: number;
  table_label: string;
  game_id: number | null;
  game_title: string | null;
  booking_date: string;
  time_slot: string;
  guest_name: string;
  guest_email: string;
  verification_code: string;
  status: string;
  table_fee_cents: number;
  items_total_cents: number;
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
    gameId: row.game_id,
    gameTitle: row.game_title,
    date: row.booking_date,
    timeSlot: row.time_slot,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    verificationCode: row.verification_code,
    status: row.status,
    tableFeeCents: row.table_fee_cents,
    itemsTotalCents: row.items_total_cents,
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
  const { rows } = await query<BookingRow>(
    `${BOOKING_SELECT} WHERE b.verification_code = $1`,
    [code.toUpperCase()]
  );
  return rows[0] ? hydrate(rows[0]) : null;
}
