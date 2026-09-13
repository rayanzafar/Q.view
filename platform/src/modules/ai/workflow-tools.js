// ── أدوات المساعد على الاعتمادات والعملاء ────────────────────────────────────────────────────
//
// الاعتمادات: صندوقٌ واحد يجمع ما ينتظر قرار صاحب الحساب — الموجَّه بدوره والموجَّه بعينه —
// من `pendingApprovalsFor`/`decorateApprovals` نفسهما اللذين تقرأ منهما الشاشة والبريد وبطاقة
// «صفحتي». فلا طابور ثانٍ يفترق عن الأول.
//
// وثلاث قواعد يفرضها هذا المحور بحكم أنه قرار:
//   ① **فصل المهام**: من رفع الطلب لا يعتمده ولو حمل دور المعتمِد — والخدمة تحرسه، والأداة
//      لا تعرض له طلبه أصلاً.
//   ② **الرفض بلا سبب مكتوب مرفوض**: قرارٌ يُعيد العمل إلى صاحبه بلا كلمةٍ تقول لماذا يُعاد
//      إلى الطاولة نفسها بعد يوم. الشرط هنا في الأداة لأن الخدمة تقبل التعليق ولا تفرضه.
//   ③ **المعاينة تقول ما سيتغيّر فعلاً** لا «ستتغيّر الحالة»: اعتمادُ مهمةٍ يُضيفها إلى قائمة
//      صاحبها، واعتمادُ تسكينٍ يشغل طاقة مورد. الفرق بين الجملتين هو الفرق بين قرارٍ وضغطة زر.
import { tx, get, all } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest, notFound } from '../../core/http/errors.js';
import { can } from '../../core/rbac/index.js';
import { savePreview, claimPreview, PREVIEW_TTL_MINUTES } from '../../core/ai/store.js';
import { riyadhDate } from '../../core/i18n/time.js';
import { pendingApprovalsFor, decorateApprovals, DIRECT_KIND_AR } from '../workflow/inbox.js';
import { actOnApproval } from '../workflow/engine.js';
import { clientOverview, logActivity, relationshipOf, ACTIVITY_KINDS } from '../clients/clients.js';
import {
  envelope, inputOf, text, enumOf, pageOf, partialOf, uniqRefs,
  tokenOnly, claimGuard, textOrNot, numOrNot, notMeasured, measured,
  S, obj, PAGE_PROPS, TOKEN_INPUT, REF, TEXT_IS_DATA_AR, UNIT_NOTES,
} from './tool-kit.js';

const SAR = (h) => (h == null ? null : Math.round(Number(h)) / 100);
const daysSince = (iso) => {
  if (!iso) return null;
  const d = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d) / 86400000));
};

// ما الذي يتغيّر فعلاً عند الاعتماد — بلسان العمل لا بلسان الحالة.
const EFFECT_AR = Object.freeze({
  task: 'تُضاف المهمة إلى قائمة صاحبها فتصير عملاً معتمَداً يُعدّ في حِمله وفي لوحات فريقه — قبل الاعتماد لا يراها إلا كاتبها.',
  membership: 'يُثبَّت تسكين الشخص على العمل، فتُحسب نسبته في طاقته وفي تغطية العمل.',
  allocation_request: 'يُطبَّق التغيير المقترح على التسكين المؤكد، فتتغيّر طاقة المورد المتاحة في الأشهر المشمولة.',
});

// ── sanad_list_approvals ────────────────────────────────────────────────────────────────
async function runListApprovals(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const { page, pageSize } = pageOf(input, { defSize: 25, maxSize: 100 });
  const rows = await decorateApprovals(await pendingApprovalsFor(user));
  const kind = text(input.kind, 'نوع الطلب', { max: 40 });
  const filtered = kind ? rows.filter((r) => r.resource === kind) : rows;
  const sorted = [...filtered].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const total = sorted.length;
  const slice = sorted.slice((page - 1) * pageSize, page * pageSize);
  return envelope('sanad_list_approvals', {
    scope_ar: 'نطاق القراءة: ما ينتظر قرارك أنت — بدورك وبعينك معاً. وما رفعتَه بنفسك خارج الطابور (لا تعتمد طلبك).',
    units: { days_ar: UNIT_NOTES.days_ar, money_ar: 'لا قيم مالية في هذه القائمة' },
    approvals: slice.map((a) => ({
      id: a.id,
      kind: a.resource, kind_ar: a.kindLabel || DIRECT_KIND_AR[a.resource] || 'طلب اعتماد',
      on_record: { kind: a.resource, id: a.resource_id, label: a.label || null, parent: a.parent || null },
      requested_by: { id: a.requested_by, name: a.requesterName || null },
      requested_at: a.created_at,
      age_days: numOrNot(daysSince(a.created_at), 'أيام منذ رفع الطلب', 'تاريخ الرفع غير مُسجَّل'),
      context_ar: a.sizeLabel || null,
      addressed_ar: a.isDirect ? 'موجَّه إليك بعينك' : `موجَّه إلى دورك (${a.workflow_name || 'مسار اعتماد'})`,
    })),
    partial: partialOf({ page, pageSize, total, returned: slice.length }),
    basis_ar: 'الطابور الواحد الذي تقرأ منه شاشة الاعتمادات والبريد وبطاقة «صفحتي» — لا قائمة ثانية.',
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.approvals()]),
  });
}

// ── دورة القرار ─────────────────────────────────────────────────────────────────────────
async function runPreviewApprovalDecision(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const requestId = text(input.approvalId, 'معرّف طلب الاعتماد', { required: true, max: 80 });
  const decision = enumOf(input.decision, 'القرار', ['approve', 'reject'], { required: true });
  const comment = text(input.comment, 'السبب أو الملاحظة', { max: 500 });
  // الرفض قرارٌ يُعيد عملاً إلى صاحبه — بلا سببٍ مكتوب يعود إليك بعد يومٍ كما هو.
  if (decision === 'reject' && !comment) {
    throw badRequest('الرفض يلزمه سبب مكتوب — اكتب ما ينقص الطلب ليعرف صاحبه ماذا يصحّح قبل إعادته.');
  }
  // الطابور نفسه هو الحارس: ما ليس فيه ليس لك — ومنه ما رفعتَه بنفسك.
  const mine = await decorateApprovals(await pendingApprovalsFor(user));
  const row = mine.find((a) => a.id === requestId);
  if (!row) {
    const exists = await get('SELECT id, status, requested_by FROM approval_request WHERE id = ?', [requestId]);
    if (!exists) throw notFound('طلب الاعتماد غير موجود');
    if (exists.status !== 'PENDING') throw badRequest('هذا الطلب مُغلق — حُسم قبل الآن، ولا يُعاد فتحه من هنا.');
    if (exists.requested_by === user.id) throw badRequest('لا تعتمد طلباً رفعتَه بنفسك — أحِله إلى معتمِد آخر.');
    throw notFound('هذا الطلب لا ينتظر قرارك — يملكه المعتمِد الموجَّه إليه أو صاحب الدور المسؤول عنه.');
  }
  const effect = decision === 'approve'
    ? (EFFECT_AR[row.resource] || 'يُعتمد الطلب فيسري أثره على السجل المرتبط به.')
    : 'يعود الطلب إلى صاحبه مرفوضاً بسببه المكتوب، ولا يسري أي أثر على السجل المرتبط.';
  const summary = `${decision === 'approve' ? 'اعتماد' : 'رفض'} «${row.kindLabel || 'طلب اعتماد'}» على «${row.label || row.resource_id}» المرفوع من ${row.requesterName || 'غير معروف'}${comment ? ` — ${comment}` : ''}.`;
  const { token, expiresAt } = await savePreview(user, {
    type: 'approval_decision', summary, requestId, decision, comment: comment || null,
    subject_ar: `طلب اعتماد: ${row.kindLabel || 'طلب'} على «${row.label || row.resource_id}»`,
    display: [
      { field_ar: 'الطلب', after_ar: `${row.kindLabel || 'طلب اعتماد'} على «${row.label || row.resource_id}»` },
      { field_ar: 'رفعه', after_ar: row.requesterName || 'غير معروف' },
      { field_ar: 'قرارك', before_ar: 'بانتظار قرارك', after_ar: decision === 'approve' ? 'اعتماد' : 'رفض' },
      { field_ar: 'أثر القرار', after_ar: effect },
      ...(comment ? [{ field_ar: 'تعليقك', after_ar: comment }] : []),
    ],
    // حالة الطلب جزءٌ من المعاينة: حُسم بعدها ⟵ الرمز يبطل بجملةٍ تقول ذلك.
    status: row.status,
  }, { intent: 'sanad_preview_approval_decision', sectorId: row.sector_id || user.sector_id || null });
  return envelope('sanad_preview_approval_decision', {
    scope_ar: 'نطاق القرار: ما ينتظرك أنت وحدك', units: { days_ar: UNIT_NOTES.days_ar, money_ar: 'لا قيم مالية' },
    approval: {
      id: row.id, kind_ar: row.kindLabel || 'طلب اعتماد',
      on_record: { kind: row.resource, id: row.resource_id, label: row.label || null, parent: row.parent || null },
      requested_by: row.requesterName || null, age_days: numOrNot(daysSince(row.created_at), 'أيام منذ الرفع'),
      context_ar: row.sizeLabel || null,
    },
    decision, decision_ar: decision === 'approve' ? 'اعتماد' : 'رفض',
    what_changes_ar: effect,
    comment: textOrNot(comment, 'بلا سبب مكتوب — مقبول في الاعتماد، مرفوض في الرفض'),
    summary,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يُحسم شيء بعد. الرمز صالح ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، ويبطل إن حُسم الطلب قبل تأكيده.`,
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.approvals()]),
  });
}

async function runDecideApproval(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_approval_decision');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'approval_decision');
    const row = await get('SELECT id, status, sector_id FROM approval_request WHERE id = ?', [p.requestId]);
    if (!row) throw notFound('طلب الاعتماد لم يعد موجوداً.');
    if (row.status !== 'PENDING') {
      throw badRequest('حُسم هذا الطلب بعد المعاينة — لا يُحسم مرتين. افتح الطابور لترى حاله الآن.');
    }
    const out = await actOnApproval(ctx, p.requestId, p.decision, p.comment);
    await audit(ctx, {
      action: p.decision === 'approve' ? 'approve' : 'reject', resource: 'approval_request', resourceId: p.requestId,
      sectorId: row.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_decide_approval', preview: token, confirmed_by: user.id, decision: p.decision },
    });
    return envelope('sanad_decide_approval', {
      scope_ar: 'نطاق القرار: ما ينتظرك أنت وحدك', units: { money_ar: 'لا قيم مالية' },
      applied: true, decision: p.decision, decision_ar: p.decision === 'approve' ? 'اعتُمد' : 'رُفض',
      summary: p.summary, result: out || null,
      refs: uniqRefs([REF.approvals()]),
    });
  });
}

// ── sanad_get_client ────────────────────────────────────────────────────────────────────
async function runGetClient(ctx, raw) {
  const user = ctx.user;
  const clientId = text(inputOf(raw).clientId, 'معرّف العميل', { required: true, max: 80 });
  const seesMoney = can(user, 'read', 'invoice');
  const d = await clientOverview(user, clientId);
  const last = d.kpis?.last_activity_at || null;
  return envelope('sanad_get_client', {
    scope_ar: 'نطاق القراءة: الجهات التي يصلها حسابك عبر فرصها ومشاريعها وعقودها',
    units: seesMoney
      ? { money_sar_ar: 'المبالغ بالريال السعودي، وكلٌّ بأساسه ولا تُجمع أرقام مختلفة الأساس', days_ar: UNIT_NOTES.days_ar }
      : { money_ar: 'لا قيم مالية — بوابة قراءة الفواتير غير مفتوحة لهذا الحساب', days_ar: UNIT_NOTES.days_ar },
    client: { id: d.client.id, name: d.client.name_ar, kind: d.client.kind || null, active: d.client.active !== 0 },
    relationship: {
      state_ar: d.kpis?.relationship || relationshipOf(last, (d.opportunities?.open || []).length),
      last_contact_at: last,
      days_since_last_contact: numOrNot(daysSince(last), 'أيام منذ آخر تواصل مسجَّل', 'لا تواصل مسجَّل مع هذه الجهة بعد'),
      basis_ar: '«نشطة» = فرصة مفتوحة أو تواصل خلال ٣٠ يوماً · «فاترة» = آخر تواصل خلال ١٢٠ يوماً · «خاملة» = ما دون ذلك.',
    },
    open_opportunities: (d.opportunities?.open || []).map((o) => ({
      id: o.id, title: o.title_ar, stage_ar: o.stage_name_ar || o.stage_id,
      value_sar: numOrNot(SAR(o.value_halalas), 'ريال سعودي', 'قيمة الفرصة غير مُسجَّلة'),
      win_pct: numOrNot(o.win_pct, 'نسبة مئوية', 'احتمال الفوز غير مُسجَّل'),
      next_action: textOrNot(o.next_action, 'بلا خطوة تالية مكتوبة'),
    })),
    open_projects: (d.projects || []).filter((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED')
      .map((p) => ({ id: p.id, name: p.name_ar, status: p.status, progress_pct: numOrNot(p.progress_pct, 'نسبة إنجاز') })),
    contacts: (d.contacts || []).map((c) => ({ id: c.id, name: c.name, title: c.title || null, email: c.email || null, phone: c.phone || null })),
    our_sectors: (d.by_sector || []).map((s) => ({ sector: s.sector_id || s.id || null, name: s.name_ar || s.sector_name || null, count: s.n ?? s.count ?? null })),
    recent_contacts: (d.activities || []).slice(0, 10).map((a) => ({ id: a.id, at: a.at, kind: a.kind, title: a.title, by: a.actor || null })),
    money: seesMoney
      ? {
        open_receivables_sar: numOrNot(SAR(d.kpis?.open_ar_halalas), 'ريال سعودي — مستحقٌّ لم يُحصَّل', 'لا مستحقات مسجَّلة'),
        note_ar: 'رقمٌ واحد بأساسه — لا يُجمع مع قيم الفرص ولا مع الإيراد.',
      }
      : { note_ar: 'الأرقام المالية للجهة خلف بوابة قراءة الفواتير — غير مفتوحة لهذا الحساب.' },
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.client(clientId), REF.clients()]),
  });
}

// ── دورة تسجيل التواصل ──────────────────────────────────────────────────────────────────
const KIND_AR = Object.freeze({
  call: 'اتصال', meeting: 'اجتماع', email: 'بريد', visit: 'زيارة',
  note: 'ملاحظة', proposal: 'عرض', update: 'تحديث', other: 'أخرى',
});

async function runPreviewContactLog(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const clientId = text(input.clientId, 'معرّف العميل', { max: 80 });
  const opportunityId = text(input.opportunityId, 'معرّف الفرصة', { max: 80 });
  const projectId = text(input.projectId, 'معرّف المشروع', { max: 80 });
  if (!clientId && !opportunityId && !projectId) throw badRequest('اربط التواصل بجهة أو فرصة أو مشروع — سطرٌ بلا مرجع لا يُقرأ لاحقاً.');
  const kind = enumOf(input.kind, 'نوع التواصل', ACTIVITY_KINDS, { required: true });
  const title = text(input.title, 'سطر التواصل', { required: true, max: 200, min: 3 });
  const detail = text(input.detail, 'التفصيل', { max: 1000 });
  const client = clientId ? await get('SELECT id, name_ar FROM client WHERE id = ? AND deleted_at IS NULL', [clientId]) : null;
  if (clientId && !client) throw notFound('الجهة غير موجودة');
  const summary = `تسجيل ${KIND_AR[kind]}: «${title}»${client ? ` مع «${client.name_ar}»` : ''}.`;
  const { token, expiresAt } = await savePreview(user, {
    type: 'contact_log', summary, fields: { client_id: clientId || null, opportunity_id: opportunityId || null, project_id: projectId || null, kind, title, detail: detail || null },
    subject_ar: client ? `الجهة «${client.name_ar}»` : 'سجل التواصل',
    display: [
      { field_ar: 'نوع التواصل', after_ar: KIND_AR[kind] },
      { field_ar: 'السطر المسجَّل', after_ar: title },
      { field_ar: 'مرتبط بـ', after_ar: client ? `جهة «${client.name_ar}»` : opportunityId ? 'فرصة' : 'مشروع' },
      ...(detail ? [{ field_ar: 'التفصيل', after_ar: detail }] : []),
    ],
  }, { intent: 'sanad_preview_contact_log', sectorId: user.sector_id || null });
  return envelope('sanad_preview_contact_log', {
    scope_ar: 'نطاق الكتابة: جهةٌ أو فرصةٌ أو مشروعٌ يفتحه حسابك',
    units: { money_ar: 'لا قيم مالية' },
    will_be: {
      kind, kind_ar: KIND_AR[kind], title, detail: textOrNot(detail, 'بلا تفصيل'),
      linked_ar: client ? `الجهة «${client.name_ar}»` : (opportunityId ? `الفرصة ${opportunityId}` : `المشروع ${projectId}`),
      // التاريخ لحظةُ التسجيل: المنصة لا تقبل تأريخاً رجعياً على سطر التواصل، فيُقال ذلك بدل
      // أن يُوعد المستخدم بتاريخٍ يختاره ثم يُكتب غيره.
      at_ar: 'يُسجَّل بلحظة التأكيد — لا يقبل تأريخاً رجعياً في هذه النسخة',
      by_ar: user.name_ar || user.username || 'أنت',
    },
    summary,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يُسجَّل شيء بعد. الرمز صالح ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة.`,
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([clientId ? REF.client(clientId) : null, opportunityId ? REF.opportunity(opportunityId) : null, projectId ? REF.project(projectId) : null]),
  });
}

async function runLogContact(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_contact_log');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'contact_log');
    const row = await logActivity(ctx, p.fields);
    await audit(ctx, {
      action: 'create', resource: 'activity', resourceId: row.id, sectorId: row.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_log_contact', preview: token, confirmed_by: user.id, kind: row.kind },
    });
    return envelope('sanad_log_contact', {
      scope_ar: 'نطاق الكتابة: جهةٌ أو فرصةٌ أو مشروعٌ يفتحه حسابك', units: { money_ar: 'لا قيم مالية' },
      applied: true, summary: p.summary,
      activity: { id: row.id, at: row.at, kind: row.kind, kind_ar: KIND_AR[row.kind] || row.kind, title: row.title },
      refs: uniqRefs([row.client_id ? REF.client(row.client_id) : null, row.opportunity_id ? REF.opportunity(row.opportunity_id) : null]),
    });
  });
}

// ── السجل ───────────────────────────────────────────────────────────────────────────────
const anyUser = (u) => !!u?.id;
const readsClients = (u) => !!u && (u.role_id === 'admin' || can(u, 'read', 'client'));
const logsContact = (u) => !!u && (u.role_id === 'admin' || can(u, 'read', 'client') || can(u, 'read', 'opportunity') || can(u, 'read', 'project'));

export const WORKFLOW_TOOLS = Object.freeze([
  {
    name: 'sanad_list_approvals', label_ar: 'ما ينتظر قرارك', kind: 'read',
    description_ar: 'الطلبات التي تنتظر قرار صاحب الحساب — الموجَّهة إلى دوره والموجَّهة إليه بعينه في طابورٍ واحد: نوع الطلب، ومن رفعه، وعلى أي سجل (باسمه المقروء لا بمعرّفه وحده)، **وعمر الطلب بالأيام**، وسياقه (مثل نسبة إشغال المهمة المرفوعة). وما رفعه الحساب بنفسه خارج الطابور — لا يعتمد المرء طلبه.',
    input: obj({ kind: S.str('نوع الطلب — حصرٌ اختياري (مثل task أو allocation_request)', { maxLength: 40 }), ...PAGE_PROPS }),
    output_ar: 'قائمة مرقَّمة بالكامل مرتَّبة بالأقدم أولاً؛ عمر الطلب بالأيام التقويمية',
    allow: anyUser, run: runListApprovals,
  },
  {
    name: 'sanad_preview_approval_decision', label_ar: 'معاينة قرار اعتماد', kind: 'preview',
    description_ar: 'يعاين قراراً على طلب اعتماد ويقول **ما الذي سيتغيّر فعلياً** — لا «ستتغيّر الحالة»: اعتمادُ مهمةٍ يُضيفها إلى قائمة صاحبها فتُعدّ في حِمله، واعتمادُ طلب تسكينٍ يشغل طاقة مورد في أشهرٍ بعينها. الرفض بلا سبب مكتوب يُردّ. يعطي رمزاً صالحاً ١٥ دقيقة لمرة واحدة ولا يحسم شيئاً.',
    input: obj({
      approvalId: S.str('معرّف طلب الاعتماد', { maxLength: 80 }),
      decision: S.en('القرار', ['approve', 'reject']),
      comment: S.str('السبب أو الملاحظة — مطلوب عند الرفض', { maxLength: 500 }),
    }, ['approvalId', 'decision']),
    output_ar: 'الطلب بسياقه + أثر القرار بالعربية + رمز المعاينة',
    allow: anyUser, run: runPreviewApprovalDecision,
  },
  {
    name: 'sanad_decide_approval', label_ar: 'تأكيد قرار اعتماد', kind: 'write',
    description_ar: 'يحسم الطلب المعاين برمزه وحده — لا يقبل قراراً مباشراً. يعيد قراءة حال الطلب قبل الحسم: حُسم بعد المعاينة ⟵ يُردّ الرمز بجملة تقول ذلك، فلا يُحسم طلبٌ مرتين. وفصل المهام محفوظ: من رفع الطلب لا يحسمه.',
    input: TOKEN_INPUT,
    output_ar: 'نتيجة القرار وأثره',
    allow: anyUser, run: runDecideApproval,
  },
  {
    name: 'sanad_get_client', label_ar: 'ملف جهة', kind: 'read',
    description_ar: 'ملف جهة: آخر تواصل وعدد الأيام منذه، وحالة العلاقة (نشطة · فاترة · خاملة) بقاعدتها المكتوبة، والفرص المفتوحة والمشاريع القائمة، وجهات الاتصال، و«قطاعاتنا العاملة مع هذه الجهة»، وآخر عشرة تواصلات. المستحق غير المحصَّل يُعرض لمن يفتح بوابة قراءة الفواتير وحده.',
    input: obj({ clientId: S.str('معرّف الجهة', { maxLength: 80 }) }, ['clientId']),
    output_ar: 'ملف واحد؛ «لا تواصل مسجَّل» تُقال صراحةً ولا تُحوَّل إلى صفر أيام',
    allow: readsClients, run: runGetClient,
  },
  {
    name: 'sanad_preview_contact_log', label_ar: 'معاينة تسجيل تواصل', kind: 'preview',
    description_ar: 'يعاين سطر تواصل قبل تسجيله: نوعه (اتصال · اجتماع · بريد · زيارة · ملاحظة · عرض · تحديث · أخرى) وسطره وتفصيله ومرجعه (جهة أو فرصة أو مشروع). يُسجَّل بلحظة التأكيد ولا يقبل تأريخاً رجعياً في هذه النسخة. يعطي رمزاً صالحاً ١٥ دقيقة لمرة واحدة.',
    input: obj({
      clientId: S.str('معرّف الجهة', { maxLength: 80 }),
      opportunityId: S.str('معرّف الفرصة (بديل عن الجهة)', { maxLength: 80 }),
      projectId: S.str('معرّف المشروع (بديل عن الجهة)', { maxLength: 80 }),
      kind: S.en('نوع التواصل', ACTIVITY_KINDS),
      title: S.str('سطر التواصل — ماذا جرى', { maxLength: 200, minLength: 3 }),
      detail: S.str('تفصيل اختياري', { maxLength: 1000 }),
    }, ['kind', 'title']),
    output_ar: 'ما سيُسجَّل + رمز المعاينة؛ لا كتابة قبل التأكيد',
    allow: logsContact, run: runPreviewContactLog,
  },
  {
    name: 'sanad_log_contact', label_ar: 'تأكيد تسجيل تواصل', kind: 'write',
    description_ar: 'يسجّل سطر التواصل المعاين برمزه وحده — لا يقبل بيانات مباشرة. يمرّ ببوابة الخدمة: تسجيل التواصل يتطلب قراءة السجل المرتبط به.',
    input: TOKEN_INPUT,
    output_ar: 'السطر كما سُجِّل بلحظته ونوعه',
    allow: logsContact, run: runLogContact,
  },
]);
