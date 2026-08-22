// Tap's hosted charge is explicitly shorter than our local hold, so a charge
// stops being payable before the window it is holding is released. That buffer
// is what stops a customer paying for a table somebody else has just taken.
export const TAP_CHARGE_EXPIRY_MINUTES = 20;
// Re-check as soon as the gateway's own charge can no longer be paid, and
// release a minute later. The old 22/30 pair sat on a window for ten minutes
// after it had become unpayable, which is ten minutes of a table nobody could
// book and nobody could pay for. The buffer that matters is the one BEFORE
// TAP_CHARGE_EXPIRY_MINUTES, and that is still intact.
export const PAYMENT_RECONCILE_AFTER_MINUTES = 21;
export const PAYMENT_HOLD_EXPIRY_MINUTES = 23;

