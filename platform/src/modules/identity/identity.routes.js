// إدارة الهوية — معالجات رفيعة تُمرّر إلى خدمة identity، وهي التي تفرض الصلاحية وتكتب التدقيق.
// يُركَّب داخل apiRouter بسطر واحد في api.routes.js (وحارس التركيب في الاختبارات يلتقط سقوطه).
import { Router } from 'express';
import * as identity from './identity.js';
import * as grants from './grants.js';

export const identityRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

identityRouter.get('/identity/users', h((req) => identity.listUsers(req.ctx.user, {
  query: req.query.query, role: req.query.role, status: req.query.status,
})));
identityRouter.get('/identity/users/:id/logins', h((req) => identity.userLoginHistory(req.ctx.user, req.params.id, { limit: req.query.limit })));

identityRouter.post('/identity/users', h((req) => identity.inviteUser(req.ctx, req.body || {})));
identityRouter.patch('/identity/users/:id', h((req) => identity.updateUser(req.ctx, req.params.id, req.body || {})));
identityRouter.post('/identity/users/:id/resend', h((req) => identity.resendInvite(req.ctx, req.params.id)));
identityRouter.post('/identity/users/:id/active', h((req) => identity.setUserActive(req.ctx, req.params.id, !!(req.body || {}).active)));
identityRouter.post('/identity/users/:id/revoke-sessions', h((req) => identity.revokeSessions(req.ctx, req.params.id)));

// الحذف ومعه فحصُ موانعه قبله — على نمط `/removal-check` للمشروع: تُعرض العاقبة قبل الضغط،
// لا تُقال بعد الرفض. والسبب النصّي يُمرَّر ليُسجَّل في سطر التدقيق.
identityRouter.get('/identity/users/:id/removal-check', h((req) => identity.userRemovalCheck(req.ctx, req.params.id)));
identityRouter.delete('/identity/users/:id', h((req) => identity.removeUser(req.ctx, req.params.id, { reason: (req.body || {}).reason })));

// ── الصلاحيات الشخصية على إدارة ──────────────────────────────────────────────
// «مدير القطاع يقدر يعطي صلاحيات كعينه، ومدير الإدارة يقدر يعطي صلاحيات». والحدّ كله في
// الخدمة (grants.js) لا هنا: المعالج يمرّر ويعيد، والصلاحية والتدقيق تحته.
identityRouter.get('/identity/grants/options', h((req) => grants.grantableDepartments(req.ctx.user,
  req.query.resource || 'opportunity', req.query.action || 'read')
  .then((departments) => ({ departments, grantable: grants.GRANTABLE }))));
identityRouter.get('/identity/grants/:userId', h((req) => grants.listUserGrants(req.ctx.user, req.params.userId)));
identityRouter.post('/identity/grants', h((req) => grants.grantDepartment(req.ctx, req.body || {})));
identityRouter.delete('/identity/grants/:id', h((req) => grants.revokeDepartmentGrant(req.ctx, req.params.id)));
