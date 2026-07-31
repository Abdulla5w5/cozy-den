-- Staff can now add, edit and remove games and menu items from the dashboard.
--
-- Removal cannot simply be DELETE, because unlike events these rows have
-- dependents that carry real history:
--
--   bookings.game_id            -> RESTRICT: a past booking pins the game
--   booking_items.menu_item_id  -> RESTRICT: a past order pins the item
--   customer_game_history       -> CASCADE:  deleting a game would silently
--                                  erase customers' "games I've played" records
--   wanted_posts.game_id        -> SET NULL, which then trips the constraint
--                                  requiring a post to name SOME game
--
-- So a game that has been played is RETIRED rather than deleted: hidden from
-- the public library while every booking, order and play record it is attached
-- to stays intact. menu_items already had `available` for exactly this; games
-- gain the equivalent flag. A row nothing references is still deleted outright,
-- so a typo added by mistake genuinely disappears.

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
