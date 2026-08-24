// ── الإيراد يتبع التسليم لا الفاتورة ────────────────────────────────────────────────────────
// قرار المالك حرفاً: «دائماً لما الواحد يحطّ تمّ إنجاز المخرج أو البروسيس في المشاريع، هو خلاص
// يتحوّل كأنه حقّق إيراداً — مو لازم إثبات الفواتير ولا أي شيء من المالية، لأنه حالياً ما رح
// أخلّي المالية يستعملوا المنصة».
//
// فالمخرَجُ المسلَّم هو حدث الاعتراف بالإيراد، والفاتورة صارت خطوةً لاحقة لا شرطاً سابقاً. وهذا
// ليس تساهلاً محاسبياً: الاعتراف عند إتمام الالتزام هو الأصل، والفوترة توقيتٌ إداريّ يليه.
//
// ── لماذا «سُلِّم» وليس «اعتُمد» وحده ────────────────────────────────────────────────────────
// حالات المخرَج خمس، واثنتان منها تعنيان أن العمل خرج من عندنا: «سُلِّم» و«اعتُمد». والاقتصار على
// «اعتُمد» كان سيجعل القاعدة حبراً على ورق — في بيانات المنصة اليوم ٢٥٩ مخرَجاً مسلَّماً مقابل
// اثنين معتمدين، فالاعتماد خطوةٌ يكتبها العميل ولا يكتبها فريقنا. والمالك قال «تمّ إنجاز المخرج»،
// وإنجازُه تسليمُه.
//
// ── سطرٌ واحد لكل مخرَج، لا سطرٌ لكل ضغطة ───────────────────────────────────────────────────
// المعرّف مشتقٌّ من معرّف المخرَج (`rl_dlv_…`) لا مولَّدٌ عشوائياً. فتكرار الحفظ يُحدِّث السطر
// نفسه ولا يخلق ثانياً، والرجوع بالحالة إلى «مسودة» يمحوه. وبلا هذا الاشتقاق كان كل تعديلٍ على
// اسم المخرَج أو مبلغه يضيف إيراداً جديداً فوق القديم — وهو أسوأ عطلٍ ممكن في رقمٍ مالي: يتضخّم
// بالاستعمال لا بالعمل.
//
// ── المبلغ إجمالي والإيراد صافٍ ─────────────────────────────────────────────────────────────
// مبلغ المخرَج مسجَّل شاملاً الضريبة كقيمة التعاقد (مجموع مخرجات أي مشروع يساوي قيمة عقده)، فيُخزَّن
// الإجمالي كما هو ويُشتقّ الصافي والضريبة بقاعدة `vat.js` وحدها — لا نسخة ثانية من القاعدة هنا.
import { get, run, insert, update } from '../../core/db/index.js';
import { nowIso } from '../../core/util/ids.js';
import { audit } from '../../core/audit/index.js';
import { splitGross } from './vat.js';

/** الحالتان اللتان تعنيان أن العمل أُنجز وخرج — وما عداهما لا يُعترف به. */
export const RECOGNIZING_STATUSES = ['DELIVERED', 'ACCEPTED'];

/** معرّف سطر الإيراد مشتقٌّ من المخرَج — فالعلاقة واحد-لواحد محفوظة بالبناء لا بالانضباط. */
export const revenueLineIdFor = (deliverableId) => 'rl_dlv_' + deliverableId;

const isRecognized = (d) =>
  RECOGNIZING_STATUSES.includes(String(d?.status)) && Number(d?.amount_halalas || 0) > 0;

// شهر الاعتراف: شهر استحقاق المخرَج إن حدّده مدير المشروع، وإلا شهرُ الحدث نفسه (القبول ثم
// التسليم ثم آخر تغيير حالة). وترتيبٌ آخر كان سيضع إيراد مخرَجٍ سُلِّم في يوليو داخل شهر تعديلِ
// اسمه في أغسطس — فيتنقّل الإيراد بين الشهور بلا عمل.
// توأم periodOf في SQL — سنةُ المخرَج المخزَّنة إن سُجِّلت وإلا سنةُ حدثه (القبول ثم التسليم ثم
// آخر تغيير حالة ثم الإنشاء)، حرفاً كترحيلة 020 التي بُني عليها إيراد التسليم. رشّح «مخرجات
// السنة» بها لا بعمود year العاري: العمود فارغ على أغلب الصفوف المستوردة فكان يُسقطها كلها.
// (periodOf أعلاه يستشير updated_at أيضاً كملاذ أخير قبل الإنشاء — فرقٌ موثَّق في فحص الوحدة.)
export const DLV_YEAR_SQL =
  "COALESCE(year, CAST(substr(COALESCE(accepted_at, delivered_at, status_at, created_at),1,4) AS INTEGER))";

function periodOf(d) {
  if (d.year && d.month) return { year: Number(d.year), month: Number(d.month) };
  const stamp = String(d.accepted_at || d.delivered_at || d.status_at || d.updated_at || d.created_at || nowIso());
  return { year: Number(stamp.slice(0, 4)), month: Number(stamp.slice(5, 7)) };
}

/**
 * يوائم سطر الإيراد المشتقّ من مخرَجٍ واحد مع حالته الراهنة: يُنشئ أو يُحدِّث أو يمحو.
 * تُستدعى بعد كل كتابةٍ على المخرَج (إنشاء/تعديل/حذف) داخل معاملة الكتابة نفسها.
 * @returns {'created'|'updated'|'removed'|'none'} ما جرى — لتقوله الواجهة للمستخدم.
 */
export async function syncDeliverableRevenue(ctx, deliverable, project = null) {
  if (!deliverable?.id) return 'none';
  const rid = revenueLineIdFor(deliverable.id);
  const existing = await get('SELECT * FROM revenue_line WHERE id = ?', [rid]);
  const gone = deliverable.deleted_at || !isRecognized(deliverable);

  if (gone) {
    if (!existing) return 'none';
    await run('DELETE FROM revenue_line WHERE id = ?', [rid]);
    await audit(ctx, { action: 'delete', resource: 'revenue_line', resourceId: rid,
      sectorId: existing.sector_id || null,
      detail: { rule: 'deliverable_delivered', deliverable: deliverable.id,
        amount_halalas: existing.amount_halalas, reason: 'المخرَج لم يعد مسلَّماً' } });
    return 'removed';
  }

  const { year, month } = periodOf(deliverable);
  const money = splitGross(deliverable.amount_halalas);
  const sectorId = deliverable.sector_id || project?.sector_id || null;
  const fields = {
    project_id: deliverable.project_id || null,
    sector_id: sectorId,
    deliverable_id: deliverable.id,
    amount_halalas: money.gross_halalas,
    net_amount_halalas: money.net_halalas,
    vat_halalas: money.vat_halalas,
    month, year,
    label: deliverable.name_ar || null,
    auto: 1,
    rule_id: 'deliverable_delivered',
  };

  if (existing) {
    await update('revenue_line', rid, fields);
    await audit(ctx, { action: 'update', resource: 'revenue_line', resourceId: rid, sectorId,
      detail: { rule: 'deliverable_delivered', deliverable: deliverable.id, amount_halalas: money.gross_halalas } });
    return 'updated';
  }
  await insert('revenue_line', { id: rid, ...fields, created_at: nowIso() });
  await audit(ctx, { action: 'create', resource: 'revenue_line', resourceId: rid, sectorId,
    detail: { rule: 'deliverable_delivered', deliverable: deliverable.id, amount_halalas: money.gross_halalas } });
  return 'created';
}
