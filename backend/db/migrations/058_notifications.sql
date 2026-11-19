-- In-site notifications: the bell in the header. One row per message to one
-- account. The row stores what happened (kind + data), not finished sentences,
-- so the site can show it in English or Arabic; the email copy is written
-- when it is sent.
--
-- dedupe_key makes a notice safe to send twice: "booking_reminder:42" can only
-- ever exist once per account, so a sweep that runs on two servers, or again
-- after a crash, never shows the same reminder twice.
BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind ~ '^[a-z_]{1,40}$'),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb
              CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 4000),
  -- A path on this site to open when the notice is clicked, never an address
  -- elsewhere.
  link        TEXT CHECK (link IS NULL OR link ~ '^/[A-Za-z0-9/_?=&.-]{0,200}$'),
  dedupe_key  TEXT CHECK (dedupe_key IS NULL OR length(dedupe_key) <= 120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
-- The bell reads a member's latest notices, and counts the unread ones.
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (user_id) WHERE read_at IS NULL;

-- When the 3-hours-before reminder went out. Claimed before sending, so each
-- booking is reminded at most once even with two servers sweeping.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- The sweep looks only at paid online bookings not yet reminded, which is a
-- handful of rows on any night.
CREATE INDEX IF NOT EXISTS bookings_reminder_due_idx
  ON bookings (booking_date)
  WHERE reminder_sent_at IS NULL AND status = 'pending' AND source = 'online';

COMMIT;
