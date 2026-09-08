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
import { listOpportunities, opportunityDetail, createOpportunity, moveStage, stageAgeDays } from '../crm/opportunities.js';
import { approvedTaskSql } from '../pmo/task-approval.js';
import {
  envelope, inputOf, text, moneyOf, enumOf, boolOf, pageOf, partialOf, uniqRefs,
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
  const rows = await all('SELECT id, name_ar, default_win_pct, sort_order, is_won, is_lost FROM stage ORDER BY sort_order');
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
  };
}

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
  const willBe = {
    title,
    client_ar: client ? `جهة مسجَّلة: ${client.name_ar}` : `اسم مكتوب: «${clientName}» — يُطابَق على الجهات القائمة، فإن لم يوجد سُجِّل جهةً جديدة`,
    stage: stageId, stage_ar: st.name_ar,
    value_sar: measured(valueSar, 'ريال سعودي'),
    win_pct: numOrNot(win, 'نسبة مئوية — افتراضي هذه المرحلة', 'المرحلة بلا احتمال افتراضي'),
    weighted_sar: win == null ? notMeasured('لا قيمة مرجّحة بلا احتمال') : measured(Math.round(valueSar * win) / 100, 'ريال سعودي'),
    expected_close: notMeasured('تاريخ الإغلاق المتوقع لا تسجّله المنصة على الفرصة في هذه النسخة'),
    owner_ar: 'أنت (يمكن تغييره من الشاشة)',
  };
  const summary = `تسجيل فرصة «${title}» في مرحلة «${st.name_ar}» بقيمة ${valueSar.toLocaleString('en-US')} ريال، واحتمال الفوز الافتراضي لهذه المرحلة ${win == null ? 'غير مُسجَّل' : win + '%'}.`;
  const { token, expiresAt } = await savePreview(user, {
    type: 'opportunity_create', summary,
    fields: { title_ar: title, client_id: clientId || null, client_name: clientName || null, value_sar: valueSar, stage_id: stageId, win_pct: win },
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
    });
    await audit(ctx, {
      action: 'create', resource: 'opportunity', resourceId: row.id, sectorId: row.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_create_opportunity', preview: token, confirmed_by: user.id, title: row.title_ar },
    });
    const stages = await stagesMap();
    return envelope('sanad_create_opportunity', {
      scope_ar: scopeArOf(user), units: CRM_UNITS,
      applied: true, summary: p.summary,
      opportunity: oppOut(row, stages, riyadhDate()),
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
    type: 'opportunity_stage', summary, oppId, toStage, note: note || null,
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
    description_ar: 'فرصة واحدة كاملة: العميل والإدارة والمرحلة، واحتمال الفوز **ومصدره** (افتراضي المرحلة أم تعديل يدوي عليها)، والقيمة والقيمة المرجّحة، والفريق العامل عليها، والخطوة التالية بمسؤولها وموعدها، وسجل انتقال مراحلها بمن حرّكها وسببه، وسجل التواصل، والمهام المرتبطة بها.',
    input: obj({ opportunityId: S.str('معرّف الفرصة', { maxLength: 80 }) }, ['opportunityId']),
    output_ar: 'فرصة واحدة بسجلّيها (المراحل والتواصل) ومهامها؛ الحقل بلا قيمة يقول «غير مُسجَّل»',
    allow: readsOpps, run: runGetOpportunity,
  },
  {
    name: 'sanad_preview_opportunity_create', label_ar: 'معاينة تسجيل فرصة', kind: 'preview',
    description_ar: 'يعاين فرصة قبل تسجيلها: يتحقق من العميل (معرّفاً مسجَّلاً أو اسماً يُطابَق على الجهات القائمة فإن لم يوجد سُجِّل جهةً جديدة) ومن القيمة وتاريخ الإغلاق، ويعلن **احتمال الفوز الافتراضي للمرحلة المختارة** والقيمة المرجّحة الناتجة عنه، ويعطي رمزاً صالحاً ١٥ دقيقة لمرة واحدة. لا يكتب شيئاً.',
    input: obj({
      title: S.str('عنوان الفرصة', { maxLength: 200, minLength: 2 }),
      clientId: S.str('معرّف عميل مسجَّل', { maxLength: 80 }),
      clientName: S.str('اسم العميل إن لم يكن مسجَّلاً — يُطابَق أولاً على الجهات القائمة', { maxLength: 200 }),
      valueSar: S.num('قيمة الفرصة بالريال', 0),
      stage: S.str('المرحلة — الافتراضي: الترشيح', { maxLength: 40 }),
    }, ['title', 'valueSar']),
    output_ar: 'الفرصة كما ستُسجَّل + احتمال الفوز الافتراضي للمرحلة + القيمة المرجّحة + رمز المعاينة',
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
