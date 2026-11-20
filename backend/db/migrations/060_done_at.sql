-- When staff marked a booking done. Done frees the table for what comes next
-- (migration 054), but the sitting still happened: a booking entered late, or
-- moved, onto a time already past must not land on a group that really sat
-- there. The group held the table from its start until this moment (to the
-- half hour), so that span stays taken for past times. Older rows have none and
-- block nothing, as before.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;
