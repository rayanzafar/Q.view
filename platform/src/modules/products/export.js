// «مركز التطوير» — تصدير قائمة البلاغات ملفَّ Excel.
//
// **ليس محوِّلاً في محرّك الاستيراد/التصدير عمداً** (`src/modules/io/`). ذلك المحرّك يأذن
// بدور الموظف في الشركة: قائدُ قطاعٍ يصدّر ما في قطاعه، ومديرُ النظام كلَّ شيء. وعضويةُ فريق
// المنتج ليست دوراً في الشركة ولا نطاقاً — موظفٌ عاديٌّ قد يكون مديرَ منتجٍ، وقائدُ قطاعٍ قد
// لا يكون عضواً في أي منتج. فلا يمكن التعبير عن هذا الباب هناك، ووضعُه هناك يعني بابين
// للحكم على الصفوف نفسها: بابَ الشاشة (العضوية) وبابَ المحرّك (الدور) — وأوسعُهما هو الذي
// يُخرج البيان فعلاً. فيُنادى `buildExport` مباشرةً كما تفعل «الفعاليات»، والباب باب واحد.
//
// وأعمدة الملف عقدٌ مع من يفتحه على جهازه: ترتيبها ثابت، وأسماؤها من `labels.js` — وكلُّ
// قيمةٍ مخزَّنة تُترجَم قبل أن تُكتب في خلية، فلا يقرأ أحدٌ «RESOLVED» في عمود «الحال».
import { buildExport } from '../io/xlsx.js';
import { assertMember, pAudit } from './access.js';
import { listItems } from './items.js';
import {
  itemStatusLabel, itemTypeLabel, itemUrgencyLabel, itemPriorityLabel, itemSizeLabel, itemSourceLabel,
} from './labels.js';
import { all, get } from '../../core/db/index.js';

// سقفُ حراسةِ ذاكرةٍ لا قاعدةُ عمل — وعددُ ما خرج فعلاً مكتوبٌ في التدقيق.
const EXPORT_MAX_ROWS = 5000;

// الإزاحة ثابتة (+٣ بلا توقيت صيفي): من يفتح الملف يقرأ ساعة الرياض لا ساعة غرينتش.
const RIYADH_OFFSET_HOURS = 3;
const riyadhStamp = (iso) => {
  const t = new Date(String(iso || ''));
  if (Number.isNaN(t.getTime())) return '';
  const s = new Date(t.getTime() + RIYADH_OFFSET_HOURS * 3600000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
};

/** أعمدة الملف بترتيبها — تغييرُ سطرٍ هنا يغيّر ما يفتحه الناس، فلا يُغيَّر عرَضاً. */
export const EXPORT_COLUMNS = Object.freeze([
  { key: 'item_key', labelAr: 'رقم البلاغ' },
  { key: 'type', labelAr: 'النوع' },
  { key: 'title', labelAr: 'العنوان' },
  { key: 'description', labelAr: 'الشرح' },
  { key: 'where_text', labelAr: 'أين حدث' },
  { key: 'tenant', labelAr: 'الجهة' },
  { key: 'reporter', labelAr: 'من أبلغ' },
  { key: 'sector', labelAr: 'القطاع' },
  { key: 'urgency', labelAr: 'أثره على العمل' },
  { key: 'status', labelAr: 'الحال' },
  { key: 'priority', labelAr: 'الأولوية' },
  { key: 'size', labelAr: 'الحجم' },
  { key: 'est_hours', labelAr: 'الساعات المقدَّرة' },
  { key: 'assignee', labelAr: 'المسؤول' },
  { key: 'version', labelAr: 'الإصدار' },
  { key: 'source', labelAr: 'مصدر البلاغ' },
  { key: 'created_at', labelAr: 'تاريخ البلاغ' },
  { key: 'resolved_at', labelAr: 'تاريخ الحل' },
  { key: 'decline_reason', labelAr: 'سبب الرفض' },
]);
export const EXPORT_HEADERS = Object.freeze(EXPORT_COLUMNS.map((c) => c.labelAr));

// الصفُّ قد يأتي باسمٍ محلولٍ من الخدمة أو بمعرّفٍ وحده — نأخذ الاسم إن وُجد ولا نستعلم لكل صفّ.
const nameOf = (...v) => v.find((x) => typeof x === 'string' && x.trim()) || '';

/**
 * يبني ملفّ الصفوف المصفّاة نفسها التي على الشاشة — التصفية تصفيتُها والترتيب ترتيبُها.
 * الباب: عضويةُ فريق المنتج وحدها (`assertMember` يرمي «غير موجود» لغير العضو فلا يُعدّ أحدٌ
 * المنتجات بالتجربة). ولكل تصديرٍ ناجح صفٌّ في التدقيق بعدد صفوفه وتصفيته.
 */
export async function exportItems(ctx, productId, filters = {}) {
  await assertMember(ctx.user, productId);
  const product = await get('SELECT id, name_ar FROM product WHERE id = ?', [productId]);

  // نفس دالّة القائمة بنفس تصفيتها: الملف صورةُ الشاشة لا استعلامٌ ثانٍ قد ينحرف عنها.
  const rows = await listItems(ctx.user, productId, { ...filters, limit: EXPORT_MAX_ROWS });
  // اسم القطاع يُقرأ استعلاماً واحداً لا استعلاماً لكل صفّ — والبند يحمل معرّفه لا اسمه.
  const sectorName = new Map((await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL'))
    .map((x) => [x.id, x.name_ar]));

  const data = rows.map((r) => ({
    item_key: r.item_key || '',
    type: itemTypeLabel(r.type),
    title: r.title || '',
    description: r.description || '',
    where_text: r.where_text || '',
    tenant: nameOf(r.tenant_name, r.tenant_ar),
    reporter: nameOf(r.reporter_name, r.reporter_name_ar, r.reporter_ar),
    sector: nameOf(r.sector_name, sectorName.get(r.sector_id)),
    urgency: itemUrgencyLabel(r.urgency),
    status: itemStatusLabel(r.status),
    priority: r.priority ? itemPriorityLabel(r.priority) : '',
    size: r.size ? itemSizeLabel(r.size) : '',
    est_hours: r.est_hours == null ? '' : r.est_hours,
    assignee: nameOf(r.assignee_name, r.assignee_ar),
    version: nameOf(r.version_label, r.resolved_version_label),
    source: itemSourceLabel(r.source),
    created_at: riyadhStamp(r.created_at),
    resolved_at: riyadhStamp(r.resolved_at),
    decline_reason: r.decline_reason || '',
  }));

  const fileName = `بلاغات ${product?.name_ar || ''}`.trim() + '.xlsx';
  const out = buildExport({ columns: EXPORT_COLUMNS, rows: data, format: 'xlsx', sheetName: 'البلاغات', rtl: true });
  await pAudit(ctx, {
    action: 'export', resource: 'product_item', resourceId: productId, sectorId: null,
    detail: { rows: data.length, filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '')) },
  });
  return { buffer: out.buffer, mime: out.mime, fileName };
}
