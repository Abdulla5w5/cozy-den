-- Events can hold a table, and customers can reserve a seat.
--
-- Two additions that lean on machinery already here rather than duplicating it.
BEGIN;

-- (A) An event may occupy a specific table for a specific window.
--
-- start_time is a normal slot string and duration_min is measured the same way
-- a booking's is, so the event's window is expressed in exactly the vocabulary
-- utils/slots already understands.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS table_id         INTEGER REFERENCES tables (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_time       TEXT,
  ADD COLUMN IF NOT EXISTS duration_min     INTEGER
    CHECK (duration_min IS NULL OR (duration_min >= 30 AND duration_min <= 780 AND duration_min % 30 = 0)),
  -- NULL capacity = no seat limit. 0 would mean "sold out", which is different.
  ADD COLUMN IF NOT EXISTS capacity         INTEGER CHECK (capacity IS NULL OR capacity > 0),
  ADD COLUMN IF NOT EXISTS seat_price_cents INTEGER NOT NULL DEFAULT 0
    CHECK (seat_price_cents >= 0);

-- A table can only be held for a window that is actually defined.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_table_window_complete') THEN
    ALTER TABLE events ADD CONSTRAINT events_table_window_complete
      CHECK (table_id IS NULL OR (start_time IS NOT NULL AND duration_min IS NOT NULL));
  END IF;
END $$;

-- (B) Holding the table.
--
-- Rather than teach the availability query and the booking path about events,
-- an event that occupies a table writes an ordinary row into `bookings`. The
-- exclusion constraint added in 020 then does all the work, in both directions
-- and for free: a customer cannot book over an event, staff cannot put an event
-- on a table someone already booked, and getAvailability hides the slots with
-- no new logic at all.
--
-- ON DELETE CASCADE means deleting the event releases the table.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events (id) ON DELETE CASCADE;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_source_check
  CHECK (source IN ('online', 'staff_manual', 'event'));

-- One holding row per event, so re-saving an event updates rather than stacks.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_event_hold_unique
  ON bookings (event_id) WHERE event_id IS NOT NULL AND status <> 'cancelled';

-- (C) Seats customers have reserved.
--
-- Mirrors the booking flow's payment states: a seat is held as
-- 'pending_payment' while the gateway has the customer, becomes 'pending' once
-- paid, and 'cancelled' frees it again. Only live rows count toward capacity.
CREATE TABLE IF NOT EXISTS event_reservations (
  id                SERIAL PRIMARY KEY,
  event_id          INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  member_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  guest_name        TEXT    NOT NULL,
  guest_email       TEXT    NOT NULL,
  guest_phone       TEXT,
  seats             INTEGER NOT NULL DEFAULT 1 CHECK (seats > 0 AND seats <= 20),
  verification_code TEXT    NOT NULL UNIQUE,
  status            TEXT    NOT NULL DEFAULT 'pending_payment'
                    CHECK (status IN ('pending_payment', 'pending', 'attended', 'cancelled')),
  amount_cents      INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  payment_ref       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_reservations_event_idx
  ON event_reservations (event_id) WHERE status <> 'cancelled';

-- Abandoned checkouts are swept the same way stranded bookings are.
CREATE INDEX IF NOT EXISTS event_reservations_stale_idx
  ON event_reservations (created_at) WHERE status = 'pending_payment';

COMMIT;
