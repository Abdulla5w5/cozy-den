-- Online bookings made without an account now give a phone number instead of
-- an email: it is how staff reach a customer (call or WhatsApp). The number is
-- stored as E.164, like users.phone. Email becomes optional — a signed-in
-- customer's booking still carries their account email, which links it to
-- their history and receives the receipt.

BEGIN;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_phone TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_guest_phone_kuwait_check') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_guest_phone_kuwait_check
      CHECK (guest_phone IS NULL OR guest_phone ~ '^\+965([2569][0-9]{7}|41[0-9]{6})$');
  END IF;
END $$;

ALTER TABLE bookings ALTER COLUMN guest_email DROP NOT NULL;

COMMIT;
