// الهوية التنظيمية — ربط سجل الموظف بحساب الدخول (app_user.employee_id).
// معالجات رفيعة → خدمة org، وهي التي تفرض الصلاحية (تعديل الموظف) وتكتب سطور التدقيق.
// يُركَّب داخل apiRouter بسطر واحد من جلسة التكامل، بعد requireAuth().
import { Router } from 'express';
import * as org from './org.js';

export const orgRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

const linkBody = (req) => ({ employeeId: req.params.id, userId: (req.body || {}).user_id || (req.body || {}).userId || null });

// ── حالة الربط (لصفحة «الفريق») ──
orgRouter.get('/org/identity-links', h((req) => org.identityLinks(req.ctx.user, { sector: req.query.sector })));

// ── ربط / فك ربط موظف بحساب دخول ──
orgRouter.post('/employees/:id/link', h((req) => org.linkUserToEmployee(req.ctx, linkBody(req))));
orgRouter.delete('/employees/:id/link', h((req) => org.unlinkUserFromEmployee(req.ctx, { employeeId: req.params.id })));
// نفس المسارين ضمن مساحة org (اتساقاً مع بقية مسارات الهيكل) — نفس الخدمة تماماً
orgRouter.post('/org/employees/:id/link', h((req) => org.linkUserToEmployee(req.ctx, linkBody(req))));
orgRouter.delete('/org/employees/:id/link', h((req) => org.unlinkUserFromEmployee(req.ctx, { employeeId: req.params.id })));
