import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool';
import { validate } from '../../middleware/validate';
import { requireStaff } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';

export const eventsRouter = Router();


// Accept either an absolute URL (https://…) or a root-relative path (/events),
// so staff can link to internal pages as well as external sites.
const linkish = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => v === '' || v.startsWith('/') || /^https?:\/\//i.test(v), 'must be a URL or a /path')
    .nullable()
    .optional();

const SELECT = `SELECT id, title, description,
                       to_char(event_date, 'YYYY-MM-DD') AS event_date,
                       event_time, location, type, image_url, is_featured
                  FROM events`;

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
    if (scope !== 'all') where.push('event_date >= CURRENT_DATE');
    if (featured === 'true') where.push('is_featured');
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const { rows } = await query(`${SELECT}${clause} ORDER BY event_date, event_time NULLS LAST`);
    res.json({ events: rows });
  } catch (err) {
    next(err);
  }
});

const eventBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  time: z.string().trim().max(20).nullable().optional(),
  location: z.string().trim().max(300).default(''),
  type: z.enum(['internal', 'external']),
  imageUrl: linkish(1000),
  isFeatured: z.boolean().default(false),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

// POST /api/events — staff create.
eventsRouter.post('/', requireStaff, validate(eventBody), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO events (title, description, event_date, event_time, location, type, image_url, is_featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.title, b.description, b.date, b.time || null, b.location, b.type, b.imageUrl || null, b.isFeatured]
    );
    res.status(201).json({ id: (rows[0] as { id: number }).id });
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
      const { rowCount } = await query(
        `UPDATE events SET title=$1, description=$2, event_date=$3, event_time=$4,
                           location=$5, type=$6, image_url=$7, is_featured=$8
          WHERE id=$9`,
        [b.title, b.description, b.date, b.time || null, b.location, b.type,
         b.imageUrl || null, b.isFeatured, Number(req.params.id)]
      );
      if (!rowCount) throw new ApiError(404, 'Event not found.');
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
