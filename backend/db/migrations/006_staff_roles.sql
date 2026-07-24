-- Staff access moves from the STAFF_ALLOWED_EMAILS env allow-list to a column on
-- users, granted by an existing staff member from the dashboard.
--
-- Why: the allow-list granted staff to whoever held an account with a listed
-- email. Registration is open and unverified, so listing an address before its
-- owner had registered handed staff access to whoever claimed it first. Granting
-- against an existing account closes that.
--
-- The env var is now bootstrap-only: it seeds the first staff row when none
-- exists (break-glass), and is otherwise ignored.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_staff BOOLEAN NOT NULL DEFAULT FALSE;

-- requireStaff hits this on every staff request; keep the lookup off a seq scan.
CREATE INDEX IF NOT EXISTS users_is_staff_idx ON users (id) WHERE is_staff;

-- Who granted or revoked whom. Rows survive the user being deleted so the trail
-- can't be erased by removing an account.
CREATE TABLE IF NOT EXISTS staff_grants (
  id             SERIAL PRIMARY KEY,
  actor_user_id  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  actor_email    TEXT,                    -- denormalised: survives actor deletion
  target_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  target_email   TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('grant', 'revoke', 'bootstrap')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_grants_created_idx ON staff_grants (created_at DESC);

COMMIT;
