import { Router } from 'express';
import { query } from '../../db/pool';

export const menuRouter = Router();

interface MenuRow {
  id: number;
  name: string;
  category: 'food' | 'drink';
  price_cents: number;
  description: string;
}

// GET /api/menu — available food & drink items.
menuRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query<MenuRow>(
      `SELECT id, name, category, price_cents, description
         FROM menu_items
        WHERE available = TRUE
        ORDER BY category, name`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});
