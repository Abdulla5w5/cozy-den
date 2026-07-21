import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './error';

export const AUTH_COOKIE = 'cd_session';

export interface StaffClaims {
  sub: number; // staff_users.id
  email: string;
  name: string;
}

export function signStaffToken(claims: StaffClaims): string {
  const options: jwt.SignOptions = {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(claims, env.jwtSecret, options);
}

// Extend Express Request with the authenticated staff user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffClaims;
    }
  }
}

/**
 * Require a valid staff session. The JWT is read from an httpOnly cookie
 * (not localStorage / not a JS-readable header), which keeps it out of reach
 * of XSS-based token theft.
 */
export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return next(new ApiError(401, 'Authentication required'));
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as unknown as StaffClaims & {
      iat: number;
      exp: number;
    };
    req.staff = { sub: decoded.sub, email: decoded.email, name: decoded.name };
    next();
  } catch {
    next(new ApiError(401, 'Invalid or expired session'));
  }
}
