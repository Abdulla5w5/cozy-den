import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { isStaffUser } from '../staff/team.service';
import {
  addMessage,
  createRequest,
  getThread,
  listMyRequests,
  Status,
} from './support.service';

// Customer-facing support. Every route is account-only: a request belongs to a
// user, and ownership is checked in the query — never assumed from the UI.
export const supportRouter = Router();

const createSchema = z
  .object({
    kind: z.enum(['suggestion', 'complaint', 'question']),
    severity: z.enum(['low', 'normal', 'urgent']).optional(),
    subject: z.string().trim().min(3).max(140),
    body: z.string().trim().min(1).max(4000),
  })
  .refine((v) => v.kind === 'complaint' || v.severity === undefined, {
    message: 'Severity applies to complaints only.',
    path: ['severity'],
  });

// POST /api/support — open a new request.
supportRouter.post('/', requireAuth, validate(createSchema), async (req, res, next) => {
  try {
    const actor = { id: req.user!.sub, name: req.user!.name, email: req.user!.email };
    res.status(201).json({ request: await createRequest(actor, req.body) });
  } catch (err) {
    next(err);
  }
});

// GET /api/support — the signed-in customer's own requests.
supportRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ requests: await listMyRequests(req.user!.sub) });
  } catch (err) {
    next(err);
  }
});

// GET /api/support/:id — one thread. Staff may read any; customers only theirs.
supportRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const isStaff = await isStaffUser(req.user!.sub);
    res.json(await getThread(Number(req.params.id), { id: req.user!.sub, isStaff }));
  } catch (err) {
    next(err);
  }
});

const replySchema = z.object({ body: z.string().trim().min(1).max(4000) });

// POST /api/support/:id/messages — customer reply on their own thread.
supportRouter.post(
  '/:id/messages',
  requireAuth,
  validate(replySchema),
  async (req, res, next) => {
    try {
      const actor = { id: req.user!.sub, name: req.user!.name, email: req.user!.email };
      // Staff replying through the customer endpoint is still recorded as staff,
      // so the thread never mislabels who spoke.
      const role = (await isStaffUser(actor.id)) ? 'staff' : 'customer';
      res.status(201).json({
        message: await addMessage(Number(req.params.id), actor, role, req.body.body),
      });
    } catch (err) {
      next(err);
    }
  },
);

export const SUPPORT_STATUSES: Status[] = ['open', 'in_progress', 'resolved', 'closed'];
