import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import {
  createPost,
  listMyPosts,
  listPublicPosts,
  myInterestPostIds,
  registerInterest,
} from './wanted.service';

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
