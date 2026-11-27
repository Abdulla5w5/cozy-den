-- Staff can move or cancel a Wanted Board session.
BEGIN;

ALTER TABLE wanted_posts DROP CONSTRAINT IF EXISTS wanted_posts_status_check;
ALTER TABLE wanted_posts ADD CONSTRAINT wanted_posts_status_check
  CHECK (status IN ('pending', 'open', 'completed', 'rejected', 'cancelled'));

ALTER TABLE wanted_posts
  -- Counts every move, so each one is announced once.
  ADD COLUMN IF NOT EXISTS change_no INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by INTEGER,
  -- What staff told the players.
  ADD COLUMN IF NOT EXISTS cancel_note TEXT;

-- Refunds are made by hand in Tap; this only records that one was.
ALTER TABLE wanted_post_seats
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_by INTEGER,
  -- The session as it was when the seat was taken, so someone who pays after it
  -- moved can be told. Empty on seats from before this.
  ADD COLUMN IF NOT EXISTS held_change_no INTEGER,
  ADD COLUMN IF NOT EXISTS held_date DATE,
  ADD COLUMN IF NOT EXISTS held_start TEXT,
  ADD COLUMN IF NOT EXISTS held_duration INTEGER;

-- Each move, with what the session was before it, so someone who missed a
-- move is told from what they last knew.
CREATE TABLE IF NOT EXISTS wanted_post_changes (
  post_id      INTEGER NOT NULL REFERENCES wanted_posts (id) ON DELETE CASCADE,
  change_no    INTEGER NOT NULL,
  was_date     DATE NOT NULL,
  was_start    TEXT,
  was_duration INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, change_no)
);

COMMIT;
