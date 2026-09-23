// Central configuration. Secrets come from env; sane dev defaults otherwise.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '../..');

// ── رقمٌ من البيئة يُتحقَّق منه هنا، لا حيث يُستعمل ───────────────────────────────
// `Number('30 days')` = NaN، و`Number('')` = 0. وكلاهما يصل الحساب صامتاً:
//   · NaN في مهلة الجلسة يجعل `new Date(NaN).toISOString()` رميةً في وسيطة الطلب — أي
//     **٥٠٠ لكل مستخدمٍ داخل**، بينما `/health` و`/ready` و`/login` تبقى خضراء (الثلاثة
//     قبل حلّ الجلسة). منصةٌ تُعلن سلامتها ولا يعملها أحد.
//   · وسقفٌ سالب يقلب مهلة الكنسة إلى المستقبل، فتمحو الجلسات **الحيّة**.
// والدليل التشغيلي يطلب من المُشغِّل كتابة هذه الأرقام بيده — فالتحقّق ليس ترفاً.
// وقيمةٌ لا تصلح تسقط إلى الافتراض المقصود بدل أن تُعطّل المنصة: الفشل مغلق لا قاتل.
// و«فارغ» يعني «غير مضبوط» لا صفراً: `Number('')` و`Number(' ')` كلاهما صفر صحيح، ومُشغّلٌ
// ترك القيمة خاويةً في اللوحة لم يطلب صفراً — وصفرُ خانقِ الكتابة يعني كتابةً مع كل طلب.
// قراءةُ عنوان الخادم والأعلام من نصٍّ يكتبه إنسان — القواعد ولماذا كلٌّ منها في net.js.
const { readHost, readFlag, readText } = await import('./util/net.js');

const num = (raw, fallback, min) => {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

// عنوانُ خادمِ بريدٍ ومنفذُه من متغيّرَين. والمنفذ قد يأتي ملحقاً بالعنوان — فإن جاء من
// الجهتين مختلفاً رُفض ولم يُرجَّح أحدهما: ٤٦٥ و٥٨٧ يختلفان في التشفير أيضاً، فالترجيح
// الصامت يقلب نمط التشفير ويُخرج عطباً يبدو شهادةً معطوبة وهو رقمٌ متعارض.
function smtpHost(rawHost, rawPort, portKey) {
  const h = readHost(rawHost);
  const explicit = rawPort != null && String(rawPort).trim() !== '';
  const fromKey = explicit ? num(rawPort, null, 1) : null;
  let error = h.error;
  if (!error && explicit && fromKey == null) error = `قيمة ${portKey} ليست رقم منفذ صالح`;
  if (!error && h.port != null && fromKey != null && h.port !== fromKey) {
    error = `المنفذ في عنوان الخادم (${h.port}) يخالف ${portKey} (${fromKey}) — وحّدهما`;
  }
  return { host: error ? null : h.host, hostRaw: readText(rawHost), hostError: error, port: h.port ?? fromKey ?? 587 };
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  // Dev: localhost. Production: bind '::' (IPv6 dual-stack, also accepts IPv4) — Railway's internal
  // networking/healthcheck reaches containers over IPv6, so an IPv4-only 0.0.0.0 bind is unreachable
  // there. '::' covers both. HOST overrides either.
  host: process.env.HOST || ((process.env.NODE_ENV === 'production') ? '::' : '127.0.0.1'),
  // Dev DB file; prod would set DATABASE_URL for Postgres (repository layer switches driver).
  dbFile: process.env.SANAD_DB || resolve(ROOT, 'data/sanad.db'),
  // يُقرأ لا يُنسخ خاماً: قيمةٌ من مسافاتٍ وحدها (يُنتجها مسحُ الحقل في لوحة المستضيف)
  // كانت تمرّ نصّاً غير فارغ إلى مُحرّك القاعدة فتُخفق بعبارةٍ غامضة. الآن هي «غير مضبوط».
  databaseUrl: readText(process.env.DATABASE_URL),
  // Session cookie signing secret. MUST be set in prod; ephemeral dev fallback otherwise.
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  sessionCookie: 'sanad_sid',
  // ── الجلسة نافذةُ خمولٍ تتدحرج، لا عدّاداً تنازلياً من لحظة الدخول ──
  // `sessionTtlHours` يبقى اسمَ المتغيّر ومعناه: طول النافذة. الفرق أن النافذة تُجدَّد مع كل
  // نشاط (انظر touchSession) بدل أن تُحسب مرةً واحدة — فمن يعمل لا يُطرَد وهو يعمل، ومن غاب
  // اثنتي عشرة ساعة يعود بدخولٍ جديد كما كان تماماً.
  sessionTtlHours: num(process.env.SESSION_TTL_HOURS, 12, 0.001),
  // والسقفُ المطلق يبقى فوق التدحرج: جلسةٌ نشِطة أبداً ليست جلسةً بل حسابٌ مفتوح. يُحسب من
  // `created_at` فلا يمدّده نشاطٌ مهما طال، وبه يُحدّ أثرُ كعكةٍ مسروقة زمنياً لا بالأمل.
  sessionMaxDays: num(process.env.SESSION_MAX_DAYS, 30, 1),
  // خانقُ الكتابة: التمديد يُكتب مرةً كل هذه الدقائق لكل جلسة لا مع كل طلب. الصفحة الواحدة
  // عشرات الطلبات، وكتابةٌ لكل واحدٍ منها تحوّل قراءةً رخيصة إلى حملٍ دائم على القاعدة.
  sessionTouchMinutes: num(process.env.SESSION_TOUCH_MINUTES, 5, 0),
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
    // العنوان يُقرأ لا يُنسخ خاماً: نُسخ مرةً مع بادئة رابطٍ فأخفقت الترجمة بعبارةٍ تقنية.
    // ويبقى الأصل (`hostRaw`) كي تقتبسه الرسالة، والعلّة (`hostError`) كي تُعرض بدل أن
    // تُكتشف عند أول محاولة إرسال — وهي على القناة الأصلية تعني تعذُّر الدخول للجميع.
    ...smtpHost(process.env.SMTP_HOST, process.env.SMTP_PORT, 'SMTP_PORT'),
    user: readText(process.env.SMTP_USER),
    pass: readText(process.env.SMTP_PASS),
    // ── لا مُرسِل افتراضي ──
    // كان الافتراضي `no-reply@evc.com.sa`. وevc.com.sa **نطاقٌ حيّ مملوك لجهةٍ أخرى** (مسجَّل
    // على Namecheap وبريده على Google Workspace)، وليس نطاق الشركة (evc.sa). فأي رسالة تخرج
    // به ترتطم بـSPF/DMARC أو — وهو الأسوأ — تصل صندوقاً لا نملكه ومعها رمز دخول.
    // وخطورة الافتراضي هنا ليست في قيمته بل في **وجوده**: قيمةٌ صامتة تجعل قناة إرسالٍ خاطئة
    // تعمل بلا أن يُخطئ أحد ظاهرياً. فلا افتراض — والإقلاع يتوقف إن نُسي (assertProdSecrets).
    from: readText(process.env.MAIL_FROM),
    secure: readFlag(process.env.SMTP_SECURE),
  },
  // ── قناة احتياطية ──
  // البريد هو البابُ الوحيد للمنصة: الدخول برمزٍ يصل بالبريد، والدعوة كذلك. فإن سكتت القناة
  // الأولى لم يدخل أحد. ولذلك قناةٌ ثانية بمزوّدٍ **ونطاقٍ** مختلفين — لا نسخةٌ ثانية من
  // الأولى: عطبُ النطاق الأول (SPF/DMARC، حظرُ مزوّد، انقطاع) لا يُصلحه خادمٌ ثانٍ على النطاق
  // نفسه. ولها مُرسِلها الخاص لزاماً: المزوّد الثاني لا يأذن بالإرسال باسم نطاق الأول، فتُرفض
  // الرسالة أو تسقط في المهملات. فراغُ الإعداد = لا قناة احتياطية، وهو وضعٌ صالحٌ ومُعلَن.
  smtpFallback: {
    ...smtpHost(process.env.SMTP_FALLBACK_HOST, process.env.SMTP_FALLBACK_PORT, 'SMTP_FALLBACK_PORT'),
    user: readText(process.env.SMTP_FALLBACK_USER),
    pass: readText(process.env.SMTP_FALLBACK_PASS),
    from: readText(process.env.SMTP_FALLBACK_FROM),
    secure: readFlag(process.env.SMTP_FALLBACK_SECURE),
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

// ── قاعدة البيانات في الإنتاج: لا مهرب ──
// كان ثمّة إعفاء: `STAGING=1` يُسقط اشتراط `DATABASE_URL`. أصلُه ترقيعُ نشرٍ من تموز ٢٠٢٦
// قبل أن توجد Postgres على المستضيف أصلاً، وقد أعلن ADR-0004 بعدها أن SQLite محرّك تطويرٍ
// واختبارٍ لا غير — ولم يُزَل الإعفاء. وخطره أنه **مسلَّحٌ على الخدمة الحيّة الآن**: الرايةُ
// مضبوطة، وإنما يحجبها وجودُ `DATABASE_URL`. فمسحُ ذلك الحقل — لا حذفُه — يُقلع المنصة
// خضراءَ فارغةً على ملفٍ محلّي زائل: كل الحسابات تفشل بالدخول، والمالك وحده يدخل على منصةٍ
// بلا موظفٍ ولا مشروع، ويبدو ذلك فقداناً كاملاً للبيانات. (Postgres سليمةٌ طوال الوقت،
// لكن ما يُكتب في تلك النافذة يضيع مع أول إعادة تشغيل — ولا نسخة احتياطية له.)
// فلا إعفاء: الإنتاج يطلب قاعدةً حقيقية دائماً. والرايةُ نفسها تُترك في اللوحة بلا أثر.
function databaseMissing() {
  return config.databaseUrl ? [] : ['DATABASE_URL'];
}

// تُنادى **قبل أول كتابة** — أي في مطلع الترحيلة، لا عند بناء التطبيق. `assertProdSecrets`
// يعمل بعد أن يكون سكربت الإقلاع قد أنشأ المخطط كاملاً وبذر اثنتي عشرة خطوة في القاعدة
// الخطأ. وهي مقصورةٌ على القاعدة كي لا ترث الترحيلةُ اشتراطاتِ البريد بلا داعٍ.
export function assertProdDatabase() {
  const missing = databaseMissing();
  if (config.env === 'production' && missing.length) {
    throw new Error(`إعداد ناقص للتشغيل: ${missing.join('، ')} — لا تُشغَّل المنصة على قاعدةٍ محلّية في الإنتاج`);
  }
}

export function assertProdSecrets() {
  if (config.env === 'production') {
    const missing = [];
    if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
    missing.push(...databaseMissing());
    if (config.mailTransport === 'smtp') {
      // قيمةٌ خاطئة تُقال بعلّتها لا كغياب: «SMTP_HOST ناقص» لمن ضبطه فعلاً يُرسله يبحث عن
      // حقلٍ موجود. والإقلاع يتوقف هنا عمداً — القناة الأصلية تحكم الدخول كلَّه، وعنوانٌ
      // معطوب فيها يعني منصةً تعمل ولا يستطيع أحدٌ دخولها.
      if (config.smtp.hostError) missing.push(`SMTP_HOST (${config.smtp.hostError})`);
      else if (!config.smtp.host) missing.push('SMTP_HOST');
      if (!config.smtp.user) missing.push('SMTP_USER');
      if (!config.smtp.pass) missing.push('SMTP_PASS');
      // المُرسِل يُعلَن ولا يُورَث: بلا MAIL_FROM لا قناةَ إرسال. (شُرح أعلاه.)
      if (!config.smtp.from) missing.push('MAIL_FROM');
      // والقناة الاحتياطية **لا** تُوقف الإقلاع مهما كانت: قناةٌ اختيارية معطوبة تُسقط
      // المنصة عاقبةٌ أسوأ من العطب الذي تُعالجه. تُقال في السجل وتُعرض في مركز البريد.
      if (config.smtpFallback.hostError) {
        console.error('[config] عنوان خادم القناة الاحتياطية غير صالح —', config.smtpFallback.hostError);
      }
      // نطاق الإرسال قرارٌ يُعلَن، لا حالةٌ تُورَث: إمّا قائمة سماح وإمّا إطلاقٌ صريح.
      // بلا أحدهما يتوقف الإقلاع بدل أن يعمل صامتاً وهو يحجب كل رسالة.
      if (!config.mailUnrestricted && !config.mailAllowlist.length) {
        missing.push('SANAD_MAIL_ALLOWLIST (أو SANAD_MAIL_UNRESTRICTED=1 للإطلاق الكامل)');
      }
      // قناةٌ تُرسل فعلياً وروابطُ رسائلها تشير إلى جهاز المطوّر: كل زرّ «افتح صفحتك» ميت.
      // وقعت فعلاً على staging (رسالة اعتماد حقيقية برابط 127.0.0.1) — فصار الشرط قاطعاً.
      if (/^http:\/\/127\.0\.0\.1|^http:\/\/localhost/.test(config.platformUrl)) {
        missing.push('PLATFORM_URL (روابط الرسائل تشير حالياً إلى جهازٍ محلي)');
      }
    }
    if (missing.length) throw new Error('Missing required production secrets: ' + missing.join(', '));
  }
}
