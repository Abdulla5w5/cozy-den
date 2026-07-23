import { z } from 'zod';
import { isValidStart } from '../../utils/slots';

// Guest checkout: table only — no game pre-selection, no food/drink ordering.
// Payment is the flat table-holding fee (server-priced).
export const createBookingSchema = z.object({
  tableId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  timeSlot: z
    .string()
    .refine(isValidStart, 'timeSlot must be a valid 30-minute start time within opening hours'),
  guestName: z.string().trim().min(1).max(120),
  guestEmail: z.string().trim().email().max(200),
  // Opaque token from the (mock) payment UI for the table-holding fee.
  paymentToken: z.string().min(1).max(200),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// Staff manual entry (phone/WhatsApp bookings): no payment step, contact may be
// a phone number or an email.
export const staffCreateBookingSchema = z.object({
  tableId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
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
