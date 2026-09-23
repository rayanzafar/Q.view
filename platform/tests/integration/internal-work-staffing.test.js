// ── تسكينٌ على عمل داخلي، لا على مشروعٍ وحده ─────────────────────────────────
// «في التسكين مو شرط يكون على مشروع … لما أضغط على نسبة الشخص في شهر سابع، طريقة التسكين لازم
//  تكون مرة سهلة ليّ كمدير إدارة. وبرضو ممكن أسكّن على مشروع أو أسكّن على تطوير أعمال ·
//  تطوير منتجات · إدارة مشاريع» — بلسان المالك.
//
// وأثقل ما يُحرَس هنا **أن السهولة لا تفتح باباً**: مدير الإدارة يُسكّن من يديره بضغطة، ولا
// يمسّ من هو خارج إدارته — «مو أي أحد يسكّن أي أحد في أي مكان». والحكم واحد للتسكين ولتعديل
// خليّة الشهر ولإزالة السطر، فلا يفترق بابٌ عن باب.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-bucket-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, P;
const T = '2026-03-01T00:00:00Z';
const YEAR = new Date().getUTCFullYear();
const U = (id, role, scope, sector, deps) => ({ id, username: id, role_id: role, scope, sector_id: sector,
  departmentIds: deps ? new Set(deps) : new Set(), projectIds: new Set(), teamIds: new Set() });
const admin = U('u_admin', 'admin', 'company', 'SOL');
let mgr, stranger;
const ctx = (u) => ({ user: u, ip: '1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  P = await import('../../src/modules/pmo/projects.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_mgr', username: 'mgr', role_id: 'department_manager', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_str', username: 'str', role_id: 'department_manager', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_A', sector_id: 'SOL', name_ar: 'إدارة أولى', manager_user_id: 'u_mgr', active: 1, created_at: T });
  await db.insert('department', { id: 'D_B', sector_id: 'SOL', name_ar: 'إدارة ثانية', manager_user_id: 'u_str', active: 1, created_at: T });
  await db.insert('employee', { id: 'E1', name_ar: 'موظف الإدارة الأولى', sector_id: 'SOL', department_id: 'D_A', active: 1, created_at: T });
  await db.insert('employee', { id: 'E2', name_ar: 'موظف الإدارة الثانية', sector_id: 'SOL', department_id: 'D_B', active: 1, created_at: T });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع قائم', sector_id: 'SOL', status: 'IN_PROGRESS', created_at: T });
  // نطاق الإدارات يُقرأ من مجموعة الإدارات على المستخدم كما يبنيها سياق الطلب
  mgr = U('u_mgr', 'department_manager', 'own', 'SOL', ['D_A']);
  stranger = U('u_str', 'department_manager', 'own', 'SOL', ['D_B']);
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('البنود الثلاثة التي سمّاها المالك — لا أكثر ولا مفتاحاً مخترعاً', async () => {
  assert.deepEqual(P.WORK_BUCKETS, ['bd', 'product', 'pmo']);
  assert.equal(P.isWorkBucket('bd'), true);
  assert.equal(P.isWorkBucket('anything'), false);
});

test('مدير الإدارة يُسكّن من يديره على «تطوير أعمال» بلا مشروع — والسطر يحمل اسمه العربي', async () => {
  const r = await P.assignInternalWork(ctx(mgr), { employeeId: 'E1', bucket: 'bd', pct: 40, fromMonth: 7, year: YEAR });
  assert.equal(r.label, 'تطوير أعمال');
  const a = await db.get('SELECT * FROM allocation WHERE id = ?', [r.id]);
  assert.equal(a.project_id, null, 'بلا مشروع — «مو شرط يكون على مشروع»');
  assert.equal(a.work_bucket, 'bd');
  assert.equal(a.project_name, 'تطوير أعمال', 'والاسم المعروض من المعجم لا من إدخال حرّ');
  assert.equal(a.sector_id, 'SOL', 'وقطاعه — فيقرأه كشف التسكين المرشَّح بالقطاع');
  const mj = JSON.parse(a.monthly_json);
  assert.equal(mj['7'], 0.4, 'يبدأ من الشهر المضغوط');
  assert.equal(mj['6'], undefined, 'ولا يكتب ماضياً لم يُطلب');
  assert.equal(mj['12'], 0.4, 'ويمتد إلى آخر السنة');
});

test('ولا يُسكّن من هو خارج إدارته — «مو أي أحد يسكّن أي أحد في أي مكان»', async () => {
  await assert.rejects(() => P.assignInternalWork(ctx(stranger), { employeeId: 'E1', bucket: 'pmo', pct: 50 }),
    /خارج من تديرهم/);
  assert.equal(await db.get("SELECT id FROM allocation WHERE employee_id = 'E1' AND work_bucket = 'pmo' AND deleted_at IS NULL"),
    undefined, 'ولم يُكتب شيء');
});

test('وبندٌ غير معروف يُرَدّ — لا مفتاح يدخل القاعدة كما وصل', async () => {
  await assert.rejects(() => P.assignInternalWork(ctx(admin), { employeeId: 'E1', bucket: 'whatever', pct: 10 }),
    /اختر بند العمل الداخلي/);
});

test('والبند الواحد لا يتكرّر في السنة — سطران بنفس الاسم يُجمعان فتُقرأ نسبة مضاعفة', async () => {
  await assert.rejects(() => P.assignInternalWork(ctx(mgr), { employeeId: 'E1', bucket: 'bd', pct: 20, year: YEAR }),
    /عدّل نسبته بدل إضافته/);
});

test('تعديل خليّة شهر على تسكين داخلي يمرّ لمن يدير صاحبه ويُرَدّ على غيره', async () => {
  const a = await db.get("SELECT id FROM allocation WHERE employee_id = 'E1' AND work_bucket = 'bd' AND deleted_at IS NULL");
  const out = await P.setAllocationCell(ctx(mgr), a.id, 8, 75);
  assert.equal(out.pct, 75);
  assert.equal(JSON.parse((await db.get('SELECT monthly_json FROM allocation WHERE id = ?', [a.id])).monthly_json)['8'], 0.75);
  await assert.rejects(() => P.setAllocationCell(ctx(stranger), a.id, 8, 10), /لمن يدير صاحبه/);
});

test('وإزالة التسكين الداخلي لا تسقط لغياب مشروعٍ لا وجود له', async () => {
  const r = await P.assignInternalWork(ctx(admin), { employeeId: 'E2', bucket: 'product', pct: 30, year: YEAR });
  const out = await P.unassignEmployee(ctx(admin), r.id);
  assert.ok(out && 'allocation' in out, 'يعود سطر التسكين لا لوحة مشروع');
  assert.ok((await db.get('SELECT deleted_at FROM allocation WHERE id = ?', [r.id])).deleted_at);
});

test('وتسكين المشروع يبقى محكوماً بصلاحية إدارته لا بمِلك أمر الموظف', async () => {
  const a = await P.assignEmployee(ctx(admin), 'P1', { employeeId: 'E1', pct: 50, year: YEAR });
  const allocId = a.assigned.find((x) => x.employee_id === 'E1').id;
  const viewer = U('u_view', 'viewer', 'sector', 'SOL');
  await assert.rejects(() => P.setAllocationCell(ctx(viewer), allocId, 5, 10), /صلاحية إدارة المشروع/);
});

test('والعمل الداخلي يظهر في كشف التسكين باسمه — وإلا قُرئ صاحبه «بلا تسكين» وهو مشغول', async () => {
  const { staffingRoster } = await import('../../src/modules/org/org.js');
  const { roster } = await staffingRoster(admin, {});
  const e1 = roster.find((e) => e.id === 'E1');
  assert.ok(e1, 'الموظف في الكشف');
  const bd = e1.projects.find((p) => p.name === 'تطوير أعمال');
  assert.ok(bd, 'وبنده الداخلي مقروء باسمه العربي');
  assert.equal(bd.projectId, null, 'بلا مشروع يُربط به — فلا يدخل المحفظة');
  assert.ok(e1.months[6] > 0, 'ووقته في يوليو محجوز فعلاً في اللوحة');
});

test('وصفحة التسكين تعرض البنود وسنة اللوحة للمتصفّح — لا وعدٌ في الخدمة بلا موضعٍ يستعمله', async () => {
  const { staffingPage } = await import('../../src/web/views/people.js');
  const html = await staffingPage(admin, {});
  assert.match(html, /workBuckets:/);
  assert.match(html, /تطوير منتجات/);
  assert.match(html, /إدارة مشاريع/);
  assert.match(html, /staffYear:/);
});
