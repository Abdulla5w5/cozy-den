-- Wanted Board, first batch of the client's Nov 2026 brief: a start time on
-- posts, usernames, subscriptions and a reminder, plus which games each host
-- can run.
BEGIN;

-- Empty only on posts from before this: new ones always have it (enforced in
-- createPost). Like a booking, a start before 14:00 belongs to the small hours
-- after session_date.
ALTER TABLE wanted_posts
  ADD COLUMN IF NOT EXISTS start_time TEXT
    CHECK (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):(00|30)$'),
  -- The poster's username as staff approved it: a later rename never changes a
  -- published post. Empty on older posts, made under a promise of anonymity.
  ADD COLUMN IF NOT EXISTS posted_by TEXT,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS wanted_posts_reminder_idx
  ON wanted_posts (session_date)
  WHERE reminder_sent_at IS NULL AND start_time IS NOT NULL;

-- Chosen by the member, never made from their real name.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username TEXT
    CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$'),
  ADD COLUMN IF NOT EXISTS wanted_alerts BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx
  ON users (username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS host_games (
  host_id INTEGER NOT NULL REFERENCES hosts (user_id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  PRIMARY KEY (host_id, game_id)
);
CREATE INDEX IF NOT EXISTS host_games_game_idx ON host_games (game_id);

COMMIT;
