-- Notes staff keep on a booking, walk-ins included. For staff only: nothing a
-- customer can reach selects this column.
-- The 2000-character limit is the API's. This is the backstop, in bytes so it
-- means the same under any database encoding: Arabic takes two bytes a letter.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS staff_notes TEXT CHECK (octet_length(staff_notes) <= 8000);
