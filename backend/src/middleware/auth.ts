import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './error';

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

/** Staff = email present in the STAFF_ALLOWED_EMAILS allow-list. */
export function isStaff(email: string): boolean {
  return (
    env.staffAllowedEmails.length > 0 && env.staffAllowedEmails.includes(email.toLowerCase())
  );
}

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

/** Authenticated AND on the staff allow-list. */
export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  const claims = readClaims(req);
  if (!claims) return next(new ApiError(401, 'Authentication required'));
  if (!isStaff(claims.email)) return next(new ApiError(403, 'Staff access only.'));
  req.user = claims;
  next();
}
