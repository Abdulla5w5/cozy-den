-- A released Wanted Board hold (payment failed, abandoned, or cleared on a
-- retry) is now marked 'released' instead of deleted. If a slow payment lands
-- after the release, the row is still there to settle against, so the money
-- is never orphaned. Released rows do not count towards seats taken.
ALTER TABLE wanted_post_seats DROP CONSTRAINT IF EXISTS wanted_post_seats_payment_state_check;
ALTER TABLE wanted_post_seats
  ADD CONSTRAINT wanted_post_seats_payment_state_check
  CHECK (payment_state IN ('pending_payment', 'paid', 'released'));
