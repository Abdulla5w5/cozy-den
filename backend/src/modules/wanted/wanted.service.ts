import { pool, query } from '../../db/pool';
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
         p.min_players, p.max_players, p.session_type,
         p.preferred_days, p.status, p.created_at,
         (SELECT count(*) FROM wanted_post_interests i WHERE i.post_id = p.id) AS interest_count
    FROM wanted_posts p
    LEFT JOIN games g ON g.id = p.game_id`;

interface PublicRow {
  id: number;
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

function toPublic(r: PublicRow): PublicPost {
  return {
    id: r.id,
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
        session_type, preferred_days, acknowledgment_confirmed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
     RETURNING id`,
    [
      memberId,
      input.gameId ?? null,
      input.gameId ? null : input.gameName!.trim(),
      input.minPlayers,
      input.maxPlayers,
      input.sessionType,
      input.preferredDays,
    ],
  );
  const post = await getPublicPost(rows[0].id);
  if (!post) throw new ApiError(500, 'Post vanished after creation.');
  return post;
}

export async function getPublicPost(id: number): Promise<PublicPost | null> {
  const { rows } = await query<PublicRow>(`${PUBLIC_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ? toPublic(rows[0]) : null;
}

/** The public board: approved posts only, identity-free. */
export async function listPublicPosts(): Promise<PublicPost[]> {
  const { rows } = await query<PublicRow>(
    `${PUBLIC_SELECT}
      WHERE p.status IN ('open', 'completed')
      ORDER BY CASE p.status WHEN 'open' THEN 0 ELSE 1 END, p.created_at DESC`,
  );
  return rows.map(toPublic);
}

/** A member's own posts, including ones still awaiting approval. */
export async function listMyPosts(memberId: number): Promise<PublicPost[]> {
  const { rows } = await query<PublicRow>(
    `${PUBLIC_SELECT} WHERE p.member_id = $1 ORDER BY p.created_at DESC`,
    [memberId],
  );
  return rows.map(toPublic);
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
            p.min_players, p.max_players, p.session_type,
            p.preferred_days, p.status, p.created_at,
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

  return rows.map((r) => ({
    ...toPublic(r),
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
