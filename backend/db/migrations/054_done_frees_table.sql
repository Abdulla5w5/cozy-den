-- A booking staff have marked done no longer holds its table or its host, so a
-- group who leave early free the table for the rest of their slot. The rule
-- only gets looser, so existing rows cannot break it.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    table_id WITH =,
    booking_window(booking_date, time_slot, duration_min) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'order_complete'));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_host_no_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_host_no_overlap
  EXCLUDE USING gist (
    host_id WITH =,
    booking_window(booking_date, time_slot, duration_min) WITH &&
  )
  WHERE (host_id IS NOT NULL AND status NOT IN ('cancelled', 'order_complete'));

-- The price of the booking as it was paid for, at the rates of the first time
-- staff changed it. Every later price difference is measured from this, so
-- 5 to 6 and back to 5 people comes to no difference at all.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS first_quote_cents INTEGER;
