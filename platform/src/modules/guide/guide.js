// «دليلي» — دليل الاستخدام والجولة الإرشادية، مشتقّان من صلاحيات القارئ نفسه.
//
// لماذا خدمة لا صفحة ثابتة؟ لأن جدولاً مكتوباً بيد «الدور ⟵ ماذا يقرأ» يبدأ بالانحراف في
// اليوم التالي لأول تعديل صلاحيات: يَعِد بشاشة تُرفَض عند فتحها، أو — وهو الأخطر — يشرح
// معلومة حسّاسة لمن لا يملكها لمجرد أن أحداً نسي سطراً. هنا يمرّ المحتوى من البوابة نفسها
// التي تسمح بفتح الصفحة أو ترفضها، فيستحيل بنيوياً أن يصف الدليل شاشةً أو رقماً لا يملكه قارئه.
//
// قرار الطبقات (يُقرأ قبل أي تعديل):
//   • `core/guide/content.js` بيانات نقية بلا استيراد من modules/ ولا من web/ — القاعدة
//     «core لا يعرف web» محفوظة كما هي، ولم يُضَف أي استيراد core ⟵ web.
//   • هذا الملف (modules/) هو الوحيد الذي يستورد `PAGE_ACCESS` من `web/nav.js`، عمداً:
//     nav.js هو **المصدر الواحد** الذي تحتكم إليه routes.js (رفض 403) وlayout.js (إظهار
//     القائمة). أي نسخة ثانية من الشروط هنا تعني احتمال اختلاف الدليل عن المنتج — وهو
//     بالضبط الخطر الذي وُجدت هذه الميزة لمنعه. (سبق أن نسخت `search.js` الشروط الأربعة
//     التي تخصها؛ لا تنسخ هنا: الدليل يغطي كل الشاشات، والنسخة الكاملة تنحرف حتماً.)
//     nav.js ورقة في الشجرة: لا يستورد إلا `core/rbac` ولا يحمل أي أثر جانبي — فلا دورة.
//   • لا كتابة إطلاقاً في هذا الملف: قراءة صرفة ⟵ لا `audit()` ولا معاملة.
import { PAGE_ACCESS } from '../../core/policy/pages.js';
import { can, canSeeSensitive, effectiveScope } from '../../core/rbac/index.js';
import { ROLE_LABELS, SCOPE_RANK } from '../../core/rbac/matrix.js';
import { get } from '../../core/db/index.js';
import { forbidden } from '../../core/http/errors.js';
// بوابة «مهام فريقي» تُستورَد من مالكها لا تُعاد كتابتها: شرطها مركّب (قراءة على محور تنظيمي،
// أو تعديل يتجاوز «خاصتي») ونسخةٌ منه هنا كانت ستنحرف عند أول تعديل — وهو الخطر نفسه الذي
// وُجد هذا الملف لمنعه في الصفحات.
import { teamTasksAccess } from '../pmo/tasks.js';
import * as C from '../../core/guide/content.js';

// الموارد التي يُقاس بها «اتساع البصر». النطاق يُقرأ بـeffectiveScope لا بـcan():
// can(user, 'read', 'project') بلا صف هدف تعود true لمجرد وجود أي منح مطابق مهما ضاق نطاقه،
// فلو بُني عليها سؤال النطاق لظهر لمستشارٍ نطاقه مشروعه دليلٌ يَعِده برؤية الشركة كلها.
// و«التقارير» ليست من موارد البصر: هي **أرقام مجمَّعة** لا صفوف يتصفّحها المستخدم. مدير الإدارة
// مُنح قراءة تقارير قطاعه ومؤشراته بقرار المالك (ليرى ربح القطاع وإيراده ومستهدفه)، وقراءته
// للأشخاص والعمل بقيت عند إداراته. فلو قِيس بصره بالتقارير لقرأ في دليله «نطاقك قطاعك» —
// وعدٌ بأشخاصٍ ومهامٍ لن يجدها، وهو أسوأ من وصفٍ أضيق: يبحث عمّا وُعِد به فيظنّ المنتج معطَّلاً.
const SIGHT_RESOURCES = ['project', 'opportunity', 'client', 'employee', 'task'];
const APPROVABLE = ['opportunity', 'proposal', 'expense', 'deliverable', 'timesheet', 'invoice', 'task'];
const IO_RESOURCES = ['client', 'employee', 'opportunity', 'project', 'allocation', 'revenue_line'];

function widestSight(user) {
  let best = null;
  for (const r of SIGHT_RESOURCES) {
    const s = effectiveScope(user, 'read', r);
    if (s && (SCOPE_RANK[s] || 0) > (SCOPE_RANK[best] || 0)) best = s;
  }
  return best;
}

// القدرات: سؤال واحد لكل جملة إرشادية مشروطة. كلها قرارات محرّك الصلاحيات، بلا استثناء.
export function capsOf(user) {
  const sight = widestSight(user);
  return {
    companySight: sight === 'company',
    sectorSight: sight === 'sector',
    // نطاق «الإدارة» كان يسقط في `narrowSight` فيقرأ مدير الإدارة أن ما يراه «محصور في عملك
    // ومشاريعك» — وهو خطأ في الوصف لا في الصلاحية: نطاقه أشخاص إدارته لا عمله هو.
    departmentSight: sight === 'department',
    narrowSight: !['company', 'sector', 'department'].includes(sight),
    teamTasks: teamTasksAccess(user).canRead,
    // الدمج يتطلب التعديل **والحذف** معاً — نفس شرط بطاقة «جهات يُحتمل أنها جهة واحدة» في
    // شاشة العملاء حرفياً، لأن أثر الدمج يفوق أثر التعديل وحده.
    mergeClients: can(user, 'update', 'client') && can(user, 'delete', 'client'),
    approve: APPROVABLE.some((r) => can(user, 'approve', r)),
    exportReports: can(user, 'export', 'report'),
    editOrg: can(user, 'create', 'sector') || can(user, 'admin', 'department')
      || can(user, 'create', 'department') || can(user, 'update', 'department'),
    editPeople: can(user, 'create', 'employee') || can(user, 'update', 'employee'),
    manageStaffing: can(user, 'create', 'allocation') || can(user, 'update', 'allocation'),
    // الحقول الحسّاسة تُسأل من بوابتها نفسها (canSeeSensitive) لا من قائمة أدوار مكتوبة:
    // الراتب مختوم لمدير النظام وحده بقرار المالك، فأي دور آخر لا يرى عنه كلمة في دليله.
    seeCost: canSeeSensitive(user, 'cost'),
    seeMargin: canSeeSensitive(user, 'margin'),
    seeSalary: canSeeSensitive(user, 'salary'),
    financeSight: can(user, 'read', 'invoice') || can(user, 'read', 'contract'),
    writeFinance: can(user, 'create', 'invoice') || can(user, 'update', 'invoice')
      || can(user, 'create', 'contract') || can(user, 'update', 'contract'),
    createOpp: can(user, 'create', 'opportunity'),
    createProject: can(user, 'create', 'project'),
    importWrite: IO_RESOURCES.some((r) => can(user, 'create', r) || can(user, 'update', r)),
    isAdmin: user.role_id === 'admin',
  };
}

// نفس دالة الصفحة حرفياً (لا نسخة منها). تفشل مغلقة: أي خلل في التقييم ⟵ الشاشة خارج الدليل.
function opens(user, key) {
  const fn = PAGE_ACCESS[key];
  if (!fn) return false;
  try { return !!fn(user); } catch { return false; }
}

// اسم الدور كما يقرؤه صاحبه. الأدوار النظامية من المصفوفة مباشرة، والأدوار التي ينشئها
// مدير النظام لاحقاً تُقرأ من جدول الأدوار — فلا يظهر لأحد اسم دور بحروف لاتينية.
async function roleNameAr(roleId) {
  const known = ROLE_LABELS[roleId]?.ar;
  if (known) return known;
  const row = await get('SELECT name_ar FROM role WHERE id = ? AND deleted_at IS NULL', [roleId]);
  return row?.name_ar || 'دور مخصَّص';
}

function requireUser(user) {
  if (!user || !user.role_id) {
    throw forbidden('تعذّر تحديد دورك في المنصة. سجّل الدخول من جديد، وإن تكرّر الأمر فاطلب من مدير النظام مراجعة حسابك.');
  }
}

/**
 * دليل شخص واحد: الشاشات التي يفتحها فعلاً، بترتيب رحلته، ومصطلحات شاشاته، وحدود نطاقه.
 * قراءة صرفة — لا كتابة ولا سطر تدقيق.
 */
export async function guideFor(user) {
  requireUser(user);
  const caps = capsOf(user);
  const allowed = C.PAGE_KEYS.filter((k) => opens(user, k));
  const ordered = C.orderPages(user.role_id, allowed);
  return {
    role: { id: user.role_id, name_ar: await roleNameAr(user.role_id) },
    intro_ar: C.guideIntro(user.role_id),
    pages: ordered.map((k) => C.guidePage(k, caps)).filter(Boolean),
    glossary: C.termsForPages(ordered, caps),
    limits_ar: C.guideLimits(caps),
    // سيناريوهات دوره — تُمشى في المنتج على صفوفٍ مسمّاة، لا تُقرأ كتعليمات عامة.
    scenarios: C.scenariosFor(user.role_id),
  };
}

/**
 * جولة شاشة واحدة. تعيد «لا شيء» بهدوء (لا خطأ ولا تلميح) إن كانت الشاشة خارج صلاحيته
 * أو بلا جولة — حتى لا يصبح وجود الجولة نفسه دليلاً على وجود شاشة لا يملكها.
 */
export function tourFor(user, pageKey) {
  requireUser(user);
  const key = String(pageKey || '').trim();
  if (!opens(user, key)) return null;
  return C.guideTour(key, capsOf(user));
}
