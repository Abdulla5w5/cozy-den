import { query } from '../db/pool';
import { env } from '../config/env';

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

/**
 * Who hears about a new booking: the shared STAFF_ALERT_EMAIL inbox when one is
 * configured — one email per booking, however large the team — otherwise every
 * staff account, so alerts are never silently dropped before it is set.
 */
export async function bookingAlertRecipients(): Promise<string[]> {
  return env.staffAlertEmail ? [env.staffAlertEmail] : staffEmails();
}
