-- A 3-hour length (the café's request, Oct 2026), priced pro rata like the
-- 5-hour one: one and a half 2-hour blocks. Table bookings check their length
-- in code (utils/slots.ts BOOKING_LENGTHS) under a broad range constraint, so
-- only the Wanted Board's fixed list needs widening — to the same five lengths
-- a table booking offers: 2, 3, 4, 5 and 6 hours.
ALTER TABLE wanted_posts DROP CONSTRAINT IF EXISTS wanted_posts_duration_min_check;
ALTER TABLE wanted_posts
  ADD CONSTRAINT wanted_posts_duration_min_check
    CHECK (duration_min IN (120, 180, 240, 300, 360));
