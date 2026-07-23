/**
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  PLACEHOLDER MAILER — logs to the console instead of sending.      │
 * │  Swap for a real transport (SES / SendGrid / Postmark) in phase 2 │
 * │  by implementing Mailer and wiring it in. No caller changes.      │
 * └─────────────────────────────────────────────────────────────────┘
 */
export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    console.log('\n===== [STUB EMAIL] =====');
    console.log(`To:      ${msg.to}`);
    console.log(`Subject: ${msg.subject}`);
    console.log(msg.text);
    console.log('========================\n');
  }
}

export const mailer: Mailer = new ConsoleMailer();

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
