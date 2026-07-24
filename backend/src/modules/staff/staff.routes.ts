import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireStaff } from '../../middleware/auth';
import { getBookingsForDate, confirmBooking, markPrinted } from './staff.service';
import { getMonthlyAnalytics, getRecurrentCustomers } from './analytics.service';
import { listTeam, grantStaff, revokeStaff } from './team.service';
import {
  addMessage,
  listAllRequests,
  setStatus,
  Status as SupportStatus,
} from '../support/support.service';
import { staffCreateBookingSchema } from '../bookings/bookings.schema';
import { createStaffBooking, getBookingById } from '../bookings/bookings.service';

// Dashboard DATA endpoints. Auth (login/logout/me) lives in /api/auth.
// Every route requires a signed-in user flagged as staff in the database.
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

// ---------- Team management (staff grant/revoke) ----------

// GET /api/staff/team — current staff members.
staffRouter.get('/team', requireStaff, async (_req, res, next) => {
  try {
    res.json({ team: await listTeam() });
  } catch (err) {
    next(err);
  }
});

const grantSchema = z.object({ email: z.string().trim().email().max(200) });

// POST /api/staff/team — promote an existing account to staff.
staffRouter.post('/team', requireStaff, validate(grantSchema), async (req, res, next) => {
  try {
    const actor = { id: req.user!.sub, email: req.user!.email };
    res.status(201).json({ member: await grantStaff(actor, req.body.email) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/staff/team/:id — revoke staff access.
staffRouter.delete('/team/:id', requireStaff, async (req, res, next) => {
  try {
    const actor = { id: req.user!.sub, email: req.user!.email };
    await revokeStaff(actor, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Support inbox (staff side) ----------

const supportListQuery = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
});

// GET /api/staff/support?status=open — the inbox.
staffRouter.get(
  '/support',
  requireStaff,
  validate(supportListQuery, 'query'),
  async (req, res, next) => {
    try {
      const status = (req.query as { status?: SupportStatus }).status;
      res.json({ requests: await listAllRequests(status) });
    } catch (err) {
      next(err);
    }
  }
);

const staffReplySchema = z.object({
  body: z.string().trim().min(1).max(4000),
  internal: z.boolean().optional(),
});

// POST /api/staff/support/:id/messages — reply, or leave a staff-only note.
staffRouter.post(
  '/support/:id/messages',
  requireStaff,
  validate(staffReplySchema),
  async (req, res, next) => {
    try {
      const actor = { id: req.user!.sub, name: req.user!.name, email: req.user!.email };
      const message = await addMessage(
        Number(req.params.id),
        actor,
        'staff',
        req.body.body,
        req.body.internal === true
      );
      res.status(201).json({ message });
    } catch (err) {
      next(err);
    }
  }
);

const statusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
});

// POST /api/staff/support/:id/status — move the request through the workflow.
staffRouter.post(
  '/support/:id/status',
  requireStaff,
  validate(statusSchema),
  async (req, res, next) => {
    try {
      const actor = { id: req.user!.sub, name: req.user!.name, email: req.user!.email };
      res.json({ request: await setStatus(Number(req.params.id), actor, req.body.status) });
    } catch (err) {
      next(err);
    }
  }
);
