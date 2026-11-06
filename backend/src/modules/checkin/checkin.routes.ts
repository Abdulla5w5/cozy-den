import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { optionalAuth, requireAuth, requireStaff } from '../../middleware/auth';
import {
  checkinLimiter,
  checkinMissLimiter,
  checkinPostLimiter,
} from '../../middleware/rateLimit';
import { isStaffUser } from '../staff/team.service';
import { CHECKIN_TOKEN_RE, checkIn, getPass, listMyPasses } from './checkin.service';

export const checkinRouter = Router();

const tokenParam = z.object({ token: z.string().regex(CHECKIN_TOKEN_RE, 'invalid pass') });

// GET /api/checkin/mine — a member's event and Wanted Board passes, so a pass
// can always be found again from My Bookings. Before /:token, which would
// otherwise treat "mine" as a key.
checkinRouter.get('/mine', checkinLimiter, requireAuth, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ passes: await listMyPasses(req.user!.sub) });
  } catch (err) {
    next(err);
  }
});

/** Notes whether staff are asking, before the failed-lookup limiter runs. */
async function markStaffViewer(req: Request, _res: Response, next: NextFunction) {
  try {
    (req as Request & { staffViewer?: boolean }).staffViewer = req.user
      ? await isStaffUser(req.user.sub)
      : false;
    next();
  } catch (err) {
    next(err);
  }
}

// GET /api/checkin/:token — what the scanned QR link shows. Public: anyone
// gets the basics; a signed-in staff account gets everything.
checkinRouter.get(
  '/:token',
  // Who is asking comes first, so staff are never counted: a guest on the same
  // Wi-Fi cannot use up the counter's scans. Cheap for everyone else, since a
  // missing or forged cookie never reaches the database.
  optionalAuth,
  markStaffViewer,
  checkinLimiter,
  checkinMissLimiter,
  validate(tokenParam, 'params'),
  async (req, res, next) => {
    try {
      const staff = (req as Request & { staffViewer?: boolean }).staffViewer === true;
      // Never cached: it changes the moment the guest is checked in.
      res.set('Cache-Control', 'no-store');
      res.json(await getPass(req.params.token, staff));
    } catch (err) {
      next(err);
    }
  },
);

const checkInBody = z.object({ confirmOtherNight: z.boolean().default(false) });

// POST /api/checkin/:token — staff check the guest in.
checkinRouter.post(
  '/:token',
  // Staff first, so anonymous requests cannot spend the staff's allowance.
  requireStaff,
  checkinPostLimiter,
  validate(tokenParam, 'params'),
  validate(checkInBody),
  async (req, res, next) => {
    try {
      res.json({ pass: await checkIn(req.params.token, req.body.confirmOtherNight), staff: true });
    } catch (err) {
      next(err);
    }
  },
);
