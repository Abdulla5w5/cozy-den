-- Group promo codes (the café's list, item 30). A party of six or more with a
-- valid code pays the group prices instead of the normal ones: per seat, a
-- price for the first two hours, then a price per extra hour, for Sunday to
-- Wednesday and for Saturday (Thursday and Friday keep the weekend price).
-- The prices start empty, pending the café's confirmation (Nov 2026); staff
-- set them in the Pricing tab. Until a day's prices are set, a code changes
-- nothing on that day. All figures in 1/100 KD.
ALTER TABLE pricing_rates
  ADD COLUMN IF NOT EXISTS group_offpeak_cents INTEGER
    CHECK (group_offpeak_cents IS NULL OR group_offpeak_cents >= 0),
  ADD COLUMN IF NOT EXISTS group_extra_offpeak_cents INTEGER
    CHECK (group_extra_offpeak_cents IS NULL OR group_extra_offpeak_cents >= 0),
  ADD COLUMN IF NOT EXISTS group_saturday_cents INTEGER
    CHECK (group_saturday_cents IS NULL OR group_saturday_cents >= 0),
  ADD COLUMN IF NOT EXISTS group_extra_saturday_cents INTEGER
    CHECK (group_extra_saturday_cents IS NULL OR group_extra_saturday_cents >= 0);

-- Codes staff hand out. Stored upper-case; customers may type any case.
CREATE TABLE IF NOT EXISTS promo_codes (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE CHECK (code = upper(code) AND length(code) BETWEEN 3 AND 40),
  min_party   INTEGER NOT NULL DEFAULT 6 CHECK (min_party >= 1),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which code a booking used, if any. Kept as text so deleting a code later
-- does not rewrite history.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS promo_code TEXT;
