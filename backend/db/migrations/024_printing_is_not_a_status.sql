-- Printing a receipt stops being a step in the order's life.
--
-- The workflow was: pending -> (staff confirms arrival) -> print_receipt ->
-- (staff clicks after printing) -> order_complete. That made the receipt
-- load-bearing: the booking could not finish until someone printed, and the
-- browser's `afterprint` event — which fires whether or not paper came out —
-- was what advanced it. Cancelling the print dialog completed the order, and
-- nothing could be reprinted afterwards because the state had moved on.
--
-- Printing is a capability, not a stage. Any confirmed, paid booking can be
-- printed, as often as needed, without touching its status. The middle state
-- keeps its real meaning — the guest turned up — and is renamed to say so.
BEGIN;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

-- Widen first so the rename has somewhere to land.
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending_payment', 'pending', 'print_receipt', 'arrived',
                    'order_complete', 'cancelled'));

-- Every booking sitting at 'print_receipt' is one where staff confirmed the
-- guest arrived and simply had not printed yet. Under the new model that is
-- exactly 'arrived', so these carry over with their meaning intact.
UPDATE bookings SET status = 'arrived' WHERE status = 'print_receipt';

-- Now retire the old name.
ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending_payment', 'pending', 'arrived',
                    'order_complete', 'cancelled'));

COMMIT;
