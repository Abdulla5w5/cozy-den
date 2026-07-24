import { Response, Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { loginLimiter } from '../../middleware/rateLimit';
import { AUTH_COOKIE, requireAuth, signToken } from '../../middleware/auth';
import { env } from '../../config/env';
import {
  authenticateUser,
  registerUser,
  upsertGoogleUser,
  verifyGoogleToken,
  UserRow,
} from './auth.service';
import { getBookingsByEmail } from '../bookings/bookings.service';
import { isStaffUser } from '../staff/team.service';

export const authRouter = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.cookieSecure,
  maxAge: 8 * 60 * 60 * 1000,
  path: '/',
};

// Issue the session cookie and return the public user shape.
async function issueSession(res: Response, user: UserRow) {
  const token = signToken({ sub: user.id, email: user.email, name: user.name });
  res.cookie(AUTH_COOKIE, token, cookieOpts);
  return { email: user.email, name: user.name, isStaff: await isStaffUser(user.id) };
}

const registerSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200),
});

// POST /api/auth/register — universal sign up (auto-signs in).
authRouter.post('/register', loginLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const user = await registerUser(req.body.email, req.body.name, req.body.password);
    res.status(201).json({ user: await issueSession(res, user) });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

// POST /api/auth/login
authRouter.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const user = await authenticateUser(req.body.email, req.body.password);
    res.json({ user: await issueSession(res, user) });
  } catch (err) {
    next(err);
  }
});

const googleSchema = z.object({ idToken: z.string().min(10).max(5000) });

// POST /api/auth/google — verify a Google ID token, then create/login the user.
authRouter.post('/google', loginLimiter, validate(googleSchema), async (req, res, next) => {
  try {
    const g = await verifyGoogleToken(req.body.idToken);
    const user = await upsertGoogleUser(g.email, g.name);
    res.json({ user: await issueSession(res, user) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { ...cookieOpts, maxAge: undefined });
  res.json({ ok: true });
});

// GET /api/auth/bookings — the signed-in user's own booking history.
authRouter.get('/bookings', requireAuth, async (req, res, next) => {
  try {
    res.json({ bookings: await getBookingsByEmail(req.user!.email) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — current session (incl. staff flag).
authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json({
      user: {
        email: req.user!.email,
        name: req.user!.name,
        isStaff: await isStaffUser(req.user!.sub),
      },
    });
  } catch (err) {
    next(err);
  }
});
