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

  databaseUrl: process.env.DATABASE_URL || undefined,

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '8h'),
  cookieSecure: optional('COOKIE_SECURE', 'false') === 'true',

  tableFeeCents: parseInt(optional('TABLE_FEE_CENTS', '500'), 10),

  paymentProvider: optional('PAYMENT_PROVIDER', 'mock'),
  paymentApiKey: process.env.PAYMENT_API_KEY || undefined,
};

// Fail fast on obviously bad config rather than at first request.
if (env.isProd && env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production.');
}
