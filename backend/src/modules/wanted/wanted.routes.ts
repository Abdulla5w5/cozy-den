import { query } from '../../db/pool';
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import {
  attachListingCharge,
  confirmListing,
  createPost,
  finalizeListingCharge,
  holdSeats,
  listMyPosts,
  listPublicPosts,
  myInterestPostIds,
  registerInterest,
  releaseListing,
  withdrawInterest,
} from './wanted.service';
import { getWantedMember, setSubscribed, setUsername, unsubscribeByToken } from './wanted.members';
import { isRealDate } from '../../utils/dates';
import { isValidStart } from '../../utils/slots';
import { paymentProvider } from '../../payment';
import { TAP_CHARGE_EXPIRY_MINUTES } from '../../payment/constants';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';

export const wantedRouter = Router();

const createSchema = z.object({
  gameId: z.number().int().positive().max(2147483647).nullable().optional(),
  // One plain line: it goes into email subjects.
  gameName: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[^\p{Cc}]*$/u, 'Write the game name on one line.')
    .nullable()
    .optional(),
  minPlayers: z.number().int().min(1).max(50),
  maxPlayers: z.number().int().min(1).max(50),
  sessionType: z.enum(['males_only', 'females_only', 'open']),
  // The exact date the session is for. A wanted session is a one-off, not a
  // recurring event, so it names a day rather than a set of weekdays.
  sessionDate: z.string().refine(isRealDate, 'Pick the date you want to play on.'),
  startTime: z
    .string({ required_error: 'Pick a start time. Refresh the page if you do not see one.' })
    .refine(isValidStart, 'Pick a start time.'),
  // The same lengths as a table booking. The price is derived from this
  // server-side, so the client never sends a price.
  durationMin: z
    .union([z.literal(120), z.literal(180), z.literal(240), z.literal(300), z.literal(360)])
    .default(120),
  // Mandatory acknowledgment. Literal true, so a missing or false value is a
  // schema failure before it ever reaches the service.
  acknowledgmentConfirmed: z.literal(true, {
    errorMap: () => ({
      message: 'You must confirm you know this game and will lead the session.',
    }),
  }),
});

// GET /api/wanted — the public board. Approved posts, COUNTS and the poster's
// chosen username only: no names, no contact details.
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
      member: await getWantedMember(req.user!.sub),
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

const idParam = z.object({ id: z.coerce.number().int().positive().max(2147483647) });

const usernameSchema = z.object({ username: z.string().trim().min(1).max(40) });

// PUT /api/wanted/username — the name shown on the member's posts.
wantedRouter.put('/username', requireAuth, validate(usernameSchema), async (req, res, next) => {
  try {
    res.json({ username: await setUsername(req.user!.sub, req.body.username) });
  } catch (err) {
    next(err);
  }
});

const subscribeSchema = z.object({ subscribed: z.boolean() });

// PUT /api/wanted/subscription — alerts for new posts, on or off.
wantedRouter.put('/subscription', requireAuth, validate(subscribeSchema), async (req, res, next) => {
  try {
    await setSubscribed(req.user!.sub, req.body.subscribed);
    res.json({ subscribed: req.body.subscribed });
  } catch (err) {
    next(err);
  }
});

const unsubscribeSchema = z.object({ token: z.string().max(100) });

// POST /api/wanted/unsubscribe — from the link in an alert email, signed in or
// not. A POST, so a mail scanner opening the link unsubscribes nobody.
wantedRouter.post('/unsubscribe', validate(unsubscribeSchema), async (req, res, next) => {
  try {
    await unsubscribeByToken(req.body.token);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

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

// DELETE /api/wanted/:id/interest — take a registration back.
wantedRouter.delete(
  '/:id/interest',
  requireAuth,
  validate(idParam, 'params'),
  async (req, res, next) => {
    try {
      await withdrawInterest(Number(req.params.id), req.user!.sub);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- Reserving a listing ----------

const reserveSchema = z.object({
  // How many seats you are taking. One by default — you are joining a game, not
  // buying the table — and capped by what the listing has left.
  seats: z.number().int().min(1).max(50).default(1),
  // What the card showed. Left out by pages from before this.
  expected: z
    .object({
      sessionDate: z.string().max(10).nullable(),
      startTime: z.string().max(5).nullable(),
      durationMin: z.number().int(),
      perPlayerCents: z.number().int(),
    })
    .optional(),
});

/**
 * POST /api/wanted/:id/reserve — take seats on the listing and pay for them.
 *
 * Distinct from /interest, which remains what it always was: a note that you
 * would like to play. Buying a seat is a commitment with money attached, so it
 * goes through the same redirect checkout a table booking uses and is only
 * confirmed once the charge has been re-retrieved from the gateway.
 */
wantedRouter.post(
  '/:id/reserve',
  requireAuth,
  validate(idParam, 'params'),
  validate(reserveSchema),
  async (req, res, next) => {
    const postId = Number(req.params.id);
    try {
      const hold = await holdSeats(postId, req.user!.sub, req.body.seats, req.body.expected);

      if (hold.amountCents === 0) {
        if ((await confirmListing(hold.holdId, 'free')) === 'cancelled') {
          throw new ApiError(409, 'This session has just been cancelled.');
        }
        const { rows } = await query<{ checkin_token: string | null }>(
          'SELECT checkin_token FROM wanted_post_seats WHERE id = $1',
          [hold.holdId],
        );
        return res.status(201).json({ free: true, pass: rows[0]?.checkin_token ?? null });
      }
      if (!paymentProvider.createCharge) {
        await releaseListing(hold.holdId);
        throw new ApiError(500, 'Payment is not configured.');
      }

      const base = env.publicUrl || `${req.protocol}://${req.get('host')}`;
      try {
        const charge = await paymentProvider.createCharge({
          amountCents: hold.amountCents,
          currency: 'KWD',
          description:
            `Cozy Den Wanted Board — ${hold.seats} seat` +
            `${hold.seats === 1 ? '' : 's'} on listing #${postId}`,
          redirectUrl: `${base}/api/wanted/reserve/return`,
          webhookUrl: `${base}/api/wanted/reserve/webhook`,
          customer: { name: req.user!.name, email: req.user!.email },
          metadata: { holdId: String(hold.holdId) },
          expiryMinutes: TAP_CHARGE_EXPIRY_MINUTES,
        });
        // Recorded before redirecting, so a customer who pays but never comes
        // back can still be settled by the sweep.
        await attachListingCharge(hold.holdId, charge.chargeId);
        return res.status(201).json({ redirectUrl: charge.transactionUrl });
      } catch (err) {
        // Never leave seats held behind a charge that failed to open.
        await releaseListing(hold.holdId);
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
    // The QR pass, once paid: it is what staff scan at the door.
    let pass = '';
    if (outcome === 'paid') {
      const { rows } = await query<{ checkin_token: string | null }>(
        'SELECT checkin_token FROM wanted_post_seats WHERE payment_ref = $1',
        [chargeId],
      );
      pass = rows[0]?.checkin_token ?? '';
    }
    return res.redirect(
      `${site}/wanted?reserve=${outcome}${pass ? `&pass=${encodeURIComponent(pass)}` : ''}`,
    );
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
    // A 5xx makes Tap retry. Settling is idempotent, so a retry is safe, and
    // without one a payment that hit a database blip would never be settled.
    console.error('[tap] wanted reserve webhook failed', err);
    res.status(500).json({ received: false });
    return;
  }
  res.status(200).json({ received: true });
});
