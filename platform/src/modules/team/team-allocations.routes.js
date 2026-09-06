// التخطيط وطلبات التسكين (S13–S16) — معالجات رفيعة تمرّر إلى خدمة allocations، وهي التي تفرض
// الصلاحية وتكتب التدقيق. يُركَّب داخل apiRouter بسطر واحد بواسطة المنسّق (لا يُعدَّل api.routes.js هنا).
// المسارات مطابقة لـ docs/team-resources/UI-CONTRACTS.md §4 حرفاً.
import { Router } from 'express';
import * as allocations from './allocations.js';

export const teamAllocationsRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// S13 — المصفوفة
teamAllocationsRouter.get('/team/planning', h((req) => allocations.planningMatrix(req.ctx.user, {
  from: req.query.from, to: req.query.to, sector: req.query.sector, department: req.query.department, q: req.query.q,
  showTentative: req.query.showTentative == null ? true : !['0', 'false', 'no'].includes(String(req.query.showTentative).toLowerCase()),
})));

// S14/S15 — المعاينة (الجسم = التغيير نفسه)
teamAllocationsRouter.post('/team/allocations/preview', h((req) => allocations.previewChange(req.ctx.user, req.body || {})));

// الإرسال { change, idempotencyKey, expectedFingerprints, draft, needId }
teamAllocationsRouter.post('/team/allocations/requests', h((req) => {
  const b = req.body || {};
  return allocations.submitRequest(req.ctx, b.change || {}, {
    idempotencyKey: b.idempotencyKey, expectedFingerprints: b.expectedFingerprints || null, draft: !!b.draft, needId: b.needId || null,
  });
}));

// S16 — القائمة والطلب الواحد
teamAllocationsRouter.get('/team/allocations/requests', h((req) => allocations.listRequests(req.ctx.user, {
  filter: req.query.filter || 'all', q: req.query.q, from: req.query.from, to: req.query.to, status: req.query.status,
})));
teamAllocationsRouter.get('/team/allocations/requests/:id', h((req) => allocations.getRequest(req.ctx.user, req.params.id)));

// القرار والسحب
teamAllocationsRouter.post('/team/allocations/requests/:id/decide', h((req) => allocations.decideRequest(req.ctx, req.params.id,
  (req.body || {}).action, (req.body || {}).note)));
teamAllocationsRouter.post('/team/allocations/requests/:id/withdraw', h((req) => allocations.withdrawRequest(req.ctx, req.params.id)));
