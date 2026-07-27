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
import { securityHeaders, loginLimiter, apiLimiter } from './core/http/security.js';
import { errorHandler } from './core/http/errors.js';
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
  // تحصين مؤجَّل: `true` يثق بكامل سلسلة X-Forwarded-For؛ يُفضَّل تثبيته لاحقاً على عدد قفزات
  // الحافة الفعلي (Railway = قفزة واحدة، مؤكَّد من ترويسة x-railway-edge) كي لا يُنتحَل
  // req.ip المُستخدَم في حدّ الدخول وفي عنوان سجل التدقيق. لا يُغيَّر قبل تأكيد عدد القفزات في كل بيئة.
  app.set('trust proxy', true);
  app.use(securityHeaders());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(csrf());
  app.use(attachContext());
  app.use('/auth/login', loginLimiter);
  app.use('/auth/login-web', loginLimiter);
  app.use('/api', apiLimiter);

  app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
  // Readiness: verify DB is reachable (for load balancers / orchestrators).
  app.get('/ready', async (req, res) => {
    try { await ping(); res.json({ ready: true }); }
    catch (e) { res.status(503).json({ ready: false, error: e.message }); }
  });
  app.use('/static', express.static(resolve(ROOT, 'src/web/public'), { maxAge: config.env === 'production' ? '1h' : 0 }));
  app.use('/auth', authRouter);
  app.use('/api', apiRouter);
  app.use('/api/ai', aiRouter);
  app.use('/', webRouter);
  app.use(errorHandler());
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('uncaughtException', (e) => { console.error('!! uncaughtException:', e?.stack || e); process.exit(1); });
  process.on('unhandledRejection', (e) => { console.error('!! unhandledRejection:', e?.stack || e); });
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
