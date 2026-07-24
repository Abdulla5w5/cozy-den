import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool';
import { validate } from '../../middleware/validate';
import { requireStaff } from '../../middleware/auth';

// Entry popup: exactly one active promo, staff-editable without a deploy.
export const promoRouter = Router();


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

const SELECT = `SELECT id, image_url, text, link_url, link_label, is_active FROM promos`;

// GET /api/promo — public; returns the active promo or null.
promoRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`${SELECT} WHERE is_active ORDER BY updated_at DESC LIMIT 1`);
    res.json({ promo: rows[0] ?? null });
  } catch (err) {
    next(err);
  }
});

// GET /api/promo/all — staff; every promo for the editor.
promoRouter.get('/all', requireStaff, async (_req, res, next) => {
  try {
    const { rows } = await query(`${SELECT} ORDER BY updated_at DESC`);
    res.json({ promos: rows });
  } catch (err) {
    next(err);
  }
});

const promoBody = z.object({
  imageUrl: linkish(1000),
  text: z.string().trim().max(1000).default(''),
  linkUrl: linkish(1000),
  linkLabel: z.string().trim().max(60).nullable().optional().or(z.literal('')),
  isActive: z.boolean().default(true),
});

/**
 * PUT /api/promo — staff upsert of the single active promo.
 * A partial unique index enforces one active row, so deactivate the others
 * inside the same transaction before activating this one.
 */
promoRouter.put('/', requireStaff, validate(promoBody), async (req, res, next) => {
  try {
    const b = req.body;
    const id = await withTransaction(async (client) => {
      if (b.isActive) {
        await client.query('UPDATE promos SET is_active = FALSE WHERE is_active');
      }
      const existing = await client.query<{ id: number }>(
        'SELECT id FROM promos ORDER BY updated_at DESC LIMIT 1'
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE promos SET image_url=$1, text=$2, link_url=$3, link_label=$4,
                             is_active=$5, updated_at=now() WHERE id=$6`,
          [b.imageUrl || null, b.text, b.linkUrl || null, b.linkLabel || null, b.isActive, existing.rows[0].id]
        );
        return existing.rows[0].id;
      }
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO promos (image_url, text, link_url, link_label, is_active)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [b.imageUrl || null, b.text, b.linkUrl || null, b.linkLabel || null, b.isActive]
      );
      return inserted.rows[0].id;
    });
    res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});
