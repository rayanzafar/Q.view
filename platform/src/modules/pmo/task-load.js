// نسبة الإشغال من المهام — المقياس الثالث، وله سطرُ أساسه في كل عرض.
//
// «إذا وضعتُ نسبة المهمة ٥٠٪ وأخذت أسبوعاً، فنصفُ طاقتي مشغولٌ بقية الأسبوع حتى تنتهي؛
// وستُّ مهامَّ بنِسَب ١٠+١٠+١٠+١٠+١٠+٥٠ تُظهر الشهر كله ١٠٠٪» — بلسان المالك. أي أن الحِمل
// حاصلُ جمعٍ لا إسقاطٌ زمني: مجموعُ نِسَب المهام الجارية المسنَدة إليه الآن — عدا المعطَّلة.
//
// ── ولماذا ملفٌّ مستقل عن `capacity.js` ───────────────────────────────────────
// عقيدةُ `capacity.js` أن المهام تدخل الطاقة **عدّاً لا وزناً**، وهي مكتوبةٌ في رأسه ومسلوكة
// في كل دوالّه. ووحدةٌ مستقلة تُبقي الأساس الثالث معزولاً مادياً، فلا يُجمع بغفلةٍ مع ما
// قبله.
//
// ── والأسسُ الثلاثة لا تُخلط أبداً ────────────────────────────────────────────
// في المنصة رقمان باسم «إشغال»: «الإشغال المخطَّط» أساسه `allocation.monthly_json`،
// و«الإشغال القابل للفوترة» أساسه `time_entry` — ولكلٍّ قسمٌ وسطرُ أساسٍ مستقل، والقاعدة
// منصوصةٌ في رأس `core/reports/periods.js`: «لا جمع بينهما ولا متوسط». والثالث سمّاه المالك
// **«نسبة الإشغال»** (قرار ٢٠٢٦-٠٩-٠٨)، فيلزمه ما يميّزه عن أخوَيه: **سطرُ الأساس «من
// المهام» في كل عرض، بلا استثناء**. ثلاثةُ أرقامٍ باسمٍ واحد للشخص الواحد هو نمطُ الفشل
// الذي كُتبت تلك القاعدة لمنعه، وسطرُ الأساس هو ثمنُ الاسم المشترك.
//
// ولا عتباتٍ جديدة: الألوان والحدود من `CAPACITY`/`capacityColor` و`UTIL_BANDS` القائمَين.
import { all, get } from '../../core/db/index.js';
import { approvedTaskSql, notPersonalSql } from './task-approval.js';

export const TASK_LOAD_AR = 'نسبة الإشغال';
export const TASK_LOAD_BASIS_AR = 'نسبة الإشغال من المهام — مجموع النِّسب على المهام الجارية المسنَدة إليه، عدا المعطَّلة والمنجَزة والملغاة. مقياس مستقل عن الإشغال المخطَّط في التسكين وعن الإشغال القابل للفوترة — لا يُجمع معهما.';
export const TASK_LOAD_NOT_RATING_AR = 'مقياس سعة لا تقييم';

// ── تعريف «الجارية» — القاعدة الجوهرية، ومصدرها الوحيد ───────────────────────
// غيرُ منجزة ولا ملغاة **ولا معطَّلة** · معتمَدة · غير شخصية · غير محذوفة. **ولا شرطَ تاريخ
// استحقاق البتة**: المتأخرةُ المفتوحة تظلّ تستهلك حتى تُغلق أو تُلغى — ولو أُسقطت بعد موعدها
// لبدا الغارقُ في التأخير أكثرَ الناس فراغاً، ولناقض الرقمُ عدّادات التأخر المجاورة له في
// الشاشة نفسها. والمهمةُ بلا موعدٍ تستهلك كذلك: جاريةٌ إلى أجلٍ غير مسمّى.
//
// والمعطَّلة تسقط من الجمع وتعود بزوال التعطيل (قرار المالك ٢٠٢٦-٠٩-٠٨): من ينتظر غيره لا
// تُستهلك طاقتُه بانتظاره. والحكمُ **بالحالة وحدها** لا بنصّ سبب التعطيل: نصٌّ قديم بقي
// مكتوباً على مهمةٍ عادت تجري كان سيُسقطها من الحساب صامتاً.
export const countsForLoadSql = (pfx = 't.') => `${pfx}status NOT IN ('DONE','CANCELLED','BLOCKED')`;
export const openLoadSql = (pfx = 't.') => `${pfx}deleted_at IS NULL AND ${countsForLoadSql(pfx)}`
  + ` AND ${notPersonalSql(pfx)} AND ${approvedTaskSql(pfx)}`;

// ── والقراءةُ غيرُ الحساب ─────────────────────────────────────────────────────
// «الجارية» في القوائم (الالتزامات القادمة، شاشة العمل، ملف المورد) تضمّ **المعطَّلة**: مهمةٌ
// معطَّلة لا تستهلك طاقة صاحبها، لكنها لا تختفي من جدوله ولا من نظر مديره — وإخفاؤها من
// القائمة يمحو العائق نفسه من الشاشة التي وُضعت لرفعه. فالشرطان اثنان بقصد: هذا للعرض
// وذاك للجمع، ولكلٍّ اسمه.
export const openTaskSql = (pfx = 't.') => `${pfx}deleted_at IS NULL AND ${pfx}status NOT IN ('DONE','CANCELLED')`
  + ` AND ${notPersonalSql(pfx)} AND ${approvedTaskSql(pfx)}`;

// أعمدة الجمع — تُستورَد حيث يوجد تجميعٌ قائم، فلا استعلامَ ثانٍ ولا تعريفَ ثانٍ. وهي
// **تحرس شرطَها بنفسها**: التجميع المضيف قد يكون أوسع (بطاقة «مهام فريقي» تعدّ المعطَّلة
// أيضاً)، فلو اتّكلت الأعمدة على `WHERE` المضيف لاختلف الرقمُ باختلاف الشاشة.
// و«بلا نسبة» يُعدّ ولا يُجمع: صفرٌ مخترَع يجعل المُثقَل يقرأ فارغاً.
export const loadSumsSql = (pfx = 't.') => {
  const c = countsForLoadSql(pfx);
  return `SUM(CASE WHEN ${c} THEN COALESCE(${pfx}utilization_pct,0) ELSE 0 END) load_pct,`
    + ` SUM(CASE WHEN ${c} AND ${pfx}utilization_pct IS NULL THEN 1 ELSE 0 END) load_unsized,`
    + ` SUM(CASE WHEN ${c} THEN 1 ELSE 0 END) load_open`;
};

export const shapeLoad = (row) => ({
  pct: Number(row?.load_pct) || 0,
  unsized: Number(row?.load_unsized) || 0,
  open: Number(row?.load_open) || 0,
});

// نسبة إشغال مجموعةٍ من الحسابات في نداءٍ واحد — تُستعمل حيث لا يوجد تجميعٌ قائم يُوسَّع.
export async function taskLoadFor(userIds = []) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  const rows = await all(`SELECT t.assignee_user_id uid, ${loadSumsSql('t.')}
     FROM task t
    WHERE ${openLoadSql('t.')} AND t.assignee_user_id IN (${marks})
    GROUP BY t.assignee_user_id`, ids);
  for (const r of rows) out.set(r.uid, shapeLoad(r));
  return out;
}

// نسبةُ إشغال صاحب الحساب نفسه — والمهمةُ الشخصية خارجها حتى على رأسه هو، وإلا اختلف الرقمُ
// الواحد بين «مهامي» و«مهام فريقي» لأنها محجوبةٌ عن المدير وعداً. رقمٌ واحد وحقيقةٌ واحدة.
export async function myTaskLoad(user) {
  if (!user?.id) return { pct: 0, unsized: 0, open: 0 };
  const r = await get(`SELECT ${loadSumsSql('t.')}
     FROM task t WHERE ${openLoadSql('t.')} AND t.assignee_user_id = ?`, [user.id]);
  return shapeLoad(r);
}
