import { query } from '../../db/pool';
import { env } from '../../config/env';
import { notify, notifyStaff } from '../../notifications/notify';
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
  /** The service night it belongs to. */
  night: string;
  member_id: number;
  poster_email: string;
  poster_verified: boolean;
  poster_name: string;
}

async function facts(postId: number): Promise<PostFacts | null> {
  const { rows } = await query<PostFacts>(
    `SELECT p.id, COALESCE(g.title, p.game_name) AS game, ${START_DAY} AS day, p.start_time,
            to_char(p.session_date, 'YYYY-MM-DD') AS night,
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
  // Oldest post first, so a sweep is predictable.
  for (const { id } of [...due].sort((a, b) => a.id - b.id)) {
    if (!(await stillDue(id))) continue;
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
        // Moved or cancelled since it was claimed: a move clears the claim.
        if (!(await stillDue(id, p.start_time, p.night))) break;
        await notify({
          userId: u.id,
          kind: 'wanted_reminder',
          data: { postId: p.id, game: p.game, date: p.day, time: p.start_time ?? '' },
          link: '/account',
          // Keyed on the start, so a moved session is reminded again.
          dedupeKey: `wanted_reminder:${p.id}:${p.day}T${p.start_time}`,
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

/** Still claimed, still on, still at the time being announced. */
async function stillDue(postId: number, startTime?: string | null, night?: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM wanted_posts p
      WHERE p.id = $1 AND p.status IN ('open', 'completed') AND p.reminder_sent_at IS NOT NULL
        AND ${STARTS_AT} <= now() + interval '${REMINDER_HOURS} hours'
        AND ($2::text IS NULL OR p.start_time = $2)
        AND ($3::date IS NULL OR p.session_date = $3::date)`,
    [postId, startTime ?? null, night ?? null],
  );
  return rows.length > 0;
}

interface Person {
  id: number;
  name: string;
  /** Null when there is no address to trust: the bell only. */
  email: string | null;
  /** Paid and not refunded. */
  paid_cents: number;
  /** All they have ever paid for it. */
  ever_cents: number;
  seats: number;
  /** When they first had to do with this post. */
  joined_at: Date;
}

/**
 * Everyone a session matters to: its poster, people with paid seats, and
 * members who marked interest. A buyer's address already gets their pass, so
 * it is used; anyone else's must be confirmed.
 */
async function people(postId: number): Promise<Person[]> {
  const { rows } = await query<Person>(
    `SELECT u.id, u.name,
            CASE WHEN u.email_verified OR s.seats > 0 THEN u.email END AS email,
            COALESCE(s.owed, 0)::int AS paid_cents, COALESCE(s.ever, 0)::int AS ever_cents,
            COALESCE(s.seats, 0)::int AS seats,
            LEAST(s.first_paid,
                  (SELECT created_at FROM wanted_posts WHERE id = $1 AND member_id = u.id),
                  (SELECT created_at FROM wanted_post_interests WHERE post_id = $1 AND member_id = u.id))
              AS joined_at
       FROM users u
       LEFT JOIN (SELECT member_id, sum(amount_cents) AS ever, sum(seats) AS seats,
                         min(created_at) AS first_paid,
                         sum(amount_cents) FILTER (WHERE refunded_at IS NULL) AS owed
                    FROM wanted_post_seats
                   WHERE post_id = $1 AND payment_state = 'paid'
                   GROUP BY member_id) s ON s.member_id = u.id
      WHERE s.seats > 0
         OR u.id = (SELECT member_id FROM wanted_posts WHERE id = $1)
         OR u.id IN (SELECT member_id FROM wanted_post_interests WHERE post_id = $1)
      ORDER BY u.id`,
    [postId],
  );
  return rows;
}

const kd = (cents: number) => `KD ${(cents / 100).toFixed(2)}`;
const supportLine = () =>
  env.publicUrl ? `Questions? Write to us: ${env.publicUrl}/support` : 'Questions? Talk to us at the café.';

async function tell(
  list: Person[],
  what: string,
  build: (u: Person) => Omit<Parameters<typeof notify>[0], 'userId' | 'email'> & {
    subject: string;
    lines: string[];
  },
  /** Asked before each person, so old news stops once newer news is out. */
  stillTrue: () => Promise<boolean> = async () => true,
): Promise<void> {
  for (const u of list) {
    try {
      if (!(await stillTrue())) return;
      const { subject, lines, ...rest } = build(u);
      await notify({
        ...rest,
        userId: u.id,
        email: {
          to: u.email,
          subject,
          text: [`Hi ${u.name},`, '', ...lines, '', supportLine(), '', 'The Cozy Den'].join('\n'),
        },
      });
    } catch (err) {
      console.error(`[wanted] ${what} notice to account ${u.id} failed`, err);
    }
  }
}

/** Tell these people a session moved, for as long as that is the latest news. */
async function tellMoved(
  list: Person[],
  postId: number,
  changeNo: number,
  /** The change each of these people last knew of, when already known. */
  knownChange?: Map<number, number>,
): Promise<void> {
  const p = await facts(postId);
  if (!p) return;
  const { rows: cur } = await query<{ duration_min: number }>(
    'SELECT duration_min FROM wanted_posts WHERE id = $1',
    [postId],
  );
  if (!cur[0]) return;
  const hours = cur[0].duration_min / 60;
  const now = whenShort(p);
  // Every move so far, with the session as it was before it.
  const { rows: changes } = await query<{
    change_no: number;
    was_day: string;
    was_start: string | null;
    was_duration: number;
    created_at: Date;
  }>(
    `SELECT change_no, was_start, was_duration, created_at,
            to_char(COALESCE(lower(booking_window(was_date, was_start, was_duration))::date, was_date),
                    'YYYY-MM-DD') AS was_day
       FROM wanted_post_changes WHERE post_id = $1 AND change_no <= $2 ORDER BY change_no`,
    [postId, changeNo],
  );
  // The last move notice each person had.
  const { rows: told } = await query<{ user_id: number; change_no: string | null }>(
    `SELECT DISTINCT ON (user_id) user_id, data->>'changeNo' AS change_no
       FROM notifications
      WHERE user_id = ANY($1::int[]) AND kind IN ('wanted_moved', 'wanted_length')
        AND data->>'postId' = $2::text
      ORDER BY user_id, created_at DESC, id DESC`,
    [list.map((u) => u.id), String(postId)],
  );
  const lastTold = new Map(told.map((r) => [r.user_id, Number(r.change_no ?? 0)]));
  // What each person last knew: after the last move they were told of, or the
  // session as it was when they joined.
  const knew = (u: Person) => {
    const c0 =
      knownChange?.get(u.id) ??
      lastTold.get(u.id) ??
      changes.filter((c) => c.created_at <= u.joined_at).reduce((m, c) => Math.max(m, c.change_no), 0);
    if (c0 >= changeNo) return null;
    // Moves from before this record began, and moves it has not seen, tell
    // nothing reliable; the first one after what they knew holds the old state.
    const next = changes.find((c) => c.change_no > c0);
    if (!next) return null;
    const state = { day: next.was_day, start_time: next.was_start, hours: next.was_duration / 60 };
    const short = whenShort(state);
    // Already knows this very time and length: nothing new.
    if (short === now && state.hours === hours) return null;
    return { short, long: when(state), hours: state.hours };
  };
  const fromFor = (u: Person) => knew(u)!;
  await tell(
    list.filter((u) => knew(u) !== null),
    `move of post ${postId}`,
    (u) => ({
      kind: fromFor(u).short === now ? 'wanted_length' : 'wanted_moved',
      data: { postId, changeNo, game: p.game, from: fromFor(u).short, when: now, hours },
      link: u.seats > 0 ? '/account' : '/wanted',
      dedupeKey: `wanted_moved:${postId}:${changeNo}`,
      subject:
        fromFor(u).short === now
          ? `${p.game} is now ${hours} hours: ${when(p)}`
          : `New time for ${p.game}: ${when(p)}`,
      lines: [
        `The Wanted Board session for ${p.game} has changed.`,
        '',
        `Was: ${fromFor(u).long} (${fromFor(u).hours} hours)`,
        `Now: ${when(p)} (${hours} hours)`,
        ...(u.seats > 0
          ? ['', 'Your seat moves with it and your pass still works. If you cannot make the new time, tell us.']
          : []),
      ],
    }),
    async () => {
      const { rows: now } = await query<{ ok: boolean }>(
        `SELECT change_no = $2 AND status <> 'cancelled' AS ok FROM wanted_posts WHERE id = $1`,
        [postId, changeNo],
      );
      return now[0]?.ok === true;
    },
  );
}

/** A session staff moved. A post still awaiting approval concerns its poster
 *  alone. Never throws. */
export async function announceMoved(postId: number, changeNo: number): Promise<void> {
  try {
    await tellMoved(await people(postId), postId, changeNo);
  } catch (err) {
    console.error(`[wanted] post ${postId} move notices failed`, err);
  }
}

/** Someone paid for a session that moved while they were paying. Told once,
 *  even if the move itself reached them too. Never throws. */
export async function announceMovedToBuyer(holdId: number): Promise<void> {
  try {
    const { rows } = await query<{
      post_id: number;
      member_id: number;
      change_no: number;
      d: string;
      held_start: string | null;
      held_duration: number;
    }>(
      `SELECT s.post_id, s.member_id, p.change_no, to_char(s.held_date, 'YYYY-MM-DD') AS d,
              s.held_start, s.held_duration
         FROM wanted_post_seats s JOIN wanted_posts p ON p.id = s.post_id
        WHERE s.id = $1 AND s.held_date IS NOT NULL`,
      [holdId],
    );
    const s = rows[0];
    if (!s) return;
    const buyer = (await people(s.post_id)).filter((u) => u.id === s.member_id);
    const { rows: held } = await query<{ held_change_no: number }>(
      'SELECT held_change_no FROM wanted_post_seats WHERE id = $1',
      [holdId],
    );
    await tellMoved(
      buyer,
      s.post_id,
      s.change_no,
      new Map(buyer.map((u) => [u.id, Math.max(held[0]?.held_change_no ?? 0, 0)])),
    );
  } catch (err) {
    console.error(`[wanted] move notice for hold ${holdId} failed`, err);
  }
}

function cancelled(p: PostFacts, note: string | null) {
  return (u: Person) => ({
    kind: u.paid_cents > 0 ? ('wanted_cancelled_paid' as const) : ('wanted_cancelled' as const),
    data: {
      postId: p.id,
      game: p.game,
      when: whenShort(p),
      note: note ?? '',
      amount: kd(u.paid_cents),
    },
    link: u.paid_cents > 0 ? '/support' : '/wanted',
    // By all they ever paid: a payment landing as staff cancel is announced by
    // both sides but told once, and one landing later is told afresh.
    dedupeKey: `wanted_cancelled:${p.id}:${u.ever_cents}`,
    subject: `Cancelled: ${p.game}, ${when(p)}`,
    lines: [
      `The Wanted Board session for ${p.game} on ${when(p)} has been cancelled.`,
      ...(note ? ['', note] : []),
      ...(u.paid_cents > 0
        ? ['', `You paid ${kd(u.paid_cents)}. We will refund it in full; you do not need to do anything.`]
        : []),
    ],
  });
}

async function cancelNote(postId: number): Promise<string | null> {
  const { rows } = await query<{ cancel_note: string | null }>(
    'SELECT cancel_note FROM wanted_posts WHERE id = $1',
    [postId],
  );
  return rows[0]?.cancel_note ?? null;
}

/** Never throws. */
export async function announceCancelled(postId: number): Promise<void> {
  try {
    const p = await facts(postId);
    if (!p) return;
    await tell(await people(postId), `cancel of post ${postId}`, cancelled(p, await cancelNote(postId)));
  } catch (err) {
    console.error(`[wanted] post ${postId} cancel notices failed`, err);
  }
}

/** Someone's payment landed after the session was cancelled. Never throws. */
export async function announceLatePayment(holdId: number): Promise<void> {
  try {
    const { rows } = await query<{ post_id: number; member_id: number; name: string; amount_cents: number }>(
      `SELECT s.post_id, s.member_id, u.name, s.amount_cents
         FROM wanted_post_seats s JOIN users u ON u.id = s.member_id WHERE s.id = $1`,
      [holdId],
    );
    const seat = rows[0];
    const p = seat && (await facts(seat.post_id));
    if (!p) return;
    const buyer = (await people(seat.post_id)).filter((u) => u.id === seat.member_id);
    const note = await cancelNote(seat.post_id);
    await tell(buyer, `late payment on post ${seat.post_id}`, cancelled(p, note));
    // A free seat leaves nothing to refund.
    if (seat.amount_cents === 0) return;
    await notifyStaff({
      kind: 'staff_wanted_refund',
      data: { postId: p.id, game: p.game, name: seat.name, amount: kd(seat.amount_cents) },
      link: '/staff/dashboard',
      dedupeKey: `staff_wanted_refund:${holdId}`,
    });
  } catch (err) {
    console.error(`[wanted] late payment notice for hold ${holdId} failed`, err);
  }
}
