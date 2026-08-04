// Central configuration. Secrets come from env; sane dev defaults otherwise.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '../..');

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  // Dev: localhost. Production: bind '::' (IPv6 dual-stack, also accepts IPv4) — Railway's internal
  // networking/healthcheck reaches containers over IPv6, so an IPv4-only 0.0.0.0 bind is unreachable
  // there. '::' covers both. HOST overrides either.
  host: process.env.HOST || ((process.env.NODE_ENV === 'production') ? '::' : '127.0.0.1'),
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
  // حارس المستقبِلين: قائمة عناوين مفصولة بفاصلة يُسمح بالإرسال إليها وحدها. فارغةٌ ⇒ يُمنع كل شيء.
  // ولا يُرفع الحارس إلا بإعلانٍ صريح — كي لا تُرسَل رسائل تجربة إلى موظفين حقيقيين بالخطأ.
  mailAllowlist: String(process.env.SANAD_MAIL_ALLOWLIST || '')
    .split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
  mailUnrestricted: process.env.SANAD_MAIL_UNRESTRICTED === '1',
  // وحسابات المنصة مسموحةٌ تلقائياً — فالقائمة تتحدّث بنفسها ولا تحتاج يداً عند كل حساب جديد.
  // عنوانُ حسابٍ أدخله مديرُ النظام ليُستعمل ليس عنواناً مستورداً من بيانات قديمة، وهو ما بُني
  // الحارس لمنعه. ويُطفأ صراحةً (`=0`) لمن أراد قائمةً مغلقةً باليد وحدها.
  mailAccountsAllowed: process.env.SANAD_MAIL_ACCOUNTS_ALLOWED !== '0',
  smtp: {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    // ── لا مُرسِل افتراضي ──
    // كان الافتراضي `no-reply@evc.com.sa`. وevc.com.sa **نطاقٌ حيّ مملوك لجهةٍ أخرى** (مسجَّل
    // على Namecheap وبريده على Google Workspace)، وليس نطاق الشركة (evc.sa). فأي رسالة تخرج
    // به ترتطم بـSPF/DMARC أو — وهو الأسوأ — تصل صندوقاً لا نملكه ومعها رمز دخول.
    // وخطورة الافتراضي هنا ليست في قيمته بل في **وجوده**: قيمةٌ صامتة تجعل قناة إرسالٍ خاطئة
    // تعمل بلا أن يُخطئ أحد ظاهرياً. فلا افتراض — والإقلاع يتوقف إن نُسي (assertProdSecrets).
    from: process.env.MAIL_FROM || null,
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
    if (config.mailTransport === 'smtp') {
      if (!config.smtp.host) missing.push('SMTP_HOST');
      if (!config.smtp.user) missing.push('SMTP_USER');
      if (!config.smtp.pass) missing.push('SMTP_PASS');
      // المُرسِل يُعلَن ولا يُورَث: بلا MAIL_FROM لا قناةَ إرسال. (شُرح أعلاه.)
      if (!config.smtp.from) missing.push('MAIL_FROM');
      // نطاق الإرسال قرارٌ يُعلَن، لا حالةٌ تُورَث: إمّا قائمة سماح وإمّا إطلاقٌ صريح.
      // بلا أحدهما يتوقف الإقلاع بدل أن يعمل صامتاً وهو يحجب كل رسالة.
      if (!config.mailUnrestricted && !config.mailAllowlist.length) {
        missing.push('SANAD_MAIL_ALLOWLIST (أو SANAD_MAIL_UNRESTRICTED=1 للإطلاق الكامل)');
      }
    }
    if (missing.length) throw new Error('Missing required production secrets: ' + missing.join(', '));
  }
}
