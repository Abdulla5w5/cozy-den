// The browser's checkout token (migration 048): only hex tokens of a sane
// length are accepted, and only their hash is ever stored or compared.
const test = require('node:test');
const assert = require('node:assert');

const { hashRetryToken, retryTokenSchema } = require('../dist/src/utils/retryToken.js');

test('accepts a browser token and leaves it optional', () => {
  assert.ok(retryTokenSchema.safeParse('a'.repeat(48)).success);
  assert.ok(retryTokenSchema.safeParse(undefined).success);
});

test('rejects anything that is not a plain hex token', () => {
  for (const bad of ['short', 'Z'.repeat(48), 'a'.repeat(65), "'; DROP TABLE bookings;--"]) {
    assert.strictEqual(retryTokenSchema.safeParse(bad).success, false, bad);
  }
});

test('stores a hash, never the token itself', () => {
  const token = 'ab'.repeat(24);
  const hash = hashRetryToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notStrictEqual(hash, token);
  assert.strictEqual(hashRetryToken(token), hash, 'same token, same hash');
  assert.strictEqual(hashRetryToken(undefined), null);
});
