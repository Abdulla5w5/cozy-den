-- Private game hosts (the café's list, items 36-39 and the "Private Board
-- Game Host" note, Nov 2026). One group of people: each host can offer
-- board-game hosting, Dungeon Mastering, or both, and has their own hourly
-- price, set by an admin. A host is any account with an active row here; they
-- see only their own schedule, never the rest of the dashboard.
CREATE TABLE IF NOT EXISTS hosts (
  user_id            INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name       TEXT    NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  bio                TEXT    NOT NULL DEFAULT '' CHECK (length(bio) <= 400),
  photo_url          TEXT,
  hourly_cents       INTEGER NOT NULL DEFAULT 500 CHECK (hourly_cents BETWEEN 0 AND 100000),
  offers_board_games BOOLEAN NOT NULL DEFAULT TRUE,
  offers_dnd         BOOLEAN NOT NULL DEFAULT FALSE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Windows a host is free, in the same date + start + length terms as a
-- booking (so the service night past midnight works the same way). A booking
-- with a host must sit entirely inside one of that host's windows.
CREATE TABLE IF NOT EXISTS host_availability (
  id           SERIAL PRIMARY KEY,
  host_id      INTEGER NOT NULL REFERENCES hosts (user_id) ON DELETE CASCADE,
  avail_date   DATE    NOT NULL,
  time_slot    TEXT    NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 60 AND 780),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS host_availability_lookup
  ON host_availability (avail_date, host_id);

-- The host on a booking and what they cost. The fee is per hour for the whole
-- group (not per person), fixed at the price when booked.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS host_id INTEGER REFERENCES hosts (user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS host_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (host_fee_cents >= 0);

-- A host cannot be in two places at once: enforced by the database, exactly
-- as a table cannot be double-booked (bookings_no_overlap).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_host_no_overlap') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_host_no_overlap
      EXCLUDE USING gist (
        host_id WITH =,
        booking_window(booking_date, time_slot, duration_min) WITH &&
      )
      WHERE (host_id IS NOT NULL AND status <> 'cancelled');
  END IF;
END
$$;
