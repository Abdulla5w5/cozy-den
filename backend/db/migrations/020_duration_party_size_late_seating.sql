-- Customer-chosen duration and party size, plus a late-seating rate.
--
-- Until now every booking was implicitly a 2-hour session and the party size
-- was never captured. Both are now the customer's to set, so the length has to
-- become a stored fact rather than a constant baked into a SQL function.
BEGIN;

-- (A) Duration and party size.
--
-- duration_min defaults to 120 so every existing row keeps exactly the length
-- it was sold with. party_size defaults to 1, matching what the system
-- previously assumed. The upper bound on party_size is a sanity rail only —
-- the real limit is the table's own capacity, which is enforced in the service
-- layer where the table row is already in hand.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS duration_min INTEGER NOT NULL DEFAULT 120
    CHECK (duration_min >= 30 AND duration_min <= 780 AND duration_min % 30 = 0),
  ADD COLUMN IF NOT EXISTS party_size INTEGER NOT NULL DEFAULT 1
    CHECK (party_size > 0 AND party_size <= 100);

-- (B) Overlap prevention has to account for length, and for midnight.
--
-- The old window was `d + slot::time` for a fixed 2 hours. That placed a 01:00
-- start on the SAME calendar day as the evening it belongs to — 13 hours before
-- the 14:00 opening. This was harmless while nothing could cross midnight: an
-- early window and a late window could never intersect anyway.
--
-- Variable duration breaks that. A 22:00 start running four hours now genuinely
-- overlaps a 01:00 start, but under the old arithmetic their ranges were a day
-- apart and the constraint would have waved the double-booking through. Slots
-- before opening are therefore rolled onto the following day, which is the same
-- normalisation `toMinutes()` already does in TypeScript.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
DROP FUNCTION IF EXISTS booking_window(date, text);

CREATE OR REPLACE FUNCTION booking_window(d date, slot text, dur int)
RETURNS tsrange
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT tsrange(ts, ts + make_interval(mins => dur))
    FROM (
      SELECT d + slot::time
             + CASE WHEN slot::time < time '14:00' THEN interval '1 day'
                    ELSE interval '0' END AS ts
    ) s
$$;

ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    table_id WITH =,
    booking_window(booking_date, time_slot, duration_min) WITH &&
  )
  WHERE (status <> 'cancelled');

-- (C) Late-seating rates.
--
-- Intake now runs to 02:00, but the café still closes at 03:00, so a booking
-- starting after 01:00 cannot get a full two hours. Those seatings are charged
-- a reduced flat rate instead of a 2-hour block: KD 2.00 midweek, KD 2.50 on
-- peak days. Stored in the same 1/100 units as every other rate here, which is
-- what the money formatter divides by — the existing KD 2.75 base rate is 275.
ALTER TABLE pricing_rates
  ADD COLUMN IF NOT EXISTS late_peak_cents INTEGER NOT NULL DEFAULT 250
    CHECK (late_peak_cents >= 0),
  ADD COLUMN IF NOT EXISTS late_offpeak_cents INTEGER NOT NULL DEFAULT 200
    CHECK (late_offpeak_cents >= 0);

COMMIT;
