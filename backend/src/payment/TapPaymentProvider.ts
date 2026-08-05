import {
  ChargeStatus,
  PaymentProvider,
  RedirectCharge,
  RedirectChargeRequest,
} from './PaymentProvider';
import { TAP_CHARGE_EXPIRY_MINUTES } from './constants';

/**
 * Tap Payments (https://tap.company) — the Kuwait/GCC gateway.
 *
 * Redirect flow: create a charge, send the customer to `transaction.url` to pay
 * (KNET, card, Apple Pay…), and confirm the result by RE-FETCHING the charge by
 * id. We never trust a redirect query param or a webhook body on its own — the
 * authoritative status always comes from GET /charges/{id} with the secret key.
 * That also means we don't depend on Tap's webhook hash format, which drifts.
 *
 * Docs: https://developers.tap.company/reference/create-a-charge
 */

interface TapCharge {
  id: string;
  amount?: number;
  currency?: string;
  status: string; // INITIATED | IN_PROGRESS | CAPTURED | AUTHORIZED | DECLINED | CANCELLED | FAILED | ...
  transaction?: { url?: string };
  reference?: { payment?: string; order?: string };
  response?: { code?: string; message?: string };
  metadata?: Record<string, string>;
}

// This integration creates Charges, not Authorizations. Tap documents CAPTURED
// as the successful terminal Charge state; AUTHORIZED belongs to its separate
// authorize/capture flow and must not confirm a booking here.
const PAID = new Set(['CAPTURED']);
// Terminal failures — the window should be freed.
const FAILED = new Set([
  'ABANDONED',
  'DECLINED',
  'CANCELLED',
  'FAILED',
  'RESTRICTED',
  'EXPIRED',
  'VOID',
  'TIMEDOUT',
  'UNKNOWN',
]);

export class TapPaymentProvider implements PaymentProvider {
  readonly name = 'tap';
  readonly kind = 'redirect' as const;

  constructor(
    private readonly secretKey: string,
    private readonly apiBase = 'https://api.tap.company/v2',
  ) {
    if (!secretKey) throw new Error('TapPaymentProvider requires TAP_SECRET_KEY');
  }

  // Direct charge is not supported by a redirect gateway.
  async charge(): Promise<never> {
    throw new Error('Tap is a redirect gateway — use createCharge()/retrieveCharge().');
  }

  private async call(path: string, init?: RequestInit): Promise<TapCharge> {
    const res = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      // Never leak the key; surface Tap's own error message if present.
      const msg =
        (body as { errors?: { description?: string }[] }).errors?.[0]?.description ??
        `Tap API ${res.status}`;
      throw new Error(`Tap request failed: ${msg}`);
    }
    return body as TapCharge;
  }

  async createCharge(req: RedirectChargeRequest): Promise<RedirectCharge> {
    // KWD is a 3-decimal currency; amountCents are hundredths, so /100 → major
    // units with up to 3 dp (KD 5.00 stored as 500 → 5.000). toFixed(3) keeps
    // Tap happy and avoids float drift.
    const amount = Number((req.amountCents / 100).toFixed(3));
    const [first, ...restName] = req.customer.name.trim().split(/\s+/);
    const expiryMinutes = req.expiryMinutes ?? TAP_CHARGE_EXPIRY_MINUTES;
    if (expiryMinutes < 5 || expiryMinutes > 60) {
      throw new Error('Tap charge expiry must be between 5 and 60 minutes.');
    }

    const charge = await this.call('/charges', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        currency: req.currency,
        threeDSecure: true,
        save_card: false,
        description: req.description,
        metadata: req.metadata ?? {},
        receipt: { email: false, sms: false },
        customer: {
          first_name: first || 'Guest',
          last_name: restName.join(' ') || undefined,
          email: req.customer.email,
        },
        // src_all presents every method enabled on the account (KNET, cards,
        // Apple Pay, Benefit…) on Tap's hosted page.
        source: { id: 'src_all' },
        transaction: { expiry: { period: expiryMinutes, type: 'MINUTE' } },
        post: { url: req.webhookUrl },
        redirect: { url: req.redirectUrl },
      }),
    });

    if (!charge.transaction?.url) {
      throw new Error('Tap did not return a transaction URL to redirect to.');
    }
    return {
      chargeId: charge.id,
      transactionUrl: charge.transaction.url,
      status: charge.status,
    };
  }

  async retrieveCharge(chargeId: string): Promise<ChargeStatus> {
    const charge = await this.call(`/charges/${encodeURIComponent(chargeId)}`);
    const status = (charge.status || '').toUpperCase();
    return {
      paid: PAID.has(status),
      failed: FAILED.has(status),
      status,
      reference: charge.id,
      metadata: charge.metadata,
      // Surfaced so the caller can assert we were paid what we asked for
      // rather than trusting the status word alone.
      amountMillis: typeof charge.amount === 'number' ? Math.round(charge.amount * 1000) : undefined,
      currency: charge.currency,
      responseCode: charge.response?.code,
      responseMessage: charge.response?.message,
    };
  }
}
