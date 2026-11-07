// Staff may enter a walk-in at the half hour running now, and at no other
// passed time. The tricky part is again the night running past midnight.
const test = require('node:test');
const assert = require('node:assert');
const { currentSlot } = require('../dist/src/utils/slots.js');

const kw = (iso) => Date.parse(`${iso}+03:00`);

test('a time part-way through a half hour gives that half hour, never the minute', () => {
  assert.equal(currentSlot('2026-11-06', kw('2026-11-06T21:02:00')), '21:00');
  assert.equal(currentSlot('2026-11-06', kw('2026-11-06T21:29:59')), '21:00');
  assert.equal(currentSlot('2026-11-06', kw('2026-11-06T21:30:00')), '21:30');
});

test('after midnight belongs to the night that started on the date', () => {
  assert.equal(currentSlot('2026-11-06', kw('2026-11-07T00:10:00')), '00:00');
  assert.equal(currentSlot('2026-11-06', kw('2026-11-07T01:45:00')), '01:30');
  assert.equal(currentSlot('2026-11-07', kw('2026-11-07T01:45:00')), null);
});

test('none outside intake hours or on another date', () => {
  assert.equal(currentSlot('2026-11-06', kw('2026-11-06T13:59:00')), null);
  assert.equal(currentSlot('2026-11-06', kw('2026-11-07T02:30:00')), null);
  assert.equal(currentSlot('2026-11-06', kw('2026-11-05T21:00:00')), null);
  assert.equal(currentSlot('2026-11-06', kw('2026-11-07T21:00:00')), null);
});
