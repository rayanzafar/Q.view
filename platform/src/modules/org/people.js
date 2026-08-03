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
 * نفس الحكم على **الموظفين** لا الحسابات.
 *
 * وموظفو العرض لا يحملون اسم دخول، لكن كلاً منهم **مربوطٌ بحساب عرض**: البذرة تُنشئ «ريم
 * الدوسري (تجريبي)» وتربطها بـ`demo.deptmgr`. فالعلامة واحدة والوصول إليها بخطوةٍ واحدة —
 * ولا نعود إلى مطابقة الاسم التي رفضتها الترحيلة ٠١٥.
 *
 * والربط يُقرأ من الجهتين (`app_user.employee_id` و`employee.user_id`) لأن المنتج يكتب
 * الاثنين، فاختيار جهةٍ واحدة يترك الباب الآخر مفتوحاً.
 *
 * @param {string} alias — اسم جدول الموظف في الاستعلام (مثل `e` أو `employee`).
 */
export const notDemoEmployeeSql = (alias = 'employee') => `NOT EXISTS (
  SELECT 1 FROM app_user au
   WHERE (au.employee_id = ${alias}.id OR au.id = ${alias}.user_id)
     AND COALESCE(au.username,'') LIKE 'demo.%')`;

/**
 * الأشخاص الذين يصحّ إسناد عملٍ إليهم: حسابات نشطة غير محذوفة وليست حسابَ عرض.
 * @param {{sectorId?: string, limit?: number}} opts — `sectorId` يقصر القائمة على قطاعٍ بعينه.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function pickablePeople(opts = {}) {
  const where = ['active = 1', 'deleted_at IS NULL', NOT_DEMO];
  const params = [];
  if (opts.sectorId) { where.push('sector_id = ?'); params.push(opts.sectorId); }
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 500) : 300;
  return await all(
    `SELECT id, COALESCE(name_ar, username) AS "name" FROM app_user
      WHERE ${where.join(' AND ')} ORDER BY name_ar, username LIMIT ${limit}`, params);
}
