import { query } from '../../db/pool';
import { env } from '../../config/env';
import { notify } from '../../notifications/notify';
import { unsubscribeToken } from './wanted.members';

/**
 * What the Wanted Board tells people: the poster hears how their post did,
 * subscribers hear about a newly published one, and everyone with a paid seat
 * is reminded before it starts.
 */

// The session's start as a real moment, and as the Kuwait calendar day.
const STARTS_AT = `(lower(booking_window(p.session_date, p.start_time, p.duration_min))
                     AT TIME ZONE 'Asia/Kuwait')`;
const START_DAY = `to_char(CASE WHEN p.start_time IS NULL THEN p.session_date
   ELSE lower(booking_window(p.session_date, p.start_time, p.duration_min))::date END, 'YYYY-MM-DD')`;

const REMINDER_HOURS = 3;
const BATCH = 50;

interface PostFacts {
  id: number;
  game: string;
  day: string;
  start_time: string | null;
  member_id: number;
  poster_email: string;
  poster_verified: boolean;
  poster_name: string;
}

async function facts(postId: number): Promise<PostFacts | null> {
  const { rows } = await query<PostFacts>(
    `SELECT p.id, COALESCE(g.title, p.game_name) AS game, ${START_DAY} AS day, p.start_time,
            p.member_id, u.email AS poster_email, u.email_verified AS poster_verified,
            u.name AS poster_name
       FROM wanted_posts p
       JOIN users u ON u.id = p.member_id
       LEFT JOIN games g ON g.id = p.game_id
      WHERE p.id = $1`,
    [postId],
  );
  return rows[0] ?? null;
}

const when = (p: { day: string; start_time: string | null }) =>
  p.start_time ? `${p.day} at ${p.start_time}` : p.day;

/** The same for the bell, which is shown in either language. */
const whenShort = (p: { day: string; start_time: string | null }) =>
  p.start_time ? `${p.day} ${p.start_time}` : p.day;

const boardLink = () => (env.publicUrl ? ['', `${env.publicUrl}/wanted`] : []);

/**
 * After staff decide on a post. Never throws and is not awaited by the request:
 * a mail problem must not make an approval look as if it failed.
 */
export async function announceDecision(postId: number, decision: 'approve' | 'reject'): Promise<void> {
  try {
    const p = await facts(postId);
    if (!p) return;
    const approved = decision === 'approve';
    await notify({
      userId: p.member_id,
      kind: approved ? 'wanted_approved' : 'wanted_rejected',
      data: { postId: p.id, game: p.game, when: whenShort(p) },
      link: '/wanted',
      dedupeKey: `wanted_decision:${p.id}`,
      email: {
        to: p.poster_verified ? p.poster_email : null,
        subject: approved
          ? `Your Wanted Board post is live: ${p.game}`
          : `Your Wanted Board post was not approved: ${p.game}`,
        text: [
          `Hi ${p.poster_name},`,
          '',
          approved
            ? `Your post for ${p.game} on ${when(p)} is now on the Wanted Board.`
            : `Your post for ${p.game} on ${when(p)} was not approved, so it is not on the board.`,
          ...boardLink(),
          '',
          'The Cozy Den',
        ].join('\n'),
      },
    });
    if (approved) await announceNewPost(p);
  } catch (err) {
    console.error(`[wanted] post ${postId} notices failed`, err);
  }
}

async function announceNewPost(p: PostFacts): Promise<void> {
  const { rows } = await query<{ id: number; email: string; name: string; email_verified: boolean }>(
    `SELECT id, email, name, email_verified FROM users
      WHERE wanted_alerts AND id <> $1 ORDER BY id`,
    [p.member_id],
  );
  for (const u of rows) {
    // One at a time: a long list must not crowd out the site's own queries.
    try {
      await notify({
        userId: u.id,
        kind: 'wanted_new',
        data: { postId: p.id, game: p.game, when: whenShort(p) },
        link: '/wanted',
        dedupeKey: `wanted_new:${p.id}`,
        email: {
          to: u.email_verified ? u.email : null,
          subject: `New on the Wanted Board: ${p.game}`,
          text: [
            `Hi ${u.name},`,
            '',
            `A new session is looking for players: ${p.game}, ${when(p)}.`,
            ...boardLink(),
            '',
            'You get this because you subscribed to the Wanted Board.',
            ...(env.publicUrl
              ? [`Unsubscribe: ${env.publicUrl}/wanted?unsubscribe=${unsubscribeToken(u.id)}`]
              : []),
            '',
            'The Cozy Den',
          ].join('\n'),
        },
      });
    } catch (err) {
      console.error(`[wanted] new-post notice to account ${u.id} failed`, err);
    }
  }
}

/**
 * The reminder 3 hours before a session, to the poster and everyone who had
 * paid for a seat by then. Claimed before sending, so it goes out once even
 * with two servers sweeping. A session nobody has paid for is not announced.
 */
export async function sendDueWantedReminders(): Promise<number> {
  const { rows: due } = await query<{ id: number }>(
    `UPDATE wanted_posts SET reminder_sent_at = now()
      WHERE reminder_sent_at IS NULL AND id IN (
        SELECT p.id FROM wanted_posts p
         WHERE p.reminder_sent_at IS NULL AND p.start_time IS NOT NULL
           AND p.status IN ('open', 'completed')
           AND p.session_date BETWEEN (now() AT TIME ZONE 'Asia/Kuwait')::date - 1
                                  AND (now() AT TIME ZONE 'Asia/Kuwait')::date + 1
           AND ${STARTS_AT} > now()
           AND ${STARTS_AT} <= now() + interval '${REMINDER_HOURS} hours'
           AND EXISTS (SELECT 1 FROM wanted_post_seats s
                        WHERE s.post_id = p.id AND s.payment_state = 'paid'
                          AND s.created_at < ${STARTS_AT} - interval '${REMINDER_HOURS} hours')
         ORDER BY p.id
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED)
      RETURNING id`,
  );
  let sent = 0;
  for (const { id } of due) {
    const p = await facts(id);
    if (!p) continue;
    const { rows: people } = await query<{ id: number; email: string | null; name: string }>(
      `SELECT u.id, u.name,
              -- A buyer's address already gets their pass; a poster who has
              -- not paid must have confirmed theirs.
              CASE WHEN u.email_verified OR EXISTS (
                SELECT 1 FROM wanted_post_seats b
                 WHERE b.post_id = $1 AND b.member_id = u.id AND b.payment_state = 'paid')
              THEN u.email END AS email
         FROM users u
        WHERE u.id = $2 OR u.id IN (
          SELECT s.member_id FROM wanted_post_seats s JOIN wanted_posts p ON p.id = s.post_id
           WHERE s.post_id = $1 AND s.payment_state = 'paid'
             AND s.created_at < ${STARTS_AT} - interval '${REMINDER_HOURS} hours')`,
      [id, p.member_id],
    );
    for (const u of people) {
      try {
        await notify({
          userId: u.id,
          kind: 'wanted_reminder',
          data: { postId: p.id, game: p.game, date: p.day, time: p.start_time ?? '' },
          link: '/account',
          dedupeKey: `wanted_reminder:${p.id}`,
          email: {
            to: u.email,
            subject: `See you at ${p.start_time}: ${p.game}`,
            text: [
              `Hi ${u.name},`,
              '',
              `A quick reminder: your Wanted Board session, ${p.game}, starts at ${p.start_time} (${p.day}).`,
              ...(env.publicUrl ? ['', `Your pass is in My Bookings: ${env.publicUrl}/account`] : []),
              '',
              'See you soon,',
              'The Cozy Den',
            ].join('\n'),
          },
        });
        sent += 1;
      } catch (err) {
        console.error(`[wanted] reminder for post ${id} to account ${u.id} failed`, err);
      }
    }
  }
  return sent;
}
