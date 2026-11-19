import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { listNotifications, markRead, unreadCount } from './notify';

// The header bell. Every route is the signed-in member's own notices only.
export const notificationsRouter = Router();

// GET /api/notifications — the latest notices and the unread count.
notificationsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await listNotifications(req.user!.sub));
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/unread — just the count, for the badge.
notificationsRouter.get('/unread', requireAuth, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ unread: await unreadCount(req.user!.sub) });
  } catch (err) {
    next(err);
  }
});

const readSchema = z.object({
  // Omitted = mark everything read.
  ids: z.array(z.number().int().positive()).max(100).optional(),
});

// POST /api/notifications/read — mark some, or all, as read.
notificationsRouter.post('/read', requireAuth, validate(readSchema), async (req, res, next) => {
  try {
    await markRead(req.user!.sub, req.body.ids ?? null);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
