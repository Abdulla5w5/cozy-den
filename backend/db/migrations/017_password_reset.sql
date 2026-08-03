-- Forgot / reset password.
--
-- Same shape as email verification: only sha256(token) is stored, so the raw
-- token exists solely in the emailed link and a database leak cannot be used to
-- seize accounts. Tokens are single-use and short-lived — a reset link is far
-- more dangerous than a verification link, so one hour rather than 48.
--
-- password_changed_at exists to kill live sessions. Our sessions are stateless
-- JWTs, so without it someone who reset their password because an attacker had
-- their session would find that session still working for up to 8 more hours.
-- Any token issued before the reset is now refused.

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMIT;
