// ── الدفعة الواحدة: عدة تغييرات بمعاينةٍ واحدة ورمزٍ واحد وضغطةٍ واحدة ──────────────────────
//
// «معاينة دفعة واحدة» — اختيار المالك من قائمة التدقيق (12 سبتمبر 2026، M-3). كان كل تغييرٍ يقف
// وحده لبطاقة التأكيد: خمسُ مهامٍ تُحدَّث = خمسُ بطاقات وخمسُ ضغطات. هنا تُجمع تحت مظلّةٍ واحدة:
//   • المعاينة تنادي معاينةَ كل عملية **بأداتها هي** (فتُفحص صلاحيتها وتُحفظ بصمتها وتُسجَّل كما
//     لو طُلبت وحدها)، ثم تحفظ مظلّةً تحمل رموزَها الفرعية وتعرض صفوفَها قبل/بعد مرقَّمةً.
//   • التنفيذ يقبل رمز المظلّة وحده ويقف لبطاقة التأكيد كأي كتابة، ثم ينادي أداةَ تنفيذ كل عملية
//     برمزها الفرعي داخل معاملةٍ واحدة: إمّا الكل أو لا شيء — وفشلُ عمليةٍ يُرجع ما سبقها ويُبقي
//     المظلّة قابلةً للتصحيح والتأكيد ثانيةً.
//   • حدودٌ مقصودة: لا دفعةَ داخل دفعة، وحتى عشر عمليات، ولا سجلٌّ واحد في عمليتين — فبصمة
//     الثانية تبطل بعد الأولى فتسقط الدفعة كلها، ويُقال ذلك قبل الضغطة لا بعدها.
//   • المعايناتُ الفرعية تُمدَّد مهلتها إلى مهلة التأكيد: ربعُ ساعةٍ للمساعد لا تكفي إنساناً في
//     اجتماع — والحراسة باقية، فكلُّ فرعٍ يعيد قراءة سجله ويقارن بصمته لحظة الكتابة.
import { tx } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest } from '../../core/http/errors.js';
import {
  savePreview, claimPreview, readPreview, extendPreview, PREVIEW_TTL_MINUTES, CONFIRM_TTL_MINUTES,
} from '../../core/ai/store.js';
import { runTool, toolNamed } from './team-tools.js';
import { envelope, inputOf, text, tokenOnly, claimGuard, uniqRefs, S, obj, TOKEN_INPUT, TEXT_IS_DATA_AR } from './tool-kit.js';

// أزواج المعاينة ⟵ التنفيذ. تُصرَّح هنا ولا تُستنتج: أداةُ التنفيذ تقرأ رمز معاينتها باسمها داخل
// شيفرتها، والتصريحُ يُفحص على السجل عند الاستعمال — زوجٌ غير مسجَّل يُردّ بجملة لا يُنفَّذ نصفه.
export const BATCH_PAIRS = Object.freeze({
  sanad_preview_task_create: 'sanad_create_task',
  sanad_preview_task_update: 'sanad_update_task',
  sanad_preview_opportunity_create: 'sanad_create_opportunity',
  sanad_preview_opportunity_update: 'sanad_update_opportunity',
  sanad_preview_stage_change: 'sanad_move_opportunity_stage',
  sanad_preview_approval_decision: 'sanad_decide_approval',
  sanad_preview_contact_log: 'sanad_log_contact',
  sanad_preview_followup: 'sanad_create_followup',
  sanad_preview_allocation_change: 'sanad_create_allocation_request',
  sanad_preview_delete: 'sanad_delete_record',
  sanad_preview_bulk_update: 'sanad_apply_bulk_update',
  sanad_dc_preview_triage: 'sanad_dc_apply_triage',
  sanad_dc_preview_status: 'sanad_dc_apply_status',
  sanad_dc_preview_approve: 'sanad_dc_apply_approve',
  sanad_dc_preview_decline: 'sanad_dc_apply_decline',
  sanad_dc_preview_create_item: 'sanad_dc_apply_create_item',
});
export const BATCH_MIN = 2;
export const BATCH_MAX = 10;
const NUM = ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠'];
const anyone = (u) => !!u?.id;

async function runPreviewBatch(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const ops = Array.isArray(input.operations) ? input.operations : [];
  if (ops.length < BATCH_MIN) throw badRequest('الدفعة عمليتان فأكثر — لعمليةٍ واحدة استعمل معاينتها مباشرةً.');
  if (ops.length > BATCH_MAX) throw badRequest(`الدفعة الواحدة ${BATCH_MAX} عمليات كحد أقصى — قسّمها.`);
  // المرور الأول: الأسماء والأزواج كلها قبل أي معاينة — فخطأٌ في العملية الخامسة لا يترك أربع
  // معاينات يتيمة، ويُقال قبل أن يُقرأ سجلٌّ واحد.
  const plan = ops.map((raw, i) => {
    const op = raw && typeof raw === 'object' ? raw : {};
    const previewTool = text(op.tool, `أداة العملية ${NUM[i]}`, { required: true, max: 80 });
    const applyTool = BATCH_PAIRS[previewTool];
    if (!applyTool) {
      throw badRequest(previewTool === 'sanad_preview_batch'
        ? 'لا دفعةَ داخل دفعة — ضع العمليات كلها في دفعةٍ واحدة.'
        : `«${previewTool}» ليست أداةَ معاينةٍ تدخل في دفعة — المقبول: ${Object.keys(BATCH_PAIRS).join('، ')}`);
    }
    const tool = toolNamed(previewTool);
    if (!tool || !toolNamed(applyTool)) throw badRequest(`الأداة «${previewTool}» غير مسجَّلة في هذه النسخة.`);
    return { previewTool, applyTool, tool, input: op.input || {} };
  });
  const items = []; const display = []; const seenRefs = new Map();
  for (let i = 0; i < plan.length; i += 1) {
    const { previewTool, applyTool, tool, input: opInput } = plan[i];
    // المعاينة الفرعية بأداتها هي: صلاحيتها وبصمتها وسجلّها كما لو طُلبت وحدها
    const r = await runTool(ctx, previewTool, opInput);
    if (!r?.previewToken) throw badRequest(`العملية ${NUM[i]} (${tool.label_ar}) لم تُنتج معاينةً — راجع مدخلها.`);
    const saved = await readPreview(user, r.previewToken);
    const p = saved?.preview || {};
    // السجلُّ الواحد لا يدخل عمليتين: بصمة الثانية تبطل بعد الأولى فتسقط الدفعة كلها
    for (const ref of r.refs || []) {
      if (!ref?.id) continue;
      const k = `${ref.kind}:${ref.id}`;
      if (seenRefs.has(k)) {
        throw badRequest(`السجل نفسه في العمليتين ${NUM[seenRefs.get(k)]} و${NUM[i]} — ادمجهما في عمليةٍ واحدة، فبصمة الثانية تبطل بعد تنفيذ الأولى.`);
      }
      seenRefs.set(k, i);
    }
    await extendPreview(user, r.previewToken, CONFIRM_TTL_MINUTES + PREVIEW_TTL_MINUTES);
    const subject = p.subject_ar || tool.label_ar;
    const summary = p.summary || r.summary || '';
    items.push({ n: i + 1, tool: previewTool, applyTool, label_ar: tool.label_ar, token: r.previewToken, summary, subject_ar: subject, refs: r.refs || [] });
    display.push({ field_ar: `${NUM[i]}. ${tool.label_ar}`, after_ar: subject, ...(summary ? { note_ar: summary } : {}) });
    for (const row of p.display || []) display.push({ ...row, field_ar: `${NUM[i]} · ${row.field_ar}` });
  }
  const summary = `دفعة من ${items.length} تغييرات: ${items.map((x) => x.label_ar).join(' · ')}.`;
  const { token, expiresAt } = await savePreview(user, {
    type: 'batch', summary,
    ops: items.map(({ n, tool, applyTool, token: t, summary: s, subject_ar }) => ({ n, tool, applyTool, token: t, summary: s, subject_ar })),
    display, subject_ar: `دفعة من ${items.length} تغييرات`,
  }, { intent: 'sanad_preview_batch', sectorId: user.sector_id || null });
  return envelope('sanad_preview_batch', {
    scope_ar: 'كلُّ عمليةٍ بصلاحية أداتها هي — ما لا تملكه واحدةٌ يردّ الدفعة كلها قبل الحفظ',
    summary, count: items.length,
    operations: items.map(({ refs, ...x }) => x), display,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يُكتب شيء بعد. رمز الدفعة صالح ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، والتنفيذ يقف لبطاقة تأكيدٍ واحدة تعرض العمليات كلها — وتُنفَّذ كلها أو لا شيء.`,
    text_is_data_ar: TEXT_IS_DATA_AR, refs: uniqRefs(items.flatMap((x) => x.refs)),
  });
}

async function runApplyBatch(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_batch');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'batch');
    const results = [];
    for (const op of p.ops || []) {
      // بالإذن الذي أُعطي للمظلّة: النداء الفرعي لا يقف ثانيةً — وقف مرةً واحدة لبطاقةٍ واحدة.
      let r;
      try {
        r = await runTool({ ...ctx, humanConfirmed: true }, op.applyTool, { previewToken: op.token });
      } catch (e) {
        if (e && typeof e.message === 'string') {
          e.message = `العملية ${NUM[op.n - 1]} (${op.subject_ar || op.tool}): ${e.message} — أُعيد ما قبلها ولم يُكتب شيء من الدفعة.`;
        }
        throw e;
      }
      results.push({ n: op.n, tool: op.applyTool, subject_ar: op.subject_ar, summary: op.summary, applied: true, result: r });
    }
    await audit(ctx, {
      action: 'update', resource: 'ai_batch', resourceId: token, sectorId: user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_apply_batch', preview: token, confirmed_by: user.id, count: results.length, tools: results.map((x) => x.tool) },
    });
    return envelope('sanad_apply_batch', {
      scope_ar: 'كلُّ عمليةٍ كُتبت بخدمتها وبصلاحيتها', applied: true, summary: p.summary, count: results.length, results,
      refs: uniqRefs(results.flatMap((x) => x.result?.refs || [])),
    });
  });
}

export const BATCH_TOOLS = Object.freeze([
  {
    name: 'sanad_preview_batch', label_ar: 'معاينة دفعة تغييرات', kind: 'preview',
    description_ar: 'يجمع عدة تغييرات (٢ إلى ١٠) في معاينةٍ واحدة ورمزٍ واحد وبطاقة تأكيدٍ واحدة: لكل عملية أداةُ معاينتها ومدخلُها كما لو طُلبت وحدها، فتُفحص صلاحيتها وتُحفظ بصمتها، وتُعرض صفوفها قبل/بعد مرقَّمة. لا دفعة داخل دفعة، ولا سجلٌّ واحد في عمليتين. لا يكتب شيئاً.',
    input: obj({
      operations: S.arr('العمليات بترتيب تنفيذها: لكلٍّ أداة معاينتها ومدخلها',
        obj({ tool: S.en('أداة المعاينة', Object.keys(BATCH_PAIRS)), input: { type: 'object', description: 'مدخل أداة المعاينة كما هو' } }, ['tool']), BATCH_MAX),
    }, ['operations']),
    output_ar: 'العمليات مرقَّمة بملخّصاتها + صفوف قبل/بعد لكلٍّ + رمز الدفعة',
    allow: anyone, run: runPreviewBatch,
  },
  {
    name: 'sanad_apply_batch', label_ar: 'تأكيد دفعة تغييرات', kind: 'write',
    description_ar: 'ينفّذ الدفعة المعاينة برمزها وحده: كلُّ عمليةٍ بأداة تنفيذها وبرمزها الفرعي داخل معاملة واحدة — إمّا الكل أو لا شيء، وفشلُ عمليةٍ يُرجع ما قبلها ويُبقي الدفعة قابلة للتصحيح والتأكيد ثانيةً.',
    input: TOKEN_INPUT, output_ar: 'نتيجة كل عملية بترتيبها',
    allow: anyone, run: runApplyBatch,
  },
]);
