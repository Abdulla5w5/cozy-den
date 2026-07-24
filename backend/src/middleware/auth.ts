import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './error';
import { isStaffUser } from '../modules/staff/team.service';

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

// Staff is a column on users, granted from the dashboard — see
// modules/staff/team.service.ts. Checked per request so revoking access takes
// effect immediately instead of waiting out the holder's 8h session.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserClaims;
    }
  }
}

function readClaims(req: Request): UserClaims | null {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return null;
  try {
    const d = jwt.verify(token, env.jwtSecret) as unknown as UserClaims & {
      iat: number;
      exp: number;
    };
    return { sub: d.sub, email: d.email, name: d.name };
  } catch {
    return null;
  }
}

/** Any authenticated user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const claims = readClaims(req);
  if (!claims) return next(new ApiError(401, 'Authentication required'));
  req.user = claims;
  next();
}

/** Authenticated AND flagged as staff in the database. */
export async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  const claims = readClaims(req);
  if (!claims) return next(new ApiError(401, 'Authentication required'));
  try {
    if (!(await isStaffUser(claims.sub))) {
      return next(new ApiError(403, 'Staff access only.'));
    }
  } catch (err) {
    return next(err);
  }
  req.user = claims;
  next();
}
