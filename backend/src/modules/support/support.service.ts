import { pool, query } from '../../db/pool';
import { ApiError } from '../../middleware/error';
import { notifyNewComplaint, notifyResolved, notifyStaffReply } from './support.mail';

// A customer may have at most this many messages awaiting a staff reply.
const MAX_UNANSWERED = 2;

export type Kind = 'suggestion' | 'complaint' | 'question';
export type Severity = 'low' | 'normal' | 'urgent';
export type Status = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface SupportMessage {
  id: number;
  authorName: string;
  authorRole: 'customer' | 'staff';
  isInternal: boolean;
  body: string;
  createdAt: string;
}

export interface SupportRequest {
  id: number;
  kind: Kind;
  severity: Severity | null;
  subject: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  customerEmail?: string;
  messageCount?: number;
}

interface Actor {
  id: number;
  name: string;
  email: string;
}

function mapRequest(r: Record<string, unknown>): SupportRequest {
  return {
    id: r.id as number,
    kind: r.kind as Kind,
    severity: (r.severity as Severity) ?? null,
    subject: r.subject as string,
    status: r.status as Status,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
    ...(r.customer_name ? { customerName: r.customer_name as string } : {}),
    ...(r.customer_email ? { customerEmail: r.customer_email as string } : {}),
    ...(r.message_count !== undefined ? { messageCount: Number(r.message_count) } : {}),
  };
}

function mapMessage(r: Record<string, unknown>): SupportMessage {
  return {
    id: r.id as number,
    authorName: r.author_name as string,
    authorRole: r.author_role as 'customer' | 'staff',
    isInternal: r.is_internal as boolean,
    body: r.body as string,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

/** Create a request plus its opening message atomically. */
export async function createRequest(
  actor: Actor,
  input: { kind: Kind; severity?: Severity; subject: string; body: string },
): Promise<SupportRequest> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO support_requests (user_id, kind, severity, subject)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [actor.id, input.kind, input.kind === 'complaint' ? (input.severity ?? 'normal') : null, input.subject],
    );
    const request = rows[0];
    await client.query(
      `INSERT INTO support_messages (request_id, author_id, author_name, author_role, body)
       VALUES ($1, $2, $3, 'customer', $4)`,
      [request.id, actor.id, actor.name, input.body],
    );
    await client.query(
      `INSERT INTO support_status_events (request_id, actor_id, actor_name, from_status, to_status)
       VALUES ($1, $2, $3, NULL, 'open')`,
      [request.id, actor.id, actor.name],
    );
    await client.query('COMMIT');

    // Fire-and-forget: a mail failure must never fail the customer's submission.
    if (request.kind === 'complaint') {
      void notifyNewComplaint({
        id: request.id,
        subject: request.subject,
        severity: request.severity,
        customerName: actor.name,
        customerEmail: actor.email,
        body: input.body,
      });
    }
    return mapRequest(request);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listMyRequests(userId: number): Promise<SupportRequest[]> {
  const { rows } = await query(
    `SELECT r.*, count(m.id) FILTER (WHERE NOT m.is_internal) AS message_count
       FROM support_requests r
       LEFT JOIN support_messages m ON m.request_id = r.id
      WHERE r.user_id = $1
      GROUP BY r.id
      ORDER BY r.updated_at DESC`,
    [userId],
  );
  return rows.map(mapRequest);
}

export async function listAllRequests(status?: Status): Promise<SupportRequest[]> {
  const { rows } = await query(
    `SELECT r.*, u.name AS customer_name, u.email AS customer_email,
            count(m.id) AS message_count
       FROM support_requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN support_messages m ON m.request_id = r.id
      WHERE ($1::text IS NULL OR r.status = $1)
      GROUP BY r.id, u.name, u.email
      ORDER BY
        CASE r.severity WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        r.updated_at DESC`,
    [status ?? null],
  );
  return rows.map(mapRequest);
}

/**
 * Load a thread. `asStaff` decides both whether another user's request is
 * readable and whether internal notes are included — ownership is enforced
 * here in the query, not in the UI.
 */
export async function getThread(
  requestId: number,
  viewer: { id: number; isStaff: boolean },
): Promise<{ request: SupportRequest; messages: SupportMessage[]; statusHistory: unknown[] }> {
  const { rows } = await query(
    `SELECT r.*, u.name AS customer_name, u.email AS customer_email
       FROM support_requests r
       JOIN users u ON u.id = r.user_id
      WHERE r.id = $1 AND ($2::boolean OR r.user_id = $3)`,
    [requestId, viewer.isStaff, viewer.id],
  );
  if (!rows[0]) throw new ApiError(404, 'Request not found.');

  const { rows: msgs } = await query(
    `SELECT * FROM support_messages
      WHERE request_id = $1 AND ($2::boolean OR NOT is_internal)
      ORDER BY created_at`,
    [requestId, viewer.isStaff],
  );
  const { rows: events } = await query(
    `SELECT actor_name, from_status, to_status, created_at
       FROM support_status_events WHERE request_id = $1 ORDER BY created_at`,
    [requestId],
  );

  const request = mapRequest(rows[0]);
  if (!viewer.isStaff) {
    delete request.customerName;
    delete request.customerEmail;
  }
  return {
    request,
    messages: msgs.map(mapMessage),
    statusHistory: events.map((e) => ({
      actorName: e.actor_name,
      from: e.from_status,
      to: e.to_status,
      createdAt: (e.created_at as Date).toISOString(),
    })),
  };
}

export async function addMessage(
  requestId: number,
  author: Actor,
  role: 'customer' | 'staff',
  body: string,
  isInternal = false,
): Promise<SupportMessage> {
  if (isInternal && role !== 'staff') throw new ApiError(403, 'Staff only.');

  // Customers may only post to their own request; staff to any.
  const { rows: reqRows } = await query(
    `SELECT r.id, r.subject, r.status, u.email AS customer_email, u.name AS customer_name
       FROM support_requests r JOIN users u ON u.id = r.user_id
      WHERE r.id = $1 AND ($2::boolean OR r.user_id = $3)`,
    [requestId, role === 'staff', author.id],
  );
  const request = reqRows[0];
  if (!request) throw new ApiError(404, 'Request not found.');
  if (request.status === 'closed') throw new ApiError(409, 'This request is closed.');

  // Anti-flood: a customer may queue at most two unanswered messages. Internal
  // notes are invisible to them, so only a public staff reply clears the count.
  if (role === 'customer') {
    const { rows: pending } = await query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM support_messages
        WHERE request_id = $1
          AND author_role = 'customer'
          AND created_at > COALESCE(
                (SELECT max(created_at) FROM support_messages
                  WHERE request_id = $1 AND author_role = 'staff' AND NOT is_internal),
                '-infinity'::timestamptz)`,
      [requestId],
    );
    if (Number(pending[0].n) >= MAX_UNANSWERED) {
      throw new ApiError(
        429,
        'You have already sent two messages. Please wait for our reply before sending another.',
      );
    }
  }

  const { rows } = await query(
    `INSERT INTO support_messages (request_id, author_id, author_name, author_role, is_internal, body)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [requestId, author.id, author.name, role, isInternal, body],
  );
  await query('UPDATE support_requests SET updated_at = now() WHERE id = $1', [requestId]);

  // Internal notes are invisible to the customer, so they never trigger mail.
  if (role === 'staff' && !isInternal) {
    void notifyStaffReply({
      id: requestId,
      subject: request.subject,
      customerName: request.customer_name,
      customerEmail: request.customer_email,
      body,
    });
  }
  return mapMessage(rows[0]);
}

export async function setStatus(
  requestId: number,
  actor: Actor,
  to: Status,
): Promise<SupportRequest> {
  const { rows: before } = await query(
    `SELECT r.status, r.subject, u.email AS customer_email, u.name AS customer_name
       FROM support_requests r JOIN users u ON u.id = r.user_id WHERE r.id = $1`,
    [requestId],
  );
  if (!before[0]) throw new ApiError(404, 'Request not found.');
  const from = before[0].status as Status;
  if (from === to) throw new ApiError(409, `Request is already ${to}.`);

  const { rows } = await query(
    'UPDATE support_requests SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [requestId, to],
  );
  await query(
    `INSERT INTO support_status_events (request_id, actor_id, actor_name, from_status, to_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [requestId, actor.id, actor.name, from, to],
  );

  if (to === 'resolved') {
    void notifyResolved({
      id: requestId,
      subject: before[0].subject,
      customerName: before[0].customer_name,
      customerEmail: before[0].customer_email,
    });
  }
  return mapRequest(rows[0]);
}
