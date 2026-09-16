// ── الحقول الحرّة على الفرصة: اسمٌ وقيمة لكل فرصة، بلا عمودٍ جديد لكل سؤال ────────────────
//
// «ثابتة مشتركة + حرّة لكل منافسة» — قرار المالك (2026-09-12، ADR-0024). الثابتُ أعمدةٌ على
// جدول الفرصة (الترحيلة 048: رقم المنافسة، موعد التقديم، تاريخه، المدة، شركاء التحالف) تُدار من
// `updateOpportunity` كسائر حقولها. والحرُّ هنا: صفٌّ لكل سؤالٍ تسأله منافسةٌ بعينها — «اسم مشروع
// الجهة»، «رقم الضمان»، «شرط التوطين» — يُكتب من صفحة الفرصة أو من المحادثة، ويُقرأ معها.
//
// ثلاثة أحكام تحكم هذا الملف:
//   ١) **الباب واحد.** الصلاحية صلاحيةُ تعديل الفرصة نفسها (`loadReadableOpportunity` بفعل
//      «تعديل» — الباب الذي يعرف الإدارات المشاركة)، لا منحةٌ جديدة. من يعدّل الفرصة يعدّل حقولها.
//   ٢) **الاسم يفرد الحقل.** لا حقلان بالاسم نفسه على فرصة واحدة: الكتابةُ باسمٍ قائم تحديثٌ له لا
//      صفٌّ ثانٍ — فالمساعد الذي يعيد الطلب لا يكرّر. والتفرّد يُحرَس في المعاملة لا بقيدٍ جزئي،
//      كي يبقى الحذف ناعماً ويُستعاد.
//   ٣) **الفراغ حذف.** قيمةٌ فارغة تعني أن السؤال لم يعد مطروحاً، فيُطوى الحقل بدل أن يبقى
//      اسماً بلا جواب يُقرأ عطلاً.
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest, notFound } from '../../core/http/errors.js';
import { id, nowIso } from '../../core/util/ids.js';
import { loadReadableOpportunity } from './opp-access.js';

export const FIELD_NAME_MAX = 60;
export const FIELD_VALUE_MAX = 500;
export const FIELDS_PER_OPP_MAX = 30;
const EDIT_DENIED_AR = 'تعديل حقول الفرصة يتطلب صلاحية تعديلها — يملكها مالك الفرصة وقائد قطاعها، فاطلبها منهما.';

const normName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const normValue = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s || null; };

function checkName(name) {
  if (!name) throw badRequest('اسم الحقل مطلوب — مثل «اسم مشروع الجهة» أو «رقم الضمان»');
  if (name.length > FIELD_NAME_MAX) throw badRequest(`اسم الحقل يكون ${FIELD_NAME_MAX} حرفاً على الأكثر`);
}
function checkValue(value) {
  if (value && value.length > FIELD_VALUE_MAX) throw badRequest(`قيمة الحقل تكون ${FIELD_VALUE_MAX} حرفاً على الأكثر — والأطول من ذلك موضعه الملاحظات أو مستندٌ مرتبط`);
}

// الصفوف الحيّة بترتيب إضافتها — للخدمات التي فحصت الصلاحية على الفرصة قبل النداء.
export async function listOpportunityFields(oppId) {
  return all(`SELECT id, name_ar, value_text, sort_order, created_at, updated_at FROM opportunity_field
     WHERE opportunity_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at`, [oppId]);
}

// للمسار المباشر: يفحص قراءة الفرصة ثم يعيد حقولها.
export async function opportunityFields(user, oppId) {
  await loadReadableOpportunity(user, oppId, 'read');
  return listOpportunityFields(oppId);
}

async function liveByName(oppId, name) {
  const rows = await all('SELECT * FROM opportunity_field WHERE opportunity_id = ? AND deleted_at IS NULL', [oppId]);
  return rows.find((r) => normName(r.name_ar) === name) || null;
}

// كتابةُ حقلٍ واحد: بمعرّفه إن أُرسل (تسميةٌ أو تعديل)، وإلا فبالاسم — قائمٌ يُحدَّث وجديدٌ يُضاف.
export async function setOpportunityField(ctx, oppId, data = {}) {
  const user = ctx.user;
  const opp = await loadReadableOpportunity(user, oppId, 'update', EDIT_DENIED_AR);
  const name = normName(data.name_ar ?? data.name);
  checkName(name);
  const value = normValue(data.value_text ?? data.value);
  checkValue(value);
  const now = nowIso();
  return await tx(async () => {
    let target = null;
    if (data.id) {
      target = await get('SELECT * FROM opportunity_field WHERE id = ? AND opportunity_id = ? AND deleted_at IS NULL', [data.id, oppId]);
      if (!target) throw notFound('الحقل غير موجود على هذه الفرصة — ربما حُذف. حدّث الصفحة.');
    }
    const sameName = await liveByName(oppId, name);
    if (sameName && target && sameName.id !== target.id) {
      throw badRequest(`يوجد حقلٌ آخر باسم «${name}» على هذه الفرصة — عدّله هو أو اختر اسماً مختلفاً`);
    }
    if (!target && sameName) target = sameName;   // الكتابة باسمٍ قائم تحديثٌ له لا صفٌّ ثانٍ
    if (target) {
      await update('opportunity_field', target.id, { name_ar: name, value_text: value, updated_at: now, updated_by: user.id });
      await audit(ctx, {
        action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: opp.sector_id || null,
        detail: { custom_field: name, field_id: target.id, before: target.value_text ?? null, after: value, renamed_from: target.name_ar !== name ? target.name_ar : undefined },
      });
      return { ...target, name_ar: name, value_text: value, updated_at: now };
    }
    const count = Number((await get('SELECT COUNT(*) AS n FROM opportunity_field WHERE opportunity_id = ? AND deleted_at IS NULL', [oppId]))?.n || 0);
    if (count >= FIELDS_PER_OPP_MAX) {
      throw badRequest(`الفرصة تحمل ${FIELDS_PER_OPP_MAX} حقلاً إضافياً وهو الحدّ — احذف ما لم يعد يلزم، أو اطلب عموداً ثابتاً إن كان السؤال يتكرّر على كل منافسة`);
    }
    const fid = id('ofd');
    await insert('opportunity_field', {
      id: fid, opportunity_id: oppId, name_ar: name, value_text: value, sort_order: count + 1, created_at: now, created_by: user.id,
    });
    await audit(ctx, {
      action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: opp.sector_id || null,
      detail: { custom_field: name, field_id: fid, before: null, after: value, added: true },
    });
    return { id: fid, opportunity_id: oppId, name_ar: name, value_text: value, sort_order: count + 1, created_at: now, updated_at: null };
  });
}

// حذفٌ ناعم لحقلٍ بمعرّفه — الصلاحية على فرصته لا على الصفّ.
export async function removeOpportunityField(ctx, fieldId) {
  const user = ctx.user;
  const row = await get('SELECT * FROM opportunity_field WHERE id = ? AND deleted_at IS NULL', [fieldId]);
  if (!row) throw notFound('الحقل غير موجود — ربما حُذف من قبل');
  const opp = await loadReadableOpportunity(user, row.opportunity_id, 'update', EDIT_DENIED_AR);
  const now = nowIso();
  await update('opportunity_field', fieldId, { deleted_at: now, updated_at: now, updated_by: user.id });
  await audit(ctx, {
    action: 'update', resource: 'opportunity', resourceId: row.opportunity_id, sectorId: opp.sector_id || null,
    detail: { custom_field: row.name_ar, field_id: fieldId, before: row.value_text ?? null, after: null, removed: true },
  });
  return { ok: true, id: fieldId, name_ar: row.name_ar, opportunity_id: row.opportunity_id };
}

// دفعةٌ من المحادثة: [{ name, value }] — القيمة الفارغة تطوي الحقل إن كان قائماً، وغيرها يُكتب.
// في معاملة واحدة: إمّا الكل أو لا شيء.
export async function applyOpportunityFields(ctx, oppId, items = []) {
  const out = { set: [], removed: [] };
  await tx(async () => {
    for (const it of items) {
      const name = normName(it?.name ?? it?.name_ar);
      checkName(name);
      const value = normValue(it?.value ?? it?.value_text);
      if (value == null) {
        const ex = await liveByName(oppId, name);
        if (ex) { await removeOpportunityField(ctx, ex.id); out.removed.push(name); }
        continue;
      }
      await setOpportunityField(ctx, oppId, { name_ar: name, value_text: value });
      out.set.push(name);
    }
  });
  return out;
}
