// الهوية التنظيمية — ربط سجل الموظف بحساب الدخول (app_user.employee_id).
// معالجات رفيعة → خدمة org، وهي التي تفرض الصلاحية (تعديل الموظف) وتكتب سطور التدقيق.
// يُركَّب داخل apiRouter بسطر واحد من جلسة التكامل، بعد requireAuth().
import { Router } from 'express';
import * as org from './org.js';
import { sectorTargets, saveSectorTargets, savePeriodPlan } from './sector-targets.js';
import * as orgQuality from './org-quality.js';

export const orgRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

const linkBody = (req) => ({ employeeId: req.params.id, userId: (req.body || {}).user_id || (req.body || {}).userId || null });

// ── حالة الربط (لصفحة «الفريق») ──
orgRouter.get('/org/identity-links', h((req) => org.identityLinks(req.ctx.user, { sector: req.query.sector })));

// ── فحص جودة الهيكل (تشخيص فقط، بلا أي تعديل) — نفس صلاحية عرض الهيكل ونطاقها ──
// الخدمة تعيد شكلين للبيانات نفسها: `checks/score/summary` (العرض المعتمد) و`findings/pending`
// (التفصيل الداخلي الذي تُشتَقّ منه الأولى). لا يمكن أن يختلفا — أحدهما مبني من الآخر في النداء
// نفسه — لكن نشرهما معاً يجعل المستهلك يختار عشوائياً فيثبّت العقد على الشكل الخطأ. نثبّت هنا
// عقداً واحداً على الحدود: `checks` هو ما تراه الواجهة، والتفصيل يبقى للخدمة واختباراتها.
const HEALTH_PUBLIC = ['generated_at', 'sectorId', 'company_wide', 'score', 'summary', 'checks', 'totals'];
orgRouter.get('/org/health', h(async (req) => {
  const sector = req.query.sectorId || req.query.sector;
  const r = await orgQuality.orgHealth(req.ctx.user, { sector, sectorId: sector });
  return Object.fromEntries(HEALTH_PUBLIC.filter((k) => k in r).map((k) => [k, r[k]]));
}));

// ── ربط / فك ربط موظف بحساب دخول ──
orgRouter.post('/employees/:id/link', h((req) => org.linkUserToEmployee(req.ctx, linkBody(req))));
orgRouter.delete('/employees/:id/link', h((req) => org.unlinkUserFromEmployee(req.ctx, { employeeId: req.params.id })));
// نفس المسارين ضمن مساحة org (اتساقاً مع بقية مسارات الهيكل) — نفس الخدمة تماماً
orgRouter.post('/org/employees/:id/link', h((req) => org.linkUserToEmployee(req.ctx, linkBody(req))));
orgRouter.delete('/org/employees/:id/link', h((req) => org.unlinkUserFromEmployee(req.ctx, { employeeId: req.params.id })));

// Annual targets: services enforce sector scope and revision checks.
orgRouter.get('/org/sectors/:id/targets', h((req) => sectorTargets(req.ctx.user, { sector: req.params.id, year: req.query.year })));
orgRouter.put('/org/sectors/:id/targets', h((req) => saveSectorTargets(req.ctx, req.params.id, req.body || {})));
// التوزيع الدوري للمستهدف (KI-110): 12 شهراً بمجموعٍ يساوي السنوي، بسبب وإصدار وأثر
orgRouter.put('/org/sectors/:id/targets/plan', h((req) => savePeriodPlan(req.ctx, req.params.id, req.body || {})));
