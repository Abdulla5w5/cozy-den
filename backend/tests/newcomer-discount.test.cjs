// Newcomer code (the café's list, item 31): 10% off a member's first booking,
// per seat to the nearest 1/100 KD. Not on the flat six-hour price — that is
// checked in quoteBooking, which needs the database.
const test = require('node:test');
const assert = require('node:assert');

const { discounted } = require('../dist/src/utils/pricing.js');

test('10% off normal prices', () => {
  assert.strictEqual(discounted(275, 10), 248, '2.75 -> 2.48 (2.475 rounds up)');
  assert.strictEqual(discounted(410, 10), 369);
  assert.strictEqual(discounted(350, 10), 315);
  assert.strictEqual(discounted(875, 10), 788);
});

test('no code, no change', () => {
  assert.strictEqual(discounted(275, 0), 275);
});
