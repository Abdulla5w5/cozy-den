-- Email verification for self-registered accounts.
--
-- Non-blocking by design: an unverified account works normally (guest checkout
-- means booking never needs an account), we just surface a "please verify"
-- prompt and let the customer confirm ownership of their email.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Accounts that predate this migration are grandfathered as verified — we can't
-- retroactively ask them, and Google accounts are already email-proven. New
-- self-registrations start unverified via the column default.
UPDATE users SET email_verified = TRUE, email_verified_at = now() WHERE email_verified = FALSE;

-- Only the token HASH is stored, so a DB leak can't be used to verify accounts.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id);

COMMIT;
