// موجّه الإقفال الشهري (S22–S25) — معالجات رفيعة تُمرّر إلى خدمة cost-close، وهي التي تفرض
// الصلاحية وتكتب الأثر. يُركَّب داخل apiRouter بسطرٍ واحد في api.routes.js (بواسطة المنسّق).
// المسارات مطابقة حرفاً لجدول docs/team-resources/UI-CONTRACTS.md §4.
import { Router } from 'express';
import * as close from './cost-close.js';

export const teamCloseRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };
const body = (req) => req.body || {};

// S22 — نظرة الشهر (تُنشئ المسودة إن لم توجد)
// طلبٌ وصل من موقعٍ آخر (Sec-Fetch-Site: cross-site) يقرأ ولا يُنشئ — القراءة الصرفة لا تُعطى أثراً.
const sameSite = (req) => String(req.get('sec-fetch-site') || '').toLowerCase() !== 'cross-site';
teamCloseRouter.get('/team/close', h((req) => close.periodOverview(req.ctx.user, {
  sector: req.query.sector, year: req.query.year, month: req.query.month, period: req.query.period,
  mutate: sameSite(req), ip: req.ctx.ip || null,
})));

// توليد المسودة صراحةً — `preserveConfirmed` افتراضه صحيح (لا يمسّ المؤكد)
teamCloseRouter.post('/team/close/:periodId/draft', h((req) => close.generateDraft(req.ctx, req.params.periodId, {
  preserveConfirmed: body(req).preserveConfirmed === undefined ? true : body(req).preserveConfirmed,
})));

// S23 — توزيع موردٍ واحد وتأكيده
teamCloseRouter.get('/team/close/:periodId/resources/:employeeId',
  h((req) => close.resourceShares(req.ctx.user, req.params.periodId, req.params.employeeId)));
teamCloseRouter.post('/team/close/:periodId/resources/:employeeId/confirm',
  h((req) => close.confirmShares(req.ctx, req.params.periodId, req.params.employeeId, {
    lines: body(req).lines, reason: body(req).reason, sourceRef: body(req).sourceRef,
  })));

// S24 — الإرسال والإعادة والإقفال
teamCloseRouter.post('/team/close/:periodId/send', h((req) => close.sendToFinance(req.ctx, req.params.periodId)));
teamCloseRouter.post('/team/close/:periodId/return', h((req) => close.returnToManager(req.ctx, req.params.periodId, body(req).reason)));
teamCloseRouter.post('/team/close/:periodId/lock', h((req) => close.lockPeriod(req.ctx, req.params.periodId, { expectedVersion: body(req).expectedVersion })));

// التصدير: ملف CSV من اللقطة المقفلة — UTF-8 مع علامة الترتيب كي لا تتشوه العربية في Excel،
// واسم الملف من الخدمة (يحمل القطاع والشهر والإصدار). «لا يُخزَّن» لأنه بيانات إقفالٍ مالي.
teamCloseRouter.get('/team/close/:periodId/export', async (req, res, next) => {
  try {
    const { filename, csv } = await close.exportPeriod(req.ctx.user, req.params.periodId);
    const ascii = String(filename).replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send('\ufeff' + csv);
  } catch (e) { next(e); }
});

// S25 — التصحيح بعد الإقفال وقراره
teamCloseRouter.post('/team/close/:periodId/resources/:employeeId/correction',
  h((req) => close.createCorrection(req.ctx, req.params.periodId, req.params.employeeId, {
    proposed: body(req).proposed, reason: body(req).reason, evidenceLabel: body(req).evidenceLabel,
  })));
teamCloseRouter.post('/team/close/corrections/:id/decide',
  h((req) => close.decideCorrection(req.ctx, req.params.id, body(req).action, body(req).note)));
