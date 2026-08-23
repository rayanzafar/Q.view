// تفصيل فريق القطاع لمركز القيادة (`sectorTeamDetail`) — ما تقرؤه النافذة المنبثقة عن الشخص.
//
// ما تحرسه الاختبارات:
//   ١) الأساس خطةُ التسكين وحدها: حِمل الفرص المبدئي يُفصَل في سطره ولا يدخل `planNow`.
//   ٢) النطاق من كشف التسكين نفسه: قارئٌ بنطاق «إدارة» يرى إدارته وحدها، واسمُ مشروعٍ خارج
//      نطاقه يُطوى «مشروع خارج نطاقك» بلا معرّف.
//   ٣) المهام بقواعد لوحة «مهام فريقي»: لا شخصية ولا معلَّقة ولا منتهية — والعناوين لمن يحقّ
//      له فتح الملف فحسب، والعدّ للجميع. ومن بلا حساب لا مهام له (فارغ لا صفر كاذب).
//   ٤) رابط الملف لا يُرسَم لمن يُردّ: `dossierOk` يتبع باب `personDossier` حرفياً.
//   ٥) التجميع بالإدارات القائمة فقط، و«بلا إدارة» سلّة مسمّاة في الذيل.
//   ٦) لا راتب يخرج من هنا مهما كان القارئ، ومن لا يقرأ الموظفين يُردّ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-teamdetail-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, run, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
const { sectorTeamDetail } = await import('../../src/modules/pmo/capacity.js');

const T = '2026-01-05T00:00:00Z';
const YEAR = 2026;
const MONTH = 3;                       // شهر ثابت كي لا يعتمد الاختبار على تاريخ تشغيله
const TODAY = '2026-03-10';
const U = (id, role, scope, extra = {}) => ({
  id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: 'SOLUTIONS', scope,
  projectIds: new Set(), teamIds: new Set(), ...extra,
});
const lead = U('u_lead', 'sector_lead', 'sector');
const deptReader = U('u_dept', 'dept_reader', 'sector', { departmentIds: new Set(['D_AI']) });
const peopleOnly = U('u_hr', 'people_only', 'sector');      // يقرأ الموظفين ولا يقرأ مهام الفريق
const analyst = U('u_an', 'sector_analyst', 'sector');      // لا يقرأ الموظفين أصلاً

before(async () => {
  for (const [id, ar] of [['dept_reader', 'قارئ إدارة'], ['people_only', 'قارئ أفراد'], ['sector_analyst', 'محلل قطاع']]) {
    await insert('role', { id, name_ar: ar, name_en: id, is_system: 0, created_at: T });
  }
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  await insert('department', { id: 'D_AI', sector_id: 'SOLUTIONS', name_ar: 'إدارة الذكاء الاصطناعي', active: 1, created_at: T });
  await insert('department', { id: 'D_CITY', sector_id: 'SOLUTIONS', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  for (const u of [lead, deptReader, peopleOnly, analyst]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  const grant = (role, resource, action, scope) =>
    run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', [role, resource, action, scope]);
  await grant('dept_reader', 'employee', 'read', 'department');
  await grant('dept_reader', 'project', 'read', 'department');
  await grant('dept_reader', 'opportunity', 'read', 'department');
  await grant('dept_reader', 'task', 'read', 'department');
  await grant('people_only', 'employee', 'read', 'sector');
  await grant('people_only', 'project', 'read', 'sector');
  await grant('sector_analyst', 'project', 'read', 'sector');
  await grant('sector_analyst', 'opportunity', 'read', 'sector');
  await initRbac();

  await insert('client', { id: 'C1', name_ar: 'أمانة المنطقة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0, color: '#94a3b8' });
  await insert('project', { id: 'P_AI', code: 'PRJ-1', name_ar: 'مشروع الذكاء', sector_id: 'SOLUTIONS', department_id: 'D_AI',
    client_id: 'C1', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });
  await insert('project', { id: 'P_CITY', code: 'PRJ-2', name_ar: 'مشروع المدن', sector_id: 'SOLUTIONS', department_id: 'D_CITY',
    client_id: 'C1', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });

  // أربعة موظفين: اثنان في الذكاء (أحدهما بلا تسكين)، وواحد في المدن فوق الطاقة، وواحد بلا إدارة ولا حساب
  for (const id of ['u_e1', 'u_e2']) {
    await insert('app_user', { id, username: id, name_ar: id, role_id: 'employee', sector_id: 'SOLUTIONS', scope: 'own',
      active: 1, created_at: T });
  }
  const emp = (id, name, dept, userId, salary) => insert('employee', { id, name_ar: name, sector_id: 'SOLUTIONS',
    department_id: dept, user_id: userId, job_title: 'استشاري', active: 1, salary_halalas: salary, created_at: T });
  await emp('E1', 'سارة العلي', 'D_AI', 'u_e1', 1_500_000);
  await emp('E4', 'نورة القحطاني', 'D_AI', null, 1_200_000);
  await emp('E2', 'خالد العتيبي', 'D_CITY', 'u_e2', 1_800_000);
  await emp('E3', 'فهد بلا إدارة', null, null, 900_000);
  for (const [id, empId] of [['u_e1', 'E1'], ['u_e2', 'E2']]) await run('UPDATE app_user SET employee_id = ? WHERE id = ?', [empId, id]);
  const alloc = (id, empId, pid, pname, mj) => insert('allocation', { id, employee_id: empId, person_name_ar: 'x', project_id: pid,
    project_name: pname, sector_id: 'SOLUTIONS', type: 'member', year: YEAR, monthly_json: JSON.stringify(mj), source: 'manual', created_at: T });
  await alloc('A1', 'E1', 'P_AI', 'مشروع الذكاء', { 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.6 });
  await alloc('A2', 'E1', 'P_CITY', 'مشروع المدن', { 3: 0.2 });           // خارج نطاق قارئ إدارة الذكاء
  await alloc('A3', 'E2', 'P_CITY', 'مشروع المدن', { 3: 1.2 });           // فوق الطاقة
  // حِمل فرصة مبدئي على سارة: ٣٠٪ — يقع على الشهر الجاري ولا يدخل الخطة
  await insert('opportunity', { id: 'O1', code: 'OPP-1', title_ar: 'فرصة منصة البيانات', sector_id: 'SOLUTIONS', department_id: 'D_AI',
    client_id: 'C1', stage_id: 'LEAD', owner_user_id: 'u_lead', value_halalas: 100_000_00, win_pct: 20, year: YEAR, created_at: T });
  await insert('membership', { id: 'M1', employee_id: 'E1', group_kind: 'opportunity', group_id: 'O1', role_in_group: 'member',
    allocation_pct: 30, status: 'ACTIVE', created_at: T });
  // مهام سارة: متأخرة، وقادمة، وشخصية (لا تُعدّ)، ومعلَّقة (لا تُعدّ)، ومنتهية (لا تُعدّ)
  const task = (id, title, extra) => insert('task', { id, title, sector_id: 'SOLUTIONS', assignee_user_id: 'u_e1',
    status: 'TODO', priority: 'P2', created_at: T, ...extra });
  await task('T_LATE', 'تحديث خطة الاختبار', { project_id: 'P_AI', due_date: '2026-03-01' });
  await task('T_SOON', 'إعداد محضر الاجتماع', { project_id: 'P_AI', due_date: '2026-03-20', status: 'IN_PROGRESS' });
  await task('T_PERSONAL', 'مهمة شخصية لا تُعدّ', { work_kind: 'personal' });
  await task('T_PENDING', 'مهمة معلَّقة لا تُعدّ', { approval_state: 'PENDING' });
  await task('T_DONE', 'مهمة منتهية', { status: 'DONE' });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const byId = (d, id) => d.people.find((p) => p.id === id);

test('قائد القطاع: الخطة وحدها أساساً، وحِمل الفرص سطرٌ مستقل، وأسماء المشاريع كاملة', async () => {
  const d = await sectorTeamDetail(lead, { sector: 'SOLUTIONS', year: YEAR, month: MONTH, todayDate: TODAY });
  assert.equal(d.basis, 'plan');
  assert.equal(d.currentMonth, MONTH);
  assert.equal(d.people.length, 4);
  const s = byId(d, 'E1');
  assert.equal(s.planNow, 70, 'الخطة: ٥٠٪ ذكاء + ٢٠٪ مدن — بلا الثلاثين من الفرصة');
  assert.equal(s.oppLoadPct, 30);
  assert.equal(s.currentUtil, 100, 'الكشف يضيف الفرصة على الشهر الجاري — ويبقى هنا للنافذة');
  assert.equal(s.next, 60);
  assert.equal(s.months[MONTH - 1], 70, 'شريط الأشهر خطةٌ صرفة');
  assert.deepEqual(s.projects.map((p) => [p.projectId, p.name]), [['P_AI', 'مشروع الذكاء'], ['P_CITY', 'مشروع المدن']]);
  assert.deepEqual(s.opportunities.map((o) => o.name), ['فرصة منصة البيانات']);
  assert.equal(s.userId, 'u_e1');
  assert.equal(s.dossierOk, true);
  const k = byId(d, 'E2');
  assert.equal(k.planNow, 120);
  assert.equal(d.over, 1);
  assert.equal(d.free, 2, 'نورة بلا تسكين وفهد بلا تسكين');
  for (const p of d.people) assert.ok(!('salary_halalas' in p), 'لا راتب في حمولة مركز القيادة');
});

test('المهام بقواعد لوحة الفريق: عدٌّ صادق وأبرزها بالاسم، ومن بلا حساب لا مهام له', async () => {
  const d = await sectorTeamDetail(lead, { sector: 'SOLUTIONS', year: YEAR, month: MONTH, todayDate: TODAY });
  const s = byId(d, 'E1');
  assert.deepEqual({ open: s.tasks.open, late: s.tasks.late, blocked: s.tasks.blocked }, { open: 2, late: 1, blocked: 0 });
  assert.deepEqual(s.tasks.top.map((t) => [t.title, t.late]), [['تحديث خطة الاختبار', true], ['إعداد محضر الاجتماع', false]]);
  assert.equal(byId(d, 'E3').tasks, null, 'بلا حساب دخول — لا عدّ ولا أسماء');
  assert.equal(byId(d, 'E3').dossierOk, false);
  assert.equal(byId(d, 'E2').tasks.open, 0);
});

test('قارئ إدارة: إدارته وحدها، والمشروع الشقيق يُطوى باسمٍ صريح بلا معرّف', async () => {
  const d = await sectorTeamDetail(deptReader, { sector: 'SOLUTIONS', year: YEAR, month: MONTH, todayDate: TODAY });
  assert.deepEqual(d.people.map((p) => p.id).sort(), ['E1', 'E4']);
  const s = byId(d, 'E1');
  assert.deepEqual(s.projects.map((p) => [p.projectId, p.name]), [['P_AI', 'مشروع الذكاء'], [null, 'مشروع خارج نطاقك']]);
  assert.equal(s.planNow, 70, 'الحِمل يبقى رقماً كاملاً وإن طُوي الاسم');
  assert.equal(s.dossierOk, true, 'سارة في إدارته — ملفها يُفتح');
  assert.deepEqual(d.departments.map((x) => [x.id, x.headcount]), [['D_AI', 2]]);
});

test('من يقرأ الأفراد ولا يقرأ مهام الفريق: العدّ يبقى والعناوين تُحجب ولا رابط ملف', async () => {
  const d = await sectorTeamDetail(peopleOnly, { sector: 'SOLUTIONS', year: YEAR, month: MONTH, todayDate: TODAY });
  const s = byId(d, 'E1');
  assert.equal(s.dossierOk, false);
  assert.equal(s.tasks.open, 2);
  assert.deepEqual(s.tasks.top, []);
});

test('التجميع بالإدارات القائمة، و«بلا إدارة» سلّةٌ مسمّاة في الذيل', async () => {
  const d = await sectorTeamDetail(lead, { sector: 'SOLUTIONS', year: YEAR, month: MONTH, todayDate: TODAY });
  assert.deepEqual(d.departments.map((x) => [x.id, x.name_ar, x.headcount, x.over, x.free]), [
    ['D_AI', 'إدارة الذكاء الاصطناعي', 2, 0, 1],
    ['D_CITY', 'إدارة المدن الذكية', 1, 1, 0],
    [null, 'بلا إدارة', 1, 0, 1],
  ]);
  assert.equal(d.departments[0].avgNow, 35, 'متوسط الإدارة: (٧٠ + ٠) ÷ ٢');
});

test('من لا يقرأ الموظفين يُردّ بجملة عربية لا بصفحة فارغة', async () => {
  await assert.rejects(() => sectorTeamDetail(analyst, { sector: 'SOLUTIONS', year: YEAR }), (e) => {
    assert.equal(e.status, 403);
    assert.match(e.message, /صلاحية/);
    return true;
  });
});
