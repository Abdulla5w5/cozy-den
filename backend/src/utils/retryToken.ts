import { createHash } from 'crypto';
import { z } from 'zod';

/**
 * The browser's checkout token (see migration 048): a random value the
 * browser keeps and sends with each checkout, so a retry can prove it is the
 * same customer and release their abandoned hold at once. Only its hash is
 * stored or compared.
 */
export const retryTokenSchema = z
  .string()
  .regex(/^[a-f0-9]{32,64}$/, 'invalid retry token')
  .optional();

export function hashRetryToken(token: string | undefined): string | null {
  return token ? createHash('sha256').update(token).digest('hex') : null;
}
