// ── مستندات الفرصة وروابطها ──────────────────────────────────────────────────
//
// «حط مكان أرفع فيه لنك الفرصة أو الملفات المتعلقة، وأيضاً مكان التكنكل بروبوزل، وأيضاً حط
// لنك الفايننشال بروبوزل» — بلسان المالك.
//
// وجدول `document` يحمل عمود `opportunity_id` **منذ الترحيلة ٠٠٥** ولم يكتب فيه شيء قط: بُني
// الجدول لثلاثة أصحاب (عميل · مشروع · فرصة) ووُصِل اثنان وبقي الثالث معلّقاً. فلا جدول جديد
// هنا ولا ترحيلة — وصلُ ما هو موجود.
//
// وأنواع المستندات ليست أنواع المشروع نفسها: الفرصة قبل الترسية، ولغتها لغةُ العطاء —
// إعلان المنافسة، كراسة الشروط، العرض الفني، العرض المالي. ولذلك قائمتها هنا لا هناك.
//
// **روابط لا ملفات**: الجدول يحفظ بيانات المستند لا محتواه (هكذا صُمّم، ولا مخزن ملفات في
// المنصة). فالحقل رابطٌ إلى حيث يسكن الملف فعلاً — والشاشة تقول ذلك صراحةً كي لا يظنّ أحد
// أنه رفع نسخةً هنا وهي ليست هنا.
import { all, get, insert, update } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { notFound, badRequest } from '../../core/http/errors.js';
import { loadReadableOpportunity } from './opp-access.js';

export const OPP_DOC_KINDS = ['tender', 'rfp_doc', 'technical', 'financial', 'correspondence', 'other'];

// الفحص عبر الباب الواحد الذي يعرف الإدارات المشاركة (opp-access.js): صفحة الفرصة تعرض
// مستنداتها ضمن تفاصيلها، فحكمٌ محلّي بعمود المسؤولة وحده يفتح الصفحة ويُسقط قسم المستندات
// لمديرة الإدارة المشارِكة.
async function reach(user, oppId, action) {
  return await loadReadableOpportunity(user, oppId, action,
    action === 'read' ? undefined : 'إضافة مستند تتطلب صلاحية تعديل الفرصة');
}

export async function opportunityDocuments(user, oppId) {
  const o = await reach(user, oppId, 'read');
  const documents = await all(`SELECT id, name, kind, url, note, uploaded_by, created_at
     FROM document WHERE opportunity_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [oppId]);
  return { opportunityId: oppId, documents, canEdit: can(user, 'update', 'opportunity', o) };
}

export async function addOpportunityDocument(ctx, oppId, data = {}) {
  const user = ctx.user;
  const o = await reach(user, oppId, 'update');
  const name = (data.name || '').toString().trim();
  if (!name) throw badRequest('اكتب اسم المستند — مثال: العرض الفني — النسخة الأولى');
  const url = (data.url || '').toString().trim() || null;
  // الرابط الآمن وحده. الروابط بأنماط أخرى (javascript: مثلاً) تُعرض في صفحةٍ يفتحها كل الفريق،
  // فالشرط حمايةٌ لا تشدّد — وهو نفس شرط مستندات المشروع والعميل، بلا نسخةٍ ثالثة من الحكم.
  if (url && !/^https?:\/\//i.test(url)) throw badRequest('الرابط يجب أن يبدأ بـ https://');
  if (!url) throw badRequest('ضع رابط المستند — المنصة تحفظ رابطه لا نسخةً منه');
  const kind = OPP_DOC_KINDS.includes(data.kind) ? data.kind : 'other';
  const did = id('doc');
  await insert('document', {
    id: did, opportunity_id: oppId, client_id: o.client_id || null, name, kind, url,
    note: (data.note || '').toString().trim() || null,
    uploaded_by: user.name_ar || user.username || null, created_at: nowIso(),
  });
  await audit(ctx, { action: 'create', resource: 'document', resourceId: did, sectorId: o.sector_id,
    detail: { opportunity_id: oppId, name, kind } });
  return await get('SELECT * FROM document WHERE id = ?', [did]);
}

export async function deleteOpportunityDocument(ctx, docId) {
  const user = ctx.user;
  const d = await get('SELECT * FROM document WHERE id = ? AND deleted_at IS NULL', [docId]);
  if (!d || !d.opportunity_id) throw notFound('المستند غير موجود');
  const o = await reach(user, d.opportunity_id, 'update');
  await update('document', docId, { deleted_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: 'document', resourceId: docId, sectorId: o.sector_id,
    detail: { opportunity_id: d.opportunity_id, name: d.name } });
  return { ok: true };
}
