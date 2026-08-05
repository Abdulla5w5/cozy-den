-- Durable, low-overhead payment accounting.
--
-- bookings.status describes the cafe workflow; it is not a payment ledger.
-- Keep one compact current-state row per provider charge and one event only
-- when an observed state changes. This preserves an audit trail without
-- generating polling noise or meaningful storage load.

BEGIN;

-- A provider charge must never be able to settle more than one booking.
DROP INDEX IF EXISTS bookings_payment_ref_idx;
CREATE UNIQUE INDEX bookings_payment_ref_idx
  ON bookings (payment_ref)
  WHERE payment_ref IS NOT NULL;

CREATE TABLE payments (
  id                       BIGSERIAL PRIMARY KEY,
  booking_id               INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  provider                 TEXT NOT NULL,
  provider_charge_id       TEXT NOT NULL,
  state                    TEXT NOT NULL
                           CHECK (state IN (
                             'created', 'pending', 'captured', 'failed',
                             'expired', 'review', 'legacy_confirmed',
                             'legacy_cancelled', 'refunded'
                           )),
  provider_status          TEXT,
  requested_amount_millis  BIGINT NOT NULL CHECK (requested_amount_millis >= 0),
  provider_amount_millis   BIGINT CHECK (provider_amount_millis >= 0),
  currency                 TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider_currency        TEXT,
  response_code            TEXT,
  response_message         TEXT,
  requires_review          BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at              TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  last_checked_at          TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_charge_id)
);

CREATE INDEX payments_booking_idx ON payments (booking_id, created_at DESC);
CREATE INDEX payments_attention_idx
  ON payments (state, updated_at)
  WHERE state IN ('pending', 'review');

CREATE TABLE payment_events (
  id                      BIGSERIAL PRIMARY KEY,
  payment_id              BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  event_key               TEXT NOT NULL,
  event_kind              TEXT NOT NULL,
  source                  TEXT NOT NULL,
  state                   TEXT NOT NULL,
  provider_status         TEXT,
  provider_amount_millis  BIGINT,
  provider_currency       TEXT,
  response_code           TEXT,
  response_message        TEXT,
  observed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_id, event_key)
);

CREATE INDEX payment_events_payment_idx
  ON payment_events (payment_id, observed_at DESC);

-- Existing rows are deliberately labelled legacy rather than pretending that
-- the current database can prove a historical Tap capture or failure reason.
INSERT INTO payments (
  booking_id, provider, provider_charge_id, state, requested_amount_millis,
  currency, requires_review, captured_at, failed_at, last_checked_at,
  created_at, updated_at
)
SELECT b.id,
       CASE WHEN b.payment_ref LIKE 'chg_%' THEN 'tap' ELSE 'legacy' END,
       b.payment_ref,
       CASE
         WHEN b.status IN ('pending', 'print_receipt', 'order_complete') THEN 'legacy_confirmed'
         WHEN b.status = 'cancelled' THEN 'legacy_cancelled'
         WHEN b.status = 'pending_payment' THEN 'pending'
         ELSE 'review'
       END,
       b.total_cents::bigint * 10,
       'KWD',
       FALSE,
       NULL,
       NULL,
       NULL,
       b.created_at,
       now()
  FROM bookings b
 WHERE b.payment_ref IS NOT NULL
ON CONFLICT (provider, provider_charge_id) DO NOTHING;

INSERT INTO payment_events (
  payment_id, event_key, event_kind, source, state, observed_at
)
SELECT p.id, 'legacy-import', 'legacy_import', 'migration', p.state, p.created_at
  FROM payments p
ON CONFLICT (payment_id, event_key) DO NOTHING;

COMMIT;

