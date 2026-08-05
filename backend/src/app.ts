import express from 'express';
import fs from 'fs';
import helmet from 'helmet';
import path from 'path';
import cors, { CorsOptions } from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { globalLimiter } from './middleware/rateLimit';
import { errorHandler, notFound } from './middleware/error';
import { tablesRouter } from './modules/tables/tables.routes';
import { gamesRouter } from './modules/games/games.routes';
import { menuRouter } from './modules/menu/menu.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { staffRouter } from './modules/staff/staff.routes';
import { supportRouter } from './modules/support/support.routes';
import { authRouter } from './modules/auth/auth.routes';
import { eventsRouter } from './modules/events/events.routes';
import { historyRouter } from './modules/history/history.routes';
import { promoRouter } from './modules/promo/promo.routes';
import { wantedRouter } from './modules/wanted/wanted.routes';

function isSameOriginRequest(origin: string, req: express.Request) {
  const host = req.get('host');
  if (!host) return false;
  return origin === `${req.protocol}://${host}`;
}

export function createApp() {
  const app = express();

  // Behind a reverse proxy / load balancer that terminates TLS, trust it so
  // client IPs (rate limiting) and Secure cookies work correctly.
  app.set('trust proxy', 1);

  // Security headers apply to both the API and the production SPA. The Google
  // Identity script/frame are the only third-party executable origins needed
  // by the frontend; images remain https-capable because staff can publish
  // externally hosted event and promotion artwork.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://accounts.google.com'],
          frameSrc: ["'self'", 'https://accounts.google.com'],
          connectSrc: ["'self'", 'https://accounts.google.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          frameAncestors: ["'none'"],
        },
      },
    })
  );

  // Explicit CORS allow-list — never '*'. Credentials on so the auth cookie flows.
  app.use(
    cors((req, cb) => {
      const origin = req.header('Origin');
      const options: CorsOptions = {
        origin: (origin && (env.corsOrigins.includes(origin) || isSameOriginRequest(origin, req))) || !origin,
        credentials: true,
      };
      if (options.origin) return cb(null, options);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    })
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  // Static assets should never consume the API request budget.
  app.use('/api', globalLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/tables', tablesRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/menu', menuRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/promo', promoRouter);
  app.use('/api/wanted', wantedRouter);
  app.use('/api/support', supportRouter);
  app.use('/api/staff', staffRouter);

  // Keep unknown API routes JSON-only; they must not fall through to the SPA.
  app.use('/api', notFound);

  // In production the React build is created alongside the backend and served
  // by this process, so Helmet protects the HTML as well as the API. During
  // backend-only development/deployments the directory is absent and the API
  // continues to work normally.
  const frontendDist = path.resolve(process.cwd(), 'frontend/dist');
  const frontendIndex = path.join(frontendDist, 'index.html');
  if (fs.existsSync(frontendIndex)) {
    app.use(
      express.static(frontendDist, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath === frontendIndex) {
            res.setHeader('Cache-Control', 'no-store');
            return;
          }
          // Vite filenames under /assets contain a content hash, so a changed
          // deployment always gets a new URL. Let browsers and Cloudflare keep
          // those immutable JS/CSS files instead of asking this Node process on
          // every visit. Unversioned images/fonts retain Express's safe default.
          const relative = path.relative(frontendDist, filePath);
          if (relative.startsWith(`assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(frontendIndex);
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
