// ── قراءة صفّ الفرصة: بابٌ واحد يعرف الإدارات المشاركة ───────────────────────
//
// «ممكن الفرصة تتسكّن على أكثر من إدارة» — والمشاركة تسكن جدول `opportunity_department`، لا
// عمودَ الصفّ. وفحصُ الصلاحية (`can`) يقرأ الهدف الذي يُناوَل له فقط: صفٌّ يُناوَل بعموده
// وحده يُحكَم عليه بإدارته المسؤولة وحدها، فتُرَدّ مديرةُ إدارةٍ **تشارك** في الفرصة عن صفٍّ
// تعرضه قائمتُها — وهو بعينه تناقض «يُعرَض ولا يُفتح» الذي رآه المالك، من بابٍ آخر.
//
// فالحكم هنا على درجتين، والثانية لا تُدفع كلفتها إلا عند الحاجة: يُفحص الصفّ كما هو (وهو ما
// يمرّ لأغلب القرّاء — المالك والقطاع والإدارة المسؤولة)، فإن رُدّ حُمِّلت المشاركات وأُعيد
// الفحص بها. ولا يُحمَّل الجدول لكل قراءةٍ سلفاً: استعلامٌ إضافي على كل فتح صفحةٍ ثمنُ حالةٍ
// نادرة.
//
// والفعل وسيطٌ مقصود (قراءةً كان الافتراض): فريق الفرصة ومستنداتها يفحصان «تعديلاً» بنفس
// الدرجتين — والمشاركة لا تفتح التعديل (scopeReaches يحصر فرع المشاركة بالقراءة حرفاً)، لكن
// مسار التحميل وإعادة الفحص واحد، ونسخُه في كل خدمة يجعلها تختلف يوم يتغيّر أحدها.
import { all, get } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { forbidden, notFound } from '../../core/http/errors.js';

// `deniedMsg` اختياري: رسالة المنع الخاصة بالمسار (مثل «إدارة فريق الفرصة تتطلب صلاحية تعديل
// الفرصة») — فتوحيدُ الباب لا يمحو رسائلَ عربيةً كتبتها الخدمات لمستخدميها.
export async function loadReadableOpportunity(user, oppId, action = 'read', deniedMsg) {
  const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (can(user, action, 'opportunity', row)) return row;
  // الدرجة الثانية: المشاركات تُحمَّل على الهدف باسمٍ يعرفه المحرّك (`partner_department_ids`)
  // ويُعاد السؤال نفسه — لا حكمٌ محلّي هنا، فالقرار يبقى في مكانه الواحد (rbac/index.js).
  const partners = (await all(
    'SELECT department_id FROM opportunity_department WHERE opportunity_id = ?', [oppId]
  )).map((r) => r.department_id).filter(Boolean);
  if (partners.length && can(user, action, 'opportunity', { ...row, partner_department_ids: partners })) {
    return row;
  }
  throw forbidden(deniedMsg);
}
