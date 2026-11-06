-- QR check-in passes (Nov 2026). Every table booking, event seat and Wanted
-- Board seat carries a long random key; its QR code is just a link holding
-- that key. Staff scan it with the phone's camera app and, signed in, check
-- the guest in from the page it opens. Anyone else who opens the link sees
-- only the basics. The key is made by the server with a secure random source
-- (not here, so this works on any Postgres version); older bookings get one
-- the first time their confirmation is opened.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS checkin_token TEXT,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE event_reservations
  ADD COLUMN IF NOT EXISTS checkin_token TEXT,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE wanted_post_seats
  ADD COLUMN IF NOT EXISTS checkin_token TEXT,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_checkin_token_idx
  ON bookings (checkin_token) WHERE checkin_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_reservations_checkin_token_idx
  ON event_reservations (checkin_token) WHERE checkin_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wanted_post_seats_checkin_token_idx
  ON wanted_post_seats (checkin_token) WHERE checkin_token IS NOT NULL;
