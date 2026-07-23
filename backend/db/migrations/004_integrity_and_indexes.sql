-- Batch: data integrity + query performance.
--
-- (A) Reference data was duplicating on every deploy: seed.js runs at each
--     container start and its ON CONFLICT DO NOTHING never fired because
--     tables.label / games.title / menu_items.name had no unique constraint.
--     Dedupe existing rows, then add the constraints so the seed is truly
--     idempotent.
-- (B) Add indexes for the hot query paths. Measured at 148k bookings:
--     customer history was a 53.6ms sequential scan (lower(guest_email) is not
--     indexable without a functional index).

BEGIN;

-- ---------- (A) dedupe reference data, keeping the lowest id ----------
CREATE TEMP TABLE table_map AS
  SELECT t.id AS dup_id, k.keep_id
    FROM tables t
    JOIN (SELECT label, min(id) AS keep_id FROM tables GROUP BY label) k USING (label)
   WHERE t.id <> k.keep_id;

CREATE TEMP TABLE game_map AS
  SELECT g.id AS dup_id, k.keep_id
    FROM games g
    JOIN (SELECT title, min(id) AS keep_id FROM games GROUP BY title) k USING (title)
   WHERE g.id <> k.keep_id;

CREATE TEMP TABLE menu_map AS
  SELECT m.id AS dup_id, k.keep_id
    FROM menu_items m
    JOIN (SELECT name, min(id) AS keep_id FROM menu_items GROUP BY name) k USING (name)
   WHERE m.id <> k.keep_id;

-- Repointing a booking onto the canonical table could collide with the
-- no-overlap exclusion constraint. Cancel any booking that would collide
-- (keeps history, frees the window) before repointing the rest.
UPDATE bookings b SET status = 'cancelled'
  FROM table_map tm
 WHERE b.table_id = tm.dup_id
   AND b.status <> 'cancelled'
   AND EXISTS (
     SELECT 1 FROM bookings o
      WHERE o.table_id = tm.keep_id
        AND o.status <> 'cancelled'
        AND booking_window(o.booking_date, o.time_slot)
         && booking_window(b.booking_date, b.time_slot)
   );

UPDATE bookings b SET table_id = tm.keep_id FROM table_map tm WHERE b.table_id = tm.dup_id;
UPDATE bookings b SET game_id  = gm.keep_id FROM game_map  gm WHERE b.game_id  = gm.dup_id;
UPDATE booking_items bi SET menu_item_id = mm.keep_id FROM menu_map mm WHERE bi.menu_item_id = mm.dup_id;

DELETE FROM tables     WHERE id IN (SELECT dup_id FROM table_map);
DELETE FROM games      WHERE id IN (SELECT dup_id FROM game_map);
DELETE FROM menu_items WHERE id IN (SELECT dup_id FROM menu_map);

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS; guard so the migration is
-- re-runnable if it ever fails partway through.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tables_label_key') THEN
    ALTER TABLE tables ADD CONSTRAINT tables_label_key UNIQUE (label);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_title_key') THEN
    ALTER TABLE games ADD CONSTRAINT games_title_key UNIQUE (title);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_name_key') THEN
    ALTER TABLE menu_items ADD CONSTRAINT menu_items_name_key UNIQUE (name);
  END IF;
END $$;

-- ---------- (B) performance indexes ----------
-- Customer booking history: WHERE lower(guest_email) = lower($1).
CREATE INDEX IF NOT EXISTS bookings_guest_email_lower_idx
  ON bookings (lower(guest_email));

-- Availability + staff day view: WHERE booking_date = $1 AND status <> 'cancelled'.
-- Partial keeps the index small (cancelled rows are dead weight for these reads).
CREATE INDEX IF NOT EXISTS bookings_active_date_idx
  ON bookings (booking_date, time_slot)
  WHERE status <> 'cancelled';

-- Recurrent-customer aggregate: GROUP BY guest_email over live bookings.
CREATE INDEX IF NOT EXISTS bookings_active_email_idx
  ON bookings (guest_email)
  WHERE status <> 'cancelled';

-- Staff dashboard status filter / outstanding-receipt counts.
CREATE INDEX IF NOT EXISTS bookings_status_date_idx
  ON bookings (status, booking_date);

COMMIT;

ANALYZE bookings;
ANALYZE tables;
ANALYZE games;
ANALYZE menu_items;
