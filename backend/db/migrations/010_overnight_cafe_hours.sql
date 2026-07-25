-- Café service day runs from 14:00 until 03:00 the following morning.
-- A booking_date identifies the evening the session belongs to, so starts
-- between midnight and 02:59 must be shifted into the following calendar day.
--
-- Historical starts from the old 12:00–22:00 schedule remain unchanged because
-- only times before 03:00 receive the overnight offset.

BEGIN;

CREATE OR REPLACE FUNCTION booking_window(d date, slot text)
RETURNS tsrange
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT tsrange(
    d + slot::time
      + CASE WHEN slot::time < time '03:00' THEN interval '1 day' ELSE interval '0 day' END,
    d + slot::time
      + CASE WHEN slot::time < time '03:00' THEN interval '1 day' ELSE interval '0 day' END
      + interval '2 hours'
  )
$$;

COMMIT;
