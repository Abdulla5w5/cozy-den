import bcrypt from 'bcryptjs';
import type { OAuth2Client } from 'google-auth-library';
import { query } from '../../db/pool';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  password_hash: string | null;
  provider: string;
}

const SELECT = 'SELECT id, email, name, phone, password_hash, provider FROM users';
let googleClient: OAuth2Client | undefined;

function getGoogleClient(): OAuth2Client {
  if (!env.googleClientId) {
    throw new ApiError(503, 'Google sign-in is not configured on this server.');
  }
  if (!googleClient) {
    // Google sign-in is optional for any individual request. Load its sizeable
    // certificate/JWT client on first use and then reuse one instance so normal
    // page/API traffic does not carry the startup cost or repeat allocations.
    const { OAuth2Client } = require('google-auth-library') as typeof import('google-auth-library');
    googleClient = new OAuth2Client(env.googleClientId);
  }
  return googleClient;
}

/**
 * The two per-request account flags in one read. They live in the same `users`
 * row, so asking for them separately (isStaffUser + isEmailVerified) meant two
 * round trips on every login, every session issue and every /auth/me — the
 * single most-called endpoint in the app, since the SPA calls it on boot.
 */
export async function getAccountFlags(
  userId: number,
): Promise<{ isStaff: boolean; isAdmin: boolean; emailVerified: boolean; phone: string | null }> {
  const { rows } = await query<{
    is_staff: boolean;
    is_admin: boolean;
    email_verified: boolean;
    phone: string | null;
  }>(
    'SELECT is_staff, is_admin, email_verified, phone FROM users WHERE id = $1',
    [userId],
  );
  return {
    isStaff: rows[0]?.is_staff === true,
    isAdmin: rows[0]?.is_admin === true,
    emailVerified: rows[0]?.email_verified === true,
    phone: rows[0]?.phone ?? null,
  };
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(`${SELECT} WHERE email = $1`, [email.toLowerCase()]);
  return rows[0] ?? null;
}

export async function registerUser(
  email: string,
  name: string,
  phone: string,
  password: string
): Promise<UserRow> {
  if (await getUserByEmail(email)) {
    throw new ApiError(409, 'An account with this email already exists.');
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (email, name, phone, password_hash, provider)
       VALUES ($1, $2, $3, $4, 'local')
       RETURNING id, email, name, phone, password_hash, provider`,
      [email.toLowerCase(), name, phone, hash]
    );
    return rows[0];
  } catch (err) {
    // Two sign-ups racing (a double-click): the loser hits the unique email.
    if ((err as { code?: string }).code === '23505') {
      throw new ApiError(409, 'An account with this email already exists.');
    }
    throw err;
  }
}

// A real bcrypt hash of nothing in particular, so an unknown email costs the
// same comparison time as a known one. (bcryptjs answers a malformed hash in
// no time at all, which would tell an attacker which emails have accounts.)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function authenticateUser(email: string, password: string): Promise<UserRow> {
  const user = await getUserByEmail(email);
  // Constant-ish comparison + generic error so we don't reveal which emails exist.
  const hash = user?.password_hash ?? DUMMY_HASH;
  const ok = await bcrypt.compare(password, hash);
  if (!user || !user.password_hash || !ok) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  return user;
}

/**
 * Create the user on first Google sign-in, otherwise return the existing one.
 *
 * Google has already proven the address belongs to the person signing in, so
 * `googleVerified` carries that through to `users.email_verified` rather than
 * making them confirm an address twice — booking history is gated on that flag.
 */
export async function upsertGoogleUser(
  email: string,
  name: string,
  googleVerified: boolean,
  phone?: string,
): Promise<UserRow> {
  let existing = await getUserByEmail(email);
  if (existing) {
    // Signing in to an existing account needs Google to vouch for the address.
    // Otherwise a Google account set up with someone else's (unverified) email
    // would walk straight into theirs — staff and admin accounts included.
    if (!googleVerified) {
      throw new ApiError(401, 'Google has not verified this email address, so it cannot be used to sign in here.');
    }
    // Google proves the address belongs to the person signing in. If the
    // account was never verified, whoever set its password did NOT prove that
    // — it may be someone who registered the address first to read the owner's
    // bookings. So the password is removed and every older session signed
    // out; the owner can set a new password with "Forgot password".
    const { rows: upgraded } = await query<UserRow>(
      `UPDATE users
          SET email_verified = TRUE, email_verified_at = now(),
              -- Whole seconds, minus one: a session's issue time is rounded
              -- down to the second (and taken from the app's clock, not the
              -- database's), and the one being created right now must survive.
              password_hash = NULL, password_changed_at = date_trunc('second', now()) - interval '1 second'
        WHERE id = $1 AND NOT email_verified
        RETURNING id, email, name, phone, password_hash, provider`,
      [existing.id],
    );
    if (upgraded[0]) existing = upgraded[0];
    // Lets a legacy Google account acquire its missing phone when the owner
    // intentionally uses the sign-up form, without overwriting known contact.
    if (!existing.phone && phone) {
      await query('UPDATE users SET phone = $1 WHERE id = $2 AND phone IS NULL', [phone, existing.id]);
      return { ...existing, phone };
    }
    return existing;
  }
  if (!phone) {
    throw new ApiError(400, 'A valid Kuwait phone number is required to create an account.');
  }
  try {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (email, name, phone, provider, email_verified, email_verified_at)
       VALUES ($1, $2, $3, 'google', $4, CASE WHEN $4 THEN now() END)
       RETURNING id, email, name, phone, password_hash, provider`,
      [email.toLowerCase(), name, phone, googleVerified]
    );
    return rows[0];
  } catch (err) {
    // Two Google sign-ins racing (two tabs): the other one created the row.
    if ((err as { code?: string }).code === '23505') {
      const created = await getUserByEmail(email);
      if (created) return created;
    }
    throw err;
  }
}

/** Verify a Google ID token server-side. Requires GOOGLE_CLIENT_ID. */
export async function verifyGoogleToken(
  idToken: string,
): Promise<{ email: string; name: string; emailVerified: boolean }> {
  const client = getGoogleClient();
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw new ApiError(401, 'Invalid Google token.');
  }
  if (!payload?.email) throw new ApiError(401, 'Google token did not include an email.');
  return {
    email: payload.email,
    name: payload.name || payload.email,
    emailVerified: payload.email_verified === true,
  };
}
