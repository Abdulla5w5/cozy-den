import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { bookingLimiter } from '../../middleware/rateLimit';
import { ApiError } from '../../middleware/error';
import { env } from '../../config/env';
import { paymentProvider } from '../../payment';
import { createBookingSchema, codeParamSchema } from './bookings.schema';
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
  validate(createBookingSchema, 'body'),
  async (req, res, next) => {
    try {
      if (paymentProvider.kind === 'redirect') {
        const base = publicBase(req);
        const start = await startBookingCheckout(req.body, {
          returnUrl: `${base}/api/bookings/tap/return`,
          webhookUrl: `${base}/api/bookings/tap/webhook`,
        });
        res.status(201).json({ redirectUrl: start.redirectUrl, code: start.code });
        return;
      }
      const booking = await createBooking(req.body);
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
    const { outcome, code } = await finalizeCharge(chargeId);
    if (outcome === 'paid' && code) return res.redirect(`${site}/confirmation/${code}`);
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
// it's safe without parsing Tap's drift-prone signature. Always 200 so Tap
// doesn't retry something we've already handled.
bookingsRouter.post('/tap/webhook', async (req, res) => {
  try {
    const chargeId = String(req.body?.id || '');
    if (chargeId) await finalizeCharge(chargeId);
  } catch (err) {
    console.error('[tap] webhook handler failed', err);
  }
  res.status(200).json({ received: true });
});

// GET /api/bookings/:code — confirmation lookup. The unguessable code is the
// capability, so no auth is needed; anyone without the code cannot enumerate.
bookingsRouter.get(
  '/:code',
  validate(codeParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const booking = await getBookingByCode(req.params.code);
      if (!booking) throw new ApiError(404, 'Booking not found.');
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);
