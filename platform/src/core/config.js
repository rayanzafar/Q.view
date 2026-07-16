// Central configuration. Secrets come from env; sane dev defaults otherwise.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '../..');

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  // Bind localhost in dev (safe default); bind all interfaces in production so a PaaS
  // (Railway/Render/Docker) can route external traffic to the container. HOST overrides either.
  host: process.env.HOST || ((process.env.NODE_ENV === 'production') ? '0.0.0.0' : '127.0.0.1'),
  // Dev DB file; prod would set DATABASE_URL for Postgres (repository layer switches driver).
  dbFile: process.env.SANAD_DB || resolve(ROOT, 'data/sanad.db'),
  databaseUrl: process.env.DATABASE_URL || null,
  // Session cookie signing secret. MUST be set in prod; ephemeral dev fallback otherwise.
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  sessionCookie: 'sanad_sid',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  csrfCookie: 'sanad_csrf',
  // Auth policy
  bcryptRounds: 12, // documented target; dev uses scrypt (no native dep) — see auth/password.js
  maxFailedAttempts: 6,
  lockMinutes: 15,
  // Mail transport: 'preview' (dev, writes .html to data/outbox) | 'smtp' (prod)
  mailTransport: process.env.MAIL_TRANSPORT || 'preview',
  smtp: {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    from: process.env.MAIL_FROM || 'Sanad Platform <no-reply@evc.com.sa>',
  },
  platformUrl: process.env.PLATFORM_URL || 'http://127.0.0.1:4000',
  // AI: provider-agnostic; disabled unless a key is present. Governed (preview/audit/scope).
  ai: {
    enabled: !!process.env.OPENAI_API_KEY,
    provider: process.env.AI_PROVIDER || 'openai',
    apiKey: process.env.OPENAI_API_KEY || null,
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  },
  defaultLocale: 'ar',
  currency: 'SAR',
  fiscalYear: Number(process.env.FISCAL_YEAR || 2026),
};

export function assertProdSecrets() {
  if (config.env === 'production') {
    const missing = [];
    if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
    // DATABASE_URL (Postgres) is required only for a full production deploy. A staging environment
    // runs on the built-in SQLite driver — set STAGING=1 to opt into SQLite-in-production and skip it.
    const sqliteStaging = process.env.STAGING === '1' || process.env.STAGING === 'true';
    if (!config.databaseUrl && !sqliteStaging) missing.push('DATABASE_URL');
    if (config.mailTransport === 'smtp' && !config.smtp.host) missing.push('SMTP_HOST');
    if (missing.length) throw new Error('Missing required production secrets: ' + missing.join(', '));
  }
}
