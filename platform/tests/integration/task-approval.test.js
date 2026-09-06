// «موضوع الاعتمادات: أي موظف يضيف مهمة لازم المدير يعتمدها عشان تنضاف له — إذا كانت مهمة
//  متعلّقة بالمشروع أو فرصة معيّنة» — بلسان المالك.
//
// وثلاثة أشياء تُثبَت هنا، وكلها كانت تسقط قبل هذه الموجة:
//   ① المهمة المرتبطة بمشروع أو فرصة **لا تُضاف** حتى يعتمدها مدير كاتبها.
//   ② والمعلَّقة **لا تُقرأ في أي مكان** إلا قائمة كاتبها معلَّمةً — لا لوحة مدير، ولا شاشة
//      مشروع، ولا عدّاد، ولا تقرير فترة، ولا وقتٌ يُسجَّل عليها.
//   ③ والاعتماد يُضيفها في حينها، والردّ يُزيلها — فلا تبقى معلَّقةً إلى الأبد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-taskapr-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, approval, engine, depts, timesheets, home, metrics;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
// الموظف: نطاقه «خاصتي»، وإدارته D_INNO التي يقودها u_inno — فهو من تنطبق عليه القاعدة.
// و`projectIds`/`opportunityIds` كما يبنيها سياق الطلب لمن سُكِّن عليها: الموظف يربط مهمته
// بما يعمل عليه فعلاً، وهذا هو المسار الحقيقي الذي يشتكي منه المالك لا مسارٌ مصنوع.
const EMP = { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', employee_id: 'e_emp', projectIds: new Set(['PRJ']), opportunityIds: new Set(['OPP']) };
let MGR;
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });
const taskRow = (id) => db.get('SELECT * FROM task WHERE id = ?', [id]);

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
  approval = await import('../../src/modules/pmo/task-approval.js');
  engine = await import('../../src/modules/workflow/engine.js');
  depts = await import('../../src/core/rbac/departments.js');
  timesheets = await import('../../src/modules/timesheets/timesheets.js');
  home = await import('../../src/modules/home/home.js');
  metrics = await import('../../src/core/reports/metrics.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_mgr', username: 'mgr', name_ar: 'مدير الابتكار', role_id: 'department_manager',
    scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', employee_id: 'e_emp', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_lone', username: 'lone', name_ar: 'موظف بلا مدير', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', employee_id: 'e_lone', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL',
    manager_user_id: 'u_mgr', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_emp', name_ar: 'سجى لشكر', sector_id: 'SOL', department_id: 'D_INNO',
    user_id: 'u_emp', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_mgr', name_ar: 'مدير الابتكار', sector_id: 'SOL', department_id: 'D_INNO',
    user_id: 'u_mgr', active: 1, created_at: T });
  // بلا إدارة ⟵ بلا مديرٍ مسجَّل: هذه الحالة تمرّ فوراً بقرارٍ موثَّق، لا تُعلَّق إلى الأبد.
  await db.insert('employee', { id: 'e_lone', name_ar: 'موظف بلا إدارة', sector_id: 'SOL', active: 1, created_at: T });

  await db.insert('project', { id: 'PRJ', name_ar: 'منصة تحليلات', sector_id: 'SOL', status: 'IN_PROGRESS',
    owner_user_id: 'u_mgr', created_at: T });
  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('opportunity', { id: 'OPP', title_ar: 'منافسة الرياض', sector_id: 'SOL', stage_id: 'PROPOSAL',
    value_halalas: 100000, owner_user_id: 'u_mgr', created_at: T });

  MGR = { id: 'u_mgr', username: 'mgr', name_ar: 'مدير الابتكار', role_id: 'department_manager', scope: 'department',
    sector_id: 'SOL', employee_id: 'e_mgr', department_id: 'D_INNO',
    departmentIds: await depts.readerDepartmentIds('u_mgr', null) };
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ═══ ① متى يُنتظَر الاعتماد ومتى لا ═══════════════════════════════════════════

test('مهمة الموظف على مشروع تُكتب معلَّقة ويصل الطلب إلى مدير إدارته', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'إعداد خطة الاختبار', project_id: 'PRJ' });
  assert.equal(t.approval_state, 'PENDING', 'أُضيفت بلا اعتماد');
  assert.equal(t.status, 'TODO', 'تغيّرت حالة العمل — والانتظار ليس حالة عمل');
  const q = await engine.myDirectApprovals(MGR);
  const mine = q.filter((a) => a.resource === 'task' && a.resource_id === t.id);
  assert.equal(mine.length, 1, 'لم يصل الطلب إلى المدير');
  assert.equal(mine[0].assignee_user_id, 'u_mgr');
});

test('ومهمة على فرصة كذلك — الشرط «مشروع أو فرصة» لا المشروع وحده', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'تجهيز العرض الفني', opportunity_id: 'OPP' });
  assert.equal(t.approval_state, 'PENDING');
});

test('ومهمة بلا جهة مرتبطة تُضاف فوراً — عملُه الداخلي دفترُه', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'ترتيب ملفاتي' });
  assert.equal(t.approval_state, null, 'عُلّق عملٌ داخلي لا يخصّ أحداً');
  const p = await tasks.quickAddTask(ctx(EMP), { title: 'موعد شخصي', work_kind: 'personal' });
  assert.equal(p.approval_state, null, 'عُلّقت مهمة شخصية — وهي دفتر صاحبها وحده');
});

test('ومهمة المدير نفسه تُضاف فوراً — لا يستأذن نفسه', async () => {
  const t = await tasks.quickAddTask(ctx(MGR), { title: 'مراجعة الخطة', project_id: 'PRJ' });
  assert.equal(t.approval_state, null);
});

test('ومَن لا مديرَ مسجَّلاً له تُضاف مهمته — فلا تُعلَّق بانتظار من لا وجود له', async () => {
  const LONE = { id: 'u_lone', username: 'lone', role_id: 'employee', scope: 'own', sector_id: 'SOL',
    employee_id: 'e_lone', projectIds: new Set(['PRJ']) };
  const t = await tasks.quickAddTask(ctx(LONE), { title: 'مهمة يتيمة', project_id: 'PRJ' });
  assert.equal(t.approval_state, null, 'عُلّقت مهمةٌ لا معتمِد لها — انتظارٌ لا ينتهي');
});

// ═══ ② المعلَّقة لا تُقرأ إلا عند كاتبها ═══════════════════════════════════════

test('المعلَّقة تظهر لكاتبها في «مهامي» — ولا تظهر لمن أُسنِدت إليه ولا في لوحة المدير', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة معلَّقة للقراءة', project_id: 'PRJ' });
  const mine = await tasks.myTasks(EMP, {});
  assert.ok(mine.some((x) => x.id === t.id), 'اختفت من قائمة كاتبها فيحسبها ضاعت');

  const board = await tasks.teamTasks(MGR, {});
  const flat = board.flatMap((b) => b.tasks);
  assert.ok(!flat.some((x) => x.id === t.id), 'ظهرت في لوحة المدير قبل أن يعتمدها');

  const prj = await tasks.projectTasks(ADMIN, 'PRJ');
  assert.ok(!prj.some((x) => x.id === t.id), 'ظهرت في شاشة المشروع قبل الاعتماد');

  const day = await home.myDay(EMP, {});
  assert.ok(!day.tasks.some((x) => x.id === t.id), 'عُدّت في «ما ينتظرك» وهي عند مديره لا عنده');

  const dossier = await tasks.personDossier(MGR, 'u_emp');
  assert.ok(!dossier.tasks.some((x) => x.id === t.id), 'ظهرت في ملف الشخص عند مديره');
});

test('ولا تدخل عدّادات المشروع — فلا يُقاس تقدّمٌ بعملٍ لم يُعتمد', async () => {
  const before = await metrics.projectKpis('PRJ');
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة لا تُعدّ', project_id: 'PRJ' });
  const after = await metrics.projectKpis('PRJ');
  assert.equal(after.totalTasks, before.totalTasks, 'ارتفع عدّاد مهام المشروع بمهمة معلَّقة');
  await db.update('task', t.id, { deleted_at: new Date().toISOString() });
});

// تقرير الفترة يُركّب شرطه من متغيّر، فالحارس البنيوي لا يقرؤه — ويُثبَت هنا سلوكياً.
test('ولا تُعدّ في تقرير الفترة — المستند يُرسَل ويُقرأ من غير صاحبه', async () => {
  const periods = await import('../../src/core/reports/periods.js');
  const opts = { period: 'month', lens: 'project', targetId: 'PRJ', anchor: new Date('2026-08-05T00:00:00Z') };
  const before = await periods.buildPeriodReport(ADMIN, opts);
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة خارج التقرير', project_id: 'PRJ' });
  const after = await periods.buildPeriodReport(ADMIN, opts);
  const count = (r) => JSON.stringify(r).split('مهمة خارج التقرير').length - 1;
  assert.equal(count(after), 0, 'ظهرت مهمة معلَّقة في تقرير الفترة');
  const tasksSection = (r) => (r.sections || []).find((s) => s.key === 'tasks');
  assert.deepEqual(tasksSection(after)?.figures?.length, tasksSection(before)?.figures?.length,
    'تغيّر شكل قسم المهام بمهمة لم تُعتمَد');
  await db.update('task', t.id, { deleted_at: new Date().toISOString() });
});

test('ولا يُسجَّل عليها وقت — ساعاتٌ على عملٍ لم يُضَف بعد', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة بلا ساعات', project_id: 'PRJ' });
  await assert.rejects(
    () => timesheets.addEntry(ctx(EMP), { task_id: t.id, hours: 3, entry_date: '2026-08-05' }),
    /بانتظار اعتماد/, 'سُجِّل وقت على مهمة معلَّقة');
});

test('ولا يكتب فيها غيرُ كاتبها — ولو اتّسع نطاقه', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة محجوبة عن التعديل', project_id: 'PRJ' });
  await assert.rejects(() => tasks.updateTask(ctx(ADMIN), t.id, { title: 'عنوان آخر' }),
    /غير موجودة/, 'كُتب في مهمة معلَّقة من خارج كاتبها');
  // وكاتبها يصحّحها قبل أن ينظر فيها مديره — الردّ يُصلَّح لا يُعاد من الصفر.
  const fixed = await tasks.updateTask(ctx(EMP), t.id, { title: 'عنوان مصحَّح' });
  assert.equal(fixed.title, 'عنوان مصحَّح');
  assert.equal(fixed.approval_state, 'PENDING', 'زال الانتظار بمجرد تعديل العنوان');
});

// ═══ ③ القرار: اعتماد يُضيف، وردٌّ يُزيل ═══════════════════════════════════════

test('اعتماد المدير يُضيفها في حينها — فتصير عملاً قائماً في كل شاشة', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة ستُعتمَد', project_id: 'PRJ' });
  const req = (await engine.myDirectApprovals(MGR)).find((a) => a.resource_id === t.id);
  assert.ok(req, 'لم يصل الطلب');
  await engine.actOnApproval(ctx(MGR), req.id, 'approve');

  const row = await taskRow(t.id);
  assert.equal(row.approval_state, null, 'بقيت معلَّقة بعد الاعتماد');
  // أثر القرار يُكتب على المهمة نفسها لحظة اتخاذه (٠٣٠) — من اعتمدها ومتى.
  assert.equal(row.approved_by, 'u_mgr', 'لم يُكتب المعتمِد على المهمة');
  assert.ok(row.approved_at, 'لم يُكتب وقت الاعتماد');
  const prj = await tasks.projectTasks(ADMIN, 'PRJ');
  assert.ok(prj.some((x) => x.id === t.id), 'لم تظهر في المشروع بعد اعتمادها');
  const board = await tasks.teamTasks(MGR, {});
  assert.ok(board.flatMap((b) => b.tasks).some((x) => x.id === t.id), 'لم تظهر في لوحة المدير بعد اعتمادها');
});

test('واسم المعتمِد يُقرأ في قائمة صاحبها — ولا معتمِد لِما لم يُعتمَد', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة يظهر معتمِدها', project_id: 'PRJ' });
  const req = (await engine.myDirectApprovals(MGR)).find((a) => a.resource_id === t.id);
  await engine.actOnApproval(ctx(MGR), req.id, 'approve');

  const mine = (await tasks.myTasks(EMP, {})).find((x) => x.id === t.id);
  assert.equal(mine.approver_name, 'مدير الابتكار', 'لم يصل اسم المعتمِد إلى قائمة صاحب المهمة');
  assert.equal(mine.creator_name, 'سجى لشكر', 'لم يصل اسم كاتب المهمة');

  // عملٌ داخلي لم يحتج اعتماداً: عموداه فارغان — وهذا معناهما الصحيح.
  const internal = await tasks.quickAddTask(ctx(EMP), { title: 'عمل داخلي بلا معتمِد' });
  const irow = await taskRow(internal.id);
  assert.equal(irow.approved_by, null);
  assert.equal(irow.approved_at, null);
});

test('وردُّها يُزيلها — فلا تبقى معلَّقة إلى الأبد ولا تُقرأ عند أحد', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة سترُدّ', project_id: 'PRJ' });
  const req = (await engine.myDirectApprovals(MGR)).find((a) => a.resource_id === t.id);
  await engine.actOnApproval(ctx(MGR), req.id, 'reject', 'ليست من عمل هذا المشروع');

  const row = await taskRow(t.id);
  assert.ok(row.deleted_at, 'بقيت المهمة قائمةً بعد ردّها');
  assert.equal(row.approved_by, null, 'كُتب معتمِدٌ على مهمةٍ رُدَّت');
  const mine = await tasks.myTasks(EMP, {});
  assert.ok(!mine.some((x) => x.id === t.id), 'بقيت في قائمة كاتبها بعد الردّ');
});

test('ولا يعتمد المرءُ مهمته بنفسه — فصلُ المهام يسري على هذا الباب كما على غيره', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة لا تُعتمَد ذاتياً', project_id: 'PRJ' });
  const req = await db.get("SELECT * FROM approval_request WHERE resource_id = ? AND status = 'PENDING'", [t.id]);
  await assert.rejects(() => engine.actOnApproval(ctx(EMP), req.id, 'approve'),
    /لا تعتمد طلباً رفعتَه بنفسك/, 'اعتمد الموظفُ مهمته بنفسه');
});

// ═══ الطلب يُقرأ باسمه لا بمعرّفه ═════════════════════════════════════════════

test('شاشة الاعتمادات تعرض عنوان المهمة ومشروعها لا معرّفها', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'إعداد محضر التسليم', project_id: 'PRJ' });
  const { approvalTargets } = await import('../../src/modules/workflow/targets.js');
  const map = await approvalTargets(await engine.myDirectApprovals(MGR));
  const label = map.get(t.id);
  assert.ok(label, 'لا اسم للطلب — فيقرأ المديرُ معرّفاً تقنياً');
  assert.equal(label.label, 'إعداد محضر التسليم');
  assert.equal(label.parent, 'منصة تحليلات');
});

// ═══ حاجزٌ بنيويّ: لا انتظار على صفٍّ قائم ═════════════════════════════════════

test('كل صفٍّ قائم قبل الميزة يبقى بلا انتظار — لا مهمة تختفي لحظة الترحيلة', async () => {
  const legacy = { id: 'tsk_legacy', title: 'مهمة قديمة', work_kind: 'project', project_id: 'PRJ',
    sector_id: 'SOL', assignee_user_id: 'u_emp', priority: 'P2', status: 'TODO', created_at: T, created_by: 'u_emp' };
  await db.insert('task', legacy);              // بلا `approval_state` إطلاقاً — كما تكتبها الترحيلة
  const row = await taskRow('tsk_legacy');
  assert.equal(row.approval_state, null);
  assert.equal(approval.isPendingTask(row), false);
  const prj = await tasks.projectTasks(ADMIN, 'PRJ');
  assert.ok(prj.some((x) => x.id === 'tsk_legacy'), 'اختفت مهمةٌ قائمة من مشروعها');
});

test('ومن ليس معتمِدَ الطلب يُردّ باسم النوع الصحيح: «اعتماد» للمهمة لا «تأكيد تسكين»', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة يعتمدها مديرها وحده', project_id: 'PRJ' });
  const req = await db.get("SELECT * FROM approval_request WHERE resource_id = ? AND status = 'PENDING'", [t.id]);
  const OTHER = { id: 'u_lone', username: 'lone', role_id: 'employee', scope: 'own', sector_id: 'SOL', employee_id: 'e_lone' };
  await assert.rejects(() => engine.actOnApproval(ctx(OTHER), req.id, 'approve'),
    /موجَّه إلى مدير كاتب المهمة/, 'رسالة المنع تتحدث عن تسكينٍ في طلب مهمة');
});
