// Tap's normal hosted charge is explicitly shorter than our local table hold.
// The ten-minute buffer lets Tap finish KNET/3DS and deliver a callback before
// the table is released locally.
export const TAP_CHARGE_EXPIRY_MINUTES = 20;
export const PAYMENT_RECONCILE_AFTER_MINUTES = 22;
export const PAYMENT_HOLD_EXPIRY_MINUTES = 30;

