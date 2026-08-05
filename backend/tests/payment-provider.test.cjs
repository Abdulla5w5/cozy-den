const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const { TapPaymentProvider } = require('../dist/src/payment/TapPaymentProvider.js');
const {
  PAYMENT_HOLD_EXPIRY_MINUTES,
  TAP_CHARGE_EXPIRY_MINUTES,
} = require('../dist/src/payment/constants.js');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function tapResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

test('Tap charge expires before the local booking hold', async () => {
  assert.ok(PAYMENT_HOLD_EXPIRY_MINUTES > TAP_CHARGE_EXPIRY_MINUTES);

  let requestBody;
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return tapResponse({
      id: 'chg_test',
      status: 'INITIATED',
      transaction: { url: 'https://payments.example/checkout' },
    });
  };

  const provider = new TapPaymentProvider('secret', 'https://tap.example/v2');
  await provider.createCharge({
    amountCents: 275,
    currency: 'KWD',
    description: 'booking',
    redirectUrl: 'https://cozyden.test/return',
    webhookUrl: 'https://cozyden.test/webhook',
    customer: { name: 'Guest', email: 'guest@example.com' },
  });

  assert.equal(requestBody.transaction.expiry.period, TAP_CHARGE_EXPIRY_MINUTES);
  assert.equal(requestBody.transaction.expiry.type, 'MINUTE');
});

test('only CAPTURED confirms a Tap Charge and preserves KWD millis', async () => {
  global.fetch = async () =>
    tapResponse({
      id: 'chg_captured',
      status: 'CAPTURED',
      amount: 2.751,
      currency: 'KWD',
      response: { code: '000', message: 'Captured' },
    });

  const provider = new TapPaymentProvider('secret', 'https://tap.example/v2');
  const result = await provider.retrieveCharge('chg_captured');

  assert.equal(result.paid, true);
  assert.equal(result.failed, false);
  assert.equal(result.amountMillis, 2751);
  assert.equal(result.responseCode, '000');
});

test('AUTHORIZED does not confirm the separate Tap Charges flow', async () => {
  global.fetch = async () =>
    tapResponse({ id: 'chg_authorized', status: 'AUTHORIZED', amount: 2.75, currency: 'KWD' });

  const provider = new TapPaymentProvider('secret', 'https://tap.example/v2');
  const result = await provider.retrieveCharge('chg_authorized');

  assert.equal(result.paid, false);
  assert.equal(result.failed, false);
});

test('ABANDONED is a terminal failed Tap Charge', async () => {
  global.fetch = async () =>
    tapResponse({ id: 'chg_abandoned', status: 'ABANDONED', amount: 2.75, currency: 'KWD' });

  const provider = new TapPaymentProvider('secret', 'https://tap.example/v2');
  const result = await provider.retrieveCharge('chg_abandoned');

  assert.equal(result.paid, false);
  assert.equal(result.failed, true);
});

