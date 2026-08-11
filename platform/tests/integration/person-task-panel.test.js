// لوحة الشخص تربط المهمة بجهتها — «مهمة جديدة باسمه» بمنتقي «الجهة المرتبطة» (KI-039)،
// ومنتقي الفرص بمدى الخادم نفسه لا ببوابةٍ أوسع منه (KI-040).
//
// وثلاثة أشياء تُثبَت:
//   ① المدير يُسند مهمةً مرتبطةً بمشروعٍ أو فرصة من لوحة الشخص، والخادم يقبلها كما كان.
//   ② من فوقه مديرٌ تُعلَّق مهمتُه المرتبطة حتى يعتمدها مديرُه هو — والشاشة تقول ذلك قبل الحفظ.
//   ③ من سُكِّن على فرصةٍ يجدها في المنتقي، ومن لا شيء في نطاقه يقرأ ذلك نصاً لا فراغاً صامتاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ppanel-'));
process.env.SANAD_DB = join(dir, 'p.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, engine, depts, personPage, tasksPage;
const T = new Date().toISOString();
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });
let BOSS, MID, EMP;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
  engine = await import('../../src/modules/workflow/engine.js');
  depts = await import('../../src/core/rbac/departments.js');
  ({ personPage, tasksPage } = await import('../../src/web/views/pmo.js'));

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  // إدارتان: «الرأس» يديرها u_boss وفيها موظفُ u_mid؛ و«الفرع» يديرها u_mid وفيها u_emp.
  // فـu_boss لا مدير فوقه، وu_mid فوقه u_boss — وهما حالتا التلميح واحدةً واحدة.
  const PEOPLE = [
    ['u_boss', 'مدير الرأس', 'department_manager', 'department', 'e_boss', 'D_HEAD'],
    ['u_mid', 'مدير الفرع', 'department_manager', 'department', 'e_mid', 'D_HEAD'],
    ['u_emp', 'موظف الفرع', 'employee', 'own', 'e_emp', 'D_SUB'],
    ['u_out', 'موظف بلا تسكين', 'employee', 'own', 'e_out', 'D_SUB'],
  ];
  for (const [uid, name, role, scope, empId] of PEOPLE) {
    await db.insert('app_user', { id: uid, username: uid, name_ar: name, role_id: role, scope,
      sector_id: 'SOL', employee_id: empId, active: 1, created_at: T });
  }
  for (const [id, name, mgr] of [['D_HEAD', 'إدارة الرأس', 'u_boss'], ['D_SUB', 'إدارة الفرع', 'u_mid']]) {
    await db.insert('department', { id, name_ar: name, sector_id: 'SOL', manager_user_id: mgr, active: 1, created_at: T });
  }
  for (const [uid, name, , , empId, dept] of PEOPLE) {
    await db.insert('employee', { id: empId, name_ar: name, sector_id: 'SOL', department_id: dept,
      user_id: uid, active: 1, created_at: T });
  }
  await db.insert('project', { id: 'PRJ', name_ar: 'منصة تحليلات', sector_id: 'SOL', department_id: 'D_HEAD',
    status: 'IN_PROGRESS', owner_user_id: 'u_boss', created_at: T });
  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('opportunity', { id: 'OPP', title_ar: 'منافسة الرياض', sector_id: 'SOL', stage_id: 'PROPOSAL',
    department_id: 'D_SUB', value_halalas: 100000, owner_user_id: 'u_mid', created_at: T });

  BOSS = { id: 'u_boss', username: 'u_boss', name_ar: 'مدير الرأس', role_id: 'department_manager',
    scope: 'department', sector_id: 'SOL', employee_id: 'e_boss',
    departmentIds: await depts.readerDepartmentIds('u_boss', null) };
  MID = { id: 'u_mid', username: 'u_mid', name_ar: 'مدير الفرع', role_id: 'department_manager',
    scope: 'department', sector_id: 'SOL', employee_id: 'e_mid',
    departmentIds: await depts.readerDepartmentIds('u_mid', null) };
  EMP = { id: 'u_emp', username: 'u_emp', name_ar: 'موظف الفرع', role_id: 'employee', scope: 'own',
    sector_id: 'SOL', employee_id: 'e_emp' };
});
after(() => rmSync(dir, { recursive: true, force: true }));

const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

// ═══ ① الخادم يقبل الربط من هذه اللوحة كما هو ═══════════════════════════════════

test('مدير لا مدير فوقه يُسند مهمةً مرتبطةً بمشروع — تُضاف في حينها بجهتها الصحيحة', async () => {
  const t = await tasks.quickAddTask(ctx(BOSS), { title: 'مراجعة النموذج', project_id: 'PRJ', assignee_user_id: 'u_mid' });
  assert.equal(t.approval_state, null, 'عُلِّقت مهمة من لا مدير فوقه');
  assert.equal(t.project_id, 'PRJ');
  assert.equal(t.work_kind, 'project', 'نوع العمل لا يُشتق من الجهة');
  assert.equal(t.assignee_user_id, 'u_mid');
});

// ═══ ② ومن فوقه مديرٌ تُعلَّق مهمتُه المرتبطة — ولا يراها المُسنَد إليه بعد ═══════

test('مهمة مدير الفرع المرتبطة تنتظر اعتماد مديره هو — وتغيب عن قائمة المُسنَد إليه', async () => {
  const t = await tasks.quickAddTask(ctx(MID), { title: 'تجهيز العرض', opportunity_id: 'OPP', assignee_user_id: 'u_emp' });
  assert.equal(t.approval_state, 'PENDING', 'أُضيفت بلا اعتماد ومُسنِدها فوقه مدير');
  const req = (await engine.myDirectApprovals(BOSS)).find((a) => a.resource === 'task' && a.resource_id === t.id);
  assert.ok(req, 'لم يصل الطلب إلى مدير المُسنِد');
  const empList = await tasks.myTasks(EMP, {});
  assert.ok(!empList.some((x) => x.id === t.id), 'ظهرت لمن أُسنِدت إليه قبل اعتمادها');
});

// ═══ ③ الشاشة: المنتقي حاضر، و«شخصية» غائبة، والتلميح صادق ═══════════════════════

test('لوحة الشخص تحمل منتقي الجهة بمشاريع القارئ — وبلا خيار «شخصية»', async () => {
  const html = mainOf(await personPage(BOSS, 'u_mid'));
  assert.ok(html.includes('id="pp-task-parent"'), 'لا منتقي جهة في اللوحة');
  assert.ok(html.includes('value="p:PRJ"'), 'مشروع القارئ غائب عن المنتقي');
  assert.ok(!html.includes('value="me"'), 'خيار «شخصية» ظهر في مهمةٍ باسم غيره');
  assert.ok(html.includes('تصل إلى قائمته فوراً'), 'تلميح من لا مدير فوقه غير صحيح');
  assert.ok(!/undefined|NaN|\[object/.test(html));
});

test('والتلميح ينقلب لمن فوقه مدير: المرتبط بجهةٍ يُضاف بعد اعتماد مديره', async () => {
  const html = mainOf(await personPage(MID, 'u_emp'));
  assert.ok(html.includes('id="pp-task-parent"'));
  assert.ok(html.includes('value="o:OPP"'), 'فرصة إدارته غائبة عن المنتقي');
  assert.ok(html.includes('بعد اعتماد مديرك'), 'الشاشة تعد بالوصول الفوري ومهمته ستُعلَّق');
});

// ═══ KI-040: منتقي «مهامي» بمدى الخادم — العضوية تُدخل الفرصة، والفراغ يُقال نصاً ═══

test('موظف مُسكَّن على فرصة يجدها في منتقي «مهامي» — كما يقبل الخادم ربطه بها', async () => {
  const member = { ...EMP, opportunityIds: new Set(['OPP']) };
  const html = mainOf(await tasksPage(member, { win: 'all' }));
  assert.ok(html.includes('value="o:OPP"'), 'العضوية المؤكَّدة لا تُدخل الفرصة إلى المنتقي');
});

test('ومن لا شيء في نطاقه يقرأ ذلك نصاً — لا مجموعة تختفي صامتة', async () => {
  const OUT = { id: 'u_out', username: 'u_out', name_ar: 'موظف بلا تسكين', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', employee_id: 'e_out' };
  const html = mainOf(await tasksPage(OUT, { win: 'all' }));
  assert.ok(!html.includes('value="o:OPP"'), 'فرصة ليست في نطاقه ظهرت في منتقيه');
  assert.ok(!html.includes('value="p:PRJ"'), 'مشروع ليس في نطاقه ظهر في منتقيه');
  assert.ok(html.includes('لا مشاريع ولا فرص ضمن نطاقك'), 'الفراغ بلا تفسير مكتوب');
});

// ═══ KI-038: الخبر يصل من أُسندت إليه المهمة — عند الإضافة وعند الاعتماد ═══════════

test('إسنادٌ مباشر (بلا اعتماد) يوصل خبراً باسم المُسنِد لحظة الإضافة', async () => {
  await tasks.quickAddTask(ctx(BOSS), { title: 'مهمة يصل خبرها', project_id: 'PRJ', assignee_user_id: 'u_mid' });
  const n = await db.all(
    "SELECT * FROM notification WHERE user_id = 'u_mid' AND title = 'مهمة جديدة أُسندت إليك' ORDER BY created_at DESC");
  assert.ok(n.length >= 1, 'لا خبر لمن أُسندت إليه المهمة');
  assert.ok(n[0].body.includes('مهمة يصل خبرها'), 'الخبر بلا اسم المهمة');
  assert.ok(n[0].body.includes('أسندها مدير الرأس'), 'الخبر بلا اسم المُسنِد');
});

test('والمعلَّقة يصل خبرُها لصاحبها لحظة الاعتماد لا قبله — ولا خبر مكرر لكاتبها هو', async () => {
  const t = await tasks.quickAddTask(ctx(MID), { title: 'مهمة تصل بعد الاعتماد', opportunity_id: 'OPP', assignee_user_id: 'u_emp' });
  const before = (await db.all("SELECT * FROM notification WHERE user_id = 'u_emp' AND title = 'مهمة جديدة أُسندت إليك'")).length;
  assert.equal(before, 0, 'وصل الخبر قبل الاعتماد — والمهمة ليست عنده بعد');

  const req = (await engine.myDirectApprovals(BOSS)).find((a) => a.resource_id === t.id);
  await engine.actOnApproval(ctx(BOSS), req.id, 'approve');
  const after = await db.all(
    "SELECT * FROM notification WHERE user_id = 'u_emp' AND title = 'مهمة جديدة أُسندت إليك'");
  assert.equal(after.length, 1, 'لا خبر بعد الاعتماد');
  assert.ok(after[0].body.includes('بعد اعتماد المدير'));

  // ومن كتب مهمته لنفسه واعتُمدت: يخطره المحرّك «اعتُمد طلبك» — لا خبر «أُسندت إليك» مكرر.
  const own = await tasks.quickAddTask(ctx({ ...EMP, opportunityIds: new Set(['OPP']) }),
    { title: 'مهمة كاتبها صاحبها', opportunity_id: 'OPP' });
  const req2 = (await engine.myDirectApprovals(MID)).find((a) => a.resource_id === own.id);
  await engine.actOnApproval(ctx(MID), req2.id, 'approve');
  const dup = await db.all(
    "SELECT * FROM notification WHERE user_id = 'u_emp' AND title = 'مهمة جديدة أُسندت إليك'");
  assert.equal(dup.length, 1, 'خبرُ إسنادٍ مكرر لمن كتب مهمته بنفسه');
  const engineNote = await db.all(
    "SELECT * FROM notification WHERE user_id = 'u_emp' AND title = 'اعتُمد طلبك'");
  assert.ok(engineNote.length >= 1, 'خبر المحرّك «اعتُمد طلبك» غائب عن كاتبها');
});
