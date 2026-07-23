import { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { env } from '../config/env';

/**
 * Rate limiting is shared across instances when REDIS_URL is set; otherwise it
 * falls back to per-process memory (correct only at instance_count = 1).
 *
 * Availability beats strictness here: if Redis is unreachable the limiter fails
 * OPEN (request proceeds, un-counted) rather than 500-ing the whole API. A
 * degraded limiter is a smaller problem than an outage.
 */
type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | undefined;
let redisReady = false;

if (env.redisUrl) {
  client = createClient({
    url: env.redisUrl,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
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
  if (!client) return undefined;
  return new RedisStore({
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
export const globalLimiter = failOpen(
  rateLimit({
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
    windowMs: 10 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:booking:'),
    message: { error: 'Too many booking attempts, please try again shortly.' },
  })
);

// Strict cap on login/registration to blunt credential-stuffing / brute force.
export const loginLimiter = failOpen(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('rl:login:'),
    message: { error: 'Too many login attempts, please try again later.' },
  })
);
