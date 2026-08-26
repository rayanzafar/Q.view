// سند — application entry point. Wires middleware, routes, static, error handling.
import express from 'express';
import cookieParser from 'cookie-parser';
import { resolve } from 'node:path';
import { config, ROOT, assertProdSecrets } from './core/config.js';
import { close, ping } from './core/db/index.js';
import { initRbac } from './core/rbac/index.js';
import { seedRbac } from '../scripts/seed-rbac.js';
import { stopScheduler } from './core/jobs/scheduler.js';
import { attachContext } from './core/http/context.js';
import { csrf } from './core/http/csrf.js';
import { securityHeaders, loginLimiter, apiLimiter, otpEmailLimiter, otpIpLimiter, otpVerifyLimiter } from './core/http/security.js';
import { errorHandler } from './core/http/errors.js';
import { logError, writeFatalSync, trimStack } from './core/obs/log.js';
import { requestScope, currentScope } from './core/obs/reqctx.js';
import { authRouter } from './modules/auth.routes.js';
import { apiRouter } from './modules/api.routes.js';
import { aiRouter } from './modules/ai.routes.js';
import { webRouter } from './web/routes.js';
import { startScheduler } from './core/jobs/scheduler.js';

export async function createApp() {
  assertProdSecrets();
  // مزامنة منح الأدوار النظامية مع المصفوفة عند كل إقلاع، **قبل** تحميلها في ذاكرة القرار.
  // بدونها كان أي تغيير في مصفوفة الصلاحيات لا يسري على بيئة حيّة إلا بتشغيل سكربت البذر يدوياً،
  // فيبقى انحراف صامت بين ما يقرأه المطوّر وما تنفّذه المنصة — والميزة تُنشَر ولا تعمل بلا رسالة خطأ.
  // آمنة بحكم تصميم البذر نفسه: يعيد ضبط الأدوار النظامية على المصفوفة، وتخصيص المدير يعيش على
  // أدوار مخصصة لا نظامية. وتتم قبل استقبال أي طلب فلا يرى أحد حالة وسيطة.
  await seedRbac();
  await initRbac();  // load RBAC grants into the (synchronous) decision cache

  const app = express();
  app.disable('x-powered-by');       // لا نكشف تقنية الخادم في الترويسات
  // نثق بقفزةٍ واحدة لا بالسلسلة كاملة: حافة Railway قفزةٌ واحدة تضيف عنوان العميل الحقيقي في
  // آخر X-Forwarded-For. `true` كان يثق بالسلسلة كلها فيصير req.ip أقصى اليسار — قيمةٌ يزوّرها
  // العميل، فتنهار حدود الدخول والرمز (تُفتَّت على عناوين مُنتحَلة) ويُزوَّر عنوان سجل التدقيق.
  // `1` يأخذ العنوان الذي أضافته الحافة وحده، فلا يُنتحَل. يُراجَع لو تغيّر عدد قفزات الحافة.
  app.set('trust proxy', 1);
  app.use(securityHeaders());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  // ── الملفات الساكنة قبل **الاثنين** ───────────────────────────────────────────
  // فوق `attachContext` لأنها لا تقرأ `req.ctx`، وفوق `csrf()` لأن الأخير يُصدر كعكة رمزٍ
  // لكل طلبٍ لا يحملها — فكان كل ملف نمطٍ ونصٍّ برمجي يخرج ومعه `Set-Cookie` وهو **قابل
  // للتخزين ساعةً في الإنتاج**. ووسيطٌ مشترك يخزّن ذلك يثبّت رمز حمايةٍ واحداً على كل
  // زائرٍ خلفه، ورمزُ الحماية هنا «إرسالٌ مزدوج» — أي أن معرفته تُبطله.
  app.use('/static', express.static(resolve(ROOT, 'src/web/public'), { maxAge: config.env === 'production' ? '1h' : 0 }));
  // ── سياق الطلب: بعد الملفات الساكنة وقبل كل شيء يمكن لإنسان أن يعثر فيه ──
  // الملفات الساكنة أكثر مرور المنصة وأقلّه إثارةً للاهتمام، ولا تقرأ سياقاً — فلا تدفع
  // إطاراً لكل ملف نمط. وما بعدها كله داخل السياق: الحماية والصحة والجاهزية والصفحات.
  app.use(requestScope());
  app.use(csrf());
  // ── وبقية المسارات العامة **قبل** حلّ الجلسة ──────────────────────────────────
  // `attachContext` يحلّ الجلسة والمستخدم ونطاقه (ستة استعلامات) لكل طلبٍ يمرّ به — وكان
  // يمرّ به كلُّ ملفِّ نمطٍ وصورةٍ ونصٍّ برمجي أيضاً، فالصفحة الواحدة تدفع ثمن الحلّ عشر
  // مرات بلا أن يقرأ أحدٌ نتيجته. ولا شيء من الثلاثة يقرأ `req.ctx`: الفحصان معلنان
  // للموازِن، والملفات الساكنة عامةٌ بحكم كونها ساكنة.
  // ومع التدحرج صار للترتيب أثرٌ ثانٍ: طلبُ صورةٍ لا يُعدّ نشاطاً يُطيل جلسةً منسيّة.
  app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
  // Readiness: verify DB is reachable (for load balancers / orchestrators).
  app.get('/ready', async (req, res) => {
    try { await ping(); res.json({ ready: true }); }
    catch (e) {
      // السبب يُكتب في سجل الخادم لا في الرد: رسائل مُحرّك القاعدة تحمل مضيفاً واسم قاعدة ودوراً،
      // فلا تُسرَّب لمتصل غير موثَّق (نفس مبدأ errors.js: لا تفصيل 5xx يغادر).
      logError('ready_probe_failed', { err_msg: String(e?.message || e).slice(0, 200) });
      res.status(503).json({ ready: false });
    }
  });
  app.use(attachContext());
  app.use('/auth/login', loginLimiter);
  app.use('/auth/login-web', loginLimiter);
  // طلب الرمز: حدٌّ بالبريد وآخر بالعنوان معاً. والتحقق بدلوٍ خاص به لا بدلو كلمة المرور —
  // تحويلة ذاك مشروطة بمساره، فتسقط هنا إلى حمولة خام في وجه متصفّح ينتظر صفحة.
  app.use('/auth/otp/request-web', otpEmailLimiter, otpIpLimiter);
  app.use('/auth/otp/verify-web', otpVerifyLimiter);
  app.use('/api', apiLimiter);

  app.use('/auth', authRouter);
  app.use('/api', apiRouter);
  app.use('/api/ai', aiRouter);
  app.use('/', webRouter);
  app.use(errorHandler());
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // الكتابة إلى أنبوبٍ لا تزامنية على لينكس، و`process.exit` بعدها مباشرةً يقطع ما لم
  // يُنفَذ — فأهمّ سطرٍ في المنصة قد يضيع. النداء المتزامن يصل قبل الخروج.
  process.on('uncaughtException', (e) => {
    writeFatalSync('uncaught_exception', { err_kind: e?.name || null, err_msg: String(e?.message || e).slice(0, 300), stack: trimStack(e) });
    console.error('!! uncaughtException:', e?.stack || e);
    process.exit(1);
  });
  // والرفض غير الملتقَط **لا يُخرج العملية** (قرار موثَّق): تبقى تعمل في نصف حالٍ مجهول.
  // فهو أولى ما يُلتقط بعد أخطاء الطلبات — وكان يكتب سطراً واحداً لا يقرؤه أحد.
  process.on('unhandledRejection', (e) => {
    logError('unhandled_rejection', { err_kind: e?.name || null, err_msg: String(e?.message || e).slice(0, 300), stack: trimStack(e) });
    console.error('!! unhandledRejection:', e?.stack || e);
  });
  let app;
  try {
    console.log('▶ boot: createApp…');
    app = await createApp();
    console.log('▶ boot: startScheduler…');
    startScheduler();
  } catch (e) {
    console.error('!! startup failed in createApp/startScheduler:', e?.stack || e);
    process.exit(1);
  }
  const server = app.listen(config.port, config.host, () => {
    console.log(`✓ سند running at http://${config.host}:${config.port}  (env=${config.env})`);
  });
  server.on('error', (e) => { console.error('!! server.listen error:', e?.stack || e); process.exit(1); });
  // Graceful shutdown: stop accepting, drain, close DB.
  const shutdown = (sig) => {
    console.log(`\n${sig} received — shutting down gracefully…`);
    stopScheduler();
    server.close(async () => { try { await close(); } catch { /* ignore */ } process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
