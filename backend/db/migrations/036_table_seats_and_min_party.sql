-- Seats as the café asked: S1 seats 5, S2 seats 4, and the Floor Table seats
-- 7 but takes parties of 2 or more. (The S1/S2 name swap in 030 carried the
-- old capacities across with the names, which left them the wrong way round.)
--
-- min_party overrides the size-based minimum party (MIN_SEATS_LADDER in
-- backend/src/utils/pricing.ts) for one table. NULL keeps the ladder.

BEGIN;

ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS min_party SMALLINT CHECK (min_party >= 1);

UPDATE tables SET capacity = 5 WHERE label = 'Small Table 1';
UPDATE tables SET capacity = 4 WHERE label = 'Small Table 2';
UPDATE tables SET capacity = 7, min_party = 2 WHERE label = 'Floor Table';

COMMIT;
