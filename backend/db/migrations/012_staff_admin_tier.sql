-- Separate "can work the counter" from "can change who works the counter".
--
-- Until now is_staff was the only tier, so every counter login could grant
-- itself help, promote anyone, or revoke a colleague. One shared terminal left
-- unlocked was enough to take over the dashboard permanently. Team management
-- now needs is_admin; everything else the dashboard does still needs only
-- is_staff, so day-to-day work is unchanged.
--
-- Every CURRENT staff member becomes an admin. Anything else would lock the
-- café out of its own team page the moment this deploys — the tightening
-- applies to accounts granted from here on, which is where the risk actually
-- lives.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users SET is_admin = TRUE WHERE is_staff AND NOT is_admin;

CREATE INDEX IF NOT EXISTS users_is_admin_idx ON users (id) WHERE is_admin;

COMMIT;
