// الإسناد الإداري — معالجات رفيعة → خدمة attribution، وهي التي تفرض الصلاحية على الصف نفسه،
// وتمنع الإسناد عبر القطاعات، وتكتب سطور التدقيق. لا منطق عمل ولا استعلام هنا.
// يُركَّب داخل apiRouter بسطر واحد من جلسة التكامل، بعد requireAuth().
import { Router } from 'express';
import * as attribution from './attribution.js';

export const attributionRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// مفتاح الإدارة يُمرَّر **فقط إن أرسله العميل**: غيابه خطأ عربي صريح في الخدمة، لا إلغاء إسناد صامت.
// null أو نص فارغ = إلغاء الإسناد (إجراء مشروع ومقصود).
function withDepartment(body, patch) {
  if (Object.hasOwn(body, 'department_id')) return { ...patch, departmentId: body.department_id };
  if (Object.hasOwn(body, 'departmentId')) return { ...patch, departmentId: body.departmentId };
  return patch;
}
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

// ── القراءة ──
// توزيع عمل القطاع على إداراته + دلو «غير مُسند»
attributionRouter.get('/org/rollup', h((req) =>
  attribution.departmentRollup(req.ctx.user, { sectorId: req.query.sector, year: req.query.year })));
// كشف العمل غير المُسند داخل قطاع (kind: opportunity الافتراضي | project | allocation)
attributionRouter.get('/org/unassigned', h((req) =>
  attribution.unassignedWork(req.ctx.user, { sectorId: req.query.sector, kind: req.query.kind, limit: req.query.limit })));

// ── الكتابة ──
attributionRouter.patch('/org/attribution', h((req) => {
  const b = bodyOf(req);
  return attribution.setWorkDepartment(req.ctx, withDepartment(b, { kind: b.kind, id: b.id }));
}));
attributionRouter.patch('/org/attribution/bulk', h((req) => {
  const b = bodyOf(req);
  return attribution.bulkSetWorkDepartment(req.ctx, withDepartment(b, { kind: b.kind, ids: b.ids }));
}));
