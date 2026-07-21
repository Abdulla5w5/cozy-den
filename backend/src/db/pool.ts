import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from '../config/env';

// A single shared pool. If DATABASE_URL is unset, pg falls back to the
// standard PG* environment variables automatically.
export const pool = new Pool(
  env.databaseUrl ? { connectionString: env.databaseUrl } : {}
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
