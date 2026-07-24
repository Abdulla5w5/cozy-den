import { mailer } from '../../notifications/mailer';
import { env } from '../../config/env';
import { query } from '../../db/pool';

/**
 * Support notifications. Every function here is called with `void` — a mail
 * failure must never fail the customer's request, so each one swallows its own
 * errors after logging. Delivery is best-effort; the thread in Postgres is the
 * source of truth and the app is fully usable if mail is delayed or dropped.
 */
async function safeSend(to: string, subject: string, text: string) {
  try {
    await mailer.send({ to, subject, text });
  } catch (err) {
    console.error('[support] notification failed', { to, subject, err });
  }
}

/** Staff recipients = everyone currently flagged as staff. */
async function staffEmails(): Promise<string[]> {
  try {
    const { rows } = await query<{ email: string }>('SELECT email FROM users WHERE is_staff');
    return rows.map((r) => r.email);
  } catch (err) {
    console.error('[support] could not load staff recipients', err);
    return [];
  }
}

const siteUrl = env.publicUrl || '';

export async function notifyNewComplaint(r: {
  id: number;
  subject: string;
  severity: string | null;
  customerName: string;
  customerEmail: string;
  body: string;
}) {
  const recipients = await staffEmails();
  const subject = `[Cozy Den] ${r.severity === 'urgent' ? 'URGENT ' : ''}complaint #${r.id}: ${r.subject}`;
  const text = [
    `A new complaint has been submitted.`,
    ``,
    `Severity: ${r.severity ?? 'normal'}`,
    `From:     ${r.customerName} <${r.customerEmail}>`,
    `Subject:  ${r.subject}`,
    ``,
    r.body,
    ``,
    siteUrl ? `Open the inbox: ${siteUrl}/staff/dashboard` : '',
  ].join('\n');
  await Promise.all(recipients.map((to) => safeSend(to, subject, text)));
}

export async function notifyStaffReply(r: {
  id: number;
  subject: string;
  customerName: string;
  customerEmail: string;
  body: string;
}) {
  await safeSend(
    r.customerEmail,
    `[Cozy Den] Reply to your request #${r.id}: ${r.subject}`,
    [
      `Hi ${r.customerName},`,
      ``,
      `Cozy Den replied to your request:`,
      ``,
      r.body,
      ``,
      siteUrl ? `View the conversation: ${siteUrl}/support/${r.id}` : '',
    ].join('\n'),
  );
}

export async function notifyResolved(r: {
  id: number;
  subject: string;
  customerName: string;
  customerEmail: string;
}) {
  await safeSend(
    r.customerEmail,
    `[Cozy Den] Request #${r.id} resolved: ${r.subject}`,
    [
      `Hi ${r.customerName},`,
      ``,
      `We've marked your request "${r.subject}" as resolved.`,
      `If it isn't sorted, reply on the thread and we'll reopen it.`,
      ``,
      siteUrl ? `${siteUrl}/support/${r.id}` : '',
    ].join('\n'),
  );
}
