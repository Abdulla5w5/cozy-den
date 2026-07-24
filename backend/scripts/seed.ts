import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool';

// Convenience account for local development only. Never created in production:
// staff access there is granted from the dashboard (see modules/staff/team.service).
// Set SEED_STAFF_EMAIL explicitly to opt in anywhere.
const STAFF_EMAIL = process.env.SEED_STAFF_EMAIL || 'staff@cozyden.local';
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD || 'cozyden123';
const STAFF_NAME = process.env.SEED_STAFF_NAME || 'Front Counter';
const SEED_STAFF =
  Boolean(process.env.SEED_STAFF_EMAIL) || process.env.NODE_ENV !== 'production';

async function main() {
  // 1) Reference data (tables / games / menu).
  const seedPath = [
    join(__dirname, '..', 'db', 'seed.sql'),
    join(__dirname, '..', '..', 'db', 'seed.sql'),
  ].find(existsSync);
  if (!seedPath) throw new Error('Could not find database seed data');
  const sql = readFileSync(seedPath, 'utf8');
  await pool.query(sql);

  // 2) Development convenience account. Skipped in production so a known
  //    default login can never exist on the live site.
  if (SEED_STAFF) {
    const hash = await bcrypt.hash(STAFF_PASSWORD, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, name, provider)
       VALUES ($1, $2, $3, 'local')
       ON CONFLICT (email) DO NOTHING`,
      [STAFF_EMAIL.toLowerCase(), hash, STAFF_NAME]
    );
    console.log(`  Dev account: ${STAFF_EMAIL} / ${STAFF_PASSWORD}`);
  }

  console.log('Seed complete.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await pool.end();
  process.exit(1);
});
