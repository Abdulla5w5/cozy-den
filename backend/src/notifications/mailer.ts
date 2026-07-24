/**
 * Mail transport. Real SMTP when SMTP_URL is configured, otherwise the console
 * stub — so local development and any environment without credentials keeps
 * working instead of erroring on every send.
 *
 * SMTP_URL is provider-agnostic; it works with SES, Postmark, Resend, Mailgun,
 * Gmail app passwords, etc. Example:
 *   smtps://user:pass@smtp.eu-west-1.amazonaws.com:465
 */
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    console.log('\n===== [STUB EMAIL — set SMTP_URL to send for real] =====');
    console.log(`To:      ${msg.to}`);
    console.log(`Subject: ${msg.subject}`);
    console.log(msg.text);
    console.log('========================\n');
  }
}

class SmtpMailer implements Mailer {
  private transport: Transporter;

  constructor(url: string) {
    // Pooled so a burst of staff notifications reuses one connection.
    // Options ride on the URL (nodemailer parses query params) because the
    // typed (url, defaults) overload treats the second argument as defaults.
    const pooled = url.includes('?') ? `${url}&pool=true` : `${url}?pool=true`;
    this.transport = nodemailer.createTransport(pooled);
  }

  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    await this.transport.sendMail({ from: env.mailFrom, ...msg });
  }
}

function createMailer(): Mailer {
  if (!env.smtpUrl) {
    if (env.isProd) {
      console.warn('[mailer] SMTP_URL is not set — emails are logged, not delivered.');
    }
    return new ConsoleMailer();
  }
  console.log('[mailer] SMTP transport configured');
  return new SmtpMailer(env.smtpUrl);
}

export const mailer: Mailer = createMailer();

export function formatReceiptEmail(booking: {
  guestName: string;
  verificationCode: string;
  date: string;
  timeSlot: string;
  tableLabel: string;
  tableFeeCents: number;
  totalCents: number;
}): { subject: string; text: string } {
  const money = (c: number) => `KD ${(c / 100).toFixed(2)}`;

  return {
    subject: `Your Cozy Den booking is confirmed — code ${booking.verificationCode}`,
    text: [
      `Hi ${booking.guestName},`,
      '',
      'Your table is booked! Show this code at the counter:',
      '',
      `    ${booking.verificationCode}`,
      '',
      `Date:  ${booking.date}`,
      `Time:  ${booking.timeSlot} (2-hour session)`,
      `Table: ${booking.tableLabel}`,
      '',
      `Table-holding fee paid: ${money(booking.tableFeeCents)}`,
      `Total paid: ${money(booking.totalCents)}`,
      '',
      'Games and the menu are waiting for you at the café.',
      '',
      'See you soon,',
      'The Cozy Den',
    ].join('\n'),
  };
}
