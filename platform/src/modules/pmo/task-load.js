// حِمل المهام — المقياس الثالث، وله اسمُه وحده.
//
// «إذا وضعتُ نسبة المهمة ٥٠٪ وأخذت أسبوعاً، فنصفُ طاقتي مشغولٌ بقية الأسبوع حتى تنتهي؛
// وستُّ مهامَّ بنِسَب ١٠+١٠+١٠+١٠+١٠+٥٠ تُظهر الشهر كله ١٠٠٪» — بلسان المالك. أي أن الحِمل
// حاصلُ جمعٍ لا إسقاطٌ زمني: مجموعُ نِسَب المهام المفتوحة المسنَدة إليه، الآن.
//
// ── ولماذا ملفٌّ مستقل عن `capacity.js` ───────────────────────────────────────
// عقيدةُ `capacity.js` أن المهام تدخل الطاقة **عدّاً لا وزناً**، وهي مكتوبةٌ في رأسه ومسلوكة
// في كل دوالّه. ووحدةٌ مستقلة تُبقي الأساس الثالث معزولاً مادياً، فلا يُجمع بغفلةٍ مع ما
// قبله.
//
// ── والأسسُ الثلاثة لا تُخلط أبداً ────────────────────────────────────────────
// في المنصة رقمان باسم «إشغال»: «الإشغال المخطَّط» أساسه `allocation.monthly_json`،
// و«الإشغال القابل للفوترة» أساسه `time_entry` — ولكلٍّ قسمٌ وسطرُ أساسٍ مستقل، والقاعدة
// منصوصةٌ في رأس `core/reports/periods.js`: «لا جمع بينهما ولا متوسط». فالثالث يُسمَّى عمداً
// **«حِمل المهام»** لا «إشغالاً»، ويحمل سطرَ أساسه في كل عرض. ثلاثةُ أرقامٍ باسمٍ واحد
// للشخص الواحد هو بالضبط نمطُ الفشل الذي كُتبت تلك القاعدة لمنعه.
//
// ولا عتباتٍ جديدة: الألوان والحدود من `CAPACITY`/`capacityColor` و`UTIL_BANDS` القائمَين.
import { all, get } from '../../core/db/index.js';
import { approvedTaskSql, notPersonalSql } from './task-approval.js';

export const TASK_LOAD_AR = 'حِمل المهام';
export const TASK_LOAD_BASIS_AR = 'حِمل المهام — مجموع النِّسب المقدَّرة على المهام المفتوحة المسنَدة إليه. مقياس مستقل عن الإشغال المخطَّط في التسكين وعن الإشغال القابل للفوترة — لا يُجمع معهما.';
export const TASK_LOAD_NOT_RATING_AR = 'مقياس سعة لا تقييم';

// ── تعريف «الجارية» — القاعدة الجوهرية، ومصدرها الوحيد ───────────────────────
// غيرُ منجزة ولا ملغاة · معتمَدة · غير شخصية · غير محذوفة. **ولا شرطَ تاريخ استحقاق البتة**:
// المتأخرةُ المفتوحة تظلّ تستهلك حتى تُغلق أو تُلغى — ولو أُسقطت بعد موعدها لبدا الغارقُ في
// التأخير أكثرَ الناس فراغاً، ولناقض الرقمُ عدّادات التأخر المجاورة له في الشاشة نفسها.
// والمهمةُ بلا موعدٍ تستهلك كذلك: جاريةٌ إلى أجلٍ غير مسمّى.
export const openLoadSql = (pfx = 't.') => `${pfx}deleted_at IS NULL AND ${pfx}status NOT IN ('DONE','CANCELLED')`
  + ` AND ${notPersonalSql(pfx)} AND ${approvedTaskSql(pfx)}`;

// عمودا الجمع — يُستوردان حيث يوجد تجميعٌ قائم بنفس الشرط، فلا استعلامَ ثانٍ ولا تعريفَ ثانٍ.
// و«بلا نسبة مقدَّرة» يُعدّ ولا يُجمع: صفرٌ مخترَع يجعل المُثقَل يقرأ فارغاً.
export const loadSumsSql = (pfx = 't.') => `SUM(COALESCE(${pfx}utilization_pct,0)) load_pct,`
  + ` SUM(CASE WHEN ${pfx}utilization_pct IS NULL THEN 1 ELSE 0 END) load_unsized`;

export const shapeLoad = (row) => ({
  pct: Number(row?.load_pct) || 0,
  unsized: Number(row?.load_unsized) || 0,
  open: Number(row?.open_count ?? row?.total) || 0,
});

// حِمل مجموعةٍ من الحسابات في نداءٍ واحد — تُستعمل حيث لا يوجد تجميعٌ قائم يُوسَّع.
export async function taskLoadFor(userIds = []) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  const rows = await all(`SELECT t.assignee_user_id uid, ${loadSumsSql('t.')}, COUNT(*) open_count
     FROM task t
    WHERE ${openLoadSql('t.')} AND t.assignee_user_id IN (${marks})
    GROUP BY t.assignee_user_id`, ids);
  for (const r of rows) out.set(r.uid, shapeLoad(r));
  return out;
}

// حِملُ صاحب الحساب نفسه — والمهمةُ الشخصية خارجه حتى على رأسه هو، وإلا اختلف الرقمُ الواحد
// بين «مهامي» و«مهام فريقي» لأنها محجوبةٌ عن المدير وعداً. رقمٌ واحد وحقيقةٌ واحدة.
export async function myTaskLoad(user) {
  if (!user?.id) return { pct: 0, unsized: 0, open: 0 };
  const r = await get(`SELECT ${loadSumsSql('t.')}, COUNT(*) open_count
     FROM task t WHERE ${openLoadSql('t.')} AND t.assignee_user_id = ?`, [user.id]);
  return shapeLoad(r);
}
