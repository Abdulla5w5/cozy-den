const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('optional integrations stay out of the normal API startup path', () => {
  const script = `
    const { createApp } = require('./dist/src/app.js');
    createApp();
    const loaded = Object.keys(require.cache);
    console.log('RESULT:' + JSON.stringify({
      redis: loaded.some((p) => p.includes('/redis/') || p.includes('/rate-limit-redis/')),
      google: loaded.some((p) => p.includes('/google-auth-library/')),
      nodemailer: loaded.some((p) => p.includes('/nodemailer/')),
    }));
  `;

  const stdout = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars',
      PAYMENT_PROVIDER: 'mock',
      REDIS_URL: '',
      SMTP_URL: 'smtps://user:password@example.invalid',
      GOOGLE_CLIENT_ID: 'test-client-id',
    },
  });

  const resultLine = stdout
    .split('\n')
    .find((line) => line.startsWith('RESULT:'));
  assert.ok(resultLine, 'child process should report loaded integrations');
  assert.deepEqual(JSON.parse(resultLine.slice('RESULT:'.length)), {
    redis: false,
    google: false,
    nodemailer: false,
  });
});
