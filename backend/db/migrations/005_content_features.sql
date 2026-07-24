-- Batch 2: content & discovery features.
--   * games: purchase_url / image_url / description (Game Library)
--   * customer_game_history: post-visit "games I've played" log
--   * events: internal/external events for the homepage + Our Calendar
--   * promos: single active entry popup, staff-editable
-- All additive. Batch 1's bookings/tables schema is untouched except the
-- nullable booking_id reference from customer_game_history.

BEGIN;

-- ---------- Game Library ----------
ALTER TABLE games ADD COLUMN IF NOT EXISTS purchase_url TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS image_url    TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS description  TEXT NOT NULL DEFAULT '';

-- ---------- Game History (requires an account) ----------
CREATE TABLE IF NOT EXISTS customer_game_history (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  played_date DATE    NOT NULL DEFAULT CURRENT_DATE,
  -- optional link back to the Batch 1 booking the game was played during
  booking_id  INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- logging the same game on the same day twice is a double-submit, not data
  CONSTRAINT customer_game_history_unique UNIQUE (customer_id, game_id, played_date)
);

CREATE INDEX IF NOT EXISTS cgh_customer_idx
  ON customer_game_history (customer_id, played_date DESC);

-- ---------- Events ----------
CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_date  DATE NOT NULL,
  event_time  TEXT,
  location    TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'internal' CHECK (type IN ('internal', 'external')),
  image_url   TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Calendar and "upcoming" views both read by date.
CREATE INDEX IF NOT EXISTS events_date_idx ON events (event_date);
-- Homepage featured strip.
CREATE INDEX IF NOT EXISTS events_featured_idx ON events (event_date) WHERE is_featured;

-- ---------- Entry popup (promo) ----------
CREATE TABLE IF NOT EXISTS promos (
  id         SERIAL PRIMARY KEY,
  image_url  TEXT,
  text       TEXT NOT NULL DEFAULT '',
  link_url   TEXT,
  link_label TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one promo may be active at a time; the public endpoint reads that row.
CREATE UNIQUE INDEX IF NOT EXISTS promos_single_active_idx ON promos ((TRUE)) WHERE is_active;

COMMIT;
