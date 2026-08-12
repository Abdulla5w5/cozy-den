import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool';
import { validate } from '../../middleware/validate';
import { requireStaff } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';
import { removeOrRetire } from '../../utils/catalogue';

export const menuRouter = Router();

const SELECT = `SELECT id, name, name_ar, category, price_cents, description, description_ar,
                       section, section_ar, display_order, available
                  FROM menu_items`;

// GET /api/menu — what customers can order today.
menuRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`${SELECT} WHERE available ORDER BY display_order, name`);
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/menu/all — staff editor: includes withdrawn items, so a seasonal
// dish can be brought back rather than retyped.
menuRouter.get('/all', requireStaff, async (_req, res, next) => {
  try {
    const { rows } = await query(`${SELECT} ORDER BY available DESC, display_order, name`);
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

const menuBody = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(['food', 'drink']),
  // Integer fils — money is never a float anywhere in this app.
  priceCents: z.number().int().min(0).max(1000000),
  description: z.string().trim().max(2000).default(''),
  available: z.boolean().default(true),
  // Optional with NO default on purpose. These are set by the Foodics import
  // as well as by staff, and a client that simply does not send a field must
  // not silently blank it — an omitted field is "leave it alone", while an
  // empty string is an explicit clear. See the COALESCE in the UPDATE below.
  nameAr: z.string().trim().max(200).optional(),
  descriptionAr: z.string().trim().max(2000).optional(),
  section: z.string().trim().max(120).optional(),
  sectionAr: z.string().trim().max(120).optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

// POST /api/menu — staff create.
menuRouter.post('/', requireStaff, validate(menuBody), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query<{ id: number }>(
      `INSERT INTO menu_items (name, category, price_cents, description, available,
                               name_ar, description_ar, section, section_ar, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [b.name, b.category, b.priceCents, b.description, b.available,
       b.nameAr ?? '', b.descriptionAr ?? '', b.section ?? '', b.sectionAr ?? '',
       b.displayOrder ?? 0],
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return next(new ApiError(409, 'A menu item with that name already exists.'));
    }
    next(err);
  }
});

// PUT /api/menu/:id — staff update.
menuRouter.put(
  '/:id',
  requireStaff,
  validate(idParam, 'params'),
  validate(menuBody),
  async (req, res, next) => {
    try {
      const b = req.body;
      const { rowCount } = await query(
        `UPDATE menu_items SET name=$1, category=$2, price_cents=$3, description=$4, available=$5,
                name_ar=COALESCE($6, name_ar),
                description_ar=COALESCE($7, description_ar),
                section=COALESCE($8, section),
                section_ar=COALESCE($9, section_ar),
                display_order=COALESCE($10, display_order)
          WHERE id=$11`,
        [b.name, b.category, b.priceCents, b.description, b.available,
         b.nameAr ?? null, b.descriptionAr ?? null, b.section ?? null,
         b.sectionAr ?? null, b.displayOrder ?? null,
         Number(req.params.id)],
      );
      if (!rowCount) throw new ApiError(404, 'Menu item not found.');
      res.json({ ok: true });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return next(new ApiError(409, 'A menu item with that name already exists.'));
      }
      next(err);
    }
  },
);

// DELETE /api/menu/:id — delete outright when nothing references the item,
// otherwise withdraw it so past orders keep their line items.
menuRouter.delete('/:id', requireStaff, validate(idParam, 'params'), async (req, res, next) => {
  try {
    res.json(
      await removeOrRetire({
        table: 'menu_items',
        id: Number(req.params.id),
        notFound: 'Menu item not found.',
        references: [{ sql: 'SELECT 1 FROM booking_items WHERE menu_item_id = $1 LIMIT 1' }],
      }),
    );
  } catch (err) {
    next(err);
  }
});
