-- Batch 3: the Wanted Board, plus guest access to the existing support inbox.

BEGIN;

-- ---------- Wanted Board ----------
--
-- A member advertises a game they want to run and collects expressions of
-- interest. Nothing here schedules anything: once a post fills, staff contact
-- the interested members by hand and arrange the session off-system. That
-- manual step is deliberate.
--
-- New posts start 'pending' and are invisible to the public until staff
-- approve them, so nothing reaches members unreviewed.
CREATE TABLE IF NOT EXISTS wanted_posts (
  id             SERIAL PRIMARY KEY,
  member_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Either a library game or a free-text title for something we don't stock.
  game_id        INTEGER REFERENCES games (id) ON DELETE SET NULL,
  game_name      TEXT,
  players_needed INTEGER NOT NULL CHECK (players_needed > 0),
  min_players    INTEGER NOT NULL CHECK (min_players > 0),
  max_players    INTEGER NOT NULL,
  session_type   TEXT NOT NULL CHECK (session_type IN ('males_only', 'females_only', 'open')),
  -- ISO day numbers, 0 = Sunday .. 6 = Saturday. Days of the week only —
  -- there is deliberately no date or time on a post.
  preferred_days SMALLINT[] NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'open', 'completed', 'rejected')),
  -- The poster's promise to know the game and teach it. The API rejects a
  -- false value, and this CHECK means an unacknowledged post cannot physically
  -- exist in the table even if a future code path forgets to look.
  acknowledgment_confirmed BOOLEAN NOT NULL CHECK (acknowledgment_confirmed),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wanted_player_range CHECK (max_players >= min_players),
  CONSTRAINT wanted_needs_a_game CHECK (
    game_id IS NOT NULL OR (game_name IS NOT NULL AND btrim(game_name) <> '')
  ),
  CONSTRAINT wanted_days_present CHECK (array_length(preferred_days, 1) >= 1)
);

CREATE INDEX IF NOT EXISTS wanted_posts_status_idx
  ON wanted_posts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS wanted_posts_member_idx ON wanted_posts (member_id);

-- contact_snapshot records how to reach the member AT THE TIME they registered,
-- so staff calling a filled post are not defeated by a later profile edit.
CREATE TABLE IF NOT EXISTS wanted_post_interests (
  id               SERIAL PRIMARY KEY,
  post_id          INTEGER NOT NULL REFERENCES wanted_posts (id) ON DELETE CASCADE,
  member_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  contact_snapshot TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One expression of interest per member per post.
  CONSTRAINT wanted_interest_unique UNIQUE (post_id, member_id)
);

CREATE INDEX IF NOT EXISTS wanted_interests_post_idx ON wanted_post_interests (post_id);

-- ---------- Guest access to the existing support inbox ----------
--
-- Suggestions and complaints already live in support_requests, with staff
-- workflow and threading. Rather than stand up a second inbox staff would have
-- to remember to check, the existing one now accepts submissions from people
-- without an account.
ALTER TABLE support_requests ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS guest_email TEXT;
-- "Mark as reviewed" — independent of the open/resolved workflow, so staff can
-- track that they have READ something without claiming to have acted on it.
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE support_requests DROP CONSTRAINT IF EXISTS support_has_an_author;
ALTER TABLE support_requests ADD CONSTRAINT support_has_an_author CHECK (
  user_id IS NOT NULL OR (guest_email IS NOT NULL AND btrim(guest_email) <> '')
);

-- Guest threads have no account behind the opening message.
ALTER TABLE support_messages ALTER COLUMN author_id DROP NOT NULL;

COMMIT;
