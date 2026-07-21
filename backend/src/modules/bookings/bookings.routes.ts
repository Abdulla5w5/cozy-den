import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { bookingLimiter } from '../../middleware/rateLimit';
import { ApiError } from '../../middleware/error';
import { createBookingSchema, codeParamSchema } from './bookings.schema';
import { createBooking, getBookingByCode } from './bookings.service';

export const bookingsRouter = Router();

// POST /api/bookings — guest checkout: create + pay + confirm.
// Rate-limited because it writes and triggers a (mock) charge.
bookingsRouter.post(
  '/',
  bookingLimiter,
  validate(createBookingSchema, 'body'),
  async (req, res, next) => {
    try {
      const booking = await createBooking(req.body);
      res.status(201).json({ booking });
    } catch (err) {
      next(err);
    }
  }
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
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);
