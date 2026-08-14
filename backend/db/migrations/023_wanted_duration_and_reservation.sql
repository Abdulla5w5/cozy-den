-- Wanted Board listings get a length, a price derived from it, and a reserver.
--
-- Until now a post was an expression of intent that scheduled nothing and cost
-- nothing: staff coordinated the session by hand once enough people showed
-- interest. A listing now states how long the session runs, is priced from that
-- length at the ordinary table rate, and can be reserved and paid for.
BEGIN;

ALTER TABLE wanted_posts
  -- Same units and the same 2/4/6-hour vocabulary as a table booking, so the
  -- price can come from the same function rather than a second pricing rule.
  ADD COLUMN IF NOT EXISTS duration_min INTEGER NOT NULL DEFAULT 120
    CHECK (duration_min IN (120, 240, 360)),
  -- Who took the listing, and what they paid. NULL reserved_by = still open.
  ADD COLUMN IF NOT EXISTS reserved_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS payment_ref   TEXT,
  -- Mirrors the booking flow: held while the gateway has the customer, then
  -- settled. Kept separate from `status` so moderation state (pending/open/
  -- rejected) and payment state do not have to be encoded in one column.
  ADD COLUMN IF NOT EXISTS payment_state TEXT NOT NULL DEFAULT 'none'
    CHECK (payment_state IN ('none', 'pending_payment', 'paid'));

-- A reserved listing must say who reserved it, and an unreserved one must not
-- claim to be paid. Cheaper to make the bad state unrepresentable than to
-- police it in every code path that touches a post.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wanted_reservation_coherent') THEN
    ALTER TABLE wanted_posts ADD CONSTRAINT wanted_reservation_coherent
      CHECK (
        (payment_state = 'none' AND reserved_by IS NULL)
        OR (payment_state <> 'none' AND reserved_by IS NOT NULL)
      );
  END IF;
END $$;

-- Two people cannot buy the same listing, but that needs no index: the reserver
-- lives in a single column on the post, so there is only ever one. The race is
-- settled by claiming conditionally —
--   UPDATE wanted_posts SET ... WHERE id = $1 AND payment_state = 'none'
-- where whichever transaction updates a row wins and the other affects none.

-- Staff sweep abandoned holds the same way stranded bookings are swept.
CREATE INDEX IF NOT EXISTS wanted_posts_stale_hold_idx
  ON wanted_posts (reserved_at) WHERE payment_state = 'pending_payment';

COMMIT;
