-- The café's answers (Nov 2026).
--
-- Group prices for 6+ with a promo code are confirmed, with no end date:
-- Sunday-Wednesday 2.250 KD for two hours then 1.000 KD an hour, Saturday
-- 2.850 KD then 1.400 KD an hour (Thursday and Friday stay at normal prices).
-- COALESCE: an admin who has already typed prices keeps them.
UPDATE pricing_rates
   SET group_offpeak_cents = COALESCE(group_offpeak_cents, 225),
       group_extra_offpeak_cents = COALESCE(group_extra_offpeak_cents, 100),
       group_saturday_cents = COALESCE(group_saturday_cents, 285),
       group_extra_saturday_cents = COALESCE(group_extra_saturday_cents, 140),
       updated_at = now()
 WHERE id;

-- Customers do not choose a host by name. They choose one of two options, and
-- a free host who offers it is assigned automatically. So the price belongs to
-- the option, per hour for the whole table, whatever the group size. A NULL
-- price hides the option: the Blood on the Clocktower price is still to come.
ALTER TABLE pricing_rates
  ADD COLUMN IF NOT EXISTS host_normal_hourly_cents INTEGER DEFAULT 500
    CHECK (host_normal_hourly_cents IS NULL OR host_normal_hourly_cents >= 0),
  ADD COLUMN IF NOT EXISTS host_clocktower_hourly_cents INTEGER
    CHECK (host_clocktower_hourly_cents IS NULL OR host_clocktower_hourly_cents >= 0);

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS offers_clocktower BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS host_kind TEXT CHECK (host_kind IN ('normal', 'clocktower'));
