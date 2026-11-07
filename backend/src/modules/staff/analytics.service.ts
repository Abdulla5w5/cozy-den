import { query } from '../../db/pool';

export interface CustomerRow {
  /** Stable id for the row: the account, or the guest's phone or email. */
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  visits: number;
  totalCents: number;
  lastVisit: string | null;
}

export type CustomerSort = 'recent' | 'visits';

/**
 * Everyone the café can reach: registered accounts, including a new signup
 * before their first visit, and guests who booked without one. A guest has a
 * phone, or an email on bookings from before phones were required, so that is
 * what groups their bookings. A booking joins an account by its owner, then by
 * email, then by phone. Staff-entered text that is neither ("walk-in") is
 * nobody to contact, so it is left out. Bounded, so the response stays small as
 * the customer base grows.
 */
export async function getCustomers(sort: CustomerSort = 'recent', limit = 200): Promise<CustomerRow[]> {
  const order =
    sort === 'visits' ? 'visits DESC, active DESC NULLS LAST' : 'active DESC NULLS LAST, visits DESC';
  const { rows } = await query<{
    key: string;
    name: string;
    email: string | null;
    phone: string | null;
    visits: string;
    total_cents: string;
    last_visit: string | null;
  }>(
    `WITH phone_owner AS (
       SELECT DISTINCT ON (phone) id, phone FROM users WHERE phone IS NOT NULL ORDER BY phone, id
     ),
     counted AS (
       SELECT b.total_cents + b.counter_cents AS total_cents, b.booking_date, b.created_at, b.guest_name, b.guest_email, b.guest_phone,
              COALESCE(b.user_id, by_email.id, by_phone.id) AS user_id
         FROM bookings b
         LEFT JOIN users by_email ON by_email.email = lower(b.guest_email)
         LEFT JOIN phone_owner by_phone ON by_phone.phone = b.guest_phone
        WHERE b.status NOT IN ('cancelled', 'pending_payment') AND b.source <> 'event'
     ),
     accounts AS (
       SELECT 'u' || u.id AS key,
              u.name,
              u.email,
              COALESCE(u.phone, (array_agg(c.guest_phone ORDER BY c.created_at DESC)
                                  FILTER (WHERE c.guest_phone IS NOT NULL))[1]) AS phone,
              count(c.user_id) AS visits,
              coalesce(sum(c.total_cents), 0) AS total_cents,
              max(c.booking_date) AS last_date,
              GREATEST(u.created_at, max(c.created_at)) AS active
         FROM users u
         LEFT JOIN counted c ON c.user_id = u.id
        WHERE NOT u.is_staff
        GROUP BY u.id
     ),
     guests AS (
       SELECT COALESCE('p' || guest_phone, 'e' || lower(guest_email)) AS key,
              (array_agg(guest_name ORDER BY created_at DESC))[1] AS name,
              (array_agg(guest_email ORDER BY created_at DESC)
                FILTER (WHERE guest_email IS NOT NULL))[1] AS email,
              max(guest_phone) AS phone,
              count(*) AS visits,
              coalesce(sum(total_cents), 0) AS total_cents,
              max(booking_date) AS last_date,
              max(created_at) AS active
         FROM counted
        WHERE user_id IS NULL AND (guest_phone IS NOT NULL OR guest_email LIKE '%@%')
        GROUP BY 1
     )
     SELECT key, name, email, phone, visits, total_cents,
            to_char(last_date, 'YYYY-MM-DD') AS last_visit
       FROM (SELECT * FROM accounts UNION ALL SELECT * FROM guests) everyone
      ORDER BY ${order}
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    email: r.email,
    phone: r.phone,
    visits: parseInt(r.visits, 10),
    totalCents: parseInt(r.total_cents, 10),
    lastVisit: r.last_visit,
  }));
}

export interface MonthlyAnalytics {
  month: string; // 'YYYY-MM'
  bookingsCount: number;
  /** Online payments plus money taken by hand. */
  revenueCents: number;
  /** The part of revenue taken by hand at the counter. */
  counterCents: number;
  popularGames: { title: string; bookings: number }[];
  peakSlots: { timeSlot: string; bookings: number }[];
  tableUtilization: { label: string; capacity: number; bookings: number }[];
}

/**
 * Basic monthly aggregates. `month` is 'YYYY-MM'; we bound the range to that
 * calendar month. Counted: real bookings only — not cancelled ones, not
 * checkouts still waiting on payment (or abandoned there), and not the table
 * holds events write (source 'event'), which carry no revenue of their own.
 */
export async function getMonthlyAnalytics(month: string): Promise<MonthlyAnalytics> {
  // Range: [first day of month, first day of next month)
  const start = `${month}-01`;

  const totals = (
    await query<{ bookings_count: string; revenue_cents: string | null; counter_cents: string | null }>(
      `SELECT COUNT(*) AS bookings_count,
              COALESCE(SUM(total_cents + counter_cents), 0) AS revenue_cents,
              COALESCE(SUM(counter_cents), 0) AS counter_cents
         FROM bookings
        WHERE status NOT IN ('cancelled', 'pending_payment') AND source <> 'event'
          AND booking_date >= $1::date
          AND booking_date < ($1::date + INTERVAL '1 month')`,
      [start]
    )
  ).rows[0];

  const popularGames = (
    await query<{ title: string; bookings: string }>(
      `SELECT g.title, COUNT(*) AS bookings
         FROM bookings b
         JOIN games g ON g.id = b.game_id
        WHERE b.status NOT IN ('cancelled', 'pending_payment') AND b.source <> 'event'
          AND b.booking_date >= $1::date
          AND b.booking_date < ($1::date + INTERVAL '1 month')
        GROUP BY g.title
        ORDER BY bookings DESC, g.title
        LIMIT 5`,
      [start]
    )
  ).rows;

  const peakSlots = (
    await query<{ time_slot: string; bookings: string }>(
      `SELECT time_slot, COUNT(*) AS bookings
         FROM bookings
        WHERE status NOT IN ('cancelled', 'pending_payment') AND source <> 'event'
          AND booking_date >= $1::date
          AND booking_date < ($1::date + INTERVAL '1 month')
        GROUP BY time_slot
        ORDER BY bookings DESC, time_slot`,
      [start]
    )
  ).rows;

  const tableUtilization = (
    await query<{ label: string; capacity: number; bookings: string }>(
      // Retired tables keep their rows so old bookings still name the table
      // they were on, but a table that is no longer on the floor and took no
      // bookings this month is just a dead name padding the list. Kept only
      // where the month actually used it, so history stays honest.
      `SELECT t.label, t.capacity, COUNT(b.id) AS bookings
         FROM tables t
         LEFT JOIN bookings b
           ON b.table_id = t.id
          AND b.status NOT IN ('cancelled', 'pending_payment') AND b.source <> 'event'
          AND b.booking_date >= $1::date
          AND b.booking_date < ($1::date + INTERVAL '1 month')
        GROUP BY t.id, t.label, t.capacity, t.is_active
        HAVING t.is_active OR COUNT(b.id) > 0
        ORDER BY bookings DESC, t.capacity`,
      [start]
    )
  ).rows;

  return {
    month,
    bookingsCount: parseInt(totals.bookings_count, 10),
    counterCents: parseInt(totals.counter_cents ?? '0', 10),
    revenueCents: parseInt(totals.revenue_cents ?? '0', 10),
    popularGames: popularGames.map((r) => ({ title: r.title, bookings: parseInt(r.bookings, 10) })),
    peakSlots: peakSlots.map((r) => ({ timeSlot: r.time_slot, bookings: parseInt(r.bookings, 10) })),
    tableUtilization: tableUtilization.map((r) => ({
      label: r.label,
      capacity: r.capacity,
      bookings: parseInt(r.bookings, 10),
    })),
  };
}
