// سجل الموارد وملف المورد — معالجات رفيعة تُمرّر إلى خدمة `resources.js`، وهي التي تفرض الصلاحية
// (عبر `access.js`) وتكتب التدقيق. يُركَّب داخل apiRouter بسطر واحد بواسطة المنسّق — لا هنا.
// المسارات القياسية كما في docs/team-resources/UI-CONTRACTS.md §4 (الواجهة تُبنى عليها حرفاً).
import { Router } from 'express';
import * as R from './resources.js';

export const teamResourcesRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };
const q = (req, keys) => Object.fromEntries(keys.map((k) => [k, req.query?.[k]]));

// S02 — السجل: الفلاتر والفترة والترقيم كلها من الاستعلام، والخدمة تقصّها على نطاق القارئ.
teamResourcesRouter.get('/team/resources', h((req) => R.listResources(req.ctx.user,
  q(req, ['q', 'sector', 'department', 'type', 'status', 'from', 'to', 'page', 'pageSize']))));
// S09 — إنشاء المورد (يغلّف إنشاء الموظف القائم ويضيف نوعه وجهته وطاقته).
teamResourcesRouter.post('/team/resources', h((req) => R.createResource(req.ctx, req.body || {})));

// S03 — المعاينة الجانبية على مدى أشهر.
teamResourcesRouter.get('/team/resources/:id/preview', h((req) => R.resourcePreview(req.ctx.user, req.params.id, q(req, ['from', 'to']))));
// S04 — ملف المورد لشهرٍ بعينه (`tab=tasks` يضمّ مهامه من ملف الشخص القائم).
teamResourcesRouter.get('/team/resources/:id/profile', h((req) => R.resourceProfile(req.ctx.user, req.params.id, q(req, ['year', 'month', 'tab']))));
// S05 — العمل المرتبط: الحالي أو السابق.
teamResourcesRouter.get('/team/resources/:id/linked-work', h((req) => R.linkedWork(req.ctx.user, req.params.id, q(req, ['window']))));
// S07 — القدرات والخبرات وأهداف التطوير (الجسم يحمل `id` للتعديل).
teamResourcesRouter.get('/team/resources/:id/capabilities', h((req) => R.resourceCapabilities(req.ctx.user, req.params.id)));
teamResourcesRouter.post('/team/resources/:id/capabilities', h((req) => R.upsertCapability(req.ctx, req.params.id, req.body || {})));
teamResourcesRouter.delete('/team/resources/:id/capabilities/:capId', h((req) => R.removeCapability(req.ctx, req.params.id, req.params.capId)));
// S08 — الارتباط والطاقة بإصداراتها.
teamResourcesRouter.get('/team/resources/:id/engagement', h((req) => R.engagement(req.ctx.user, req.params.id)));
teamResourcesRouter.post('/team/resources/:id/capacity', h((req) => R.setCapacity(req.ctx, req.params.id, req.body || {})));
// S09 — تعديل المورد.
teamResourcesRouter.patch('/team/resources/:id', h((req) => R.updateResource(req.ctx, req.params.id, req.body || {})));
// S10 — سجل التغييرات.
teamResourcesRouter.get('/team/resources/:id/audit', h((req) => R.resourceAudit(req.ctx.user, req.params.id, q(req, ['filter', 'limit']))));
// S11 — الهيكل الإداري مع موارد الإدارة المختارة وارتباطاتها المشتركة.
teamResourcesRouter.get('/team/org', h((req) => R.orgResources(req.ctx.user, q(req, ['department', 'q']))));
