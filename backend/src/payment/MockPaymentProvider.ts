import { randomUUID } from 'crypto';
import { ChargeRequest, ChargeResult, PaymentProvider } from './PaymentProvider';

/**
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  PLACEHOLDER — NOT A REAL PAYMENT GATEWAY.                         │
 * │  Approves every charge and returns a fake reference. Swap this    │
 * │  for a real PaymentProvider (Stripe/Square/etc.) in phase 2.      │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Test hook: a paymentToken of 'tok_decline' simulates a declined card so the
 * failure path can be exercised end-to-end without a real gateway.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    // Simulate a little network latency.
    await new Promise((r) => setTimeout(r, 150));

    if (req.paymentToken === 'tok_decline') {
      return {
        success: false,
        reference: `mock_${randomUUID()}`,
        declineReason: 'Card declined (simulated).',
      };
    }

    return {
      success: true,
      reference: `mock_${randomUUID()}`,
    };
  }
}
