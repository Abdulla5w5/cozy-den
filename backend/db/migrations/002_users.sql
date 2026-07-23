-- Universal accounts. Anyone can register/log in; "staff" is derived from the
-- STAFF_ALLOWED_EMAILS allow-list at auth time (not stored here).
BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,                    -- null for Google-only accounts
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'local' CHECK (provider IN ('local', 'google')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
