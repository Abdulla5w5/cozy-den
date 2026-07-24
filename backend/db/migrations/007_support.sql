-- Suggestions & Support: a small ticketing inbox backed by Postgres.
--
-- Three tables: the request, its message thread, and an audit trail of status
-- changes. Every message is persisted — nothing lives only in the browser.
BEGIN;

CREATE TABLE IF NOT EXISTS support_requests (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('suggestion', 'complaint', 'question')),
  -- Severity only applies to complaints; enforced by the CHECK below.
  severity    TEXT CHECK (severity IN ('low', 'normal', 'urgent')),
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT severity_only_for_complaints CHECK (
    (kind = 'complaint' AND severity IS NOT NULL) OR
    (kind <> 'complaint' AND severity IS NULL)
  )
);

-- Customer inbox ("my requests") and staff inbox (newest activity first).
CREATE INDEX IF NOT EXISTS support_requests_user_idx
  ON support_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_requests_status_idx
  ON support_requests (status, updated_at DESC);
-- Staff triage: open complaints, urgent first. Partial keeps the index small.
CREATE INDEX IF NOT EXISTS support_requests_open_idx
  ON support_requests (updated_at DESC)
  WHERE status IN ('open', 'in_progress');

CREATE TABLE IF NOT EXISTS support_messages (
  id           SERIAL PRIMARY KEY,
  request_id   INTEGER NOT NULL REFERENCES support_requests (id) ON DELETE CASCADE,
  author_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  author_name  TEXT NOT NULL,          -- denormalised: survives account deletion
  author_role  TEXT NOT NULL CHECK (author_role IN ('customer', 'staff')),
  -- Internal notes are staff-only and never serialised to a customer response.
  is_internal  BOOLEAN NOT NULL DEFAULT FALSE,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT internal_notes_are_staff_only CHECK (
    NOT is_internal OR author_role = 'staff'
  )
);

CREATE INDEX IF NOT EXISTS support_messages_thread_idx
  ON support_messages (request_id, created_at);

-- Who changed a request's status, when, and to what.
CREATE TABLE IF NOT EXISTS support_status_events (
  id          SERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES support_requests (id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  actor_name  TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_status_events_request_idx
  ON support_status_events (request_id, created_at);

COMMIT;
