-- Money staff took or handed back by hand for a booking, on top of what was paid
-- online. Kept apart from total_cents, which stays what the gateway charged, so
-- payment checks are untouched. Staff only; counted in revenue.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS counter_cents INTEGER NOT NULL DEFAULT 0
    CHECK (counter_cents BETWEEN -1000000 AND 1000000);
