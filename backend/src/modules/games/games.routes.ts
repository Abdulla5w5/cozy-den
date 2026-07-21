import { Router } from 'express';
import { query } from '../../db/pool';

export const gamesRouter = Router();

interface GameRow {
  id: number;
  title: string;
  min_players: number;
  max_players: number;
  category: string;
}

// GET /api/games — the game library.
gamesRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query<GameRow>(
      'SELECT id, title, min_players, max_players, category FROM games ORDER BY title'
    );
    res.json({ games: rows });
  } catch (err) {
    next(err);
  }
});
