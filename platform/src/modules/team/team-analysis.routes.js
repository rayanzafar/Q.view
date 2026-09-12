// تحليل الاستخدام وفحص الحالة والمتابعة (S17/S18) والعمل والالتزامات (S12) — معالجات رفيعة
// تُمرّر إلى خدمتَي analysis وcommitments، وهما اللتان تفرضان الصلاحية وتكتبان التدقيق.
// يُركَّب داخل apiRouter بسطر واحد في api.routes.js (بيد المنسّق).
// المسارات القياسية: docs/team-resources/UI-CONTRACTS.md §4.
import { Router } from 'express';
import * as analysis from './analysis.js';
import * as commitments from './commitments.js';

export const teamAnalysisRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };
const body = (req) => req.body || {};

teamAnalysisRouter.get('/team/analysis', h((req) => analysis.utilizationTable(req.ctx.user, {
  year: req.query.year, month: req.query.month, department: req.query.department,
  signal: req.query.signal, sector: req.query.sector,
})));
// «cases/:caseId/close» قبل «:employeeId/…» — لا تداخل بينهما فعلاً (تختلف الأطوال)، والترتيب للوضوح.
teamAnalysisRouter.post('/team/analysis/cases/:caseId/close', h((req) => analysis.closeCase(req.ctx, req.params.caseId, {
  explanation: body(req).explanation,
})));
teamAnalysisRouter.get('/team/analysis/:employeeId/case', h((req) => analysis.caseDetail(req.ctx.user, req.params.employeeId, {
  year: req.query.year, month: req.query.month,
})));
teamAnalysisRouter.post('/team/analysis/:employeeId/followup', h((req) => {
  const b = body(req);
  return analysis.createFollowup(req.ctx, req.params.employeeId, {
    year: b.year, month: b.month, action_ar: b.action_ar, ownerUserId: b.ownerUserId ?? b.owner_user_id,
    dueDate: b.dueDate ?? b.due_date, note: b.note, signal: b.signal,
  });
}));

// S12 — العمل والالتزامات
teamAnalysisRouter.get('/team/work', h((req) => commitments.teamCommitments(req.ctx.user, {
  year: req.query.year, month: req.query.month, department: req.query.department,
  by: req.query.by || 'work', sector: req.query.sector,
})));
