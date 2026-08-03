import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './error';
import { query } from '../db/pool';
import { sessionPredatesReset } from '../modules/auth/passwordReset';

export const AUTH_COOKIE = 'cd_session';

export interface UserClaims {
  sub: number; // users.id
  email: string;
  name: string;
}

export function signToken(claims: UserClaims): string {
  const options: jwt.SignOptions = {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(claims, env.jwtSecret, options);
}

// Staff and admin are columns on users, granted from the dashboard — see
// modules/staff/team.service.ts. Read per request so revoking access takes
// effect immediately instead of waiting out the holder's 8h session.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserClaims;
    }
  }
}

interface Session {
  claims: UserClaims;
  isStaff: boolean;
  isAdmin: boolean;
}

/**
 * Verify the cookie and load the account in ONE query, shared by all three
 * guards below — so a staff request costs the same single round trip it did
 * before this check existed, and an ordinary authenticated request pays for the
 * session-invalidation guarantee rather than for a separate role lookup.
 *
 * Returns null for anything that isn't a currently-valid session: no cookie, a
 * bad signature, a deleted account, or a token minted before the password was
 * reset (see modules/auth/passwordReset.ts).
 */
async function loadSession(req: Request): Promise<Session | null> {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return null;

  let decoded: UserClaims & { iat: number };
  try {
    decoded = jwt.verify(token, env.jwtSecret) as unknown as UserClaims & { iat: number };
  } catch {
    return null;
  }

  const { rows } = await query<{
    is_staff: boolean;
    is_admin: boolean;
    password_changed_at: Date | null;
  }>('SELECT is_staff, is_admin, password_changed_at FROM users WHERE id = $1', [decoded.sub]);
  const row = rows[0];
  if (!row) return null;

  // A password reset evicts every session that existed before it — including
  // the attacker's, which is the entire point of resetting.
  if (sessionPredatesReset(decoded.iat, row.password_changed_at)) return null;

  return {
    claims: { sub: decoded.sub, email: decoded.email, name: decoded.name },
    isStaff: row.is_staff === true,
    isAdmin: row.is_admin === true,
  };
}

/** Any authenticated user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await loadSession(req);
    if (!session) return next(new ApiError(401, 'Authentication required'));
    req.user = session.claims;
    next();
  } catch (err) {
    next(err);
  }
}

/** Authenticated AND flagged as staff in the database. */
export async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await loadSession(req);
    if (!session) return next(new ApiError(401, 'Authentication required'));
    if (!session.isStaff) return next(new ApiError(403, 'Staff access only.'));
    req.user = session.claims;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Authenticated AND flagged as an admin. Guards the routes that change what
 * customers are charged and who holds access. Ordinary dashboard work stays on
 * requireStaff, so this costs the counter nothing.
 */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await loadSession(req);
    if (!session) return next(new ApiError(401, 'Authentication required'));
    if (!session.isAdmin) {
      return next(new ApiError(403, 'Only an admin can change team access.'));
    }
    req.user = session.claims;
    next();
  } catch (err) {
    next(err);
  }
}
