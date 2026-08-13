import type { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { ApiError } from '../../middleware/error';
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
