-- One newcomer discount per customer, enforced by the database: two checkouts
-- started at the same moment must not both get it. Counted per account email
-- and per phone, the identity every online booking has. Cancelled bookings
-- (abandoned or declined payments) do not count.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS newcomer_discount BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_newcomer_email_once
  ON bookings (lower(guest_email))
  WHERE newcomer_discount AND status <> 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS bookings_newcomer_phone_once
  ON bookings (guest_phone)
  WHERE newcomer_discount AND status <> 'cancelled';
