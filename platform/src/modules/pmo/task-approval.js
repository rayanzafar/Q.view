// ── اعتماد المهمة: مهمةٌ على مشروعٍ أو فرصة لا تُضاف حتى يعتمدها مدير صاحبها ──────────────
//
// «موضوع الاعتمادات: أي موظف يضيف مهمة لازم المدير يعتمدها عشان تنضاف له — إذا كانت مهمة
//  متعلّقة بالمشروع أو فرصة معيّنة» — بلسان المالك.
//
// والشرطُ في آخر الجملة هو نصفُ القاعدة: **العمل المرتبط بجهة** هو ما يُعتمد. فالمهمة على
// مشروعٍ تظهر في شاشة ذلك المشروع وفي عدّاداته وفي تقرير فترته، والمهمة على فرصةٍ تظهر في
// سجلّها — أي أن الموظف يكتب في لوحةِ عملٍ يشترك فيها غيره. أمّا عملُه الداخلي ومهامه
// الشخصية فدفترُه هو، ولا معنى لأن ينتظر إذناً ليكتب فيه.
//
// ── ومن هو «المدير» ─────────────────────────────────────────────────────────
// هو نفسه مديرُ التسكين حرفياً (`managerOfEmployee`): مديرُ الإدارة المسجَّل في
// `department.manager_user_id`. مصدرٌ واحد لمعنى «مديري» في المنصة كلها — فلو تباعد المصدران
// لصار الرجل يؤكّد تسكين موظفه ولا يعتمد مهامه، أو العكس، بلا أن يفسّر أحدٌ لماذا.
//
// ولا يُصعَّد إلى قائد القطاع عند غيابه، ولا يُعلَّق طلبٌ بلا مُرسَلٍ إليه: من لا مدير له
// تُضاف مهمته فوراً. الصمتُ — مهمةٌ تنتظر معتمِداً لا وجود له — أسوأ من التمرير، والأثر مكتوبٌ
// في التدقيق على أي حال. وهو نفس القرار المتَّخذ في تأكيد التسكين، وللسبب نفسه.
import { get, update } from '../../core/db/index.js';
import { nowIso } from '../../core/util/ids.js';
import { effectiveScope } from '../../core/rbac/index.js';
import { managerOfEmployee } from '../org/confirm.js';
import { notify } from '../notifications/notify.js';

/** القيمة الوحيدة غير الفارغة في `task.approval_state` — «تنتظر اعتماداً». */
export const TASK_PENDING = 'PENDING';

/** هل هذه المهمة تنتظر اعتماداً — أي لم تُضَف بعد. */
export const isPendingTask = (row) => String(row?.approval_state || '') === TASK_PENDING;

// ── حاجزان يقرؤهما كل من يقرأ المهام ────────────────────────────────────────
//
// شرطٌ واحد مصدره واحد، لا نصٌّ منسوخ في عشرين استعلاماً ينسى واحدٌ منها. والفراغ هو «مضافة»:
// كل صفٍّ قائم قبل هذه الميزة يمرّ، ولا مهمةٌ تختفي لحظة تطبيق الترحيلة.
//
// `approvedTaskSql` لكل ما يقرأ العمل **عبر الأشخاص**: لوحة المدير، وشاشة المشروع، والتقارير،
// والعدّادات. فالمهمة المعلَّقة ليست عملاً قائماً، وعدُّها يجعل الرقم يقول ما لم يوافق عليه أحد.
export const approvedTaskSql = (pfx = 't.') => `${pfx}approval_state IS NULL`;

// و`ownOrApprovedTaskSql` لقائمة صاحبها وحده: من كتبها يراها معلَّمةً «بانتظار اعتماد مديرك»،
// وإلا اختفت لحظة الحفظ فحسبها ضاعت وأعاد كتابتها. أمّا من أُسنِدت إليه — إن كان غير كاتبها —
// فلا يراها حتى تُضاف إليه فعلاً، وهو نصّ الطلب: «عشان تنضاف له».
export const ownOrApprovedTaskSql = (pfx = 't.', userId = null) => ({
  clause: `(${pfx}approval_state IS NULL OR ${pfx}created_by = ?)`,
  params: [userId],
});

// من يملك أمرَ عمله فلا ينتظر أحداً: مدير النظام، ومن نطاق إنشائه للمهام يتجاوز إدارته
// (قائد قطاع فأوسع). ومديرُ الإدارة يخرج من الشرط تلقائياً بلا استثناءٍ مكتوب له: مديرُ
// إدارته هو نفسه، و`managerOfEmployee` لا تُرجع المرءَ معتمِداً على نفسه.
const SELF_DIRECTED_SCOPES = new Set(['sector', 'company']);

/**
 * القرار كاملاً في نداءٍ واحد: أتُكتب المهمة مضافةً، أم معلَّقةً بانتظار مَن.
 * @param {object} user صاحب الطلب
 * @param {{project_id?: string|null, opportunity_id?: string|null}} link جهة المهمة بعد تطبيعها
 * @returns {Promise<{ needsApproval: boolean, approverUserId: string|null }>}
 */
export async function taskApproval(user, link = {}) {
  const none = { needsApproval: false, approverUserId: null };
  if (!user) return none;
  // بلا جهةٍ مرتبطة لا اعتماد: العمل الداخلي والمهمة الشخصية دفترُ صاحبهما.
  if (!link.project_id && !link.opportunity_id) return none;
  if (user.role_id === 'admin') return none;
  if (SELF_DIRECTED_SCOPES.has(effectiveScope(user, 'create', 'task'))) return none;
  // سجلّ الموظف هو ما يحمل الإدارة (لا الحساب) — والجسر `app_user.employee_id`. ويُقرأ من
  // القاعدة حين لا يحمله سياق الطلب، فلا تتغيّر القاعدة بتغيّر شكل الجلسة.
  const employeeId = user.employee_id
    || (await get('SELECT employee_id FROM app_user WHERE id = ? AND deleted_at IS NULL', [user.id]))?.employee_id
    || null;
  const approverUserId = await managerOfEmployee(employeeId);
  return approverUserId ? { needsApproval: true, approverUserId } : none;
}

/** هل تنتظر مهمةُ هذا المستخدم المرتبطةُ بجهةٍ اعتمادَ مديره — لتقوله الشاشةُ قبل الحفظ لا بعده.
 *  (تمرَّر جهةٌ رمزية: `taskApproval` لا تقرأ من الجهة إلا وجودَها.) */
export const linkedTaskApproval = (user) => taskApproval(user, { project_id: '·' });

/**
 * أثرُ قرار المدير على المهمة.
 *
 * وموضعُ هذا الملف مقصود — كموضع `staffing-settle.js` تماماً: محرّك الاعتمادات عامّ ولا يعرف
 * المهام، والوحدة صاحبة المهمة هي التي تُضيفها أو تُلغيها.
 *
 * @param {object} reqRow صفّ طلب الاعتماد (resource_id = معرّف المهمة)
 * @param {boolean} approved اعتُمدت أم رُدّت
 * @param {string|null} actorUserId معرّف المعتمِد — يُكتب على المهمة أثراً دائماً (٠٣٠)
 */
export async function settleTask(reqRow, approved, actorUserId = null) {
  if (!reqRow || reqRow.resource !== 'task' || !reqRow.resource_id) return;
  const t = await get('SELECT id, title, assignee_user_id, approval_state, deleted_at FROM task WHERE id = ?', [reqRow.resource_id]);
  if (!t || t.deleted_at) return;                    // حُذفت قبل البتّ — لا شيء يُبتّ فيه
  if (approved) {
    await update('task', t.id, { approval_state: null, approved_by: actorUserId || null, approved_at: nowIso() });
    // مهمةٌ كتبها غيرُ صاحبها وأُضيفت الآن باعتماد المدير: صاحبُها لم يعلم بها قط — الحجب
    // كان يخفيها عنه حتى هذه اللحظة. المحرّكُ يُخطر كاتبها («اعتُمد طلبك»)، وهذا خبرُ صاحبها.
    // أما الردّ فلا خبر فيه لصاحبها: لم يرَ المهمة أصلاً، وخبرُ الردّ يذهب لكاتبها من المحرّك.
    if (t.assignee_user_id && t.assignee_user_id !== reqRow.requested_by) {
      await notify(t.assignee_user_id, {
        kind: 'task',
        title: 'مهمة جديدة أُسندت إليك',
        body: `${String(t.title || '').trim()} — أُضيفت بعد اعتماد المدير`,
        ref_resource: 'task', ref_id: t.id,
      });
    }
    return;
  }
  // والردّ يُزيلها ولا يتركها معلَّقة إلى الأبد: «لم تُعتمد» حالةٌ لا تنتهي. حذفٌ ناعم يُبقي
  // الأثر كاملاً في التدقيق ويُخلي قائمة صاحبها ممّا لم يُقبل.
  await update('task', t.id, { deleted_at: nowIso() });
}
