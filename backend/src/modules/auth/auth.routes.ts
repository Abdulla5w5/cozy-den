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
import {
  sendVerificationEmail,
  verifyEmailToken,
  isEmailVerified,
} from './verification';

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
  return {
    email: user.email,
    name: user.name,
    isStaff: await isStaffUser(user.id),
    emailVerified: await isEmailVerified(user.id),
  };
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
    // New self-registered accounts start unverified; email the confirm link.
    void sendVerificationEmail({ id: user.id, name: user.name, email: user.email });
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
        emailVerified: await isEmailVerified(req.user!.sub),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/verify-email?token=... — the link target from the email. Marks
// the account verified, then redirects the browser to a friendly result page.
authRouter.get('/verify-email', async (req, res) => {
  const site = env.publicUrl || `${req.protocol}://${req.get('host')}`;
  const ok = await verifyEmailToken(String(req.query.token || '')).catch(() => false);
  res.redirect(`${site}/verify-email?status=${ok ? 'ok' : 'invalid'}`);
});

// POST /api/auth/resend-verification — re-send the link for the signed-in user.
authRouter.post('/resend-verification', requireAuth, async (req, res, next) => {
  try {
    if (await isEmailVerified(req.user!.sub)) {
      res.json({ alreadyVerified: true });
      return;
    }
    await sendVerificationEmail({
      id: req.user!.sub,
      name: req.user!.name,
      email: req.user!.email,
    });
    res.json({ sent: true });
  } catch (err) {
    next(err);
  }
});
