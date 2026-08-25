// Per-request context: resolves the session → user with scope sets used by RBAC.
import { get, all } from '../db/index.js';
import { config } from '../config.js';
import { unauthorized, forbidden } from './errors.js';
import { can } from '../rbac/index.js';
import { managedDepartmentIds } from '../rbac/departments.js';
import { grantsForUser } from '../../modules/identity/grants.js';
import { touchSession } from '../auth/service.js';
import { setSessionCookie } from './session-cookie.js';

// الجلسة الحيّة وحدها — مفصولةٌ عن حلّ المستخدم لأن `attachContext` يحتاج **الصفّ نفسه**
// (لا صاحبه فقط) كي يدحرج مهلته: بلا الفصل كان الطريق الوحيد قراءةً ثانية لنفس الصفّ.
export async function loadSession(sessionId) {
  if (!sessionId) return null;
  const s = await get('SELECT * FROM session WHERE id = ? AND revoked_at IS NULL', [sessionId]);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  return s;
}

// بالمعرّف — التوقيع الذي تناديه مسارات الدخول مباشرةً بعد إنشاء الجلسة.
export async function resolveUser(sessionId) {
  return await resolveUserFromSession(await loadSession(sessionId));
}

// بصفٍّ محمَّل — لمن قرأ الجلسة أصلاً (`attachContext`) فلا يقرؤها مرتين. مفصولٌ عن نظيره
// أعلاه بدل توقيعٍ يقبل الاثنين: دالةٌ تخمّن نوع وسيطها تصمت على الخطأ بدل أن تكشفه.
export async function resolveUserFromSession(s) {
  if (!s) return null;
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
  //
  // استعلامٌ واحد يغذّي مجموعتين: «ما يقوده» تُحفظ وحدها أيضاً (`managedDepartmentIds`) لأن
  // توسعة «من يقود إدارةً يقرأ فرصها» تُبنى من القيادة لا من الانتماء — موظفٌ انتماؤه إلى
  // إدارةٍ ليس قارئاً لفرصها بمجرد الانتماء. و`departmentIds` = القيادة ∪ الانتماء كما كانت.
  const managed = await managedDepartmentIds(u.id);
  const departmentIds = new Set(managed);
  if (emp?.department_id) departmentIds.add(emp.department_id);
  // ── الصلاحيات الشخصية على إدارة ──────────────────────────────────────────────
  // «ممكن أنا أحطّ على سجى إنها تشوف كل فرص إدارة الابتكار» — استثناءٌ على الشخص لا ترقيةٌ
  // لدوره. ويُقرأ **هنا** مع كل طلب لا في ذاكرة المحرّك عند الإقلاع: صلاحيةٌ تُمنَح وتُرفَع
  // أثناء يوم العمل، ومنحٌ لا يبدأ أثره إلا بعد إعادة تشغيل الخادم لا يصلح لأن يُدار من شاشة.
  // (وهي إضافةٌ صرفة في `can`/`scopeFilter` — لا تسلب وصولاً، ولا تمسّ `effectiveScope` فلا
  // يتحوّل اتساع الدور نفسه بها.)
  const departmentGrants = await grantsForUser(u.id);
  // فرصُ تسكينه — نظير `projectIds` أعلاه: من سُكِّن على فرصة يقرؤها. والعضوية «بانتظار
  // تأكيد مديره» **لا تُقرأ**: القاعدة المعتمدة (B8، وعمارة المنصة الموثَّقة) أن لا عضوية
  // ولا وصول قبل الموافقة — الطلب المعلَّق وعدٌ لم يُبرَم، وقراءة الفرصة قبل موافقة مديره
  // تجعل الرفض بلا معنى. (كان الضمّ متعمَّداً قديماً ليقول المضاف رأيه؛ حسم قرار v5.24
  // العكس، وسجلّه في docs/opportunities-redesign/decision-log.md ق2.)
  const opportunityIds = new Set(u.employee_id ? (await all(
    `SELECT group_id FROM membership
      WHERE group_kind = 'opportunity' AND employee_id = ? AND deleted_at IS NULL
        AND COALESCE(status, 'ACTIVE') != 'PENDING'`,
    [u.employee_id])).map((r) => r.group_id) : []);
  return {
    id: u.id,
    username: u.username,
    role_id: u.role_id,
    sector_id: u.sector_id,
    department_id: emp?.department_id || null,
    departmentIds,
    managedDepartmentIds: managed,
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
//
// ويدحرج المهلة مع النشاط: الصفّ يُقرأ مرةً واحدة، ويُمرَّر إلى `resolveUserFromSession` فلا قراءة
// ثانية، ثم تُدفع مهلتُه (بخانقها وسقفها — انظر touchSession). والكعكة تُجدَّد مع الصفّ:
// لو امتدّ الصفُّ وحده لانتهت الكعكة في موعدها الأول فتوقّف المتصفّح عن إرسالها — أي
// الطردُ نفسه الذي جاء التدحرج ليمنعه.
export function attachContext() {
  return async (req, res, next) => {
    try {
      const sid = req.cookies?.[config.sessionCookie];
      const session = await loadSession(sid);
      const user = await resolveUserFromSession(session);
      // التمديد لمن ثبتت هويته وحده: صفٌّ حيٌّ صاحبُه معطَّل أو محذوف لا يُمدَّد.
      if (session && user) {
        const before = session.expires_at;
        if (await touchSession(session) !== before) {
          // كعكة الجلسة كانت تُصدَر في ردَّين اثنين لا غير (تحويلتا الدخول)، وصارت مع
          // التدحرج تركب كل صفحةٍ وكل ردٍّ تقريباً. ولا شيء في المكدّس يضبط التخزين —
          // فأي وسيطٍ مشترك (وكيل الشركة، حافة، طبقة تخزينٍ تُضاف غداً) يخزّن صفحةً
          // ٢٠٠ بترويستها يسلّم **كعكة موظّفٍ لزائرٍ آخر**. `no-store` مع الإصدار.
          res.setHeader('Cache-Control', 'no-store');
          setSessionCookie(res, sid);
        }
      }
      req.ctx = { user, ip: req.ip, sessionId: sid };
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
