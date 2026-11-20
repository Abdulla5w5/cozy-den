-- Staff may enter a booking after it started (up to two days back), for a group
-- that sat down before anyone typed it in. Those bookings are flagged so they
-- can be told apart from bookings made ahead. A constant default makes this a
-- metadata-only change: no rewrite of the bookings table.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS entered_late BOOLEAN NOT NULL DEFAULT FALSE;
