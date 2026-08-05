import { query, withTransaction } from '../db/pool';

export type PaymentState =
  | 'created'
  | 'pending'
  | 'captured'
  | 'failed'
  | 'expired'
  | 'review'
  | 'legacy_confirmed'
  | 'legacy_cancelled'
  | 'refunded';

export type PaymentObservationSource =
  | 'create'
  | 'return'
  | 'webhook'
  | 'reconcile'
  | 'local_expiry'
  | 'direct';

export interface PaymentContext {
  paymentId: string | number;
  bookingId: number;
  bookingStatus: string;
  verificationCode: string;
  totalCents: number;
  paymentState: PaymentState;
  requestedAmountMillis: number;
}

interface AttachPaymentInput {
  bookingId: number;
  provider: string;
  chargeId: string;
  providerStatus?: string;
  requestedAmountMillis: number;
  currency: string;
  state?: PaymentState;
  source?: PaymentObservationSource;
}

/**
 * Attach the gateway charge and create its ledger row atomically. A charge id
 * cannot be linked to two bookings because both tables enforce uniqueness.
 */
export async function attachPayment(input: AttachPaymentInput): Promise<void> {
  await withTransaction(async (client) => {
    const booking = await client.query(
      `UPDATE bookings
          SET payment_ref = $1
        WHERE id = $2 AND status = 'pending_payment'
        RETURNING id`,
      [input.chargeId, input.bookingId],
    );
    if (booking.rows.length !== 1) {
      throw new Error(`Booking ${input.bookingId} is no longer awaiting payment.`);
    }

    const state = input.state ?? 'pending';
    const payment = await client.query<{ id: number }>(
      `INSERT INTO payments
         (booking_id, provider, provider_charge_id, state, provider_status,
          requested_amount_millis, currency, captured_at, failed_at, last_checked_at)
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         CASE WHEN $4 = 'captured' THEN now() ELSE NULL END,
         CASE WHEN $4 IN ('failed', 'expired') THEN now() ELSE NULL END,
         now()
       )
       ON CONFLICT (provider, provider_charge_id) DO UPDATE
         SET updated_at = now()
       WHERE payments.booking_id = EXCLUDED.booking_id
       RETURNING id`,
      [
        input.bookingId,
        input.provider,
        input.chargeId,
        state,
        input.providerStatus ?? null,
        input.requestedAmountMillis,
        input.currency.toUpperCase(),
      ],
    );
    if (payment.rows.length !== 1) {
      throw new Error(`Gateway charge ${input.chargeId} is already attached to another booking.`);
    }

    await client.query(
      `INSERT INTO payment_events
         (payment_id, event_key, event_kind, source, state, provider_status)
       VALUES ($1,$2,'created',$3,$4,$5)
       ON CONFLICT (payment_id, event_key) DO NOTHING`,
      [payment.rows[0].id, `created:${input.providerStatus ?? state}`, input.source ?? 'create', state, input.providerStatus ?? null],
    );
  });
}

export async function getPaymentContext(chargeId: string): Promise<PaymentContext | null> {
  const { rows } = await query<{
    payment_id: number;
    booking_id: number;
    booking_status: string;
    verification_code: string;
    total_cents: number;
    payment_state: PaymentState;
    requested_amount_millis: string | number;
  }>(
    `SELECT p.id AS payment_id, p.booking_id, b.status AS booking_status,
            b.verification_code, b.total_cents, p.state AS payment_state,
            p.requested_amount_millis
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
      WHERE p.provider = 'tap' AND p.provider_charge_id = $1`,
    [chargeId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    paymentId: row.payment_id,
    bookingId: row.booking_id,
    bookingStatus: row.booking_status,
    verificationCode: row.verification_code,
    totalCents: row.total_cents,
    paymentState: row.payment_state,
    requestedAmountMillis: Number(row.requested_amount_millis),
  };
}

interface ObservationInput {
  paymentId: string | number;
  state: PaymentState;
  providerStatus: string;
  source: PaymentObservationSource;
  amountMillis?: number;
  currency?: string;
  responseCode?: string;
  responseMessage?: string;
  requiresReview?: boolean;
}

/**
 * Update the compact current state and append one event per distinct observed
 * provider state. Repeated webhook/reconcile reads update last_checked_at but
 * do not grow payment_events.
 */
export async function recordPaymentObservation(input: ObservationInput): Promise<void> {
  const eventKey = [
    'observed',
    input.providerStatus,
    input.state,
    input.amountMillis ?? '',
    input.currency?.toUpperCase() ?? '',
  ].join(':');

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE payments
          SET state = $2,
              provider_status = $3,
              provider_amount_millis = $4,
              provider_currency = $5,
              response_code = $6,
              response_message = $7,
              requires_review = $8,
              captured_at = CASE
                WHEN $2 IN ('captured', 'review') AND $3 = 'CAPTURED'
                  THEN COALESCE(captured_at, now())
                ELSE captured_at
              END,
              failed_at = CASE
                WHEN $2 IN ('failed', 'expired') THEN COALESCE(failed_at, now())
                ELSE failed_at
              END,
              last_checked_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [
        input.paymentId,
        input.state,
        input.providerStatus,
        input.amountMillis ?? null,
        input.currency?.toUpperCase() ?? null,
        input.responseCode ?? null,
        input.responseMessage ?? null,
        input.requiresReview ?? false,
      ],
    );

    await client.query(
      `INSERT INTO payment_events
         (payment_id, event_key, event_kind, source, state, provider_status,
          provider_amount_millis, provider_currency, response_code, response_message)
       VALUES ($1,$2,'observation',$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (payment_id, event_key) DO NOTHING`,
      [
        input.paymentId,
        eventKey,
        input.source,
        input.state,
        input.providerStatus,
        input.amountMillis ?? null,
        input.currency?.toUpperCase() ?? null,
        input.responseCode ?? null,
        input.responseMessage ?? null,
      ],
    );
  });
}

/** Release a local table hold and ledger it in the same database transaction. */
export async function expirePaymentHold(bookingId: number): Promise<boolean> {
  return withTransaction(async (client) => {
    const booking = await client.query(
      `UPDATE bookings b SET status = 'cancelled'
        WHERE b.id = $1 AND b.status = 'pending_payment'
          AND NOT EXISTS (
            SELECT 1 FROM payments p
             WHERE p.booking_id = b.id
               AND p.state IN ('captured', 'review', 'refunded')
          )
        RETURNING id`,
      [bookingId],
    );
    if (booking.rows.length === 0) return false;

    const payment = await client.query<{ id: number }>(
      `UPDATE payments
          SET state = 'expired', failed_at = COALESCE(failed_at, now()),
              last_checked_at = now(), updated_at = now()
        WHERE booking_id = $1 AND state NOT IN ('captured', 'review', 'refunded')
        RETURNING id`,
      [bookingId],
    );
    for (const row of payment.rows) {
      await client.query(
        `INSERT INTO payment_events
           (payment_id, event_key, event_kind, source, state)
         VALUES ($1,'local-expiry','local_expiry','local_expiry','expired')
         ON CONFLICT (payment_id, event_key) DO NOTHING`,
        [row.id],
      );
    }
    return true;
  });
}
