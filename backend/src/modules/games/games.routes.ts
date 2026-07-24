import { Router } from 'express';
import { query } from '../../db/pool';

export const gamesRouter = Router();

interface GameRow {
  id: number;
  title: string;
  min_players: number;
  max_players: number;
  category: string;
  description: string;
  image_url: string | null;
  purchase_url: string | null;
}

// GET /api/games — the public game library.
gamesRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query<GameRow>(
      `SELECT id, title, min_players, max_players, category,
              description, image_url, purchase_url
         FROM games
        ORDER BY title`
    );
    res.json({ games: rows });
  } catch (err) {
    next(err);
  }
});
