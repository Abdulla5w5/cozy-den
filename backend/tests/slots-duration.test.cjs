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

test('normal seatings default to two hours and extend to closing', () => {
  assert.strictEqual(minDurationFor('14:00'), 120);
  assert.strictEqual(maxDurationFor('14:00'), 13 * 60, '14:00 to 03:00');
  assert.strictEqual(maxDurationFor('01:00'), 120);
});

test('durations must be whole 30-minute steps within the sitting', () => {
  assert.ok(isValidDuration('14:00', 120));
  assert.ok(isValidDuration('14:00', 240));
  assert.ok(!isValidDuration('14:00', 90), 'below the 2-hour minimum');
  assert.ok(!isValidDuration('14:00', 150 + 1), 'not a 30-minute step');
  assert.ok(!isValidDuration('01:00', 150), 'would run past closing');
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
  assert.ok(overlaps('14:00', 150, '16:00', 120), 'a 2.5h booking eats into 16:00');
});
