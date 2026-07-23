import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireStaff } from '../../middleware/auth';
import { getBookingsForDate, checkInByCode } from './staff.service';
import { getMonthlyAnalytics, getRecurrentCustomers } from './analytics.service';

// Dashboard DATA endpoints. Auth (login/logout/me) lives in /api/auth.
// Every route requires a signed-in user whose email is on the staff allow-list.
export const staffRouter = Router();

const dateQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});

// GET /api/staff/bookings?date=YYYY-MM-DD  (defaults to today)
staffRouter.get('/bookings', requireStaff, validate(dateQuery, 'query'), async (req, res, next) => {
  try {
    const date = (req.query as { date?: string }).date ?? new Date().toISOString().slice(0, 10);
    res.json({ date, bookings: await getBookingsForDate(date) });
  } catch (err) {
    next(err);
  }
});

const checkInSchema = z.object({ code: z.string().trim().min(4).max(32) });

// POST /api/staff/check-in  { code }
staffRouter.post(
  '/check-in',
  requireStaff,
  validate(checkInSchema, 'body'),
  async (req, res, next) => {
    try {
      res.json({ booking: await checkInByCode(req.body.code) });
    } catch (err) {
      next(err);
    }
  }
);

const analyticsQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM')
    .optional(),
});

// GET /api/staff/analytics?month=YYYY-MM  (defaults to current month)
staffRouter.get(
  '/analytics',
  requireStaff,
  validate(analyticsQuery, 'query'),
  async (req, res, next) => {
    try {
      const month = (req.query as { month?: string }).month ?? new Date().toISOString().slice(0, 7);
      res.json({ analytics: await getMonthlyAnalytics(month) });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/staff/customers — recurrent customers (name, email, visits, spend).
staffRouter.get('/customers', requireStaff, async (_req, res, next) => {
  try {
    res.json({ customers: await getRecurrentCustomers() });
  } catch (err) {
    next(err);
  }
});
