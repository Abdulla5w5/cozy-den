-- Swap the names of two pairs of tables so the app matches the numbers on the
-- physical tables: B1 <-> B3 and S1 <-> S2.
--
-- Names only. Each row keeps its id, capacity and every booking made against
-- it — the table itself has not moved, only what it is called. The label
-- column is unique, so the swap goes through temporary names.

BEGIN;

UPDATE tables SET label = '__swap_B1' WHERE label = 'Big Table 1';
UPDATE tables SET label = 'Big Table 1' WHERE label = 'Big Table 3';
UPDATE tables SET label = 'Big Table 3' WHERE label = '__swap_B1';

UPDATE tables SET label = '__swap_S1' WHERE label = 'Small Table 1';
UPDATE tables SET label = 'Small Table 1' WHERE label = 'Small Table 2';
UPDATE tables SET label = 'Small Table 2' WHERE label = '__swap_S1';

COMMIT;
