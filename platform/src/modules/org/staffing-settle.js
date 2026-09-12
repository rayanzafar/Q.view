// ── أثرُ التأكيد على العضوية ──────────────────────────────────────────────────
//
// عضويةٌ تنتظر تأكيداً ليست عضويةً بعد (`membership.status = 'PENDING'`): لو كُتبت نشطةً ثم
// رُدّ الطلب لكان الرجل قد ظهر في الفريق وحُسب في تحميله يوماً أو يومين بلا وجه حق.
//
// وموضعُ هذا الملف مقصود: محرّك الاعتمادات عامّ ولا يعرف التسكين، والوحدة صاحبة العضوية هي
// التي تُفعّلها أو تُلغيها. فلا يتسرّب علمُ نوعٍ بعينه إلى محرّكٍ يخدم الأنواع كلها.
import { get, update } from '../../core/db/index.js';
import { nowIso } from '../../core/util/ids.js';

/**
 * @param {object} reqRow صفّ طلب الاعتماد (resource_id = معرّف العضوية)
 * @param {boolean} approved أُكِّد أم رُدّ
 */
export async function settleStaffing(reqRow, approved) {
  if (!reqRow || reqRow.resource !== 'membership' || !reqRow.resource_id) return;
  const m = await get('SELECT id, status, deleted_at FROM membership WHERE id = ?', [reqRow.resource_id]);
  if (!m || m.deleted_at) return;              // أُزيلت قبل البتّ — لا شيء يُبتّ فيه
  if (approved) { await update('membership', m.id, { status: 'ACTIVE' }); return; }
  // الردّ يُزيل العضوية ولا يتركها معلَّقة إلى الأبد: «لم يُؤكَّد» حالةٌ لا تنتهي، وحذفٌ ناعم
  // يُبقي الأثر كاملاً في التدقيق ويُخلي الشاشة ممّا لم يُقبل.
  await update('membership', m.id, { deleted_at: nowIso() });
}
