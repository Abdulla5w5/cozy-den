import { query } from '../../db/pool';

export interface CustomerRow {
  name: string;
  email: string;
  visits: number;
  totalCents: number;
  lastVisit: string;
}

/**
 * Recurrent customers across all time — grouped by email, most-visits first.
 * Gives the counter/sales a contact list (name + email) for events & offers.
 */
export async function getRecurrentCustomers(limit = 200): Promise<CustomerRow[]> {
  const { rows } = await query<{
    name: string;
    email: string;
    visits: string;
    total_cents: string;
    last_visit: string;
  }>(
    `SELECT max(guest_name) AS name,
            guest_email     AS email,
            count(*)        AS visits,
            coalesce(sum(total_cents), 0) AS total_cents,
            to_char(max(booking_date), 'YYYY-MM-DD') AS last_visit
       FROM bookings
      WHERE status <> 'cancelled'
      GROUP BY guest_email
      ORDER BY visits DESC, total_cents DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    name: r.name,
    email: r.email,
    visits: parseInt(r.visits, 10),
    totalCents: parseInt(r.total_cents, 10),
    lastVisit: r.last_visit,
  }));
}

export interface MonthlyAnalytics {
  month: string; // 'YYYY-MM'
  bookingsCount: number;
  revenueCents: number;
  popularGames: { title: string; bookings: number }[];
  peakSlots: { timeSlot: string; bookings: number }[];
  tableUtilization: { label: string; capacity: number; bookings: number }[];
}

/**
 * Basic monthly aggregates. `month` is 'YYYY-MM'; we bound the range to that
 * calendar month. Cancelled bookings are excluded from every metric.
 */
export async function getMonthlyAnalytics(month: string): Promise<MonthlyAnalytics> {
  // Range: [first day of month, first day of next month)
  const start = `${month}-01`;

  const totals = (
    await query<{ bookings_count: string; revenue_cents: string | null }>(
      `SELECT COUNT(*) AS bookings_count, COALESCE(SUM(total_cents), 0) AS revenue_cents
         FROM bookings
        WHERE status <> 'cancelled'
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
        WHERE b.status <> 'cancelled'
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
        WHERE status <> 'cancelled'
          AND booking_date >= $1::date
          AND booking_date < ($1::date + INTERVAL '1 month')
        GROUP BY time_slot
        ORDER BY bookings DESC, time_slot`,
      [start]
    )
  ).rows;

  const tableUtilization = (
    await query<{ label: string; capacity: number; bookings: string }>(
      `SELECT t.label, t.capacity, COUNT(b.id) AS bookings
         FROM tables t
         LEFT JOIN bookings b
           ON b.table_id = t.id
          AND b.status <> 'cancelled'
          AND b.booking_date >= $1::date
          AND b.booking_date < ($1::date + INTERVAL '1 month')
        GROUP BY t.id, t.label, t.capacity
        ORDER BY bookings DESC, t.capacity`,
      [start]
    )
  ).rows;

  return {
    month,
    bookingsCount: parseInt(totals.bookings_count, 10),
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
