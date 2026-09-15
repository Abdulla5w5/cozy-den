-- Every Wanted Board listing carries the date it is for.
--
-- Listings from before 027 only named weekdays, so they had no date to expire
-- on and sat on the board indefinitely — one lingered a month past the only
-- Tuesday it could have meant. Backfill each with the first of its weekdays on
-- or after the day it was posted (the soonest session the poster could have
-- been asking for), then require the column, so the board can judge every
-- listing the same way and the "no date" case disappears from the code.

BEGIN;

UPDATE wanted_posts p
   SET session_date = (
     SELECT min(d::date)
       FROM generate_series(p.created_at::date, p.created_at::date + 6, '1 day') AS d
      WHERE cardinality(p.preferred_days) = 0
         OR extract(dow FROM d)::int = ANY(p.preferred_days)
   )
 WHERE p.session_date IS NULL;

ALTER TABLE wanted_posts ALTER COLUMN session_date SET NOT NULL;

COMMIT;
