import { z } from 'zod';
import { isValidStart } from '../../utils/slots';
import { isoDate } from '../../utils/dates';

// Guest checkout: table only — no game pre-selection, no food/drink ordering.
// Payment is the flat table-holding fee (server-priced).
export const createBookingSchema = z.object({
  tableId: z.number().int().positive(),
  date: isoDate(),
  timeSlot: z
    .string()
    .refine(isValidStart, 'timeSlot must be a valid 30-minute start time within opening hours'),
  guestName: z.string().trim().min(1).max(120),
  guestEmail: z.string().trim().email().max(200),
  // Only the direct (mock) provider uses a client token. The redirect gateway
  // (Tap) collects payment on its own hosted page, so this is optional.
  paymentToken: z.string().min(1).max(200).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// Staff manual entry (phone/WhatsApp bookings): no payment step, contact may be
// a phone number or an email.
export const staffCreateBookingSchema = z.object({
  tableId: z.number().int().positive(),
  date: isoDate(),
  timeSlot: z
    .string()
    .refine(isValidStart, 'timeSlot must be a valid 30-minute start time within opening hours'),
  guestName: z.string().trim().min(1).max(120),
  contact: z.string().trim().min(3).max(200),
});

export type StaffCreateBookingInput = z.infer<typeof staffCreateBookingSchema>;

export const codeParamSchema = z.object({
  code: z.string().trim().min(4).max(32),
});
