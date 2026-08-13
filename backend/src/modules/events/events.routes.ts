import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool';
import { validate } from '../../middleware/validate';
import { requireStaff } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';
import { isoDate } from '../../utils/dates';
import { linkish } from '../../utils/catalogue';
import { syncTableHold } from './events.service';

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
