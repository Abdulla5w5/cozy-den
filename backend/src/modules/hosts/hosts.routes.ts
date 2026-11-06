import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';
import { isoDate } from '../../utils/dates';
import { hashRetryToken, retryTokenSchema } from '../../utils/retryToken';
import { isValidStart, MAX_SESSION_MIN, SESSION_MIN } from '../../utils/slots';
import {
  addAvailability,
  getMySchedule,
  isActiveHost,
  isHostAccount,
  listAvailableOptions,
  listPublicOptions,
  removeAvailability,
} from './hosts.service';

export const hostsRouter = Router();

/** Signed in AND an active host. Hosts see only their own schedule. */
async function requireHost(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user || !(await isActiveHost(req.user.sub))) {
      return next(new ApiError(403, 'Hosts only.'));
    }
    next();
  } catch (err) {
    next(err);
  }
}

// GET /api/hosts — the host options on sale and their prices, for the home
// page. No names, and no availability: that depends on the sitting.
hostsRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ options: await listPublicOptions() });
  } catch (err) {
    next(err);
  }
});

/** Any host, active or not: enough to read their own schedule. */
async function requireHostAccount(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user || !(await isHostAccount(req.user.sub))) {
      return next(new ApiError(403, 'Hosts only.'));
    }
    next();
  } catch (err) {
    next(err);
  }
}

const availableQuery = z.object({
  date: isoDate(),
  timeSlot: z.string().refine(isValidStart, 'invalid start time'),
  durationMin: z.coerce.number().int().min(SESSION_MIN).max(MAX_SESSION_MIN),
  // The browser's checkout token: their own unfinished checkout does not use
  // up the host they would get.
  retry: retryTokenSchema,
});

// GET /api/hosts/available — the options with a host free for this whole
// sitting. Public: the booking page shows them. Empty inside 24 hours.
hostsRouter.get('/available', validate(availableQuery, 'query'), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof availableQuery>;
    res.json({
      options: await listAvailableOptions(
        q.date,
        q.timeSlot,
        Number(q.durationMin),
        hashRetryToken(q.retry),
      ),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/hosts/me — the signed-in host's profile, free times and sessions.
hostsRouter.get('/me', requireAuth, requireHostAccount, async (req, res, next) => {
  try {
    res.json(await getMySchedule(req.user!.sub));
  } catch (err) {
    next(err);
  }
});

const windowBody = z.object({
  date: isoDate(),
  timeSlot: z.string().refine(isValidStart, 'invalid start time'),
  // In hours of whole 30 minutes, from one hour to the whole service night.
  durationMin: z
    .number()
    .int()
    .min(60)
    .max(780)
    .refine((v) => v % 30 === 0, 'length must be in half hours'),
});

// POST /api/hosts/me/availability — add a window the host is free.
hostsRouter.post(
  '/me/availability',
  requireAuth,
  requireHost,
  validate(windowBody),
  async (req, res, next) => {
    try {
      await addAvailability(req.user!.sub, req.body.date, req.body.timeSlot, req.body.durationMin);
      res.json(await getMySchedule(req.user!.sub));
    } catch (err) {
      next(err);
    }
  },
);

const idParam = z.object({ id: z.coerce.number().int().positive() });

// DELETE /api/hosts/me/availability/:id — remove one, if nobody booked it.
hostsRouter.delete(
  '/me/availability/:id',
  requireAuth,
  requireHostAccount,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      await removeAvailability(req.user!.sub, Number(req.params.id));
      res.json(await getMySchedule(req.user!.sub));
    } catch (err) {
      next(err);
    }
  },
);
