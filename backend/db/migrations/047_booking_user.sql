-- Which account made a booking. Booking history used to be matched on email
-- alone, so whoever held an account with that email saw every booking under
-- it — codes included — even ones they did not make (a staff-entered booking
-- for that address, or one made before someone registered the address first).
-- History now shows the code only on bookings the account itself made.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id) WHERE user_id IS NOT NULL;

-- Existing online bookings carrying an account's email were made while signed
-- in to that account (the site only ever sent the signed-in email), so they
-- are that account's. Staff-entered and older guest bookings stay unowned.
UPDATE bookings b
   SET user_id = u.id
  FROM users u
 WHERE b.user_id IS NULL
   AND b.source = 'online'
   AND b.guest_email IS NOT NULL
   AND lower(b.guest_email) = lower(u.email)
   AND b.created_at >= u.created_at;
