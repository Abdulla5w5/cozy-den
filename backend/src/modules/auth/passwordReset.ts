import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { query } from '../../db/pool';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';
import { mailer } from '../../notifications/mailer';

/**
 * Forgot / reset password.
 *
 * Four properties carry the security of this flow:
 *
 *  1. NO ENUMERATION. Requesting a reset answers identically whether or not the
 *     address has an account. Otherwise the endpoint becomes a free tool for
 *     discovering which of your customers' emails are registered.
 *
 *  2. ONLY THE HASH IS STORED. As with email verification, the database holds
 *     sha256(token); the raw token exists only in the emailed link. A dump of
 *     the table cannot be turned into account access.
 *
 *  3. SINGLE USE, SHORT LIFE. One hour, and consumed by the DELETE ... RETURNING
 *     that redeems it, so a link forwarded or left in an inbox cannot be
 *     replayed. A reset link is far more dangerous than a verification link,
 *     which is why this is one hour rather than 48.
 *
 *  4. LIVE SESSIONS DIE. Resetting stamps password_changed_at, and the auth
 *     middleware refuses any JWT issued before it. Someone who resets because
 *     an attacker had their session actually evicts that attacker, instead of
 *     leaving them signed in for the rest of the 8-hour token life.
 */

const TTL_MINUTES = 60;

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a reset link if the address has an account. Returns nothing either way
 * — the caller must not vary its response on the outcome (property 1).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { rows } = await query<{ id: number; name: string; email: string }>(
    'SELECT id, name, email FROM users WHERE lower(email) = lower($1)',
    [email.trim()],
  );
  const user = rows[0];
  if (!user) return;

  const token = randomBytes(32).toString('hex');
  // One live link per account, so requesting again invalidates the previous
  // email rather than leaving several usable links in an inbox.
  await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
  await query(
    `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [hash(token), user.id, String(TTL_MINUTES)],
  );

  const link = `${env.publicUrl}/reset-password?token=${token}`;
  const text = [
    `Hi ${user.name},`,
    ``,
    `Someone asked to reset the password for your Cozy Den account.`,
    `If that was you, open this link to choose a new one:`,
    ``,
    link,
    ``,
    `The link works once and expires in ${TTL_MINUTES} minutes.`,
    ``,
    `If it wasn't you, you can ignore this email — your password has not`,
    `changed, and nobody can use this link without access to your inbox.`,
  ].join('\n');

  // Fire-and-forget, matching the rest of the app: a mail failure must not turn
  // into a different HTTP response, or it would leak that the account exists.
  mailer
    .send({ to: user.email, subject: 'Reset your Cozy Den password', text })
    .catch((e) => console.error('[reset] failed to send reset email', e));
}

/**
 * Redeem a token and set the new password. The DELETE ... RETURNING both checks
 * and consumes the token in one statement, so two racing requests cannot both
 * succeed with the same link.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (!token) throw new ApiError(400, 'This reset link is invalid or has expired.');

  const { rows } = await query<{ user_id: number }>(
    `DELETE FROM password_reset_tokens
      WHERE token_hash = $1 AND expires_at > now()
      RETURNING user_id`,
    [hash(token)],
  );
  const row = rows[0];
  // Deliberately the same message for wrong, expired and already-used, so the
  // response says nothing about which tokens ever existed.
  if (!row) throw new ApiError(400, 'This reset link is invalid or has expired.');

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await query(
    `UPDATE users
        SET password_hash = $1,
            password_changed_at = now(),
            -- Reaching the inbox proves the address, so a reset also confirms
            -- an unverified account rather than stranding them.
            email_verified = TRUE,
            email_verified_at = COALESCE(email_verified_at, now())
      WHERE id = $2`,
    [passwordHash, row.user_id],
  );

  // Any other outstanding link for this account is now void.
  await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [row.user_id]);
}

/**
 * True when a session predates the account's last password change, i.e. it
 * belongs to whoever held the account before the reset. `iat` is in seconds.
 */
export function sessionPredatesReset(issuedAtSeconds: number, changedAt: Date | null): boolean {
  if (!changedAt) return false;
  return issuedAtSeconds * 1000 < changedAt.getTime();
}
