import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pool } from '../src/db/pool';

/**
 * Minimal migration runner: applies every .sql file in db/migrations in name
 * order, once each, tracked in a schema_migrations table. Chosen over an ORM
 * so the SQL is explicit and reviewable (see README "Why raw SQL").
 */
async function main() {
  const dir = join(__dirname, '..', 'db', 'migrations');

  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename
    )
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`- skip ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    console.log(`+ applying ${file}`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
  }

  console.log('Migrations up to date.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await pool.end();
  process.exit(1);
});
