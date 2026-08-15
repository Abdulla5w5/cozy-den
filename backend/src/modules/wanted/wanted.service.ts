import { pool, query } from '../../db/pool';
import { getTableFee } from '../../utils/pricing';
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
  /** Price to reserve this listing now, quoted from its length at today's
   *  block rate. Present on every listing so the board can show it before
   *  anyone has reserved; amountCents only fills in once a reservation exists. */
  reserveCents?: number;
  amountCents?: number;
  paymentState?: 'none' | 'pending_payment' | 'paid';
  reservedBy?: number | null;
  id: number;
  gameId: number | null;
  gameTitle: string;
  minPlayers: number;
  maxPlayers: number;
  sessionType: SessionType;
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
  preferredDays: number[];
  acknowledgmentConfirmed: boolean;
}

// Public projection. Deliberately selects no member identity of any kind.
const PUBLIC_SELECT = `
  SELECT p.id, p.game_id, COALESCE(g.title, p.game_name) AS game_title,
         p.duration_min, p.amount_cents, p.payment_state, p.reserved_by,
         p.min_players, p.max_players, p.session_type,
         p.preferred_days, p.status, p.created_at,
         (SELECT count(*) FROM wanted_post_interests i WHERE i.post_id = p.id) AS interest_count
    FROM wanted_posts p
    LEFT JOIN games g ON g.id = p.game_id`;

interface PublicRow {
  id: number;
  duration_min: number;
  amount_cents: number;
  payment_state: 'none' | 'pending_payment' | 'paid';
  reserved_by: number | null;
  game_id: number | null;
  game_title: string;
  min_players: number;
  max_players: number;
  session_type: SessionType;
  preferred_days: number[];
  status: PostStatus;
  created_at: Date;
  interest_count: string;
}

/** Today's price for one 2-hour block, the basis for every listing quote. */
async function todayBlockCents(): Promise<number> {
  return (await getTableFee(new Date().toISOString().slice(0, 10))).cents;
}

function toPublic(r: PublicRow, blockCents: number): PublicPost {
  // Whole 2/4/6-hour blocks, same as a table booking; whoever reserves pays all.
  const blocks = Math.max(1, Math.ceil((r.duration_min || 120) / 120));
  return {
    id: r.id,
    durationMin: r.duration_min,
    reserveCents: r.payment_state === 'none' ? blockCents * blocks : r.amount_cents,
    amountCents: r.amount_cents,
    paymentState: r.payment_state,
    reservedBy: r.reserved_by,
    gameId: r.game_id,
    gameTitle: r.game_title,
    minPlayers: r.min_players,
    maxPlayers: r.max_players,
    sessionType: r.session_type,
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
        session_type, preferred_days, acknowledgment_confirmed, duration_min)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)
     RETURNING id`,
    [
      memberId,
      input.gameId ?? null,
      input.gameId ? null : input.gameName!.trim(),
      input.minPlayers,
      input.maxPlayers,
      input.sessionType,
      input.preferredDays,
      input.durationMin ?? 120,
    ],
  );
  const post = await getPublicPost(rows[0].id);
  if (!post) throw new ApiError(500, 'Post vanished after creation.');
  return post;
}

export async function getPublicPost(id: number): Promise<PublicPost | null> {
  const { rows } = await query<PublicRow>(`${PUBLIC_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ? toPublic(rows[0], await todayBlockCents()) : null;
}

/** The public board: approved posts only, identity-free. */
export async function listPublicPosts(): Promise<PublicPost[]> {
  const { rows } = await query<PublicRow>(
    `${PUBLIC_SELECT}
      WHERE p.status IN ('open', 'completed')
      ORDER BY CASE p.status WHEN 'open' THEN 0 ELSE 1 END, p.created_at DESC`,
  );
  const blockCents = await todayBlockCents();
  return rows.map((r) => toPublic(r, blockCents));
}

/** A member's own posts, including ones still awaiting approval. */
export async function listMyPosts(memberId: number): Promise<PublicPost[]> {
  const { rows } = await query<PublicRow>(
    `${PUBLIC_SELECT} WHERE p.member_id = $1 ORDER BY p.created_at DESC`,
    [memberId],
  );
  const blockCents = await todayBlockCents();
  return rows.map((r) => toPublic(r, blockCents));
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
}

/** Full detail including identities — staff routes only. */
export async function listPostsForStaff(status?: PostStatus): Promise<StaffPost[]> {
  const { rows } = await query<PublicRow & { poster_name: string; poster_email: string }>(
    `SELECT p.id, p.game_id, COALESCE(g.title, p.game_name) AS game_title,
            p.duration_min, p.amount_cents, p.payment_state, p.reserved_by,
            ru.name AS reserved_by_name, ru.phone AS reserved_by_phone,
            p.min_players, p.max_players, p.session_type,
            p.preferred_days, p.status, p.created_at,
            (SELECT count(*) FROM wanted_post_interests i WHERE i.post_id = p.id)
              AS interest_count,
            u.name AS poster_name, u.email AS poster_email
       FROM wanted_posts p
       LEFT JOIN games g ON g.id = p.game_id
       JOIN users u ON u.id = p.member_id
       LEFT JOIN users ru ON ru.id = p.reserved_by
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

  const blockCents = await todayBlockCents();
  return rows.map((r) => ({
    ...toPublic(r, blockCents),
    posterName: r.poster_name,
    posterEmail: r.poster_email,
    interested: byPost.get(r.id) ?? [],
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
 * Permanently remove one post. Its interest rows are removed by the database's
 * ON DELETE CASCADE foreign key, keeping the operation atomic even if a post
 * has many interested members. Authorization belongs to the admin-only route.
 */
export async function deletePost(id: number): Promise<void> {
  const { rowCount } = await query('DELETE FROM wanted_posts WHERE id = $1', [id]);
  if (!rowCount) throw new ApiError(404, 'Post not found.');
}

// ---------- Reserving a listing ----------

/**
 * A listing states how long its session runs, and the price follows from that
 * length at the ordinary table rate — four hours costs what a four-hour table
 * booking costs. Whoever reserves the listing pays for the whole thing.
 *
 * The rate is resolved server-side from the duration stored on the post, never
 * from anything the client sends, so a tampered request cannot buy a six-hour
 * session at the two-hour price.
 */
export async function quoteListing(postId: number): Promise<{ durationMin: number; cents: number }> {
  const { rows } = await query<{ duration_min: number }>(
    'SELECT duration_min FROM wanted_posts WHERE id = $1',
    [postId],
  );
  if (!rows[0]) throw new ApiError(404, 'Post not found.');
  const durationMin = rows[0].duration_min;
  // Priced for today: a listing names days of the week, not a date, so there is
  // no specific evening to price against.
  const fee = await getTableFee(new Date().toISOString().slice(0, 10));
  const blocks = Math.max(1, Math.ceil(durationMin / 120));
  return { durationMin, cents: fee.cents * blocks };
}

export interface ListingHold {
  amountCents: number;
  durationMin: number;
}

/**
 * Claim the listing for this member.
 *
 * The claim is a conditional update rather than a read-then-write: whichever
 * transaction updates a row wins and the other affects none, so two people
 * reserving at once cannot both succeed.
 */
export async function holdListing(postId: number, memberId: number): Promise<ListingHold> {
  const quote = await quoteListing(postId);
  const { rowCount } = await query(
    `UPDATE wanted_posts
        SET reserved_by = $2, reserved_at = now(),
            amount_cents = $3, payment_state = 'pending_payment'
      WHERE id = $1 AND payment_state = 'none' AND status = 'open'`,
    [postId, memberId, quote.cents],
  );
  if (!rowCount) {
    throw new ApiError(409, 'That listing is no longer available to reserve.');
  }
  return { amountCents: quote.cents, durationMin: quote.durationMin };
}

/** Payment failed or was abandoned — put the listing back on the board. */
export async function releaseListing(postId: number): Promise<void> {
  await query(
    `UPDATE wanted_posts
        SET reserved_by = NULL, reserved_at = NULL, amount_cents = 0,
            payment_state = 'none', payment_ref = NULL
      WHERE id = $1 AND payment_state = 'pending_payment'`,
    [postId],
  );
}

/** The money arrived; the listing is taken. */
export async function confirmListing(postId: number, paymentRef: string): Promise<void> {
  await query(
    `UPDATE wanted_posts
        SET payment_state = 'paid', payment_ref = $2, status = 'completed'
      WHERE id = $1 AND payment_state = 'pending_payment'`,
    [postId, paymentRef],
  );
}

/**
 * Record the gateway charge against the held listing, at the moment the charge
 * is opened. Without it the sweep would have nothing to ask Tap about and could
 * only release by age, taking a listing away from someone who had paid.
 */
export async function attachListingCharge(postId: number, chargeId: string): Promise<void> {
  await query(
    `UPDATE wanted_posts SET payment_ref = $2
      WHERE id = $1 AND payment_state = 'pending_payment'`,
    [postId, chargeId],
  );
}

/**
 * Settle a listing charge from the gateway's own answer. Shared by the return,
 * the webhook and the sweep; the charge is always re-retrieved, never believed.
 */
export async function finalizeListingCharge(
  chargeId: string,
): Promise<'paid' | 'failed' | 'pending'> {
  if (!paymentProvider.retrieveCharge) return 'failed';
  const charge = await paymentProvider.retrieveCharge(chargeId);
  const postId = Number(charge.metadata?.postId ?? 0);
  if (!postId) return 'failed';
  if (charge.paid) {
    await confirmListing(postId, chargeId);
    return 'paid';
  }
  // Only a declined charge frees the listing. An unfinished one leaves it held
  // until the age check decides it was abandoned.
  if (charge.failed) {
    await releaseListing(postId);
    return 'failed';
  }
  return 'pending';
}

/** Listing holds old enough to be worth re-checking, oldest first. */
export async function listStaleListingHolds(
  staleAfterMin: number,
  expiryMin: number,
  limit: number,
): Promise<{ id: number; paymentRef: string | null; expirable: boolean }[]> {
  const { rows } = await query<{ id: number; payment_ref: string | null; expirable: boolean }>(
    `SELECT id, payment_ref,
            reserved_at < now() - ($2 || ' minutes')::interval AS expirable
       FROM wanted_posts
      WHERE payment_state = 'pending_payment'
        AND reserved_at < now() - ($1 || ' minutes')::interval
      ORDER BY reserved_at
      LIMIT ${limit}`,
    [String(staleAfterMin), String(expiryMin)],
  );
  return rows.map((r) => ({ id: r.id, paymentRef: r.payment_ref, expirable: r.expirable }));
}
