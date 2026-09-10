// ── أدوات المساعد على المهام — سطح «مهامي» و«مهام فريقي» نفسه، بصلاحياته نفسها ───────────────
//
// لا نظام مهامٍ موازٍ: كل قراءة تمرّ بـ`myTasks`/`teamTasks`، وكل كتابة بـ`quickAddTask`/
// `updateTask` — الخدمات التي تخدم الشاشة حرفاً بحرف. فما لا يفتحه الموظف على شاشته لا تفتحه
// الأداة، وما تفرضه الشاشة (نسبة الإشغال على مهمتك، ومهمة الاعتماد المعلَّقة، والمهمة الشخصية
// التي لا يقرؤها إلا صاحبها) مفروضٌ هنا بحكم أنها الخدمة نفسها لا نسخةٌ منها.
//
// والمرشِّحات مطابقةٌ لعدّادات الشاشة قصداً: قارئٌ يسأل المساعد «كم متأخرة عندي؟» ثم يفتح
// الشاشة يجب أن يقرأ الرقم نفسه. فمفاتيح المرشِّح تُترجم إلى مفاتيح `applyTaskFilters` نفسها،
// لا إلى شروطٍ تُكتب هنا فتفترق عنها بعد إصدارين.
import { tx, get } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest, notFound } from '../../core/http/errors.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { savePreview, claimPreview, PREVIEW_TTL_MINUTES } from '../../core/ai/store.js';
import { riyadhDate } from '../../core/i18n/time.js';
import { myTasks, teamTasks, teamTasksAccess, quickAddTask, updateTask } from '../pmo/tasks.js';
import {
  envelope, inputOf, text, dayOf, intOf, enumOf, boolOf, pageOf, partialOf, uniqRefs,
  tokenOnly, claimGuard, fingerprintOf, assertFingerprint, textOrNot, numOrNot, notMeasured,
  S, obj, PAGE_PROPS, TOKEN_INPUT, REF, TEXT_IS_DATA_AR, UNIT_NOTES,
} from './tool-kit.js';

// ── مفردات الشاشة نفسها ────────────────────────────────────────────────────────────────
const STATUS_AR = Object.freeze({
  TODO: 'بانتظار البدء', IN_PROGRESS: 'قيد التنفيذ', BLOCKED: 'متوقفة',
  IN_REVIEW: 'قيد المراجعة', DONE: 'منجزة', CANCELLED: 'ملغاة',
});
const PRIORITY_AR = Object.freeze({ P0: 'حرجة', P1: 'عالية', P2: 'متوسطة', P3: 'منخفضة' });
const STATUSES = Object.keys(STATUS_AR);
const PRIORITIES = Object.keys(PRIORITY_AR);

// مرشِّحات الأداة ⟵ مفاتيح `applyTaskFilters` عينها. الاسم عربيُّ المعنى، والترجمة هنا وحدها.
const VIEWS = Object.freeze({
  overdue: { ar: 'متأخرة عن موعدها', f: { window: 'overdue' } },
  due_today: { ar: 'مستحقة اليوم أو جارية', f: { window: 'today' } },
  blocked: { ar: 'متوقفة بسبب مكتوب', f: { flag: 'blocked' } },
  no_next_step: { ar: 'بلا خطوة تالية', f: { flag: 'nostep' } },
  no_due_date: { ar: 'بلا موعد استحقاق', f: { window: 'nodate' } },
  no_size: { ar: 'بلا نسبة إشغال', f: { flag: 'nosize' } },
  all: { ar: 'كل المهام المفتوحة', f: {} },
});
const VIEW_KEYS = Object.keys(VIEWS);

const TASK_UNITS = Object.freeze({
  task_load_ar: UNIT_NOTES.task_load_ar,
  days_ar: UNIT_NOTES.days_ar,
  money_ar: UNIT_NOTES.no_money_ar,
});

const scopeArOf = (user, who) => {
  if (who === 'team') {
    const s = teamTasksAccess(user).scope;
    return s === 'company' ? 'نطاق القراءة: مهام الشركة كلها' : s === 'department' ? 'نطاق القراءة: مهام إداراتك' : 'نطاق القراءة: مهام قطاعك';
  }
  return 'نطاق القراءة: مهامك أنت — ما أُسند إليك وما كتبته وينتظر اعتماداً';
};

// أيام التأخّر رقمٌ يُقرأ قراراً؛ وبلا موعدٍ لا تأخّر بل غياب موعد — لا صفر.
function overdueDays(dueDate, today) {
  if (!dueDate) return notMeasured('بلا موعد استحقاق — لا تأخّر يُقاس');
  const d = String(dueDate).slice(0, 10);
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
  return diff > 0 ? { recorded: true, value: diff, unit_ar: 'أيام تأخّر' } : { recorded: true, value: 0, unit_ar: 'أيام تأخّر' };
}

function taskOut(r, today) {
  return {
    id: r.id,
    title: r.title,
    status: r.status, status_ar: STATUS_AR[r.status] || r.status,
    priority: r.priority, priority_ar: PRIORITY_AR[r.priority] || r.priority,
    due_date: r.due_date ? String(r.due_date).slice(0, 10) : null,
    overdue_days: overdueDays(r.due_date, today),
    next_step: textOrNot(r.next_step, 'بلا خطوة تالية مكتوبة — وهي ما يقول للقارئ ماذا بعد'),
    blocked_reason: textOrNot(r.blocked_reason, r.status === 'BLOCKED' ? 'متوقفة بلا سبب مكتوب' : 'ليست متوقفة'),
    utilization_pct: numOrNot(r.utilization_pct, 'نسبة إشغال من طاقة صاحبها', 'بلا نسبة إشغال مسجَّلة — لا تُعدّ في المقياس'),
    progress_pct: numOrNot(r.progress_pct, 'نسبة إنجاز'),
    assignee: r.assignee_user_id ? { id: r.assignee_user_id, name: r.assignee_name || r.assignee_username || null } : null,
    linked_work: r.project_id ? { kind: 'project', id: r.project_id, name: r.project_name || null }
      : r.opportunity_id ? { kind: 'opportunity', id: r.opportunity_id, name: r.opportunity_name || null }
        : { kind: 'internal', id: null, name: 'عمل داخلي' },
    pending_approval: r.approved_by ? false : undefined,
  };
}

// ── sanad_list_tasks ────────────────────────────────────────────────────────────────────
async function runListTasks(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const today = riyadhDate();
  const who = enumOf(input.who, 'صاحب المهام', ['me', 'team'], { def: 'me' });
  const view = enumOf(input.view, 'العدسة', VIEW_KEYS, { def: 'all' });
  const { page, pageSize } = pageOf(input, { defSize: 25, maxSize: 100 });
  const filters = {
    ...VIEWS[view].f,
    todayDate: today,
    status: enumOf(input.status, 'الحالة', STATUSES),
    priority: enumOf(input.priority, 'الأولوية', PRIORITIES),
    project: text(input.projectId, 'معرّف المشروع', { max: 80 }),
    opportunity: text(input.opportunityId, 'معرّف الفرصة', { max: 80 }),
    q: text(input.q, 'بحث في العنوان', { max: 80 }),
    includeDone: boolOf(input.includeDone, false),
    limit: 500,
  };
  if (who === 'team') {
    // الحارس داخل الخدمة: من لا يتجاوز نطاقه نفسه يُردّ بجملتها العربية كما تُردّ الشاشة.
    const groups = await teamTasks(user, filters);
    const flat = groups.flatMap((g) => g.tasks.map((t) => ({ ...t, assignee_name: t.assignee_name || g.name })));
    const total = flat.length;
    const slice = flat.slice((page - 1) * pageSize, page * pageSize);
    return envelope('sanad_list_tasks', {
      scope_ar: `${scopeArOf(user, 'team')} — عدسة «${VIEWS[view].ar}»`,
      units: TASK_UNITS,
      who, view, view_ar: VIEWS[view].ar,
      by_person: groups.map((g) => ({
        userId: g.userId, name: g.name, open: g.tasks.length,
        overdue: g.overdue, blocked: g.blocked, no_next_step: g.noStep, done: g.done,
      })),
      tasks: slice.map((t) => taskOut(t, today)),
      partial: partialOf({ page, pageSize, total, returned: slice.length }),
      text_is_data_ar: TEXT_IS_DATA_AR,
      basis_ar: 'مهام الفريق المعتمدة وحدها — الشخصية محجوبة مهما اتّسع النطاق، وما ينتظر اعتماداً يُقرأ في شاشة الاعتمادات.',
      refs: uniqRefs([REF.tasks(), ...slice.map((t) => REF.task(t.id))]),
    });
  }
  const rows = await myTasks(user, filters);
  const total = rows.length;
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const counters = {};
  for (const k of ['overdue', 'due_today', 'blocked', 'no_next_step', 'no_due_date']) {
    const f = { ...VIEWS[k].f, todayDate: today, includeDone: false, limit: 500 };
    counters[k] = { ar: VIEWS[k].ar, count: (await myTasks(user, f)).length };
  }
  return envelope('sanad_list_tasks', {
    scope_ar: `${scopeArOf(user, 'me')} — عدسة «${VIEWS[view].ar}»`,
    units: TASK_UNITS,
    who, view, view_ar: VIEWS[view].ar,
    counters,
    tasks: slice.map((t) => taskOut(t, today)),
    partial: partialOf({ page, pageSize, total, returned: slice.length }),
    text_is_data_ar: TEXT_IS_DATA_AR,
    basis_ar: 'ما أُسند إليك وما كتبته وينتظر اعتماد مديرك (يُعلَّم بذلك). المنجَز خارج القائمة إلا بطلبه.',
    refs: uniqRefs([REF.tasks(), ...slice.map((t) => REF.task(t.id))]),
  });
}

// ── دورة الإنشاء: معاينة ⟵ رمز ⟵ تنفيذ ──────────────────────────────────────────────────
const LINK_KINDS = ['project', 'opportunity', 'internal', 'personal'];

function createFieldsOf(input) {
  const title = text(input.title, 'عنوان المهمة', { required: true, max: 200, min: 2 });
  const link = enumOf(input.linkKind, 'نوع الجهة المرتبطة', LINK_KINDS, { def: 'internal' });
  const projectId = text(input.projectId, 'معرّف المشروع', { max: 80 });
  const opportunityId = text(input.opportunityId, 'معرّف الفرصة', { max: 80 });
  if (link === 'project' && !projectId) throw badRequest('اخترتَ الربط بمشروع — فحدّد معرّف المشروع');
  if (link === 'opportunity' && !opportunityId) throw badRequest('اخترتَ الربط بفرصة — فحدّد معرّف الفرصة');
  return {
    title,
    linkKind: link,
    project_id: link === 'project' ? projectId : null,
    opportunity_id: link === 'opportunity' ? opportunityId : null,
    work_kind: link === 'personal' ? 'personal' : (link === 'internal' ? 'internal' : link),
    due_date: dayOf(input.dueDate, 'موعد الاستحقاق'),
    priority: enumOf(input.priority, 'الأولوية', PRIORITIES, { def: 'P2' }),
    assignee_user_id: text(input.assigneeUserId, 'معرّف المسؤول', { max: 80 }),
    next_step: text(input.nextStep, 'الخطوة التالية', { max: 300 }),
    utilization_pct: intOf(input.utilizationPct, 'نسبة الإشغال', { min: 1, max: 100 }),
  };
}

async function runPreviewTaskCreate(ctx, raw) {
  const user = ctx.user;
  const f = createFieldsOf(inputOf(raw));
  const assignee = f.assignee_user_id || user.id;
  const forSelf = assignee === user.id;
  // النسبة مطلوبة على مهمتك أنت (قرار المالك ٢٠٢٦-٠٩-٠٨) — والمعاينة تردّها هنا لا عند التنفيذ،
  // فيُصحَّح الحقل في مكانه بدل أن يسقط التأكيد بعد قراءته.
  if (forSelf && f.work_kind !== 'personal' && f.utilization_pct == null) {
    throw badRequest('نسبة الإشغال مطلوبة على مهمتك — من ١ إلى ١٠٠. حدّدها ثم أعد المعاينة.');
  }
  const parent = f.project_id
    ? await get('SELECT id, name_ar FROM project WHERE id = ? AND deleted_at IS NULL', [f.project_id])
    : f.opportunity_id ? await get('SELECT id, title_ar AS name_ar FROM opportunity WHERE id = ? AND deleted_at IS NULL', [f.opportunity_id]) : null;
  if ((f.project_id || f.opportunity_id) && !parent) throw notFound('الجهة المرتبطة غير موجودة — اختر مشروعاً أو فرصة من قائمتك');
  const assigneeRow = forSelf ? null : await get('SELECT id, name_ar, username FROM app_user WHERE id = ? AND deleted_at IS NULL', [assignee]);
  if (!forSelf && !assigneeRow) throw notFound('المسؤول المختار غير موجود');

  const willBe = {
    title: f.title,
    linked_work_ar: f.linkKind === 'project' ? `مشروع «${parent?.name_ar || ''}»`
      : f.linkKind === 'opportunity' ? `فرصة «${parent?.name_ar || ''}»`
        : f.linkKind === 'personal' ? 'مهمة شخصية — لا يقرؤها غيرك' : 'عمل داخلي',
    assignee_ar: forSelf ? 'أنت' : (assigneeRow?.name_ar || assigneeRow?.username || assignee),
    due_date: f.due_date, due_ar: f.due_date || 'بلا موعد استحقاق',
    priority: f.priority, priority_ar: PRIORITY_AR[f.priority],
    next_step: textOrNot(f.next_step, 'بلا خطوة تالية — يُستحسن كتابتها'),
    utilization_pct: numOrNot(f.utilization_pct, 'نسبة إشغال من طاقتك', 'بلا نسبة — مقبولة لأن المهمة مُسنَدة إلى غيرك'),
    status_ar: STATUS_AR.TODO,
  };
  const summary = `إنشاء مهمة «${f.title}» بأولوية ${PRIORITY_AR[f.priority]} ${willBe.linked_work_ar}، مُسنَدة إلى ${willBe.assignee_ar}، ${willBe.due_ar}.`;
  const { token, expiresAt } = await savePreview(user, {
    type: 'task_create', summary, fields: f, subject_ar: `مهمة جديدة: «${f.title}»`,
    display: [
      { field_ar: 'عنوان المهمة', after_ar: f.title },
      { field_ar: 'العمل المرتبط', after_ar: willBe.linked_work_ar },
      { field_ar: 'المسؤول', after_ar: willBe.assignee_ar },
      { field_ar: 'موعد الاستحقاق', after_ar: willBe.due_ar },
      { field_ar: 'الأولوية', after_ar: PRIORITY_AR[f.priority] },
      { field_ar: 'الحالة عند الإنشاء', after_ar: STATUS_AR.TODO },
    ],
  }, { intent: 'sanad_preview_task_create', sectorId: user.sector_id || null });
  return envelope('sanad_preview_task_create', {
    scope_ar: scopeArOf(user, 'me'), units: TASK_UNITS,
    summary, will_be: willBe,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يُكتب شيء بعد. المعاينة صالحة ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، وتُؤكَّد برمزها عبر sanad_create_task.`,
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.tasks(), f.project_id ? REF.project(f.project_id) : null, f.opportunity_id ? REF.opportunity(f.opportunity_id) : null]),
  });
}

async function runCreateTask(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_task_create');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'task_create');
    const f = p.fields || {};
    const row = await quickAddTask(ctx, {
      title: f.title, project_id: f.project_id, opportunity_id: f.opportunity_id,
      work_kind: f.work_kind, due_date: f.due_date, priority: f.priority,
      assignee_user_id: f.assignee_user_id || undefined, next_step: f.next_step,
      utilization_pct: f.utilization_pct,
    });
    await audit(ctx, {
      action: 'create', resource: 'task', resourceId: row.id, sectorId: row.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_create_task', preview: token, confirmed_by: user.id, title: row.title },
    });
    return envelope('sanad_create_task', {
      scope_ar: scopeArOf(user, 'me'), units: TASK_UNITS,
      applied: true, task: taskOut({ ...row, project_name: null, opportunity_name: null }, riyadhDate()),
      summary: p.summary,
      refs: uniqRefs([REF.task(row.id), REF.tasks()]),
    });
  });
}

// ── دورة التحديث: قبل/بعد لكل حقل يتغيّر، والرمز يبطل إن تحرّكت المهمة ─────────────────────
const FP_FIELDS = ['status', 'priority', 'due_date', 'next_step', 'blocked_reason', 'assignee_user_id', 'utilization_pct', 'updated_at'];
const UPDATABLE = Object.freeze({
  status: { ar: 'الحالة', label: (v) => STATUS_AR[v] || v },
  priority: { ar: 'الأولوية', label: (v) => PRIORITY_AR[v] || v },
  due_date: { ar: 'موعد الاستحقاق', label: (v) => (v ? String(v).slice(0, 10) : 'بلا موعد') },
  next_step: { ar: 'الخطوة التالية', label: (v) => (v || 'بلا خطوة تالية') },
  blocked_reason: { ar: 'سبب التوقف', label: (v) => (v || 'بلا سبب') },
  utilization_pct: { ar: 'نسبة الإشغال', label: (v) => (v == null ? 'بلا نسبة' : `${v}%`) },
});

async function readableTask(user, taskId) {
  const row = await get('SELECT * FROM task WHERE id = ? AND deleted_at IS NULL', [taskId]);
  if (!row) throw notFound('المهمة غير موجودة');
  const isOwn = row.assignee_user_id === user.id || row.created_by === user.id;
  if (!isOwn && !can(user, 'update', 'task', row)) {
    const scope = effectiveScope(user, 'update', 'task');
    throw notFound(scope && scope !== 'own'
      ? 'المهمة غير موجودة ضمن ما تفتحه صلاحيتك — يملكها صاحبها ومديره، فاطلبها منهما.'
      : 'المهمة غير موجودة ضمن مهامك — يملكها صاحبها ومديره، فاطلبها منهما.');
  }
  return row;
}

async function runPreviewTaskUpdate(ctx, raw) {
  const user = ctx.user;
  const input = inputOf(raw);
  const taskId = text(input.taskId, 'معرّف المهمة', { required: true, max: 80 });
  const row = await readableTask(user, taskId);
  const patch = {};
  if ('status' in input) patch.status = enumOf(input.status, 'الحالة', STATUSES, { required: true });
  if ('priority' in input) patch.priority = enumOf(input.priority, 'الأولوية', PRIORITIES, { required: true });
  if ('dueDate' in input) patch.due_date = input.dueDate === null || input.dueDate === '' ? null : dayOf(input.dueDate, 'موعد الاستحقاق');
  if ('nextStep' in input) patch.next_step = text(input.nextStep, 'الخطوة التالية', { max: 300 });
  if ('blockedReason' in input) patch.blocked_reason = text(input.blockedReason, 'سبب التوقف', { max: 300 });
  if ('utilizationPct' in input) patch.utilization_pct = input.utilizationPct === null || input.utilizationPct === '' ? null : intOf(input.utilizationPct, 'نسبة الإشغال', { min: 1, max: 100 });
  if (!Object.keys(patch).length) throw badRequest('حدّد ما تريد تغييره: الحالة أو الأولوية أو الموعد أو الخطوة التالية أو سبب التوقف أو نسبة الإشغال.');
  // «متوقفة» بلا سبب مكتوب حالةٌ لا تقول شيئاً لمن يقرؤها بعد أسبوع.
  const nextStatus = 'status' in patch ? patch.status : row.status;
  const nextBlocked = 'blocked_reason' in patch ? patch.blocked_reason : row.blocked_reason;
  if (nextStatus === 'BLOCKED' && !String(nextBlocked || '').trim()) {
    throw badRequest('المهمة المتوقفة يلزمها سبب مكتوب — اكتب ما يعطّلها ليعرف من يقرؤها ماذا يرفع.');
  }
  const changes = Object.entries(patch)
    .filter(([k, v]) => (row[k] ?? null) !== (v ?? null))
    .map(([k, v]) => ({ field: k, field_ar: UPDATABLE[k].ar, before_ar: UPDATABLE[k].label(row[k]), after_ar: UPDATABLE[k].label(v) }));
  if (!changes.length) throw badRequest('لا فرق بين ما طلبتَه وما هو مسجَّل الآن — لا شيء يتغيّر.');
  const summary = `تحديث «${row.title}»: ${changes.map((c) => `${c.field_ar} من ${c.before_ar} إلى ${c.after_ar}`).join('، ')}.`;
  const { token, expiresAt } = await savePreview(user, {
    type: 'task_update', summary, taskId: row.id, patch, display: changes,
    subject_ar: `المهمة «${row.title}»`, fingerprint: fingerprintOf(row, FP_FIELDS),
  }, { intent: 'sanad_preview_task_update', sectorId: row.sector_id || user.sector_id || null });
  return envelope('sanad_preview_task_update', {
    scope_ar: scopeArOf(user, 'me'), units: TASK_UNITS,
    task: { id: row.id, title: row.title }, summary, changes,
    previewToken: token, expires_at: expiresAt, ttl_minutes: PREVIEW_TTL_MINUTES,
    note_ar: `لم يُكتب شيء بعد. الرمز صالح ${PREVIEW_TTL_MINUTES} دقيقة ولمرة واحدة، ويبطل إن تغيّرت المهمة قبل تأكيده.`,
    text_is_data_ar: TEXT_IS_DATA_AR,
    refs: uniqRefs([REF.task(row.id)]),
  });
}

async function runUpdateTask(ctx, raw) {
  const user = ctx.user;
  const token = tokenOnly(raw, 'sanad_preview_task_update');
  return await tx(async () => {
    const p = claimGuard(await claimPreview(user, token), 'task_update');
    const row = await get('SELECT * FROM task WHERE id = ? AND deleted_at IS NULL', [p.taskId]);
    if (!row) throw notFound('المهمة لم تعد موجودة — حُذفت بعد المعاينة.');
    assertFingerprint(row, FP_FIELDS, p.fingerprint, 'تغيّرت المهمة');
    const out = await updateTask(ctx, p.taskId, p.patch);
    await audit(ctx, {
      action: 'update', resource: 'task', resourceId: p.taskId, sectorId: out.sector_id || user.sector_id || null,
      detail: { via: 'ai', tool: 'sanad_update_task', preview: token, confirmed_by: user.id, fields: Object.keys(p.patch) },
    });
    return envelope('sanad_update_task', {
      scope_ar: scopeArOf(user, 'me'), units: TASK_UNITS,
      applied: true, summary: p.summary, task: taskOut(out, riyadhDate()),
      refs: uniqRefs([REF.task(p.taskId)]),
    });
  });
}

// ── السجل ───────────────────────────────────────────────────────────────────────────────
const createsTasks = (u) => !!u && (u.role_id === 'admin' || can(u, 'create', 'task'));
const updatesTasks = (u) => !!u && (u.role_id === 'admin' || can(u, 'update', 'task') || !!u.id);

export const TASK_TOOLS = Object.freeze([
  {
    name: 'sanad_list_tasks', label_ar: 'قائمة المهام', kind: 'read',
    description_ar: 'مهام صاحب الحساب أو فريقه بعدسات شاشة «مهامي» نفسها: متأخرة · مستحقة اليوم · متوقفة · بلا خطوة تالية · بلا موعد · بلا نسبة إشغال. لكل مهمة عنوانها وحالتها وأولويتها وموعدها وأيام تأخّرها وخطوتها التالية وسبب توقفها والعمل المرتبط بها. مع عدّادات مطابقة للشاشة. «مهام فريقي» تتطلب نطاق قراءة إدارة أو قطاع، والمهام الشخصية محجوبة عنها دائماً. لا قيم مالية.',
    input: obj({
      who: S.en('صاحب المهام — «me» مهامك (الافتراضي) أو «team» مهام فريقك', ['me', 'team']),
      view: S.en('العدسة — الافتراضي: كل المهام المفتوحة', VIEW_KEYS),
      status: S.en('الحالة', STATUSES), priority: S.en('الأولوية', PRIORITIES),
      projectId: S.str('حصر بمشروع بعينه', { maxLength: 80 }),
      opportunityId: S.str('حصر بفرصة بعينها', { maxLength: 80 }),
      q: S.str('بحث في العنوان', { maxLength: 80 }),
      includeDone: S.bool('إدراج المنجَز — الافتراضي: لا'),
      ...PAGE_PROPS,
    }),
    output_ar: 'قائمة مرقَّمة بالكامل (`partial` تعلن الصفحة والعدد الكلي) + عدّادات العدسات؛ أيام التأخّر بالأيام التقويمية؛ الحقل بلا قيمة يقول «غير مُسجَّل» لا صفراً',
    allow: (u) => !!u?.id, run: runListTasks,
  },
  {
    name: 'sanad_preview_task_create', label_ar: 'معاينة إنشاء مهمة', kind: 'preview',
    description_ar: 'يعاين مهمة قبل إنشائها: العنوان والجهة المرتبطة (مشروع أو فرصة أو عمل داخلي أو مهمة شخصية) والموعد والأولوية والمسؤول ونسبة الإشغال، ويعطي رمزاً صالحاً ١٥ دقيقة لمرة واحدة. لا يكتب شيئاً. نسبة الإشغال مطلوبة على المهمة التي تكتبها لنفسك، ومقبولة فارغةً فيما تُسنده إلى زميل. المهمة الشخصية تخصّ صاحبها ولا تُسنَد إلى غيره.',
    input: obj({
      title: S.str('عنوان المهمة', { maxLength: 200, minLength: 2 }),
      linkKind: S.en('نوع الجهة المرتبطة — الافتراضي: عمل داخلي', LINK_KINDS),
      projectId: S.str('معرّف المشروع (حين يكون الربط بمشروع)', { maxLength: 80 }),
      opportunityId: S.str('معرّف الفرصة (حين يكون الربط بفرصة)', { maxLength: 80 }),
      dueDate: S.day('موعد الاستحقاق (اختياري)'),
      priority: S.en('الأولوية — الافتراضي: متوسطة', PRIORITIES),
      assigneeUserId: S.str('معرّف المسؤول — الافتراضي: أنت', { maxLength: 80 }),
      nextStep: S.str('الخطوة التالية', { maxLength: 300 }),
      utilizationPct: S.int('نسبة الإشغال من طاقة صاحبها (١–١٠٠)', 1, 100),
    }, ['title']),
    output_ar: 'ما سيُسجَّل حقلاً حقلاً + رمز المعاينة ولحظة انتهائها؛ لا كتابة قبل التأكيد',
    allow: createsTasks, run: runPreviewTaskCreate,
  },
  {
    name: 'sanad_create_task', label_ar: 'تأكيد إنشاء مهمة', kind: 'write',
    description_ar: 'ينشئ المهمة المعاينة برمزها وحده — لا يقبل بيانات مهمة مباشرة. الرمز لمرة واحدة وينتهي بعد ١٥ دقيقة. يمرّ ببوابات الشاشة نفسها: نطاق الإنشاء، وبوابة الإسناد إلى زميل، وشرط نسبة الإشغال على مهمتك.',
    input: TOKEN_INPUT,
    output_ar: 'المهمة كما سُجِّلت برابطها في شاشة المهام',
    allow: createsTasks, run: runCreateTask,
  },
  {
    name: 'sanad_preview_task_update', label_ar: 'معاينة تحديث مهمة', kind: 'preview',
    description_ar: 'يعاين تغييراً على مهمة قائمة ويعرض قبل/بعد لكل حقل يتغيّر فعلاً (الحالة، الأولوية، الموعد، الخطوة التالية، سبب التوقف، نسبة الإشغال)، ويعطي رمزاً صالحاً ١٥ دقيقة لمرة واحدة يبطل إن تحرّكت المهمة قبل تأكيده. طلبٌ لا يغيّر شيئاً يُردّ. و«متوقفة» بلا سبب مكتوب تُردّ.',
    input: obj({
      taskId: S.str('معرّف المهمة', { maxLength: 80 }),
      status: S.en('الحالة الجديدة', STATUSES), priority: S.en('الأولوية الجديدة', PRIORITIES),
      dueDate: S.str('الموعد الجديد بصيغة سنة-شهر-يوم، أو فارغاً لإزالته', { maxLength: 10 }),
      nextStep: S.str('الخطوة التالية', { maxLength: 300 }),
      blockedReason: S.str('سبب التوقف', { maxLength: 300 }),
      utilizationPct: S.int('نسبة الإشغال (١–١٠٠)', 1, 100),
    }, ['taskId']),
    output_ar: 'قائمة التغييرات قبل/بعد بالعربية + رمز المعاينة؛ لا كتابة قبل التأكيد',
    allow: updatesTasks, run: runPreviewTaskUpdate,
  },
  {
    name: 'sanad_update_task', label_ar: 'تأكيد تحديث مهمة', kind: 'write',
    description_ar: 'يطبّق تحديث المهمة المعاينة برمزه وحده — لا يقبل حقول تغيير مباشرة. يعيد قراءة المهمة ويقارن بصمتها قبل الكتابة: تغيّرت بعد المعاينة ⟵ يُردّ الرمز بجملة تطلب معاينة جديدة، فلا يُطبَّق تغييرٌ بُني على حالٍ مضى.',
    input: TOKEN_INPUT,
    output_ar: 'المهمة بعد التحديث + ملخّص ما تغيّر',
    allow: updatesTasks, run: runUpdateTask,
  },
]);
