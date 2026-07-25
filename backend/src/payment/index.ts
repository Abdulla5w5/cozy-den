import { env } from '../config/env';
import { MockPaymentProvider } from './MockPaymentProvider';
import { TapPaymentProvider } from './TapPaymentProvider';
import { PaymentProvider } from './PaymentProvider';

/**
 * Factory that returns the configured provider, chosen by PAYMENT_PROVIDER:
 *   - 'mock' (default) — approves everything; local dev and tests.
 *   - 'tap'            — real Tap gateway; needs TAP_SECRET_KEY (and PUBLIC_URL
 *                        so the redirect/webhook URLs are absolute).
 */
function build(): PaymentProvider {
  switch (env.paymentProvider) {
    case 'mock':
      return new MockPaymentProvider();
    case 'tap':
      if (!env.tapSecretKey) {
        throw new Error('PAYMENT_PROVIDER=tap requires TAP_SECRET_KEY');
      }
      return new TapPaymentProvider(env.tapSecretKey, env.tapApiBase);
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${env.paymentProvider}`);
  }
}

export const paymentProvider: PaymentProvider = build();
export * from './PaymentProvider';
