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

test('Google token verification loads its client on first use', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { verifyGoogleToken } = require('./dist/src/modules/auth/auth.service.js');
    const googleLoaded = () => Object.keys(require.cache).some((p) => p.includes('/google-auth-library/'));

    (async () => {
      assert.equal(googleLoaded(), false);
      await assert.rejects(
        verifyGoogleToken('invalid-token-value'),
        (error) => error?.status === 401 && error?.message === 'Invalid Google token.',
      );
      assert.equal(googleLoaded(), true);
      console.log('RESULT:ok');
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;

  const stdout = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'test-client-id',
    },
  });

  assert.match(stdout, /RESULT:ok/);
});

test('security headers keep Google popups functional without allowing framing', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { createApp } = require('./dist/src/app.js');
    const server = createApp().listen(0, '127.0.0.1', async () => {
      try {
        const { port } = server.address();
        const response = await fetch('http://127.0.0.1:' + port + '/api/health');
        assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
        assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
        assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
        console.log('RESULT:ok');
        server.close();
      } catch (error) {
        console.error(error);
        server.close(() => process.exit(1));
      }
    });
  `;

  const stdout = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars',
      PAYMENT_PROVIDER: 'mock',
    },
  });

  assert.match(stdout, /RESULT:ok/);
});
