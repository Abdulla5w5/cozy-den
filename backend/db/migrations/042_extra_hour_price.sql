-- The café's price for the odd hour on a 3- or 5-hour booking (Nov 2026):
-- 1.350 KD a seat Sunday to Wednesday, 1.750 KD Thursday to Saturday, on top
-- of the 2-hour blocks. Until now that hour was half a block (1.375 / 1.750).
-- NULL goes back to half a block. In the same 1/100 KD units as the other
-- rates.
ALTER TABLE pricing_rates
  ADD COLUMN IF NOT EXISTS extra_hour_offpeak_cents INTEGER DEFAULT 135
    CHECK (extra_hour_offpeak_cents IS NULL OR extra_hour_offpeak_cents >= 0),
  ADD COLUMN IF NOT EXISTS extra_hour_peak_cents INTEGER DEFAULT 175
    CHECK (extra_hour_peak_cents IS NULL OR extra_hour_peak_cents >= 0);
