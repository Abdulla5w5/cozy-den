-- Cozy Den — phase 1 schema
-- Money is stored as INTEGER cents to avoid floating-point rounding on prices/totals.
-- Time slots are fixed 2-hour seatings; slot start is stored as TEXT ('12:00' ... '20:00').

BEGIN;

CREATE TABLE IF NOT EXISTS tables (
  id         SERIAL PRIMARY KEY,
  label      TEXT    NOT NULL,
  capacity   INTEGER NOT NULL CHECK (capacity > 0)
);

CREATE TABLE IF NOT EXISTS games (
  id          SERIAL PRIMARY KEY,
  title       TEXT    NOT NULL,
  min_players INTEGER NOT NULL CHECK (min_players > 0),
  max_players INTEGER NOT NULL CHECK (max_players >= min_players),
  category    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
  id          SERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL CHECK (category IN ('food', 'drink')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  description TEXT    NOT NULL DEFAULT '',
  available   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS bookings (
  id                SERIAL PRIMARY KEY,
  table_id          INTEGER NOT NULL REFERENCES tables(id),
  game_id           INTEGER REFERENCES games(id),
  booking_date      DATE    NOT NULL,
  time_slot         TEXT    NOT NULL,
  guest_name        TEXT    NOT NULL,
  guest_email       TEXT    NOT NULL,
  verification_code TEXT    NOT NULL UNIQUE,
  status            TEXT    NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('pending_payment', 'confirmed', 'arrived', 'cancelled')),
  table_fee_cents   INTEGER NOT NULL DEFAULT 0 CHECK (table_fee_cents >= 0),
  items_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (items_total_cents >= 0),
  total_cents       INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  payment_ref       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent double-booking a table for the same date+slot while a booking is live.
-- Cancelled bookings are excluded so a slot frees up if a booking is cancelled.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_unique
  ON bookings (table_id, booking_date, time_slot)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings (booking_date);

CREATE TABLE IF NOT EXISTS booking_items (
  id              SERIAL PRIMARY KEY,
  booking_id      INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  menu_item_id    INTEGER NOT NULL REFERENCES menu_items(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  -- price captured at booking time so later menu price changes don't rewrite history
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
);

CREATE INDEX IF NOT EXISTS booking_items_booking_idx ON booking_items (booking_id);

CREATE TABLE IF NOT EXISTS staff_users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
