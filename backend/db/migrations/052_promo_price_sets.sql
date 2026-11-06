-- Code prices (Nov 2026). What a promo code charges is no longer one shared set
-- of group prices: admins build named price sets and each code picks one.
--   hourly:  per person, the first two hours and each extra hour, for Sunday to
--            Wednesday, Thursday and Friday, and Saturday. A day left empty
--            charges normal prices.
--   percent: a percentage off the normal price. At most 99: the gateway cannot
--            take a charge of zero.
CREATE TABLE IF NOT EXISTS promo_price_sets (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60),
  kind               TEXT NOT NULL CHECK (kind IN ('hourly', 'percent')),
  percent_off        INTEGER CHECK (percent_off BETWEEN 1 AND 99),
  sunwed_cents       INTEGER CHECK (sunwed_cents >= 1),
  sunwed_extra_cents INTEGER CHECK (sunwed_extra_cents >= 0),
  thufri_cents       INTEGER CHECK (thufri_cents >= 1),
  thufri_extra_cents INTEGER CHECK (thufri_extra_cents >= 0),
  sat_cents          INTEGER CHECK (sat_cents >= 1),
  sat_extra_cents    INTEGER CHECK (sat_extra_cents >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'percent') = (percent_off IS NOT NULL)),
  CHECK ((sunwed_cents IS NULL) = (sunwed_extra_cents IS NULL)),
  CHECK ((thufri_cents IS NULL) = (thufri_extra_cents IS NULL)),
  CHECK ((sat_cents IS NULL) = (sat_extra_cents IS NULL))
);

-- The two sets already agreed with the café, carrying over what admins have saved
-- since migration 051 (which filled in the agreed prices). A day they left blank
-- stays blank, and so does a first-two-hours price of 0, which a set cannot hold:
-- both mean normal prices that day. Thursday and Friday stay at normal prices.
INSERT INTO promo_price_sets
  (name, kind, sunwed_cents, sunwed_extra_cents, sat_cents, sat_extra_cents)
SELECT 'Group of 6', 'hourly',
       CASE WHEN group_offpeak_cents >= 1 AND group_extra_offpeak_cents IS NOT NULL
            THEN group_offpeak_cents END,
       CASE WHEN group_offpeak_cents >= 1 AND group_extra_offpeak_cents IS NOT NULL
            THEN group_extra_offpeak_cents END,
       CASE WHEN group_saturday_cents >= 1 AND group_extra_saturday_cents IS NOT NULL
            THEN group_saturday_cents END,
       CASE WHEN group_saturday_cents >= 1 AND group_extra_saturday_cents IS NOT NULL
            THEN group_extra_saturday_cents END
  FROM pricing_rates WHERE id
ON CONFLICT (name) DO NOTHING;

INSERT INTO promo_price_sets (name, kind, percent_off)
VALUES ('Newcomer 10%', 'percent', 10)
ON CONFLICT (name) DO NOTHING;

-- A newcomer code keeps the percentage it already has. promo_codes allowed 100,
-- which a set does not: a charge of zero cannot go through the gateway anyway.
INSERT INTO promo_price_sets (name, kind, percent_off)
SELECT DISTINCT 'Newcomer ' || LEAST(percent_off, 99) || '%', 'percent', LEAST(percent_off, 99)
  FROM promo_codes
 WHERE kind = 'newcomer' AND percent_off IS NOT NULL
ON CONFLICT (name) DO NOTHING;

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS price_set_id INTEGER REFERENCES promo_price_sets (id) ON DELETE RESTRICT;

UPDATE promo_codes c
   SET price_set_id = (SELECT s.id FROM promo_price_sets s
                        WHERE s.name = 'Newcomer ' || LEAST(COALESCE(c.percent_off, 10), 99) || '%')
 WHERE c.kind = 'newcomer' AND c.price_set_id IS NULL;
UPDATE promo_codes
   SET price_set_id = (SELECT id FROM promo_price_sets WHERE name = 'Group of 6')
 WHERE kind = 'group' AND price_set_id IS NULL;

-- The group code the café settled on, ready to use.
INSERT INTO promo_codes (code, min_party, kind, price_set_id)
SELECT 'GROUP6', 6, 'group', id FROM promo_price_sets WHERE name = 'Group of 6'
ON CONFLICT (code) DO NOTHING;

ALTER TABLE promo_codes ALTER COLUMN price_set_id SET NOT NULL;
