// Group promo code prices (the café's list, item 30): parties of six or more
// with a code pay a base price for the first two hours and a price per extra
// hour. Sunday-Wednesday 2.250 + 1.000/hour (six hours flat 5.900); Saturday
// 2.850 + 1.400/hour; Thursday/Friday the normal 3.500 + 1.750/hour.
const test = require('node:test');
const assert = require('node:assert');

const { codePerSeat } = require('../dist/src/utils/pricing.js');

const SUN_WED = { cents: 225, extraHourCents: 100, sixHourCents: 590 };
const SATURDAY = { cents: 285, extraHourCents: 140, sixHourCents: null };
const THU_FRI = { cents: 350, extraHourCents: 175, sixHourCents: null };

test('Sunday to Wednesday with a code', () => {
  assert.deepStrictEqual(
    [120, 180, 240, 300, 360].map((d) => codePerSeat(SUN_WED, d)),
    [225, 325, 425, 525, 590],
  );
});

test('Saturday with a code', () => {
  assert.deepStrictEqual(
    [120, 180, 240, 300, 360].map((d) => codePerSeat(SATURDAY, d)),
    [285, 425, 565, 705, 845],
  );
});

test('Thursday and Friday: the code changes nothing', () => {
  assert.deepStrictEqual(
    [120, 180, 240, 300, 360].map((d) => codePerSeat(THU_FRI, d)),
    [350, 525, 700, 875, 1050],
  );
});
