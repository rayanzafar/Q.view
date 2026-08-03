// Per-request context: resolves the session → user with scope sets used by RBAC.
import { get, all } from '../db/index.js';
import { config } from '../config.js';
import { unauthorized, forbidden } from './errors.js';
import { can } from '../rbac/index.js';
import { readerDepartmentIds } from '../rbac/departments.js';
import { grantsForUser } from '../../modules/identity/grants.js';
import { nowIso } from '../util/ids.js';

export async function resolveUser(sessionId) {
  if (!sessionId) return null;
  const s = await get('SELECT * FROM session WHERE id = ? AND revoked_at IS NULL', [sessionId]);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  const u = await get('SELECT * FROM app_user WHERE id = ? AND active = 1 AND deleted_at IS NULL', [s.user_id]);
  if (!u) return null;
  // نطاق المشروع: ما يملكه المستخدم، أو عضويةٌ فيه، أو **تسكينٌ عليه**.
  //
  // التسكين هو الإضافة. قبلها كان النطاق يُبنى من الملكية والعضوية فقط — والعضوية لا يكتبها أي
  // مسار في المنتج كله (المسار الوحيد الذي يكتب `membership` يكتب نوع «فرصة» لا «مشروع»). فكان
  // الأثر الحيّ أن الموظف المسكَّن على مشروع منذ شهور لا يفتح صفحته ولا مهامه ولا مخرجاته: كل
  // منح `scope:'project'` — وهو كامل صلاحيات المستشار والموظف — يسقط مغلقاً. وكان الالتفاف
  // موضعياً في شاشة واحدة (`myProjectsInSector`) تجمع قائمة الصلاحيات مع قراءة تسكين مباشرة،
  // فتعمل تلك الشاشة وحدها ويبقى الباقي مغلقاً. المصدر هنا واحد فتنفتح كل الأسطح معاً.
  //
  // بلا حدّ زمني عن قصد: من عمل على مشروع في سنة ماضية يبقى مؤهلاً لقراءته — التسكين المنتهي
  // يسحب العمل لا الذاكرة. والحذف الناعم يُستبعَد من الطرفين (التسكين والمشروع) فلا يمنح صفٌّ
  // ملغى وصولاً.
  const projectIds = new Set((await all('SELECT id FROM project WHERE owner_user_id = ?', [u.id])).map((r) => r.id));
  if (u.employee_id) {
    for (const r of await all(
      `SELECT m.group_id AS pid FROM membership m
         WHERE m.employee_id = ? AND m.group_kind = 'project' AND m.deleted_at IS NULL
       UNION
       SELECT a.project_id AS pid FROM allocation a
         JOIN project p ON p.id = a.project_id AND p.deleted_at IS NULL
         WHERE a.employee_id = ? AND a.project_id IS NOT NULL AND a.deleted_at IS NULL`,
      [u.employee_id, u.employee_id]
    )) projectIds.add(r.pid);
  }
  // department_id lives on `employee`, not `app_user` (which has no such column) — resolve it via
  // the employee link so department-scoped grants (e.g. department_manager) are checkable at all;
  // previously always null here, which made scopeReaches()'s 'department' case vacuously true.
  const emp = u.employee_id ? await get('SELECT department_id FROM employee WHERE id = ?', [u.employee_id]) : null;
  // ── إداراته: انتماؤه **ومع** ما يقوده ────────────────────────────────────────
  // `department_id` يبقى كما هو (انتماؤه وحده) لأن شاشاتٍ تعرضه وتُسنِد به. أما **الصلاحية**
  // فتُقرأ من المجموعة: من يقود إدارتين — واسم مسمّاه يقول ذلك صراحةً — كان يفتح لوحة فريقه
  // فلا يجد أهل إدارته الثانية، ويفتح ملف أحدهم فيُرَدّ «خارج إدارتك» وهو مديره. القيادة
  // مكتوبة في `department.manager_user_id` منذ أول إصدار ولم تكن تُقرأ في أي فحص نطاق.
  const departmentIds = await readerDepartmentIds(u.id, emp?.department_id || null);
  // ── الصلاحيات الشخصية على إدارة ──────────────────────────────────────────────
  // «ممكن أنا أحطّ على سجى إنها تشوف كل فرص إدارة الابتكار» — استثناءٌ على الشخص لا ترقيةٌ
  // لدوره. ويُقرأ **هنا** مع كل طلب لا في ذاكرة المحرّك عند الإقلاع: صلاحيةٌ تُمنَح وتُرفَع
  // أثناء يوم العمل، ومنحٌ لا يبدأ أثره إلا بعد إعادة تشغيل الخادم لا يصلح لأن يُدار من شاشة.
  // (وهي إضافةٌ صرفة في `can`/`scopeFilter` — لا تسلب وصولاً، ولا تمسّ `effectiveScope` فلا
  // يتحوّل اتساع الدور نفسه بها.)
  const departmentGrants = await grantsForUser(u.id);
  // فرصُ تسكينه — نظير `projectIds` أعلاه: من سُكِّن على فرصة يقرؤها. والحالة «بانتظار تأكيد
  // مديره» تُقرأ أيضاً: مَن أُضيف إلى فريقٍ يحتاج أن يرى ما أُضيف إليه ليقول رأيه فيه، والتأكيد
  // يحكم احتساب الحِمل لا حجب الصفحة.
  const opportunityIds = new Set(u.employee_id ? (await all(
    `SELECT group_id FROM membership
      WHERE group_kind = 'opportunity' AND employee_id = ? AND deleted_at IS NULL`,
    [u.employee_id])).map((r) => r.group_id) : []);
  return {
    id: u.id,
    username: u.username,
    role_id: u.role_id,
    sector_id: u.sector_id,
    department_id: emp?.department_id || null,
    departmentIds,
    departmentGrants,
    opportunityIds,
    scope: u.scope,
    employee_id: u.employee_id,
    name_ar: u.name_ar,
    name_en: u.name_en,
    projectIds,
    teamIds: new Set(),
  };
}

// Express middleware factories
export function attachContext() {
  return async (req, res, next) => {
    try {
      const sid = req.cookies?.[config.sessionCookie];
      req.ctx = { user: await resolveUser(sid), ip: req.ip, sessionId: sid };
      next();
    } catch (e) { next(e); }
  };
}

export function requireAuth() {
  return (req, res, next) => {
    if (!req.ctx?.user) return next(unauthorized());
    next();
  };
}

// Guard a route by (resource, action). Row-level scope is enforced inside handlers
// via can(user, action, resource, targetRow) when a specific record is touched.
export function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.ctx?.user) return next(unauthorized());
    if (!can(req.ctx.user, action, resource)) return next(forbidden());
    next();
  };
}
