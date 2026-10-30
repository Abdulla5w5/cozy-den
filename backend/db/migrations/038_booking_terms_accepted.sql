-- When the customer ticked "I agree to the terms" before paying. The café's
-- refund and no-show rules hang on that agreement, so it is kept with the
-- booking. NULL for bookings made before the checkbox existed, and for those
-- staff enter by hand.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
