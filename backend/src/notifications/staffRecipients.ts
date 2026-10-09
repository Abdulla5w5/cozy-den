import { query } from '../db/pool';

/**
 * Staff recipients = everyone currently flagged as staff. Read per send so a
 * grant or revoke on the dashboard takes effect on the very next alert.
 *
 * Never throws: alerts are best-effort, and a failed lookup must not fail the
 * customer request that triggered it.
 */
export async function staffEmails(): Promise<string[]> {
  try {
    const { rows } = await query<{ email: string }>('SELECT email FROM users WHERE is_staff');
    return rows.map((r) => r.email);
  } catch (err) {
    console.error('[mailer] could not load staff recipients', err);
    return [];
  }
}
