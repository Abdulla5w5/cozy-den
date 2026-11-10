-- Staff can cancel a booking that is waiting or seated. Record who and when,
-- so a later Tap callback for that booking's captured payment is known to be a
-- staff cancellation, not money that arrived after the booking had expired.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS staff_cancelled_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS staff_cancelled_by INTEGER;
