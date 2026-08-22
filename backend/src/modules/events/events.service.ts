import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { ApiError } from '../../middleware/error';
import { paymentProvider } from '../../payment';
import { isValidStart, maxDurationFor, STEP_MIN } from '../../utils/slots';

/**
 * Holding a table for an event.
 *
 * An event that occupies a table writes an ordinary row into `bookings` rather
 * than being special-cased in the availability query. The exclusion constraint
 * from migration 020 then enforces it in both directions for free: a customer
 * cannot book over an event, staff cannot put an event on a table someone has
 * already booked, and getAvailability hides those slots without knowing that
 * events exist at all.
 *
 * The alternative — teaching every read path to union events in — would have
 * meant the same rule written twice, in two places that could disagree.
 */

const HOLD_EMAIL = 'events@cozyden.local';

export interface EventWindow {
  tableId: number | null;
  date: string;
  startTime: string | null;
  durationMin: number | null;
}

/**
 * Confirm the table exists before an event tries to claim it.
 *
 * The events row has a foreign key to tables, so an unknown id would surface as
 * a raw 500 from the INSERT. Checking first turns that into a clean 404.
 */
export async function assertEventTableExists(tableId: number): Promise<void> {
  const { rows } = await query<{ id: number }>('SELECT id FROM tables WHERE id = $1', [tableId]);
  if (!rows[0]) throw new ApiError(404, 'That table was not found.');
}

/** A table booking is meaningless without a window; reject halves of one. */
export function assertWindowValid(w: EventWindow): void {
  if (w.tableId === null) return;
  if (!w.startTime || !isValidStart(w.startTime)) {
    throw new ApiError(400, 'Pick a start time for the event before assigning a table.');
  }
  if (
    w.durationMin === null ||
    !Number.isInteger(w.durationMin) ||
    w.durationMin % STEP_MIN !== 0 ||
    w.durationMin < STEP_MIN
  ) {
    throw new ApiError(400, `Event length must be a whole ${STEP_MIN} minutes.`);
  }
  if (w.durationMin > maxDurationFor(w.startTime)) {
    throw new ApiError(400, 'The event would run past closing time.');
  }
}

/**
 * Point the hold at the event's current table and window.
 *
 * Called after every create and update. Clearing the table drops the hold, so
 * an event moved off a table releases it immediately.
 *
 * A collision surfaces as the same 409 a customer would get, because it is the
 * same constraint and the same truth: that table is taken for that window.
 *
 * Takes the caller's transaction client on purpose. Saving the event and moving
 * its hold must succeed or fail together — otherwise a rejected hold would
 * leave an event row claiming a table it does not actually have.
 */
export async function syncTableHold(
  client: PoolClient,
  eventId: number,
  title: string,
  w: EventWindow,
): Promise<void> {
  assertWindowValid(w);

  // Always clear first: an event moved off a table, or to a new window, must
  // release the old one in the same breath it claims the new.
  await client.query(`DELETE FROM bookings WHERE event_id = $1`, [eventId]);
  if (w.tableId === null) return;

  const label = `Event: ${title}`.slice(0, 120);
  try {
    await client.query(
      `INSERT INTO bookings
         (table_id, booking_date, time_slot, guest_name, guest_email, verification_code,
          status, source, duration_min, party_size, event_id,
          table_fee_cents, items_total_cents, total_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'pending','event',$7,1,$8,0,0,0)`,
      [
        w.tableId,
        w.date,
        w.startTime,
        label,
        HOLD_EMAIL,
        `EV${eventId}-${Date.now().toString(36).toUpperCase()}`,
        w.durationMin,
        eventId,
      ],
    );
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23P01' && e.constraint === 'bookings_no_overlap') {
      throw new ApiError(409, 'That table is already booked for part of this event.');
    }
    throw err;
  }
}

/** Seats already spoken for, and whether any remain. */
export async function seatCounts(
  eventId: number,
): Promise<{ capacity: number | null; taken: number; remaining: number | null }> {
  const { rows } = await query<{ capacity: number | null; taken: string }>(
    `SELECT e.capacity,
            COALESCE((SELECT sum(r.seats) FROM event_reservations r
                       WHERE r.event_id = e.id AND r.status <> 'cancelled'), 0) AS taken
       FROM events e WHERE e.id = $1`,
    [eventId],
  );
  if (!rows[0]) throw new ApiError(404, 'Event not found.');
  const capacity = rows[0].capacity;
  const taken = Number(rows[0].taken);
  return { capacity, taken, remaining: capacity === null ? null : Math.max(0, capacity - taken) };
}

/**
 * Reserving seats.
 *
 * Mirrors the table-booking checkout: hold the seats as 'pending_payment',
 * open a gateway charge, and let finalizeSeatCharge() confirm once the customer
 * has actually paid. A seat is never confirmed on the customer's say-so.
 *
 * Capacity is enforced inside the same transaction that writes the row, with
 * the event row locked, so two customers racing for the last seat cannot both
 * win. Checking first and inserting after would leave exactly that gap.
 */
export interface SeatHold {
  reservationId: number;
  code: string;
  amountCents: number;
}

/**
 * Clear this guest's OWN abandoned holds on this event before counting seats.
 *
 * Same reasoning as table checkout: a customer whose payment page died holds
 * seats they never bought, and on a nearly-full event the person that shuts out
 * is themselves, retrying. The charge is re-asked of the gateway first, so a
 * payment that actually went through is settled rather than thrown away.
 */
async function clearOwnAbandonedHolds(eventId: number, email: string): Promise<void> {
  const { rows } = await query<{ id: number; payment_ref: string | null }>(
    `SELECT id, payment_ref FROM event_reservations
      WHERE event_id = $1 AND status = 'pending_payment' AND lower(guest_email) = lower($2)`,
    [eventId, email],
  );
  for (const row of rows) {
    if (row.payment_ref?.startsWith('chg_') && paymentProvider.retrieveCharge) {
      try {
        if ((await finalizeSeatCharge(row.payment_ref)) === 'paid') continue;
      } catch (err) {
        console.error('[events] could not re-check an abandoned charge', err);
      }
    }
    await releaseSeats(row.id);
  }
}

export async function holdSeats(
  eventId: number,
  seats: number,
  guest: { name: string; email: string; phone?: string | null; memberId?: number | null },
): Promise<SeatHold> {
  await clearOwnAbandonedHolds(eventId, guest.email);
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      capacity: number | null;
      seat_price_cents: number;
      event_date: string;
      title: string;
      taken: string;
    }>(
      `SELECT e.capacity, e.seat_price_cents, e.title,
              to_char(e.event_date, 'YYYY-MM-DD') AS event_date,
              COALESCE((SELECT sum(r.seats) FROM event_reservations r
                         WHERE r.event_id = e.id AND r.status <> 'cancelled'), 0) AS taken
         FROM events e WHERE e.id = $1
         FOR UPDATE OF e`,
      [eventId],
    );
    const ev = rows[0];
    if (!ev) throw new ApiError(404, 'Event not found.');
    if (ev.event_date < new Date().toISOString().slice(0, 10)) {
      throw new ApiError(400, 'That event has already happened.');
    }
    if (ev.capacity !== null && Number(ev.taken) + seats > ev.capacity) {
      const left = Math.max(0, ev.capacity - Number(ev.taken));
      throw new ApiError(409, left === 0 ? 'That event is full.' : `Only ${left} seat(s) left.`);
    }

    const amountCents = ev.seat_price_cents * seats;
    const code = `EVR${eventId}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const ins = await client.query<{ id: number }>(
      `INSERT INTO event_reservations
         (event_id, member_id, guest_name, guest_email, guest_phone, seats,
          verification_code, status, amount_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_payment',$8)
       RETURNING id`,
      [eventId, guest.memberId ?? null, guest.name, guest.email, guest.phone ?? null,
       seats, code, amountCents],
    );
    return { reservationId: ins.rows[0].id, code, amountCents };
  });
}

/** Free the seats a customer never paid for. */
export async function releaseSeats(reservationId: number): Promise<void> {
  await query(
    `UPDATE event_reservations SET status = 'cancelled'
      WHERE id = $1 AND status = 'pending_payment'`,
    [reservationId],
  );
}

/** Confirm seats once the gateway says the money arrived. */
export async function confirmSeats(reservationId: number, paymentRef: string): Promise<void> {
  await query(
    `UPDATE event_reservations SET status = 'pending', payment_ref = $2
      WHERE id = $1 AND status = 'pending_payment'`,
    [reservationId, paymentRef],
  );
}

export interface ReservationView {
  id: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  seats: number;
  status: string;
  amountCents: number;
  code: string;
  createdAt: Date;
}

/** Who has reserved for this event — staff view. */
export async function listReservations(eventId: number): Promise<ReservationView[]> {
  const { rows } = await query<{
    id: number; guest_name: string; guest_email: string; guest_phone: string | null;
    seats: number; status: string; amount_cents: number; verification_code: string;
    created_at: Date;
  }>(
    `SELECT id, guest_name, guest_email, guest_phone, seats, status, amount_cents,
            verification_code, created_at
       FROM event_reservations
      WHERE event_id = $1 AND status <> 'cancelled'
      ORDER BY created_at`,
    [eventId],
  );
  return rows.map((r) => ({
    id: r.id,
    guestName: r.guest_name,
    guestEmail: r.guest_email,
    guestPhone: r.guest_phone,
    seats: r.seats,
    status: r.status,
    amountCents: r.amount_cents,
    code: r.verification_code,
    createdAt: r.created_at,
  }));
}

/**
 * Record the gateway charge against the held seats.
 *
 * Written the moment the charge is opened, not when it settles. Without it a
 * hold that is never returned from is just an anonymous row: the sweep would
 * have no charge to ask Tap about and could only expire it by age, throwing
 * away seats somebody had actually paid for.
 */
export async function attachSeatCharge(reservationId: number, chargeId: string): Promise<void> {
  await query(
    `UPDATE event_reservations SET payment_ref = $2
      WHERE id = $1 AND status = 'pending_payment'`,
    [reservationId, chargeId],
  );
}

/**
 * Settle a seat charge from the gateway's own answer.
 *
 * Shared by the browser return, the webhook and the reconciliation sweep,
 * because any of the three may get there first and none of them is trusted:
 * the charge is always re-retrieved rather than believed.
 */
export async function finalizeSeatCharge(
  chargeId: string,
): Promise<'paid' | 'failed' | 'pending'> {
  if (!paymentProvider.retrieveCharge) return 'failed';
  const charge = await paymentProvider.retrieveCharge(chargeId);
  const reservationId = Number(charge.metadata?.reservationId ?? 0);
  if (!reservationId) return 'failed';
  if (charge.paid) {
    await confirmSeats(reservationId, chargeId);
    return 'paid';
  }
  // A declined charge is final; an unfinished one is not, and must not free
  // seats out from under a customer who is still on the gateway's page.
  if (charge.failed) {
    await releaseSeats(reservationId);
    return 'failed';
  }
  return 'pending';
}

/** Seat holds old enough to be worth re-checking, oldest first. */
export async function listStaleSeatHolds(
  staleAfterMin: number,
  expiryMin: number,
  limit: number,
): Promise<{ id: number; paymentRef: string | null; expirable: boolean }[]> {
  const { rows } = await query<{ id: number; payment_ref: string | null; expirable: boolean }>(
    `SELECT id, payment_ref,
            created_at < now() - ($2 || ' minutes')::interval AS expirable
       FROM event_reservations
      WHERE status = 'pending_payment'
        AND created_at < now() - ($1 || ' minutes')::interval
      ORDER BY created_at
      LIMIT ${limit}`,
    [String(staleAfterMin), String(expiryMin)],
  );
  return rows.map((r) => ({ id: r.id, paymentRef: r.payment_ref, expirable: r.expirable }));
}
