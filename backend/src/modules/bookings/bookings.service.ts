import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';
import { generateVerificationCode } from '../../utils/code';
import { billableSeats, MAX_PARTY, minSeatsFor, quoteBooking } from '../../utils/pricing';
import { currentSlot, isValidDuration, minDurationFor, slotHasStarted } from '../../utils/slots';
import { isShareable, SHARE_PARTY_MAX, SHARE_PARTY_MIN } from '../../utils/share';
import { paymentProvider } from '../../payment';
import { TAP_CHARGE_EXPIRY_MINUTES } from '../../payment/constants';
import {
  attachPayment,
  expirePaymentHold,
  getPaymentContext,
  PaymentObservationSource,
  recordPaymentObservation,
} from '../../payment/ledger';
import { mailer, formatReceiptEmail, formatStaffBookingAlert } from '../../notifications/mailer';
import { bookingAlertRecipients } from '../../notifications/staffRecipients';
import { BookingChanges, CreateBookingInput, StaffCreateBookingInput } from './bookings.schema';
import { normalizeKuwaitiPhone } from '../../utils/phone';
import { findCode, resolvePromoCode } from '../promo/codes.service';
import { getAvailability } from '../tables/tables.service';
import { hashRetryToken } from '../../utils/retryToken';
import { assignHost, hostEmailForBooking, hostFeeCents, HostKind } from '../hosts/hosts.service';
import { ensureCheckinToken, newCheckinToken } from '../checkin/checkin.service';

// Legacy line items are still surfaced for pre-overhaul bookings; new bookings
// have none (menu ordering was removed from checkout).
export interface BookingItemView {
  menuItemId: number;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface BookingView {
  id: number;
  tableId: number;
  tableLabel: string;
  date: string;
  timeSlot: string;
  guestName: string;
  /** Absent on a booking made without an account. */
  guestEmail: string | null;
  guestPhone: string | null;
  verificationCode: string;
  status: string;
  source: string;
  tableFeeCents: number;
  durationMin: number;
  partySize: number;
  totalCents: number;
  /** The private game host on this booking, if any, and their fee. The option
   *  is what the customer chose; the name is who was assigned. */
  hostKind: HostKind | null;
  hostName: string | null;
  hostFeeCents: number;
  /** The QR check-in pass key (migration 050). Only ever given to whoever
   *  already holds the booking: its code, its account, or staff. */
  checkinToken: string | null;
  items: BookingItemView[];
  createdAt: string;
}

function yesterdayIso(): string {
  return new Date(Date.now() - 864e5).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function assertTableExists(
  tableId: number,
  { activeOnly = true }: { activeOnly?: boolean } = {},
  // Inside a transaction, pass its client: asking the pool for a second session
  // while holding one can leave every session waiting on the others.
  db: Pick<PoolClient, 'query'> | null = null,
): Promise<{ capacity: number; minParty: number | null }> {
  // A retired table is hidden from availability, but a stale page or a
  // hand-made request could still name it — so customers are refused here.
  // Staff entering a booking by hand may still use one.
  const sql = `SELECT id, capacity, min_party FROM tables WHERE id = $1 ${activeOnly ? 'AND is_active' : ''}`;
  const { rows } = db
    ? await db.query<{ id: number; capacity: number; min_party: number | null }>(sql, [tableId])
    : await query<{ id: number; capacity: number; min_party: number | null }>(sql, [tableId]);
  if (!rows[0]) throw new ApiError(404, 'Table not found.');
  return { capacity: rows[0].capacity, minParty: rows[0].min_party };
}

/**
 * Insert a booking for the whole table, or for whichever half of it is free.
 * Each half is tried in turn and the database decides: it refuses any overlap,
 * so two groups racing for the last half cannot both get it.
 */
async function insertSitting(p: InsertParams, share: boolean): Promise<number> {
  if (!share) return insertBooking(p);
  for (const half of [1, 2] as const) {
    try {
      return await insertBooking({ ...p, half });
    } catch (err) {
      if (!(err instanceof ApiError && err.message === ALREADY_BOOKED)) throw err;
    }
  }
  throw new ApiError(409, ALREADY_BOOKED);
}

/**
 * Settle the customer's chosen length and headcount against what this table on
 * this evening can actually take.
 *
 * Both arrive optional and both have defaults, so an older client that sends
 * neither still books exactly the 2-hour, single-guest session it always did.
 * Neither value is trusted: the length is checked against closing time, and the
 * headcount against the table's real capacity, so a tampered request cannot
 * hold a table past close or seat twelve people at a four-top.
 *
 * The headcount also drives the price, since seats are what is charged for. It
 * is returned alongside `billedSeats` — the same number, except on the large
 * tables, which carry a minimum charge a smaller party still pays.
 */
function resolveSitting(
  timeSlot: string,
  { capacity, minParty }: { capacity: number; minParty: number | null },
  durationMin?: number,
  partySize?: number,
  { maxParty = Infinity, share = false }: { maxParty?: number; share?: boolean } = {},
): { durationMin: number; partySize: number; billedSeats: number } {
  const duration = durationMin ?? minDurationFor(timeSlot);
  if (!isValidDuration(timeSlot, duration)) {
    throw new ApiError(400, 'That length is not available for the start time you picked.');
  }
  // Half a big table, for a small group: charged per person, with no table minimum.
  if (share) {
    if (!isShareable(capacity)) throw new ApiError(400, 'This table cannot be shared.');
    const group = partySize ?? SHARE_PARTY_MIN;
    if (group < SHARE_PARTY_MIN || group > SHARE_PARTY_MAX) {
      throw new ApiError(
        400,
        `A shared half is for ${SHARE_PARTY_MIN} or ${SHARE_PARTY_MAX} people.`,
      );
    }
    return { durationMin: duration, partySize: group, billedSeats: group };
  }
  const party = partySize ?? minSeatsFor(capacity, minParty);
  if (party > capacity) {
    throw new ApiError(400, `That table seats ${capacity}.`);
  }
  if (party > maxParty) {
    throw new ApiError(
      400,
      `Online bookings are for up to ${maxParty} people. Contact us for a bigger group.`,
    );
  }
  // A big table is not worth taking out of service for a pair, so each size
  // carries a minimum party. Enforced here rather than only in the form, since
  // seats are what is charged for. The message names the shortfall and points
  // at the way out, because "no" on its own leaves the customer stuck.
  const floor = minSeatsFor(capacity, minParty);
  if (party < floor) {
    throw new ApiError(
      400,
      `This ${capacity}-seat table is for parties of ${floor} or more. ` +
        `Pick a smaller table for ${party}.`,
    );
  }
  return { durationMin: duration, partySize: party, billedSeats: billableSeats(capacity, party, minParty) };
}

interface InsertParams {
  tableId: number;
  date: string;
  timeSlot: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  status: 'pending_payment' | 'pending';
  source: 'online' | 'staff_manual';
  feeCents: number;
  totalCents: number;
  durationMin: number;
  partySize: number;
  staffNotes?: string | null;
  /** 1 or 2 for half of a shared table; absent for the whole table. */
  half?: 1 | 2 | null;
  /** Customer bookings only; staff-entered ones never see the terms. */
  termsAccepted?: boolean;
  /** The group promo code the price was worked out with, if any. */
  promoCode?: string | null;
  /** Took a newcomer discount — at most one per customer (migration 045). */
  newcomerDiscount?: boolean;
  /** The signed-in account that made it, if any (migration 047). */
  userId?: number | null;
  /** SHA-256 of the browser's checkout token (migration 048). */
  retryTokenHash?: string | null;
  /** A private game host, and their fee for this sitting (migration 049). */
  hostId?: number | null;
  hostKind?: HostKind | null;
  hostFeeCents?: number;
}

const ALREADY_BOOKED = 'That table is already booked for an overlapping session.';

/**
 * Insert a booking row. The bookings_no_overlap exclusion constraint makes the
 * 2-hour-window reservation atomic — a concurrent overlapping insert loses with
 * SQLSTATE 23P01, which we surface as a 409.
 *
 * Two other outcomes are retried rather than thrown:
 *
 *  - 23505, the astronomically-rare verification-code collision.
 *
 *  - 40P01 / 40001, deadlock and serialisation failure. When several customers
 *    race for the SAME window, Postgres takes speculative locks while testing
 *    the exclusion constraint and can pick a deadlock victim instead of
 *    reporting a plain conflict. Measured with ten simultaneous bookings on one
 *    slot: one won and NINE came back as deadlocks. No double booking — the
 *    constraint held — but nine customers saw "Internal server error" when the
 *    honest answer was "someone just took it". Retrying resolves it: by the
 *    second attempt the winner has committed, so the constraint reports a clean
 *    conflict and the customer gets a 409.
 *
 * The backoff is jittered so retrying clients do not simply collide again.
 */
async function insertBooking(p: InsertParams): Promise<number> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateVerificationCode();
    try {
      const { rows } = await query<{ id: number }>(
        `INSERT INTO bookings
           (table_id, booking_date, time_slot, guest_name, guest_email, guest_phone,
            verification_code, status, source, table_fee_cents, items_total_cents, total_cents,
            duration_min, party_size, terms_accepted_at, promo_code, newcomer_discount, user_id,
            retry_token_hash, host_id, host_fee_cents, checkin_token, host_kind, staff_notes, half)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,
                 CASE WHEN $14 THEN now() END, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
         RETURNING id`,
        [p.tableId, p.date, p.timeSlot, p.guestName, p.guestEmail, p.guestPhone, code, p.status, p.source, p.feeCents, p.totalCents, p.durationMin, p.partySize, p.termsAccepted === true, p.promoCode ?? null, p.newcomerDiscount === true, p.userId ?? null, p.retryTokenHash ?? null, p.hostId ?? null, p.hostFeeCents ?? 0, newCheckinToken(), p.hostKind ?? null, p.staffNotes || null, p.half ?? null]
      );
      return rows[0].id;
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code === '23P01' && e.constraint === 'bookings_no_overlap') {
        throw new ApiError(409, ALREADY_BOOKED);
      }
      if (e.code === '23P01' && e.constraint === 'bookings_host_no_overlap') {
        throw new ApiError(409, 'That host was just booked for this time. Please try again.');
      }
      if (e.code === '23505' && e.constraint?.startsWith('bookings_newcomer_')) {
        throw new ApiError(
          400,
          'This code is for your first booking only. If you just started a checkout with it, ' +
            'finish paying there, or try again in about 20 minutes.',
        );
      }
      if (e.code === '23505') continue; // verification_code collision — retry
      if (e.code === '40P01' || e.code === '40001') {
        if (attempt === MAX_ATTEMPTS - 1) {
          // Still contended after five tries. Someone else is winning this
          // window, so say so plainly rather than blaming the server.
          throw new ApiError(409, ALREADY_BOOKED);
        }
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 30));
        continue;
      }
      throw err;
    }
  }
  throw new ApiError(500, 'Could not allocate a unique verification code.');
}

/**
 * Guest checkout: table only. Flow (never charge without a reserved window,
 * never strand a charge):
 *   1. Reserve the 2h window with a 'pending_payment' row (atomic via the
 *      exclusion constraint).
 *   2. Charge the flat table-holding fee via the configured provider.
 *   3. Success -> 'pending' (awaiting arrival); decline -> 'cancelled' (frees
 *      the window) and 402.
 */
export async function createBooking(
  input: CreateBookingInput,
  account?: { sub: number; email: string },
): Promise<BookingView> {
  if (input.date < todayIso()) throw new ApiError(400, 'Cannot book a date in the past.');
  // The date check alone let any slot on today through, hours after it began.
  // The availability list already hides these; this is the rule itself, for a
  // page left open past the slot or a request that never saw that list.
  // (Staff bookings may use the half hour running now: a walk-in for the 16:00
  // slot is recorded at 16:10.)
  if (slotHasStarted(input.date, input.timeSlot)) {
    throw new ApiError(400, 'That time has already passed. Please pick a later slot.');
  }
  const table = await assertTableExists(input.tableId);

  if (input.share && input.hostKind) {
    throw new ApiError(400, 'A game host is for a whole table, not a shared half.');
  }
  const sitting = resolveSitting(input.timeSlot, table, input.durationMin, input.partySize, {
    maxParty: MAX_PARTY,
    share: input.share === true,
  });
  const promo = await resolvePromoCode(
    input.promoCode,
    sitting.partySize,
    account,
    input.guestPhone,
  );
  if (promo?.kind === 'newcomer' && account) {
    await releaseOwnNewcomerHolds(account.email);
  }
  const quote = await quoteBooking(
    input.date,
    input.timeSlot,
    sitting.durationMin,
    sitting.billedSeats,
    {
      hourly: promo?.hourly ?? null,
      percentOff: promo?.percentOff ?? 0,
    },
  );
  if (input.hostKind) {
    await releaseOwnHostHolds(
      input.hostKind,
      account?.sub ?? null,
      hashRetryToken(input.retryToken),
      { date: input.date, timeSlot: input.timeSlot, durationMin: sitting.durationMin },
    );
  }
  // A private host, if asked for: the option's hourly price for this sitting,
  // for the whole group, on top of the seats. Checked here, never taken from
  // the request — availability, the 24-hour notice and the price.
  const host = input.hostKind
    ? await assignHost(input.hostKind, input.date, input.timeSlot, sitting.durationMin)
    : null;
  const hostFee = host ? hostFeeCents(host.hourlyCents, sitting.durationMin) : 0;
  const feeCents = quote.totalCents + hostFee;
  const bookingId = await insertSitting({
    tableId: input.tableId,
    date: input.date,
    timeSlot: input.timeSlot,
    guestName: input.guestName,
    // A newcomer code is tied to the account, so its booking is too — or the
    // same account could use it again.
    // The account's own email, never one typed into the request: it decides
    // whose history the booking joins, who gets the receipt, and whether the
    // newcomer discount has been used. A booking without an account has none.
    guestEmail: account ? account.email : null,
    userId: account ? account.sub : null,
    retryTokenHash: hashRetryToken(input.retryToken),
    guestPhone: input.guestPhone,
    durationMin: sitting.durationMin,
    partySize: sitting.partySize,
    status: 'pending_payment',
    source: 'online',
    termsAccepted: input.acceptedTerms,
    // Only recorded when it actually changed the price.
    promoCode: quote.codePrices || quote.percentOff > 0 ? promo?.code : null,
    newcomerDiscount:
      promo?.kind === 'newcomer' && (quote.codePrices || quote.percentOff > 0),
    hostId: host?.hostId ?? null,
    hostKind: input.hostKind ?? null,
    hostFeeCents: hostFee,
    feeCents,
    totalCents: feeCents,
  }, input.share === true);

  const charge = await paymentProvider.charge({
    amountCents: feeCents,
    currency: 'KWD',
    paymentToken: input.paymentToken ?? '',
    description: `Cozy Den table-holding fee, booking #${bookingId}`,
    metadata: { bookingId: String(bookingId) },
  });

  try {
    await attachPayment({
      bookingId,
      provider: paymentProvider.name,
      chargeId: charge.reference,
      providerStatus: charge.success ? 'CAPTURED' : 'DECLINED',
      requestedAmountMillis: feeCents * 10,
      currency: 'KWD',
      state: charge.success ? 'captured' : 'failed',
      source: 'direct',
    });
  } catch (err) {
    await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    throw err;
  }

  if (!charge.success) {
    await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    throw new ApiError(402, charge.declineReason || 'Payment was declined.');
  }

  await query(`UPDATE bookings SET status = 'pending' WHERE id = $1`, [bookingId]);

  const view = await getBookingById(bookingId);
  if (!view) throw new ApiError(500, 'Booking vanished after creation.');
  announceConfirmed(view);
  return view;
}

// Fire-and-forget receipt; a mail failure must never fail a paid booking. A
// booking made without an account has no email, and so no receipt: its code is
// on the confirmation page.
function sendReceipt(view: BookingView) {
  if (!view.guestEmail) return;
  const email = formatReceiptEmail({
    ...view,
    passUrl: env.publicUrl && view.checkinToken ? `${env.publicUrl}/c/${view.checkinToken}` : null,
  });
  mailer
    .send({ to: view.guestEmail, subject: email.subject, text: email.text })
    .catch((e) => console.error('[mailer] failed to send receipt', e));
}

// Fire-and-forget, like the receipt: tells every staff account a customer has
// just booked and paid. Staff-entered bookings never come through here — the
// person who typed it in already knows.
function alertStaff(view: BookingView) {
  const email = formatStaffBookingAlert(
    view,
    env.publicUrl ? `${env.publicUrl}/staff/dashboard` : undefined,
  );
  bookingAlertRecipients()
    .then((recipients) =>
      Promise.all(
        recipients.map((to) =>
          mailer
            .send({ to, subject: email.subject, text: email.text })
            .catch((e) => console.error('[mailer] failed to send staff booking alert', { to, e })),
        ),
      ),
    )
    .catch((e) => console.error('[mailer] staff booking alert failed', e));
}

/** Everything that happens once a customer booking is confirmed and paid. */
function announceConfirmed(view: BookingView) {
  sendReceipt(view);
  alertStaff(view);
  if (view.hostName) alertHost(view);
}

// Fire-and-forget: tells the host a group has booked them. The group's phone
// is included so the host can reach them; the booking code is not.
function alertHost(view: BookingView) {
  hostEmailForBooking(view.id)
    .then((host) => {
      if (!host) return;
      return mailer.send({
        to: host.email,
        subject: `[Cozy Den] You're booked: ${view.date} ${view.timeSlot}, ${view.tableLabel}`,
        text: [
          `Hi ${host.name},`,
          '',
          view.hostKind === 'clocktower'
            ? 'A group has booked you as their Blood on the Clocktower host.'
            : 'A group has booked you as their game host.',
          '',
          `Date:  ${view.date}`,
          `Start: ${view.timeSlot}, for ${view.durationMin / 60} hours`,
          `Table: ${view.tableLabel}`,
          `Group: ${view.guestName}, ${view.partySize} ${view.partySize === 1 ? 'player' : 'players'}`,
          ...(view.guestPhone ? [`Phone: ${view.guestPhone}`] : []),
          '',
          'Your schedule is on the site under "My host schedule".',
        ].join('\n'),
      });
    })
    .catch((e) => console.error('[mailer] failed to send host alert', e));
}

export interface CheckoutStart {
  /** Send the customer's browser here to pay. */
  redirectUrl?: string;
  /** So the caller can build the eventual /confirmation/{code} link. */
  code: string;
  /** Set instead of redirectUrl when this exact session turns out to be paid
   *  for already — the customer's earlier attempt did go through, and they came
   *  back to try again not knowing that. Show them the booking, do not charge
   *  them twice. */
  booking?: BookingView;
}

/**
 * Redirect checkout (Tap). Reserve the window as 'pending_payment', open a
 * gateway charge, and hand back the hosted-payment URL. The booking is NOT
 * confirmed here — that happens in finalizeCharge() once the customer has paid
 * and we've verified it with the gateway.
 */
export async function startBookingCheckout(
  input: CreateBookingInput,
  base: { returnUrl: string; webhookUrl: string },
  account?: { sub: number; email: string },
): Promise<CheckoutStart> {
  if (!paymentProvider.createCharge || !paymentProvider.retrieveCharge) {
    throw new ApiError(500, 'Configured payment provider does not support redirect checkout.');
  }
  if (input.date < todayIso()) throw new ApiError(400, 'Cannot book a date in the past.');
  // The date check alone let any slot on today through, hours after it began.
  // The availability list already hides these; this is the rule itself, for a
  // page left open past the slot or a request that never saw that list.
  // (Staff bookings may use the half hour running now: a walk-in for the 16:00
  // slot is recorded at 16:10.)
  if (slotHasStarted(input.date, input.timeSlot)) {
    throw new ApiError(400, 'That time has already passed. Please pick a later slot.');
  }
  const table = await assertTableExists(input.tableId);

  // A retry after a failed payment attempt must not be blocked by the wreckage
  // of that attempt. Runs before the insert, so the window is already free.
  const alreadyPaid = await resolveOwnStaleHold({
    tableId: input.tableId,
    date: input.date,
    timeSlot: input.timeSlot,
    guestPhone: input.guestPhone,
    accountEmail: account?.email ?? null,
    accountId: account?.sub ?? null,
    retryTokenHash: hashRetryToken(input.retryToken),
  });
  if (alreadyPaid) return { code: alreadyPaid.verificationCode, booking: alreadyPaid };

  if (input.share && input.hostKind) {
    throw new ApiError(400, 'A game host is for a whole table, not a shared half.');
  }
  const sitting = resolveSitting(input.timeSlot, table, input.durationMin, input.partySize, {
    maxParty: MAX_PARTY,
    share: input.share === true,
  });
  const promo = await resolvePromoCode(
    input.promoCode,
    sitting.partySize,
    account,
    input.guestPhone,
  );
  if (promo?.kind === 'newcomer' && account) {
    await releaseOwnNewcomerHolds(account.email);
  }
  const quote = await quoteBooking(
    input.date,
    input.timeSlot,
    sitting.durationMin,
    sitting.billedSeats,
    {
      hourly: promo?.hourly ?? null,
      percentOff: promo?.percentOff ?? 0,
    },
  );
  if (input.hostKind) {
    await releaseOwnHostHolds(
      input.hostKind,
      account?.sub ?? null,
      hashRetryToken(input.retryToken),
      { date: input.date, timeSlot: input.timeSlot, durationMin: sitting.durationMin },
    );
  }
  // A private host, if asked for: the option's hourly price for this sitting,
  // for the whole group, on top of the seats. Checked here, never taken from
  // the request — availability, the 24-hour notice and the price.
  const host = input.hostKind
    ? await assignHost(input.hostKind, input.date, input.timeSlot, sitting.durationMin)
    : null;
  const hostFee = host ? hostFeeCents(host.hourlyCents, sitting.durationMin) : 0;
  const feeCents = quote.totalCents + hostFee;
  const bookingId = await insertSitting({
    tableId: input.tableId,
    date: input.date,
    timeSlot: input.timeSlot,
    guestName: input.guestName,
    // A newcomer code is tied to the account, so its booking is too — or the
    // same account could use it again.
    // The account's own email, never one typed into the request: it decides
    // whose history the booking joins, who gets the receipt, and whether the
    // newcomer discount has been used. A booking without an account has none.
    guestEmail: account ? account.email : null,
    userId: account ? account.sub : null,
    retryTokenHash: hashRetryToken(input.retryToken),
    guestPhone: input.guestPhone,
    durationMin: sitting.durationMin,
    partySize: sitting.partySize,
    status: 'pending_payment',
    source: 'online',
    termsAccepted: input.acceptedTerms,
    // Only recorded when it actually changed the price.
    promoCode: quote.codePrices || quote.percentOff > 0 ? promo?.code : null,
    newcomerDiscount:
      promo?.kind === 'newcomer' && (quote.codePrices || quote.percentOff > 0),
    hostId: host?.hostId ?? null,
    hostKind: input.hostKind ?? null,
    hostFeeCents: hostFee,
    feeCents,
    totalCents: feeCents,
  }, input.share === true);

  const { rows } = await query<{ verification_code: string }>(
    'SELECT verification_code FROM bookings WHERE id = $1',
    [bookingId],
  );
  const code = rows[0].verification_code;

  try {
    const charge = await paymentProvider.createCharge({
      amountCents: feeCents,
      currency: 'KWD',
      description: `Cozy Den table-holding fee, booking #${bookingId}`,
      redirectUrl: base.returnUrl,
      webhookUrl: base.webhookUrl,
      customer: { name: input.guestName, email: input.guestEmail, phone: input.guestPhone },
      metadata: { bookingId: String(bookingId), code },
      expiryMinutes: TAP_CHARGE_EXPIRY_MINUTES,
    });
    // Store the gateway id and its first ledger event atomically.
    await attachPayment({
      bookingId,
      provider: paymentProvider.name,
      chargeId: charge.chargeId,
      providerStatus: charge.status?.toUpperCase(),
      requestedAmountMillis: feeCents * 10,
      currency: 'KWD',
    });
    return { redirectUrl: charge.transactionUrl, code };
  } catch (err) {
    // Couldn't open a charge — free the window rather than stranding it.
    await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    throw err;
  }
}

/**
 * Confirm (or reject) a redirect charge by asking the gateway for the truth.
 * Idempotent and race-safe: the return redirect and the webhook may both fire,
 * but the conditional UPDATE only transitions the first time. Returns the
 * booking code so the return route can redirect to /confirmation/{code}.
 */
export async function finalizeCharge(
  chargeId: string,
  source: PaymentObservationSource = 'reconcile',
): Promise<{ outcome: 'paid' | 'failed' | 'pending' | 'review'; code: string | null }> {
  if (!paymentProvider.retrieveCharge) {
    throw new ApiError(500, 'Configured payment provider cannot retrieve charges.');
  }

  const payment = await getPaymentContext(chargeId);
  if (!payment) return { outcome: 'failed', code: null };

  // Already resolved by the other path — report the settled state, no re-work.
  if (
    payment.bookingStatus === 'pending' ||
    payment.bookingStatus === 'arrived' ||
    payment.bookingStatus === 'order_complete'
  ) {
    return { outcome: 'paid', code: payment.verificationCode };
  }

  // Paid, settled, then cancelled by staff: the ledger already holds the
  // capture, and any refund is done by hand. A Tap retry or a revisited return
  // link is not money arriving late, so it changes nothing.
  if (
    payment.bookingStatus === 'cancelled' &&
    payment.staffCancelled &&
    payment.paymentState === 'captured'
  ) {
    return { outcome: 'paid', code: payment.verificationCode };
  }

  // Cancelled bookings are deliberately re-checked. Tap may have captured in
  // the narrow interval around local expiry; ignoring that callback loses money.
  const status = await paymentProvider.retrieveCharge(chargeId);
  const expectedMillis = payment.totalCents * 10;
  // A capture with no amount on it is not taken on trust either.
  const wrongAmount =
    status.paid && (status.amountMillis === undefined || status.amountMillis !== expectedMillis);
  const wrongCurrency = status.paid && (status.currency || '').toUpperCase() !== 'KWD';
  const capturedAfterCancellation = status.paid && payment.bookingStatus === 'cancelled';
  const cancelledStillPayable =
    payment.bookingStatus === 'cancelled' && !status.paid && !status.failed;

  // Money received against a cancelled booking, or with the wrong amount or
  // currency, is preserved as an explicit staff-review state. Never silently
  // turn it into either a successful booking or a failed payment.
  if (wrongAmount || wrongCurrency || capturedAfterCancellation || cancelledStillPayable) {
    await recordPaymentObservation({
      paymentId: payment.paymentId,
      state: 'review',
      providerStatus: status.status,
      source,
      amountMillis: status.amountMillis,
      currency: status.currency,
      responseCode: status.responseCode,
      responseMessage: status.responseMessage,
      requiresReview: true,
    });
    console.error(
      `[tap] payment review required for booking ${payment.bookingId}: ` +
        `status=${status.status} amount=${status.amountMillis ?? 'unknown'} ` +
        `currency=${status.currency ?? 'unknown'} bookingStatus=${payment.bookingStatus}`,
    );
    return { outcome: 'review', code: payment.verificationCode };
  }

  if (status.paid) {
    // Record capture first. If the process stops before the booking update, the
    // reconciler will safely finish the pending booking on its next pass.
    await recordPaymentObservation({
      paymentId: payment.paymentId,
      state: 'captured',
      providerStatus: status.status,
      source,
      amountMillis: status.amountMillis,
      currency: status.currency,
      responseCode: status.responseCode,
      responseMessage: status.responseMessage,
    });
    // Only the first caller flips it; the WHERE guard makes this idempotent.
    const upd = await query(
      `UPDATE bookings SET status = 'pending'
        WHERE id = $1 AND status = 'pending_payment'
        RETURNING id`,
      [payment.bookingId],
    );
    if (upd.rows.length > 0) {
      const view = await getBookingById(payment.bookingId);
      if (view) announceConfirmed(view);
      return { outcome: 'paid', code: payment.verificationCode };
    }

    // Local expiry won the race after Tap captured. Preserve the capture as a
    // visible exception instead of returning a confirmation for a cancelled row.
    await recordPaymentObservation({
      paymentId: payment.paymentId,
      state: 'review',
      providerStatus: status.status,
      source,
      amountMillis: status.amountMillis,
      currency: status.currency,
      responseCode: status.responseCode,
      responseMessage: status.responseMessage,
      requiresReview: true,
    });
    console.error(`[tap] captured payment raced local expiry for booking ${payment.bookingId}`);
    return { outcome: 'review', code: payment.verificationCode };
  }

  if (status.failed) {
    await recordPaymentObservation({
      paymentId: payment.paymentId,
      state: 'failed',
      providerStatus: status.status,
      source,
      amountMillis: status.amountMillis,
      currency: status.currency,
      responseCode: status.responseCode,
      responseMessage: status.responseMessage,
    });
    await query(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'pending_payment'`,
      [payment.bookingId],
    );
    return { outcome: 'failed', code: payment.verificationCode };
  }

  await recordPaymentObservation({
    paymentId: payment.paymentId,
    state: 'pending',
    providerStatus: status.status,
    source,
    amountMillis: status.amountMillis,
    currency: status.currency,
    responseCode: status.responseCode,
    responseMessage: status.responseMessage,
  });
  // Still in flight (INITIATED / IN_PROGRESS) — leave it held.
  return { outcome: 'pending', code: payment.verificationCode };
}

/**
 * Release a reservation whose payment never completed. The exclusion constraint
 * counts every non-cancelled row, so a 'pending_payment' row holds its 2-hour
 * window against everyone else — and an abandoned Tap charge sits at INITIATED
 * indefinitely, which finalizeCharge reads as "still in flight" and never
 * settles. Without this the window is held forever, for free, by anyone.
 *
 * Guarded on 'pending_payment' so it can never race a confirmation: if the
 * customer paid a moment earlier, the row is already 'pending' and this no-ops.
 */
export async function expireHold(bookingId: number): Promise<boolean> {
  return expirePaymentHold(bookingId);
}


/**
 * Clear the caller's OWN abandoned hold on the window they are trying to book.
 *
 * A customer whose connection dies on the payment page leaves a
 * 'pending_payment' row holding that window. The sweep releases it eventually,
 * but "eventually" is up to half an hour, and in the meantime the one person
 * who most wants the slot — the same customer, hitting back and trying again —
 * is the one it locks out.
 *
 * So a repeat attempt at the same table, date and time with the same phone
 * resolves the earlier hold where it safely can:
 *
 *  - The charge is re-asked of the gateway. A paid one is confirmed (and
 *    handed back only to the customer it belongs to); a declined one has
 *    already been cancelled by finalizeCharge.
 *  - A charge still open is released AT ONCE when the retry proves it is the
 *    same customer: the same signed-in account, or the same browser's checkout
 *    token (migration 048). Nobody else has either, so this cannot be used to
 *    knock someone off a table. If they then pay the old page after all, the
 *    late-capture check flags it for staff rather than losing the money.
 *  - Without that proof a phone number is all there is, so the open charge is
 *    released only once the gateway's own payment window
 *    (TAP_CHARGE_EXPIRY_MINUTES) has closed.
 *  - A hold that never reached the gateway is released after a few minutes
 *    (at once for the same customer).
 *
 * If the gateway cannot be reached, the hold is left for the sweep.
 */
async function resolveOwnStaleHold(input: {
  tableId: number;
  date: string;
  timeSlot: string;
  guestPhone: string;
  accountEmail: string | null;
  accountId: number | null;
  retryTokenHash: string | null;
}): Promise<BookingView | null> {
  const { rows } = await query<{
    id: number;
    payment_ref: string | null;
    user_id: number | null;
    retry_token_hash: string | null;
    past_window: boolean;
    stale: boolean;
  }>(
    `SELECT id, payment_ref, user_id, retry_token_hash,
            created_at < now() - ($5 || ' minutes')::interval AS past_window,
            created_at < now() - interval '5 minutes' AS stale
       FROM bookings
      WHERE status = 'pending_payment' AND source = 'online'
        AND table_id = $1 AND booking_date = $2 AND time_slot = $3
        AND guest_phone = $4`,
    [input.tableId, input.date, input.timeSlot, input.guestPhone, String(TAP_CHARGE_EXPIRY_MINUTES)],
  );

  for (const row of rows) {
    const own =
      (input.accountId !== null && row.user_id === input.accountId) ||
      (input.retryTokenHash !== null && row.retry_token_hash === input.retryTokenHash);
    if (row.payment_ref?.startsWith('chg_')) {
      if (!paymentProvider.retrieveCharge) continue;
      try {
        const { outcome } = await finalizeCharge(row.payment_ref, 'reconcile');
        if (outcome === 'paid') {
          if (own) return await getBookingById(row.id);
          // Paid, but this caller cannot be shown it. Say so plainly instead
          // of the "table already booked" error that would follow.
          throw new ApiError(
            409,
            'Your earlier payment for this table went through, so it is booked. ' +
              'Give your phone number at the counter, or contact us on WhatsApp for your code.',
          );
        }
        if (outcome === 'pending' && (own || row.past_window)) await expireHold(row.id);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error('[checkout] could not re-check an earlier charge', err);
      }
      continue;
    }
    if (own || row.stale) await expireHold(row.id);
  }
  return null;
}

/**
 * Before a checkout with a host: release this customer's own unfinished
 * checkouts holding that host option at an overlapping time, at any table.
 * Otherwise someone who backs out of Tap and picks another table can be told
 * no host is free, when the one who is taken is theirs. A hold at another time is left alone: it blocks nothing, and they
 * may still be paying it in another tab.
 * Proof is the same as resolveOwnStaleHold: the signed-in account or this
 * browser's checkout token, never a typed phone number. A charge that turns out
 * paid is kept, and the host check that follows refuses this one.
 */
async function releaseOwnHostHolds(
  kind: HostKind,
  accountId: number | null,
  retryTokenHash: string | null,
  sitting: { date: string; timeSlot: string; durationMin: number },
): Promise<void> {
  if (accountId === null && retryTokenHash === null) return;
  const { rows } = await query<{ id: number; payment_ref: string | null }>(
    `SELECT id, payment_ref FROM bookings
      WHERE status = 'pending_payment' AND source = 'online' AND host_kind = $1
        AND (($2::int IS NOT NULL AND user_id = $2)
             OR ($3::text IS NOT NULL AND retry_token_hash = $3))
        AND booking_window(booking_date, time_slot, duration_min)
            && booking_window($4::date, $5, $6)`,
    [kind, accountId, retryTokenHash, sitting.date, sitting.timeSlot, sitting.durationMin],
  );
  for (const row of rows) {
    if (row.payment_ref?.startsWith('chg_')) {
      if (!paymentProvider.retrieveCharge) continue;
      try {
        const { outcome } = await finalizeCharge(row.payment_ref, 'reconcile');
        if (outcome === 'pending') await expireHold(row.id);
      } catch (err) {
        console.error('[checkout] could not re-check an earlier host charge', err);
      }
      continue;
    }
    await expireHold(row.id);
  }
}

/**
 * Before a newcomer checkout: settle this customer's own unfinished newcomer
 * checkouts — a Tap page they backed out of for another table, say — so the
 * once-only rule (migration 045) does not refuse the retry until the sweep
 * gets to it. Paid after all: kept, and the rule then refuses this one.
 */
async function releaseOwnNewcomerHolds(email: string): Promise<void> {
  // Matched on the signed-in account only (never a typed phone), so these are
  // always the customer's own and an open one is released at once, as in
  // resolveOwnStaleHold.
  const { rows } = await query<{
    id: number;
    payment_ref: string | null;
    past_window: boolean;
    stale: boolean;
  }>(
    `SELECT id, payment_ref,
            created_at < now() - ($2 || ' minutes')::interval AS past_window,
            created_at < now() - interval '5 minutes' AS stale
       FROM bookings
      WHERE status = 'pending_payment' AND source = 'online' AND newcomer_discount
        AND lower(guest_email) = lower($1)`,
    [email, String(TAP_CHARGE_EXPIRY_MINUTES)],
  );
  for (const row of rows) {
    if (row.payment_ref?.startsWith('chg_')) {
      if (!paymentProvider.retrieveCharge) continue;
      try {
        const { outcome } = await finalizeCharge(row.payment_ref, 'reconcile');
        if (outcome === 'pending') await expireHold(row.id);
      } catch (err) {
        console.error('[checkout] could not re-check an earlier newcomer charge', err);
      }
      continue;
    }
    await expireHold(row.id);
  }
}

/**
 * Staff manual entry for phone/WhatsApp bookings: no payment step, created
 * directly as 'pending' with source 'staff_manual'. Contact may be a phone
 * number or email — no receipt email is attempted. Unlike a customer, staff may
 * start one in the half hour already running.
 */
export async function createStaffBooking(input: StaffCreateBookingInput): Promise<BookingView> {
  if (input.date < todayIso()) throw new ApiError(400, 'Cannot book a date in the past.');
  // A walk-in may start in the half hour running now, and no earlier.
  if (slotHasStarted(input.date, input.timeSlot) && input.timeSlot !== currentSlot(input.date)) {
    throw new ApiError(400, 'That start time has passed. Pick the current half hour or later.');
  }
  const table = await assertTableExists(input.tableId, { activeOnly: false });
  const sitting = resolveSitting(input.timeSlot, table, input.durationMin, input.partySize, {
    share: input.share === true,
  });
  // Staff type whatever the customer gave them. A Kuwait number goes in the
  // phone column, like an online booking's; anything else stays as before.
  const phone = normalizeKuwaitiPhone(input.contact);

  const bookingId = await insertSitting({
    tableId: input.tableId,
    date: input.date,
    timeSlot: input.timeSlot,
    guestName: input.guestName,
    guestEmail: phone ? null : input.contact,
    guestPhone: phone,
    status: 'pending',
    source: 'staff_manual',
    feeCents: 0,
    totalCents: 0,
    durationMin: sitting.durationMin,
    partySize: sitting.partySize,
    staffNotes: input.notes,
  }, input.share === true);

  const view = await getBookingById(bookingId);
  if (!view) throw new ApiError(500, 'Booking vanished after creation.');
  return view;
}

const BOOKING_SELECT = `
  SELECT b.id, b.table_id,
         t.label || CASE WHEN b.half IS NOT NULL THEN ' (shared)' ELSE '' END AS table_label,
         to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
         b.time_slot, b.guest_name, b.guest_email, b.guest_phone, b.verification_code, b.status,
         b.source, b.table_fee_cents, b.total_cents, b.created_at,
         b.duration_min, b.party_size, b.host_fee_cents, b.host_kind, h.display_name AS host_name,
         b.checkin_token
    FROM bookings b
    JOIN tables t ON t.id = b.table_id
    LEFT JOIN hosts h ON h.user_id = b.host_id`;

interface BookingRow {
  checkin_token: string | null;
  host_fee_cents: number;
  host_kind: HostKind | null;
  host_name: string | null;
  id: number;
  table_id: number;
  table_label: string;
  booking_date: string;
  time_slot: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  verification_code: string;
  status: string;
  source: string;
  table_fee_cents: number;
  total_cents: number;
  created_at: Date;
  duration_min: number;
  party_size: number;
}

/**
 * Line items for a set of bookings, in ONE query rather than one per booking.
 *
 * Menu ordering was removed from checkout, so every booking made since the
 * overhaul has none — but the read path still has to serve the legacy rows that
 * do. Fetching per booking meant a customer's history cost 1 + N round trips to
 * find nothing; batching makes it a flat 2. Mirrors what the staff day view
 * already does.
 */
async function loadItems(bookingIds: number[]): Promise<Map<number, BookingItemView[]>> {
  const byBooking = new Map<number, BookingItemView[]>();
  if (bookingIds.length === 0) return byBooking;

  const { rows } = await query<{
    booking_id: number;
    menu_item_id: number;
    name: string;
    quantity: number;
    unit_price_cents: number;
  }>(
    `SELECT bi.booking_id, bi.menu_item_id, m.name, bi.quantity, bi.unit_price_cents
       FROM booking_items bi
       JOIN menu_items m ON m.id = bi.menu_item_id
      WHERE bi.booking_id = ANY($1::int[])
      ORDER BY m.name`,
    [bookingIds]
  );

  for (const i of rows) {
    const list = byBooking.get(i.booking_id) ?? [];
    list.push({
      menuItemId: i.menu_item_id,
      name: i.name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      lineTotalCents: i.unit_price_cents * i.quantity,
    });
    byBooking.set(i.booking_id, list);
  }
  return byBooking;
}

function hydrate(row: BookingRow, items: BookingItemView[]): BookingView {
  return {
    id: row.id,
    tableId: row.table_id,
    tableLabel: row.table_label,
    date: row.booking_date,
    timeSlot: row.time_slot,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    verificationCode: row.verification_code,
    status: row.status,
    source: row.source,
    tableFeeCents: row.table_fee_cents,
    durationMin: row.duration_min,
    partySize: row.party_size,
    totalCents: row.total_cents,
    hostKind: row.host_kind,
    hostName: row.host_name,
    hostFeeCents: row.host_fee_cents,
    checkinToken: row.checkin_token,
    items,
    createdAt: row.created_at.toISOString(),
  };
}

/** Fetch one booking row plus its items in two queries. */
async function hydrateOne(row: BookingRow | undefined): Promise<BookingView | null> {
  if (!row) return null;
  const items = await loadItems([row.id]);
  return hydrate(row, items.get(row.id) ?? []);
}

export async function getBookingById(id: number): Promise<BookingView | null> {
  const { rows } = await query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  return hydrateOne(rows[0]);
}

/** Public lookup by verification code (the code itself is the capability). */
export async function getBookingByCode(code: string): Promise<BookingView | null> {
  const { rows } = await query<BookingRow>(`${BOOKING_SELECT} WHERE b.verification_code = $1`, [
    code.toUpperCase(),
  ]);
  // A booking from before passes existed gets its key the first time its
  // confirmation is opened.
  if (rows[0] && !rows[0].checkin_token) {
    rows[0].checkin_token = await ensureCheckinToken('table', rows[0].id);
  }
  return hydrateOne(rows[0]);
}

/**
 * A signed-in customer's history: bookings this account made, plus older or
 * staff-entered ones under the same email. Only the account's own bookings
 * carry their code and phone — the rest are shown without them, so holding an
 * account with someone's email is never enough to claim their table.
 */
export async function getBookingsByEmail(email: string, userId: number): Promise<BookingView[]> {
  const { rows } = await query<BookingRow & { user_id: number | null }>(
    `${BOOKING_SELECT.replace('SELECT ', 'SELECT b.user_id, ')}
      WHERE b.user_id = $2 OR (b.user_id IS NULL AND lower(b.guest_email) = lower($1))
      ORDER BY b.booking_date DESC, b.time_slot DESC`,
    [email, userId]
  );
  const items = await loadItems(rows.map((r) => r.id));
  for (const r of rows) {
    // Only for bookings a pass can still work on, not years of old history.
    const live = ['pending', 'arrived'].includes(r.status);
    if (r.user_id === userId && !r.checkin_token && live && r.booking_date >= yesterdayIso()) {
      r.checkin_token = await ensureCheckinToken('table', r.id);
    }
  }
  return rows.map((r) => {
    const view = hydrate(r, items.get(r.id) ?? []);
    return r.user_id === userId
      ? view
      : { ...view, verificationCode: '', guestPhone: null, checkinToken: null };
  });
}

// ---------- Staff changing a booking ----------

interface ChangeableRow {
  id: number;
  table_id: number;
  date: string;
  time_slot: string;
  duration_min: number;
  party_size: number;
  status: string;
  source: string;
  host_id: number | null;
  total_cents: number;
  promo_code: string | null;
  first_quote_cents: number | null;
  counter_cents: number;
  half: 1 | 2 | null;
}

const CHANGEABLE_SELECT = `SELECT id, table_id, to_char(booking_date, 'YYYY-MM-DD') AS date, time_slot,
         duration_min, party_size, status, source, host_id, total_cents, promo_code, first_quote_cents, counter_cents, half
    FROM bookings WHERE id = $1`;

/** Why this booking cannot be changed at all, or null when it can. */
function changeRefusal(row: ChangeableRow): string | null {
  if (row.source === 'event') return 'This is an event hold. Change it from the Events tab.';
  if (row.status === 'pending_payment') return 'The customer is still paying for this booking.';
  if (row.status !== 'pending' && row.status !== 'arrived') {
    return 'This booking is finished, so it cannot be changed.';
  }
  if (row.date < todayIso()) return 'This booking is from an earlier day.';
  return null;
}

interface Sitting {
  tableId: number;
  timeSlot: string;
  durationMin: number;
  partySize: number;
  half: 1 | 2 | null;
  billedSeats: number;
}

/** Seats charged: the party on a shared half, otherwise never below the table's minimum. */
const seatsFor = (half: 1 | 2 | null, partySize: number, table: { capacity: number; minParty: number | null }) =>
  half !== null ? partySize : Math.max(partySize, minSeatsFor(table.capacity, table.minParty));

/**
 * The booking as it would be after these changes, checked against the same rules
 * as a new one, apart from the table's minimum party: staff record who actually
 * came, even if fewer than the table asks for. The database still has the final
 * say on overlaps.
 */
async function resolveChanges(
  row: ChangeableRow,
  changes: BookingChanges,
  db: Pick<PoolClient, 'query'> | null = null,
): Promise<Sitting> {
  const refusal = changeRefusal(row);
  if (refusal) throw new ApiError(409, refusal);

  const tableId = changes.tableId ?? row.table_id;
  const timeSlot = changes.timeSlot ?? row.time_slot;
  const durationMin = changes.durationMin ?? row.duration_min;
  const partySize = changes.partySize ?? row.party_size;
  let half = changes.half !== undefined ? changes.half : row.half;
  const newTime = timeSlot !== row.time_slot;
  const newLength = durationMin !== row.duration_min;

  // A host's fee and free times depend on when and how long.
  if (row.host_id !== null && (newTime || newLength)) {
    throw new ApiError(409, 'This booking has a game host, so its time cannot be changed here.');
  }
  // Late arrivals move to the half hour running now, and no earlier.
  if (newTime && slotHasStarted(row.date, timeSlot) && timeSlot !== currentSlot(row.date)) {
    throw new ApiError(400, 'That start time has passed. Pick the current half hour or later.');
  }
  if ((newTime || newLength) && !isValidDuration(timeSlot, durationMin)) {
    throw new ApiError(400, 'That length is not available for the start time you picked.');
  }
  // A table already retired may keep its booking, but none can move onto it.
  const table = await assertTableExists(tableId, { activeOnly: tableId !== row.table_id }, db);
  if (partySize > table.capacity) throw new ApiError(400, `That table seats ${table.capacity}.`);
  // A half moved to a table that cannot be shared becomes that whole table.
  if (changes.half === undefined && half !== null && !isShareable(table.capacity)) half = null;
  // Half a big table: a small group, never with a host. Staff may record fewer
  // than two, as with a table's minimum, but not more than a half holds.
  if (half !== null) {
    if (row.host_id !== null) throw new ApiError(409, 'A game host is for a whole table, not a shared half.');
    if (!isShareable(table.capacity)) throw new ApiError(400, 'This table cannot be shared.');
    if (partySize > SHARE_PARTY_MAX) {
      throw new ApiError(400, `A shared half is for up to ${SHARE_PARTY_MAX} people.`);
    }
  }

  return {
    tableId,
    timeSlot,
    durationMin,
    partySize,
    half,
    billedSeats: seatsFor(half, partySize, table),
  };
}

export interface PriceChange {
  paidCents: number;
  /** Already taken by hand for this booking. */
  counterCents: number;
  /** Null when the booking's price code has been deleted: nothing to compare with. */
  newTotalCents: number | null;
  differenceCents: number | null;
}

async function quoteOptionsFor(row: ChangeableRow) {
  const promo = row.promo_code ? await findCode(row.promo_code) : null;
  return {
    codeMissing: !!row.promo_code && !promo,
    options: { hourly: promo?.hourly ?? null, percentOff: promo?.percentOff ?? 0 },
  };
}

/** Today's price for the booking as it stands, at its own code's prices. */
async function quoteCurrent(row: ChangeableRow): Promise<number> {
  const { options } = await quoteOptionsFor(row);
  const table = await assertTableExists(row.table_id, { activeOnly: false });
  const seats = seatsFor(row.half, row.party_size, table);
  const quote = await quoteBooking(row.date, row.time_slot, row.duration_min, seats, options);
  return quote.totalCents;
}

/**
 * What the booking now costs against what it cost as paid for, at the booking's
 * own code. Always measured from the booking as paid, however many changes came
 * in between. That baseline is priced at the rates of the first change, so a rate
 * edited before then does not show as a difference, but one edited between two
 * changes does. Null for a booking nothing was paid on. Nothing is charged or
 * refunded here: the total stays what was paid, and staff settle at the counter.
 */
async function priceChangeFor(
  row: ChangeableRow,
  after: Sitting,
  firstQuoteCents: number | null,
): Promise<PriceChange | null> {
  if (row.total_cents <= 0) return null;
  const { codeMissing, options } = await quoteOptionsFor(row);
  if (codeMissing) {
    return {
      paidCents: row.total_cents,
      counterCents: row.counter_cents,
      newTotalCents: null,
      differenceCents: null,
    };
  }
  const base = firstQuoteCents ?? (await quoteCurrent(row));
  const now = await quoteBooking(row.date, after.timeSlot, after.durationMin, after.billedSeats, options);
  const differenceCents = now.totalCents - base;
  return {
    paidCents: row.total_cents,
    counterCents: row.counter_cents,
    newTotalCents: row.total_cents + differenceCents,
    differenceCents,
  };
}

/** The booking's sitting and what staff may move it to: for the change form. */
export async function bookingChangeOptions(id: number) {
  const { rows } = await query<ChangeableRow>(CHANGEABLE_SELECT, [id]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'No booking matches.');
  const refusal = changeRefusal(row);
  if (refusal) throw new ApiError(409, refusal);
  const { tables } = await getAvailability(row.date, {
    exceptBookingId: row.id,
    keepSlot: row.time_slot,
    alsoTableId: row.table_id,
    withHalves: true,
  });
  return {
    booking: {
      tableId: row.table_id,
      timeSlot: row.time_slot,
      durationMin: row.duration_min,
      partySize: row.party_size,
      half: row.half,
      hasHost: row.host_id !== null,
    },
    tables,
  };
}

/** What a change would do, without making it. */
export async function previewBookingChange(id: number, changes: BookingChanges) {
  const { rows } = await query<ChangeableRow>(CHANGEABLE_SELECT, [id]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'No booking matches.');
  const after = await resolveChanges(row, changes);
  return { priceChange: await priceChangeFor(row, after, row.first_quote_cents) };
}

/**
 * Move a booking to another table or time, or change how many came. The row is
 * locked while it is checked and written, so two staff cannot combine into a
 * sitting neither of them checked. The exclusion constraint refuses any overlap.
 */
export async function changeBooking(id: number, changes: BookingChanges, staffId: number) {
  // Priced before the transaction: everything inside it must use its own client.
  const { rows: before } = await query<ChangeableRow>(CHANGEABLE_SELECT, [id]);
  if (!before[0]) throw new ApiError(404, 'No booking matches.');
  const firstQuote =
    before[0].total_cents > 0 && before[0].first_quote_cents === null && changeRefusal(before[0]) === null
      ? await quoteCurrent(before[0])
      : null;

  let row: ChangeableRow;
  let after: Sitting;
  try {
    ({ row, after } = await withTransaction(async (client) => {
      const { rows } = await client.query<ChangeableRow>(`${CHANGEABLE_SELECT} FOR UPDATE`, [id]);
      const locked = rows[0];
      if (!locked) throw new ApiError(404, 'No booking matches.');
      const seen = changes.expected;
      if (
        seen &&
        (seen.tableId !== locked.table_id ||
          seen.timeSlot !== locked.time_slot ||
          seen.durationMin !== locked.duration_min ||
          seen.partySize !== locked.party_size ||
          (seen.half !== undefined && seen.half !== locked.half))
      ) {
        throw new ApiError(409, 'Someone else just changed this booking. Check it and try again.');
      }
      const sitting = await resolveChanges(locked, changes, client);
      await client.query(
        `UPDATE bookings
            SET table_id = $2, time_slot = $3, duration_min = $4, party_size = $5,
                first_quote_cents = COALESCE(first_quote_cents, $6), half = $7
          WHERE id = $1`,
        [id, sitting.tableId, sitting.timeSlot, sitting.durationMin, sitting.partySize, firstQuote, sitting.half],
      );
      return { row: locked, after: sitting };
    }));
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23P01' && e.constraint === 'bookings_no_overlap') {
      throw new ApiError(409, ALREADY_BOOKED);
    }
    // Two moves crossing each other: nothing was saved by this one.
    if (e.code === '40P01') throw new ApiError(409, 'Someone else was changing this table. Please try again.');
    throw err;
  }
  console.log(
    `[booking-change] booking=${id} staff=${staffId} ` +
      `table ${row.table_id}->${after.tableId} start ${row.time_slot}->${after.timeSlot} ` +
      `length ${row.duration_min}->${after.durationMin} people ${row.party_size}->${after.partySize} ` +
      `half ${row.half ?? 'whole'}->${after.half ?? 'whole'}`,
  );
  // The change is saved by now: a failure from here on must not report otherwise.
  try {
    return { priceChange: await priceChangeFor(row, after, row.first_quote_cents ?? firstQuote) };
  } catch (err) {
    console.error('[booking-change] saved, but could not work out the price change', err);
    return { priceChange: null, priceUnknown: true };
  }
}
