/**
 * Mail transport. Real SMTP when SMTP_URL is configured, otherwise the console
 * stub — so local development and any environment without credentials keeps
 * working instead of erroring on every send.
 *
 * SMTP_URL is provider-agnostic; it works with SES, Postmark, Resend, Mailgun,
 * Gmail app passwords, etc. Example:
 *   smtps://user:pass@smtp.eu-west-1.amazonaws.com:465
 */
import type { Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    // In production the body is withheld: these messages carry verification
    // links and booking codes, and this path already means the mail was never
    // delivered — no reason to also spill the contents into the log stream.
    if (env.isProd) {
      console.error(
        `[mailer] NOT DELIVERED (SMTP_URL unset) — to=${msg.to} subject=${msg.subject}`,
      );
      return;
    }
    console.log('\n===== [STUB EMAIL — set SMTP_URL to send for real] =====');
    console.log(`To:      ${msg.to}`);
    console.log(`Subject: ${msg.subject}`);
    console.log(msg.text);
    console.log('========================\n');
  }
}

class SmtpMailer implements Mailer {
  private transport: Transporter | undefined;

  constructor(private readonly url: string) {}

  private getTransport(): Transporter {
    if (this.transport) return this.transport;
    // SMTP is configured in production, but many processes serve only page and
    // catalogue traffic. Load Nodemailer on the first actual email and retain
    // the transport after that. A two-connection pool queues bursts while
    // bounding sockets and buffers on the 512 MB service instance.
    const nodemailer = require('nodemailer') as typeof import('nodemailer');
    // Pooled so a burst of staff notifications reuses one connection.
    // Options ride on the URL (nodemailer parses query params) because the
    // typed (url, defaults) overload treats the second argument as defaults.
    const separator = this.url.includes('?') ? '&' : '?';
    const pooled = `${this.url}${separator}pool=true&maxConnections=2&maxMessages=100`;
    this.transport = nodemailer.createTransport(pooled);
    return this.transport;
  }

  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    await this.getTransport().sendMail({ from: env.mailFrom, ...msg });
  }
}

function createMailer(): Mailer {
  if (!env.smtpUrl) {
    if (env.isProd) {
      console.error(
        '[mailer] ***** SMTP_URL IS NOT SET IN PRODUCTION *****\n' +
          '[mailer] No email leaves this server: booking receipts, email\n' +
          '[mailer] verification links, and complaint alerts are all dropped.\n' +
          '[mailer] Customers cannot confirm their address, which also means\n' +
          '[mailer] they cannot see their booking history.',
      );
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
