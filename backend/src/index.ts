import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/pool';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`[cozy-den] API listening on http://localhost:${env.port} (${env.nodeEnv})`);
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
