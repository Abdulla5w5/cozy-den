-- A single normalized contact number per registered customer. Legacy accounts
-- remain nullable; every new local or Google registration is enforced by the
-- API. E.164 keeps the value compact and directly usable by staff devices.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_kuwait_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_kuwait_check
      CHECK (phone IS NULL OR phone ~ '^\+965([2569][0-9]{7}|41[0-9]{6})$');
  END IF;
END $$;

COMMIT;
