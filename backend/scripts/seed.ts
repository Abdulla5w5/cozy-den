import { readFileSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool';

// Default dev staff credentials. Override via env for a non-default password.
const STAFF_EMAIL = process.env.SEED_STAFF_EMAIL || 'staff@cozyden.local';
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD || 'cozyden123';
const STAFF_NAME = process.env.SEED_STAFF_NAME || 'Front Counter';

async function main() {
  // 1) Reference data (tables / games / menu).
  const sql = readFileSync(join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
  await pool.query(sql);

  // 2) Default account in the universal users table. This email should also be
  //    in STAFF_ALLOWED_EMAILS so it logs in as staff and sees the dashboard.
  const hash = await bcrypt.hash(STAFF_PASSWORD, 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, name, provider)
     VALUES ($1, $2, $3, 'local')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [STAFF_EMAIL.toLowerCase(), hash, STAFF_NAME]
  );

  console.log('Seed complete.');
  console.log(`  Staff account: ${STAFF_EMAIL} / ${STAFF_PASSWORD}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await pool.end();
  process.exit(1);
});
