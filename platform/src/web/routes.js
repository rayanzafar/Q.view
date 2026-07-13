// SSR page routes + web-form auth handlers + report preview.
import { Router } from 'express';
import { login, logout } from '../core/auth/service.js';
import { config } from '../core/config.js';
import * as P from './pages.js';
import { buildReport, renderReport, enqueueReport, createSchedule } from '../core/reports/engine.js';
import { canSeeSensitive } from '../core/rbac/index.js';

export const webRouter = Router();

function requireWeb(req, res, next) {
  if (!req.ctx?.user) return res.redirect('/login');
  next();
}

webRouter.get('/login', (req, res) => res.send(P.loginPage(req.query.e ? 'بيانات الدخول غير صحيحة' : '')));

webRouter.post('/auth/login-web', (req, res) => {
  const r = login({ username: req.body.username, password: req.body.password, ip: req.ip, userAgent: req.get('user-agent') });
  if (!r.ok) return res.redirect('/login?e=1');
  res.cookie(config.sessionCookie, r.sessionId, { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', maxAge: config.sessionTtlHours * 3600000, path: '/' });
  res.redirect('/app/' + (r.user.scope === 'company' ? 'ceo' : 'tasks'));
});

webRouter.post('/auth/logout-web', (req, res) => {
  logout(req.cookies?.[config.sessionCookie]);
  res.clearCookie(config.sessionCookie, { path: '/' });
  res.redirect('/login');
});

webRouter.get('/', (req, res) => res.redirect(req.ctx?.user ? '/app/ceo' : '/login'));

const PAGES = {
  ceo: P.ceoPage, portfolio: P.portfolioPage, sector: P.sectorPage, opportunities: P.opportunitiesPage,
  projects: P.projectsPage, tasks: P.tasksPage, timesheet: P.timesheetPage, approvals: P.approvalsPage,
  team: P.teamPage, users: P.usersPage, audit: P.auditPage, reports: P.reportsPage, org: P.orgPage,
  finance: P.financePage,
};

webRouter.get('/app/contract/:id', requireWeb, (req, res, next) => {
  try { res.send(P.contractDetailPage(req.ctx.user, req.params.id)); } catch (e) { next(e); }
});
webRouter.get('/app/project/:id', requireWeb, (req, res, next) => {
  try { res.send(P.projectDetailPage(req.ctx.user, req.params.id)); } catch (e) { next(e); }
});

webRouter.get('/app/:page', requireWeb, (req, res, next) => {
  const fn = PAGES[req.params.page];
  if (!fn) return res.redirect('/app/tasks');
  try { res.send(fn(req.ctx.user, { year: req.query.year })); } catch (e) { next(e); }
});

// Report preview (renders template HTML with the caller's redacted data)
webRouter.get('/app/reports/preview/:key', requireWeb, (req, res, next) => {
  try {
    const data = buildReport(req.params.key, req.ctx.user, { sectorId: req.ctx.user.sector_id });
    const { html } = renderReport(req.params.key, data);
    res.send(html);
  } catch (e) { next(e); }
});

// Test-send (enqueues to the preview outbox for the current user)
webRouter.post('/app/reports/test-send/:key', requireWeb, (req, res, next) => {
  try {
    const ids = enqueueReport(req.params.key, { recipientUserIds: [req.ctx.user.id], sectorId: req.ctx.user.sector_id });
    res.json({ ok: true, queued: ids.length });
  } catch (e) { next(e); }
});

// Create a report schedule
webRouter.post('/app/reports/schedule', requireWeb, (req, res, next) => {
  try { res.json(createSchedule(req.ctx, req.body || {})); }
  catch (e) { next(e); }
});
