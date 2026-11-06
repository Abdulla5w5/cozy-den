import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { bookingLimiter, promoLimiter } from '../../middleware/rateLimit';
import { ApiError } from '../../middleware/error';
import { env } from '../../config/env';
import { paymentProvider } from '../../payment';
import { z } from 'zod';
import { createBookingSchema, codeParamSchema } from './bookings.schema';
import {
  activeNewcomerCode,
  codeRefusal,
  findActiveCode,
  hasBookedBefore,
} from '../promo/codes.service';
import { optionalAuth } from '../../middleware/auth';
import { getCodeFee } from '../../utils/pricing';
import { isoDate } from '../../utils/dates';
import {
  createBooking,
  finalizeCharge,
  getBookingByCode,
  startBookingCheckout,
} from './bookings.service';

export const bookingsRouter = Router();

// Absolute base for gateway redirect/webhook URLs. Falls back to the request
// origin in dev if PUBLIC_URL is unset.
function publicBase(req: { protocol: string; get(h: string): string | undefined }): string {
  return env.publicUrl || `${req.protocol}://${req.get('host')}`;
}

// POST /api/bookings — guest checkout.
// Direct provider (mock): create + charge + confirm synchronously, return the
// booking. Redirect provider (Tap): reserve + open a charge, return a
// redirectUrl the frontend sends the browser to.
bookingsRouter.post(
  '/',
  bookingLimiter,
  optionalAuth,
  validate(createBookingSchema, 'body'),
  async (req, res, next) => {
    try {
      if (paymentProvider.kind === 'redirect') {
        const base = publicBase(req);
        const start = await startBookingCheckout(req.body, {
          returnUrl: `${base}/api/bookings/tap/return`,
          webhookUrl: `${base}/api/bookings/tap/webhook`,
        }, req.user);
        // A retry can discover that the earlier attempt actually succeeded. Hand
        // back that booking rather than a second payment page.
        if (start.booking) {
          res.status(201).json({ booking: start.booking });
          return;
        }
        res.status(201).json({ redirectUrl: start.redirectUrl, code: start.code });
        return;
      }
      const booking = await createBooking(req.body, req.user);
      res.status(201).json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/bookings/tap/return — Tap redirects the customer's browser here with
// ?tap_id=chg_xxx after they pay. We verify with Tap, then bounce the browser
// to the confirmation (or the booking page with an error). Public by design —
// it trusts nothing from the query beyond the charge id, which it re-verifies.
bookingsRouter.get('/tap/return', async (req, res) => {
  const site = env.publicUrl || `${req.protocol}://${req.get('host')}`;
  const chargeId = String(req.query.tap_id || '');
  if (!chargeId) return res.redirect(`${site}/book?payment=error`);
  try {
    const { outcome, code } = await finalizeCharge(chargeId, 'return');
    if (outcome === 'paid' && code) return res.redirect(`${site}/confirmation/${code}`);
    if (outcome === 'review') return res.redirect(`${site}/book?payment=review`);
    if (outcome === 'pending') return res.redirect(`${site}/book?payment=pending`);
    return res.redirect(`${site}/book?payment=failed`);
  } catch (err) {
    console.error('[tap] return handler failed', err);
    return res.redirect(`${site}/book?payment=error`);
  }
});

// POST /api/bookings/tap/webhook — Tap's server-to-server notification. The
// reliable confirmation path: it fires even if the customer closes the tab
// before the redirect. We re-verify with Tap rather than trusting the body, so
// it's safe without parsing Tap's drift-prone signature. 200 once handled, so
// Tap stops; 500 if handling failed, so Tap tries again.
bookingsRouter.post('/tap/webhook', async (req, res) => {
  try {
    const chargeId = String(req.body?.id || '');
    if (chargeId) await finalizeCharge(chargeId, 'webhook');
  } catch (err) {
    // A 5xx makes Tap retry. Settling is idempotent, so a retry is safe, and
    // without one a payment that hit a database blip would never be settled.
    console.error('[tap] webhook handler failed', err);
    res.status(500).json({ received: false });
    return;
  }
  res.status(200).json({ received: true });
});

const promoCheckQuery = z.object({
  code: z.string().trim().min(1).max(40),
  date: isoDate(),
});

// GET /api/bookings/newcomer-offer — the newcomer code for the site banner;
// null when staff have switched it off, or for a member who has booked before.
bookingsRouter.get('/newcomer-offer', optionalAuth, async (req, res, next) => {
  try {
    if (req.user && (await hasBookedBefore(req.user.email))) {
      res.json({ offer: null });
      return;
    }
    const c = await activeNewcomerCode();
    res.json({ offer: c ? { code: c.code, percentOff: c.percentOff } : null });
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/promo-check?code=&date= — is this promo code valid, and
// what does it charge on that date (its percentage, or its hourly prices: null
// on a day it has none, or a holiday priced by hand)? Display only: checkout checks the code again. Rate-limited with
// bookings so codes cannot be guessed by the thousand. Registered before
// /:code, which would otherwise swallow it.
bookingsRouter.get(
  '/promo-check',
  promoLimiter,
  optionalAuth,
  validate(promoCheckQuery, 'query'),
  async (req, res, next) => {
    try {
      const found = await findActiveCode(String(req.query.code));
      if (!found) throw new ApiError(404, 'That promo code is not valid.');
      // A newcomer code is refused up front (signed out, or booked before).
      // A group code's size rule is left to the page, since the party can
      // still change there.
      const refusal =
        found.kind === 'newcomer' ? await codeRefusal(found, 1, req.user) : null;
      res.json({
        code: found.code,
        kind: found.kind,
        minParty: found.minParty,
        percentOff: found.percentOff,
        refusal: refusal?.code ?? null,
        fee: found.hourly ? await getCodeFee(found.hourly, String(req.query.date)) : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/bookings/:code — confirmation lookup. The unguessable code is the
// capability, so no auth is needed; anyone without the code cannot enumerate.
bookingsRouter.get(
  '/:code',
  validate(codeParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const booking = await getBookingByCode(req.params.code);
      if (!booking) throw new ApiError(404, 'Booking not found.');
      // Carries the QR pass key, so never kept by a cache along the way.
      res.set('Cache-Control', 'no-store');
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);
