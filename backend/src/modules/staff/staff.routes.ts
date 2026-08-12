import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../middleware/error';
import { requireAdmin, requireStaff } from '../../middleware/auth';
import { getBookingsForDate, confirmBooking, markPrinted } from './staff.service';
import { getMonthlyAnalytics, getRecurrentCustomers } from './analytics.service';
import { listTeam, grantStaff, revokeStaff, grantAdmin, revokeAdmin } from './team.service';
import {
  addMessage,
  listAllRequests,
  setStatus,
  Status as SupportStatus,
} from '../support/support.service';
import { deletePost, listPostsForStaff, moderatePost } from '../wanted/wanted.service';
import { setReviewed } from '../support/support.service';
import {
  deleteOverride,
  getRates,
  listOverrides,
  setRates,
  upsertOverride,
} from '../../utils/pricing';
import { staffCreateBookingSchema } from '../bookings/bookings.schema';
import { createStaffBooking, getBookingById } from '../bookings/bookings.service';
import { isoDate, isoMonth } from '../../utils/dates';

// Dashboard DATA endpoints. Auth (login/logout/me) lives in /api/auth.
// Every route requires a signed-in user flagged as staff in the database.
export const staffRouter = Router();

const dateQuery = z.object({
  date: isoDate()
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
  month: isoMonth()
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
staffRouter.post('/team', requireAdmin, validate(grantSchema), async (req, res, next) => {
  try {
    const actor = { id: req.user!.sub, email: req.user!.email };
    res.status(201).json({ member: await grantStaff(actor, req.body.email) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/staff/team/:id — revoke staff access.
staffRouter.delete('/team/:id', requireAdmin, validate(idParam, 'params'), async (req, res, next) => {
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
  validate(idParam, 'params'),
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
  validate(idParam, 'params'),
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

// ---------- Wanted Board (staff side) ----------

const wantedQuery = z.object({
  status: z.enum(['pending', 'open', 'completed', 'rejected']).optional(),
});

// GET /api/staff/wanted — full detail INCLUDING the identities and contact
// details of everyone who registered interest. This is the only place those
// are exposed; the public board returns counts alone.
staffRouter.get('/wanted', requireStaff, validate(wantedQuery, 'query'), async (req, res, next) => {
  try {
    const status = (req.query as { status?: 'pending' | 'open' | 'completed' | 'rejected' }).status;
    res.json({ posts: await listPostsForStaff(status) });
  } catch (err) {
    next(err);
  }
});

const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']) });

// POST /api/staff/wanted/:id/moderate — publish a pending post, or reject it.
staffRouter.post(
  '/wanted/:id/moderate',
  requireStaff,
  validate(idParam, 'params'),
  validate(decisionSchema),
  async (req, res, next) => {
    try {
      res.json({ post: await moderatePost(Number(req.params.id), req.body.decision) });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/staff/wanted/:id — destructive moderation is admin-only. The
// server guard is authoritative; hiding the button from ordinary staff is not.
staffRouter.delete(
  '/wanted/:id',
  requireAdmin,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      await deletePost(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

const reviewedSchema = z.object({ reviewed: z.boolean() });

// POST /api/staff/support/:id/reviewed — "I have read this", tracked separately
// from the open/resolved workflow so it never implies action was taken.
staffRouter.post(
  '/support/:id/reviewed',
  requireStaff,
  validate(idParam, 'params'),
  validate(reviewedSchema),
  async (req, res, next) => {
    try {
      res.json({ request: await setReviewed(Number(req.params.id), req.body.reviewed) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- Price editor ----------
//
// Base weekday/weekend rates plus dated overrides. An override is just "on this
// date, charge this" — holidays, discount days and event upcharges are all the
// same thing, so staff never need a deploy to change a price.

// GET /api/staff/pricing — current rates and every upcoming override.
staffRouter.get('/pricing', requireAdmin, async (_req, res, next) => {
  try {
    res.json({
      rates: await getRates(),
      overrides: await listOverrides(new Date().toISOString().slice(0, 10)),
    });
  } catch (err) {
    next(err);
  }
});

const ratesSchema = z.object({
  peakCents: z.number().int().min(0).max(100000),
  offPeakCents: z.number().int().min(0).max(100000),
  latePeakCents: z.number().int().min(0).max(100000),
  lateOffPeakCents: z.number().int().min(0).max(100000),
});

// PUT /api/staff/pricing/rates — the Thu/Fri/Sat and everyday rates.
staffRouter.put('/pricing/rates', requireAdmin, validate(ratesSchema), async (req, res, next) => {
  try {
    await setRates(req.body);
    res.json({ rates: await getRates() });
  } catch (err) {
    next(err);
  }
});

const overrideSchema = z.object({
  date: isoDate(),
  label: z.string().trim().min(1).max(80),
  feeCents: z.number().int().min(0).max(100000),
});

// PUT /api/staff/pricing/overrides — add or update one dated price.
staffRouter.put(
  '/pricing/overrides',
  requireAdmin,
  validate(overrideSchema),
  async (req, res, next) => {
    try {
      await upsertOverride(req.body);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

const dateParam = z.object({
  date: isoDate(),
});

// DELETE /api/staff/pricing/overrides/:date — back to the normal rate.
staffRouter.delete(
  '/pricing/overrides/:date',
  requireAdmin,
  validate(dateParam, 'params'),
  async (req, res, next) => {
    try {
      if (!(await deleteOverride(req.params.date))) {
        throw new ApiError(404, 'No override on that date.');
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- Admin tier (admins only) ----------
//
// Staff grant nothing; admins grant staff, and admins grant admin. Keeping
// promotion to the top rung in admin hands is the whole point of the split —
// otherwise any counter login could promote itself and edit prices.

// POST /api/staff/team/:id/admin — promote an existing staff member to admin.
staffRouter.post(
  '/team/:id/admin',
  requireAdmin,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      const actor = { id: req.user!.sub, email: req.user!.email };
      res.json({ member: await grantAdmin(actor, Number(req.params.id)) });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/staff/team/:id/admin — demote to ordinary staff.
staffRouter.delete(
  '/team/:id/admin',
  requireAdmin,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      const actor = { id: req.user!.sub, email: req.user!.email };
      await revokeAdmin(actor, Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
