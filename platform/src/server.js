// سند — application entry point. Wires middleware, routes, static, error handling.
import express from 'express';
import cookieParser from 'cookie-parser';
import { resolve } from 'node:path';
import { config, ROOT, assertProdSecrets } from './core/config.js';
import { db } from './core/db/index.js';
import { loadGrants } from './core/rbac/index.js';
import { attachContext } from './core/http/context.js';
import { errorHandler } from './core/http/errors.js';
import { authRouter } from './modules/auth.routes.js';
import { apiRouter } from './modules/api.routes.js';
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
  app.use(attachContext());

  app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
  app.use('/static', express.static(resolve(ROOT, 'src/web/public'), { maxAge: '1h' }));
  app.use('/auth', authRouter);
  app.use('/api', apiRouter);
  app.use('/', webRouter);
  app.use(errorHandler());
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  startScheduler();
  app.listen(config.port, config.host, () => {
    console.log(`✓ سند running at http://${config.host}:${config.port}  (env=${config.env})`);
  });
}
