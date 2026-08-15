import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool';
import { validate } from '../../middleware/validate';
import { requireStaff } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';
import { isoDate } from '../../utils/dates';
import { env } from '../../config/env';
import { linkish } from '../../utils/catalogue';
import {
  assertEventTableExists,
  assertWindowValid,
  attachSeatCharge,
  confirmSeats,
  finalizeSeatCharge,
  holdSeats,
  listReservations,
  releaseSeats,
  syncTableHold,
} from './events.service';
import { paymentProvider } from '../../payment';
import { TAP_CHARGE_EXPIRY_MINUTES } from '../../payment/constants';

// Absolute base for gateway redirect/webhook URLs, matching the booking flow.
function publicBase(req: { protocol: string; get(h: string): string | undefined }): string {
  return env.publicUrl || `${req.protocol}://${req.get('host')}`;
}

export const eventsRouter = Router();



const SELECT = `SELECT e.id, e.title, e.description,
                       to_char(e.event_date, 'YYYY-MM-DD') AS event_date,
                       e.event_time, e.location, e.type, e.image_url, e.is_featured,
                       e.table_id, e.start_time, e.duration_min, e.capacity,
                       e.seat_price_cents,
                       t.label AS table_label,
                       COALESCE((SELECT sum(r.seats) FROM event_reservations r
                                  WHERE r.event_id = e.id AND r.status <> 'cancelled'), 0)::int
                         AS seats_taken
                  FROM events e
                  LEFT JOIN tables t ON t.id = e.table_id`;

const listQuery = z.object({
  // 'upcoming' (default) for the homepage; 'all' for the calendar page.
  scope: z.enum(['upcoming', 'all']).optional(),
  featured: z.enum(['true', 'false']).optional(),
});

// GET /api/events?scope=upcoming|all&featured=true — public.
eventsRouter.get('/', validate(listQuery, 'query'), async (req, res, next) => {
  try {
    const { scope, featured } = req.query as { scope?: string; featured?: string };
    const where: string[] = [];
    if (scope !== 'all') where.push('e.event_date >= CURRENT_DATE');
    if (featured === 'true') where.push('e.is_featured');
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const { rows } = await query(`${SELECT}${clause} ORDER BY e.event_date, e.start_time NULLS LAST, e.event_time NULLS LAST`);
    res.json({ events: rows });
  } catch (err) {
    next(err);
  }
});

const eventBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
  date: isoDate(),
  time: z.string().trim().max(20).nullable().optional(),
  location: z.string().trim().max(300).default(''),
  type: z.enum(['internal', 'external']),
  imageUrl: linkish(1000),
  isFeatured: z.boolean().default(false),
  // A table hold needs a real window; the service rejects half of one.
  tableId: z.number().int().positive().nullable().default(null),
  startTime: z.string().trim().max(5).nullable().default(null),
  durationMin: z.number().int().min(30).max(780).nullable().default(null),
  capacity: z.number().int().min(1).max(500).nullable().default(null),
  seatPriceCents: z.number().int().min(0).max(1000000).default(0),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

// POST /api/events — staff create.
eventsRouter.post('/', requireStaff, validate(eventBody), async (req, res, next) => {
  try {
    const b = req.body;
    // Validate the window and the table up front, so a table picked without a
    // start time/length (or a table that no longer exists) returns a clean 400
    // or 404 instead of the events INSERT tripping a DB constraint as a 500.
    const win = { tableId: b.tableId, date: b.date, startTime: b.startTime, durationMin: b.durationMin };
    assertWindowValid(win);
    if (b.tableId != null) await assertEventTableExists(b.tableId);
    // The event and its table hold are one change: if the table turns out to be
    // taken, the whole create rolls back rather than leaving an event that
    // claims a table it never got.
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO events (title, description, event_date, event_time, location, type,
                             image_url, is_featured, table_id, start_time, duration_min,
                             capacity, seat_price_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [b.title, b.description, b.date, b.time || null, b.location, b.type, b.imageUrl || null,
         b.isFeatured, b.tableId, b.startTime, b.durationMin, b.capacity, b.seatPriceCents],
      );
      const newId = rows[0].id;
      await syncTableHold(client, newId, b.title, {
        tableId: b.tableId, date: b.date, startTime: b.startTime, durationMin: b.durationMin,
      });
      return newId;
    });
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

// PUT /api/events/:id — staff update.
eventsRouter.put(
  '/:id',
  requireStaff,
  validate(idParam, 'params'),
  validate(eventBody),
  async (req, res, next) => {
    try {
      const b = req.body;
      const id = Number(req.params.id);
      const win = { tableId: b.tableId, date: b.date, startTime: b.startTime, durationMin: b.durationMin };
      assertWindowValid(win);
      if (b.tableId != null) await assertEventTableExists(b.tableId);
      await withTransaction(async (client) => {
        const { rowCount } = await client.query(
          `UPDATE events SET title=$1, description=$2, event_date=$3, event_time=$4,
                             location=$5, type=$6, image_url=$7, is_featured=$8,
                             table_id=$9, start_time=$10, duration_min=$11,
                             capacity=$12, seat_price_cents=$13
            WHERE id=$14`,
          [b.title, b.description, b.date, b.time || null, b.location, b.type,
           b.imageUrl || null, b.isFeatured, b.tableId, b.startTime, b.durationMin,
           b.capacity, b.seatPriceCents, id],
        );
        if (!rowCount) throw new ApiError(404, 'Event not found.');
        // Move or release the hold to match what was just saved.
        await syncTableHold(client, id, b.title, {
          tableId: b.tableId, date: b.date, startTime: b.startTime, durationMin: b.durationMin,
        });
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/events/:id — staff delete.
eventsRouter.delete('/:id', requireStaff, validate(idParam, 'params'), async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM events WHERE id = $1', [Number(req.params.id)]);
    if (!rowCount) throw new ApiError(404, 'Event not found.');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Seat reservations ----------

const reserveBody = z.object({
  guestName: z.string().trim().min(1).max(120),
  guestEmail: z.string().trim().email().max(200),
  guestPhone: z.string().trim().max(20).optional(),
  seats: z.number().int().min(1).max(20).default(1),
});

// POST /api/events/:id/reserve — customer reserves seats.
//
// Paid seats go through the same redirect checkout a table booking uses; free
// events (seat_price_cents = 0) confirm straight away, since there is nothing
// to charge and sending someone to a gateway for KD 0.000 would be absurd.
eventsRouter.post(
  '/:id/reserve',
  validate(idParam, 'params'),
  validate(reserveBody),
  async (req, res, next) => {
    try {
      const eventId = Number(req.params.id);
      const b = req.body;
      const hold = await holdSeats(eventId, b.seats, {
        name: b.guestName,
        email: b.guestEmail,
        phone: b.guestPhone ?? null,
        memberId: req.user?.sub ?? null,
      });

      if (hold.amountCents === 0) {
        await confirmSeats(hold.reservationId, 'free');
        return res.status(201).json({ code: hold.code, free: true });
      }

      if (!paymentProvider.createCharge) {
        await releaseSeats(hold.reservationId);
        throw new ApiError(500, 'Payment is not configured for paid events.');
      }

      const base = publicBase(req);
      try {
        const charge = await paymentProvider.createCharge({
          amountCents: hold.amountCents,
          currency: 'KWD',
          description: `Cozy Den event seat(s), reservation #${hold.reservationId}`,
          redirectUrl: `${base}/api/events/seats/return`,
          webhookUrl: `${base}/api/events/seats/webhook`,
          customer: { name: b.guestName, email: b.guestEmail },
          metadata: { reservationId: String(hold.reservationId), code: hold.code },
          expiryMinutes: TAP_CHARGE_EXPIRY_MINUTES,
        });
        // Recorded before redirecting, so a customer who pays but never comes
        // back can still be settled by the sweep.
        await attachSeatCharge(hold.reservationId, charge.chargeId);
        return res.status(201).json({ redirectUrl: charge.transactionUrl, code: hold.code });
      } catch (err) {
        // Never strand the seats behind a charge that failed to open.
        await releaseSeats(hold.reservationId);
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/events/seats/return — where Tap sends the customer's browser.
eventsRouter.get('/seats/return', async (req, res) => {
  const site = publicBase(req);
  const chargeId = String(req.query.tap_id || '');
  if (!chargeId) return res.redirect(`${site}/events?seat=error`);
  try {
    const outcome = await finalizeSeatCharge(chargeId);
    return res.redirect(`${site}/events?seat=${outcome}`);
  } catch (err) {
    console.error('[tap] event seat return failed', err);
    return res.redirect(`${site}/events?seat=error`);
  }
});

// POST /api/events/seats/webhook — the reliable confirmation path; fires even
// if the customer closes the tab before being redirected back.
eventsRouter.post('/seats/webhook', async (req, res) => {
  try {
    const chargeId = String(req.body?.id || '');
    if (chargeId) await finalizeSeatCharge(chargeId);
  } catch (err) {
    console.error('[tap] event seat webhook failed', err);
  }
  res.status(200).json({ received: true });
});

// GET /api/events/:id/reservations — staff: who has booked in.
eventsRouter.get(
  '/:id/reservations',
  requireStaff,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      res.json({ reservations: await listReservations(Number(req.params.id)) });
    } catch (err) {
      next(err);
    }
  },
);
