-- Batch 1: booking system overhaul.
--  * bookings.source: 'online' | 'staff_manual' (additive, for reporting)
--  * New status workflow: pending -> print_receipt -> order_complete
--    ('pending_payment' remains the transient pre-charge hold; 'cancelled' unchanged)
--  * Rolling 30-min start times with fixed 2h sessions: the old per-slot unique
--    index can no longer prevent overlaps (12:00 vs 12:30 are distinct values but
--    collide), so it is replaced by a GiST exclusion constraint on the actual
--    2-hour time range. Back-to-back bookings are allowed ('[)' range bounds).

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online'
    CHECK (source IN ('online', 'staff_manual'));

-- Remap old statuses before tightening the check constraint.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
UPDATE bookings SET status = 'pending'        WHERE status = 'confirmed';
UPDATE bookings SET status = 'order_complete' WHERE status = 'arrived';
ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending_payment', 'pending', 'print_receipt', 'order_complete', 'cancelled'));
ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending';

-- Overlap prevention: no two live bookings on the same table may have
-- intersecting [start, start+2h) windows. Cancelled rows free their window.
-- The text->time cast isn't IMMUTABLE by default, so wrap the window
-- computation in an IMMUTABLE helper (safe: 'HH:MM' parsing is deterministic).
CREATE OR REPLACE FUNCTION booking_window(d date, slot text)
RETURNS tsrange
LANGUAGE sql IMMUTABLE STRICT
AS $$ SELECT tsrange(d + slot::time, d + slot::time + interval '2 hours') $$;

DROP INDEX IF EXISTS bookings_slot_unique;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    table_id WITH =,
    booking_window(booking_date, time_slot) WITH &&
  )
  WHERE (status <> 'cancelled');

COMMIT;
