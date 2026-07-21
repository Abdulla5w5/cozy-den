/**
 * Payment provider contract.
 *
 * Everything in the app depends on THIS interface, never on a concrete gateway.
 * Adding the real provider later = implement this interface + flip the
 * PAYMENT_PROVIDER env var. No booking/business code changes.
 */
export interface ChargeRequest {
  amountCents: number;
  currency: string; // ISO 4217, e.g. 'GBP'
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

export interface PaymentProvider {
  readonly name: string;
  charge(req: ChargeRequest): Promise<ChargeResult>;
}
