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
  gameTitle: string | null;
  items: { name: string; quantity: number; lineTotalCents: number }[];
  tableFeeCents: number;
  totalCents: number;
}): { subject: string; text: string } {
  const money = (c: number) => `£${(c / 100).toFixed(2)}`;
  const lines = booking.items
    .map((i) => `  ${i.quantity} x ${i.name} — ${money(i.lineTotalCents)}`)
    .join('\n');

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
      `Time:  ${booking.timeSlot} (2-hour seating)`,
      `Table: ${booking.tableLabel}`,
      `Game:  ${booking.gameTitle ?? 'None selected'}`,
      '',
      'Order:',
      lines || '  (no food/drink pre-ordered)',
      `  Table reservation fee — ${money(booking.tableFeeCents)}`,
      '',
      `Total paid: ${money(booking.totalCents)}`,
      '',
      'See you soon,',
      'The Cozy Den',
    ].join('\n'),
  };
}
