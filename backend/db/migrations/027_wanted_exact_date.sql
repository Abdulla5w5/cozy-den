-- A Wanted Board listing names one exact date, not days of the week.
--
-- A wanted session is a one-off, not a recurring event: "Sun · Tue" told nobody
-- which Sunday, and staff had to chase the poster to find out. A listing now
-- carries the date it is for. preferred_days stays as the derived day-of-week
-- (pricing reads it, and old posts have nothing else), but new posts always set
-- it from session_date so the two can never disagree.
BEGIN;

ALTER TABLE wanted_posts ADD COLUMN IF NOT EXISTS session_date DATE;

COMMIT;
