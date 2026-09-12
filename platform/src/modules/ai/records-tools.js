// ── أدوات السجلّ من المحادثة: حذفٌ ناعم، وتعبئةُ النواقص دفعةً ──────────────────────────────
//
// ثلاث قدرات طلبها المالك بعد التدقيق المستقل (2026-09-12) ولم يكن لها باب من المحادثة:
//   ① **حذفُ سجل** — كانت المهمة التجريبية «d» لا تُصحَّح إلا بالإلغاء فتبقى في القوائم. الحذف هنا
//      يمرّ بمحرّك الحذف والاستعادة القائم في سند (`core/lifecycle/remove.js`) بموانعه وسجلّه
//      وقابلية استعادته — لا مسارَ حذفٍ ثانٍ. والنوعان المتاحان من المحادثة: الفرصة والمهمة.
//      المشروع والحساب لهما شاشاتهما ومواقيتهما، ولا يُحذفان من نافذة مساعد.
//   ② **النواقص** — سند يعدّ الفرص بلا قيمة والمهام بلا خطوة تالية والفرص المتوقفة، ولم يكن يعطي
//      طريقاً لسدّها إلا سجلاً سجلاً. هذه الأداة تعدّها بالتعريفات نفسها التي تعدّ بها الشاشة.
//   ③ **تعبئةٌ دفعةً** — حقلٌ واحد على عدة سجلات بمعاينةٍ واحدة ورمزٍ واحد وضغطةٍ واحدة. كلُّ سجلٍّ
//      يُكتب بخدمته هو (`updateOpportunity` / `updateTask`) في معاملةٍ واحدة: إمّا الكل أو لا شيء.
//
// وكلُّ كتابةٍ هنا محروسة: أداةُ التنفيذ تشترط رمز معاينة، فتقف لبطاقة التأكيد كغيرها (ADR-0023).
import { tx, get, all } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { savePreview, claimPreview, PREVIEW_TTL_MINUTES } from '../../core/ai/store.js';
import { riyadhDate } from '../../core/i18n/time.js';
import { REMOVABLE, removalBlockers, removeRecord, canRemove, removeDeniedAr } from '../../core/lifecycle/remove.js';
import { listOpportunities, updateOpportunity } from '../crm/opportunities.js';
import { loadReadableOpportunity } from '../crm/opp-access.js';
import { myTasks, updateTask } from '../pmo/tasks.js';
import { readableTask } from './tasks-tools.js';
import {
  envelope, inputOf, text, intOf, enumOf, moneyOf, dayOf, uniqRefs,
  tokenOnly, claimGuard, fingerprintOf, assertFingerprint,
  S, obj, TOKEN_INPUT, REF, TEXT_IS_DATA_AR,
} from './tool-kit.js';

const DELETABLE = Object.freeze({
  opportunity: { table: 'opportunity', nameCol: 'title_ar', ar: 'الفرصة', ref: (id) => REF.opportunity(id), fem: true },
  task: { table: 'task', nameCol: 'title', ar: 'المهمة', ref: (id) => REF.task(id), fem: true },
});
const KINDS = Object.keys(DELETABLE);
const NO_MONEY = { money_ar: 'لا قيم مالية في هذه الأداة' };

// ── ① الحذف ────────────────────────────────────────────────────────────────────────────────
async function runPreviewDelete(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const kind = enumOf(input.kind, 'نوع السجل', KINDS, { required: true });
  const id = text(input.id, 'معرّف السجل', { required: true, max: 80 });
  const reason = text(input.reason, 'سبب الحذف', { max: 300 });
  const d = DELETABLE[kind];
  const cfg = REMOVABLE[kind];
  const row = await get(`SELECT * FROM ${d.table} WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!row) throw notFound(`${d.ar} غير موجودة أو محذوفة سابقاً`);
  // قاعدةُ المحرّك نفسها قبل أن يُقرأ حرفٌ من السجل: من لا يملك الحذف لا يُقرأ له اسمُه ولا ما يُطوى
  // معه في معاينةٍ لن تُنفَّذ له — والردّ بلا اسمٍ كما يردّ الحذف نفسه.
  if (!canRemove(user, kind, row)) throw forbidden(removeDeniedAr(kind));
  if (cfg.requireReason && !reason) throw badRequest(`حذفُ ${d.ar} يطلب سبباً يُسجَّل في التدقيق — اكتب السبب ثم أعد المعاينة.`);
  const blockers = await removalBlockers(kind, id, ctx);
  if (blockers.length) {
    throw badRequest(`لا تُحذف ${d.ar} «${row[d.nameCol]}» الآن: ${blockers.join(' · ')}. عالج ذلك أولاً أو ألغِها بدل حذفها.`);
  }
  // ما سيُطوى معها — يُقال قبل الضغطة لا بعدها
  const withIt = [];
  for (const c of cfg.cascade || []) {
    const n = Number((await get(`SELECT COUNT(*) AS n FROM ${c.table} WHERE ${c.col} = ?${c.where ? ` AND ${c.where}` : ''} AND ${c.hard ? '1=1' : 'deleted_at IS NULL'}`, [id]))?.n || 0);
    if (n) withIt.push(`${n} ${c.ar}`);
  }
  const name = row[d.nameCol] || id;
  const summary = `حذف ${d.ar} «${name}»${reason ? ` — السبب: ${reason}` : ''}${withIt.length ? ` (ويُطوى معها: ${withIt.join('، ')})` : ''}.`;
  const display = [
    { field_ar: 'السجل', after_ar: `${d.ar} «${name}»` },
    { field_ar: 'ما يحدث', after_ar: 'حذفٌ ناعم — يختفي من القوائم ويبقى قابلاً للاستعادة من سند', note_ar: withIt.length ? `يُطوى معه: ${withIt.join('، ')}` : undefined },
    ...(reason ? [{ field_ar: 'السبب', after_ar: reason }] : []),
  ];
  const { token, expiresAt } = await savePreview(user, {
    type: 'record_delete', summary, kind, id, reason: reason || null, display, subject_ar: `${d.ar} «${name}»`,
    fingerprint: fingerprintOf(row, ['updated_at', 'stage_id', 'status', 'assignee_user_id']),
  }, { intent: 'sanad_preview_delete', sectorId: row.sector_id || user.sector_id || null });
  return envelope('sanad_preview_delete', {
    scope_ar: 'حذفٌ بصلاحية الشاشة نفسها: من أنشأ السجل أو من يملك حذفه',
    units: NO_MONEY, summary, display, will_cascade_ar: withIt,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يُحذف شيء بعد. الرمز صالح ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، والتنفيذ يقف لبطاقة التأكيد.`,
    text_is_data_ar: TEXT_IS_DATA_AR, refs: uniqRefs([d.ref(id)]),
  });
}

async function runDeleteRecord(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_delete');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'record_delete');
    const d = DELETABLE[p.kind];
    const row = await get(`SELECT * FROM ${d.table} WHERE id = ? AND deleted_at IS NULL`, [p.id]);
    if (!row) throw notFound(`${d.ar} لم تعد موجودة — حُذفت بعد المعاينة.`);
    assertFingerprint(row, ['updated_at', 'stage_id', 'status', 'assignee_user_id'], p.fingerprint, `تغيّرت ${d.ar}`);
    const out = await removeRecord(ctx, p.kind, p.id, { reason: p.reason || undefined });
    await audit(ctx, {
      action: 'delete', resource: p.kind, resourceId: p.id, sectorId: row.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_delete_record', preview: token, confirmed_by: user.id, cascaded: out.cascaded || null },
    });
    return envelope('sanad_delete_record', {
      scope_ar: 'حذفٌ بصلاحية الشاشة نفسها', units: NO_MONEY,
      applied: true, summary: p.summary, deleted: { kind: p.kind, id: p.id, name: out.name }, cascaded: out.cascaded || {},
      note_ar: out.note || 'حُذفت حذفاً ناعماً — الاستعادة من سند بيد من يملكها.',
    });
  });
}

// ── ② النواقص ──────────────────────────────────────────────────────────────────────────────
// التعريفات هي تعريفات الشاشة: «بلا قيمة» قيمتها فارغة أو صفر، و«متوقفة» تجاوزت عتبة ركود
// مرحلتها (`rot` من الخدمة)، و«بلا خطوة تالية» كما تعدّها لوحة الفرص و«مهامي» حرفاً.
const GAP_KINDS = ['opportunities_no_value', 'opportunities_no_next_action', 'opportunities_stalled', 'tasks_no_next_step'];
const GAP_AR = Object.freeze({
  opportunities_no_value: 'فرص مفتوحة بلا قيمة مسجَّلة',
  opportunities_no_next_action: 'فرص مفتوحة بلا خطوة تالية',
  opportunities_stalled: 'فرص متوقفة (تجاوزت عتبة ركود مرحلتها)',
  tasks_no_next_step: 'مهامك المفتوحة بلا خطوة تالية',
});
const CAP = 100;

async function runListDataGaps(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const only = enumOf(input.kind, 'نوع النقص', GAP_KINDS, { def: null });
  const today = riyadhDate();
  const out = {};
  const wants = (k) => !only || only === k;
  if (wants('opportunities_no_value') || wants('opportunities_no_next_action') || wants('opportunities_stalled')) {
    // الخدمة تعلّم كل صفٍّ بأعلام الانضباط نفسها التي تعرضها لوحة الفرص (`rot` و`no_next_action`)
    // حين يُمرَّر إليها اليوم — فالعدُّ هنا هو عدُّ الشاشة لا عدٌّ موازٍ.
    const rows = await listOpportunities(user, { today });
    const closed = new Set((await all('SELECT id FROM stage WHERE deleted_at IS NULL AND (is_won = 1 OR is_lost = 1)')).map((s) => s.id));
    const open = rows.filter((r) => !closed.has(r.stage_id));
    const pick = (list, key) => ({
      kind: key, label_ar: GAP_AR[key], total: list.length,
      rows: list.slice(0, CAP).map((r) => ({ id: r.id, title: r.title_ar, stage_id: r.stage_id,
        value_sar: Number(r.value_halalas) ? Math.round(Number(r.value_halalas)) / 100 : null, next_action: r.next_action || null,
        stage_age_days: r.stage_age_days ?? null })),
      partial: { returned: Math.min(list.length, CAP), total: list.length, capped: list.length > CAP },
    });
    if (wants('opportunities_no_value')) out.opportunities_no_value = pick(open.filter((r) => !Number(r.value_halalas)), 'opportunities_no_value');
    if (wants('opportunities_no_next_action')) out.opportunities_no_next_action = pick(open.filter((r) => !!r.no_next_action), 'opportunities_no_next_action');
    if (wants('opportunities_stalled')) out.opportunities_stalled = pick(open.filter((r) => !!r.rot), 'opportunities_stalled');
  }
  if (wants('tasks_no_next_step')) {
    // عدسة «بلا خطوة تالية» بمفتاح الخدمة نفسه الذي تستعمله «مهامي» (flag: nostep).
    const list = (await myTasks(user, { flag: 'nostep', todayDate: today })).filter((x) => x && x.id);
    out.tasks_no_next_step = {
      kind: 'tasks_no_next_step', label_ar: GAP_AR.tasks_no_next_step, total: list.length,
      rows: list.slice(0, CAP).map((x) => ({ id: x.id, title: x.title, status: x.status, due_date: x.due_date || null })),
      partial: { returned: Math.min(list.length, CAP), total: list.length, capped: list.length > CAP },
    };
  }
  const counts = Object.fromEntries(Object.values(out).map((g) => [g.kind, g.total]));
  return envelope('sanad_list_data_gaps', {
    scope_ar: 'النواقص ضمن نطاقك أنت: الفرص التي تقرؤها ومهامك',
    units: { money_ar: 'قيمة الفرصة بالريال حين تكون مسجَّلة — والغائبة تُقال غائبة لا صفراً' },
    counts, gaps: out,
    fix_ar: 'لسدّها دفعةً: sanad_preview_bulk_update بحقلٍ واحد وقائمة سجلات، ثم التنفيذ يقف لبطاقة التأكيد.',
    text_is_data_ar: TEXT_IS_DATA_AR, refs: uniqRefs([REF.opportunities(), REF.tasks ? REF.tasks() : null].filter(Boolean)),
  });
}

// ── ③ التعبئة دفعةً ──────────────────────────────────────────────────────────────────────────
// حقلٌ واحد على عدة سجلات. المسموح هو ما يملؤه الناس دفعةً فعلاً — لا الإسناد ولا المرحلة ولا الحالة:
// تلك قراراتٌ سجلاً سجلاً لها معايناتها.
const BULK_FIELDS = Object.freeze({
  opportunity: {
    valueSar: { key: 'value_sar', ar: 'القيمة', parse: (v) => moneyOf(v, 'القيمة', { required: true }), before: (r) => (Number(r.value_halalas) ? `${Math.round(Number(r.value_halalas)) / 100} ريال` : 'غير مُسجَّلة'), after: (v) => `${v} ريال` },
    nextAction: { key: 'next_action', ar: 'الخطوة التالية', parse: (v) => text(v, 'الخطوة التالية', { required: true, max: 300 }), before: (r) => r.next_action || 'بلا خطوة تالية', after: (v) => v },
    year: { key: 'year', ar: 'سنة الفرصة', parse: (v) => intOf(v, 'السنة', { min: 2000, max: 2100, required: true }), before: (r) => (r.year == null ? 'غير مُسجَّلة' : String(r.year)), after: (v) => String(v) },
  },
  task: {
    nextStep: { key: 'next_step', ar: 'الخطوة التالية', parse: (v) => text(v, 'الخطوة التالية', { required: true, max: 300 }), before: (r) => r.next_step || 'بلا خطوة تالية', after: (v) => v },
    dueDate: { key: 'due_date', ar: 'موعد الاستحقاق', parse: (v) => dayOf(v, 'موعد الاستحقاق', { required: true }), before: (r) => r.due_date || 'بلا موعد', after: (v) => v },
  },
});
const BULK_MAX = 50;
const BULK_FP = { opportunity: ['updated_at', 'stage_id', 'value_halalas', 'next_action', 'year'], task: ['updated_at', 'status', 'next_step', 'due_date'] };

async function runPreviewBulkUpdate(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const kind = enumOf(input.kind, 'نوع السجلات', KINDS, { required: true });
  const field = enumOf(input.field, 'الحقل', Object.keys(BULK_FIELDS[kind]), { required: true });
  const spec = BULK_FIELDS[kind][field];
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw badRequest('أرسل قائمة سجلات: لكلٍّ معرّفه وقيمته الجديدة.');
  if (items.length > BULK_MAX) throw badRequest(`الدفعة الواحدة ${BULK_MAX} سجلاً كحد أقصى — قسّمها.`);
  const d = DELETABLE[kind];
  const changes = []; const rows = [];
  const seen = new Set();
  for (const it of items) {
    const id = text(it?.id, 'معرّف السجل', { required: true, max: 80 });
    if (seen.has(id)) throw badRequest(`السجل ${id} مكرَّر في الدفعة.`);
    seen.add(id);
    const value = spec.parse(it?.value);
    // بابُ الشاشة نفسه لحظةَ المعاينة لا لحظةَ التنفيذ وحدها: ما لا يملك المستخدم تعديله لا تُقرأ
    // له قيمُه الحالية ولا عنوانُه في قبل/بعد. الفرصة ببابها (`loadReadableOpportunity` بفعل
    // «تعديل») والمهمة ببابها (`readableTask` — قاعدة `updateTask` نفسها).
    const row = kind === 'opportunity'
      ? await loadReadableOpportunity(user, id, 'update', 'تعديل الفرصة يتطلب صلاحية تعديلها — يملكها مالك الفرصة وقائد قطاعها، فاطلبها منهما.')
      : await readableTask(user, id);
    const before = spec.before(row), after = spec.after(value);
    if (before === after) continue;                       // لا تغيير — لا يُعدّ
    rows.push({ id, value, fingerprint: fingerprintOf(row, BULK_FP[kind]) });
    changes.push({ id, title: row[d.nameCol], field_ar: `${spec.ar} — «${row[d.nameCol]}»`, before_ar: before, after_ar: after });
  }
  if (!changes.length) throw badRequest('لا فرق بين ما طلبتَه وما هو مسجَّل الآن في كل السجلات — لا شيء يتغيّر.');
  const summary = `تعبئة «${spec.ar}» على ${changes.length} ${kind === 'task' ? 'مهمة' : 'فرصة'} دفعةً واحدة.`;
  const display = changes.map((c) => ({ field_ar: c.field_ar, before_ar: c.before_ar, after_ar: c.after_ar }));
  const { token, expiresAt } = await savePreview(user, {
    type: 'bulk_update', summary, kind, field, key: spec.key, rows, display, subject_ar: summary,
  }, { intent: 'sanad_preview_bulk_update', sectorId: user.sector_id || null });
  return envelope('sanad_preview_bulk_update', {
    scope_ar: 'كلُّ سجلٍّ يُكتب بصلاحية شاشته هو عند التنفيذ — ما لا تملك تعديله يوقف الدفعة كلها',
    units: NO_MONEY, summary, count: changes.length, skipped_unchanged: items.length - changes.length, changes: display,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يُكتب شيء بعد. الدفعة تُنفَّذ كلها أو لا شيء منها، والتنفيذ يقف لبطاقة التأكيد.`,
    text_is_data_ar: TEXT_IS_DATA_AR, refs: uniqRefs(rows.map((r) => d.ref(r.id))),
  });
}

async function runApplyBulkUpdate(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_bulk_update');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'bulk_update');
    const d = DELETABLE[p.kind];
    let n = 0;
    for (const r of p.rows) {
      const row = await get(`SELECT * FROM ${d.table} WHERE id = ? AND deleted_at IS NULL`, [r.id]);
      if (!row) throw notFound(`${d.ar} ${r.id} لم تعد موجودة — أعد المعاينة.`);
      assertFingerprint(row, BULK_FP[p.kind], r.fingerprint, `تغيّرت ${d.ar} «${row[d.nameCol]}» بعد المعاينة`);
      if (p.kind === 'opportunity') await updateOpportunity(ctx, r.id, { [p.key]: r.value });
      else await updateTask(ctx, r.id, { [p.key]: r.value });
      n += 1;
    }
    await audit(ctx, {
      action: 'update', resource: p.kind, resourceId: 'دفعة', sectorId: user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_apply_bulk_update', preview: token, confirmed_by: user.id, field: p.key, count: n, ids: p.rows.map((r) => r.id) },
    });
    return envelope('sanad_apply_bulk_update', {
      scope_ar: 'كلُّ سجلٍّ كُتب بصلاحية شاشته', units: NO_MONEY,
      applied: true, summary: p.summary, count: n,
      refs: uniqRefs(p.rows.map((r) => d.ref(r.id))),
    });
  });
}

// ── السجل ───────────────────────────────────────────────────────────────────────────────
const anyone = (u) => !!u?.id;
export const RECORD_TOOLS = Object.freeze([
  {
    name: 'sanad_preview_delete', label_ar: 'معاينة حذف سجل', kind: 'preview',
    description_ar: 'يعاين حذفاً ناعماً لفرصة أو مهمة: يسمّي السجل، ويقول ما سيُطوى معه، ويردّ بالموانع إن وُجدت (مثل ساعات عمل مسجَّلة أو مشروع ناتج). الفرصة تطلب سبباً يُسجَّل. الحذف قابل للاستعادة من سند. لا يكتب شيئاً. المشروع والحساب لا يُحذفان من المحادثة.',
    input: obj({
      kind: S.en('نوع السجل', KINDS), id: S.str('معرّف السجل', { maxLength: 80 }),
      reason: S.str('سبب الحذف — مطلوب للفرصة', { maxLength: 300 }),
    }, ['kind', 'id']),
    output_ar: 'السجل وما يُطوى معه + رمز المعاينة؛ أو الموانع بجملتها',
    allow: anyone, run: runPreviewDelete,
  },
  {
    name: 'sanad_delete_record', label_ar: 'تأكيد حذف سجل', kind: 'write',
    description_ar: 'يحذف السجل المعاين برمزه وحده — لا يقبل معرّفاً مباشرة. يمرّ بمحرّك الحذف نفسه الذي تمرّ به الشاشة: الصلاحية والموانع والسجل، ويبقى قابلاً للاستعادة.',
    input: TOKEN_INPUT, output_ar: 'ما حُذف وما طُوي معه',
    allow: anyone, run: runDeleteRecord,
  },
  {
    name: 'sanad_list_data_gaps', label_ar: 'النواقص التي يعدّها سند', kind: 'read',
    description_ar: 'يعدّ النواقص بتعريفات الشاشة نفسها ويعرض سجلاتها: فرص مفتوحة بلا قيمة، وفرص بلا خطوة تالية، وفرص متوقفة تجاوزت عتبة ركود مرحلتها، ومهامك المفتوحة بلا خطوة تالية. حتى ١٠٠ سجل لكل نوع مع إعلان الجزئية. الجواب على «أرني ما ينقص» قبل «سدّه دفعةً».',
    input: obj({ kind: S.en('نوعٌ واحد بدل الكل', GAP_KINDS) }),
    output_ar: 'عدّادات لكل نوع + سجلاته بمعرّفاتها؛ الغائب يُقال غائباً لا صفراً',
    allow: anyone, run: runListDataGaps,
  },
  {
    name: 'sanad_preview_bulk_update', label_ar: 'معاينة تعبئة حقل دفعةً', kind: 'preview',
    description_ar: 'يعاين كتابة حقلٍ واحد على عدة سجلات (حتى ٥٠) بمعاينة واحدة: الفرصة — القيمة أو الخطوة التالية أو السنة؛ المهمة — الخطوة التالية أو موعد الاستحقاق. يعرض قبل/بعد لكل سجل ويُسقط ما لا يتغيّر. الإسناد والمرحلة والحالة لها معايناتها سجلاً سجلاً. لا يكتب شيئاً.',
    input: obj({
      kind: S.en('نوع السجلات', KINDS),
      field: S.en('الحقل', [...new Set([...Object.keys(BULK_FIELDS.opportunity), ...Object.keys(BULK_FIELDS.task)])]),
      items: S.arr('السجلات: لكلٍّ معرّفه وقيمته الجديدة', obj({ id: S.str('معرّف السجل', { maxLength: 80 }), value: { description: 'القيمة الجديدة' } }, ['id', 'value']), BULK_MAX),
    }, ['kind', 'field', 'items']),
    output_ar: 'قبل/بعد لكل سجل + عدد ما يتغيّر + رمز المعاينة',
    allow: anyone, run: runPreviewBulkUpdate,
  },
  {
    name: 'sanad_apply_bulk_update', label_ar: 'تأكيد تعبئة حقل دفعةً', kind: 'write',
    description_ar: 'يطبّق الدفعة المعاينة برمزها وحده. كلُّ سجلٍّ يُكتب بخدمته وبصلاحية شاشته في معاملة واحدة: إمّا الكل أو لا شيء، وما تحرّك بعد المعاينة يوقف الدفعة بجملة تسمّيه.',
    input: TOKEN_INPUT, output_ar: 'عدد ما كُتب',
    allow: anyone, run: runApplyBulkUpdate,
  },
]);
