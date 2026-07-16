// سند — application entry point. Wires middleware, routes, static, error handling.
import express from 'express';
import cookieParser from 'cookie-parser';
import { resolve } from 'node:path';
import { config, ROOT, assertProdSecrets } from './core/config.js';
import { db, close } from './core/db/index.js';
import { loadGrants } from './core/rbac/index.js';
import { stopScheduler } from './core/jobs/scheduler.js';
import { attachContext } from './core/http/context.js';
import { csrf } from './core/http/csrf.js';
import { errorHandler } from './core/http/errors.js';
import { authRouter } from './modules/auth.routes.js';
import { apiRouter } from './modules/api.routes.js';
import { aiRouter } from './modules/ai.routes.js';
import { webRouter } from './web/routes.js';
import { startScheduler } from './core/jobs/scheduler.js';

export function createApp() {
  assertProdSecrets();
  db();          // open DB
  loadGrants();  // load RBAC grants into cache

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(csrf());
  app.use(attachContext());

  app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
  // Readiness: verify DB is reachable (for load balancers / orchestrators).
  app.get('/ready', (req, res) => {
    try { db().prepare('SELECT 1').get(); res.json({ ready: true }); }
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
    app = createApp();
    console.log('▶ boot: startScheduler…');
    startScheduler();
  } catch (e) {
    console.error('!! startup failed in createApp/startScheduler:', e?.stack || e);
    throw e;
  }
  const server = app.listen(config.port, config.host, () => {
    console.log(`✓ سند running at http://${config.host}:${config.port}  (env=${config.env})`);
  });
  server.on('error', (e) => { console.error('!! server.listen error:', e?.stack || e); process.exit(1); });
  // Graceful shutdown: stop accepting, drain, close DB.
  const shutdown = (sig) => {
    console.log(`\n${sig} received — shutting down gracefully…`);
    stopScheduler();
    server.close(() => { try { close(); } catch { /* ignore */ } process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
