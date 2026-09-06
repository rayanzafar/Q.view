// ── قائمة الأشخاص القابلين للاختيار — مصدرٌ واحد لكل خانةِ «مَن» ─────────────
//
// «في مسميات غير مقبولة في الموظفين… هذه بس لك أنت في الباك إند عشان تجرّب، المفروض ما تطلع»
// — بلسان المالك. والذي رآه: «العمليات (تجريبي)» و«المشتريات (تجريبي)» و«معتمِد (تجريبي)»
// في قائمة يختار منها مَن يُسكَّن على مشروعٍ حقيقي، بجانب زملائه بأسمائهم.
//
// وحسابات العرض ليست خطأ بيانات: المسح يدخل بها ليختبر سبعة عشر دوراً على كل شاشة، وحذفُها
// يُعمي أداة الجودة. الخطأ أنها **تظهر حيث يُختار إنسان**.
//
// وتُعرَف ببادئة اسم الدخول `demo.` لا بلاحقة الاسم «(تجريبي)»: البادئة هي ما تدخل به أداة
// المسح فعلاً (`scripts/sweep.mjs`)، فهي علامةٌ بنيوية يفرضها الاستعمال — أما مطابقة الاسم
// فتخمينٌ يسقط عند أول موظفٍ حقيقي يُسمّى تجريبياً، أو عند أول تغيير في اصطلاح التسمية.
// (وهو بالضبط ما حذّرت منه الترحيلة ٠١٥ حين رفضت المحوَ بمطابقة الأسماء.)
//
// ولماذا وحدةٌ مستقلة: نفس الاستعلام كان مكتوباً **أربع مرات** بأربع صياغات (صفحة المشروع
// مرتين، وشريط التحكم بالفرصة، والتسكين) — وأولُ ترشيحٍ يُضاف إلى ثلاثةٍ منها ويُنسى الرابع
// يُعيد المشكلة من بابٍ واحد. الآن بابٌ واحد.
import { all } from '../../core/db/index.js';

// بادئة حسابات العرض. تُصدَّر كي يقرأها الفحص من هنا لا بنسخةٍ ثانية.
export const DEMO_LOGIN_PREFIX = 'demo.';
const NOT_DEMO = "COALESCE(username,'') NOT LIKE 'demo.%'";

/**
 * من يرى حسابات العرض أصلاً؟ **مدير النظام وحده**.
 *
 * «خلّها في الباك إند فقط، وتظهر لك يا مبرمج أو تظهر لحساب الأدمن — غير كذا لازم ما تظهر في
 * أي مكان في الإنترفيس» — بلسان المالك. والحسابات تبقى قائمة لأن المسح يدخل بها ليختبر سبعة
 * عشر دوراً على كل شاشة؛ الممنوع أن يراها من يعمل على بياناتٍ حقيقية.
 *
 * ومدير النظام مستثنى لأنه هو من يديرها ويصفّيها: شاشةٌ تُخفي عنه ما يملك حذفه تجعله يظن
 * أنها اختفت وهي باقية.
 */
export const seesDemoAccounts = (user) => !!user && user.role_id === 'admin';

/**
 * نفس الحكم على **الموظفين** لا الحسابات.
 *
 * الهوية التجريبية تثبت بحساب عرض مرتبط أو بقيد موظف نشط في سجل البيانات التجريبية.
 * يشمل السجل الموظف غير المرتبط بحساب. الاسم وحده ليس دليلًا؛ السجلات التاريخية غير
 * المصنفة تحتاج مطابقة مصدر قبل تصنيفها أو حذفها.
 *
 * والربط يُقرأ من الجهتين (`app_user.employee_id` و`employee.user_id`) لأن المنتج يكتب
 * الاثنين، فاختيار جهةٍ واحدة يترك الباب الآخر مفتوحاً.
 *
 * @param {string} alias — اسم جدول الموظف في الاستعلام (مثل `e` أو `employee`).
 */
export const notDemoEmployeeSql = (alias = 'employee') => `(NOT EXISTS (
  SELECT 1 FROM app_user au
   WHERE (au.employee_id = ${alias}.id OR au.id = ${alias}.user_id)
     AND COALESCE(au.username,'') LIKE 'demo.%')
  AND NOT EXISTS (SELECT 1 FROM demo_record dr
    WHERE dr.table_name = 'employee' AND dr.row_id = ${alias}.id AND dr.purged_at IS NULL))`;

/**
 * الأشخاص الذين يصحّ إسناد عملٍ إليهم: حسابات نشطة غير محذوفة وليست حسابَ عرض.
 * @param {{sectorId?: string, limit?: number, viewer?: object}} opts — `sectorId` يقصر القائمة
 *   على قطاعٍ بعينه، و`viewer` هو من يقرأ (مدير النظام وحده يرى حسابات العرض).
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
/**
 * أسماء عرضٍ لمعرّفات حسابات بعينها — للشاشات التي تذكر أشخاصاً بأسمائهم
 * (طالب الاعتماد مثلاً). تشمل الحسابات الموقوفة عمداً: الاسم يبقى بعد الإيقاف.
 * @param {string[]} ids
 * @returns {Promise<Map<string, string>>} معرّف ← اسم العرض
 */
export async function namesByIds(ids = []) {
  const clean = [...new Set(ids)].filter(Boolean);
  if (!clean.length) return new Map();
  const rows = await all(
    `SELECT id, COALESCE(name_ar, username) AS "name" FROM app_user
      WHERE id IN (${clean.map(() => '?').join(',')})`, clean);
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function pickablePeople(opts = {}) {
  const where = ['active = 1', 'deleted_at IS NULL'];
  if (!seesDemoAccounts(opts.viewer)) {
    where.push(NOT_DEMO);
    where.push(`NOT EXISTS (SELECT 1 FROM employee pe
      JOIN demo_record dr ON dr.table_name = 'employee' AND dr.row_id = pe.id AND dr.purged_at IS NULL
      WHERE pe.id = app_user.employee_id OR pe.user_id = app_user.id)`);
  }
  const params = [];
  if (opts.sectorId) { where.push('sector_id = ?'); params.push(opts.sectorId); }
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 500) : 300;
  return await all(
    `SELECT id, COALESCE(name_ar, username) AS "name" FROM app_user
      WHERE ${where.join(' AND ')} ORDER BY name_ar, username LIMIT ${limit}`, params);
}
