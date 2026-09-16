// ── مشروعٌ تعمل عليه أكثر من إدارة (v5.27 — ADR-0008 على خطى ADR-0006) ────────
//
// «هذان المشروعان مشتركان بين إدارة البيانات والذكاء الاصطناعي والمدن الذكية — لازم في
// المشاريع تطلع، والتسكين يطلع فيها بشكل صحيح، لأنه مشترك بين إدارتين» — بلسان المالك.
//
// وأدقّ ما يُحرَس: (١) ألّا يُحسب المشروع مرتين — المشاركة رؤيةٌ وعمل، والنسبة المالية على
// المسؤولة وحدها؛ (٢) أن يبقى مشروعُ إدارةٍ أخرى **بلا شراكة** مغلقاً كما كان (قرارٌ مثبَّت
// في list-and-row-agree)؛ (٣) وأن يظهر اسمُ المشروع المشترك في كشف التسكين لمدير الإدارة
// الشريكة بدل الطيّ — وهو عين الشرطات التي رآها المالك «شي غريب».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-prjpartners-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, projects, sync, org, remove;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL' };
const CTX = { user: ADMIN, ip: '1' };
// مديرا إدارتين حقيقيان بنطاق «إدارة» — كما يبنيهما سياق الطلب (المجموعة من انتمائه).
const mgr = (uid, dep) => ({ id: uid, username: uid, role_id: 'department_manager', scope: 'department',
  sector_id: 'SOL', department_id: dep, departmentIds: new Set([dep]), projectIds: new Set(),
  teamIds: new Set(), opportunityIds: new Set(), departmentGrants: [], managedDepartmentIds: new Set() });
const U_CITY = mgr('u_city', 'D_CITY');   // الإدارة المسؤولة عن المشروع
const U_AI = mgr('u_ai', 'D_AI');         // الإدارة المشاركة
const U_OTHER = mgr('u_other', 'D_OTHER'); // إدارة ثالثة لا علاقة لها

let PRJ;

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  projects = await import('../../src/modules/pmo/projects.js');
  sync = await import('../../src/modules/crm/opp-project-sync.js');
  org = await import('../../src/modules/org/org.js');
  remove = await import('../../src/core/lifecycle/remove.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });
  for (const [id, name] of [['D_CITY', 'إدارة المدن الذكية'], ['D_AI', 'إدارة الذكاء الاصطناعي والبيانات'], ['D_OTHER', 'إدارة ثالثة']]) {
    await db.insert('department', { id, sector_id: 'SOL', name_ar: name, active: 1, created_at: T });
  }
  // المديرون الثلاثة صفوفٌ حقيقية: سجل التدقيق يوثّق كاتبه بمفتاحٍ أجنبي لا باسمٍ حر.
  // (انتماء الإدارة يعيش في كائن الجلسة `departmentIds` — لا عمودَ إدارة على الحساب.)
  for (const uid of ['u_city', 'u_ai', 'u_other']) {
    await db.insert('app_user', { id: uid, username: uid, role_id: 'department_manager',
      scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  }
  await db.insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 9, is_won: 1, is_lost: 0 });
  await db.insert('client', { id: 'CL', name_ar: 'الهيئة الملكية', created_at: T });
  await db.insert('project', { id: 'p_bus', name_ar: 'مشروع النقل — الهيئة الملكية', sector_id: 'SOL',
    department_id: 'D_CITY', client_id: 'CL', status: 'IN_PROGRESS', created_at: T });
  PRJ = 'p_bus';
  // موظفان مسكَّنان على المشروع المشترك: واحد من الإدارة الشريكة وواحد من الثالثة —
  // كشفُ كلِّ مديرٍ يعرض موظفَه، والفرق كله في اسم المشروع: صريحٌ للشريك، مطويٌّ لسواه.
  await db.insert('employee', { id: 'E_AI', name_ar: 'يعقوب سيد', sector_id: 'SOL', department_id: 'D_AI', status: 'نشط', active: 1, created_at: T });
  await db.insert('employee', { id: 'E_OTHER', name_ar: 'موظف الإدارة الثالثة', sector_id: 'SOL', department_id: 'D_OTHER', status: 'نشط', active: 1, created_at: T });
  const Y = new Date().getUTCFullYear();
  for (const [aid, emp] of [['al_ai', 'E_AI'], ['al_other', 'E_OTHER']]) {
    await db.insert('allocation', { id: aid, employee_id: emp, person_name_ar: 'م', project_id: PRJ,
      project_name: 'مشروع النقل — الهيئة الملكية', sector_id: 'SOL', type: 'member', year: Y,
      monthly_json: JSON.stringify({ 2: 1, 3: 1 }), source: 'manual', created_at: T });
  }
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('قبل الشراكة: مشروع الإدارة الأخرى لا يُعرض ولا يُفتح — القرار المثبَّت لم يتحرّك', async () => {
  const listed = await projects.listProjects(U_AI, {});
  assert.ok(!listed.some((p) => p.id === PRJ), 'ظهر مشروعُ إدارةٍ أخرى بلا شراكة');
  await assert.rejects(() => projects.getProject(U_AI, PRJ), (e) => e.status === 403,
    'فُتح صفّياً ما لا تعرضه القائمة');
  // وفي كشف التسكين: موظفُه مسكَّن عليه والاسمُ مطويٌّ باسمه الصريح لا شرطةً صمّاء
  const roster = await org.staffingRoster(U_AI, {});
  const emp = roster.roster.find((e) => e.id === 'E_AI');
  assert.equal(emp.projects[0].name, 'مشروع خارج نطاقك', 'الطيّ صار مسمّى — لا «—» بعد اليوم');
  assert.equal(emp.projects[0].projectId, null, 'المعرّف يبقى مطوياً مع الاسم');
});

test('المشاركة تُكتب مجموعةً: المسؤولة تُستبعد، وتدخل الأثرَ، وتُمسح بإرسال []', async () => {
  const r = await projects.updateProject(CTX, PRJ, { partner_department_ids: ['D_AI', 'D_CITY', 'وهمية'] });
  assert.ok(r.id, 'التعديل يعيد المشروع');
  const parts = await projects.projectDepartments(PRJ);
  assert.deepEqual(parts.map((p) => p.department_id), ['D_AI'],
    'المسؤولة لا تُسجَّل مشاركةً والإدارة غير الموجودة تسقط');
  const aud = await db.get(`SELECT detail_json FROM audit_log WHERE resource='project' AND resource_id=? AND action='update' ORDER BY at DESC LIMIT 1`, [PRJ]);
  assert.deepEqual(JSON.parse(aud.detail_json).partner_department_ids, ['D_AI'], 'الشراكة تدخل سجلّ التدقيق');
  await projects.updateProject(CTX, PRJ, { partner_department_ids: [] });
  assert.deepEqual(await projects.projectDepartments(PRJ), [], 'المجموعة الفارغة تمسح');
  await projects.updateProject(CTX, PRJ, { partner_department_ids: ['D_AI'] });
});

test('«لازم في المشاريع تطلع»: قائمة الإدارة الشريكة تعرضه، والصفّ يُفتح، والثالثة محجوبة', async () => {
  const asAI = await projects.listProjects(U_AI, {});
  assert.ok(asAI.some((p) => p.id === PRJ), 'غاب عن قائمة الإدارة الشريكة — وهي تعمل عليه');
  assert.equal(asAI.filter((p) => p.id === PRJ).length, 1, 'تكرّر الصفّ فينتفخ كل جمع');
  const asCity = await projects.listProjects(U_CITY, {});
  assert.ok(asCity.some((p) => p.id === PRJ), 'غاب عن إدارته المسؤولة');
  const row = await projects.getProject(U_AI, PRJ);
  assert.deepEqual(row.partner_department_ids, ['D_AI'],
    'الصفّ يعود محمَّلاً بعلامة الشراكة — عليها يُبنى حجز حقول النسبة');
  const asOther = await projects.listProjects(U_OTHER, {});
  assert.ok(!asOther.some((p) => p.id === PRJ), 'ظهر لإدارةٍ لا علاقة لها');
  await assert.rejects(() => projects.getProject(U_OTHER, PRJ), (e) => e.status === 403);
});

test('«التسكين يطلع فيها بشكل صحيح»: الاسم صريحٌ للإدارة الشريكة ومطويٌّ مسمًّى لسواها', async () => {
  const roster = await org.staffingRoster(U_AI, {});
  const emp = roster.roster.find((e) => e.id === 'E_AI');
  assert.equal(emp.projects[0].name, 'مشروع النقل — الهيئة الملكية', 'اسم المشروع المشترك انكشف لشريكه');
  assert.equal(emp.projects[0].projectId, PRJ, 'والمعرّف معه — الصفّ يُفتح من الكشف');
  const other = await org.staffingRoster(U_OTHER, {});
  const emp2 = other.roster.find((e) => e.id === 'E_OTHER');
  assert.equal(emp2.projects[0].name, 'مشروع خارج نطاقك', 'الطيّ باقٍ لمن لا شراكة له');
});

test('محرِّر الشراكة يعدّل كل شيء إلا النسبة: الإدارة المسؤولة والمشارِكة محجوزتان', async () => {
  const r = await projects.updateProject({ user: U_AI, ip: '1' }, PRJ, { pm_name: 'مديرة المشروع' });
  assert.equal(r.pm_name, 'مديرة المشروع', 'حقول التشغيل مفتوحة لمحرِّر الشراكة');
  await assert.rejects(() => projects.updateProject({ user: U_AI, ip: '1' }, PRJ, { department_id: 'D_AI' }),
    /قرارُ الإدارة المسؤولة/, 'نقل المسؤولية ليس له');
  await assert.rejects(() => projects.updateProject({ user: U_AI, ip: '1' }, PRJ, { partner_department_ids: ['D_AI', 'D_OTHER'] }),
    /قرارُ الإدارة المسؤولة/, 'ولا توسيع الشراكة');
  // وإرسال القيم كما هي (الشاشة ترسل كل الحقول) لا يمنع حفظاً بريئاً
  const ok = await projects.updateProject({ user: U_AI, ip: '1' }, PRJ,
    { pm_name: 'مديرة', department_id: 'D_CITY', partner_department_ids: ['D_AI'] });
  assert.equal(ok.pm_name, 'مديرة', 'قيمٌ لم تتغيّر لا تُسقط الحفظ');
});

test('إعادة الإسناد تُخرج المشروع من نطاق ناقله بتأكيدٍ مختصر لا برسالة منعٍ كاذبة', async () => {
  await db.insert('project', { id: 'p_move', name_ar: 'مشروع للنقل', sector_id: 'SOL',
    department_id: 'D_CITY', status: 'IN_PROGRESS', created_at: T });
  const r = await projects.updateProject({ user: U_CITY, ip: '1' }, 'p_move', { department_id: 'D_AI' });
  assert.equal(r.movedOutOfReach, true, 'النقل نجح والقراءة الأخيرة لا تكذب عليه');
  assert.equal(r.department_id, 'D_AI');
});

test('الفوز ينسخ الشراكة: فرصةٌ مشتركة تربح مشروعاً مشتركاً — والمسؤولة لا تُنسخ', async () => {
  await db.insert('opportunity', { id: 'o_shared', title_ar: 'منظومة رصد دخول الحافلات', sector_id: 'SOL',
    department_id: 'D_CITY', stage_id: 'WON', value_halalas: 700000000, year: 2026, created_at: T });
  for (const d of ['D_AI', 'D_CITY']) {
    await db.insert('opportunity_department', { opportunity_id: 'o_shared', department_id: d, created_at: T }).catch(() => {});
  }
  const opp = await db.get('SELECT * FROM opportunity WHERE id = ?', ['o_shared']);
  const { project_id } = await sync.ensureProjectForWonOpportunity(CTX, opp);
  const parts = await projects.projectDepartments(project_id);
  assert.deepEqual(parts.map((p) => p.department_id), ['D_AI'],
    'المشروع وُلد بشراكة فرصته — والمسؤولة مستبعدة من النسخ');
});

test('والمرآة تتبع مشروعها شراكةً: مشروعٌ يُنشأ مشتركاً تولَد مرآته مشتركة وتلحق بتعديله', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'مشروع مشترك جديد', sector_id: 'SOL' });
  await db.run('UPDATE project SET department_id = ? WHERE id = ?', ['D_CITY', p.id]);
  await projects.updateProject(CTX, p.id, { partner_department_ids: ['D_AI'] });
  const prj = await db.get('SELECT source_opp_id FROM project WHERE id = ?', [p.id]);
  const mirrorParts = await db.all('SELECT department_id FROM opportunity_department WHERE opportunity_id = ?', [prj.source_opp_id]);
  assert.deepEqual(mirrorParts.map((r) => r.department_id), ['D_AI'],
    'شراكة المشروع انعكست على مرآته في الفرص — شاشتان لعملٍ واحد');
});

test('حذف المشروع يسحب صفوف شراكته — لا صف يتيم يبقى', async () => {
  const p = await projects.createProject(CTX, { name_ar: 'مشروع يُحذف', sector_id: 'SOL' });
  await projects.updateProject(CTX, p.id, { partner_department_ids: ['D_AI'] });
  assert.equal((await projects.projectDepartments(p.id)).length, 1);
  await remove.removeRecord(CTX, 'project', p.id, { reason: 'صفٌّ تجريبي للفحص' });
  const left = await db.all('SELECT department_id FROM project_department WHERE project_id = ?', [p.id]);
  assert.equal(left.length, 0, 'بقيت شراكةٌ لمشروعٍ محذوف');
});
