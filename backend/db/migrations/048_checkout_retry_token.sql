-- A retry of an abandoned checkout can release the earlier hold at once when
-- it proves it comes from the same browser. The browser keeps a random token
-- and sends it with each checkout; only its SHA-256 is stored here, so the
-- database never holds anything that could be replayed. Without a matching
-- token (or the same signed-in account) the earlier hold still waits for the
-- payment page to time out, so knowing someone's phone or email is no way to
-- cancel their checkout.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS retry_token_hash TEXT;
ALTER TABLE event_reservations ADD COLUMN IF NOT EXISTS retry_token_hash TEXT;
