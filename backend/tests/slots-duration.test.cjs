// Start times, session lengths and the late-seating boundary.
//
// These decide what a customer may book and — via quoteBooking — what they are
// charged, so the boundary cases are worth pinning down: intake now runs an
// hour past the last full session, and the two are easy to conflate.
const test = require('node:test');
const assert = require('node:assert');

const {
  START_TIMES,
  isValidStart,
  isLateStart,
  maxDurationFor,
  minDurationFor,
  isValidDuration,
  allowedDurations,
  overlaps,
  toMinutes,
} = require('../dist/src/utils/slots.js');

test('intake runs to 02:00, an hour past the last full session', () => {
  assert.strictEqual(START_TIMES[0], '14:00');
  assert.strictEqual(START_TIMES[START_TIMES.length - 1], '02:00');
  assert.ok(isValidStart('01:30'));
  assert.ok(isValidStart('02:00'));
  assert.ok(!isValidStart('02:30'), 'past intake');
  assert.ok(!isValidStart('13:30'), 'before opening');
});

test('a late start is one that cannot fit a full 2-hour session', () => {
  assert.ok(!isLateStart('01:00'), '01:00 still fits exactly two hours');
  assert.ok(isLateStart('01:30'));
  assert.ok(isLateStart('02:00'));
  assert.ok(!isLateStart('20:00'));
});

test('late seatings run to closing and have no other length', () => {
  assert.strictEqual(maxDurationFor('01:30'), 90);
  assert.strictEqual(minDurationFor('01:30'), 90);
  assert.strictEqual(maxDurationFor('02:00'), 60);
  assert.strictEqual(minDurationFor('02:00'), 60);
});

test('normal seatings default to two hours and cap at six', () => {
  assert.strictEqual(minDurationFor('14:00'), 120);
  assert.strictEqual(maxDurationFor('14:00'), 360, 'six hours, not all the way to close');
  assert.strictEqual(maxDurationFor('01:00'), 120, 'closing bites before the ceiling');
});

test('only whole 2/4/6-hour blocks are offered', () => {
  assert.deepStrictEqual(allowedDurations('14:00'), [120, 240, 360]);
  assert.deepStrictEqual(allowedDurations('23:00'), [120, 240], 'closing trims the six');
  assert.deepStrictEqual(allowedDurations('01:00'), [120], 'only one block fits');
  assert.deepStrictEqual(allowedDurations('01:30'), [90], 'late seating: to closing');
  assert.deepStrictEqual(allowedDurations('02:00'), [60]);
});

test('part-hours and over-long sittings are rejected', () => {
  assert.ok(isValidDuration('14:00', 120));
  assert.ok(isValidDuration('14:00', 240));
  assert.ok(isValidDuration('14:00', 360));
  assert.ok(!isValidDuration('14:00', 180), 'three hours is not a whole block');
  assert.ok(!isValidDuration('14:00', 150), 'no part-hours');
  assert.ok(!isValidDuration('14:00', 420), 'past the six-hour ceiling');
  assert.ok(!isValidDuration('14:00', 90), 'below the 2-hour minimum');
  assert.ok(!isValidDuration('01:00', 240), 'would run past closing');
  assert.ok(isValidDuration('01:30', 90), 'the only late length');
  assert.ok(!isValidDuration('01:30', 120), 'past closing');
});

test('after-midnight starts sort after the evening, not 13 hours before it', () => {
  assert.ok(toMinutes('01:00') > toMinutes('22:00'));
});

test('a long evening booking collides with a late one', () => {
  // 22:00 running four hours ends at 02:00 and must block a 01:00 start. This
  // is the case the old same-day window arithmetic got wrong.
  assert.ok(overlaps('22:00', 240, '01:00', 120));
  // Back-to-back is still fine.
  assert.ok(!overlaps('14:00', 120, '16:00', 120));
  assert.ok(overlaps('14:00', 240, '16:00', 120), 'a 4h booking eats into 16:00');
});
