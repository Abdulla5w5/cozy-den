import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { globalLimiter } from './middleware/rateLimit';
import { errorHandler, notFound } from './middleware/error';
import { tablesRouter } from './modules/tables/tables.routes';
import { gamesRouter } from './modules/games/games.routes';
import { menuRouter } from './modules/menu/menu.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { staffRouter } from './modules/staff/staff.routes';
import { authRouter } from './modules/auth/auth.routes';

export function createApp() {
  const app = express();

  // Behind a reverse proxy / load balancer that terminates TLS, trust it so
  // client IPs (rate limiting) and Secure cookies work correctly.
  app.set('trust proxy', 1);

  // Security headers.
  app.use(helmet());

  // Explicit CORS allow-list — never '*'. Credentials on so the auth cookie flows.
  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin / server-to-server tools (no Origin header).
        if (!origin) return cb(null, true);
        if (env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(globalLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/tables', tablesRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/menu', menuRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/staff', staffRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
