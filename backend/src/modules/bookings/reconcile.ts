import { query } from '../../db/pool';
import { paymentProvider } from '../../payment';
import { expireHold, finalizeCharge } from './bookings.service';

/**
 * Reconciliation sweep for redirect payments (Tap). Does two jobs.
 *
 * 1. SETTLE. The primary confirmation is the browser return redirect, backed up
 *    by the webhook. This is the third safety net: if a customer paid but never
 *    came back (tab closed, phone died) and no webhook is configured, their
 *    money is captured while the booking sits at 'pending_payment'. The sweep
 *    re-checks against Tap and settles from the authoritative status.
 *
 * 2. EXPIRE. A checkout that was simply abandoned never reaches a terminal
 *    status at all — Tap leaves it INITIATED indefinitely, so job 1 keeps
 *    reporting "still in flight" and never resolves it. Since the exclusion
 *    constraint counts every non-cancelled row, that booking holds its 2-hour
 *    window against real customers forever, at no cost to whoever opened it.
 *    Past HOLD_EXPIRY_MIN we release the window ourselves.
 *
 * Runs in-process (not a droplet cron) because this is where the Tap secret key
 * and finalizeCharge live — a cron would mean copying the secret onto the box.
 *
 * Idempotent and safe to run concurrently with the return/webhook paths and
 * with itself: both transitions are UPDATEs guarded on 'pending_payment', so a
 * payment that lands mid-sweep wins and the expiry no-ops.
 */

// Give a real payment time to complete before we consider a booking stuck.
const STALE_AFTER_MIN = 15;
// Past this, an unsettled hold is treated as abandoned and the window freed.
// Comfortably longer than a hosted-page session plus a KNET/3DS detour, so a
// customer who is still typing their PIN can never lose their table.
const HOLD_EXPIRY_MIN = 25;
const BATCH = 50;

export async function reconcilePendingPayments(): Promise<{
  checked: number;
  confirmed: number;
  cancelled: number;
  expired: number;
}> {
  // Only redirect gateways have charges to reconcile; mock is a no-op.
  if (paymentProvider.kind !== 'redirect' || !paymentProvider.retrieveCharge) {
    return { checked: 0, confirmed: 0, cancelled: 0, expired: 0 };
  }

  // No upper age bound: rows stranded before this sweep existed still hold their
  // windows, so the backlog has to drain too, not just new arrivals.
  const { rows } = await query<{ id: number; payment_ref: string | null; expirable: boolean }>(
    `SELECT id, payment_ref,
            created_at < now() - ($2 || ' minutes')::interval AS expirable
       FROM bookings
      WHERE status = 'pending_payment'
        AND created_at < now() - ($1 || ' minutes')::interval
      ORDER BY created_at
      LIMIT ${BATCH}`,
    [String(STALE_AFTER_MIN), String(HOLD_EXPIRY_MIN)],
  );

  let confirmed = 0;
  let cancelled = 0;
  let expired = 0;
  for (const row of rows) {
    try {
      // No charge id means checkout died before Tap was ever called (a crash
      // between reserving the window and opening the charge). Nothing to ask
      // Tap about — the window is simply held for a payment that cannot exist.
      if (!row.payment_ref?.startsWith('chg_')) {
        if (row.expirable && (await expireHold(row.id))) expired++;
        continue;
      }

      const { outcome } = await finalizeCharge(row.payment_ref);
      if (outcome === 'paid') confirmed++;
      else if (outcome === 'failed') cancelled++;
      // 'pending' = Tap has no terminal answer. Before HOLD_EXPIRY_MIN that's a
      // customer mid-payment; after it, an abandoned checkout squatting a table.
      else if (row.expirable && (await expireHold(row.id))) expired++;
    } catch (err) {
      console.error('[reconcile] finalize failed for booking', row.id, err);
    }
  }

  if (rows.length > 0) {
    console.log(
      `[reconcile] checked ${rows.length}, confirmed ${confirmed}, ` +
        `cancelled ${cancelled}, expired ${expired}`,
    );
  }
  return { checked: rows.length, confirmed, cancelled, expired };
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
