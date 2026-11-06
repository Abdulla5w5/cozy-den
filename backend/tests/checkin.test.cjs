// QR check-in passes (migration 050): the key is long, random and URL-safe,
// and the route only accepts keys of that shape.
const test = require('node:test');
const assert = require('node:assert');

const { newCheckinToken, CHECKIN_TOKEN_RE } = require('../dist/src/modules/checkin/checkin.service.js');

test('pass keys are 24 URL-safe characters, all different', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const t = newCheckinToken();
    assert.match(t, /^[A-Za-z0-9_-]{24}$/);
    assert.match(t, CHECKIN_TOKEN_RE);
    seen.add(t);
  }
  assert.strictEqual(seen.size, 2000);
});

test('the route refuses anything that is not a pass key', () => {
  for (const bad of ['', 'short', '../../etc/passwd', 'a'.repeat(41), "x'; DROP TABLE bookings;--"]) {
    assert.strictEqual(CHECKIN_TOKEN_RE.test(bad), false, bad);
  }
});

test('the service night runs to 03:00 Kuwait time', () => {
  const { currentServiceDate } = require('../dist/src/modules/checkin/checkin.service.js');
  const at = (s) => Date.parse(s);
  assert.strictEqual(currentServiceDate(at('2026-11-05T14:00:00+03:00')), '2026-11-05', 'opening');
  assert.strictEqual(currentServiceDate(at('2026-11-05T23:59:00+03:00')), '2026-11-05');
  assert.strictEqual(currentServiceDate(at('2026-11-06T01:30:00+03:00')), '2026-11-05', 'small hours');
  assert.strictEqual(currentServiceDate(at('2026-11-06T02:59:00+03:00')), '2026-11-05');
  assert.strictEqual(currentServiceDate(at('2026-11-06T03:00:00+03:00')), '2026-11-06', 'after closing');
});
