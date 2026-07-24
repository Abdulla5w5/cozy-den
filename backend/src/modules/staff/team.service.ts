import { pool } from '../../db/pool';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';

export interface TeamMember {
  id: number;
  email: string;
  name: string;
  provider: string;
  createdAt: string;
}

/** Authoritative staff check — read at request time so revocation is immediate. */
export async function isStaffUser(userId: number): Promise<boolean> {
  const { rows } = await pool.query<{ is_staff: boolean }>(
    'SELECT is_staff FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.is_staff === true;
}

export async function listTeam(): Promise<TeamMember[]> {
  const { rows } = await pool.query(
    `SELECT id, email, name, provider, created_at
       FROM users
      WHERE is_staff
      ORDER BY created_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    provider: r.provider,
    createdAt: r.created_at.toISOString(),
  }));
}

async function audit(
  action: 'grant' | 'revoke' | 'bootstrap',
  target: { id: number; email: string },
  actor?: { id: number; email: string },
) {
  await pool.query(
    `INSERT INTO staff_grants (actor_user_id, actor_email, target_user_id, target_email, action)
     VALUES ($1, $2, $3, $4, $5)`,
    [actor?.id ?? null, actor?.email ?? null, target.id, target.email, action],
  );
}

/**
 * Promote an existing account. Deliberately refuses unknown emails: reserving an
 * address before its owner registers is the hole this replaces — whoever claimed
 * that address first would have inherited staff access.
 */
export async function grantStaff(
  actor: { id: number; email: string },
  email: string,
): Promise<TeamMember> {
  const target = email.trim().toLowerCase();
  const { rows } = await pool.query(
    `UPDATE users SET is_staff = TRUE
      WHERE lower(email) = $1
      RETURNING id, email, name, provider, created_at`,
    [target],
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(
      404,
      'No account with that email. They must register first, then you can grant access.',
    );
  }
  await audit('grant', { id: row.id, email: row.email }, actor);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    provider: row.provider,
    createdAt: row.created_at.toISOString(),
  };
}

export async function revokeStaff(actor: { id: number; email: string }, targetId: number) {
  if (actor.id === targetId) {
    throw new ApiError(400, 'You cannot revoke your own staff access.');
  }
  // Guard against emptying the team and locking everyone out of the dashboard.
  const { rows: countRows } = await pool.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM users WHERE is_staff',
  );
  if (Number(countRows[0].n) <= 1) {
    throw new ApiError(400, 'Cannot revoke the last remaining staff member.');
  }
  const { rows } = await pool.query(
    'UPDATE users SET is_staff = FALSE WHERE id = $1 AND is_staff RETURNING id, email',
    [targetId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'That user is not a staff member.');
  await audit('revoke', { id: row.id, email: row.email }, actor);
}

/**
 * Break-glass bootstrap: when nobody has staff access, promote any registered
 * account listed in STAFF_ALLOWED_EMAILS. Once one staff member exists the env
 * var is ignored entirely — the dashboard is the only way in or out.
 */
export async function bootstrapStaff(): Promise<void> {
  if (env.staffAllowedEmails.length === 0) return;
  const { rows: countRows } = await pool.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM users WHERE is_staff',
  );
  if (Number(countRows[0].n) > 0) return;

  const { rows } = await pool.query(
    `UPDATE users SET is_staff = TRUE
      WHERE lower(email) = ANY($1::text[])
      RETURNING id, email`,
    [env.staffAllowedEmails],
  );
  for (const row of rows) {
    await audit('bootstrap', { id: row.id, email: row.email });
  }
  if (rows.length > 0) {
    console.log(`[cozy-den] bootstrapped staff access for ${rows.length} account(s)`);
  }
}
