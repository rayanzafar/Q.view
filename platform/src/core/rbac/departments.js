// ═══ نطاق «الإدارة»: يتبع القيادة لا الانتماء ═══════════════════════════════════════════════
//
// العطل بلسان المالك: «موظفين إدارة الابتكار مو بيانين». والرجل المقصود اسمه في الشاشة
// «مدير إدارة الابتكار وإدارة الذكاء الاصطناعي والبيانات» — مسمّاه يقول إنه يقود **إدارتين**،
// وسجلّ موظفه لا يعرف إلا واحدة: `employee.department_id` عمود مفرد، لا يحمل إلا انتماءً
// واحداً. وكل فحص نطاق في المنصة كان يقارن ذلك العمود **بمساواة**، فيسقط نصف مسؤوليته صامتاً:
// يفتح لوحة فريقه فلا يجد سجى ولا هادي، ويفتح ملف أحدهما فيُرَدّ «هذا الشخص خارج إدارتك» —
// وهو مديرهما المكتوب اسمه في عمود `department.manager_user_id` منذ أول إصدار.
//
// وليست حالته وحده: العمود قائم لكل إدارة، فأي مديرٍ يقود إدارةً لا ينتمي إليها (وهو الشائع
// حين تُسنَد إدارة جديدة إلى مديرٍ قائم) كان لا يرى من يقود. الانتماء إجابةٌ عن سؤال «أين
// يجلس؟»، والصلاحية سؤالها الآخر: «من يقود؟». المصدر هنا يجمع الجوابين في مجموعة واحدة:
//   انتماؤه (`employee.department_id`) ∪ كل إدارة يقودها (`department.manager_user_id = هو`).
//
// والحدّ محفوظ بالضبط: من لا يقود شيئاً تبقى مجموعته إدارتَه وحدها حرفاً بحرف، ومن لا انتماء
// له ولا قيادة تبقى مجموعته **فارغة** — والفراغ يعني «لا أحد» لا «القطاع كله». ولا توسيع إلى
// القطاع بحال: قيادةُ إدارةٍ ليست قيادةَ القطاع الذي تسكنه.
import { all } from '../db/index.js';

// ما **يقوده** وحده — بلا انتمائه. مفصولةً عن `readerDepartmentIds` لأن السؤالين افترقا فعلاً:
// نطاق «الإدارة» يُبنى من الاثنين معاً (انتماء ∪ قيادة)، أما توسعة «من يقود إدارةً يقرأ فرصها»
// فتُبنى من القيادة وحدها — موظفٌ عاديٌّ انتماؤه إلى إدارةٍ لا يجعله قارئاً لفرصها.
export async function managedDepartmentIds(userId) {
  const set = new Set();
  if (userId) {
    // الإدارة المحذوفة ناعماً لا تُقاد: صفٌّ ملغى لا يمنح وصولاً.
    const led = await all(
      'SELECT id FROM department WHERE manager_user_id = ? AND deleted_at IS NULL',
      [userId]
    );
    for (const d of led) set.add(d.id);
  }
  return set;
}

// تُبنى مرة واحدة عند حلّ الجلسة (بجوار projectIds) لا عند كل فحص: القرار في المسار الساخن
// يبقى متزامناً كما هو، وبلا استعلامٍ لكل صف.
export async function readerDepartmentIds(userId, ownDepartmentId) {
  const set = await managedDepartmentIds(userId);
  if (ownDepartmentId) set.add(ownDepartmentId);
  return set;
}

// مجموعة إدارات القارئ كقائمة. والتراجع إلى `department_id` ليس تليّناً بل توافقٌ مقصود:
// ثمة مستهلكون يركّبون كائن مستخدم بأيديهم (أدوات الفحص والسيناريوهات) بلا هذه المجموعة —
// فيُقرأون كما كانوا قبل اليوم بالضبط: إدارةُ انتماءٍ واحدة، لا أوسع.
export function departmentScope(user) {
  if (!user) return [];
  const raw = user.departmentIds;
  const ids = raw instanceof Set ? [...raw] : (Array.isArray(raw) ? [...new Set(raw)] : []);
  if (ids.length) return ids.filter(Boolean);
  return user.department_id ? [user.department_id] : [];
}

// عضويةٌ في المجموعة بدل مساواةٍ بإدارة واحدة — هذه هي الجملة التي تُستبدل في كل موضع فحص.
export function inDepartmentScope(user, departmentId) {
  if (!departmentId) return false;
  return departmentScope(user).includes(departmentId);
}

// شرط SQL محمول على المحرّكين: عمودٌ داخل مجموعة الإدارات بعلامات `?` فقط.
// مجموعة فارغة ⟵ `1=0` (لا صفوف) لا شرطاً محذوفاً: حذف الشرط عند الفراغ هو عين التسريب
// الذي يفتح القطاع كله على من لا إدارة له.
export function departmentInSql(col, ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return { clause: '1=0', params: [] };
  return { clause: `${col} IN (${list.map(() => '?').join(',')})`, params: list };
}
