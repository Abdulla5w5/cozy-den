/**
 * In-site notifications (the header bell), plus the shared way to tell a
 * customer something by site and email at once.
 *
 * A notice stores its kind and the facts behind it, not finished sentences, so
 * the site can show it in the visitor's language. Every kind the site can show
 * is listed in NotificationKind; add one there, then add its wording to the
 * frontend's i18n under `notif.<kind>.title` / `notif.<kind>.body`.
 */
import { query } from '../db/pool';
import { mailer } from './mailer';

export type NotificationKind =
  | 'booking_reminder';

export interface NotifyInput {
  /** The account to show it to. Null for a guest, who only gets the email. */
  userId: number | null;
  kind: NotificationKind;
  data: Record<string, string | number | boolean | null>;
  /** A path on this site, e.g. "/account". */
  link?: string | null;
  /**
   * Makes the notice idempotent: a second notify with the same key for the
   * same account is ignored. Use "<kind>:<id>" for anything a sweep sends.
   */
  dedupeKey?: string | null;
  /** Sent as well when given. A failed email never undoes the in-site notice. */
  email?: { to: string | null; subject: string; text: string } | null;
}

export interface NotificationView {
  id: number;
  kind: string;
  data: Record<string, unknown>;
  link: string | null;
  createdAt: string;
  read: boolean;
}

/**
 * Records the in-site notice (for an account) and sends the email (when one is
 * given). Returns whether the in-site notice was new; false means the dedupe
 * key had already been used, and then no email is sent either.
 */
export async function notify(input: NotifyInput): Promise<boolean> {
  let fresh = true;
  if (input.userId !== null) {
    const { rowCount } = await query(
      `INSERT INTO notifications (user_id, kind, data, link, dedupe_key)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [
        input.userId,
        input.kind,
        JSON.stringify(input.data),
        input.link ?? null,
        input.dedupeKey ?? null,
      ],
    );
    fresh = (rowCount ?? 0) > 0;
  }
  if (fresh && input.email?.to) {
    try {
      await mailer.send({ to: input.email.to, subject: input.email.subject, text: input.email.text });
    } catch (err) {
      console.error(`[notify] ${input.kind} email failed`, err);
    }
  }
  return fresh;
}

const LIST_LIMIT = 30;

export async function listNotifications(
  userId: number,
): Promise<{ notifications: NotificationView[]; unread: number }> {
  const [list, count] = await Promise.all([
    query<{
      id: string;
      kind: string;
      data: Record<string, unknown>;
      link: string | null;
      created_at: Date;
      read_at: Date | null;
    }>(
      `SELECT id, kind, data, link, created_at, read_at
         FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT ${LIST_LIMIT}`,
      [userId],
    ),
    unreadCount(userId),
  ]);
  return {
    notifications: list.rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      data: r.data,
      link: r.link,
      createdAt: r.created_at.toISOString(),
      read: r.read_at !== null,
    })),
    unread: count,
  };
}

export async function unreadCount(userId: number): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

/** Marks the given notices read, or all of them when ids is null. Own rows only. */
export async function markRead(userId: number, ids: number[] | null): Promise<void> {
  if (ids === null) {
    await query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return;
  }
  if (ids.length === 0) return;
  await query(
    `UPDATE notifications SET read_at = now()
      WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
    [userId, ids],
  );
}
