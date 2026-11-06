// Private game hosts (migration 049): priced per hour for the whole group,
// bookable only 24 hours ahead and never on a late seating.
const test = require('node:test');
const assert = require('node:assert');

const { hostFeeCents, hostTimingRefusal } = require('../dist/src/modules/hosts/hosts.service.js');

test('a host costs their hourly price times the hours, for the whole group', () => {
  assert.strictEqual(hostFeeCents(500, 120), 1000, '5 KD x 2 hours');
  assert.strictEqual(hostFeeCents(500, 180), 1500);
  assert.strictEqual(hostFeeCents(600, 360), 3600, 'own price: 6 KD x 6 hours');
  assert.strictEqual(hostFeeCents(450, 90), 675);
});

test('needs 24 hours notice', () => {
  // A fixed "now": 2026-11-10 12:00 in Kuwait.
  const now = Date.parse('2026-11-10T12:00:00+03:00');
  assert.ok(hostTimingRefusal('2026-11-10', '20:00', now), 'same evening is too soon');
  assert.ok(hostTimingRefusal('2026-11-10', '01:00', now), 'the night of the 10th: 13 hours away');
  assert.strictEqual(hostTimingRefusal('2026-11-11', '14:00', now), null, '26 hours ahead is fine');
  assert.strictEqual(
    hostTimingRefusal('2026-11-11', '01:00', Date.parse('2026-11-10T20:00:00+03:00')),
    null,
    '01:00 on the night of the 11th is the 12th — 29 hours ahead',
  );
});

test('not on a late seating', () => {
  const now = Date.parse('2026-11-01T12:00:00+03:00');
  assert.match(hostTimingRefusal('2026-11-20', '02:00', now), /late seating/);
});
