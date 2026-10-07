// A slot that has already started must not be bookable.
//
// The bug this pins: booking creation compared only the DATE against today, so
// on October 7 at 16:00 the 14:00 slot was still on offer and still accepted.
// The tricky part is the café's day running past midnight — a 01:00 slot on
// "October 7" actually happens in the small hours of October 8.
const test = require('node:test');
const assert = require('node:assert');
const { slotStartsAt, slotHasStarted } = require('../dist/src/utils/slots.js');

// Kuwait wall-clock time → epoch ms, independent of the machine's own zone.
const kw = (iso) => Date.parse(`${iso}+03:00`);

test('an evening slot starts on its own date, in Kuwait time', () => {
  assert.equal(slotStartsAt('2026-10-07', '14:00'), kw('2026-10-07T14:00:00'));
  assert.equal(slotStartsAt('2026-10-07', '23:30'), kw('2026-10-07T23:30:00'));
});

test('an after-midnight slot belongs to the next calendar day', () => {
  assert.equal(slotStartsAt('2026-10-07', '01:00'), kw('2026-10-08T01:00:00'));
  assert.equal(slotStartsAt('2026-10-07', '02:00'), kw('2026-10-08T02:00:00'));
});

test('the reported case: 14:00 on Oct 7 is over by 16:00', () => {
  const now = kw('2026-10-07T16:00:00');
  assert.equal(slotHasStarted('2026-10-07', '14:00', now), true);
  assert.equal(slotHasStarted('2026-10-07', '15:30', now), true);
  assert.equal(slotHasStarted('2026-10-07', '16:30', now), false);
});

test('a slot is over at the instant it starts, not a minute later', () => {
  assert.equal(slotHasStarted('2026-10-07', '18:00', kw('2026-10-07T18:00:00')), true);
  assert.equal(slotHasStarted('2026-10-07', '18:00', kw('2026-10-07T17:59:59')), false);
});

test('late on Oct 7 the after-midnight slots are still ahead', () => {
  const now = kw('2026-10-07T23:00:00');
  assert.equal(slotHasStarted('2026-10-07', '01:00', now), false);
  assert.equal(slotHasStarted('2026-10-07', '22:00', now), true);
});

test('at 01:30 the night of Oct 7 is mostly over, and Oct 8 has not begun', () => {
  const now = kw('2026-10-08T01:30:00');
  assert.equal(slotHasStarted('2026-10-07', '01:00', now), true);
  assert.equal(slotHasStarted('2026-10-07', '02:00', now), false);
  assert.equal(slotHasStarted('2026-10-08', '14:00', now), false);
});

test('a future date is entirely open', () => {
  const now = kw('2026-10-07T16:00:00');
  assert.equal(slotHasStarted('2026-10-09', '14:00', now), false);
});
