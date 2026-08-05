/**
 * Payment provider contract.
 *
 * Everything in the app depends on THIS interface, never on a concrete gateway.
 * Adding a real provider later = implement this interface + flip the
 * PAYMENT_PROVIDER env var. No booking/business code changes.
 *
 * Two shapes of gateway:
 *  - 'direct'   — charges synchronously and returns success/decline in one call
 *                 (the mock provider; also how a raw card-token gateway works).
 *  - 'redirect' — the customer is sent to the gateway's hosted page (required
 *                 for KNET and 3-D Secure), pays there, and is redirected back;
 *                 the real result is confirmed by retrieving the charge
 *                 afterwards. This is how Tap works.
 */
export interface ChargeRequest {
  amountCents: number;
  currency: string; // ISO 4217, e.g. 'KWD'
  /** Opaque token/handle the frontend collected from the gateway's UI. */
  paymentToken: string;
  description: string;
  metadata?: Record<string, string>;
}

export interface ChargeResult {
  success: boolean;
  /** Provider-side transaction id, stored on the booking as payment_ref. */
  reference: string;
  /** Present when success === false. */
  declineReason?: string;
}

/** A charge started against a redirect gateway (Tap). */
export interface RedirectChargeRequest {
  amountCents: number;
  currency: string;
  description: string;
  /** Where the gateway sends the customer's browser after paying. */
  redirectUrl: string;
  /** Server-to-server notification URL (the reliable confirmation path). */
  webhookUrl: string;
  customer: { name: string; email: string };
  metadata?: Record<string, string>;
  /** Hosted-payment lifetime. Kept shorter than the local table hold. */
  expiryMinutes?: number;
}

export interface RedirectCharge {
  /** Gateway charge id (e.g. Tap 'chg_...'). Stored as payment_ref. */
  chargeId: string;
  /** Send the customer's browser here to pay. */
  transactionUrl: string;
  status: string;
}

/** Authoritative status of a charge, fetched from the gateway by id. */
export interface ChargeStatus {
  /** true once the money is actually captured. */
  paid: boolean;
  /** Terminal failure (declined / cancelled / expired) vs still in flight. */
  failed: boolean;
  status: string;
  reference: string;
  metadata?: Record<string, string>;
  /** Amount returned by the gateway in thousandths of the major unit. */
  amountMillis?: number;
  currency?: string;
  responseCode?: string;
  responseMessage?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly kind: 'direct' | 'redirect';

  /** Direct gateways only (mock). Redirect gateways throw. */
  charge(req: ChargeRequest): Promise<ChargeResult>;

  /** Redirect gateways only (Tap). Direct gateways leave these undefined. */
  createCharge?(req: RedirectChargeRequest): Promise<RedirectCharge>;
  retrieveCharge?(chargeId: string): Promise<ChargeStatus>;
}
