const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeKuwaitiPhone } = require('../dist/src/utils/phone.js');

test('normalizes common Kuwait phone formats to E.164', () => {
  assert.equal(normalizeKuwaitiPhone('5000 0000'), '+96550000000');
  assert.equal(normalizeKuwaitiPhone('+965 6000-0000'), '+96560000000');
  assert.equal(normalizeKuwaitiPhone('00965 90000000'), '+96590000000');
  assert.equal(normalizeKuwaitiPhone('4112 3456'), '+96541123456');
  assert.equal(normalizeKuwaitiPhone('2244 5566'), '+96522445566');
  assert.equal(normalizeKuwaitiPhone('٥٠٠٠٠٠٠٠'), '+96550000000');
});

test('rejects unassigned prefixes and malformed Kuwait numbers', () => {
  assert.equal(normalizeKuwaitiPhone('40000000'), null);
  assert.equal(normalizeKuwaitiPhone('5000000'), null);
  assert.equal(normalizeKuwaitiPhone('+96650000000'), null);
  assert.equal(normalizeKuwaitiPhone('not a phone'), null);
});
