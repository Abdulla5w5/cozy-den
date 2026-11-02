-- A newcomer code (the café's list, item 31): 10% off a signed-in member's
-- first booking. Only for accounts, since a guest booking cannot tell a new
-- customer from a returning one. One code per booking, so it never combines
-- with a group code, and it does not apply to the flat six-hour price, which
-- is already an offer.
ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'group'
    CHECK (kind IN ('group', 'newcomer')),
  ADD COLUMN IF NOT EXISTS percent_off INTEGER
    CHECK (percent_off IS NULL OR percent_off BETWEEN 1 AND 100);

INSERT INTO promo_codes (code, min_party, kind, percent_off)
VALUES ('NEWCOMER', 1, 'newcomer', 10)
ON CONFLICT (code) DO NOTHING;
