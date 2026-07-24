import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/pool';
import { bootstrapStaff } from './modules/staff/team.service';

const app = createApp();

const server = app.listen(env.port, () => {
  const addr = server.address();
  const bind = typeof addr === 'object' && addr ? `${addr.address}:${addr.port}` : `:${env.port}`;
  console.log(`[cozy-den] API listening on ${bind} (${env.nodeEnv})`);
  // Break-glass only: promotes STAFF_ALLOWED_EMAILS accounts when the team is
  // empty. A no-op once anyone has staff access.
  bootstrapStaff().catch((err) => console.error('[cozy-den] staff bootstrap failed', err));
});

// Graceful shutdown so in-flight requests finish and the pool closes cleanly.
async function shutdown(signal: string) {
  console.log(`\n[cozy-den] ${signal} received, shutting down...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
