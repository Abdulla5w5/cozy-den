import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');

export const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: parseInt(optional('PORT', '4000'), 10),

  // Explicit CORS allow-list — never '*' in production.
  corsOrigins: optional('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Mail transport. Without SMTP_URL the mailer logs instead of sending.
  smtpUrl: optional('SMTP_URL', ''),
  mailFrom: optional('MAIL_FROM', 'Cozy Den <no-reply@cozyden.local>'),

  // Absolute site URL used in notification emails (links back to a thread).
  publicUrl: optional('PUBLIC_URL', '').replace(/\/$/, ''),

  databaseUrl: process.env.DATABASE_URL || undefined,

  // Shared rate-limit store. Unset => per-process memory limits (single instance only).
  redisUrl: process.env.REDIS_URL || undefined,

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '8h'),
  cookieSecure: optional('COOKIE_SECURE', 'false') === 'true',

  // Optional allow-list of staff emails permitted to sign in. When empty, the
  // staff_users table alone governs access; when set, the email must ALSO match.
  staffAllowedEmails: optional('STAFF_ALLOWED_EMAILS', '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Booking-creation cap per IP per 10 minutes. Configurable so a load test or
  // a genuinely busy launch night can be accommodated without a code change.
  bookingRateMax: parseInt(optional('BOOKING_RATE_MAX', '15'), 10),

  // Table pricing lives in the database (pricing_rates + price_overrides) so
  // staff can change it without a deploy — see utils/pricing.ts.

  paymentProvider: optional('PAYMENT_PROVIDER', 'mock'),
  paymentApiKey: process.env.PAYMENT_API_KEY || undefined,

  // Tap Payments. Secret key is server-only and must never reach the client.
  tapSecretKey: process.env.TAP_SECRET_KEY || undefined,
  tapApiBase: optional('TAP_API_BASE', 'https://api.tap.company/v2'),

  // Google Sign-In. When unset, the /api/auth/google endpoint returns 503 and
  // the frontend Google button shows a "not configured" note.
  googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
};

// Fail fast on obviously bad config rather than at first request.
if (env.isProd && env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production.');
}
