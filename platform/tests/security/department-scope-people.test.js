// نطاق «الإدارة» على شاشات الأشخاص — العمود الذي كان موجوداً ولا يُرشِّح شيئاً.
//
// العطل الموثَّق: `employee.department_id` قائم منذ أول إصدار، والموجة 007 نسبت العمل إلى
// الإدارات، ومع ذلك لم تكن أي شاشة أشخاص ترشّح به:
//   • كشف الفريق/التسكين (org.js) كان يرشّح بالقطاع وحده — فمدير الإدارة، وكل منحه بنطاق
//     «إدارة» (core/rbac/matrix.js)، يفتح «الفريق» فيرى موظفي القطاع كلهم بإداراته الأخرى.
//   • «مهام فريقي» (tasks.js) كانت تشتقّ الفريق بالقطاع: `(t.sector_id = ? OR u.sector_id = ?)`
//     — أي مهام القطاع كله لمدير إدارة واحدة.
// ولم يكن العطل قابلاً للفحص أصلاً: حسابا «مدير إدارة» و«مدير مباشر» كانا بلا سجل موظف،
// ومعرّف الإدارة يُستنتج من هذا الربط — فكانت إدارتهما فارغة دائماً.
//
// ما يُثبَت هنا — كل بند بوجود إدارة ثانية بأشخاص معروفين بأسمائهم، لا بغيابها:
//   (١) التثبيت: الحسابان مربوطان بسجلَّي موظفَين في إدارة حقيقية، وثمة إدارة ثانية بجوارها.
//   (٢) الكشف: مدير الإدارة يرى إدارته وحدها — وأهل الإدارة الأخرى **غائبون بأسمائهم**.
//   (٣) نطاقا القطاع والشركة كما كانا حرفياً.
//   (٤) الفشل الآمن: نطاقه «إدارة» وحسابه بلا إدارة ⟵ كشف فارغ بحالته المصمَّمة، لا القطاع كله.
//   (٥) «مهام فريقي» على المحور نفسه، ومَن لا سجل موظف له فإدارته مجهولة ⟵ يُستبعد لا يُدرج.
//   (٦) كتابات التثبيت مدقَّقة، وإعادة تشغيلها لا تُكرّر صفاً ولا سطر تدقيق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sanad-deptscope-'));
process.env.SANAD_DB = join(dir, 't.db');

const T = '2026-01-15T08:00:00.000Z';
const FAR = '2099-01-01T00:00:00.000Z';

const { migrate } = await import('../../scripts/migrate.js');
const { seedRbac } = await import('../../scripts/seed-rbac.js');
const seedMod = await import('../../scripts/seed.js');
const { seedFixture } = await import('../../scripts/lib/seed-fixture.mjs');
const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
const { resolveUser } = await import('../../src/core/http/context.js');

let org, tasks, people;
const U = {}; // اسم الحساب ⟵ المستخدم كما يحلّه الخادم فعلاً (بمعرّف إدارته)
const ctx = (user) => ({ user, ip: '127.0.0.1' });

// جلسة حقيقية ثم resolveUser: نقرأ المستخدم من المسار الذي يقرأه الخادم نفسه، فلا يُخترع
// «معرّف إدارة» في الاختبار ولا يمرّ الفحص على شكل لا وجود له في التشغيل.
async function asUser(username) {
  const u = await db.get('SELECT id FROM app_user WHERE username = ?', [username]);
  assert.ok(u, `حساب ${username} مزروع`);
  const sid = 'sess_' + username;
  await db.insert('session', { id: sid, user_id: u.id, created_at: T, expires_at: FAR });
  const resolved = await resolveUser(sid);
  assert.ok(resolved, `جلسة ${username} تُحلّ إلى مستخدم`);
  return resolved;
}

const DEPT_A = seedMod.DEMO_DEPARTMENTS[0];
const DEPT_B = seedMod.DEMO_DEPARTMENTS[1];
const DEMO_DEPT_COUNT = seedMod.DEMO_DEPARTMENTS.length;
const nameOf = (d, i) => d.staff[i].name_ar;
const rosterNames = (r) => r.roster.map((e) => e.name_ar);

before(async () => {
  await migrate();
  await seedRbac();
  await seedMod.seed();        // الحسابات أولاً — بيانات العرض تعتمد عليها
  await seedFixture();         // ثم بيانات الأعمال (القطاعات والموظفون والمهام)
  await seedMod.seedDemoOrg(); // ثم الإدارات والربط — القطاع صار موجوداً
  await initRbac();
  org = await import('../../src/modules/org/org.js');
  tasks = await import('../../src/modules/pmo/tasks.js');
  people = await import('../../src/web/views/people.js');

  for (const name of ['demo.admin', 'demo.sectorlead', 'demo.deptmgr', 'demo.linemgr', 'demo.employee']) {
    U[name] = await asUser(name);
  }
  // مدير إدارة بلا سجل موظف — الحالة التي كان عليها حساب العرض نفسه قبل هذا الإصلاح، وهي
  // الحالة التي يجب أن تُغلق لا أن تتسع.
  await db.insert('app_user', { id: 'U_DEPT_BLIND', username: 't.deptmgr.unlinked', name_ar: 'مدير إدارة بلا سجل',
    role_id: 'department_manager', sector_id: 'SOLUTIONS', scope: 'department', active: 1, created_at: T });
  U.blind = await asUser('t.deptmgr.unlinked');

  // زميل في قطاع آخر ومهمة مفتوحة عليه — بدونه لا يُثبت أن نطاق الشركة أوسع من نطاق القطاع.
  await db.insert('app_user', { id: 'U_CONS_MEMBER', username: 't.cons.member', name_ar: 'زميل الاستشارات',
    role_id: 'employee', sector_id: 'CONSULTING', scope: 'own', active: 1, created_at: T });
  await db.insert('task', { id: 'T_CONS', title: 'مهمة في قطاع الاستشارات', sector_id: 'CONSULTING',
    work_kind: 'internal', assignee_user_id: 'U_CONS_MEMBER', priority: 'P2', status: 'TODO', created_at: T });
  // مهمة مفتوحة على «المدير المباشر» — وهو داخل إدارة مدير الإدارة، فوجودها يُثبت الشمول
  // كما يُثبت غياب غيرها الاستبعاد. تمر بالخدمة كي تُدقَّق كأي كتابة.
  const t = await tasks.quickAddTask(ctx(U['demo.admin']),
    { title: 'مراجعة خطة الإدارة', assignee_user_id: U['demo.linemgr'].id, sector_id: 'SOLUTIONS' });
  U.deptTaskId = t.id;
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ═════════════ (١) التثبيت: بدونه لا سلوك يُفحَص أصلاً ═════════════

test('التثبيت: حسابا مدير الإدارة والمدير المباشر مربوطان بموظفَين في إدارة واحدة حقيقية', async () => {
  assert.ok(U['demo.deptmgr'].employee_id, 'حساب مدير الإدارة مربوط بسجل موظف');
  assert.ok(U['demo.deptmgr'].department_id, 'ومنه تُعرف إدارته — كانت فارغة دائماً قبل هذا');
  assert.equal(U['demo.linemgr'].department_id, U['demo.deptmgr'].department_id, 'المدير المباشر في الإدارة نفسها');
  assert.equal(U['demo.deptmgr'].scope, 'department');

  const deps = await db.all('SELECT id, name_ar FROM department WHERE sector_id = ? AND deleted_at IS NULL ORDER BY name_ar', ['SOLUTIONS']);
  const names = deps.map((d) => d.name_ar);
  assert.ok(names.includes(DEPT_A.name_ar), 'الإدارة الأولى مزروعة');
  assert.ok(names.includes(DEPT_B.name_ar), 'وإدارة ثانية بجوارها — بدونها لا دليل على الاستبعاد');
  const depB = deps.find((d) => d.name_ar === DEPT_B.name_ar);
  assert.notEqual(U['demo.deptmgr'].department_id, depB.id, 'المدير خارج الإدارة الثانية');
  // والإدارة الثانية مأهولة فعلاً بأشخاص لهم أسماء يُبحث عنها
  const staffB = await db.all('SELECT name_ar FROM employee WHERE department_id = ? AND deleted_at IS NULL ORDER BY name_ar', [depB.id]);
  assert.equal(staffB.length, DEPT_B.staff.length);
  assert.ok(staffB.some((e) => e.name_ar === nameOf(DEPT_B, 0)));
});

// ═════════════ (٢) الكشف: إدارته وحدها ═════════════

test('كشف الفريق لمدير الإدارة: إدارته وحدها — وأهل الإدارة الأخرى غائبون بأسمائهم', async () => {
  const r = await org.staffingRoster(U['demo.deptmgr'], {});
  const names = rosterNames(r);
  assert.ok(names.length > 0, 'يرى إدارته — لا شاشة فارغة');
  for (const s of DEPT_A.staff) assert.ok(names.includes(s.name_ar), `${s.name_ar} من إدارته`);
  for (const s of DEPT_B.staff) assert.equal(names.includes(s.name_ar), false, `${s.name_ar} من إدارة أخرى — يجب ألا يظهر`);
  // وموظف في القطاع نفسه بلا إدارة مسجَّلة لا «يتسرّب» إلى كشف إدارة بعينها
  assert.equal(names.includes('سارة الحربي'), false, 'موظف بلا إدارة ليس من إدارة أحد');
  const ids = r.roster.map((e) => e.id);
  const rows = await db.all(`SELECT id FROM employee WHERE department_id = ? AND deleted_at IS NULL`, [U['demo.deptmgr'].department_id]);
  assert.deepEqual(ids.slice().sort(), rows.map((x) => x.id).sort(), 'الكشف = أهل الإدارة بالضبط، لا أكثر ولا أقل');
});

test('لوحة ارتباط الحسابات تتبع نطاق الكشف نفسه — لا جدول أشخاص بحدّ وعمود حسابات بحدّ آخر', async () => {
  const links = await org.identityLinks(U['demo.deptmgr'], {});
  const shown = Object.keys(links.byEmployee);
  const mine = await db.all('SELECT id FROM employee WHERE department_id = ? AND deleted_at IS NULL', [U['demo.deptmgr'].department_id]);
  assert.deepEqual(shown.slice().sort(), mine.map((r) => r.id).sort());
  assert.equal(links.canLink, false, 'مدير الإدارة يقرأ ولا يربط');
  assert.deepEqual(links.freeAccounts, []);
});

test('صفحتا «الفريق» و«التسكين» لمدير الإدارة: أسماء إدارته حاضرة وأسماء غيرها غائبة', async () => {
  for (const page of [people.teamPage, people.staffingPage]) {
    const html = await page(U['demo.deptmgr'], {});
    assert.ok(!/undefined|\bNaN\b|\[object/.test(html), 'بلا تسرّب قيم');
    assert.ok(html.includes(nameOf(DEPT_A, 2)), 'زميلته في الإدارة تظهر');
    assert.equal(html.includes(nameOf(DEPT_B, 0)), false, 'وزميل الإدارة الأخرى لا يظهر');
    assert.equal(html.includes(nameOf(DEPT_B, 1)), false);
  }
});

// ═════════════ (٣) القطاع والشركة كما كانا ═════════════

test('نطاق القطاع لم يتغيّر: قائد القطاع يرى الإدارتين معاً ولا يرى قطاعاً آخر', async () => {
  const names = rosterNames(await org.staffingRoster(U['demo.sectorlead'], {}));
  for (const s of [...DEPT_A.staff, ...DEPT_B.staff]) assert.ok(names.includes(s.name_ar), `${s.name_ar} داخل قطاعه`);
  assert.ok(names.includes('سارة الحربي'), 'وموظفو القطاع بلا إدارة كما كانوا');
  assert.equal(names.includes('فهد الشمري'), false, 'ولا أحد من قطاع الاستشارات');
});

test('نطاق الشركة لم يتغيّر: مدير النظام يرى القطاعين، والترشيح بالقطاع ما زال يعمل', async () => {
  const all = rosterNames(await org.staffingRoster(U['demo.admin'], {}));
  assert.ok(all.includes('فهد الشمري'), 'قطاع الاستشارات حاضر');
  assert.ok(all.includes(nameOf(DEPT_B, 0)));
  const filtered = rosterNames(await org.staffingRoster(U['demo.admin'], { sector: 'CONSULTING' }));
  assert.deepEqual(filtered, ['فهد الشمري'], 'اختيار القطاع من نطاق الشركة كما كان');
});

// ═════════════ (٤) الفشل الآمن: إدارة مجهولة ⟵ فراغ لا اتساع ═════════════

test('مدير إدارة بلا سجل موظف: كشف فارغ — لا القطاع كله', async () => {
  assert.equal(U.blind.department_id, null, 'المقدّمة: إدارته غير معروفة');
  const r = await org.staffingRoster(U.blind, {});
  assert.deepEqual(r.roster, [], 'لا صفّ واحد');
  assert.equal(r.summary.capacityFte, 0);
  // والدليل أن الفراغ ليس عرضياً: القطاع نفسه مأهول لمن يملك نطاقه
  const sector = await org.staffingRoster(U['demo.sectorlead'], {});
  assert.ok(sector.roster.length > 0, 'القطاع مأهول — فالفراغ أعلاه قرار لا صدفة');
  const links = await org.identityLinks(U.blind, {});
  assert.deepEqual(links.byEmployee, {}, 'ولا لوحة ارتباط تلتفّ على القيد');
  assert.equal(links.unlinkedCount, 0);
});

test('الصفحة تقول ذلك بحالتها المصمَّمة لا بشاشة مكسورة', async () => {
  for (const page of [people.teamPage, people.staffingPage]) {
    const html = await page(U.blind, {});
    assert.match(html, /لا أعضاء ضمن نطاقك/, 'حالة فراغ مصمَّمة');
    assert.equal(html.includes(nameOf(DEPT_A, 0)), false, 'وبلا أي اسم من القطاع');
    assert.equal(html.includes('سارة الحربي'), false);
  }
});

// ═════════════ (٥) «مهام فريقي» على المحور نفسه ═════════════

test('مهام فريقي لمدير الإدارة: مهام إدارته وحدها', async () => {
  const board = await tasks.teamTasks(U['demo.deptmgr']);
  const titles = board.flatMap((b) => b.tasks.map((t) => t.title));
  assert.ok(titles.includes('مراجعة خطة الإدارة'), 'مهمة المدير المباشر داخل إدارته');
  // مهام حساب في الإدارة الأخرى (نفس القطاع) — كانت تظهر كلها قبل الإصلاح
  assert.equal(titles.includes('إعداد وثيقة المتطلبات التفصيلية'), false, 'مهمة زميل من إدارة أخرى');
  assert.equal(titles.includes('مراجعة مخرجات المرحلة الأولى'), false);
  const assignees = board.map((b) => b.userId);
  assert.equal(assignees.includes(U['demo.employee'].id), false, 'ولا يظهر الشخص نفسه في اللوحة');
  assert.equal(titles.includes('مهمة في قطاع الاستشارات'), false, 'ولا مهمة من قطاع آخر');
});

test('حساب بلا سجل موظف: إدارته مجهولة ⟵ يُستبعد ولا يُدرج (قرار موثَّق)', async () => {
  const cons = await db.get("SELECT id FROM app_user WHERE username = 'demo.consultant'");
  assert.equal((await db.get('SELECT employee_id FROM app_user WHERE id = ?', [cons.id])).employee_id, null,
    'المقدّمة: الحساب غير مربوط بسجل موظف');
  const board = await tasks.teamTasks(U['demo.deptmgr']);
  assert.equal(board.some((b) => b.userId === cons.id), false, 'المجهول خارج اللوحة');
  // وهي مهمة قائمة فعلاً ومفتوحة — الغياب ترشيح لا انعدام
  const open = await db.get("SELECT id FROM task WHERE assignee_user_id = ? AND status <> 'DONE' AND deleted_at IS NULL", [cons.id]);
  assert.ok(open, 'له مهمة مفتوحة بالفعل');
});

test('مهام فريقي: نطاق القطاع ونطاق الشركة كما كانا حرفياً', async () => {
  const lead = await tasks.teamTasks(U['demo.sectorlead']);
  const leadTitles = lead.flatMap((b) => b.tasks.map((t) => t.title));
  assert.ok(leadTitles.includes('إعداد وثيقة المتطلبات التفصيلية'), 'قائد القطاع يرى مهام قطاعه كلها');
  assert.ok(leadTitles.includes('مراجعة خطة الإدارة'));
  assert.equal(leadTitles.includes('مهمة في قطاع الاستشارات'), false, 'ولا يرى قطاعاً آخر');

  const admin = await tasks.teamTasks(U['demo.admin']);
  const adminTitles = admin.flatMap((b) => b.tasks.map((t) => t.title));
  assert.ok(adminTitles.includes('مهمة في قطاع الاستشارات'), 'نطاق الشركة يرى القطاعات كلها');
  for (const t of leadTitles) assert.ok(adminTitles.includes(t), 'ولا ينقص عمّا يراه قائد القطاع');
});

test('مدير إدارة بلا سجل موظف: لوحة مهام فارغة — لا لوحة القطاع', async () => {
  assert.deepEqual(await tasks.teamTasks(U.blind), []);
  assert.ok((await tasks.teamTasks(U['demo.sectorlead'])).length > 0, 'واللوحة القطاعية مأهولة — فالفراغ قرار');
});

test('الموظف العادي ما زال محجوباً عن لوحة الفريق', async () => {
  await assert.rejects(() => tasks.teamTasks(U['demo.employee']), (e) => e.code === 'forbidden');
});

// ═════════════ (٦) كتابات التثبيت: مدقَّقة وغير مكرَّرة ═════════════

test('كل كتابة في تثبيت الإدارات تركت سطر تدقيق باسم من نفّذها', async () => {
  const admin = await db.get("SELECT id FROM app_user WHERE username = 'demo.admin'");
  const deps = await db.all("SELECT * FROM audit_log WHERE resource = 'department' AND action = 'create' ORDER BY at, id");
  assert.equal(deps.length, DEMO_DEPT_COUNT, 'سطر لكل إدارة');
  assert.ok(deps.every((r) => r.sector_id === 'SOLUTIONS' && r.user_id === admin.id));

  const empIds = (await db.all('SELECT id FROM employee WHERE department_id IS NOT NULL AND deleted_at IS NULL')).map((r) => r.id);
  for (const eid of empIds) {
    const rows = await db.all("SELECT * FROM audit_log WHERE resource = 'employee' AND resource_id = ? AND action = 'create'", [eid]);
    assert.equal(rows.length, 1, 'إنشاء كل موظف مدقَّق مرة واحدة');
  }
  // الربط يُدقَّق على الطرفين: سجل الموظف وحساب الدخول
  const linkRows = await db.all("SELECT * FROM audit_log WHERE resource = 'app_user' AND resource_id = ?",
    [U['demo.deptmgr'].id]);
  assert.ok(linkRows.length >= 1, 'ربط الحساب مدقَّق');
  assert.ok(linkRows.some((r) => JSON.parse(r.detail_json || '{}').linked_employee_id === U['demo.deptmgr'].employee_id));
});

test('إعادة تشغيل التثبيت لا تُنشئ إدارة ثانية ولا سطر تدقيق جديداً', async () => {
  const before = {
    deps: (await db.all('SELECT id FROM department WHERE deleted_at IS NULL')).length,
    emps: (await db.all('SELECT id FROM employee WHERE deleted_at IS NULL')).length,
    audit: (await db.all('SELECT id FROM audit_log')).length,
  };
  const again = await seedMod.seedDemoOrg();
  assert.equal(again.linked, 0, 'لا ربط يُعاد');
  assert.equal((await db.all('SELECT id FROM department WHERE deleted_at IS NULL')).length, before.deps);
  assert.equal((await db.all('SELECT id FROM employee WHERE deleted_at IS NULL')).length, before.emps);
  assert.equal((await db.all('SELECT id FROM audit_log')).length, before.audit, 'ولا سطر تدقيق بلا تغيير حقيقي');
  // والحساب ما زال مربوطاً بالموظف نفسه بعد إعادة التشغيل
  const acc = await db.get("SELECT employee_id FROM app_user WHERE username = 'demo.deptmgr'");
  assert.equal(acc.employee_id, U['demo.deptmgr'].employee_id);
});
