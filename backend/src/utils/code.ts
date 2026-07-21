import { randomInt } from 'crypto';

// Crockford-style base32 without ambiguous chars (no I, L, O, U, 0, 1).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a cryptographically random, unguessable verification code.
 * Uses crypto.randomInt (CSPRNG) — never a sequential/incremental id.
 * Default length 8 => 30^8 ≈ 6.5e11 possibilities.
 */
export function generateVerificationCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}
