import { createHash, randomBytes } from 'crypto';
import { query } from '../../db/pool';
import { env } from '../../config/env';
import { mailer } from '../../notifications/mailer';

/**
 * Email verification for self-registered accounts. Non-blocking: the account
 * works either way; this just lets a customer confirm they own the address.
 *
 * We store only sha256(token); the raw token lives only in the emailed link, so
 * a database leak can't be used to verify accounts.
 */

const TTL_HOURS = 48;

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Create a fresh single-use token and email the verification link. */
export async function sendVerificationEmail(user: {
  id: number;
  name: string;
  email: string;
}): Promise<void> {
  const token = randomBytes(32).toString('hex');
  // One live token per account: clear old ones so a resend invalidates the last.
  await query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);
  await query(
    `INSERT INTO email_verification_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [hash(token), user.id, String(TTL_HOURS)],
  );

  const link = `${env.publicUrl}/api/auth/verify-email?token=${token}`;
  const text = [
    `Hi ${user.name},`,
    ``,
    `Welcome to Cozy Den! Please confirm your email address by opening this link:`,
    ``,
    link,
    ``,
    `The link is valid for ${TTL_HOURS} hours. If you didn't create an account,`,
    `you can ignore this email.`,
  ].join('\n');

  // Fire-and-forget: a mail failure must never fail the sign-up itself.
  mailer
    .send({ to: user.email, subject: 'Confirm your Cozy Den email', text })
    .catch((e) => console.error('[verify] failed to send verification email', e));
}

/** Consume a token; returns true if it verified an account. Single-use. */
export async function verifyEmailToken(token: string): Promise<boolean> {
  if (!token) return false;
  const { rows } = await query<{ user_id: number }>(
    `DELETE FROM email_verification_tokens
      WHERE token_hash = $1 AND expires_at > now()
      RETURNING user_id`,
    [hash(token)],
  );
  const row = rows[0];
  if (!row) return false;
  await query(
    `UPDATE users SET email_verified = TRUE, email_verified_at = now() WHERE id = $1`,
    [row.user_id],
  );
  return true;
}

/** Whether an account's email is confirmed (used by /auth/me). */
export async function isEmailVerified(userId: number): Promise<boolean> {
  const { rows } = await query<{ email_verified: boolean }>(
    'SELECT email_verified FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.email_verified === true;
}
