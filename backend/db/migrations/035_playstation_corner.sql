-- The PlayStation corner becomes a bookable table: two armchairs facing a TV,
-- booked and priced per seat like every other table for now. The floor map
-- finds it by this label, so a rename must be mirrored in CafeFloorPlan.tsx.

INSERT INTO tables (label, capacity, is_active)
VALUES ('PlayStation Corner', 2, TRUE)
ON CONFLICT (label) DO NOTHING;
