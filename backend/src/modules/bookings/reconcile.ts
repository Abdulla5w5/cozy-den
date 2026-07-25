import { query } from '../../db/pool';
import { paymentProvider } from '../../payment';
import { finalizeCharge } from './bookings.service';

/**
 * Reconciliation sweep for redirect payments (Tap).
 *
 * The primary confirmation is the browser return redirect, backed up by the
 * webhook. This sweep is the *third* safety net: if a customer paid but never
 * came back (tab closed, phone died) and no webhook is configured, their money
 * is captured while the booking sits at 'pending_payment'. The sweep re-checks
 * such bookings against Tap and settles them from the authoritative status.
 *
 * Runs in-process (not a droplet cron) because this is where the Tap secret key
 * and finalizeCharge live — a cron would mean copying the secret onto the box.
 *
 * Idempotent and safe to run concurrently with the return/webhook paths and
 * with itself: finalizeCharge only transitions a booking still in
 * 'pending_payment', via a guarded UPDATE.
 */

// Give a real payment time to complete before we consider a booking stuck.
const STALE_AFTER_MIN = 15;
// Stop re-checking ancient rows; a paid-but-unconfirmed charge this old is
// vanishingly unlikely and better handled by staff than swept forever.
const GIVE_UP_AFTER_DAYS = 3;
const BATCH = 50;

export async function reconcilePendingPayments(): Promise<{
  checked: number;
  confirmed: number;
  cancelled: number;
}> {
  // Only redirect gateways have charges to reconcile; mock is a no-op.
  if (paymentProvider.kind !== 'redirect' || !paymentProvider.retrieveCharge) {
    return { checked: 0, confirmed: 0, cancelled: 0 };
  }

  const { rows } = await query<{ payment_ref: string }>(
    `SELECT payment_ref
       FROM bookings
      WHERE status = 'pending_payment'
        AND payment_ref LIKE 'chg_%'
        AND created_at < now() - ($1 || ' minutes')::interval
        AND created_at > now() - ($2 || ' days')::interval
      ORDER BY created_at
      LIMIT ${BATCH}`,
    [String(STALE_AFTER_MIN), String(GIVE_UP_AFTER_DAYS)],
  );

  let confirmed = 0;
  let cancelled = 0;
  for (const row of rows) {
    try {
      const { outcome } = await finalizeCharge(row.payment_ref);
      if (outcome === 'paid') confirmed++;
      else if (outcome === 'failed') cancelled++;
      // 'pending' = still in flight at Tap; leave it for a later sweep.
    } catch (err) {
      console.error('[reconcile] finalize failed for', row.payment_ref, err);
    }
  }

  if (rows.length > 0) {
    console.log(
      `[reconcile] checked ${rows.length}, confirmed ${confirmed}, cancelled ${cancelled}`,
    );
  }
  return { checked: rows.length, confirmed, cancelled };
}

let timer: NodeJS.Timeout | undefined;

/** Start the periodic sweep. No-op unless a redirect gateway is configured. */
export function startReconciler(intervalMs = 5 * 60 * 1000): void {
  if (paymentProvider.kind !== 'redirect') return;
  if (timer) return;
  const run = () =>
    reconcilePendingPayments().catch((err) => console.error('[reconcile] sweep error', err));
  timer = setInterval(run, intervalMs);
  // Don't let the sweep keep the process alive on shutdown.
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[reconcile] pending-payment sweep every ${Math.round(intervalMs / 1000)}s`);
  // A first pass shortly after boot catches anything stranded across a restart.
  setTimeout(run, 30 * 1000).unref?.();
}
