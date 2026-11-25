import { createHmac, timingSafeEqual } from 'crypto';
import { query } from '../../db/pool';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';

/** A member's Wanted Board settings: their username and their subscription. */

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
// Nobody may look like the café or its team. The café's name is refused
// anywhere; the rest only as a whole word, so "badminton" is fine. Staff also
// see the username before they approve a post.
const CAFE = ['cozyden', 'cozycafe'];
const ROLES = new Set([
  'admin', 'staff', 'cozy', 'manager', 'owner', 'moderator', 'mod', 'official', 'support',
  'gm', 'gamemaster', 'host', 'null', 'undefined',
]);
const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's' };

/** Why a username cannot be used, or null. Expects it lower-cased. */
export function usernameRefusal(username: string): string | null {
  if (!USERNAME_PATTERN.test(username) || !/[a-z]/.test(username)) {
    return 'Your username needs 3 to 20 English letters, numbers or underscores, with at least one letter.';
  }
  const read = username.replace(/[01345]/g, (c) => LOOKALIKE[c]);
  const words = [
    ...read.split('_'),
    // "admin22" and "staff_1" too: the number is not part of the word.
    ...username.replace(/\d+$/, '').split('_'),
  ];
  const plain = read.replace(/_/g, '');
  if (CAFE.some((c) => plain.includes(c)) || words.some((w) => ROLES.has(w)) || ROLES.has(plain)) {
    return 'That username is not available.';
  }
  return null;
}

export interface WantedMember {
  username: string | null;
  subscribed: boolean;
  /** Alerts are emailed only to a confirmed address; the bell always works. */
  emailVerified: boolean;
}

export async function getWantedMember(userId: number): Promise<WantedMember> {
  const { rows } = await query<{
    username: string | null;
    wanted_alerts: boolean;
    email_verified: boolean;
  }>('SELECT username, wanted_alerts, email_verified FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new ApiError(404, 'Account not found.');
  return {
    username: rows[0].username,
    subscribed: rows[0].wanted_alerts,
    emailVerified: rows[0].email_verified,
  };
}

export async function setUsername(userId: number, raw: string): Promise<string> {
  const username = raw.trim().toLowerCase();
  const refusal = usernameRefusal(username);
  if (refusal) throw new ApiError(400, refusal);
  try {
    await query('UPDATE users SET username = $2 WHERE id = $1', [userId, username]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ApiError(409, 'That username is taken. Try another.');
    }
    throw err;
  }
  return username;
}

export async function setSubscribed(userId: number, on: boolean): Promise<void> {
  await query('UPDATE users SET wanted_alerts = $2 WHERE id = $1', [userId, on]);
}

// The unsubscribe link in an alert email works without signing in, and can
// only ever do that one thing for that one account.
const sign = (userId: number) =>
  createHmac('sha256', env.jwtSecret).update(`wanted-unsubscribe:${userId}`).digest('base64url');

export function unsubscribeToken(userId: number): string {
  return `${userId}.${sign(userId)}`;
}

/** The account an unsubscribe token is for, or null when it is not genuine. */
export function readUnsubscribeToken(token: string): number | null {
  const m = /^([1-9]\d{0,9})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m || Number(m[1]) > 2147483647) return null;
  const given = Buffer.from(m[2]);
  const real = Buffer.from(sign(Number(m[1])));
  return given.length === real.length && timingSafeEqual(given, real) ? Number(m[1]) : null;
}

export async function unsubscribeByToken(token: string): Promise<void> {
  const userId = readUnsubscribeToken(token);
  if (userId === null) throw new ApiError(400, 'This unsubscribe link is not valid.');
  await setSubscribed(userId, false);
}
