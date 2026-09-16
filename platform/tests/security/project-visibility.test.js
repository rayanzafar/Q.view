// ── رؤية المشاريع بعد قصّ نطاق الإدارة (النصف الباقي من D15، v5.9) ────────────
//
// «مدير الإدارة يرى مشاريع إدارته لا قطاعه» — نظير قلب رؤية الفرص، لكن للمشاريع. وكانت قائمةُ
// المشاريع تفشل مفتوحةً إلى القطاع كله لمدير الإدارة (deltCol مؤجَّل حتى تُنسَب المحفظة). بعد
// التسكين الرجعي (backfill-project-departments.js) صار كلُّ سطح قراءةٍ للمشروع يُقصّ على إدارته
// (انتماءً وقيادةً) + أيتام قطاعه، فتُحاذي القائمةُ الصفَّ من كل باب: القائمة، والصفّ المباشر،
// والمساعد، والتصدير. والحدود المحروسة: مشروعُ إدارةٍ شقيقة لا يُعرَض ولا يُفتح، وقطاعٌ آخر يُردّ.
//
// والفحوص تُبنى بجلساتٍ حقيقية (`resolveUser`) لا بكائناتٍ مركّبةٍ باليد — كما في
// tests/security/opportunity-visibility.test.js و access-hardening-batchA.test.js: المجموعات
// التي يقوم عليها القرار (إداراته، ما يقوده، مشاريع تسكينه) تُحلّ عند الجلسة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-prjvis-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, prj, assistant, getAdapter, resolveUser, can, staffingRoster, clientOverview;
const T = '2026-08-06T09:00:00Z';
const YEAR = 2026;

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const listedIds = async (uid) => (await prj.listProjects(await sess(uid))).map((p) => p.id).sort();
const exportedNames = async (uid) => (await getAdapter('projects').fetchRows(await sess(uid), {})).map((r) => r.name_ar).sort();

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  can = rbac.can;
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  prj = await import('../../src/modules/pmo/projects.js');
  assistant = await import('../../src/core/ai/assistant.js');
  ({ getAdapter } = await import('../../src/modules/io/engine.js'));
  ({ staffingRoster } = await import('../../src/modules/org/org.js'));
  ({ clientOverview } = await import('../../src/modules/clients/clients.js'));

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'SOL2', name_ar: 'قطاع آخر', kind: 'delivery', active: 1, created_at: T });

  const mkUser = (id, role, scope, sector = 'SOL') => db.insert('app_user', {
    id, username: id, name_ar: 'حساب ' + id, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  const mkEmp = async (id, uid, dept, sector = 'SOL') => {
    await db.insert('employee', { id, user_id: uid, name_ar: 'موظف ' + id, sector_id: sector,
      department_id: dept, job_title: 'مستشار', active: 1, created_at: T });
    await db.update('app_user', uid, { employee_id: id });
  };

  await mkUser('u_dm', 'department_manager', 'sector');  // مديرة الإدارة: تنتمي D_A وتقود D_A وD_M
  await mkUser('u_lead', 'sector_lead', 'sector');       // قائد القطاع — يجب ألّا يمسّه شيء
  await mkUser('u_con', 'consultant', 'own');            // استشاري مسكَّن على مشروع إدارةٍ واحد
  await mkUser('u_emp', 'employee', 'own');              // موظف بلا تسكين — لا يرى مشروعاً

  // الإدارات: D_A تنتمي إليها مديرة الإدارة وتقودها، D_M تقودها ولا تنتمي، D_B إدارةٌ شقيقة
  // في القطاع نفسه لا تقودها، D_BD إدارة الاستشاري المسكَّن.
  await db.insert('department', { id: 'D_A', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_M', sector_id: 'SOL', name_ar: 'إدارة يقودها لا ينتمي', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_B', sector_id: 'SOL', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await db.insert('department', { id: 'D_BD', sector_id: 'SOL', name_ar: 'إدارة الاستشاري', active: 1, created_at: T });

  await mkEmp('e_dm', 'u_dm', 'D_A');
  await mkEmp('e_lead', 'u_lead', null);
  await mkEmp('e_con', 'u_con', 'D_BD');
  await mkEmp('e_emp', 'u_emp', 'D_BD');

  const mkPrj = (id, name, dept, sector = 'SOL') => db.insert('project', {
    id, name_ar: name, sector_id: sector, department_id: dept, status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });

  await mkPrj('prj_mine', 'مشروع إدارتها', 'D_A');       // إدارة انتمائها
  await mkPrj('prj_managed', 'مشروع تقوده', 'D_M');      // إدارة تقودها لا تنتمي
  await mkPrj('prj_sibling', 'مشروع إدارة شقيقة', 'D_B'); // إدارةٌ أخرى في قطاعها — محجوب
  await mkPrj('prj_orphan', 'مشروع يتيم في القطاع', null); // بلا إدارة في قطاعها — يظهر ويُفتح
  await mkPrj('prj_farsect', 'مشروع قطاع آخر', null, 'SOL2'); // قطاع آخر — يُردّ من كل باب

  // الاستشاري مسكَّن على مشروعٍ واحد فقط (إدارة الابتكار) — نطاقه «مشروع» يُبنى من التسكين.
  await db.insert('allocation', { id: 'alc_con', employee_id: 'e_con', project_id: 'prj_mine',
    sector_id: 'SOL', type: 'member', monthly_json: '{"8":1}', year: YEAR, source: 'manual', created_at: T });

  // ── عميلٌ بعقودٍ على مشاريعَ من إدارات/قطاعات مختلفة، وموظفٌ في إدارة المديرة مسكَّنٌ على
  //    مشروع إدارةٍ شقيقة — لفحص تسريبَي «اسم المشروع» على العقد وفي كشف التسكين (v5.9) ──
  await db.insert('client', { id: 'c1', name_ar: 'عميل الاختبار', active: 1, created_at: T });
  for (const pid of ['prj_mine', 'prj_sibling', 'prj_farsect']) await db.update('project', pid, { client_id: 'c1' });
  const mkCon = (id, pid, sector) => db.insert('contract', { id, client_id: 'c1', project_id: pid,
    sector_id: sector, value_halalas: 500000, status: 'ACTIVE', created_at: T });
  await mkCon('con_mine', 'prj_mine', 'SOL');       // في نطاقها — يُعرَض اسمُه
  await mkCon('con_sib', 'prj_sibling', 'SOL');     // إدارةٌ شقيقة — يُطوى اسمُه وتبقى قيمتُه
  await mkCon('con_far', 'prj_farsect', 'SOL2');    // قطاعٌ آخر — يُطوى اسمُه وتبقى قيمتُه

  await db.insert('employee', { id: 'e_a', name_ar: 'موظف إدارتها', sector_id: 'SOL',
    department_id: 'D_A', job_title: 'مستشار', active: 1, created_at: T });
  const mkAlloc = (id, pid) => db.insert('allocation', { id, employee_id: 'e_a', project_id: pid,
    sector_id: 'SOL', type: 'member', monthly_json: '{"8":0.5}', year: YEAR, source: 'manual', created_at: T });
  await mkAlloc('alc_a_mine', 'prj_mine');          // مشروع إدارتها — اسمُه يظهر في كشفها
  await mkAlloc('alc_a_sib', 'prj_sibling');        // مشروع إدارةٍ شقيقة — اسمُه يُطوى ويبقى الحِمل
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── مديرة الإدارة: إدارتها (انتماءً وقيادةً) + أيتام قطاعها، لا القطاع كله ─────
test('مديرة الإدارة ترى مشاريع إدارتها (انتماءً وقيادةً) + أيتام قطاعها — لا القطاع كله', async () => {
  assert.deepEqual(await listedIds('u_dm'), ['prj_managed', 'prj_mine', 'prj_orphan'],
    'قائمتها ليست: إدارتها + ما تقوده + أيتام قطاعها');
});

test('مشروع إدارةٍ شقيقة في قطاعها: لا في القائمة، ويُردّ بالعنوان المباشر، وبالمساعد، وفي التصدير', async () => {
  const dm = await sess('u_dm');
  // القائمة أخفته
  assert.ok(!(await listedIds('u_dm')).includes('prj_sibling'), 'مشروع الإدارة الشقيقة ظهر في القائمة');
  // العنوان المباشر يردّه
  await assert.rejects(() => prj.getProject(dm, 'prj_sibling'), (e) => e.status === 403,
    'القائمة أخفته والعنوان المباشر فتحه — تسريب من الباب الخلفي');
  // فحص الصفّ نفسه (list==row)
  const row = await db.get('SELECT * FROM project WHERE id = ?', ['prj_sibling']);
  assert.equal(can(dm, 'read', 'project', row), false, 'قرأ صفَّ إدارةٍ شقيقة');
  // المساعد: المعرّف المباشر والبحث بالاسم كلاهما لا يجده
  const byId = await assistant.resolveRef(dm, 'project', 'prj_sibling');
  assert.equal(byId.total, 0, 'المساعد فتح مشروع إدارةٍ شقيقة بالمعرّف المباشر');
  const opts = await assistant.optionsFor(dm, 'project');
  assert.ok(!opts.options.some((o) => o.id === 'prj_sibling'), 'قائمة اختيار المساعد سرّبت مشروع إدارةٍ شقيقة');
  // التصدير: صفوفه لا تحمله
  assert.ok(!(await exportedNames('u_dm')).includes('مشروع إدارة شقيقة'), 'صفوف التصدير حملت مشروع إدارةٍ شقيقة');
});

test('ومشروعُ قطاعٍ آخر يُردّ مطلقاً — قائمةً وصفّاً', async () => {
  const dm = await sess('u_dm');
  assert.ok(!(await listedIds('u_dm')).includes('prj_farsect'), 'مشروع قطاعٍ آخر ظهر في قائمتها');
  await assert.rejects(() => prj.getProject(dm, 'prj_farsect'), (e) => e.status === 403, 'مشروع قطاعٍ آخر فُتح بالعنوان');
  const row = await db.get('SELECT * FROM project WHERE id = ?', ['prj_farsect']);
  assert.equal(can(dm, 'read', 'project', row), false, 'قرأ صفَّ مشروعٍ في قطاعٍ آخر');
});

// ── الأيتام: القائمة تُحاذي الصفَّ ────────────────────────────────────────────
test('اليتيم في قطاع مديرة الإدارة: يُعرَض في القائمة **ويُفتح** (list==row)', async () => {
  const dm = await sess('u_dm');
  assert.ok((await listedIds('u_dm')).includes('prj_orphan'), 'اليتيم غائب عن قائمتها');
  const one = await prj.getProject(dm, 'prj_orphan');
  assert.equal(one.id, 'prj_orphan', 'يُعرَض في القائمة ولا يُفتح — عين التناقض المعكوس');
  const row = await db.get('SELECT * FROM project WHERE id = ?', ['prj_orphan']);
  assert.equal(can(dm, 'read', 'project', row), true, 'صفُّ اليتيم لا يُقرأ — القائمة والصفّ افترقا');
});

test('وما يُعرَض في قائمة مديرة الإدارة يُفتح كلُّه — لا صفَّ يُعرَض ويُردّ', async () => {
  const dm = await sess('u_dm');
  for (const id of await listedIds('u_dm')) {
    await assert.doesNotReject(() => prj.getProject(dm, id), `«${id}» يُعرَض في قائمتها ولا يُفتح`);
  }
});

// ── قائد القطاع: القرار ضيّق غيره ولم يمسّه ──────────────────────────────────
test('قائد القطاع يرى مشاريع قطاعه كلها — لم يتحرك شيء فوق مستوى الإدارة', async () => {
  const ids = await listedIds('u_lead');
  for (const id of ['prj_mine', 'prj_managed', 'prj_sibling', 'prj_orphan']) {
    assert.ok(ids.includes(id), `قائد القطاع فقد «${id}» من قائمته`);
  }
  assert.ok(!ids.includes('prj_farsect'), 'قائد القطاع رأى مشروع قطاعٍ آخر');
});

// ── الاستشاري/الموظف: ما سُكِّنا عليه وحده ────────────────────────────────────
test('الاستشاري يرى المشروع الذي سُكِّن عليه وحده — لا مشاريع إدارته ولا قطاعه', async () => {
  assert.deepEqual(await listedIds('u_con'), ['prj_mine'], 'قائمة الاستشاري ليست مشروعه المسكَّن وحده');
  const con = await sess('u_con');
  await assert.doesNotReject(() => prj.getProject(con, 'prj_mine'), 'المسكَّن لا يفتح مشروعه');
  await assert.rejects(() => prj.getProject(con, 'prj_sibling'), (e) => e.status === 403, 'الاستشاري فتح مشروعاً لم يُسكَّن عليه');
  await assert.rejects(() => prj.getProject(con, 'prj_orphan'), (e) => e.status === 403, 'الاستشاري فتح يتيماً لم يُسكَّن عليه');
});

test('الموظف بلا تسكين لا يرى مشروعاً — نطاق «مشروع» بلا عضوية = لا صفوف', async () => {
  assert.deepEqual(await listedIds('u_emp'), [], 'الموظف بلا تسكين رأى مشاريع');
  const emp = await sess('u_emp');
  await assert.rejects(() => prj.getProject(emp, 'prj_mine'), (e) => e.status === 403, 'الموظف بلا تسكين فتح مشروعاً');
});

// ── التصدير يطابق القائمة صفّاً بصفّ ──────────────────────────────────────────
test('صفوف تصدير مديرة الإدارة = قائمتها بالضبط', async () => {
  assert.deepEqual(await exportedNames('u_dm'), ['مشروع إدارتها', 'مشروع تقوده', 'مشروع يتيم في القطاع'],
    'التصدير والقائمة افترقا — بابان لنفس البيانات');
});

// ── تسريبا الاسم اللذان كشفتهما المراجعة العدائية: أرقامٌ للجميع، أسماءٌ لأهلها ─
// عقدٌ على مشروعٍ خارج نطاق القارئ كان يُعرَض اسمُه في صفحة العميل، وموظفٌ في إدارة القارئ مسكَّنٌ
// على مشروع إدارةٍ شقيقة كان يُعرَض اسمُ مشروعه في كشف التسكين — تسريبا اسمٍ يناقضان القائمةَ
// والصفّ (يُعرَض ما لا يُفتح). القيمةُ والحِملُ يبقيان (رقمٌ للجميع)، والاسمُ يُطوى (لأهله وحدهم).
test('عميل-٣٦٠: قيمةُ العقد تبقى للجميع واسمُ مشروعٍ خارج نطاق المديرة يُطوى — رقمٌ بلا اسم', async () => {
  const o = await clientOverview(await sess('u_dm'), 'c1');
  assert.equal(o.contracts.length, 3, 'عقدٌ اختفى — قُصّت الأرقام لا الأسماء');
  const byPid = Object.fromEntries(o.contracts.map((t) => [t.project_id, t]));
  assert.equal(byPid.prj_mine.project_name_ar, 'مشروع إدارتها', 'طُوي اسمُ مشروعٍ في نطاقها خطأً');
  assert.equal(byPid.prj_sibling.project_name_ar, null, 'تسرّب اسمُ مشروع إدارةٍ شقيقة على العقد');
  assert.equal(byPid.prj_farsect.project_name_ar, null, 'تسرّب اسمُ مشروع قطاعٍ آخر على العقد');
  assert.ok(byPid.prj_sibling.value_halalas > 0, 'قُصّت قيمةُ العقد — قُصّ الرقم لا الاسم');
});

test('كشف التسكين: اسمُ مشروعٍ خارج نطاق المديرة يُطوى ويبقى الحِمل — رقمٌ بلا اسم', async () => {
  const { roster } = await staffingRoster(await sess('u_dm'), { year: YEAR, month: 8 });
  const row = roster.find((e) => e.id === 'e_a');
  assert.ok(row, 'موظفُ إدارتها غائبٌ عن الكشف');
  assert.equal(row.projects.length, 2, 'صفّا التسكين لم يبقيا — الحِملُ تغيّر');
  const names = row.projects.map((p) => p.name);
  const pids = row.projects.map((p) => p.projectId);
  assert.ok(names.includes('مشروع إدارتها'), 'طُوي اسمُ مشروعٍ في نطاقها');
  assert.ok(!names.includes('مشروع إدارة شقيقة'), 'تسرّب اسمُ مشروع إدارةٍ شقيقة عبر الكشف');
  assert.ok(!pids.includes('prj_sibling'), 'تسرّب معرّفُ مشروع إدارةٍ شقيقة عبر الكشف');
  const folded = row.projects.find((p) => p.projectId === null);
  assert.ok(folded && Object.keys(folded.months).length > 0, 'ضاع حِملُ المشروع المطويّ — قُصّ الرقم لا الاسم');
});

test('تصدير التسكين: اسمُ مشروعٍ خارج نطاق المديرة يُطوى إلى «—» — الباب الخلفي مغلقٌ كالكشف', async () => {
  // نطاقُ «التسكين» يتراجع إلى القطاع لمدير الإدارة، فكان تصديرُ التسكين يُسرِّب اسمَ مشروع إدارةٍ
  // شقيقةٍ لا يظهر في القائمة ولا في الكشف — توأمُ تسريب الكشف عبر بابٍ آخر (كشفته المراجعة العدائية).
  const projects = (await getAdapter('staffing').fetchRows(await sess('u_dm'), {})).map((r) => r.project);
  assert.ok(projects.length > 0, 'تصديرُ التسكين فارغٌ — لا يُختبر شيء');
  assert.ok(!projects.includes('مشروع إدارة شقيقة'), 'تسرّب اسمُ مشروع إدارةٍ شقيقة عبر تصدير التسكين');
  assert.ok(projects.includes('مشروع إدارتها'), 'طُوي اسمُ مشروعٍ في نطاقها في التصدير');
  assert.ok(projects.includes('—'), 'المشروع خارج النطاق لم يُطوَ إلى «—» في التصدير');
});
