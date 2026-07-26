-- Batch: remove schema that no longer earns its keep, and index the one hot
-- lookup that was missing. Nothing here changes behaviour or any response
-- shape — it only lowers the cost of what the app already does.
--
-- (A) staff_users is orphaned. Migration 006 introduced users.is_staff and the
--     application moved to it — team.service reads only that column — but 006
--     never carried the old rows across, so anyone granted access before it is
--     still recorded ONLY in staff_users. Dropping the table outright would
--     quietly delete that record, so promote first and drop second.
--
--     Emails with no matching users row are left behind deliberately: sign-in
--     resolves against users, so such an entry already grants nothing. It is
--     recorded in staff_grants rather than discarded, giving the audit trail a
--     trace of what the table held.
--
-- (B) bookings_date_idx duplicates work already covered. Every date-scoped
--     query in the app (availability, staff day view, all four monthly
--     analytics aggregates) also filters status <> 'cancelled', which the
--     narrower partial index bookings_active_date_idx serves better. Carrying
--     both means two index writes per booking insert and update for one read
--     path. Dropped the broad one, kept the partial.
--
-- (C) bookings.payment_ref had no index at all, yet finalizeCharge looks a
--     booking up by it on EVERY gateway return, every webhook retry and every
--     reconciliation sweep — the three paths that decide whether a customer
--     who just paid gets their table. That was a sequential scan of the whole
--     bookings table each time, growing with every booking ever taken.
--     Partial, because a row without a charge id is never looked up this way.

BEGIN;

-- (A) Carry any surviving grant onto users.is_staff...
UPDATE users u
   SET is_staff = TRUE
  FROM staff_users s
 WHERE lower(u.email) = lower(s.email)
   AND NOT u.is_staff;

-- ...record every row the table held, so the drop loses no history...
INSERT INTO staff_grants (actor_user_id, actor_email, target_user_id, target_email, action)
SELECT NULL, NULL, u.id, s.email, 'bootstrap'
  FROM staff_users s
  LEFT JOIN users u ON lower(u.email) = lower(s.email);

-- ...and only then remove it.
DROP TABLE IF EXISTS staff_users;

-- (B)
DROP INDEX IF EXISTS bookings_date_idx;

-- (C)
CREATE INDEX IF NOT EXISTS bookings_payment_ref_idx
  ON bookings (payment_ref)
  WHERE payment_ref IS NOT NULL;

COMMIT;
