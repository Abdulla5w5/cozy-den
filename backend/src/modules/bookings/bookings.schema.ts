import { z } from 'zod';
import { TIME_SLOTS } from '../../utils/slots';

// Guest checkout: only name + email required. No account.
export const createBookingSchema = z.object({
  tableId: z.number().int().positive(),
  gameId: z.number().int().positive().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  timeSlot: z.enum(TIME_SLOTS),
  guestName: z.string().trim().min(1).max(120),
  guestEmail: z.string().trim().email().max(200),
  items: z
    .array(
      z.object({
        menuItemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(50),
      })
    )
    .max(100)
    .default([]),
  // Opaque token from the (mock) payment UI. Real gateways hand back a token
  // that the server exchanges for a charge — the server never sees card data.
  paymentToken: z.string().min(1).max(200),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const codeParamSchema = z.object({
  code: z.string().trim().min(4).max(32),
});
