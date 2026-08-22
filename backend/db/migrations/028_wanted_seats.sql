-- Wanted Board listings sell seats, not whole tables.
--
-- Reserving used to mean one member paying for every seat the listing held —
-- KD 11 for a four-player session even if you were one person joining it. Now
-- each member buys the seats they are actually taking and the listing counts
-- down: seats sold are seats gone, and the listing completes when the last one
-- goes.
--
-- The old single-reserver columns on wanted_posts (reserved_by, amount_cents,
-- payment_state, payment_ref) stay where they are as history. Nothing writes
-- them any more; the seat rows below are the truth.
BEGIN;

CREATE TABLE IF NOT EXISTS wanted_post_seats (
  id            SERIAL PRIMARY KEY,
  post_id       INTEGER NOT NULL REFERENCES wanted_posts (id) ON DELETE CASCADE,
  member_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seats         INTEGER NOT NULL CHECK (seats > 0),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  -- Held while the gateway has the customer, then settled. A held row already
  -- occupies its seats, so two people cannot buy the last one twice.
  payment_state TEXT NOT NULL CHECK (payment_state IN ('pending_payment', 'paid')),
  payment_ref   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wanted_seats_post_idx ON wanted_post_seats (post_id);
-- The sweep re-checks abandoned holds, exactly as it does for bookings.
CREATE INDEX IF NOT EXISTS wanted_seats_stale_idx
  ON wanted_post_seats (created_at) WHERE payment_state = 'pending_payment';

-- Anyone who already bought a listing outright bought all of its seats. Carried
-- across so their reservation still reads as a full house rather than vanishing.
INSERT INTO wanted_post_seats
  (post_id, member_id, seats, amount_cents, payment_state, payment_ref, created_at)
SELECT id, reserved_by, max_players, amount_cents, 'paid', payment_ref,
       COALESCE(reserved_at, created_at)
  FROM wanted_posts
 WHERE payment_state = 'paid' AND reserved_by IS NOT NULL;

-- Holds that were mid-checkout when this shipped have no seat row and no way to
-- grow one. Released rather than stranded; the customer can simply buy again.
UPDATE wanted_posts
   SET reserved_by = NULL, reserved_at = NULL, amount_cents = 0,
       payment_state = 'none', payment_ref = NULL
 WHERE payment_state = 'pending_payment';

COMMIT;
