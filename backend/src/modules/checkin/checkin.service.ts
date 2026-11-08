import { randomBytes } from 'crypto';
import { env } from '../../config/env';
import { query } from '../../db/pool';
import { ApiError } from '../../middleware/error';
import { mailer } from '../../notifications/mailer';

/**
 * QR check-in passes (migration 050). A pass is a link holding a long random
 * key, one per table booking, event seat or Wanted Board seat. Opening it
 * shows the basics to anyone and everything to signed-in staff, who can check
 * the guest in from there. The key is the only thing the QR code contains.
 *
 * A pass works from when the booking is paid until the day after it (the
 * service night runs past midnight), and never once cancelled.
 */
export type PassKind = 'table' | 'event' | 'wanted';

/** 24 URL-safe characters from 18 random bytes: far beyond guessing. */
export function newCheckinToken(): string {
  return randomBytes(18).toString('base64url');
}

export const CHECKIN_TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;

const TABLE_FOR: Record<PassKind, string> = {
  table: 'bookings',
  event: 'event_reservations',
  wanted: 'wanted_post_seats',
};

/**
 * The pass key for a row, made now if it has none yet (bookings from before
 * passes existed). COALESCE keeps it stable if two requests race.
 */
export async function ensureCheckinToken(kind: PassKind, id: number): Promise<string> {
  const { rows } = await query<{ checkin_token: string }>(
    `UPDATE ${TABLE_FOR[kind]} SET checkin_token = COALESCE(checkin_token, $2)
      WHERE id = $1 RETURNING checkin_token`,
    [id, newCheckinToken()],
  );
  if (!rows[0]) throw new ApiError(404, 'Not found.');
  return rows[0].checkin_token;
}

/** What anyone who opens the link may see. Nothing that identifies a person. */
export interface PublicPass {
  kind: PassKind;
  title: string;
  date: string;
  timeSlot: string | null;
  durationMin: number | null;
  people: number;
  paid: boolean;
  checkedIn: boolean;
}

/** What signed-in staff also see. */
/**
 * The service night it is right now, in Kuwait time. The café closes at 03:00,
 * so the small hours still belong to the night before.
 */
export function currentServiceDate(now = Date.now()): string {
  // Kuwait is UTC+3; three hours back puts 00:00-02:59 on the previous night,
  // which leaves plain UTC.
  return new Date(now).toISOString().slice(0, 10);
}

export interface StaffPass extends PublicPass {
  /** False when this pass is for a different night than tonight. */
  isTonight: boolean;
  /** Entered by staff by phone: nothing has been paid online. */
  payAtCounter: boolean;
  /** Taken by hand so far. Staff only: never in the public pass. */
  counterCents: number;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  code: string | null;
  totalCents: number;
  hostName: string | null;
  checkedInAt: string | null;
  status: string;
}

// Kuwait's calendar date (UTC+3, no daylight saving). A pass is valid while
// its date is today or yesterday, so a 01:00 arrival on the night of the
// booking still works.
const STILL_VALID = `>= (now() AT TIME ZONE 'Asia/Kuwait')::date - 1`;

interface Found extends StaffPass {
  id: number;
}

async function find(token: string): Promise<Found | null> {
  const { rows: b } = await query<{
    id: number;
    label: string;
    d: string;
    time_slot: string;
    duration_min: number;
    party_size: number;
    status: string;
    guest_name: string;
    guest_phone: string | null;
    guest_email: string | null;
    verification_code: string;
    total_cents: number;
    counter_cents: number;
    host_name: string | null;
    checked_in_at: Date | null;
    source: string;
  }>(
    `SELECT b.id, b.source, t.label || CASE WHEN b.half IS NOT NULL THEN ' (shared)' ELSE '' END AS label, to_char(b.booking_date, 'YYYY-MM-DD') AS d, b.time_slot,
            b.duration_min, b.party_size, b.status, b.guest_name, b.guest_phone,
            b.guest_email, b.verification_code, b.total_cents, b.counter_cents, h.display_name AS host_name,
            b.checked_in_at
       FROM bookings b
       JOIN tables t ON t.id = b.table_id
       LEFT JOIN hosts h ON h.user_id = b.host_id
      WHERE b.checkin_token = $1
        AND b.status NOT IN ('cancelled', 'pending_payment')
        AND b.source <> 'event'
        AND b.booking_date ${STILL_VALID}`,
    [token],
  );
  if (b[0]) {
    const r = b[0];
    return {
      id: r.id,
      kind: 'table',
      title: r.label,
      date: r.d,
      timeSlot: r.time_slot,
      durationMin: r.duration_min,
      people: r.party_size,
      // A booking staff typed in by phone has taken no payment.
      paid: r.source === 'online',
      // Once staff have taken money by hand, the pass stops asking for it.
      payAtCounter: r.source !== 'online' && r.counter_cents <= 0,
      counterCents: r.counter_cents,
      isTonight: r.d === currentServiceDate(),
      checkedIn: r.status !== 'pending',
      status: r.status,
      guestName: r.guest_name,
      guestPhone: r.guest_phone,
      guestEmail: r.guest_email,
      code: r.verification_code,
      totalCents: r.total_cents,
      hostName: r.host_name,
      checkedInAt: r.checked_in_at?.toISOString() ?? null,
    };
  }

  const { rows: e } = await query<{
    id: number;
    title: string;
    d: string;
    start_time: string | null;
    event_time: string | null;
    duration_min: number | null;
    seats: number;
    status: string;
    guest_name: string;
    guest_phone: string | null;
    guest_email: string;
    verification_code: string;
    amount_cents: number;
    checked_in_at: Date | null;
  }>(
    `SELECT r.id, ev.title, to_char(ev.event_date, 'YYYY-MM-DD') AS d, ev.start_time,
            ev.event_time, ev.duration_min, r.seats, r.status, r.guest_name, r.guest_phone,
            r.guest_email, r.verification_code, r.amount_cents, r.checked_in_at
       FROM event_reservations r
       JOIN events ev ON ev.id = r.event_id
      WHERE r.checkin_token = $1
        AND r.status IN ('pending', 'attended')
        AND ev.event_date ${STILL_VALID}`,
    [token],
  );
  if (e[0]) {
    const r = e[0];
    return {
      id: r.id,
      kind: 'event',
      title: r.title,
      date: r.d,
      timeSlot: r.start_time ?? r.event_time,
      durationMin: r.duration_min,
      people: r.seats,
      paid: r.amount_cents > 0,
      payAtCounter: false,
      counterCents: 0,
      isTonight: r.d === currentServiceDate(),
      checkedIn: r.status === 'attended',
      status: r.status,
      guestName: r.guest_name,
      guestPhone: r.guest_phone,
      guestEmail: r.guest_email,
      code: r.verification_code,
      totalCents: r.amount_cents,
      hostName: null,
      checkedInAt: r.checked_in_at?.toISOString() ?? null,
    };
  }

  const { rows: w } = await query<{
    id: number;
    title: string;
    d: string | null;
    duration_min: number;
    seats: number;
    name: string;
    email: string;
    phone: string | null;
    amount_cents: number;
    checked_in_at: Date | null;
  }>(
    `SELECT s.id, COALESCE(g.title, p.game_name, 'Wanted Board') AS title,
            to_char(p.session_date, 'YYYY-MM-DD') AS d, p.duration_min, s.seats,
            u.name, u.email, u.phone, s.amount_cents, s.checked_in_at
       FROM wanted_post_seats s
       JOIN wanted_posts p ON p.id = s.post_id
       JOIN users u ON u.id = s.member_id
       LEFT JOIN games g ON g.id = p.game_id
      WHERE s.checkin_token = $1
        AND s.payment_state = 'paid'
        AND (p.session_date IS NULL OR p.session_date ${STILL_VALID})`,
    [token],
  );
  if (w[0]) {
    const r = w[0];
    return {
      id: r.id,
      kind: 'wanted',
      title: r.title,
      date: r.d ?? '',
      timeSlot: null,
      durationMin: r.duration_min,
      people: r.seats,
      paid: true,
      payAtCounter: false,
      counterCents: 0,
      // A listing without a date cannot be on the wrong night.
      isTonight: r.d === null || r.d === currentServiceDate(),
      checkedIn: r.checked_in_at !== null,
      status: r.checked_in_at ? 'checked_in' : 'paid',
      guestName: r.name,
      guestPhone: r.phone,
      guestEmail: r.email,
      code: null,
      totalCents: r.amount_cents,
      hostName: null,
      checkedInAt: r.checked_in_at?.toISOString() ?? null,
    };
  }
  return null;
}

const NOT_FOUND = 'This pass is not valid. It may have expired or been cancelled.';

function toPublic(f: Found): PublicPass {
  return {
    kind: f.kind,
    title: f.title,
    date: f.date,
    timeSlot: f.timeSlot,
    durationMin: f.durationMin,
    people: f.people,
    paid: f.paid,
    checkedIn: f.checkedIn,
  };
}

/** The pass, in full for staff and as the basics for anyone else. */
export async function getPass(
  token: string,
  isStaff: boolean,
): Promise<{ pass: PublicPass | StaffPass; staff: boolean }> {
  const found = await find(token);
  if (!found) throw new ApiError(404, NOT_FOUND);
  if (!isStaff) return { pass: toPublic(found), staff: false };
  const { id: _id, ...full } = found;
  return { pass: full, staff: true };
}

/**
 * Staff check the guest in. Idempotent: scanning twice says "already checked
 * in" with the time, rather than an error at a busy counter.
 *
 * A pass for another night needs saying so explicitly: there is no undo, and
 * marking next Friday's booking arrived today would spoil it on the night.
 */
export async function checkIn(token: string, confirmOtherNight = false): Promise<StaffPass> {
  const found = await find(token);
  if (!found) throw new ApiError(404, NOT_FOUND);
  if (!found.checkedIn && !found.isTonight && !confirmOtherNight) {
    throw new ApiError(409, 'This pass is for a different night.');
  }
  if (!found.checkedIn) {
    if (found.kind === 'table') {
      await query(
        `UPDATE bookings SET status = 'arrived', checked_in_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [found.id],
      );
    } else if (found.kind === 'event') {
      await query(
        `UPDATE event_reservations SET status = 'attended', checked_in_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [found.id],
      );
    } else {
      await query(
        `UPDATE wanted_post_seats SET checked_in_at = now()
          WHERE id = $1 AND payment_state = 'paid' AND checked_in_at IS NULL`,
        [found.id],
      );
    }
  }
  const after = await find(token);
  if (!after) throw new ApiError(404, NOT_FOUND);
  const { id: _id, ...full } = after;
  return full;
}

// ---------- Seat passes: never lost after payment ----------

export interface MyPass {
  kind: 'event' | 'wanted';
  title: string;
  date: string;
  timeSlot: string | null;
  people: number;
  token: string;
  checkedIn: boolean;
}

/**
 * A signed-in member's event and Wanted Board passes that are still valid, for
 * My Bookings. Seats from before passes existed get their key here.
 */
export async function listMyPasses(userId: number): Promise<MyPass[]> {
  const { rows: ev } = await query<{
    id: number;
    title: string;
    d: string;
    slot: string | null;
    seats: number;
    status: string;
    checkin_token: string | null;
  }>(
    `SELECT r.id, ev.title, to_char(ev.event_date, 'YYYY-MM-DD') AS d,
            COALESCE(ev.start_time, ev.event_time) AS slot, r.seats, r.status, r.checkin_token
       FROM event_reservations r JOIN events ev ON ev.id = r.event_id
      WHERE r.member_id = $1 AND r.status IN ('pending', 'attended')
        AND ev.event_date ${STILL_VALID}
      ORDER BY ev.event_date`,
    [userId],
  );
  const { rows: wa } = await query<{
    id: number;
    title: string;
    d: string | null;
    seats: number;
    checked_in_at: Date | null;
    checkin_token: string | null;
  }>(
    `SELECT s.id, COALESCE(g.title, p.game_name, 'Wanted Board') AS title,
            to_char(p.session_date, 'YYYY-MM-DD') AS d, s.seats, s.checked_in_at, s.checkin_token
       FROM wanted_post_seats s
       JOIN wanted_posts p ON p.id = s.post_id
       LEFT JOIN games g ON g.id = p.game_id
      WHERE s.member_id = $1 AND s.payment_state = 'paid'
        AND (p.session_date IS NULL OR p.session_date ${STILL_VALID})
      ORDER BY p.session_date`,
    [userId],
  );
  const out: MyPass[] = [];
  for (const r of ev) {
    out.push({
      kind: 'event',
      title: r.title,
      date: r.d,
      timeSlot: r.slot,
      people: r.seats,
      token: r.checkin_token ?? (await ensureCheckinToken('event', r.id)),
      checkedIn: r.status === 'attended',
    });
  }
  for (const r of wa) {
    out.push({
      kind: 'wanted',
      title: r.title,
      date: r.d ?? '',
      timeSlot: null,
      people: r.seats,
      token: r.checkin_token ?? (await ensureCheckinToken('wanted', r.id)),
      checkedIn: r.checked_in_at !== null,
    });
  }
  return out;
}

/**
 * Email a confirmed seat its QR pass. Paying is the last the customer may see
 * of the site (a closed tab, a phone that died), and a guest at an event has no
 * account, so this is what guarantees they can still get in. Fire-and-forget: a
 * mail failure must never fail a paid seat.
 */
export function emailSeatPass(kind: 'event' | 'wanted', id: number): void {
  void (async () => {
    const { rows } =
      kind === 'event'
        ? await query<{ email: string; name: string; title: string; d: string; ref: string | null }>(
            `SELECT r.guest_email AS email, r.guest_name AS name, ev.title,
                    to_char(ev.event_date, 'YYYY-MM-DD') AS d, r.verification_code AS ref
               FROM event_reservations r JOIN events ev ON ev.id = r.event_id
              WHERE r.id = $1`,
            [id],
          )
        : await query<{ email: string; name: string; title: string; d: string; ref: string | null }>(
            `SELECT u.email, u.name, COALESCE(g.title, p.game_name, 'Wanted Board') AS title,
                    COALESCE(to_char(p.session_date, 'YYYY-MM-DD'), '') AS d, NULL AS ref
               FROM wanted_post_seats s
               JOIN wanted_posts p ON p.id = s.post_id
               JOIN users u ON u.id = s.member_id
               LEFT JOIN games g ON g.id = p.game_id
              WHERE s.id = $1`,
            [id],
          );
    const row = rows[0];
    if (!row) return;
    const token = await ensureCheckinToken(kind, id);
    await mailer.send({
      to: row.email,
      subject: `Your Cozy Den pass: ${row.title}`,
      text: [
        `Hi ${row.name},`,
        '',
        `You're confirmed for ${row.title}${row.d ? ` on ${row.d}` : ''}.`,
        '',
        ...(env.publicUrl
          ? ['Open your QR pass and let staff scan it at the counter:', `    ${env.publicUrl}/c/${token}`, '']
          : []),
        ...(row.ref ? [`Your reference: ${row.ref}`, ''] : []),
        'See you soon,',
        'The Cozy Den',
      ].join('\n'),
    });
  })().catch((e) => console.error('[mailer] failed to send seat pass', e));
}
