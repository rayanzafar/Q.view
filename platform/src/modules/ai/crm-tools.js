// ── أدوات المساعد على الفرص — لوحة المراحل نفسها بصلاحياتها نفسها ────────────────────────────
//
// كل قراءة تمرّ بـ`listOpportunities`/`opportunityDetail` وكل كتابة بـ`createOpportunity`/
// `moveStage` — خدمات الشاشة حرفاً بحرف، ومعها قصّها النطاقي الذي يعرف الإدارات المشاركة
// والقائدة وتسكين الفرصة. فلا نسخة ثانية من النطاق تفترق عن الأولى بعد إصدارين.
//
// وخاصّةُ هذا المحور: **تحريك المرحلة يغيّر رقمين في اللحظة نفسها** — احتمال الفوز يُعاد ضبطه
// على افتراضي المرحلة الجديدة، والقيمة المرجّحة تتبعه. فمعاينةُ التحريك تعرض الرقمين قبل وبعد
// صراحةً، وإلا وقّع القارئ على تغيير مرحلةٍ وهو لا يرى أنه غيّر رقم خطّه المرجّح.
import { tx, get, all } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest, notFound } from '../../core/http/errors.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { savePreview, claimPreview, PREVIEW_TTL_MINUTES } from '../../core/ai/store.js';
import { riyadhDate } from '../../core/i18n/time.js';
import { toHalalas } from '../../core/util/ids.js';
import {
  listOpportunities, opportunityDetail, createOpportunity, updateOpportunity, moveStage, stageAgeDays,
  ENGAGEMENT_TYPES, SOLICITATION_TYPES,
} from '../crm/opportunities.js';
import { applyOpportunityFields, listOpportunityFields } from '../crm/oppfields.js';
import { grossOfNet } from '../finance/vat.js';
import { engagementTypeLabel, solicitationTypeLabel } from '../../web/i18n/glossary.js';
import { approvedTaskSql } from '../pmo/task-approval.js';
import {
  envelope, inputOf, text, intOf, moneyOf, enumOf, boolOf, dayOf, pageOf, partialOf, uniqRefs,
  tokenOnly, claimGuard, fingerprintOf, assertFingerprint, textOrNot, numOrNot, notMeasured, measured,
  S, obj, PAGE_PROPS, TOKEN_INPUT, REF, TEXT_IS_DATA_AR, UNIT_NOTES,
} from './tool-kit.js';

const SAR = (halalas) => (halalas == null ? null : Math.round(Number(halalas)) / 100);
const CRM_UNITS = Object.freeze({
  money_sar_ar: 'المبالغ بالريال السعودي. القيمة الإجمالية قيمة الفرصة كما سُجِّلت، والمرجّحة = الإجمالية × احتمال الفوز — رقمان لا يُجمعان.',
  pct_ar: 'احتمال الفوز نسبة مئوية من 0 إلى 100',
  days_ar: UNIT_NOTES.days_ar,
});

const scopeArOf = (user) => {
  const s = effectiveScope(user, 'read', 'opportunity');
  return s === 'company' ? 'نطاق القراءة: فرص الشركة كلها'
    : s === 'sector' ? 'نطاق القراءة: فرص قطاعك'
      : s === 'department' ? 'نطاق القراءة: فرص إداراتك وما تشارك فيه'
        : 'نطاق القراءة: فرصك أنت وما أُسند إليك';
};

async function stagesMap() {
  const rows = await all('SELECT id, name_ar, default_win_pct, sort_order, is_won, is_lost FROM stage WHERE deleted_at IS NULL ORDER BY sort_order');
  return { rows, by: Object.fromEntries(rows.map((s) => [s.id, s])) };
}

function oppOut(r, stages, today) {
  const value = r.value_halalas == null ? null : SAR(r.value_halalas);
  const win = r.win_pct == null ? null : Number(r.win_pct);
  const st = stages.by[r.stage_id] || null;
  return {
    id: r.id,
    title: r.title_ar,
    stage: r.stage_id, stage_ar: st?.name_ar || r.stage_id,
    value_sar: numOrNot(value, 'ريال سعودي', 'قيمة الفرصة غير مُسجَّلة بعد'),
    win_pct: numOrNot(win, 'نسبة مئوية', 'احتمال الفوز غير مُسجَّل'),
    weighted_sar: (value == null || win == null)
      ? notMeasured('لا قيمة مرجّحة بلا قيمة وبلا احتمال — طرفاها ناقصان')
      : measured(Math.round(value * win) / 100, 'ريال سعودي'),
    owner: r.owner_user_id ? { id: r.owner_user_id, name: r.owner_name || null } : null,
    client: r.client_id ? { id: r.client_id, name: r.client_name || null } : null,
    next_action: textOrNot(r.next_action, 'بلا خطوة تالية مكتوبة — الفرصة تتقادم بلا صاحبِ حركة'),
    stage_age_days: numOrNot(r.stage_age_days ?? stageAgeDays(r, today), 'أيام في المرحلة الحالية'),
    stalled: !!r.rot,
    // تاريخ الإغلاق المتوقع لا يُسجَّل على الفرصة في هذه النسخة — لا عمود له في المنصة. فيُقال
    // غيابُه صراحةً بدل أن يُشتقّ من تاريخٍ آخر فيُقرأ موعداً وهو تخمين.
    expected_close: notMeasured('تاريخ الإغلاق المتوقع لا تسجّله المنصة على الفرصة في هذه النسخة'),
    is_won: !!st?.is_won, is_lost: !!st?.is_lost,
    // ── ما كان على الفرصة ولا تراه المحادثة (H-1): الصفة التجارية والرمز ─────────────────
    code: r.code || null,
    engagement_type: r.engagement_type || null, engagement_type_ar: engagementTypeLabel(r.engagement_type),
    solicitation_type: r.solicitation_type || null, solicitation_type_ar: solicitationTypeLabel(r.solicitation_type),
    delivery_location: textOrNot(r.delivery_location, 'موقع التسليم لم يُحدَّد بعد'),
    // ── حقول المنافسة الثابتة (الترحيلة 048) — الغائب يُقال غائباً ─────────────────────
    tender: {
      tender_no: textOrNot(r.tender_no, 'رقم المنافسة غير مُسجَّل'),
      submission_due: textOrNot(r.submission_due, 'موعد تقديم العرض غير مُسجَّل'),
      submitted_on: textOrNot(r.submitted_on, 'لم يُسجَّل تقديم العرض بعد'),
      duration_months: numOrNot(r.duration_months == null ? null : Number(r.duration_months), 'شهر', 'مدة التنفيذ غير مُسجَّلة'),
      consortium_partners: textOrNot(r.consortium_partners, 'لا تحالف مسجَّل — الشركة وحدها ما لم يُكتب غير ذلك'),
    },
  };
}

// ── حقول المنافسة والصفة التجارية: مواصفةٌ واحدة تقرأ المدخل وتعرض الصفّ ──────────────────
// كلُّ حقلٍ باسمه في المدخل (بالإنجليزية الصغيرة كسائر المدخلات) وعمودِه في الخدمة وتسميته العربية
// وطريقة عرضه. تُستعمل في التسجيل والتعديل معاً فلا يفترق الاثنان على حقل.
const monthsAr = (n) => (n === 1 ? 'شهر واحد' : n === 2 ? 'شهران' : n <= 10 ? `${n} أشهر` : `${n} شهراً`);
const TENDER_SPEC = Object.freeze([
  { key: 'tenderNo', col: 'tender_no', ar: 'رقم المنافسة', parse: (v) => text(v, 'رقم المنافسة', { max: 60 }), show: (v) => String(v) },
  { key: 'submissionDue', col: 'submission_due', ar: 'موعد تقديم العرض', parse: (v) => dayOf(v, 'موعد تقديم العرض'), show: (v) => String(v) },
  { key: 'submittedOn', col: 'submitted_on', ar: 'تاريخ تقديم العرض', parse: (v) => dayOf(v, 'تاريخ تقديم العرض'), show: (v) => String(v) },
  { key: 'durationMonths', col: 'duration_months', ar: 'مدة التنفيذ', parse: (v) => intOf(v, 'مدة التنفيذ بالأشهر', { min: 1, max: 240 }), show: (v) => monthsAr(Number(v)) },
  { key: 'consortiumPartners', col: 'consortium_partners', ar: 'شركاء التحالف', parse: (v) => text(v, 'شركاء التحالف', { max: 300 }), show: (v) => String(v) },
  { key: 'engagementType', col: 'engagement_type', ar: 'نوع الارتباط', parse: (v) => enumOf(v, 'نوع الارتباط', ENGAGEMENT_TYPES), show: (v) => engagementTypeLabel(v) },
  { key: 'solicitationType', col: 'solicitation_type', ar: 'نوع الطرح', parse: (v) => enumOf(v, 'نوع الطرح', SOLICITATION_TYPES), show: (v) => solicitationTypeLabel(v) },
  { key: 'deliveryLocation', col: 'delivery_location', ar: 'موقع التسليم', parse: (v) => text(v, 'موقع التسليم', { max: 160 }), show: (v) => String(v) },
]);
const TENDER_KEYS = TENDER_SPEC.map((s) => s.key);
const TENDER_INPUT = Object.freeze({
  tenderNo: S.str('رقم المنافسة أو مرجعها لدى الجهة', { maxLength: 60 }),
  submissionDue: S.str('موعد تقديم العرض — يوم بصيغة سنة-شهر-يوم', { maxLength: 10 }),
  submittedOn: S.str('تاريخ تقديم العرض فعلاً — يوم بصيغة سنة-شهر-يوم؛ يُترك حتى يُقدَّم', { maxLength: 10 }),
  durationMonths: S.int('مدة التنفيذ بالأشهر', 1, 240),
  consortiumPartners: S.str('شركاء التحالف — نصّ؛ يُترك إن كانت الشركة وحدها', { maxLength: 300 }),
  engagementType: S.en('نوع الارتباط: PROJECT عمل محدَّد · FRAMEWORK اتفاقية إطارية (قيمتها سقف لا التزام)', ENGAGEMENT_TYPES),
  solicitationType: S.en('نوع الطرح: RFI استطلاع سوق · RFP طلب عرض · RFQ طلب سعر · DIRECT_AWARD تكليف مباشر · TENDER منافسة عامة', SOLICITATION_TYPES),
  deliveryLocation: S.str('موقع التسليم أو التنفيذ — نصّ حرّ: جهةُ استلام أو مدينة أو «عن بُعد»', { maxLength: 160 }),
  valueVatIncluded: S.bool('هل القيمة المكتوبة شاملة الضريبة؟ الافتراضي نعم؛ وإن كانت قبل الضريبة تُسجَّل شاملةً بعد إضافتها — المخزَّن دائماً هو الشامل'),
  customFields: S.arr('حقول إضافية خاصة بهذه المنافسة: اسمٌ وقيمة لكلٍّ (قيمةٌ فارغة تحذف الحقل عند التعديل)',
    obj({ name: S.str('اسم الحقل — مثل «رقم الضمان»', { maxLength: 60 }), value: S.str('القيمة', { maxLength: 500 }) }, ['name']), 20),
});
// المدخل ⟵ [{ spec, value }] لما أُرسل فعلاً (الفارغ يُهمَل — والمسح له `clearFields` صراحةً).
function tenderInputsOf(input) {
  const out = [];
  for (const spec of TENDER_SPEC) {
    if (!(spec.key in input)) continue;
    const v = spec.parse(input[spec.key]);
    if (v != null) out.push({ spec, value: v });
  }
  return out;
}
function clearFieldsOf(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw badRequest('الحقول التي تُمسح تُرسَل قائمةً بأسمائها');
  return [...new Set(v.map((k) => enumOf(k, 'الحقل الذي يُمسح', TENDER_KEYS, { required: true })))].map((k) => TENDER_SPEC.find((s) => s.key === k));
}
function customFieldsOf(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw badRequest('الحقول الإضافية تُرسَل قائمةً: لكلٍّ اسمه وقيمته');
  if (v.length > 20) throw badRequest('حتى 20 حقلاً إضافياً في الطلب الواحد');
  const seen = new Set();
  return v.map((it) => {
    const name = text(it?.name, 'اسم الحقل الإضافي', { required: true, max: 60 });
    const value = text(it?.value, `قيمة «${name}»`, { max: 500 });
    if (seen.has(name)) throw badRequest(`الحقل الإضافي «${name}» مكرَّر في الطلب`);
    seen.add(name);
    return { name, value };
  });
}
// القيمة كما اقتُبست: شاملةً (الافتراضي) أو قبل الضريبة فتُحوَّل هنا إلى الشامل كما تفعل الشاشة —
// والمعاينة تقول الرقمين كي لا يؤكّد أحدٌ قيمةً غير التي ستُكتب.
function grossValueOf(valueSar, vatIncluded) {
  if (valueSar == null) return { gross: null, note: null };
  if (vatIncluded === false) {
    const gross = SAR(grossOfNet(toHalalas(valueSar)));
    return { gross, note: `كُتبت قبل الضريبة (${valueSar.toLocaleString('en-US')} ريال) وتُسجَّل شاملةً: ${gross.toLocaleString('en-US')} ريال` };
  }
  return { gross: valueSar, note: null };
}
const customFieldsOut = (rows) => rows.map((f) => ({ id: f.id, name: f.name_ar, value: f.value_text ?? null }));

// ── sanad_list_opportunities ────────────────────────────────────────────────────────────
async function runListOpportunities(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const today = riyadhDate();
  const { page, pageSize } = pageOf(input, { defSize: 25, maxSize: 100 });
  const stages = await stagesMap();
  const stage = text(input.stage, 'المرحلة', { max: 40 });
  if (stage && !stages.by[stage]) throw badRequest(`مرحلة غير معروفة — المراحل: ${stages.rows.map((s) => `${s.id} (${s.name_ar})`).join('، ')}`);
  const rows = await listOpportunities(user, {
    stage: stage || undefined,
    sector: text(input.sector, 'القطاع', { max: 60 }) || undefined,
    department: text(input.department, 'الإدارة', { max: 60 }) || undefined,
  }, { today });

  const ownerId = text(input.ownerUserId, 'معرّف المالك', { max: 80 });
  const clientId = text(input.clientId, 'معرّف العميل', { max: 80 });
  const onlyStalled = boolOf(input.stalled, false);
  const onlyNoNext = boolOf(input.noNextAction, false);
  const openOnly = boolOf(input.openOnly, true);
  let filtered = rows;
  if (ownerId) filtered = filtered.filter((r) => r.owner_user_id === ownerId);
  if (clientId) filtered = filtered.filter((r) => r.client_id === clientId);
  if (onlyStalled) filtered = filtered.filter((r) => r.rot);
  if (onlyNoNext) filtered = filtered.filter((r) => r.no_next_action);
  if (openOnly) filtered = filtered.filter((r) => !stages.by[r.stage_id]?.is_won && !stages.by[r.stage_id]?.is_lost);

  // أسماء المالك والعميل باستعلامين مجمَّعين لا استعلامٍ لكل صف
  const total = filtered.length;
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  const oids = [...new Set(slice.map((r) => r.owner_user_id).filter(Boolean))];
  const cids = [...new Set(slice.map((r) => r.client_id).filter(Boolean))];
  const owners = oids.length ? Object.fromEntries((await all(`SELECT id, COALESCE(name_ar, username) n FROM app_user WHERE id IN (${oids.map(() => '?').join(',')})`, oids)).map((x) => [x.id, x.n])) : {};
  const clients = cids.length ? Object.fromEntries((await all(`SELECT id, name_ar n FROM client WHERE id IN (${cids.map(() => '?').join(',')})`, cids)).map((x) => [x.id, x.n])) : {};

  // لوحة المراحل: مجاميع كل مرحلة داخل النطاق نفسه — قبل الترقيم لا بعده.
  const board = stages.rows.map((s) => {
    const inStage = filtered.filter((r) => r.stage_id === s.id);
    const value = inStage.reduce((a, r) => a + (Number(r.value_halalas) || 0), 0);
    const weighted = inStage.reduce((a, r) => a + Math.round((Number(r.value_halalas) || 0) * ((Number(r.win_pct) || 0) / 100)), 0);
    return {
      stage: s.id, stage_ar: s.name_ar, count: inStage.length,
      value_sar: SAR(value), weighted_sar: SAR(weighted),
      default_win_pct: s.default_win_pct, is_won: !!s.is_won, is_lost: !!s.is_lost,
    };
  }).filter((s) => s.count > 0 || !openOnly);

  return envelope('sanad_list_opportunities', {
    scope_ar: scopeArOf(user), units: CRM_UNITS,
    board,
    opportunities: slice.map((r) => oppOut({ ...r, owner_name: owners[r.owner_user_id] || null, client_name: clients[r.client_id] || null }, stages, today)),
    partial: partialOf({ page, pageSize, total, returned: slice.length }),
    basis_ar: 'القيمة المرجّحة = القيمة الإجمالية × احتمال الفوز. «متوقفة» تعني تجاوزها عتبة الركود لمرحلتها. الافتراضي: المفتوحة وحدها.',
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.opportunities(), ...slice.map((r) => REF.opportunity(r.id))]),
  });
}

// ── sanad_get_opportunity ───────────────────────────────────────────────────────────────
async function runGetOpportunity(ctx, raw) {
  const user = ctx.user;
  const oppId = text(inputOf(raw).opportunityId, 'معرّف الفرصة', { required: true, max: 80 });
  const today = riyadhDate();
  const d = await opportunityDetail(user, oppId, { today });
  const stages = { rows: d.stages, by: Object.fromEntries(d.stages.map((s) => [s.id, s])) };
  const st = stages.by[d.opp.stage_id] || null;
  const winFromStage = st?.default_win_pct ?? null;
  const win = d.opp.win_pct == null ? null : Number(d.opp.win_pct);
  return envelope('sanad_get_opportunity', {
    scope_ar: scopeArOf(user), units: CRM_UNITS,
    opportunity: {
      ...oppOut({ ...d.opp, owner_name: d.owner, client_name: d.client, stage_age_days: d.stage_age_days, rot: d.rot }, stages, today),
      client_name: d.client, department_name: d.department,
      // مصدر احتمال الفوز سؤالٌ يُسأل: افتراضي المرحلة أم تعديل يدوي؟ الفرق قرارٌ لا رقم.
      win_pct_source_ar: win == null ? 'غير مُسجَّل'
        : (winFromStage != null && win === Number(winFromStage) ? `افتراضي المرحلة «${st.name_ar}» (${winFromStage}%)` : 'تعديل يدوي على الفرصة — يختلف عن افتراضي مرحلتها'),
      notes: textOrNot(d.opp.notes, 'بلا ملاحظات مسجَّلة'),
      // الحقول الحرّة: ما سألته هذه المنافسة وحدها — اسمٌ وقيمة (الترحيلة 048)
      custom_fields: customFieldsOut(d.fields || []),
    },
    team: (d.team || []).map((m) => ({ userId: m.user_id || m.userId || null, name: m.name_ar || m.name || null, role_ar: m.role_ar || m.role || null })),
    next_action: {
      text: textOrNot(d.opp.next_action, 'بلا خطوة تالية مكتوبة'),
      // مسؤولها هو مالك الفرصة — لا مسؤولَ منفصلٌ لها في المنصة، ولا موعدَ لها. يُقالان كما هما.
      owner_ar: d.owner || 'غير مُسجَّل',
      owner_basis_ar: 'مسؤول الخطوة التالية هو مالك الفرصة — لا مسؤول منفصل لها في هذه النسخة',
      due: notMeasured('موعد الخطوة التالية لا تسجّله المنصة — تُتابَع من مهمة مرتبطة إن لزم'),
    },
    stage_history: (d.history || []).map((h) => ({
      at: h.changed_at, from: h.from_stage_id, to: h.to_stage_id,
      from_ar: stages.by[h.from_stage_id]?.name_ar || h.from_stage_id || 'البداية',
      to_ar: stages.by[h.to_stage_id]?.name_ar || h.to_stage_id,
      by: h.owner_name || h.username || null, note: h.note || null,
    })),
    contact_log: (d.activities || []).map((a) => ({ id: a.id, at: a.at, kind: a.kind, title: a.title, detail: a.detail, by: a.actor || null })),
    // حاجز الاعتماد على هذه القائمة كما على كل قائمة مهام: مهمةٌ تنتظر اعتماد مدير كاتبها
    // ليست من عمل الفرصة بعد، وعرضُها هنا يجعل من يقرأ الفرصة يعوّل على عملٍ لم يوافق عليه أحد.
    linked_tasks: (await all(
      `SELECT t.id, t.title, t.status, t.due_date FROM task t
        WHERE t.opportunity_id = ? AND t.deleted_at IS NULL AND ${approvedTaskSql('t.')}
        ORDER BY t.due_date LIMIT 25`, [oppId]
    )).map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date ? String(t.due_date).slice(0, 10) : null })),
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.opportunity(oppId), d.opp.client_id ? REF.client(d.opp.client_id) : null]),
  });
}

// ── دورة الإنشاء ────────────────────────────────────────────────────────────────────────
async function runPreviewOppCreate(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const title = text(input.title, 'عنوان الفرصة', { required: true, max: 200, min: 2 });
  const clientId = text(input.clientId, 'معرّف العميل', { max: 80 });
  const clientName = text(input.clientName, 'اسم العميل', { max: 200 });
  if (!clientId && !clientName) throw badRequest('حدّد العميل: معرّفه إن كان مسجَّلاً، أو اسمه ليُطابَق على الجهات القائمة أو يُسجَّل جهةً جديدة.');
  const valueSar = moneyOf(input.valueSar, 'قيمة الفرصة', { required: true });
  const stages = await stagesMap();
  const stageId = enumOf(input.stage, 'المرحلة', stages.rows.map((s) => s.id), { def: 'LEAD' });
  const st = stages.by[stageId];
  const client = clientId ? await get('SELECT id, name_ar FROM client WHERE id = ? AND deleted_at IS NULL', [clientId]) : null;
  if (clientId && !client) throw notFound('العميل المحدَّد غير موجود — ابحث عنه أو اكتب اسمه ليُسجَّل جهةً جديدة.');
  const win = st?.default_win_pct ?? null;
  // ── ما كان يسقط عند التسجيل (تدقيق 12 سبتمبر، H-1): الثابت والحرّ والصفة التجارية والإدارة ──
  const vatIncluded = input.valueVatIncluded == null ? null : boolOf(input.valueVatIncluded);
  const { gross: valueGross, note: vatNote } = grossValueOf(valueSar, vatIncluded);
  const tender = tenderInputsOf(input);
  const custom = customFieldsOf(input.customFields).filter((c) => c.value != null);
  const departmentId = text(input.departmentId, 'معرّف الإدارة', { max: 80 });
  const dept = departmentId ? await get('SELECT id, name_ar, sector_id FROM department WHERE id = ?', [departmentId]) : null;
  if (departmentId && !dept) throw notFound('الإدارة المحدَّدة غير موجودة — اطلبها من الهيكل التنظيمي بمعرّفها، أو اترك الحقل فتُنسب الفرصة إلى قطاعك بلا إدارة.');
  // الإدارة تسكن قطاعها: تسميتُها تسمّي القطاع معها، والخدمة تحكم في منحة الإنشاء على الزوج كاملاً.
  const deptSector = dept ? await get('SELECT id, name_ar FROM sector WHERE id = ?', [dept.sector_id]) : null;
  const deptLabel = dept ? `${dept.name_ar} (${deptSector?.name_ar || dept.sector_id})` : null;
  const willBe = {
    title,
    client_ar: client ? `جهة مسجَّلة: ${client.name_ar}` : `اسم مكتوب: «${clientName}» — يُطابَق على الجهات القائمة، فإن لم يوجد سُجِّل جهةً جديدة`,
    stage: stageId, stage_ar: st.name_ar,
    value_sar: measured(valueGross, 'ريال سعودي — شاملةً الضريبة'),
    win_pct: numOrNot(win, 'نسبة مئوية — افتراضي هذه المرحلة', 'المرحلة بلا احتمال افتراضي'),
    weighted_sar: win == null ? notMeasured('لا قيمة مرجّحة بلا احتمال') : measured(Math.round(valueGross * win) / 100, 'ريال سعودي'),
    expected_close: notMeasured('تاريخ الإغلاق المتوقع لا تسجّله المنصة على الفرصة في هذه النسخة'),
    owner_ar: 'أنت (يمكن تغييره من الشاشة)',
    department_ar: dept ? deptLabel : 'بلا إدارة — تُنسب إلى قطاعك',
    tender_ar: Object.fromEntries(tender.map(({ spec, value }) => [spec.col, spec.show(value)])),
    custom_fields: custom.map((c) => ({ name: c.name, value: c.value })),
  };
  const summary = `تسجيل فرصة «${title}» في مرحلة «${st.name_ar}» بقيمة ${valueGross.toLocaleString('en-US')} ريال، واحتمال الفوز الافتراضي لهذه المرحلة ${win == null ? 'غير مُسجَّل' : win + '%'}${tender.length ? `، مع ${tender.length} من حقول المنافسة` : ''}${custom.length ? ` و${custom.length} حقل إضافي` : ''}.`;
  const extra = Object.fromEntries(tender.map(({ spec, value }) => [spec.col, value]));
  if (dept) { extra.department_id = dept.id; extra.sector_id = dept.sector_id; }
  if (vatIncluded === false) extra.value_vat_included = false;
  const { token, expiresAt } = await savePreview(user, {
    type: 'opportunity_create', summary,
    fields: { title_ar: title, client_id: clientId || null, client_name: clientName || null, value_sar: valueSar, stage_id: stageId, win_pct: win, extra },
    customFields: custom,
    display: [
      { field_ar: 'عنوان الفرصة', after_ar: title },
      { field_ar: 'الجهة', after_ar: willBe.client_ar },
      { field_ar: 'المرحلة', after_ar: st.name_ar },
      { field_ar: 'القيمة', after_ar: `${valueGross.toLocaleString('en-US')} ريال`, ...(vatNote ? { note_ar: vatNote } : {}) },
      { field_ar: 'احتمال الفوز', after_ar: win == null ? 'غير مُسجَّل' : `${win}%`, note_ar: 'افتراضي هذه المرحلة' },
      { field_ar: 'مسؤول الفرصة', after_ar: 'أنت' },
      ...(dept ? [{ field_ar: 'الإدارة المسؤولة', after_ar: deptLabel }] : []),
      ...tender.map(({ spec, value }) => ({ field_ar: spec.ar, after_ar: spec.show(value) })),
      ...custom.map((c) => ({ field_ar: `حقل إضافي «${c.name}»`, after_ar: c.value })),
    ],
  }, { intent: 'sanad_preview_opportunity_create', sectorId: user.sector_id || null });
  return envelope('sanad_preview_opportunity_create', {
    scope_ar: scopeArOf(user), units: CRM_UNITS,
    summary, will_be: willBe,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم تُسجَّل الفرصة بعد. المعاينة صالحة ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، وتُؤكَّد برمزها عبر sanad_create_opportunity.`,
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.opportunities()]),
  });
}

async function runCreateOpportunity(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_opportunity_create');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'opportunity_create');
    const f = p.fields || {};
    // `new_client_name` هو المفتاح الذي يعرفه باب الفرصة: يُطابَق على الجهات القائمة أولاً
    // فيُعاد استعمال الموجود، ولا تُنشأ جهةٌ جديدة إلا حين لا يوجد نظير — كما تفعل الشاشة.
    // واحتمال الفوز يُكتب صراحةً على افتراضي المرحلة، وهو ما أعلنته المعاينة نصّاً.
    const row = await createOpportunity(ctx, {
      title_ar: f.title_ar, client_id: f.client_id || undefined, new_client_name: f.client_name || undefined,
      value_sar: f.value_sar, stage_id: f.stage_id, win_pct: f.win_pct ?? null,
      // حقول المنافسة والصفة التجارية والإدارة وراية الضريبة — كما عُرضت في المعاينة حرفاً
      ...(f.extra || {}),
    });
    // الحقول الحرّة بخدمتها هي، في المعاملة نفسها — إمّا الفرصة بحقولها أو لا شيء
    const custom = Array.isArray(p.customFields) && p.customFields.length ? await applyOpportunityFields(ctx, row.id, p.customFields) : null;
    await audit(ctx, {
      action: 'create', resource: 'opportunity', resourceId: row.id, sectorId: row.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_create_opportunity', preview: token, confirmed_by: user.id, title: row.title_ar, custom_fields: custom?.set || [] },
    });
    const stages = await stagesMap();
    return envelope('sanad_create_opportunity', {
      scope_ar: scopeArOf(user), units: CRM_UNITS,
      applied: true, summary: p.summary,
      opportunity: { ...oppOut(row, stages, riyadhDate()), custom_fields: customFieldsOut(await listOpportunityFields(row.id)) },
      refs: uniqRefs([REF.opportunity(row.id), REF.opportunities()]),
    });
  });
}

// ── دورة تحريك المرحلة: الرقمان قبل وبعد ────────────────────────────────────────────────
const FP_FIELDS = ['stage_id', 'win_pct', 'value_halalas', 'updated_at'];

async function runPreviewStageChange(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const oppId = text(input.opportunityId, 'معرّف الفرصة', { required: true, max: 80 });
  const stages = await stagesMap();
  const toStage = enumOf(input.toStage, 'المرحلة الجديدة', stages.rows.map((s) => s.id), { required: true });
  const note = text(input.note, 'السبب أو الملاحظة', { max: 500 });
  // الحارس نفسه الذي يحرس الشاشة: التحريك يتطلب صلاحية تعديل الفرصة، والردّ عربي من الخدمة.
  const d = await opportunityDetail(user, oppId, { today: riyadhDate() });
  if (!d.canEdit) throw badRequest('نقل مرحلة الفرصة يتطلب صلاحية تعديلها — يملكها مالك الفرصة وقائد قطاعها، فاطلبها منهما.');
  const from = stages.by[d.opp.stage_id] || null;
  const to = stages.by[toStage];
  if (from?.id === to.id) throw badRequest('الفرصة في هذه المرحلة أصلاً — لا شيء يتغيّر.');
  const value = d.opp.value_halalas == null ? null : SAR(d.opp.value_halalas);
  const winBefore = d.opp.win_pct == null ? null : Number(d.opp.win_pct);
  const winAfter = to.default_win_pct == null ? null : Number(to.default_win_pct);
  const weighted = (v, w) => (v == null || w == null ? null : Math.round(v * w) / 100);
  // الخسارة والتراجع عن الفوز: قرارا عملٍ لا تصحيحا بيانات — سببٌ مكتوب شرطٌ في الأداة كما في الخدمة.
  if (to.is_lost && !note) throw badRequest('الإغلاق «مفقودة» يغيّر خط الفرص المعلن — اكتب سبب الفقدان قبل المعاينة.');
  if (from?.is_won && !to.is_won && !note) throw badRequest('التراجع عن الفوز يغيّر المبيعات المعلنة — اكتب سبب التراجع قبل المعاينة.');
  const changes = [
    { field_ar: 'المرحلة', before_ar: from?.name_ar || 'بلا مرحلة', after_ar: to.name_ar },
    { field_ar: 'احتمال الفوز', before_ar: winBefore == null ? 'غير مُسجَّل' : `${winBefore}%`, after_ar: winAfter == null ? 'غير مُسجَّل' : `${winAfter}%`,
      note_ar: 'يُعاد ضبطه على افتراضي المرحلة الجديدة — أي تعديل يدوي سابق يزول' },
    { field_ar: 'القيمة المرجّحة', before_ar: weighted(value, winBefore) == null ? 'غير مُسجَّلة' : `${weighted(value, winBefore).toLocaleString('en-US')} ريال`,
      after_ar: weighted(value, winAfter) == null ? 'غير مُسجَّلة' : `${weighted(value, winAfter).toLocaleString('en-US')} ريال`,
      note_ar: 'تتبع احتمال الفوز — تتغيّر بتغيّر المرحلة في اللحظة نفسها' },
  ];
  const summary = `نقل «${d.opp.title_ar}» من «${from?.name_ar || 'بلا مرحلة'}» إلى «${to.name_ar}»${note ? ` — السبب: ${note}` : ''}.`;
  const { token, expiresAt } = await savePreview(user, {
    type: 'opportunity_stage', summary, oppId, toStage, note: note || null, display: changes,
    subject_ar: `الفرصة «${d.opp.title_ar}»`,
    fingerprint: fingerprintOf(d.opp, FP_FIELDS),
  }, { intent: 'sanad_preview_stage_change', sectorId: d.opp.sector_id || user.sector_id || null });
  return envelope('sanad_preview_stage_change', {
    scope_ar: scopeArOf(user), units: CRM_UNITS,
    opportunity: { id: oppId, title: d.opp.title_ar, value_sar: numOrNot(value, 'ريال سعودي', 'قيمة الفرصة غير مُسجَّلة') },
    summary, changes,
    creates_project_ar: to.is_won ? 'الفوز يولّد مشروعاً مقابلاً في المحفظة تلقائياً — لا يبقى فوزٌ بلا عملٍ يقابله.' : null,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يتغيّر شيء بعد. الرمز صالح ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، ويبطل إن تحرّكت الفرصة قبل تأكيده.`,
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.opportunity(oppId)]),
  });
}

async function runMoveStage(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_stage_change');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'opportunity_stage');
    const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [p.oppId]);
    if (!row) throw notFound('الفرصة لم تعد موجودة — حُذفت بعد المعاينة.');
    assertFingerprint(row, FP_FIELDS, p.fingerprint, 'تغيّرت الفرصة');
    const out = await moveStage(ctx, p.oppId, p.toStage, p.note);
    await audit(ctx, {
      action: 'update', resource: 'opportunity', resourceId: p.oppId, sectorId: row.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_move_opportunity_stage', preview: token, confirmed_by: user.id, stage: `${row.stage_id}→${p.toStage}` },
    });
    const stages = await stagesMap();
    const after = await get('SELECT * FROM opportunity WHERE id = ?', [p.oppId]);
    return envelope('sanad_move_opportunity_stage', {
      scope_ar: scopeArOf(user), units: CRM_UNITS,
      applied: true, summary: p.summary,
      opportunity: oppOut(after, stages, riyadhDate()),
      project_created: out?.id ? { id: out.id, name: out.name_ar || null, href: `/app/project/${out.id}` } : null,
      refs: uniqRefs([REF.opportunity(p.oppId), out?.id ? REF.project(out.id) : null]),
    });
  });
}

// ── دورة تعديل حقول الفرصة ──────────────────────────────────────────────────────────────
//
// تحريكُ المرحلة كان الوجهَ الوحيد للتعديل، فمن أراد تصحيح عنوانٍ أو قيمةٍ أو جهةٍ رجع إلى
// الشاشة. وهذه الأداة تفتح الحقول التي تُصحَّح فعلاً، وتُبقي **إعادة الإسناد** مغلقةً عمداً:
// القطاع والإدارة والمسؤول والإدارات المشاركة لا تُمَسّ من هنا. ثلاثة أسباب، لا واحد:
// أولاً أنها تنقل الفرصة من ميزان إدارةٍ إلى ميزان أخرى فتتحرّك أرقامٌ معلنة آخر السنة؛
// وثانياً أنها قد تُخرج الفرصة من نطاق ناقلها في اللحظة نفسها فيكتب ثم لا يقرأ ما كتب؛
// وثالثاً أن الشاشة تعرض عليه شجرة القطاعات والإدارات فيرى ما يختار — والمحادثة لا تعرضها.
const UPD_FP_FIELDS = ['title_ar', 'value_halalas', 'client_id', 'year', 'priority', 'next_action', 'notes', 'win_pct', 'stage_id', 'updated_at',
  'engagement_type', 'solicitation_type', 'delivery_location', 'tender_no', 'submission_due', 'submitted_on', 'duration_months', 'consortium_partners'];
const OPP_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const money = (v) => (v == null ? 'غير مُسجَّلة' : `${Number(v).toLocaleString('en-US')} ريال`);
const weightedOf = (v, w) => (v == null || w == null ? null : Math.round(v * w) / 100);

// حقولٌ مغلقة تُردّ صراحةً ولا تُهمَل بصمت. الفرق ليس شكلياً: من أرسل `sectorId` وأُهمل بلا
// كلمة يقرأ معاينةً لا ذكر فيها للقطاع، فيؤكّدها ظانّاً أنه نقلها — ويكتشف بعد أسبوع أنها لم
// تتحرّك. والصمت هنا أسوأ من المنع، لأن المنع يُعلِّمه أين يذهب.
const CLOSED_FIELDS = Object.freeze({
  sectorId: 'قطاع الفرصة', sector_id: 'قطاع الفرصة',
  departmentId: 'إدارة الفرصة', department_id: 'إدارة الفرصة',
  ownerUserId: 'مسؤول الفرصة', owner_user_id: 'مسؤول الفرصة',
  partnerDepartmentIds: 'الإدارات المشاركة', partner_department_ids: 'الإدارات المشاركة',
  stage: 'مرحلة الفرصة', toStage: 'مرحلة الفرصة', stage_id: 'مرحلة الفرصة',
});

async function runPreviewOppUpdate(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const closed = Object.keys(input).filter((k) => k in CLOSED_FIELDS);
  if (closed.length) {
    const names = [...new Set(closed.map((k) => CLOSED_FIELDS[k]))];
    const stageOnly = names.length === 1 && names[0] === 'مرحلة الفرصة';
    throw badRequest(stageOnly
      ? 'مرحلة الفرصة لا تتحرّك من هنا — لها معاينتها الخاصة (sanad_preview_stage_change) لأنها تغيّر احتمال الفوز والقيمة المرجّحة معها.'
      // صيغةُ المصدر («تعديلُ كذا لا يتمّ») تستوي مع المفرد والجمع ومع اختلاف التذكير
      // والتأنيث في القائمة — «القطاع والإدارة والمسؤول» لا يجتمعون على فعلٍ واحد بغيرها.
      : `تعديلُ ${names.join(' و')} لا يتمّ من المساعد — يُدار من صفحة الفرصة حيث تُرى شجرة القطاعات والإدارات، لأن إعادة الإسناد تنقل الفرصة من ميزان إدارةٍ إلى ميزان أخرى.`);
  }
  const oppId = text(input.opportunityId, 'معرّف الفرصة', { required: true, max: 80 });
  const d = await opportunityDetail(user, oppId, { today: riyadhDate() });
  if (!d.canEdit) throw badRequest('تعديل الفرصة يتطلب صلاحية تعديلها — يملكها مالك الفرصة وقائد قطاعها، فاطلبها منهما.');
  const row = d.opp;

  const title = text(input.title, 'عنوان الفرصة', { max: 200, min: 2 });
  const valueSar = moneyOf(input.valueSar, 'قيمة الفرصة');
  const clientId = text(input.clientId, 'معرّف الجهة', { max: 80 });
  const clientName = text(input.clientName, 'اسم الجهة', { max: 200 });
  if (clientId && clientName) throw badRequest('حدّد الجهة بمعرّفها أو باسمها — لا بالاثنين معاً، كي لا يلتبس أيّهما المقصود.');
  const year = intOf(input.year, 'سنة الفرصة', { min: 2000, max: 2100 });
  const priority = enumOf(input.priority, 'الأولوية', OPP_PRIORITIES);
  const nextAction = text(input.nextAction, 'الخطوة التالية', { max: 300 });
  const notes = text(input.notes, 'الملاحظات', { max: 1000 });
  const winPct = intOf(input.winPct, 'احتمال الفوز', { min: 0, max: 100 });
  // حقول المنافسة والصفة التجارية (الترحيلة 048) والحقول الحرّة والمسح الصريح وراية الضريبة
  const vatIncluded = input.valueVatIncluded == null ? null : boolOf(input.valueVatIncluded);
  const { gross: valueGross, note: vatNote } = grossValueOf(valueSar, vatIncluded);
  const tender = tenderInputsOf(input);
  const clears = clearFieldsOf(input.clearFields);
  const custom = customFieldsOf(input.customFields);
  for (const { spec } of tender) {
    if (clears.includes(spec)) throw badRequest(`«${spec.ar}» أُرسل بقيمةٍ وطُلب مسحُه في الطلب نفسه — قرّر أحدهما.`);
  }

  const client = clientId ? await get('SELECT id, name_ar FROM client WHERE id = ? AND deleted_at IS NULL', [clientId]) : null;
  if (clientId && !client) throw notFound('الجهة المحدَّدة غير موجودة — ابحث عنها أو اكتب اسمها ليُطابَق على الجهات القائمة.');

  const valueBefore = row.value_halalas == null ? null : SAR(row.value_halalas);
  const winBefore = row.win_pct == null ? null : Number(row.win_pct);
  const changes = [];
  const fields = {};
  const add = (field_ar, before_ar, after_ar, note_ar = null) => changes.push({ field_ar, before_ar, after_ar, ...(note_ar ? { note_ar } : {}) });

  if (title != null && title !== row.title_ar) { add('العنوان', row.title_ar, title); fields.title_ar = title; }
  if (valueGross != null && valueGross !== valueBefore) {
    add('القيمة الإجمالية', money(valueBefore), money(valueGross), vatNote);
    // المرجّحة ليست حقلاً يُكتب بل حاصلُ ضربٍ — تتحرّك بتحرّك أيٍّ من طرفيها، فتُعرض صفاً
    // مستقلاً كي لا يظنّ القارئ أنه غيّر رقماً واحداً وهو يغيّر رقمين في اللحظة نفسها.
    const wNow = winPct != null ? winPct : winBefore;
    add('القيمة المرجّحة', money(weightedOf(valueBefore, winBefore)), money(weightedOf(valueGross, wNow)),
      'تتبع القيمة واحتمال الفوز معاً — لا تُكتب مباشرةً');
    fields.value_sar = valueGross;
  }
  // ── الثابت: صفٌّ لكل حقلٍ يتغيّر فعلاً، والمسح صفٌّ يقول ما كان ─────────────────────
  for (const { spec, value } of tender) {
    const before = row[spec.col] ?? null;
    if (before != null && String(before) === String(value)) continue;
    add(spec.ar, before == null ? 'لم يُحدَّد' : spec.show(before), spec.show(value)); fields[spec.col] = value;
  }
  for (const spec of clears) {
    const before = row[spec.col] ?? null;
    if (before == null) continue;                                   // فارغٌ أصلاً — لا شيء يُمسح
    add(spec.ar, spec.show(before), 'يُمسح — لم يُحدَّد'); fields[spec.col] = '';
  }
  // ── الحرّ: القائم يُقارَن بقيمته، والجديد يُقال جديداً، والفارغ حذفٌ يُقال حذفاً ─────────
  const customChanges = [];
  if (custom.length) {
    const byName = new Map((await listOpportunityFields(oppId)).map((f) => [f.name_ar, f]));
    for (const c of custom) {
      const ex = byName.get(c.name);
      if (c.value == null) {
        if (!ex) continue;
        add(`حقل إضافي «${c.name}»`, ex.value_text || 'بلا قيمة', 'يُحذف'); customChanges.push(c); continue;
      }
      if (ex && String(ex.value_text || '') === c.value) continue;
      add(`حقل إضافي «${c.name}»`, ex ? (ex.value_text || 'بلا قيمة') : 'غير موجود — يُضاف', c.value); customChanges.push(c);
    }
  }
  if (client && String(client.id) !== String(row.client_id || '')) {
    add('الجهة', d.client || 'بلا جهة', client.name_ar); fields.client_id = client.id;
  }
  if (clientName) {
    add('الجهة', d.client || 'بلا جهة', `اسم مكتوب: «${clientName}»`,
      'يُطابَق على الجهات القائمة أولاً، فإن لم يوجد نظيرٌ سُجِّلت جهةً جديدة');
    fields.new_client_name = clientName;
  }
  if (year != null && year !== (row.year == null ? null : Number(row.year))) {
    add('سنة الفرصة', row.year == null ? 'غير مُسجَّلة' : String(row.year), String(year),
      row.source === 'project' && row.year == null
        ? 'هذه الفرصة مرآةُ مشروعٍ كانت مستبعدةً من المبيعات لغياب سنتها — تثبيتُ السنة يعيدها إلى مبيعات تلك السنة'
        : 'السنة هي التي تُحتسب بها الفرصة في مبيعات عامها');
    fields.year = year;
  }
  if (priority != null && priority !== (row.priority || null)) { add('الأولوية', row.priority || 'غير مُسجَّلة', priority); fields.priority = priority; }
  if (nextAction != null && nextAction !== (row.next_action || null)) {
    add('الخطوة التالية', row.next_action || 'بلا خطوة تالية مكتوبة', nextAction); fields.next_action = nextAction;
  }
  if (notes != null && notes !== (row.notes || null)) { add('الملاحظات', row.notes || 'بلا ملاحظات', notes); fields.notes = notes; }
  if (winPct != null && winPct !== winBefore) {
    add('احتمال الفوز', winBefore == null ? 'غير مُسجَّل' : `${winBefore}%`, `${winPct}%`,
      'تعديلٌ يدوي يزول عند أول تحريكٍ للمرحلة، لأن التحريك يُعيد ضبطه على افتراضي المرحلة الجديدة');
    if (!('value_sar' in fields)) {
      add('القيمة المرجّحة', money(weightedOf(valueBefore, winBefore)), money(weightedOf(valueBefore, winPct)),
        'تتبع القيمة واحتمال الفوز معاً — لا تُكتب مباشرةً');
    }
    fields.win_pct = winPct;
  }
  if (!changes.length) throw badRequest('لا شيء يتغيّر — القيم المرسلة هي القيم المسجَّلة أصلاً. اكتب ما تريد تغييره فعلاً.');

  const summary = `تعديل «${row.title_ar}»: ${changes.map((c) => c.field_ar).join(' · ')}.`;
  const { token, expiresAt } = await savePreview(user, {
    type: 'opportunity_update', summary, oppId, fields, customFields: customChanges, display: changes,
    subject_ar: `الفرصة «${row.title_ar}»`,
    fingerprint: fingerprintOf(row, UPD_FP_FIELDS),
  }, { intent: 'sanad_preview_opportunity_update', sectorId: row.sector_id || user.sector_id || null });
  return envelope('sanad_preview_opportunity_update', {
    scope_ar: scopeArOf(user), units: CRM_UNITS,
    opportunity: { id: oppId, title: row.title_ar, stage_ar: (await stagesMap()).by[row.stage_id]?.name_ar || row.stage_id },
    summary, changes,
    not_touched_ar: 'لا يمسّ هذا التعديل قطاع الفرصة ولا إدارتها ولا مسؤولها ولا الإدارات المشاركة، ولا مرحلتها — إعادة الإسناد تُدار من صفحة الفرصة حيث تُرى شجرة القطاعات والإدارات، وتحريك المرحلة له معاينته الخاصة.',
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يتغيّر شيء بعد. الرمز صالح ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، ويبطل إن تحرّكت الفرصة قبل تأكيده.`,
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.opportunity(oppId)]),
  });
}

async function runUpdateOpportunity(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_opportunity_update');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'opportunity_update');
    const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [p.oppId]);
    if (!row) throw notFound('الفرصة لم تعد موجودة — حُذفت بعد المعاينة.');
    assertFingerprint(row, UPD_FP_FIELDS, p.fingerprint, 'تغيّرت الفرصة');
    const fieldKeys = Object.keys(p.fields || {});
    const customFields = Array.isArray(p.customFields) ? p.customFields : [];
    // حقولُ الفرصة بخدمتها، والحقولُ الحرّة بخدمتها — في المعاملة نفسها. وطلبٌ كلُّه حقولٌ حرّة لا
    // يمرّ بتعديل الفرصة أصلاً كي لا يُكتب تعديلٌ فارغ ولا يُسجَّل أثرٌ بلا حقل.
    const out = fieldKeys.length ? await updateOpportunity(ctx, p.oppId, p.fields) : null;
    const custom = customFields.length ? await applyOpportunityFields(ctx, p.oppId, customFields) : null;
    await audit(ctx, {
      action: 'update', resource: 'opportunity', resourceId: p.oppId, sectorId: row.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_update_opportunity', preview: token, confirmed_by: user.id, fields: fieldKeys, custom_fields: custom ? { set: custom.set, removed: custom.removed } : undefined },
    });
    const stages = await stagesMap();
    // `updateOpportunity` يردّ إيجازاً بدل الصفّ حين تخرج الفرصة عن نطاق مُعدِّلها — وهو لا
    // يقع من هنا لأن حقول الإسناد مغلقة، لكن القراءة تُؤخذ من القاعدة على كل حال فلا يتعلّق
    // المخرَج بشكل ردٍّ قد يتغيّر.
    const after = await get('SELECT o.*, c.name_ar client_name, u.name_ar owner_name FROM opportunity o'
      + ' LEFT JOIN client c ON c.id = o.client_id LEFT JOIN app_user u ON u.id = o.owner_user_id WHERE o.id = ?', [p.oppId]);
    return envelope('sanad_update_opportunity', {
      scope_ar: scopeArOf(user), units: CRM_UNITS,
      applied: true, summary: p.summary,
      changed_fields_ar: fieldKeys.length + customFields.length,
      opportunity: { ...oppOut(after || out, stages, riyadhDate()), custom_fields: customFieldsOut(await listOpportunityFields(p.oppId)) },
      refs: uniqRefs([REF.opportunity(p.oppId), REF.opportunities()]),
    });
  });
}

// ── السجل ───────────────────────────────────────────────────────────────────────────────
const readsOpps = (u) => !!u && (u.role_id === 'admin' || can(u, 'read', 'opportunity'));
const createsOpps = (u) => !!u && (u.role_id === 'admin' || can(u, 'create', 'opportunity')
  || (u.departmentGrants || []).some((g) => g.resource === 'opportunity' && g.action === 'create'));
const updatesOpps = (u) => !!u && (u.role_id === 'admin' || can(u, 'update', 'opportunity'));

export const CRM_TOOLS = Object.freeze([
  {
    name: 'sanad_list_opportunities', label_ar: 'لوحة الفرص', kind: 'read',
    description_ar: 'فرص نطاق الحساب بلوحة مراحلها: لكل مرحلة عددها وقيمتها الإجمالية والمرجّحة، ولكل فرصة المرحلة والقيمة والقيمة المرجّحة واحتمال الفوز والمالك والعميل والخطوة التالية والأيام في المرحلة وتاريخ الإغلاق المتوقع. ترقيم كامل بعدّاد كلي. مرشّحات: المرحلة، المالك، العميل، الإدارة، المتوقفة (تجاوزت عتبة ركود مرحلتها)، وبلا خطوة تالية. الافتراضي: المفتوحة وحدها.',
    input: obj({
      stage: S.str('المرحلة — بمعرّفها', { maxLength: 40 }),
      ownerUserId: S.str('حصر بمالك بعينه', { maxLength: 80 }),
      clientId: S.str('حصر بعميل بعينه', { maxLength: 80 }),
      sector: S.str('القطاع — يضيّق داخل نطاقك فقط', { maxLength: 60 }),
      department: S.str('الإدارة — تضيّق داخل نطاقك فقط', { maxLength: 60 }),
      stalled: S.bool('المتوقفة وحدها — تجاوزت عتبة الركود لمرحلتها'),
      noNextAction: S.bool('بلا خطوة تالية وحدها'),
      openOnly: S.bool('المفتوحة وحدها (الافتراضي: نعم) — اجعلها false لإدراج المكسوبة والمفقودة'),
      ...PAGE_PROPS,
    }),
    output_ar: 'لوحة مراحل بمجاميعها + قائمة مرقَّمة بالكامل (`partial` تعلن الصفحة والعدد الكلي)؛ القيمة المرجّحة = الإجمالية × احتمال الفوز ولا تُجمع معها',
    allow: readsOpps, run: runListOpportunities,
  },
  {
    name: 'sanad_get_opportunity', label_ar: 'تفاصيل فرصة', kind: 'read',
    description_ar: 'فرصة واحدة كاملة: العميل والإدارة والمرحلة، واحتمال الفوز **ومصدره** (افتراضي المرحلة أم تعديل يدوي عليها)، والقيمة والقيمة المرجّحة، وحقول المنافسة (رقمها وموعد تقديم العرض وتاريخه ومدة التنفيذ وشركاء التحالف)، ونوع الارتباط ونوع الطرح وموقع التسليم والرمز، والحقول الإضافية الخاصة بها، والفريق العامل عليها، والخطوة التالية بمسؤولها وموعدها، وسجل انتقال مراحلها بمن حرّكها وسببه، وسجل التواصل، والمهام المرتبطة بها.',
    input: obj({ opportunityId: S.str('معرّف الفرصة', { maxLength: 80 }) }, ['opportunityId']),
    output_ar: 'فرصة واحدة بسجلّيها (المراحل والتواصل) ومهامها؛ الحقل بلا قيمة يقول «غير مُسجَّل»',
    allow: readsOpps, run: runGetOpportunity,
  },
  {
    name: 'sanad_preview_opportunity_create', label_ar: 'معاينة تسجيل فرصة', kind: 'preview',
    description_ar: 'يعاين فرصة قبل تسجيلها: يتحقق من العميل (معرّفاً مسجَّلاً أو اسماً يُطابَق على الجهات القائمة فإن لم يوجد سُجِّل جهةً جديدة) ومن القيمة، ويعلن **احتمال الفوز الافتراضي للمرحلة المختارة** والقيمة المرجّحة الناتجة عنه. ويقبل ما تسأله المنافسة: رقمها وموعد تقديم العرض وتاريخه ومدة التنفيذ وشركاء التحالف، ونوع الارتباط والطرح وموقع التسليم، والإدارة المسؤولة بمعرّفها، وحقولاً إضافية خاصة بها — كلُّ حقلٍ صفٌّ في المعاينة. القيمة تُقرأ شاملةً الضريبة ما لم يُقَل غير ذلك. يعطي رمزاً صالحاً ١٥ دقيقة لمرة واحدة. لا يكتب شيئاً.',
    input: obj({
      title: S.str('عنوان الفرصة', { maxLength: 200, minLength: 2 }),
      clientId: S.str('معرّف عميل مسجَّل', { maxLength: 80 }),
      clientName: S.str('اسم العميل إن لم يكن مسجَّلاً — يُطابَق أولاً على الجهات القائمة', { maxLength: 200 }),
      valueSar: S.num('قيمة الفرصة بالريال', 0),
      stage: S.str('المرحلة — الافتراضي: الترشيح', { maxLength: 40 }),
      departmentId: S.str('معرّف الإدارة المسؤولة داخل قطاعك — يُقبل عند الإنشاء وحده؛ نقلُها لاحقاً من صفحة الفرصة', { maxLength: 80 }),
      ...TENDER_INPUT,
    }, ['title', 'valueSar']),
    output_ar: 'الفرصة كما ستُسجَّل (بحقول المنافسة والإدارة والحقول الإضافية) + احتمال الفوز الافتراضي للمرحلة + القيمة المرجّحة + رمز المعاينة',
    allow: createsOpps, run: runPreviewOppCreate,
  },
  {
    name: 'sanad_create_opportunity', label_ar: 'تأكيد تسجيل فرصة', kind: 'write',
    description_ar: 'يسجّل الفرصة المعاينة برمزها وحده — لا يقبل بيانات فرصة مباشرة. يمرّ ببوابات الشاشة: نطاق الإنشاء، وشرط أن تُنسب الفرصة إلى قطاع تسليم لا وحدة مساندة، ومطابقة اسم الجهة على الجهات القائمة قبل إنشاء جهة جديدة.',
    input: TOKEN_INPUT,
    output_ar: 'الفرصة كما سُجِّلت برابطها',
    allow: createsOpps, run: runCreateOpportunity,
  },
  {
    name: 'sanad_preview_opportunity_update', label_ar: 'معاينة تعديل فرصة', kind: 'preview',
    description_ar: 'يعاين تعديل حقول فرصة قائمة ويعرض قبل/بعد لكل حقل يتغيّر فعلاً: العنوان، القيمة، الجهة، سنة الفرصة، الأولوية، الخطوة التالية، الملاحظات، احتمال الفوز، وحقول المنافسة (رقمها وموعد تقديم العرض وتاريخه ومدة التنفيذ وشركاء التحالف)، ونوع الارتباط والطرح وموقع التسليم، والحقول الإضافية الخاصة بها (اسم وقيمة؛ القيمة الفارغة تحذف الحقل). والمسح الصريح لحقلٍ عبر clearFields. وما يتبع غيرَه يُعرض معه — القيمة المرجّحة تظهر صفاً مستقلاً كلما تحرّك أحد طرفيها. **لا يمسّ القطاع ولا الإدارة ولا المسؤول ولا المرحلة**: إعادة الإسناد من صفحة الفرصة، وتحريك المرحلة له معاينته. طلبٌ لا يغيّر شيئاً يُردّ. يعطي رمزاً صالحاً ١٥ دقيقة لمرة واحدة ولا يكتب شيئاً.',
    input: obj({
      opportunityId: S.str('معرّف الفرصة', { maxLength: 80 }),
      title: S.str('العنوان الجديد', { maxLength: 200, minLength: 2 }),
      valueSar: S.num('القيمة الجديدة بالريال', 0),
      clientId: S.str('معرّف جهة مسجَّلة', { maxLength: 80 }),
      clientName: S.str('اسم الجهة إن لم تكن مسجَّلة — يُطابَق أولاً على الجهات القائمة', { maxLength: 200 }),
      year: S.int('سنة الفرصة — بها تُحتسب في مبيعات عامها', 2000, 2100),
      priority: S.en('الأولوية', OPP_PRIORITIES),
      nextAction: S.str('الخطوة التالية', { maxLength: 300 }),
      notes: S.str('الملاحظات', { maxLength: 1000 }),
      winPct: S.int('احتمال الفوز يدوياً (٠–١٠٠) — يزول عند أول تحريك للمرحلة', 0, 100),
      ...TENDER_INPUT,
      clearFields: S.arr('حقول تُمسح صراحةً فتصير «لم يُحدَّد»', S.en('الحقل', TENDER_KEYS), 8),
    }, ['opportunityId']),
    output_ar: 'قائمة التغييرات قبل/بعد بالعربية (بحقول المنافسة والحقول الإضافية) + ما لا تمسّه الأداة مكتوباً + رمز المعاينة؛ لا كتابة قبل التأكيد',
    allow: updatesOpps, run: runPreviewOppUpdate,
  },
  {
    name: 'sanad_update_opportunity', label_ar: 'تأكيد تعديل فرصة', kind: 'write',
    description_ar: 'يطبّق التعديل المعاين برمزه وحده — لا يقبل حقولاً مباشرة. يعيد قراءة الفرصة ويقارن بصمتها قبل الكتابة: تحرّكت بعد المعاينة ⟵ يُردّ الرمز ويُطلب معاينة جديدة. ويمرّ ببوابات الشاشة نفسها، ومنها حجزُ حقول النسبة عمّن وصل بالشراكة.',
    input: TOKEN_INPUT,
    output_ar: 'الفرصة بعد التعديل + عدد الحقول التي تغيّرت',
    allow: updatesOpps, run: runUpdateOpportunity,
  },
  {
    name: 'sanad_preview_stage_change', label_ar: 'معاينة تحريك مرحلة', kind: 'preview',
    description_ar: 'يعاين نقل فرصة إلى مرحلة أخرى بقبل/بعد صريح لثلاثة أرقام تتغيّر معاً: المرحلة، واحتمال الفوز (يُعاد ضبطه على افتراضي المرحلة الجديدة فيزول أي تعديل يدوي سابق)، والقيمة المرجّحة التابعة له. ويقول إن كان الفوز سيولّد مشروعاً. الإغلاق «مفقودة» والتراجع عن الفوز يلزمهما سبب مكتوب. يعطي رمزاً صالحاً ١٥ دقيقة لمرة واحدة ولا يكتب شيئاً.',
    input: obj({
      opportunityId: S.str('معرّف الفرصة', { maxLength: 80 }),
      toStage: S.str('المرحلة الجديدة — بمعرّفها', { maxLength: 40 }),
      note: S.str('السبب أو الملاحظة — مطلوب عند الفقدان أو التراجع عن الفوز', { maxLength: 500 }),
    }, ['opportunityId', 'toStage']),
    output_ar: 'ثلاثة صفوف قبل/بعد (المرحلة · احتمال الفوز · القيمة المرجّحة) + رمز المعاينة',
    allow: updatesOpps, run: runPreviewStageChange,
  },
  {
    name: 'sanad_move_opportunity_stage', label_ar: 'تأكيد تحريك مرحلة', kind: 'write',
    description_ar: 'ينقل الفرصة إلى المرحلة المعاينة برمزها وحده — لا يقبل مرحلة مباشرة. يعيد قراءة الفرصة ويقارن بصمتها قبل الكتابة: تحرّكت بعد المعاينة ⟵ يُردّ الرمز ويُطلب معاينة جديدة. والفوز يولّد مشروعه في المعاملة نفسها.',
    input: TOKEN_INPUT,
    output_ar: 'الفرصة بعد النقل + المشروع المولَّد إن كان فوزاً',
    allow: updatesOpps, run: runMoveStage,
  },
]);
