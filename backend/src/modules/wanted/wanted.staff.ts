import { query, withTransaction } from '../../db/pool';
import { ApiError } from '../../middleware/error';
import { isRealDate } from '../../utils/dates';
import { isValidDuration, isValidStart, slotHasStarted, slotStartsAt } from '../../utils/slots';
import { announceCancelled, announceMoved } from './wanted.notices';
import { ENDED, STARTED, type PostStatus } from './wanted.service';

/**
 * Staff moving or cancelling a session. Money is never moved here: people who
 * paid keep the price they paid when a session moves, and refunds for a
 * cancelled one are made by hand in Tap and ticked off afterwards.
 */

export interface SessionDetails {
  sessionDate: string;
  /** Null only as what staff saw on a post from before start times. */
  startTime: string | null;
  durationMin: number;
  minPlayers: number;
  maxPlayers: number;
}

export interface SessionChange extends SessionDetails {
  startTime: string;
  /** What staff were looking at, so one change cannot undo another. */
  expected: SessionDetails;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export async function changeSession(
  id: number,
  change: SessionChange,
  staffId: number,
): Promise<{ moved: boolean }> {
  const { sessionDate, startTime, durationMin, minPlayers, maxPlayers, expected } = change;
  if (!isRealDate(sessionDate)) throw new ApiError(400, 'Pick a real date.');
  if (!isValidStart(startTime)) throw new ApiError(400, 'Pick a start time.');
  if (durationMin < 120 || !isValidDuration(startTime, durationMin)) {
    throw new ApiError(400, 'That session would run past closing time. Start earlier or make it shorter.');
  }
  if (maxPlayers < minPlayers) {
    throw new ApiError(400, 'Maximum players cannot be lower than minimum players.');
  }

  const result = await withTransaction(async (client) => {
    // The lock a seat purchase takes too, so the seats cannot move under us.
    const { rows } = await client.query<{
      status: PostStatus;
      d: string;
      start_time: string | null;
      duration_min: number;
      min_players: number;
      max_players: number;
      started: boolean;
    }>(
      `SELECT p.status, to_char(p.session_date, 'YYYY-MM-DD') AS d, p.start_time, p.duration_min,
              p.min_players, p.max_players, ${STARTED} AS started
         FROM wanted_posts p WHERE p.id = $1 FOR UPDATE`,
      [id],
    );
    const post = rows[0];
    if (!post) throw new ApiError(404, 'Post not found.');
    if (post.status === 'cancelled' || post.status === 'rejected') {
      throw new ApiError(409, 'This session was cancelled or rejected, so it cannot be changed.');
    }
    if (post.started) throw new ApiError(409, 'This session has already started or passed.');
    if (
      post.d !== expected.sessionDate ||
      post.start_time !== expected.startTime ||
      post.duration_min !== expected.durationMin ||
      post.min_players !== expected.minPlayers ||
      post.max_players !== expected.maxPlayers
    ) {
      throw new ApiError(409, 'Someone else just changed this session. Refresh and try again.');
    }

    const moved =
      post.d !== sessionDate || post.start_time !== startTime || post.duration_min !== durationMin;
    if (moved) {
      if (slotHasStarted(sessionDate, startTime)) {
        throw new ApiError(400, 'That time has already passed. Pick a later one.');
      }
      if (slotStartsAt(sessionDate, startTime) - Date.now() > YEAR_MS) {
        throw new ApiError(400, 'Pick a date within the next year.');
      }
    }

    const { rows: seats } = await client.query<{ taken: string; paid: string; payable: string }>(
      `SELECT COALESCE(sum(seats) FILTER (WHERE payment_state <> 'released'), 0)::text AS taken,
              COALESCE(sum(seats) FILTER (WHERE payment_state = 'paid'), 0)::text AS paid,
              -- A released hold's payment page can still be paid for a while,
              -- at the price of the old length.
              COALESCE(sum(seats) FILTER (WHERE payment_state = 'released'
                AND payment_ref LIKE 'chg\\_%' AND created_at > now() - interval '1 hour'), 0)::text
                AS payable
         FROM wanted_post_seats WHERE post_id = $1`,
      [id],
    );
    const taken = Number(seats[0].taken);
    const paid = Number(seats[0].paid);
    // Only when lowered: a late payment can oversell a post, which must still move.
    if (maxPlayers < taken && maxPlayers < post.max_players) {
      throw new ApiError(409, `${taken} seats are already taken, so the maximum cannot be lower.`);
    }
    // The length is what people paid for.
    if (taken > 0 && durationMin !== post.duration_min) {
      throw new ApiError(409, 'Seats are already taken, so the length cannot change.');
    }
    if (Number(seats[0].payable) > 0 && durationMin !== post.duration_min) {
      throw new ApiError(
        409,
        'Someone may still be paying for the current length. Try again in an hour.',
      );
    }

    // Full or not follows the new maximum; a post awaiting approval stays so.
    const status: PostStatus =
      post.status === 'pending' ? 'pending' : paid >= maxPlayers ? 'completed' : 'open';
    const { rows: after } = await client.query<{ change_no: number }>(
      `UPDATE wanted_posts
          SET session_date = $2, start_time = $3, duration_min = $4, min_players = $5,
              max_players = $6, preferred_days = $7, status = $8,
              change_no = change_no + CASE WHEN $9 THEN 1 ELSE 0 END,
              -- A new time is reminded in its turn.
              reminder_sent_at = CASE WHEN $9 THEN NULL ELSE reminder_sent_at END
        WHERE id = $1 RETURNING change_no`,
      [
        id,
        sessionDate,
        startTime,
        durationMin,
        minPlayers,
        maxPlayers,
        [new Date(`${sessionDate}T00:00:00Z`).getUTCDay()],
        status,
        moved,
      ],
    );
    if (moved) {
      await client.query(
        `INSERT INTO wanted_post_changes (post_id, change_no, was_date, was_start, was_duration)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, after[0].change_no, post.d, post.start_time, post.duration_min],
      );
    }
    if (sessionDate !== post.d) {
      // Checked in for the old night; they come again on the new one.
      await client.query('UPDATE wanted_post_seats SET checked_in_at = NULL WHERE post_id = $1', [id]);
    }
    return {
      moved,
      changeNo: after[0].change_no,
    };
  });

  console.log(
    `[wanted] session ${id} changed by user ${staffId}: ` +
      `${expected.sessionDate} ${expected.startTime ?? '-'} ${expected.durationMin}m ` +
      `${expected.minPlayers}-${expected.maxPlayers} -> ` +
      `${sessionDate} ${startTime} ${durationMin}m ${minPlayers}-${maxPlayers}`,
  );
  if (result.moved) void announceMoved(id, result.changeNo);
  return { moved: result.moved };
}

export async function cancelSession(
  id: number,
  note: string,
  staffId: number,
  /** The session staff were looking at. */
  expected: { sessionDate: string; startTime: string | null },
): Promise<void> {
  const { rowCount } = await query(
    `UPDATE wanted_posts p
        SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_note = NULLIF($3, '')
      WHERE p.id = $1 AND p.status IN ('open', 'completed') AND NOT ${ENDED}
        AND p.session_date = $4::date AND p.start_time IS NOT DISTINCT FROM $5`,
    [id, staffId, note, expected.sessionDate, expected.startTime],
  );
  if (!rowCount) {
    const { rows } = await query<{ status: PostStatus; ended: boolean }>(
      `SELECT p.status, ${ENDED} AS ended FROM wanted_posts p WHERE p.id = $1`,
      [id],
    );
    if (!rows[0]) throw new ApiError(404, 'Post not found.');
    throw new ApiError(
      409,
      rows[0].status === 'cancelled'
        ? 'This session is already cancelled.'
        : rows[0].status === 'pending' || rows[0].status === 'rejected'
          ? 'This post is not on the board, so there is nothing to cancel.'
          : rows[0].ended
            ? 'This session is already over.'
            : 'Someone else just changed this session. Refresh and try again.',
    );
  }
  console.log(`[wanted] session ${id} cancelled by user ${staffId}`);
  void announceCancelled(id);
}

/** Tick a cancelled session's payment off as refunded, or undo a wrong tick. */
export async function setSeatRefunded(
  seatId: number,
  refunded: boolean,
  staffId: number,
): Promise<void> {
  const rowCount = await withTransaction(async (client) => {
    // The lock a delete takes: a payment marked unrefunded must not vanish.
    const { rows } = await client.query(
      `SELECT p.id FROM wanted_posts p
        WHERE p.id = (SELECT post_id FROM wanted_post_seats WHERE id = $1)
          AND p.status = 'cancelled' FOR UPDATE`,
      [seatId],
    );
    if (!rows[0]) return 0;
    const done = await client.query(
      `UPDATE wanted_post_seats
          SET refunded_at = CASE WHEN $2 THEN COALESCE(refunded_at, now()) END,
              refunded_by = CASE WHEN $2 THEN COALESCE(refunded_by, $3) END
        WHERE id = $1 AND payment_state = 'paid' AND amount_cents > 0`,
      [seatId, refunded, staffId],
    );
    return done.rowCount;
  });
  if (!rowCount) throw new ApiError(409, 'There is no payment to refund here.');
  console.log(`[wanted] seat ${seatId} marked ${refunded ? 'refunded' : 'not refunded'} by user ${staffId}`);
}
