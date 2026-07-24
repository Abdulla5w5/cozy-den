import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';

// "Games I've played" — account-only (guests have no history to attach to).
export const historyRouter = Router();

interface HistoryRow {
  id: number;
  game_id: number;
  title: string;
  category: string;
  image_url: string | null;
  played_date: string;
  booking_id: number | null;
}

// GET /api/history — the signed-in customer's game history.
historyRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query<HistoryRow>(
      `SELECT h.id, h.game_id, g.title, g.category, g.image_url,
              to_char(h.played_date, 'YYYY-MM-DD') AS played_date, h.booking_id
         FROM customer_game_history h
         JOIN games g ON g.id = h.game_id
        WHERE h.customer_id = $1
        ORDER BY h.played_date DESC, h.id DESC`,
      [req.user!.sub]
    );
    res.json({ history: rows });
  } catch (err) {
    next(err);
  }
});

const addSchema = z.object({
  gameId: z.number().int().positive(),
  playedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'playedDate must be YYYY-MM-DD')
    .optional(),
  bookingId: z.number().int().positive().nullable().optional(),
});

// POST /api/history — log a game played after a visit.
historyRouter.post('/', requireAuth, validate(addSchema), async (req, res, next) => {
  try {
    const { gameId, playedDate, bookingId } = req.body;

    // Only allow linking a booking that belongs to this account.
    if (bookingId != null) {
      const { rows } = await query<{ id: number }>(
        `SELECT b.id FROM bookings b
          WHERE b.id = $1 AND lower(b.guest_email) = lower($2)`,
        [bookingId, req.user!.email]
      );
      if (!rows[0]) throw new ApiError(403, 'That booking does not belong to your account.');
    }

    const { rows } = await query<{ id: number }>(
      `INSERT INTO customer_game_history (customer_id, game_id, played_date, booking_id)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4)
       ON CONFLICT ON CONSTRAINT customer_game_history_unique DO NOTHING
       RETURNING id`,
      [req.user!.sub, gameId, playedDate ?? null, bookingId ?? null]
    );
    // Already logged for that date — treat as success (idempotent).
    res.status(rows[0] ? 201 : 200).json({ ok: true, alreadyLogged: !rows[0] });
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === '23503') return next(new ApiError(404, 'Game not found.'));
    next(err);
  }
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

// DELETE /api/history/:id — remove an entry (own rows only).
historyRouter.delete('/:id', requireAuth, validate(idParam, 'params'), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM customer_game_history WHERE id = $1 AND customer_id = $2',
      [Number(req.params.id), req.user!.sub]
    );
    if (!rowCount) throw new ApiError(404, 'Entry not found.');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
