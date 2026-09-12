// الاحتياجات القادمة ومقارنة المرشحين (S19–S21) — معالجات رفيعة تُمرّر إلى خدمة needs، وهي التي
// تفرض الصلاحية وتكتب التدقيق. يُركَّب داخل apiRouter بسطر واحد في api.routes.js (بيد المنسّق).
// المسارات القياسية: docs/team-resources/UI-CONTRACTS.md §4.
import { Router } from 'express';
import * as needs from './needs.js';

export const teamNeedsRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };
const body = (req) => req.body || {};

teamNeedsRouter.get('/team/needs', h((req) => needs.listNeeds(req.ctx.user, {
  from: req.query.from, to: req.query.to, department: req.query.department,
  status: req.query.status, certainty: req.query.certainty, sector: req.query.sector,
})));
teamNeedsRouter.post('/team/needs', h((req) => needs.createNeed(req.ctx, body(req))));
teamNeedsRouter.get('/team/needs/:id', h((req) => needs.getNeed(req.ctx.user, req.params.id)));
teamNeedsRouter.patch('/team/needs/:id', h((req) => needs.updateNeed(req.ctx, req.params.id, body(req))));
teamNeedsRouter.post('/team/needs/:id/cancel', h((req) => needs.cancelNeed(req.ctx, req.params.id, { reason: body(req).reason })));
teamNeedsRouter.get('/team/needs/:id/candidates', h((req) => needs.candidates(req.ctx.user, req.params.id, {
  department: req.query.department, q: req.query.q,
})));
teamNeedsRouter.post('/team/needs/:id/request', h((req) => {
  const b = body(req);
  return needs.requestFromCandidate(req.ctx, req.params.id, b.employeeId ?? b.employee_id, {
    pct: b.pct, allocStatus: b.allocStatus ?? b.alloc_status, idempotencyKey: b.idempotencyKey,
  });
}));
