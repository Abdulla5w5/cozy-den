-- Shared tables: a table of 6 or more seats can be booked by halves, each by a
-- small group. `half` is 1 or 2 for a half, and empty for the whole table.
-- The overlap rule now compares parts as well as times: the whole table is
-- parts [1,3), half 1 is [1,2) and half 2 is [2,3). So a whole booking blocks
-- both halves, a half blocks only its own half and the whole, and the two
-- halves never block each other. Existing rows are all whole, so the rule is
-- unchanged for them.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS half SMALLINT CHECK (half IN (1, 2));

CREATE OR REPLACE FUNCTION booking_parts(h smallint)
RETURNS int4range
LANGUAGE sql IMMUTABLE
AS $$
  SELECT int4range(COALESCE(h, 1)::int, COALESCE(h, 2)::int + 1)
$$;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    table_id WITH =,
    booking_parts(half) WITH &&,
    booking_window(booking_date, time_slot, duration_min) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'order_complete'));
