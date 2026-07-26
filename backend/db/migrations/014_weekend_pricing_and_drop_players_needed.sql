-- Weekend / holiday pricing, and removal of a now-meaningless column.
--
-- (A) players_needed is dropped. A post fills at max_players, so the field was
--     stored and displayed but drove nothing — a poster entering "needs 3" on a
--     post that stays open until 8 reads as a bug. min_players still expresses
--     the floor for a session to be worth running.
--
-- (B) Table pricing is no longer flat. Thursday, Friday, Saturday and Kuwait
--     national holidays are KD 3.500; every other day is KD 2.750. Both are per
--     booking, for the full two-hour session.
--
--     Holidays are a TABLE, not a hardcoded list, for two reasons: the Islamic
--     holidays (both Eids, Hijri New Year, the Prophet's birthday, Isra & Miraj)
--     move roughly eleven days earlier each year against this calendar, so any
--     list baked into code is wrong within a year; and staff can correct a date
--     the moment it is announced without waiting for a deploy.
--
--     Seeded with the two fixed national days only. The lunar dates must be
--     added each year — see the note in the README.

BEGIN;

ALTER TABLE wanted_posts DROP COLUMN IF EXISTS players_needed;

CREATE TABLE IF NOT EXISTS holidays (
  holiday_date DATE PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- National Day and Liberation Day are fixed to the Gregorian calendar, so they
-- can be seeded ahead. Generated rather than typed out to avoid a stale list.
INSERT INTO holidays (holiday_date, name)
SELECT make_date(y, 2, 25), 'National Day'
  FROM generate_series(2026, 2035) AS y
ON CONFLICT (holiday_date) DO NOTHING;

INSERT INTO holidays (holiday_date, name)
SELECT make_date(y, 2, 26), 'Liberation Day'
  FROM generate_series(2026, 2035) AS y
ON CONFLICT (holiday_date) DO NOTHING;

COMMIT;
