-- Replace the customer-facing table set without deleting historical tables.
-- Archived rows remain available to booking history and staff analytics.

BEGIN;

ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO tables (label, capacity, is_active) VALUES
  ('Small Table 1',     5,  TRUE),
  ('Small Table 2',     4,  TRUE),
  ('Small Table 3',     4,  TRUE),
  ('Big Table 1',       12, TRUE),
  ('Big Table 2',       6,  TRUE),
  ('Big Table 3',       12, TRUE),
  ('Big Table 4 (D&D)', 7,  TRUE),
  ('Floor Table',       6,  TRUE)
ON CONFLICT (label) DO UPDATE SET
  capacity = EXCLUDED.capacity,
  is_active = TRUE;

UPDATE tables
   SET is_active = FALSE
 WHERE label NOT IN (
   'Small Table 1',
   'Small Table 2',
   'Small Table 3',
   'Big Table 1',
   'Big Table 2',
   'Big Table 3',
   'Big Table 4 (D&D)',
   'Floor Table'
 );

COMMIT;
