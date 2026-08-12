import { z } from 'zod';
import { isValidStart, MAX_SESSION_MIN, SESSION_MIN, STEP_MIN } from '../../utils/slots';
import { isoDate } from '../../utils/dates';

// Length is validated against the specific start time in the service layer,
// where closing time and the table's other bookings are known. Here we only
// bound it to something structurally sane so nothing absurd reaches the query.
const durationMin = z
  .number()
  .int()
  .min(SESSION_MIN / 4)
  .max(MAX_SESSION_MIN)
  .refine((v) => v % STEP_MIN === 0, `duration must be a multiple of ${STEP_MIN} minutes`);

// The real ceiling is the table's capacity, checked in the service where the
// table row is loaded. This is the sanity rail.
const partySize = z.number().int().min(1).max(100);

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
  durationMin: durationMin.optional(),
  partySize: partySize.optional(),
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
  durationMin: durationMin.optional(),
  partySize: partySize.optional(),
});

export type StaffCreateBookingInput = z.infer<typeof staffCreateBookingSchema>;

export const codeParamSchema = z.object({
  code: z.string().trim().min(4).max(32),
});
