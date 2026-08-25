import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool';
import { validate } from '../../middleware/validate';
import { requireStaff } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';
import { linkish, removeOrRetire } from '../../utils/catalogue';

export const gamesRouter = Router();

const SELECT = `SELECT id, title, min_players, max_players, category,
                       description, image_url, purchase_url, is_active
                  FROM games`;

// GET /api/games — the public library. Retired titles are hidden here but keep
// every booking and play record attached to them.
gamesRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`${SELECT} WHERE is_active ORDER BY title`);
    res.json({ games: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/games/all — staff editor: includes retired titles so they can be
// found again and brought back.
gamesRouter.get('/all', requireStaff, async (_req, res, next) => {
  try {
    const { rows } = await query(`${SELECT} ORDER BY is_active DESC, title`);
    res.json({ games: rows });
  } catch (err) {
    next(err);
  }
});

const gameBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    // Optional: the library was imported from a sheet that carried titles and
    // categories only, so a game may legitimately not know its player range
    // yet. Give both or neither — half a range says nothing.
    minPlayers: z.number().int().min(1).max(100).nullable().optional(),
    maxPlayers: z.number().int().min(1).max(100).nullable().optional(),
    category: z.string().trim().min(1).max(60),
    description: z.string().trim().max(2000).default(''),
    imageUrl: linkish(1000),
    purchaseUrl: linkish(1000),
    isActive: z.boolean().default(true),
  })
  .refine((v) => (v.minPlayers == null) === (v.maxPlayers == null), {
    message: 'Give both a minimum and a maximum, or leave both empty.',
    path: ['maxPlayers'],
  })
  .refine((v) => v.minPlayers == null || v.maxPlayers == null || v.maxPlayers >= v.minPlayers, {
    message: 'Maximum players cannot be lower than minimum players.',
    path: ['maxPlayers'],
  });

const idParam = z.object({ id: z.coerce.number().int().positive() });

// POST /api/games — staff create.
gamesRouter.post('/', requireStaff, validate(gameBody), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query<{ id: number }>(
      `INSERT INTO games (title, min_players, max_players, category, description,
                          image_url, purchase_url, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.title, b.minPlayers ?? null, b.maxPlayers ?? null, b.category, b.description,
       b.imageUrl || null, b.purchaseUrl || null, b.isActive],
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    // Titles are unique, so a duplicate is a staff slip, not a server fault.
    if ((err as { code?: string }).code === '23505') {
      return next(new ApiError(409, 'A game with that title already exists.'));
    }
    next(err);
  }
});

// PUT /api/games/:id — staff update.
gamesRouter.put(
  '/:id',
  requireStaff,
  validate(idParam, 'params'),
  validate(gameBody),
  async (req, res, next) => {
    try {
      const b = req.body;
      const { rowCount } = await query(
        `UPDATE games SET title=$1, min_players=$2, max_players=$3, category=$4,
                          description=$5, image_url=$6, purchase_url=$7, is_active=$8
          WHERE id=$9`,
        [b.title, b.minPlayers ?? null, b.maxPlayers ?? null, b.category, b.description,
         b.imageUrl || null, b.purchaseUrl || null, b.isActive, Number(req.params.id)],
      );
      if (!rowCount) throw new ApiError(404, 'Game not found.');
      res.json({ ok: true });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return next(new ApiError(409, 'A game with that title already exists.'));
      }
      next(err);
    }
  },
);

// DELETE /api/games/:id — delete outright when nothing references the game,
// otherwise retire it so its history survives. See utils/catalogue.
gamesRouter.delete('/:id', requireStaff, validate(idParam, 'params'), async (req, res, next) => {
  try {
    res.json(
      await removeOrRetire({
        table: 'games',
        id: Number(req.params.id),
        notFound: 'Game not found.',
        references: [
          { sql: 'SELECT 1 FROM bookings WHERE game_id = $1 LIMIT 1' },
          { sql: 'SELECT 1 FROM customer_game_history WHERE game_id = $1 LIMIT 1' },
          { sql: 'SELECT 1 FROM wanted_posts WHERE game_id = $1 LIMIT 1' },
        ],
      }),
    );
  } catch (err) {
    next(err);
  }
});
