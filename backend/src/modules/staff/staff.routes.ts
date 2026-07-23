import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireStaff } from '../../middleware/auth';
import { getBookingsForDate, confirmBooking, markPrinted } from './staff.service';
import { getMonthlyAnalytics, getRecurrentCustomers } from './analytics.service';
import { staffCreateBookingSchema } from '../bookings/bookings.schema';
import { createStaffBooking, getBookingById } from '../bookings/bookings.service';

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

// POST /api/staff/bookings — manual entry for phone/WhatsApp bookings
// (source: staff_manual, no payment step).
staffRouter.post(
  '/bookings',
  requireStaff,
  validate(staffCreateBookingSchema, 'body'),
  async (req, res, next) => {
    try {
      res.status(201).json({ booking: await createStaffBooking(req.body) });
    } catch (err) {
      next(err);
    }
  }
);

const codeSchema = z.object({ code: z.string().trim().min(4).max(32) });
const idParam = z.object({ id: z.coerce.number().int().positive() });

// POST /api/staff/confirm  { code } — customer arrived; auto-advances to
// 'print_receipt' the moment it's confirmed (system-driven).
staffRouter.post('/confirm', requireStaff, validate(codeSchema, 'body'), async (req, res, next) => {
  try {
    const id = await confirmBooking({ code: req.body.code });
    res.json({ booking: await getBookingById(id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/staff/bookings/:id/confirm — same transition, by row id.
staffRouter.post(
  '/bookings/:id/confirm',
  requireStaff,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      const id = await confirmBooking({ id: Number(req.params.id) });
      res.json({ booking: await getBookingById(id) });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/staff/bookings/:id/printed — receipt physically printed.
staffRouter.post(
  '/bookings/:id/printed',
  requireStaff,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      const id = await markPrinted(Number(req.params.id));
      res.json({ booking: await getBookingById(id) });
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
