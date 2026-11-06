import { query } from '../../db/pool';
import { ApiError } from '../../middleware/error';
import { CLOSE_MIN, isLateStart, isValidStart, slotStartsAt, toMinutes } from '../../utils/slots';

/**
 * Private game hosts (migrations 049, 051). One group of people who join a
 * table to explain games and play along, or run D&D as Dungeon Master.
 *
 * Customers do not pick a person. They pick an option — a normal host or a
 * Blood on the Clocktower host — and a free host who offers it is assigned.
 * Each option has one price per hour, set by an admin, for the whole table.
 */

/** A host can only be booked this far ahead (the café's terms). */
export const HOST_NOTICE_MS = 24 * 60 * 60 * 1000;

export type HostKind = 'normal' | 'clocktower';

/** Which tick on a host's profile each option needs. Fixed identifiers only:
 *  these go straight into SQL. */
const KIND_COLUMN: Record<HostKind, string> = {
  normal: 'offers_board_games',
  clocktower: 'offers_clocktower',
};

export interface HostOption {
  kind: HostKind;
  hourlyCents: number;
}

export interface HostRates {
  normalHourlyCents: number | null;
  clocktowerHourlyCents: number | null;
}

export async function getHostRates(): Promise<HostRates> {
  const { rows } = await query<{
    host_normal_hourly_cents: number | null;
    host_clocktower_hourly_cents: number | null;
  }>('SELECT host_normal_hourly_cents, host_clocktower_hourly_cents FROM pricing_rates WHERE id');
  return {
    normalHourlyCents: rows[0].host_normal_hourly_cents,
    clocktowerHourlyCents: rows[0].host_clocktower_hourly_cents,
  };
}

export async function setHostRates(r: HostRates): Promise<void> {
  await query(
    `UPDATE pricing_rates
        SET host_normal_hourly_cents = $1, host_clocktower_hourly_cents = $2, updated_at = now()
      WHERE id`,
    [r.normalHourlyCents, r.clocktowerHourlyCents],
  );
}

/** The options with a price. An option with none is not on sale yet. */
function pricedOptions(r: HostRates): HostOption[] {
  const out: HostOption[] = [];
  if (r.normalHourlyCents !== null) out.push({ kind: 'normal', hourlyCents: r.normalHourlyCents });
  if (r.clocktowerHourlyCents !== null) {
    out.push({ kind: 'clocktower', hourlyCents: r.clocktowerHourlyCents });
  }
  return out;
}

export interface HostProfile {
  id: number;
  name: string;
  bio: string;
  photoUrl: string | null;
  hourlyCents: number;
  offersBoardGames: boolean;
  offersClocktower: boolean;
  offersDnd: boolean;
}

interface HostRow {
  user_id: number;
  display_name: string;
  bio: string;
  photo_url: string | null;
  hourly_cents: number;
  offers_board_games: boolean;
  offers_clocktower: boolean;
  offers_dnd: boolean;
}

const PROFILE_COLUMNS =
  'h.user_id, h.display_name, h.bio, h.photo_url, h.hourly_cents, h.offers_board_games, ' +
  'h.offers_clocktower, h.offers_dnd';

const toProfile = (r: HostRow): HostProfile => ({
  id: r.user_id,
  name: r.display_name,
  bio: r.bio,
  photoUrl: r.photo_url,
  hourlyCents: r.hourly_cents,
  offersBoardGames: r.offers_board_games,
  offersClocktower: r.offers_clocktower,
  offersDnd: r.offers_dnd,
});

/** What a host costs for a sitting of this length: per hour, whole group. */
export function hostFeeCents(hourlyCents: number, durationMin: number): number {
  return Math.round((hourlyCents * durationMin) / 60);
}

/** Any host, active or not: a removed host can still read their schedule, so
 *  they see the sessions customers have already paid for. */
export async function isHostAccount(userId: number): Promise<boolean> {
  const { rows } = await query('SELECT 1 FROM hosts WHERE user_id = $1', [userId]);
  return rows.length > 0;
}

export async function isActiveHost(userId: number): Promise<boolean> {
  const { rows } = await query('SELECT 1 FROM hosts WHERE user_id = $1 AND is_active', [userId]);
  return rows.length > 0;
}

/** Why a host cannot be added to a sitting at this time, or null. */
export function hostTimingRefusal(date: string, timeSlot: string, now = Date.now()): string | null {
  if (isLateStart(timeSlot)) return 'A game host is not available for late seatings.';
  if (slotStartsAt(date, timeSlot) - now < HOST_NOTICE_MS) {
    return 'A game host needs to be booked at least 24 hours ahead.';
  }
  return null;
}

// A window is free when one of the host's availability windows contains it
// and none of their live bookings overlaps it. Both in booking_window() terms,
// so a sitting past midnight is handled the same way as a table booking.
// $4 is the asker's checkout-token hash: their OWN unfinished checkout does not
// count against them, because checkout releases it when they try again.
const FREE_FOR_WINDOW = `
  EXISTS (SELECT 1 FROM host_availability a
           WHERE a.host_id = h.user_id
             AND booking_window(a.avail_date, a.time_slot, a.duration_min)
                 @> booking_window($1::date, $2, $3))
  AND NOT EXISTS (SELECT 1 FROM bookings b
                   WHERE b.host_id = h.user_id AND b.status <> 'cancelled'
                     AND booking_window(b.booking_date, b.time_slot, b.duration_min)
                         && booking_window($1::date, $2, $3)
                     AND NOT (b.status = 'pending_payment'
                              AND COALESCE(b.retry_token_hash = $4::text, FALSE)))`;

/** The options the café can offer at all, for the home page: priced, with at
 *  least one active host. No names: customers do not choose a person. */
export async function listPublicOptions(): Promise<HostOption[]> {
  const out: HostOption[] = [];
  for (const option of pricedOptions(await getHostRates())) {
    const { rows } = await query(
      `SELECT 1 FROM hosts h WHERE h.is_active AND h.${KIND_COLUMN[option.kind]} LIMIT 1`,
    );
    if (rows.length) out.push(option);
  }
  return out;
}

/** The options with a host free for this whole sitting. */
export async function listAvailableOptions(
  date: string,
  timeSlot: string,
  durationMin: number,
  retryTokenHash: string | null = null,
): Promise<HostOption[]> {
  if (hostTimingRefusal(date, timeSlot)) return [];
  const out: HostOption[] = [];
  for (const option of pricedOptions(await getHostRates())) {
    const { rows } = await query(
      `SELECT 1 FROM hosts h
        WHERE h.is_active AND h.${KIND_COLUMN[option.kind]} AND ${FREE_FOR_WINDOW}
        LIMIT 1`,
      [date, timeSlot, durationMin, retryTokenHash],
    );
    if (rows.length) out.push(option);
  }
  return out;
}

/**
 * Checked at checkout: pick a free host for this option, the one with the
 * fewest sessions to come, so work is shared out. Returns them and the option's
 * price. The database's bookings_host_no_overlap constraint is what finally
 * stops two checkouts taking the same host at once.
 */
export async function assignHost(
  kind: HostKind,
  date: string,
  timeSlot: string,
  durationMin: number,
): Promise<{ hostId: number; hourlyCents: number }> {
  const refusal = hostTimingRefusal(date, timeSlot);
  if (refusal) throw new ApiError(400, refusal);
  const option = pricedOptions(await getHostRates()).find((o) => o.kind === kind);
  if (!option) throw new ApiError(409, 'That host option is not available.');
  const { rows } = await query<{ user_id: number }>(
    `SELECT h.user_id FROM hosts h
      WHERE h.is_active AND h.${KIND_COLUMN[kind]} AND ${FREE_FOR_WINDOW}
      ORDER BY (SELECT count(*) FROM bookings s
                 WHERE s.host_id = h.user_id AND s.status <> 'cancelled'
                   AND s.booking_date >= current_date),
               h.display_name
      LIMIT 1`,
    [date, timeSlot, durationMin, null],
  );
  if (!rows[0]) {
    throw new ApiError(409, 'No host is free for this time any more. Please pick another time.');
  }
  return { hostId: rows[0].user_id, hourlyCents: option.hourlyCents };
}

// ---------- The host's own schedule ----------

export interface AvailabilityWindow {
  id: number;
  date: string;
  timeSlot: string;
  durationMin: number;
}

export interface HostSession {
  bookingId: number;
  date: string;
  timeSlot: string;
  durationMin: number;
  tableLabel: string;
  groupName: string;
  groupPhone: string | null;
  partySize: number;
  status: string;
  feeCents: number;
}

export async function getMySchedule(hostId: number): Promise<{
  profile: HostProfile & { isActive: boolean };
  availability: AvailabilityWindow[];
  sessions: HostSession[];
}> {
  const { rows: prof } = await query<HostRow & { is_active: boolean }>(
    `SELECT ${PROFILE_COLUMNS}, h.is_active FROM hosts h WHERE h.user_id = $1`,
    [hostId],
  );
  if (!prof[0]) throw new ApiError(403, 'Hosts only.');
  const { rows: avail } = await query<{
    id: number;
    d: string;
    time_slot: string;
    duration_min: number;
  }>(
    `SELECT id, to_char(avail_date, 'YYYY-MM-DD') AS d, time_slot, duration_min
       FROM host_availability
      WHERE host_id = $1 AND avail_date >= current_date - 1
      ORDER BY avail_date, time_slot`,
    [hostId],
  );
  // Paid or arrived only: a checkout still at the payment page is not a
  // session yet, and its group's details are not the host's to see.
  const { rows: sess } = await query<{
    id: number;
    d: string;
    time_slot: string;
    duration_min: number;
    label: string;
    guest_name: string;
    guest_phone: string | null;
    party_size: number;
    status: string;
    host_fee_cents: number;
  }>(
    `SELECT b.id, to_char(b.booking_date, 'YYYY-MM-DD') AS d, b.time_slot, b.duration_min,
            t.label, b.guest_name, b.guest_phone, b.party_size, b.status, b.host_fee_cents
       FROM bookings b JOIN tables t ON t.id = b.table_id
      WHERE b.host_id = $1 AND b.status NOT IN ('cancelled', 'pending_payment')
        AND b.booking_date >= current_date - 1
      ORDER BY b.booking_date, b.time_slot`,
    [hostId],
  );
  return {
    profile: { ...toProfile(prof[0]), isActive: prof[0].is_active },
    availability: avail.map((a) => ({
      id: a.id,
      date: a.d,
      timeSlot: a.time_slot,
      durationMin: a.duration_min,
    })),
    sessions: sess.map((s) => ({
      bookingId: s.id,
      date: s.d,
      timeSlot: s.time_slot,
      durationMin: s.duration_min,
      tableLabel: s.label,
      groupName: s.guest_name,
      groupPhone: s.guest_phone,
      partySize: s.party_size,
      status: s.status,
      feeCents: s.host_fee_cents,
    })),
  };
}

export async function addAvailability(
  hostId: number,
  date: string,
  timeSlot: string,
  durationMin: number,
): Promise<void> {
  if (!isValidStart(timeSlot)) throw new ApiError(400, 'Pick a start time within opening hours.');
  if (toMinutes(timeSlot) + durationMin > CLOSE_MIN) {
    throw new ApiError(400, 'That runs past closing (3 AM). Pick a shorter window.');
  }
  if (slotStartsAt(date, timeSlot) <= Date.now()) {
    throw new ApiError(400, 'That time has already passed.');
  }
  // Own windows may not overlap: one clean window per stretch of free time.
  const { rows } = await query(
    `SELECT 1 FROM host_availability
      WHERE host_id = $1
        AND booking_window(avail_date, time_slot, duration_min)
            && booking_window($2::date, $3, $4)
      LIMIT 1`,
    [hostId, date, timeSlot, durationMin],
  );
  if (rows.length) throw new ApiError(409, 'That overlaps a time you have already added.');
  try {
    await query(
      `INSERT INTO host_availability (host_id, avail_date, time_slot, duration_min)
       VALUES ($1, $2::date, $3, $4)`,
      [hostId, date, timeSlot, durationMin],
    );
  } catch (err) {
    if ((err as { code?: string }).code === '23503') throw new ApiError(404, 'No such host.');
    throw err;
  }
}

/**
 * Remove a window. Always allowed: a session already booked inside it stays
 * booked (the host is still expected), the time just stops taking new ones.
 */
export async function removeAvailability(hostId: number, id: number): Promise<void> {
  const { rowCount } = await query('DELETE FROM host_availability WHERE id = $1 AND host_id = $2', [
    id,
    hostId,
  ]);
  if (!rowCount) throw new ApiError(404, 'Not found.');
}

// ---------- Admin ----------

export interface AdminHost extends HostProfile {
  email: string;
  isActive: boolean;
}

export async function listHostsForAdmin(): Promise<AdminHost[]> {
  const { rows } = await query<HostRow & { email: string; is_active: boolean }>(
    `SELECT ${PROFILE_COLUMNS}, u.email, h.is_active
       FROM hosts h JOIN users u ON u.id = h.user_id
      ORDER BY h.is_active DESC, h.display_name`,
  );
  return rows.map((r) => ({ ...toProfile(r), email: r.email, isActive: r.is_active }));
}

export interface HostInput {
  displayName: string;
  bio: string;
  photoUrl: string | null;
  /** Left out when saving a board-game host: the option sets the price. */
  hourlyCents?: number;
  offersBoardGames: boolean;
  offersClocktower: boolean;
  offersDnd: boolean;
  isActive: boolean;
}

/** Make an existing account a host (or update one), found by email. */
export async function saveHostByEmail(email: string, h: HostInput): Promise<number> {
  const { rows } = await query<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower($1)', [
    email.trim(),
  ]);
  if (!rows[0]) {
    throw new ApiError(404, 'No account with that email. They must register first.');
  }
  await query(
    `INSERT INTO hosts (user_id, display_name, bio, photo_url, hourly_cents,
                        offers_board_games, offers_dnd, is_active, offers_clocktower)
     VALUES ($1, $2, $3, $4, COALESCE($5::int, 500), $6, $7, $8, $9)
     ON CONFLICT (user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio,
           photo_url = EXCLUDED.photo_url,
           hourly_cents = COALESCE($5::int, hosts.hourly_cents),
           offers_board_games = EXCLUDED.offers_board_games,
           offers_clocktower = EXCLUDED.offers_clocktower,
           offers_dnd = EXCLUDED.offers_dnd, is_active = EXCLUDED.is_active,
           updated_at = now()`,
    [
      rows[0].id,
      h.displayName,
      h.bio,
      h.photoUrl,
      h.hourlyCents ?? null,
      h.offersBoardGames,
      h.offersDnd,
      h.isActive,
      h.offersClocktower,
    ],
  );
  return rows[0].id;
}

/** The host's account email for a booking, for the "you have been booked"
 *  message; null when the booking has no host. */
export async function hostEmailForBooking(
  bookingId: number,
): Promise<{ email: string; name: string } | null> {
  const { rows } = await query<{ email: string; display_name: string }>(
    `SELECT u.email, h.display_name
       FROM bookings b JOIN hosts h ON h.user_id = b.host_id JOIN users u ON u.id = h.user_id
      WHERE b.id = $1`,
    [bookingId],
  );
  return rows[0] ? { email: rows[0].email, name: rows[0].display_name } : null;
}

/**
 * A host's sessions still to come that customers have paid for. By service
 * night, which is the UTC date (the café closes at 03:00 Kuwait, 00:00 UTC), so
 * a removal at 00:30 still catches the 01:00 session.
 */
export async function upcomingSessions(userId: number): Promise<UpcomingSession[]> {
  const { rows } = await query<{
    d: string;
    time_slot: string;
    label: string;
    guest_name: string;
    guest_phone: string | null;
  }>(
    `SELECT to_char(b.booking_date, 'YYYY-MM-DD') AS d, b.time_slot, t.label,
            b.guest_name, b.guest_phone
       FROM bookings b JOIN tables t ON t.id = b.table_id
      WHERE b.host_id = $1 AND b.status NOT IN ('cancelled', 'pending_payment')
        AND b.booking_date >= (now() AT TIME ZONE 'UTC')::date
      ORDER BY b.booking_date, b.time_slot`,
    [userId],
  );
  return rows.map((u) => ({
    date: u.d,
    timeSlot: u.time_slot,
    tableLabel: u.label,
    groupName: u.guest_name,
    groupPhone: u.guest_phone,
  }));
}

export interface UpcomingSession {
  date: string;
  timeSlot: string;
  tableLabel: string;
  groupName: string;
  groupPhone: string | null;
}

/**
 * Remove a host. One who has never been booked is deleted outright, with
 * their free times. One with bookings is switched off instead: those bookings
 * keep the host's name and fee, so the row has to stay — but they disappear
 * from the site and from the booking page all the same.
 */
export async function removeHost(
  userId: number,
): Promise<{ outcome: 'deleted' | 'deactivated'; upcoming: UpcomingSession[] }> {
  const { rows } = await query<{ booked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM bookings WHERE host_id = $1) AS booked
       FROM hosts WHERE user_id = $1`,
    [userId],
  );
  if (!rows[0]) throw new ApiError(404, 'No such host.');
  if (rows[0].booked) {
    await query(
      'UPDATE hosts SET is_active = FALSE, updated_at = now() WHERE user_id = $1',
      [userId],
    );
    // Their future free times go too, so nothing new can be booked.
    await query(
      'DELETE FROM host_availability WHERE host_id = $1 AND avail_date >= current_date',
      [userId],
    );
    // Paid groups still expect this host: the admin has to know, right now.
    return { outcome: 'deactivated', upcoming: await upcomingSessions(userId) };
  }
  await query('DELETE FROM hosts WHERE user_id = $1', [userId]);
  return { outcome: 'deleted', upcoming: [] };
}

/** A host's upcoming free times for the dashboard, each marked if a group
 *  has booked them during it. */
export async function listHostAvailability(
  hostId: number,
): Promise<(AvailabilityWindow & { booked: boolean })[]> {
  const { rows } = await query<{
    id: number;
    d: string;
    time_slot: string;
    duration_min: number;
    booked: boolean;
  }>(
    `SELECT a.id, to_char(a.avail_date, 'YYYY-MM-DD') AS d, a.time_slot, a.duration_min,
            EXISTS (SELECT 1 FROM bookings b
                     WHERE b.host_id = a.host_id AND b.status <> 'cancelled'
                       AND booking_window(b.booking_date, b.time_slot, b.duration_min)
                           && booking_window(a.avail_date, a.time_slot, a.duration_min)) AS booked
       FROM host_availability a
      WHERE a.host_id = $1 AND a.avail_date >= current_date - 1
      ORDER BY a.avail_date, a.time_slot`,
    [hostId],
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.d,
    timeSlot: r.time_slot,
    durationMin: r.duration_min,
    booked: r.booked,
  }));
}

/**
 * Staff delete a free time, always. A session already booked inside it stays
 * booked — the host keeps it — the time just stops taking new bookings.
 */
export async function deleteAvailabilityAsStaff(hostId: number, id: number): Promise<void> {
  const { rowCount } = await query('DELETE FROM host_availability WHERE id = $1 AND host_id = $2', [
    id,
    hostId,
  ]);
  if (!rowCount) throw new ApiError(404, 'Not found.');
}
