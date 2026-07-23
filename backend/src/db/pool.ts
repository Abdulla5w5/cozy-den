import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from '../config/env';

// A single shared pool. If DATABASE_URL is unset, pg falls back to the
// standard PG* environment variables automatically.
const databaseUrl = env.databaseUrl ? new URL(env.databaseUrl) : undefined;
const sslMode = databaseUrl?.searchParams.get('sslmode');
const requiresTls = ['prefer', 'require', 'verify-ca', 'verify-full'].includes(sslMode || '');

// pg re-parses sslmode from connectionString and lets it override the ssl
// option below. Remove it after recording the intent so our TLS settings win.
databaseUrl?.searchParams.delete('sslmode');

export const pool = new Pool(
  databaseUrl
    ? {
        connectionString: databaseUrl.toString(),
        // App Platform's managed PostgreSQL endpoint uses a platform-issued
        // certificate. The URL explicitly opts into TLS, so keep encryption
        // while allowing that certificate chain.
        ssl: requiresTls ? { rejectUnauthorized: false } : undefined,
      }
    : {}
);

pool.on('error', (err) => {
  // A pooled idle client errored — log and let pg recycle it.
  console.error('[db] unexpected idle client error', err);
});

/**
 * query() is the ONLY way the app talks to Postgres. Every call goes through
 * parameterized queries ($1, $2, ...) — never string concatenation — which
 * closes the door on SQL injection.
 */
export function query<T = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
) {
  // Intersect with QueryResultRow so plain row interfaces satisfy pg's
  // index-signature constraint while keeping their concrete field types.
  return pool.query<T & QueryResultRow>(text, params as unknown[]);
}

/** Run a set of statements inside a single transaction. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
