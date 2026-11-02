-- A flat price for a six-hour booking Sunday to Wednesday (the café's list,
-- Oct 2026, item 29): 5.900 KD a seat, whatever the size of the group and
-- with no promo code, in place of the three 2-hour blocks it would otherwise
-- cost. Every other price is unchanged. NULL turns it off. In the same
-- 1/100 KD units as the other rates.
ALTER TABLE pricing_rates
  ADD COLUMN IF NOT EXISTS six_hour_offpeak_cents INTEGER DEFAULT 590
    CHECK (six_hour_offpeak_cents IS NULL OR six_hour_offpeak_cents >= 0);
