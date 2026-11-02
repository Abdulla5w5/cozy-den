// Prices stay as production — 2-hour blocks — except: the odd hour of a 3- or
// 5-hour booking costs the extra-hour price (1.350 KD Sunday-Wednesday, 1.750
// KD Thursday-Saturday, Nov 2026), and six hours Sunday to Wednesday is a flat
// 5.900 KD a seat for any size of group with no promo code (the café's list,
// item 29). Live block rates (Nov 2026): 2.750 KD Sunday-Wednesday, 3.500 KD
// Thursday-Saturday. Money is in 1/100 KD.
const test = require('node:test');
const assert = require('node:assert');

const { perSeatForLength, listingPerSeat } = require('../dist/src/utils/pricing.js');

const SUN_WED = 275;
const THU_SAT = 350;
const SIX_HOUR = 590;
const EXTRA_SUN_WED = 135;
const EXTRA_THU_SAT = 175;

test('Sunday to Wednesday: blocks, 1.350 for the odd hour, six hours at 5.900', () => {
  assert.strictEqual(perSeatForLength(SUN_WED, SIX_HOUR, EXTRA_SUN_WED, 120), 275);
  assert.strictEqual(perSeatForLength(SUN_WED, SIX_HOUR, EXTRA_SUN_WED, 180), 410);
  assert.strictEqual(perSeatForLength(SUN_WED, SIX_HOUR, EXTRA_SUN_WED, 240), 550);
  assert.strictEqual(perSeatForLength(SUN_WED, SIX_HOUR, EXTRA_SUN_WED, 300), 685);
  assert.strictEqual(perSeatForLength(SUN_WED, SIX_HOUR, EXTRA_SUN_WED, 360), 590);
});

test('Thursday to Saturday: 1.750 for the odd hour, six hours is three blocks', () => {
  assert.strictEqual(perSeatForLength(THU_SAT, null, EXTRA_THU_SAT, 120), 350);
  assert.strictEqual(perSeatForLength(THU_SAT, null, EXTRA_THU_SAT, 180), 525);
  assert.strictEqual(perSeatForLength(THU_SAT, null, EXTRA_THU_SAT, 300), 875);
  assert.strictEqual(perSeatForLength(THU_SAT, null, EXTRA_THU_SAT, 360), 1050);
});

test('switched off: six hours is three blocks, the odd hour half a block', () => {
  assert.strictEqual(perSeatForLength(SUN_WED, null, null, 360), 825);
  assert.strictEqual(perSeatForLength(SUN_WED, null, null, 180), 413);
  assert.strictEqual(perSeatForLength(SUN_WED, null, null, 300), 688);
});

test('Wanted Board: listings take the same day prices', () => {
  const rates = {
    peakCents: THU_SAT,
    offPeakCents: SUN_WED,
    latePeakCents: 250,
    lateOffPeakCents: 200,
    sixHourOffPeakCents: SIX_HOUR,
    extraHourPeakCents: EXTRA_THU_SAT,
    extraHourOffPeakCents: EXTRA_SUN_WED,
  };
  assert.strictEqual(listingPerSeat([1, 2], rates, 360), 590);
  assert.strictEqual(listingPerSeat([5, 6], rates, 360), 1050);
  assert.strictEqual(listingPerSeat([2, 6], rates, 240), 550);
  assert.strictEqual(listingPerSeat([1, 2], rates, 180), 410);
  assert.strictEqual(listingPerSeat([5, 6], rates, 300), 875);
});
