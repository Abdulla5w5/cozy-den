import { pool, query } from '../../db/pool';
import { getRates, blockCentsForDays, type Rates } from '../../utils/pricing';
import { paymentProvider } from '../../payment';
import { ApiError } from '../../middleware/error';

/**
 * The Wanted Board.
 *
 * Two rules carry the whole feature, so they are enforced here rather than in
 * the UI:
 *
 *  1. ACKNOWLEDGMENT. A poster is promising to know the game and teach it. The
 *     API refuses a post without it and the table has a CHECK constraint, so a
 *     browser that skips the checkbox gains nothing.
 *
 *  2. VISIBILITY. The public board exposes a COUNT of interested members and
 *     nothing else — no names, no contact details, not even who posted. Only
 *     staff see identities. The two are separate functions returning separate
 *     shapes so that a public response cannot accidentally carry identity: the
 *     public query never selects those columns at all.
 *
 * Nothing is scheduled automatically. A filled post is handed to staff, who
 * contact people and arrange the session themselves.
 */

export type SessionType = 'males_only' | 'females_only' | 'open';
export type PostStatus = 'pending' | 'open' | 'completed' | 'rejected';

export interface PublicPost {
  /** Session length in minutes, and what reserving it costs. */
  durationMin?: number;
  /** What one seat on this listing costs. A member pays this per seat taken. */
  perPlayerCents?: number;
  /** Seats sold or held, and seats still going. */
  seatsTaken?: number;
  seatsLeft?: number;
  id: number;
  gameId: number | null;
  gameTitle: string;
  minPlayers: number;
  maxPlayers: number;
  sessionType: SessionType;
  /** The exact day the session is for (YYYY-MM-DD). Null on posts made before
   *  listings carried a date. */
  sessionDate: string | null;
  preferredDays: number[];
  status: PostStatus;
  interestCount: number;
  createdAt: string;
}

export interface CreatePostInput {
  /** 2, 4 or 6 hours, matching the table-booking blocks. */
  durationMin?: number;
  gameId?: number | null;
  gameName?: string | null;
  minPlayers: number;
  maxPlayers: number;
  sessionType: SessionType;
  /** YYYY-MM-DD. A listing is a one-off, so it names the actual date. */
  sessionDate: string;
  acknowledgmentConfirmed: boolean;
}

// Public projection. Deliberately selects no member identity of any kind.
const PUBLIC_SELECT = `
  SELECT p.id, p.game_id, COALESCE(g.title, p.game_name) AS game_title,
         p.duration_min,
         COALESCE((SELECT sum(s.seats) FROM wanted_post_seats s
                    WHERE s.post_id = p.id), 0) AS seats_taken,
         p.min_players, p.max_players, p.session_type,
         p.preferred_days, p.session_date, p.status, p.created_at,
         (SELECT count(*) FROM wanted_post_interests i WHERE i.post_id = p.id) AS interest_count
    FROM wanted_posts p
    LEFT JOIN games g ON g.id = p.game_id`;

interface PublicRow {
  id: number;
  duration_min: number;
  seats_taken: string;
  game_id: number | null;
  game_title: string;
  min_players: number;
  max_players: number;
  session_type: SessionType;
  preferred_days: number[];
  session_date: string | Date | null;
  status: PostStatus;
  created_at: Date;
  interest_count: string;
}

/**
 * node-postgres hands back a Date for DATE columns, built at LOCAL midnight.
 * Formatting it through toISOString() would shift it a day in any timezone west
 * of UTC, so the calendar parts are read directly.
 */
function toDateString(v: string | Date | null): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
}

function toPublic(r: PublicRow, rates: Rates): PublicPost {
  // Whole 2/4/6-hour blocks, same as a table booking, and priced the same way:
  // per seat, by the listing's date rather than the day it is viewed on. Seats
  // are bought individually, so this is what ONE player pays.
  const blocks = Math.max(1, Math.ceil((r.duration_min || 120) / 120));
  const perSeatCents = blockCentsForDays(r.preferred_days, rates) * blocks;
  const taken = Number(r.seats_taken);
  return {
    id: r.id,
    durationMin: r.duration_min,
    perPlayerCents: perSeatCents,
    seatsTaken: taken,
    seatsLeft: Math.max(0, r.max_players - taken),
    gameId: r.game_id,
    gameTitle: r.game_title,
    minPlayers: r.min_players,
    maxPlayers: r.max_players,
    sessionType: r.session_type,
    sessionDate: toDateString(r.session_date),
    preferredDays: r.preferred_days,
    status: r.status,
    interestCount: Number(r.interest_count),
    createdAt: r.created_at.toISOString(),
  };
}

/** Create a post. Held as 'pending' until staff approve it. */
export async function createPost(memberId: number, input: CreatePostInput): Promise<PublicPost> {
  // Rule 1. Never trust the client's checkbox.
  if (input.acknowledgmentConfirmed !== true) {
    throw new ApiError(
      400,
      'You must confirm that you know this game and will lead the session before posting.',
    );
  }
  if (input.maxPlayers < input.minPlayers) {
    throw new ApiError(400, 'Maximum players cannot be lower than minimum players.');
  }
  // One exact date, and never one that has already passed.
  const sessionDate = input.sessionDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate ?? '')) {
    throw new ApiError(400, 'Pick the date you want to play on.');
  }
  const day = new Date(`${sessionDate}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) throw new ApiError(400, 'That date is not a real date.');
  if (sessionDate < new Date().toISOString().slice(0, 10)) {
    throw new ApiError(400, 'That date has already passed.');
  }
  if (!input.gameId && !input.gameName?.trim()) {
    throw new ApiError(400, 'Pick a game from the library or type its name.');
  }
  if (input.gameId) {
    const { rows } = await query('SELECT id FROM games WHERE id = $1', [input.gameId]);
    if (!rows[0]) throw new ApiError(404, 'That game is not in the library.');
  }

  const { rows } = await query<{ id: number }>(
    `INSERT INTO wanted_posts
       (member_id, game_id, game_name, min_players, max_players,
        session_type, preferred_days, session_date,
        acknowledgment_confirmed, duration_min)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9)
     RETURNING id`,
    [
      memberId,
      input.gameId ?? null,
      input.gameId ? null : input.gameName!.trim(),
      input.minPlayers,
      input.maxPlayers,
      input.sessionType,
      // Derived, never sent by the client, so the weekday used for pricing
      // always matches the date the listing is for.
      [day.getUTCDay()],
      sessionDate,
      input.durationMin ?? 120,
    ],
  );
  const post = await getPublicPost(rows[0].id);
  if (!post) throw new ApiError(500, 'Post vanished after creation.');
  return post;
}

export async function getPublicPost(id: number): Promise<PublicPost | null> {
  const { rows } = await query<PublicRow>(`${PUBLIC_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ? toPublic(rows[0], await getRates()) : null;
}

/** The public board: approved posts only, identity-free. */
export async function listPublicPosts(): Promise<PublicPost[]> {
  const { rows } = await query<PublicRow>(
    `${PUBLIC_SELECT}
      WHERE p.status IN ('open', 'completed')
      ORDER BY CASE p.status WHEN 'open' THEN 0 ELSE 1 END, p.created_at DESC`,
  );
  const rates = await getRates();
  return rows.map((r) => toPublic(r, rates));
}

/** A member's own posts, including ones still awaiting approval. */
export async function listMyPosts(memberId: number): Promise<PublicPost[]> {
  const { rows } = await query<PublicRow>(
    `${PUBLIC_SELECT} WHERE p.member_id = $1 ORDER BY p.created_at DESC`,
    [memberId],
  );
  const rates = await getRates();
  return rows.map((r) => toPublic(r, rates));
}

/** Post ids this member has already registered interest in (to drive the UI). */
export async function myInterestPostIds(memberId: number): Promise<number[]> {
  const { rows } = await query<{ post_id: number }>(
    'SELECT post_id FROM wanted_post_interests WHERE member_id = $1',
    [memberId],
  );
  return rows.map((r) => r.post_id);
}

/**
 * Register interest. Locks the post row so two members registering at the same
 * moment cannot both slip past the capacity check; the post auto-completes on
 * reaching max_players and accepts nothing further.
 */
export async function registerInterest(
  postId: number,
  member: { id: number; name: string; email: string },
): Promise<{ interestCount: number; status: PostStatus }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: postRows } = await client.query<{
      id: number;
      member_id: number;
      status: PostStatus;
      max_players: number;
    }>('SELECT id, member_id, status, max_players FROM wanted_posts WHERE id = $1 FOR UPDATE', [
      postId,
    ]);
    const post = postRows[0];
    if (!post) throw new ApiError(404, 'Post not found.');
    if (post.status === 'pending') throw new ApiError(409, 'This post is awaiting staff approval.');
    if (post.status !== 'open') throw new ApiError(409, 'This post is no longer accepting players.');
    if (post.member_id === member.id) {
      throw new ApiError(409, 'You posted this — you are already counted.');
    }

    try {
      await client.query(
        `INSERT INTO wanted_post_interests (post_id, member_id, contact_snapshot)
         VALUES ($1, $2, $3)`,
        [postId, member.id, `${member.name} <${member.email}>`],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ApiError(409, 'You have already registered interest in this post.');
      }
      throw err;
    }

    const { rows: countRows } = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM wanted_post_interests WHERE post_id = $1',
      [postId],
    );
    const count = Number(countRows[0].n);

    // Fills at max_players, per the client's decision.
    let status: PostStatus = post.status;
    if (count >= post.max_players) {
      await client.query(`UPDATE wanted_posts SET status = 'completed' WHERE id = $1`, [postId]);
      status = 'completed';
    }
    await client.query('COMMIT');
    return { interestCount: count, status };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Staff-only views ----------

export interface StaffPost extends PublicPost {
  posterName: string;
  posterEmail: string;
  interested: { name: string; contact: string; registeredAt: string }[];
  /** Who actually bought seats, and how many. Staff need this to run the
   *  session; the public board never sees it. */
  seatBuyers: { name: string; contact: string; seats: number; paid: boolean }[];
}

/** Full detail including identities — staff routes only. */
export async function listPostsForStaff(status?: PostStatus): Promise<StaffPost[]> {
  const { rows } = await query<PublicRow & { poster_name: string; poster_email: string }>(
    `SELECT p.id, p.game_id, COALESCE(g.title, p.game_name) AS game_title,
            p.duration_min,
            COALESCE((SELECT sum(s.seats) FROM wanted_post_seats s
                       WHERE s.post_id = p.id), 0) AS seats_taken,
            p.min_players, p.max_players, p.session_type,
            p.preferred_days, p.session_date, p.status, p.created_at,
            (SELECT count(*) FROM wanted_post_interests i WHERE i.post_id = p.id)
              AS interest_count,
            u.name AS poster_name, u.email AS poster_email
       FROM wanted_posts p
       LEFT JOIN games g ON g.id = p.game_id
       JOIN users u ON u.id = p.member_id
      WHERE ($1::text IS NULL OR p.status = $1)
      ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
               p.created_at DESC`,
    [status ?? null],
  );
  if (rows.length === 0) return [];

  const { rows: interests } = await query<{
    post_id: number;
    name: string;
    contact_snapshot: string;
    created_at: Date;
  }>(
    `SELECT i.post_id, u.name, i.contact_snapshot, i.created_at
       FROM wanted_post_interests i
       JOIN users u ON u.id = i.member_id
      WHERE i.post_id = ANY($1::int[])
      ORDER BY i.created_at`,
    [rows.map((r) => r.id)],
  );
  const byPost = new Map<number, StaffPost['interested']>();
  for (const i of interests) {
    const list = byPost.get(i.post_id) ?? [];
    list.push({
      name: i.name,
      contact: i.contact_snapshot,
      registeredAt: i.created_at.toISOString(),
    });
    byPost.set(i.post_id, list);
  }

  const { rows: seatRows } = await query<{
    post_id: number;
    name: string;
    email: string;
    seats: number;
    payment_state: string;
  }>(
    `SELECT s.post_id, u.name, u.email, s.seats, s.payment_state
       FROM wanted_post_seats s
       JOIN users u ON u.id = s.member_id
      WHERE s.post_id = ANY($1::int[])
      ORDER BY s.created_at`,
    [rows.map((r) => r.id)],
  );
  const seatsByPost = new Map<number, StaffPost['seatBuyers']>();
  for (const b of seatRows) {
    const list = seatsByPost.get(b.post_id) ?? [];
    list.push({
      name: b.name,
      contact: b.email,
      seats: b.seats,
      paid: b.payment_state === 'paid',
    });
    seatsByPost.set(b.post_id, list);
  }

  const rates = await getRates();
  return rows.map((r) => ({
    ...toPublic(r, rates),
    posterName: r.poster_name,
    posterEmail: r.poster_email,
    interested: byPost.get(r.id) ?? [],
    seatBuyers: seatsByPost.get(r.id) ?? [],
  }));
}

/** Staff approval gate: 'pending' -> 'open' (published) or 'rejected' (hidden). */
export async function moderatePost(id: number, decision: 'approve' | 'reject'): Promise<PublicPost> {
  const next: PostStatus = decision === 'approve' ? 'open' : 'rejected';
  const { rowCount } = await query(
    `UPDATE wanted_posts SET status = $2 WHERE id = $1 AND status = 'pending'`,
    [id, next],
  );
  if (!rowCount) throw new ApiError(409, 'That post is not awaiting approval.');
  const post = await getPublicPost(id);
  if (!post) throw new ApiError(404, 'Post not found.');
  return post;
}

/**
 * Permanently remove one post. Its interest rows and seat rows are removed by
 * the database's ON DELETE CASCADE foreign keys, keeping the operation atomic
 * even if a post has many of either.
 *
 * A listing somebody has PAID for is refused, because deleting it would destroy
 * the only record that the money was taken while doing nothing about the money
 * itself. Staff refund first, and the listing can go once no paid seat remains.
 */
export async function deletePost(id: number): Promise<void> {
  const { rows } = await query<{ seats: string }>(
    `SELECT COALESCE(sum(seats), 0)::text AS seats
       FROM wanted_post_seats WHERE post_id = $1 AND payment_state = 'paid'`,
    [id],
  );
  if (Number(rows[0].seats) > 0) {
    throw new ApiError(
      409,
      'Players have paid for seats on this listing. Refund them first — deleting it ' +
        'would remove the record of their payment.',
    );
  }
  const { rowCount } = await query('DELETE FROM wanted_posts WHERE id = $1', [id]);
  if (!rowCount) throw new ApiError(404, 'Post not found.');
}

// ---------- Reserving a listing ----------
/**
 * Seats, not tables.
 *
 * A listing holds max_players seats and they are sold one at a time: a member
 * buys the seats they are actually taking, the listing counts down, and it
 * completes when the last seat goes. A held seat already counts as gone, so two
 * people cannot buy the last one twice.
 *
 * Price comes from the post — its length and its date — never from the request,
 * so a tampered client cannot buy a six-hour seat at the two-hour price. The
 * only thing the client chooses is HOW MANY seats, and that is checked against
 * what is left.
 */
export async function perSeatCentsFor(postId: number): Promise<{
  durationMin: number;
  perSeatCents: number;
  seatsLeft: number;
  maxPlayers: number;
}> {
  const { rows } = await query<{
    duration_min: number;
    preferred_days: number[];
    max_players: number;
    taken: string;
  }>(
    `SELECT p.duration_min, p.preferred_days, p.max_players,
            COALESCE((SELECT sum(s.seats) FROM wanted_post_seats s
                       WHERE s.post_id = p.id), 0) AS taken
       FROM wanted_posts p WHERE p.id = $1`,
    [postId],
  );
  if (!rows[0]) throw new ApiError(404, 'Post not found.');
  const blocks = Math.max(1, Math.ceil(rows[0].duration_min / 120));
  return {
    durationMin: rows[0].duration_min,
    // Priced by the listing's own day rather than whenever it happens to be
    // reserved, so the price the board quotes and the price charged agree.
    perSeatCents: blockCentsForDays(rows[0].preferred_days, await getRates()) * blocks,
    seatsLeft: Math.max(0, rows[0].max_players - Number(rows[0].taken)),
    maxPlayers: rows[0].max_players,
  };
}

export interface SeatHold {
  /** The seat row's id. Everything downstream — the charge metadata, the sweep,
   *  the release — refers to the HOLD, not to the post. */
  holdId: number;
  amountCents: number;
  seats: number;
}

/**
 * Take `seats` seats on this listing for this member.
 *
 * The post row is locked for the duration so the count of seats already sold
 * cannot move under us: two members buying the last seat at the same moment
 * are serialised, and the second one is told it has gone.
 */
/**
 * Clear this member's OWN abandoned holds on this listing before counting what
 * is left. A member whose payment page died is otherwise blocked by their own
 * held seats — on a listing with one seat going, by exactly the seat they were
 * trying to buy. The charge is re-asked of the gateway first, so a payment that
 * did go through is settled rather than thrown away.
 */
async function clearOwnAbandonedHolds(postId: number, memberId: number): Promise<void> {
  const { rows } = await query<{ id: number; payment_ref: string | null }>(
    `SELECT id, payment_ref FROM wanted_post_seats
      WHERE post_id = $1 AND member_id = $2 AND payment_state = 'pending_payment'`,
    [postId, memberId],
  );
  for (const row of rows) {
    if (row.payment_ref?.startsWith('chg_') && paymentProvider.retrieveCharge) {
      try {
        if ((await finalizeListingCharge(row.payment_ref)) === 'paid') continue;
      } catch (err) {
        console.error('[wanted] could not re-check an abandoned charge', err);
      }
    }
    await releaseListing(row.id);
  }
}

export async function holdSeats(
  postId: number,
  memberId: number,
  seats: number,
): Promise<SeatHold> {
  await clearOwnAbandonedHolds(postId, memberId);
  // Read the rates BEFORE taking a client. getRates() goes to the pool for a
  // client of its own, and asking for one while already holding one deadlocks
  // the pool the moment there are as many concurrent buyers as there are
  // clients: every transaction sits on a client waiting for a client.
  const rates = await getRates();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: postRows } = await client.query<{
      status: PostStatus;
      duration_min: number;
      preferred_days: number[];
      max_players: number;
    }>(
      `SELECT status, duration_min, preferred_days, max_players
         FROM wanted_posts WHERE id = $1 FOR UPDATE`,
      [postId],
    );
    const post = postRows[0];
    if (!post) throw new ApiError(404, 'Post not found.');
    if (post.status !== 'open') throw new ApiError(409, 'This listing is not taking players.');

    const { rows: takenRows } = await client.query<{ taken: string }>(
      `SELECT COALESCE(sum(seats), 0)::text AS taken
         FROM wanted_post_seats WHERE post_id = $1`,
      [postId],
    );
    const left = post.max_players - Number(takenRows[0].taken);
    if (left <= 0) throw new ApiError(409, 'This listing is full.');
    if (seats > left) {
      throw new ApiError(409, `Only ${left} seat${left === 1 ? '' : 's'} left on this listing.`);
    }

    const blocks = Math.max(1, Math.ceil(post.duration_min / 120));
    const perSeat = blockCentsForDays(post.preferred_days, rates) * blocks;
    const amountCents = perSeat * seats;

    const { rows: held } = await client.query<{ id: number }>(
      `INSERT INTO wanted_post_seats
         (post_id, member_id, seats, amount_cents, payment_state)
       VALUES ($1, $2, $3, $4, 'pending_payment')
       RETURNING id`,
      [postId, memberId, seats, amountCents],
    );
    await client.query('COMMIT');
    return { holdId: held[0].id, amountCents, seats };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Payment failed or was abandoned — the seats go back on the board. */
export async function releaseListing(holdId: number): Promise<void> {
  await query(`DELETE FROM wanted_post_seats WHERE id = $1 AND payment_state = 'pending_payment'`, [
    holdId,
  ]);
}

/**
 * The money arrived; the seats are sold. A listing whose last seat has just
 * gone is completed in the same transaction, so the board never shows a full
 * listing as still open.
 */
export async function confirmListing(holdId: number, paymentRef: string): Promise<void> {
  const { rows } = await query<{ post_id: number }>(
    `UPDATE wanted_post_seats SET payment_state = 'paid', payment_ref = $2
      WHERE id = $1 AND payment_state = 'pending_payment'
      RETURNING post_id`,
    [holdId, paymentRef],
  );
  if (!rows[0]) return;
  await query(
    `UPDATE wanted_posts p
        SET status = 'completed'
      WHERE p.id = $1 AND p.status = 'open'
        AND (SELECT COALESCE(sum(s.seats), 0) FROM wanted_post_seats s
              WHERE s.post_id = p.id AND s.payment_state = 'paid') >= p.max_players`,
    [rows[0].post_id],
  );
}

/**
 * Record the gateway charge against the held seats, at the moment the charge is
 * opened. Without it the sweep would have nothing to ask Tap about and could
 * only release by age, taking seats away from someone who had paid.
 */
export async function attachListingCharge(holdId: number, chargeId: string): Promise<void> {
  await query(
    `UPDATE wanted_post_seats SET payment_ref = $2
      WHERE id = $1 AND payment_state = 'pending_payment'`,
    [holdId, chargeId],
  );
}

/**
 * Settle a seat charge from the gateway's own answer. Shared by the return, the
 * webhook and the sweep; the charge is always re-retrieved, never believed.
 */
export async function finalizeListingCharge(
  chargeId: string,
): Promise<'paid' | 'failed' | 'pending'> {
  if (!paymentProvider.retrieveCharge) return 'failed';
  const charge = await paymentProvider.retrieveCharge(chargeId);
  const holdId = Number(charge.metadata?.holdId ?? 0);
  if (!holdId) return 'failed';
  if (charge.paid) {
    await confirmListing(holdId, chargeId);
    return 'paid';
  }
  // Only a declined charge frees the seats. An unfinished one leaves them held
  // until the age check decides it was abandoned.
  if (charge.failed) {
    await releaseListing(holdId);
    return 'failed';
  }
  return 'pending';
}

/** Seat holds old enough to be worth re-checking, oldest first. */
export async function listStaleListingHolds(
  staleAfterMin: number,
  expiryMin: number,
  limit: number,
): Promise<{ id: number; paymentRef: string | null; expirable: boolean }[]> {
  const { rows } = await query<{ id: number; payment_ref: string | null; expirable: boolean }>(
    `SELECT id, payment_ref,
            created_at < now() - ($2 || ' minutes')::interval AS expirable
       FROM wanted_post_seats
      WHERE payment_state = 'pending_payment'
        AND created_at < now() - ($1 || ' minutes')::interval
      ORDER BY created_at
      LIMIT ${limit}`,
    [String(staleAfterMin), String(expiryMin)],
  );
  return rows.map((r) => ({ id: r.id, paymentRef: r.payment_ref, expirable: r.expirable }));
}
