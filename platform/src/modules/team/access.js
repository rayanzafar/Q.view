// ── بوابات وحدة الفريق والموارد — سؤالٌ واحد لكل قدرة، في مكانٍ واحد ────────────────────
//
// «حوّل جدول الأدوار إلى قدرات واضحة مع نطاقات بيانات، ووفّقه مع نظام الصلاحيات الموجود.
//  اسم الدور وحده لا يكفي» — الموجّه §10. فكل شاشةٍ وواجهةٍ في الوحدة تسأل هذه الدوال لا
// دورَ المستخدم، وتُطبَّق على الصفوف والحقول والعدادات والتصدير معاً (§10: إخفاء زرٍّ لا يكفي).
//
// قواعد المورد الأربع:
//   ① **الرؤية**: من يقرأ الموظفين في نطاقه (peopleScope — القطاع، أو إداراته) يرى المورد؛
//      وصاحبُ الحساب يرى ملفه دائماً بلا منح.
//   ② **أسماء الأعمال بلا مال**: من يرى المورد يرى أسماء ما يعمل عليه (مشروع/بند/فرصة)
//      وفتراته ونسبه — لا قيمة عقدٍ ولا فاتورة ولا هامش. المال بصلاحية مصدره (§10، HR).
//   ③ **التخطيط**: من يملك أمر الموظف (ownsEmployee) يؤكّد تسكينه مباشرةً بأثرٍ محفوظ؛
//      ومن يملك «طلب تسكين» في نطاقه يطلب ويُعتمد له من مدير المورد (S14/S16).
//   ④ **المال**: مراجعة المدير لمن يقود إدارة/قطاع المورد (cost_close تحديث)، والمراجعة
//      المالية والإقفال والتصدير لمن يملك اعتماد `cost_close` (مكتب الرئيس التنفيذي/مدير النظام).
import { get } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { inDepartmentScope, departmentScope, departmentInSql } from '../../core/rbac/departments.js';
import { forbidden, notFound } from '../../core/http/errors.js';
import { peopleScope } from '../org/org.js';
import { ownsEmployee } from '../org/confirm.js';
import { seesDemoAccounts, notDemoEmployeeSql } from '../org/people.js';

export const RESOURCE_TYPES = ['internal', 'external', 'partner'];
export const RESOURCE_TYPE_AR = Object.freeze({ internal: 'داخلي', external: 'خارجي', partner: 'شريك' });
// النوع الفعلي: العمود الجديد، وإلا يُشتق من نوع التوظيف القائم (أساسي/موسمي ⇒ داخلي، متعاقد ⇒ خارجي).
export function resourceTypeOf(emp) {
  const t = String(emp?.resource_type || '').toLowerCase();
  if (RESOURCE_TYPES.includes(t)) return t;
  return String(emp?.employment_type || '') === 'متعاقد' ? 'external' : 'internal';
}

/** هل يقرأ القارئ الموارد أصلاً (بوابة الوحدة كلها = بوابة صفحة «الفريق»). */
export const canReadResources = (user) => !!user && (user.role_id === 'admin' || can(user, 'read', 'employee'));

/**
 * هل يخطّط على الموارد: من يقرأ الفريق، **أو** من يملك «طلب تسكين» أو كتابة التسكين بلا قراءة
 * الموظفين — مدير المشروع بنطاق «مشروع» (الموجّه §10: «إنشاء الاحتياج وطلب الموارد… لا بيانات
 * موارد أخرى المالية»). هؤلاء يرون في مصفوفة التسكين ومرشّحي الاحتياج **زملاء قطاعهم** بأسمائهم
 * وطاقتهم ومتاحهم — لا مال ولا ملفاً (سجل الموارد وملف المورد يبقيان لمن يقرأ الموظفين). وهو
 * السياج نفسه الذي يقبل به طلبهم (allocations.requestGate)؛ وإلا طُلب تسكينٌ على مجهولٍ لا يُرى متاحه.
 */
export const canPlanResources = (user) => canReadResources(user)
  || (!!user && (can(user, 'create', 'allocation_request') || can(user, 'create', 'allocation') || can(user, 'update', 'allocation')));
const isPlannerOnly = (user) => !!user && !canReadResources(user) && canPlanResources(user);
/** نطاق المخطِّط الذي لا يقرأ الموظفين: قطاعه (أو الشركة لصاحب النطاق الشركي)، بلا حصر إدارة. */
function plannerScope(user, requestedSector = null) {
  if (user.scope === 'company') return { sector: requestedSector || null, departments: [], department: null, blind: false };
  return { sector: user.sector_id || null, departments: [], department: null, blind: !user.sector_id };
}

/**
 * شرط SQL لنطاق الموارد المقروءة — نفس `peopleScope` الذي يبني كشف الفريق حرفياً، مع استثناء
 * حسابات العرض لغير مدير النظام. يعيد { clause, params } على كنية جدول الموظف.
 * والمخطِّط الذي لا يقرأ الموظفين يأخذ سياج قطاعه (plannerScope) — حيث تفتح له البوابة فقط.
 */
export function resourceScopeSql(user, alias = 'e', requestedSector = null) {
  const { sector, departments, blind } = isPlannerOnly(user) ? plannerScope(user, requestedSector) : peopleScope(user, requestedSector);
  if (blind) return { clause: '1=0', params: [] };
  const where = [`${alias}.deleted_at IS NULL`];
  const params = [];
  if (sector) { where.push(`${alias}.sector_id = ?`); params.push(sector); }
  if (departments.length) {
    const d = departmentInSql(`${alias}.department_id`, departments);
    where.push(d.clause); params.push(...d.params);
  }
  if (!seesDemoAccounts(user)) where.push(notDemoEmployeeSql(alias));
  return { clause: where.join(' AND '), params, sector, departments };
}

/** هل هذا الصف داخل نطاق القارئ (بنفس قاعدة القائمة — فما يُعرض يُفتح). */
export function resourceInScope(user, emp) {
  if (!user || !emp) return false;
  if (user.role_id === 'admin') return true;
  if (user.employee_id && user.employee_id === emp.id) return true;   // ملفه هو دائماً
  if (!can(user, 'read', 'employee')) return false;
  const { sector, departments, blind } = peopleScope(user);
  if (blind) return false;
  if (sector && emp.sector_id !== sector) return false;
  if (departments.length && !inDepartmentScope(user, emp.department_id)) return false;
  return true;
}

/** الباب الواحد لقراءة مورد: الصف داخل النطاق أو ملفُ صاحبه — وإلا رفضٌ عربي واضح. */
export async function loadReadableResource(user, employeeId) {
  const emp = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw notFound('المورد غير موجود — قد يكون سجله حُذف');
  if (!resourceInScope(user, emp)) throw forbidden('هذا المورد خارج نطاقك — يُفتح ملفه لمن يدير إدارته أو قطاعه');
  return emp;
}

/** ملفُ الشخص نفسه؟ */
export const isSelf = (user, emp) => !!(user?.employee_id && emp && user.employee_id === emp.id);

/** يعدّل بيانات المورد (نموذج S09): صلاحية تعديل الموظف على صفه — بوابة org.updateEmployee نفسها. */
export const canEditResource = (user, emp) => !!emp && can(user, 'update', 'employee', emp);
export const canCreateResource = (user, sectorId) => can(user, 'create', 'employee', { sector_id: sectorId || null });

/**
 * «يقود المورد» إدارياً — بلا شرط منح كتابة التسكين: يقود إدارته فعلاً (`department.manager_user_id`)،
 * أو دورُ مدير إدارة/مدير مباشر داخل إدارته، أو نطاق قطاعه فأوسع مع قراءة الموظفين. لتسجيل
 * القدرات ومراجعتها وإغلاق أسئلة التحليل — لا لتطبيق تسكين.
 */
export function leadsResource(user, emp) {
  if (!user || !emp) return false;
  if (user.role_id === 'admin') return true;
  if (emp.department_id && user.managedDepartmentIds instanceof Set && user.managedDepartmentIds.has(emp.department_id)) return true;
  if (emp.department_id && ['department_manager', 'line_manager'].includes(user.role_id) && departmentScope(user).includes(emp.department_id)) return true;
  const reads = can(user, 'read', 'employee', { sector_id: emp.sector_id, department_id: emp.department_id });
  if (user.scope === 'company') return reads;
  return user.scope === 'sector' && !!user.sector_id && user.sector_id === emp.sector_id && reads;
}

/**
 * «يدير المورد» — أضيق من `ownsEmployee` عمداً، لأن تلك تعدّ مالكاً: كلَّ صاحب نافذةٍ شركية
 * (الموارد البشرية والمشتريات…) وكلَّ منتمٍ إلى إدارة المورد (زميله في الإدارة نفسها) — وهو ما
 * يليق بـ«من يؤكّد تسكيناً في مساحة التسكين القديمة» لا بـ«من يقرّر طلباً عن مورد». الإدارة هنا
 * = منحُ كتابة التسكين على المورد **و** (قيادة إدارته فعلاً بـ`department.manager_user_id`، أو
 * دورُ مدير إدارة داخل إدارته، أو نطاق قطاعه فأوسع).
 */
export async function managesResource(user, emp) {
  if (!user || !emp) return false;
  if (user.role_id === 'admin') return true;
  const target = { sector_id: emp.sector_id, department_id: emp.department_id, project_id: null };
  const writes = can(user, 'create', 'allocation', target) || can(user, 'update', 'allocation', target);
  if (!writes) return false;
  if (emp.department_id && user.managedDepartmentIds instanceof Set && user.managedDepartmentIds.has(emp.department_id)) return true;
  if (emp.department_id && user.role_id === 'department_manager' && departmentScope(user).includes(emp.department_id)) return true;
  if (user.scope === 'company') return true;
  return user.scope === 'sector' && !!user.sector_id && user.sector_id === emp.sector_id;
}

/**
 * التخطيط على مورد: يؤكّد مباشرةً من يدير المورد (أو النفس على العمل الداخلي)، ويطلب من يملك
 * «طلب تسكين» في نطاق المورد (مدير مشروع، تطوير أعمال، عمليات…) فيُعتمد له من مدير المورد.
 */
export async function planningRights(user, emp) {
  if (!user || !emp) return { direct: false, request: false };
  const target = { sector_id: emp.sector_id, department_id: emp.department_id, project_id: null };
  // المباشر لمن يدير المورد (منح كتابة + قيادة/نطاق) — لا لمجرد «ملكية» تمرّ بالانتماء أو
  // بالنافذة الشركية بلا منح؛ وإلا وصل الطلب إلى كاتب التسكين فردّه برفضٍ بدل أن يصير طلباً.
  // والمرء يسكّن نفسه على العمل الداخلي مباشرةً كما في مساحة التسكين القائمة (كاتب البند يقبل
  // النفس؛ وكاتب المشروع يردّه برسالته لأن تسكين المشروع لمن يديره).
  const direct = isSelf(user, emp) || await managesResource(user, emp);
  const writes = can(user, 'create', 'allocation', target) || can(user, 'update', 'allocation', target);
  const request = direct || can(user, 'create', 'allocation_request', target) || writes;
  return { direct, request };
}

/** المراجعة المالية (المرحلة المالية للإقفال والتصدير والتصحيح النهائي). */
export const isFinanceReviewer = (user) => !!user && (user.role_id === 'admin' || can(user, 'approve', 'cost_close'));
/** مراجعة المدير على فترة قطاعٍ بعينه: قائد القطاع، أو مدير إدارةٍ فيه (على أهل إدارته). */
export function canManagerReview(user, sectorId, departmentId = null) {
  if (!user) return false;
  if (user.role_id === 'admin' || isFinanceReviewer(user)) return true;
  // منحُ «إدارة» على موردٍ بلا إدارة كان يمرّ من `can()` (هدفٌ بلا مفتاح الإدارة يُقرأ سماحاً)
  // فيؤكّد مدير الإدارة توزيعَ موظفٍ في القطاع لا يراه — الفراغ هنا رفضٌ لا سماح.
  if (departmentId == null && effectiveScope(user, 'update', 'cost_close') === 'department') return false;
  const target = { sector_id: sectorId || null, department_id: departmentId || null };
  return can(user, 'update', 'cost_close', target);
}
export const canReadClose = (user, sectorId) => !!user && (user.role_id === 'admin'
  || can(user, 'read', 'cost_close', { sector_id: sectorId || null, department_id: null })
  || isFinanceReviewer(user));

/** اتساع قراءة الموارد: شركة/قطاع/إدارة — لبناء الفلاتر والعدادات بنفس حدود الصفوف. */
export function readerBreadth(user) {
  if (!user) return 'none';
  if (user.role_id === 'admin') return 'company';
  if (isPlannerOnly(user)) return user.scope === 'company' ? 'company' : (user.sector_id ? 'sector' : 'none');
  const s = effectiveScope(user, 'read', 'employee');
  if (s === 'company') return 'company';
  if (s === 'department') return departmentScope(user).length ? 'department' : 'none';
  return s ? 'sector' : 'none';
}
