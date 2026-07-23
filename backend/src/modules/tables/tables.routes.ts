import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { getTables, getAvailability } from './tables.service';
import { START_TIMES } from '../../utils/slots';

export const tablesRouter = Router();

// GET /api/tables — list all tables (id, label, capacity).
tablesRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ tables: await getTables() });
  } catch (err) {
    next(err);
  }
});

const availabilityQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

// GET /api/tables/availability?date=YYYY-MM-DD
// Returns, per table, which fixed slots are free vs. taken on that date.
tablesRouter.get(
  '/availability',
  validate(availabilityQuery, 'query'),
  async (req, res, next) => {
    try {
      const { date } = req.query as unknown as { date: string };
      const availability = await getAvailability(date);
      res.json({ date, slots: START_TIMES, availability });
    } catch (err) {
      next(err);
    }
  }
);
