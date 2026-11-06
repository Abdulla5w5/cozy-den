import { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { Store } from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Rate limiting is shared across instances when REDIS_URL is set; otherwise it
 * falls back to per-process memory (correct only at instance_count = 1).
 *
 * Availability beats strictness here: if Redis is unreachable the limiter fails
 * OPEN (request proceeds, un-counted) rather than 500-ing the whole API. A
 * degraded limiter is a smaller problem than an outage.
 */
type RedisClient = ReturnType<(typeof import('redis'))['createClient']>;
type RedisStoreConstructor = (typeof import('rate-limit-redis'))['RedisStore'];

let client: RedisClient | undefined;
let RedisStoreClass: RedisStoreConstructor | undefined;
let redisReady = false;

if (env.redisUrl) {
  // Redis is optional and production currently runs one API instance. Loading
  // the Redis client eagerly cost tens of MB even when REDIS_URL was unset.
  // Keep the shared-store path available for horizontal scaling, but do not
  // pay for it until it is actually configured.
  const { createClient } = require('redis') as typeof import('redis');
  ({ RedisStore: RedisStoreClass } = require('rate-limit-redis') as typeof import('rate-limit-redis'));
  client = createClient({
    url: env.redisUrl,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
    // Fail commands at once while Redis is down instead of queueing them, so
    // the limiter's fail-open path runs rather than every request hanging.
    disableOfflineQueue: true,
  });
  client.on('error', (err) => {
    if (redisReady) console.error('[ratelimit] redis error', err.message);
    redisReady = false;
  });
  client.on('ready', () => {
    redisReady = true;
    console.log('[ratelimit] redis connected — limits are shared across instances');
  });
  client.connect().catch((err) => {
    console.error('[ratelimit] redis connect failed, using in-memory limits:', err.message);
  });
}

function redisStore(prefix: string): Store | undefined {
  if (!client || !RedisStoreClass) return undefined;
  return new RedisStoreClass({
    prefix,
    sendCommand: async (...args: string[]) => client!.sendCommand(args),
  }) as unknown as Store;
}

/** Swallow store errors so a Redis outage can't take the API down. */
function failOpen(limiter: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    limiter(req, res, (err?: unknown) => {
      if (err) {
        console.error('[ratelimit] store failure, allowing request:', err);
        return next();
      }
      next();
    });
  };
}

// Generous global cap so a single client can't hammer the whole API.
/**
 * Who is asking, for counting. On App Platform every request reaches us
 * through Cloudflare and DigitalOcean's edge, so req.ip is the address of
 * whichever edge server passed it on — a different one almost every time.
 * Measured on the live site (Nov 2026): the limit counter never went below
 * 299 of 300, i.e. no limit ever applied. The edge puts the visitor's own
 * address in do-connecting-ip (overwriting anything the client sent), with
 * Cloudflare's cf-connecting-ip as a fallback; req.ip only off the platform.
 */
export function clientKey(req: Request): string {
  const header = req.headers['do-connecting-ip'] ?? req.headers['cf-connecting-ip'];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || req.ip || 'unknown';
}

export const globalLimiter = failOpen(
  rateLimit({
    keyGenerator: clientKey,
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:global:'),
    message: { error: 'Too many requests, please slow down.' },
  })
);

// Tighter cap on booking creation (writes + payment side effects).
export const bookingLimiter = failOpen(
  rateLimit({
    keyGenerator: clientKey,
    windowMs: 10 * 60 * 1000,
    max: env.bookingRateMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:booking:'),
    message: { error: 'Too many booking attempts, please try again shortly.' },
  })
);

// Promo code checks, apart from bookings so a customer comparing dates with a
// code applied never runs out of checkout attempts. Still tight enough that
// codes cannot be guessed by the thousand.
export const promoLimiter = failOpen(
  rateLimit({
    keyGenerator: clientKey,
    windowMs: 10 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:promo:'),
    message: { error: 'Too many code checks, please try again shortly.' },
  })
);

// Anything that sends an email to an address the requester types: sign-up,
// forgot-password, resend-verification. Counted whether or not it succeeds
// (those all answer 200/201), so nobody can flood a customer's inbox or burn
// the café's daily mail allowance and stop booking receipts going out.
export const mailLimiter = failOpen(
  rateLimit({
    keyGenerator: clientKey,
    windowMs: 60 * 60 * 1000,
    // Generous enough for a café's shared Wi-Fi on a busy night; the
    // once-a-minute rule per account (verification.ts, passwordReset.ts)
    // is what stops one inbox being flooded.
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:mail:'),
    message: { error: 'Too many emails requested. Please try again in an hour.' },
  })
);

// QR check-in passes. Staff scan many a night, and the café's Wi-Fi is one
// address shared with every guest on it, so a guest's traffic or mischief must
// never stop the counter. These routes sit outside the global limiter; signed
// -in staff skip the failed-lookup cap, and check-ins have their own counter.
// Failed lookups are what guessing looks like, though a 144-bit key is not
// realistically guessable, so that cap only needs to stop noise.
export const checkinLimiter = failOpen(
  rateLimit({
    keyGenerator: clientKey,
    windowMs: 10 * 60 * 1000,
    max: 300,
    skip: (req) => (req as Request & { staffViewer?: boolean }).staffViewer === true,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:checkin:'),
    message: { error: 'Too many requests, please try again shortly.' },
  })
);
export const checkinPostLimiter = failOpen(
  rateLimit({
    keyGenerator: clientKey,
    windowMs: 10 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:checkin-post:'),
    message: { error: 'Too many requests, please try again shortly.' },
  })
);
export const checkinMissLimiter = failOpen(
  rateLimit({
    keyGenerator: clientKey,
    windowMs: 10 * 60 * 1000,
    max: 60,
    skipSuccessfulRequests: true,
    // Set by the pass route once it knows a signed-in staff account is asking.
    skip: (req) => (req as Request & { staffViewer?: boolean }).staffViewer === true,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:checkin-miss:'),
    message: { error: 'Too many invalid passes. Please try again later.' },
  })
);

// Cap on login/registration to blunt credential-stuffing / brute force.
// 13 per 15 min: enough headroom for a customer fumbling a password or a typo'd
// email a few times, still far below what a brute-force run needs.
export const loginLimiter = failOpen(
  rateLimit({
    keyGenerator: clientKey,
    windowMs: 15 * 60 * 1000,
    max: 13,
    // Don't spend the budget on successful logins — only failures count, so a
    // household sharing an IP can't lock itself out by signing in normally.
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:login:'),
    message: { error: 'Too many login attempts, please try again later.' },
  })
);
