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
// **روابط وملفات، ولكلٍّ حقيقته**: الرابط الخارجي يبقى رابطاً إلى حيث يسكن الملف (الشاشة
// تقول ذلك صراحةً)، والملف المرفوع (v5.24) تُحفظ بايتاته في القاعدة نفسها — جدول
// `document_blob` (الترحيلة 033، التعليل في ADR-0007): نظام ملفات الحاوية يزول مع كل نشرة،
// فالقرص ليس مخزناً. صفّ `document` يبقى الميتاداتا القانونية للاثنين، والتمييز بوجود
// صفّ بايتات لا بعمود جديد.
import { all, get, insert, update, run, tx } from '../../core/db/index.js';
import { createHash } from 'node:crypto';
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
  const documents = await all(`SELECT id, name, kind, url, note, uploaded_by, created_at, size_bytes,
       EXISTS (SELECT 1 FROM document_blob b WHERE b.document_id = document.id) AS has_file
     FROM document WHERE opportunity_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [oppId]);
  return { opportunityId: oppId, documents, canEdit: can(user, 'update', 'opportunity', o) };
}

// ── الملفات المرفوعة ─────────────────────────────────────────────────────────
// قائمة سماح بالامتداد، والنوع القانوني منها لا من ترويسة المتصفح — الترويسة تصريحُ
// مرسِلٍ لا حقيقة، والامتداد أدنى غموضاً وأسهل شرحاً للمستخدم حين يُرفض.
export const OPP_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const OPP_FILE_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
};

export async function uploadOpportunityFile(ctx, oppId, { fileName, bytes, kind, note } = {}) {
  const user = ctx.user;
  const o = await reach(user, oppId, 'update');
  const name = (fileName || '').toString().trim();
  if (!name) throw badRequest('اسم الملف مفقود — أعد المحاولة من زر الرفع');
  const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  const mime = OPP_FILE_TYPES[ext];
  if (!mime) throw badRequest('نوع الملف غير مدعوم — المسموح: مستندات وجداول وعروض وصور مضغوطة (' + Object.keys(OPP_FILE_TYPES).join('، ') + ')');
  if (!bytes || !bytes.length) throw badRequest('الملف فارغ — اختر ملفاً فيه محتوى');
  if (bytes.length > OPP_FILE_MAX_BYTES) throw badRequest('حجم الملف يتجاوز الحد (15 ميغابايت) — اضغطه أو ارفعه لمخزن خارجي وضع رابطه');
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const docKind = OPP_DOC_KINDS.includes(kind) ? kind : 'other';
  const did = id('doc');
  const now = nowIso();
  await tx(async () => {
    await insert('document', {
      id: did, opportunity_id: oppId, client_id: o.client_id || null, name, kind: docKind,
      url: null, note: (note || '').toString().trim() || null, size_bytes: content.length,
      uploaded_by: user.name_ar || user.username || null, created_at: now,
    });
    await insert('document_blob', {
      document_id: did, content, mime,
      sha256: createHash('sha256').update(content).digest('hex'), created_at: now,
    });
  });
  await audit(ctx, { action: 'create', resource: 'document', resourceId: did, sectorId: o.sector_id,
    detail: { opportunity_id: oppId, name, kind: docKind, size_bytes: content.length, file: true } });
  return await get(`SELECT id, name, kind, url, note, uploaded_by, created_at, size_bytes
     FROM document WHERE id = ?`, [did]);
}

// التنزيل ببوابة قراءة الفرصة نفسها — البايتات لا تغادر إلا لمن يقرأ الصفحة أصلاً.
export async function readOpportunityFileForDownload(user, docId) {
  const d = await get('SELECT * FROM document WHERE id = ? AND deleted_at IS NULL', [docId]);
  if (!d || !d.opportunity_id) throw notFound('المستند غير موجود');
  await reach(user, d.opportunity_id, 'read');
  const b = await get('SELECT content, mime FROM document_blob WHERE document_id = ?', [docId]);
  if (!b) throw notFound('هذا البند رابط خارجي لا ملف مرفوع — افتح رابطه');
  return { name: d.name, mime: b.mime, content: Buffer.isBuffer(b.content) ? b.content : Buffer.from(b.content) };
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
  // الميتاداتا تُحذف حذفاً ناعماً كسائر المنصة (تبقى في الأثر)، والبايتات تُمحى فعلاً —
  // لا معنى لإبقاء محتوى ملفٍ حذفه صاحبه يشغل النسخ الاحتياطي إلى الأبد.
  await tx(async () => {
    await update('document', docId, { deleted_at: nowIso() });
    await run('DELETE FROM document_blob WHERE document_id = ?', [docId]);
  });
  await audit(ctx, { action: 'delete', resource: 'document', resourceId: docId, sectorId: o.sector_id,
    detail: { opportunity_id: d.opportunity_id, name: d.name } });
  return { ok: true };
}
