/**
 * The "see you soon" reminder, sent 3 hours before a booking starts, by site
 * (for accounts) and email.
 *
 * Which bookings: paid online bookings still waiting for their guests. Staff
 * phone and walk-in bookings are left out (those guests talked to the café
 * directly and may have no email), and so is anything booked less than 3
 * hours before it starts — the receipt they just got says it all.
 *
 * Each booking is claimed (reminder_sent_at set) before anything is sent, so it
 * is reminded at most once, even with two servers sweeping at the same time.
 * The cost is that a failed email is not retried; it is logged instead. When
 * staff move a booking to another start time, reminder_sent_at is cleared and
 * the new time is reminded in its turn.
 *
 * Only accounts get reminders: an online booking without an account has no
 * email on file.
 *
 * Runs in production only (or with BOOKING_REMINDERS=on), so a local copy of
 * the database can never email real customers.
 */
import { query } from '../db/pool';
import { env } from '../config/env';
import { notify } from './notify';

export const REMINDER_HOURS = 3;
const BATCH = 50;

// The booking's start as a real moment. booking_window() gives Kuwait wall
// time (with the after-midnight rollover); this pins it to Kuwait's zone.
const STARTS_AT = `(lower(booking_window(b.booking_date, b.time_slot, b.duration_min))
                     AT TIME ZONE 'Asia/Kuwait')`;

interface DueRow {
  id: number;
  start_date: string;
  user_id: number | null;
  account_email: string | null;
  guest_email: string | null;
  guest_name: string;
  booking_date: string;
  time_slot: string;
  duration_min: number;
  party_size: number;
  table_label: string;
  verification_code: string;
  checkin_token: string | null;
}

export function formatReminderEmail(b: {
  guestName: string;
  date: string;
  timeSlot: string;
  tableLabel: string;
  partySize: number;
  verificationCode: string;
  passUrl: string | null;
}): { subject: string; text: string } {
  return {
    subject: `See you at ${b.timeSlot} — your Cozy Den table is ready`,
    text: [
      `Hi ${b.guestName},`,
      '',
      `A quick reminder: your table is booked for ${b.timeSlot}.`,
      '',
      // The calendar day it starts, so 01:00 reads as the early hours of the
      // next day, not the night the booking belongs to.
      `Date:  ${b.date}`,
      `Table: ${b.tableLabel}`,
      `Party: ${b.partySize} ${b.partySize === 1 ? 'guest' : 'guests'}`,
      '',
      'Show this code at the counter:',
      `    ${b.verificationCode}`,
      ...(b.passUrl ? ['', 'Or open your QR pass:', `    ${b.passUrl}`] : []),
      '',
      'See you soon,',
      'The Cozy Den',
    ].join('\n'),
  };
}

/** Claims and sends the reminders now due. Returns how many were sent. */
export async function sendDueReminders(): Promise<number> {
  const claimed = await query<{ id: number }>(
    `UPDATE bookings SET reminder_sent_at = now()
      WHERE id IN (
        SELECT b.id FROM bookings b
         WHERE b.reminder_sent_at IS NULL
           AND b.status = 'pending'
           AND b.source = 'online'
           AND b.booking_date BETWEEN (now() AT TIME ZONE 'Asia/Kuwait')::date - 1
                                  AND (now() AT TIME ZONE 'Asia/Kuwait')::date + 1
           AND ${STARTS_AT} > now()
           AND ${STARTS_AT} <= now() + interval '${REMINDER_HOURS} hours'
           AND b.created_at < ${STARTS_AT} - interval '${REMINDER_HOURS} hours'
         ORDER BY b.id
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED)
        AND reminder_sent_at IS NULL
      RETURNING id`,
  );
  if (claimed.rows.length === 0) return 0;

  const { rows } = await query<DueRow>(
    `SELECT b.id,
            to_char(lower(booking_window(b.booking_date, b.time_slot, b.duration_min)), 'YYYY-MM-DD')
              AS start_date,
            b.user_id, u.email AS account_email, b.guest_email, b.guest_name,
            to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date, b.time_slot,
            b.duration_min, b.party_size, t.label AS table_label,
            b.verification_code, b.checkin_token
       FROM bookings b
       JOIN tables t ON t.id = b.table_id
       LEFT JOIN users u ON u.id = b.user_id
      WHERE b.id = ANY($1::int[])`,
    [claimed.rows.map((r) => r.id)],
  );

  let sent = 0;
  for (const b of rows) {
    const passUrl = env.publicUrl && b.checkin_token ? `${env.publicUrl}/c/${b.checkin_token}` : null;
    const email = formatReminderEmail({
      guestName: b.guest_name,
      date: b.start_date,
      timeSlot: b.time_slot,
      tableLabel: b.table_label,
      partySize: b.party_size,
      verificationCode: b.verification_code,
      passUrl,
    });
    try {
      await notify({
        userId: b.user_id,
        kind: 'booking_reminder',
        data: {
          bookingId: b.id,
          date: b.start_date,
          time: b.time_slot,
          table: b.table_label,
          code: b.verification_code,
        },
        link: '/account',
        // Keyed on the start too, so a booking moved to a new time is reminded again.
        dedupeKey: `booking_reminder:${b.id}:${b.start_date}T${b.time_slot}`,
        email: { to: b.account_email ?? b.guest_email, ...email },
      });
      sent += 1;
    } catch (err) {
      console.error(`[reminders] booking ${b.id} reminder failed`, err);
    }
  }
  return sent;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Every 5 minutes, so a reminder lands between 3h and 2h55m before the start. */
export function startReminders(intervalMs = 5 * 60 * 1000): void {
  if (timer) return;
  if (!env.isProd && process.env.BOOKING_REMINDERS !== 'on') {
    console.log('[reminders] off outside production (set BOOKING_REMINDERS=on to test)');
    return;
  }
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const n = await sendDueReminders();
      if (n > 0) console.log(`[reminders] sent ${n} booking reminder(s)`);
    } catch (err) {
      console.error('[reminders] sweep error', err);
    } finally {
      running = false;
    }
  };
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  setTimeout(run, 45 * 1000).unref?.();
  console.log(`[reminders] booking reminder sweep every ${Math.round(intervalMs / 1000)}s`);
}
