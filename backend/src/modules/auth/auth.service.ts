import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../../db/pool';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string | null;
  provider: string;
}

const SELECT = 'SELECT id, email, name, password_hash, provider FROM users';

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(`${SELECT} WHERE email = $1`, [email.toLowerCase()]);
  return rows[0] ?? null;
}

export async function registerUser(
  email: string,
  name: string,
  password: string
): Promise<UserRow> {
  if (await getUserByEmail(email)) {
    throw new ApiError(409, 'An account with this email already exists.');
  }
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, name, password_hash, provider)
     VALUES ($1, $2, $3, 'local')
     RETURNING id, email, name, password_hash, provider`,
    [email.toLowerCase(), name, hash]
  );
  return rows[0];
}

export async function authenticateUser(email: string, password: string): Promise<UserRow> {
  const user = await getUserByEmail(email);
  // Constant-ish comparison + generic error so we don't reveal which emails exist.
  const hash = user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !user.password_hash || !ok) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  return user;
}

/** Create the user on first Google sign-in, otherwise return the existing one. */
export async function upsertGoogleUser(email: string, name: string): Promise<UserRow> {
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, name, provider)
     VALUES ($1, $2, 'google')
     RETURNING id, email, name, password_hash, provider`,
    [email.toLowerCase(), name]
  );
  return rows[0];
}

/** Verify a Google ID token server-side. Requires GOOGLE_CLIENT_ID. */
export async function verifyGoogleToken(idToken: string): Promise<{ email: string; name: string }> {
  if (!env.googleClientId) {
    throw new ApiError(503, 'Google sign-in is not configured on this server.');
  }
  const client = new OAuth2Client(env.googleClientId);
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw new ApiError(401, 'Invalid Google token.');
  }
  if (!payload?.email) throw new ApiError(401, 'Google token did not include an email.');
  return { email: payload.email, name: payload.name || payload.email };
}
