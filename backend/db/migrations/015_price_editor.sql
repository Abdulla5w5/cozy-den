-- Turn the fixed holiday list into a general price editor staff can drive.
--
-- Holidays were only ever one reason a date costs something different. Staff
-- will also want quiet-Tuesday discounts, Ramadan rates, or a one-off event
-- upcharge — all the same shape: "on this date, charge this instead". So the
-- table stores a PRICE per date, not a flag, and the two base rates move out of
-- environment variables (which need a redeploy to change) into a row staff can
-- edit.
--
-- Resolution order at checkout: an override for the exact date wins; otherwise
-- Thu/Fri/Sat pay the peak rate; otherwise off-peak.

BEGIN;

-- Single row. The CHECK on a constant primary key is the standard way to keep
-- a settings table from ever growing a second, ambiguous row.
CREATE TABLE IF NOT EXISTS pricing_rates (
  id            BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  peak_cents    INTEGER NOT NULL CHECK (peak_cents >= 0),
  offpeak_cents INTEGER NOT NULL CHECK (offpeak_cents >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO pricing_rates (id, peak_cents, offpeak_cents)
VALUES (TRUE, 350, 275)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS price_overrides (
  override_date DATE PRIMARY KEY,
  label         TEXT NOT NULL,
  fee_cents     INTEGER NOT NULL CHECK (fee_cents >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Carry the seeded national holidays across at the peak rate they were already
-- charging, so nothing changes price as a side effect of this migration.
INSERT INTO price_overrides (override_date, label, fee_cents)
SELECT h.holiday_date, h.name, 350
  FROM holidays h
ON CONFLICT (override_date) DO NOTHING;

DROP TABLE IF EXISTS holidays;

COMMIT;
