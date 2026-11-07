import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../middleware/error';
import { requireAdmin, requireStaff } from '../../middleware/auth';
import { getBookingsForDate, confirmBooking, completeBooking, setBookingNotes } from './staff.service';
import { getCustomers, getMonthlyAnalytics } from './analytics.service';
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
import {
  createCode,
  createPriceSet,
  deleteCode,
  deletePriceSet,
  listCodes,
  listPriceSets,
  updateCode,
  updatePriceSet,
} from '../promo/codes.service';
import { staffCreateBookingSchema, staffNotesSchema } from '../bookings/bookings.schema';
import {
  addAvailability,
  deleteAvailabilityAsStaff,
  listHostAvailability,
  getHostRates,
  listHostsForAdmin,
  setHostRates,
  removeHost,
  saveHostByEmail,
  upcomingSessions,
} from '../hosts/hosts.service';
import { linkish } from '../../utils/catalogue';
import { createStaffBooking, getBookingById } from '../bookings/bookings.service';
import { isoDate, isoMonth } from '../../utils/dates';
import { isValidStart } from '../../utils/slots';

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

// PUT /api/staff/bookings/:id/notes — staff's own notes on a booking.
staffRouter.put(
  '/bookings/:id/notes',
  requireStaff,
  validate(idParam, 'params'),
  validate(staffNotesSchema),
  async (req, res, next) => {
    try {
      if (!(await setBookingNotes(Number(req.params.id), req.body.notes))) {
        throw new ApiError(404, 'No such booking.');
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/staff/confirm  { code } — the guest turned up.
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

// POST /api/staff/bookings/:id/complete — the session is finished.
//
// Printing has no endpoint by design: a receipt changes nothing, so it is
// rendered and printed entirely in the browser.
staffRouter.post(
  '/bookings/:id/complete',
  requireStaff,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      const id = await completeBooking(Number(req.params.id));
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

// GET /api/staff/customers — accounts and guests (name, contact, visits, spend).
const customersQuery = z.object({ sort: z.enum(['recent', 'visits']).default('recent') });

staffRouter.get('/customers', requireStaff, validate(customersQuery, 'query'), async (req, res, next) => {
  try {
    const { sort } = req.query as unknown as z.infer<typeof customersQuery>;
    res.json({ customers: await getCustomers(sort) });
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

// DELETE /api/staff/wanted/:id — any staff member who can approve a post can
// also remove one. Approving and removing are the same job done at different
// moments: the post that should never have been published and the one that has
// served its purpose both land on whoever is running the board that day, and
// making them wait for an admin left dead listings up.
staffRouter.delete(
  '/wanted/:id',
  requireStaff,
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
      priceSets: await listPriceSets(),
      hostRates: await getHostRates(),
      codes: await listCodes(),
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
  // Null switches the flat six-hour weekday price off.
  sixHourOffPeakCents: z.number().int().min(0).max(100000).nullable(),
  // Null makes the odd hour of a 3- or 5-hour booking half a block.
  extraHourPeakCents: z.number().int().min(0).max(100000).nullable(),
  extraHourOffPeakCents: z.number().int().min(0).max(100000).nullable(),
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

// Null leaves that price unset, and a code then changes nothing on those days.
const hostRatesSchema = z.object({
  // Null takes the option off sale.
  normalHourlyCents: z.number().int().min(0).max(100000).nullable(),
  clocktowerHourlyCents: z.number().int().min(0).max(100000).nullable(),
});

// PUT /api/staff/pricing/hosts — the price per hour of each host option.
staffRouter.put('/pricing/hosts', requireAdmin, validate(hostRatesSchema), async (req, res, next) => {
  try {
    await setHostRates(req.body);
    res.json({ hostRates: await getHostRates() });
  } catch (err) {
    next(err);
  }
});

const cents = z.number().int().min(0).max(100000).nullable();
const priceSetBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(['hourly', 'percent']),
    // At most 99: the gateway cannot take a charge of zero.
    percentOff: z.number().int().min(1).max(99).nullable(),
    sunWedCents: cents,
    sunWedExtraCents: cents,
    thuFriCents: cents,
    thuFriExtraCents: cents,
    satCents: cents,
    satExtraCents: cents,
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (v.kind === 'percent') {
      if (v.percentOff === null) issue('Enter the percentage off, from 1 to 99.');
      return;
    }
    const days: [number | null, number | null][] = [
      [v.sunWedCents, v.sunWedExtraCents],
      [v.thuFriCents, v.thuFriExtraCents],
      [v.satCents, v.satExtraCents],
    ];
    if (days.some(([a, b]) => (a === null) !== (b === null))) {
      issue('Each day needs both prices, or neither.');
    }
    if (days.some(([a]) => a === 0)) issue('The first two hours cannot be free.');
    if (days.every(([a]) => a === null)) issue('Enter prices for at least one day.');
  });

// POST /api/staff/pricing/sets — a new code price.
staffRouter.post('/pricing/sets', requireAdmin, validate(priceSetBody), async (req, res, next) => {
  try {
    await createPriceSet(req.body);
    res.json({ priceSets: await listPriceSets(), codes: await listCodes() });
  } catch (err) {
    next(err);
  }
});

// PUT /api/staff/pricing/sets/:id — change one; every code using it follows.
staffRouter.put(
  '/pricing/sets/:id',
  requireAdmin,
  validate(idParam, 'params'),
  validate(priceSetBody),
  async (req, res, next) => {
    try {
      if (!(await updatePriceSet(Number(req.params.id), req.body))) {
        throw new ApiError(404, 'No such code price.');
      }
      res.json({ priceSets: await listPriceSets(), codes: await listCodes() });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/staff/pricing/sets/:id — refused while a code still uses it.
staffRouter.delete(
  '/pricing/sets/:id',
  requireAdmin,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      if (!(await deletePriceSet(Number(req.params.id)))) {
        throw new ApiError(404, 'No such code price.');
      }
      res.json({ priceSets: await listPriceSets(), codes: await listCodes() });
    } catch (err) {
      next(err);
    }
  },
);

const codeBody = z.object({
  code: z
    .string()
    .trim()
    .min(6)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only'),
  kind: z.enum(['group', 'newcomer']).default('group'),
  minParty: z.number().int().min(1).max(100).default(6),
  priceSetId: z.number().int().positive(),
});

// POST /api/staff/pricing/codes — add a promo code, on one of the code prices.
staffRouter.post('/pricing/codes', requireAdmin, validate(codeBody), async (req, res, next) => {
  try {
    await createCode(req.body.code, req.body.kind, req.body.minParty, req.body.priceSetId);
    res.json({ codes: await listCodes() });
  } catch (err) {
    next(err);
  }
});

const codeChangeBody = z.object({
  isActive: z.boolean().optional(),
  priceSetId: z.number().int().positive().optional(),
});

// PUT /api/staff/pricing/codes/:id — switch a code on or off, or change its price.
staffRouter.put(
  '/pricing/codes/:id',
  requireAdmin,
  validate(idParam, 'params'),
  validate(codeChangeBody),
  async (req, res, next) => {
    try {
      if (!(await updateCode(Number(req.params.id), req.body))) {
        throw new ApiError(404, 'No such code.');
      }
      res.json({ codes: await listCodes() });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/staff/pricing/codes/:id — remove a code. Bookings that used it
// keep its name.
staffRouter.delete(
  '/pricing/codes/:id',
  requireAdmin,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      if (!(await deleteCode(Number(req.params.id)))) throw new ApiError(404, 'No such code.');
      res.json({ codes: await listCodes() });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- Game hosts (admin) ----------
//
// Hosts are made from existing accounts, by email. Their hourly price is what
// customers pay for them, so only admins set it — never the host.

// GET /api/staff/hosts — every host, active first.
staffRouter.get('/hosts', requireAdmin, async (_req, res, next) => {
  try {
    res.json({ hosts: await listHostsForAdmin() });
  } catch (err) {
    next(err);
  }
});

const hostBody = z.object({
  email: z.string().trim().email().max(200),
  displayName: z.string().trim().min(1).max(60),
  bio: z.string().trim().max(400).default(''),
  photoUrl: linkish(1000),
  offersBoardGames: z.boolean(),
  offersClocktower: z.boolean(),
  offersDnd: z.boolean(),
  isActive: z.boolean().default(true),
});

// PUT /api/staff/hosts — make an account a host, or update one.
staffRouter.put('/hosts', requireAdmin, validate(hostBody), async (req, res, next) => {
  try {
    const b = req.body;
    const id = await saveHostByEmail(b.email, {
      displayName: b.displayName,
      bio: b.bio,
      photoUrl: b.photoUrl || null,
      offersBoardGames: b.offersBoardGames,
      offersClocktower: b.offersClocktower,
      offersDnd: b.offersDnd,
      isActive: b.isActive,
    });
    // Unticking Active is the other way to take a host off: same warning.
    res.json({
      hosts: await listHostsForAdmin(),
      upcoming: b.isActive ? [] : await upcomingSessions(id),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/staff/hosts/:id — remove a host (switched off instead when they
// have bookings, which must keep their name).
staffRouter.delete('/hosts/:id', requireAdmin, validate(idParam, 'params'), async (req, res, next) => {
  try {
    const result = await removeHost(Number(req.params.id));
    res.json({ ...result, hosts: await listHostsForAdmin() });
  } catch (err) {
    next(err);
  }
});

// GET /api/staff/hosts/:id/availability — a host's upcoming free times.
staffRouter.get(
  '/hosts/:id/availability',
  requireAdmin,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      res.json({ availability: await listHostAvailability(Number(req.params.id)) });
    } catch (err) {
      next(err);
    }
  },
);

const hostWindowBody = z.object({
  date: isoDate(),
  timeSlot: z.string().refine(isValidStart, 'invalid start time'),
  durationMin: z
    .number()
    .int()
    .min(60)
    .max(780)
    .refine((v) => v % 30 === 0, 'length must be in half hours'),
});

// POST /api/staff/hosts/:id/availability — add a free time for a host.
staffRouter.post(
  '/hosts/:id/availability',
  requireAdmin,
  validate(idParam, 'params'),
  validate(hostWindowBody),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await addAvailability(id, req.body.date, req.body.timeSlot, req.body.durationMin);
      res.json({ availability: await listHostAvailability(id) });
    } catch (err) {
      next(err);
    }
  },
);

const hostWindowParams = z.object({
  id: z.coerce.number().int().positive(),
  windowId: z.coerce.number().int().positive(),
});

// DELETE /api/staff/hosts/:id/availability/:windowId — always allowed; a
// session already booked inside it stays booked.
staffRouter.delete(
  '/hosts/:id/availability/:windowId',
  requireAdmin,
  validate(hostWindowParams, 'params'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await deleteAvailabilityAsStaff(id, Number(req.params.windowId));
      res.json({ availability: await listHostAvailability(id) });
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
