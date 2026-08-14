import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import {
  attachListingCharge,
  confirmListing,
  createPost,
  finalizeListingCharge,
  holdListing,
  listMyPosts,
  listPublicPosts,
  myInterestPostIds,
  registerInterest,
  releaseListing,
} from './wanted.service';
import { paymentProvider } from '../../payment';
import { TAP_CHARGE_EXPIRY_MINUTES } from '../../payment/constants';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';

export const wantedRouter = Router();

const createSchema = z.object({
  gameId: z.number().int().positive().nullable().optional(),
  gameName: z.string().trim().min(1).max(160).nullable().optional(),
  minPlayers: z.number().int().min(1).max(50),
  maxPlayers: z.number().int().min(1).max(50),
  sessionType: z.enum(['males_only', 'females_only', 'open']),
  // 0 = Sunday .. 6 = Saturday. Days of the week only — a post never carries a
  // date or a time; staff arrange the actual session by hand.
  preferredDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  // Whole blocks only, exactly as a table booking. The price is derived from
  // this server-side, so the client never sends a price.
  durationMin: z.union([z.literal(120), z.literal(240), z.literal(360)]).default(120),
  // Mandatory acknowledgment. Literal true, so a missing or false value is a
  // schema failure before it ever reaches the service.
  acknowledgmentConfirmed: z.literal(true, {
    errorMap: () => ({
      message: 'You must confirm you know this game and will lead the session.',
    }),
  }),
});

// GET /api/wanted — the public board. Approved posts, interest COUNTS only:
// no names, no contact details, no poster identity.
wantedRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ posts: await listPublicPosts() });
  } catch (err) {
    next(err);
  }
});

// GET /api/wanted/mine — the member's own posts (incl. pending) and the posts
// they have registered interest in, so the UI can reflect their own state.
wantedRouter.get('/mine', requireAuth, async (req, res, next) => {
  try {
    res.json({
      posts: await listMyPosts(req.user!.sub),
      interestedIn: await myInterestPostIds(req.user!.sub),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/wanted — members only. Created as 'pending' for staff approval.
wantedRouter.post('/', requireAuth, validate(createSchema), async (req, res, next) => {
  try {
    res.status(201).json({ post: await createPost(req.user!.sub, req.body) });
  } catch (err) {
    next(err);
  }
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

// POST /api/wanted/:id/interest — register intent. Not a booking, and it
// schedules nothing; staff coordinate the session once a post fills.
wantedRouter.post(
  '/:id/interest',
  requireAuth,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      const result = await registerInterest(Number(req.params.id), {
        id: req.user!.sub,
        name: req.user!.name,
        email: req.user!.email,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------- Reserving a listing ----------

/**
 * POST /api/wanted/:id/reserve — take the listing and pay for it.
 *
 * Distinct from /interest, which remains what it always was: a note that you
 * would like to play. Reserving is a commitment with money attached, so it goes
 * through the same redirect checkout a table booking uses and is only confirmed
 * once the charge has been re-retrieved from the gateway.
 */
wantedRouter.post(
  '/:id/reserve',
  requireAuth,
  validate(idParam, 'params'),
  async (req, res, next) => {
    const postId = Number(req.params.id);
    try {
      const hold = await holdListing(postId, req.user!.sub);

      if (hold.amountCents === 0) {
        await confirmListing(postId, 'free');
        return res.status(201).json({ free: true });
      }
      if (!paymentProvider.createCharge) {
        await releaseListing(postId);
        throw new ApiError(500, 'Payment is not configured.');
      }

      const base = env.publicUrl || `${req.protocol}://${req.get('host')}`;
      try {
        const charge = await paymentProvider.createCharge({
          amountCents: hold.amountCents,
          currency: 'KWD',
          description: `Cozy Den Wanted Board listing #${postId}`,
          redirectUrl: `${base}/api/wanted/reserve/return`,
          webhookUrl: `${base}/api/wanted/reserve/webhook`,
          customer: { name: req.user!.name, email: req.user!.email },
          metadata: { postId: String(postId) },
          expiryMinutes: TAP_CHARGE_EXPIRY_MINUTES,
        });
        // Recorded before redirecting, so a customer who pays but never comes
        // back can still be settled by the sweep.
        await attachListingCharge(postId, charge.chargeId);
        return res.status(201).json({ redirectUrl: charge.transactionUrl });
      } catch (err) {
        // Never leave a listing held behind a charge that failed to open.
        await releaseListing(postId);
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/wanted/reserve/return — where Tap sends the customer's browser.
wantedRouter.get('/reserve/return', async (req, res) => {
  const site = env.publicUrl || `${req.protocol}://${req.get('host')}`;
  const chargeId = String(req.query.tap_id || '');
  if (!chargeId) return res.redirect(`${site}/wanted?reserve=error`);
  try {
    const outcome = await finalizeListingCharge(chargeId);
    return res.redirect(`${site}/wanted?reserve=${outcome}`);
  } catch (err) {
    console.error('[tap] wanted reserve return failed', err);
    return res.redirect(`${site}/wanted?reserve=error`);
  }
});

// POST /api/wanted/reserve/webhook — the reliable confirmation path.
wantedRouter.post('/reserve/webhook', async (req, res) => {
  try {
    const chargeId = String(req.body?.id || '');
    if (chargeId) await finalizeListingCharge(chargeId);
  } catch (err) {
    console.error('[tap] wanted reserve webhook failed', err);
  }
  res.status(200).json({ received: true });
});
