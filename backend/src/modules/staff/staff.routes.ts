import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { loginLimiter } from '../../middleware/rateLimit';
import { AUTH_COOKIE, requireStaff, signStaffToken } from '../../middleware/auth';
import { env } from '../../config/env';
import { authenticateStaff, getBookingsForDate, checkInByCode } from './staff.service';
import { getMonthlyAnalytics } from './analytics.service';

export const staffRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

const cookieOpts = {
  httpOnly: true, // not readable by JS -> not stealable via XSS
  sameSite: 'lax' as const,
  secure: env.cookieSecure, // Secure flag when behind HTTPS
  maxAge: 8 * 60 * 60 * 1000,
  path: '/',
};

// POST /api/staff/login — sets an httpOnly session cookie.
staffRouter.post('/login', loginLimiter, validate(loginSchema, 'body'), async (req, res, next) => {
  try {
    const claims = await authenticateStaff(req.body.email, req.body.password);
    const token = signStaffToken(claims);
    res.cookie(AUTH_COOKIE, token, cookieOpts);
    res.json({ staff: { email: claims.email, name: claims.name } });
  } catch (err) {
    next(err);
  }
});

// POST /api/staff/logout
staffRouter.post('/logout', requireStaff, (req, res) => {
  res.clearCookie(AUTH_COOKIE, { ...cookieOpts, maxAge: undefined });
  res.json({ ok: true });
});

// GET /api/staff/me — who am I (used by the frontend to check session).
staffRouter.get('/me', requireStaff, (req, res) => {
  res.json({ staff: { email: req.staff!.email, name: req.staff!.name } });
});

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
