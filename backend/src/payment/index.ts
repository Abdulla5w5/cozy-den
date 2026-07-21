import { env } from '../config/env';
import { MockPaymentProvider } from './MockPaymentProvider';
import { PaymentProvider } from './PaymentProvider';

/**
 * Factory that returns the configured provider. To add the real gateway later:
 *   1. Create e.g. StripePaymentProvider implements PaymentProvider.
 *   2. Add a case below.
 *   3. Set PAYMENT_PROVIDER=stripe (+ PAYMENT_API_KEY) in the environment.
 */
function build(): PaymentProvider {
  switch (env.paymentProvider) {
    case 'mock':
      return new MockPaymentProvider();
    // case 'stripe':
    //   return new StripePaymentProvider(env.paymentApiKey!);
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${env.paymentProvider}`);
  }
}

export const paymentProvider: PaymentProvider = build();
export * from './PaymentProvider';
