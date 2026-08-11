// بطاقة «بانتظار اعتمادك» على «صفحتي» — لكل معتمِدٍ أياً كان دوره، بأزرار قرارٍ من مكانها،
// وفراغٍ معلن، وبلا أثرٍ لِما ينتظر غيرَه.
//
// وأثقل ما يُثبَت هنا KI-035: اعتمادٌ وُجِّه لشخصٍ دورُه لا يفتح شاشة «الاعتمادات» أصلاً
// (مدير مشاريع عُيِّن مسؤولَ إدارة) — كان الطلب يضيع إلى الأبد؛ الآن يراه على «صفحتي»
// ويحسمه منها، لأن الخادم نفسه (`actOnApproval`) يقبل المعتمَد الموجَّه إليه بلا بوابة دور.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-homeappr-'));
process.env.SANAD_DB = join(dir, 'h.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, engine, homePage;
const T = new Date().toISOString();
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });
const EMP = { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', employee_id: 'e_emp', projectIds: new Set(['PRJ']) };
const EMP2 = { id: 'u_emp2', username: 'emp2', name_ar: 'راكان عسيري', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', employee_id: 'e_emp2', projectIds: new Set(['PRJ']) };
const MGR = { id: 'u_mgr', username: 'mgr', name_ar: 'مدير الابتكار', role_id: 'department_manager',
  scope: 'department', sector_id: 'SOL', employee_id: 'e_mgr' };
// KI-035: دوره «مدير مشاريع» — خارج قائمة أدوار شاشة «الاعتمادات» — وهو مسؤول إدارةٍ فعلاً.
const PM = { id: 'u_pm', username: 'pm', name_ar: 'مدير المشاريع المعتمِد', role_id: 'project_manager',
  scope: 'project', sector_id: 'SOL', employee_id: 'e_pm' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
  engine = await import('../../src/modules/workflow/engine.js');
  ({ homePage } = await import('../../src/web/views/home.js'));

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  for (const [uid, name, role, scope, empId] of [
    ['u_mgr', 'مدير الابتكار', 'department_manager', 'department', 'e_mgr'],
    ['u_pm', 'مدير المشاريع المعتمِد', 'project_manager', 'project', 'e_pm'],
    ['u_emp', 'سجى لشكر', 'employee', 'own', 'e_emp'],
    ['u_emp2', 'راكان عسيري', 'employee', 'own', 'e_emp2'],
  ]) {
    await db.insert('app_user', { id: uid, username: uid, name_ar: name, role_id: role, scope,
      sector_id: 'SOL', employee_id: empId, active: 1, created_at: T });
  }
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL',
    manager_user_id: 'u_mgr', active: 1, created_at: T });
  await db.insert('department', { id: 'D_PMLED', name_ar: 'إدارة يقودها مدير مشاريع', sector_id: 'SOL',
    manager_user_id: 'u_pm', active: 1, created_at: T });
  for (const [empId, name, dept, uid] of [
    ['e_mgr', 'مدير الابتكار', 'D_INNO', 'u_mgr'], ['e_pm', 'مدير المشاريع المعتمِد', 'D_PMLED', 'u_pm'],
    ['e_emp', 'سجى لشكر', 'D_INNO', 'u_emp'], ['e_emp2', 'راكان عسيري', 'D_PMLED', 'u_emp2'],
  ]) {
    await db.insert('employee', { id: empId, name_ar: name, sector_id: 'SOL', department_id: dept,
      user_id: uid, active: 1, created_at: T });
  }
  await db.insert('project', { id: 'PRJ', name_ar: 'منصة تحليلات', sector_id: 'SOL', status: 'IN_PROGRESS',
    owner_user_id: 'u_mgr', created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

test('بطاقة المعتمِد: البند باسمه وطالبه وأزرار القرار — ومعالجها معالج شاشة الاعتمادات نفسه', async () => {
  await tasks.quickAddTask(ctx(EMP), { title: 'مهمة سرية للاعتماد', project_id: 'PRJ' });
  const html = await homePage(MGR, {});
  const main = mainOf(html);
  assert.ok(main.includes('بانتظار اعتمادك'), 'البطاقة غائبة');
  assert.ok(main.includes('مهمة سرية للاعتماد'), 'اسم البند غائب');
  assert.ok(main.includes('طلبها سجى لشكر'), 'اسم الطالب غائب');
  assert.ok(main.includes('اعتماد مهمة'), 'نوع الطلب غائب');
  assert.ok(main.includes('data-action="apr-approve"'), 'زر الاعتماد غائب');
  assert.ok(main.includes('data-action="apr-reject"'), 'زر الرفض غائب');
  assert.ok(html.includes('/static/pages/approvals.js'), 'معالج الأزرار غير محمَّل');
  // دوره يفتح شاشة «الاعتمادات» — فالرابط يُعرض له.
  assert.ok(main.includes('href="/app/approvals"'), 'رابط «كل الاعتمادات» غائب عمّن يملك الشاشة');
  assert.ok(!/undefined|NaN|\[object/.test(main));
});

test('والفراغ معلن: من لا ينتظره شيء يقرأ ذلك نصاً', async () => {
  const html = mainOf(await homePage(EMP2, {}));
  assert.ok(html.includes('لا طلبات بانتظارك'), 'الفراغ صامت');
});

test('ولا أثر لِما ينتظر غيرَك: عنوان البند لا يظهر في صفحة غير معتمِده', async () => {
  const html = mainOf(await homePage(EMP2, {}));
  assert.ok(!html.includes('مهمة سرية للاعتماد'), 'بندُ غيرِه ظهر في صفحته');
  // وكاتب المهمة نفسه لا يراها في بطاقة اعتماداته — هي بانتظار مديره لا بانتظاره.
  const own = mainOf(await homePage(EMP, {}));
  assert.ok(own.includes('لا طلبات بانتظارك'));
});

test('KI-035: معتمِدٌ دورُه لا يفتح شاشة الاعتمادات يرى طلبه على «صفحتي» ويحسمه منها', async () => {
  const t = await tasks.quickAddTask(ctx(EMP2), { title: 'مهمة إدارة مدير المشاريع', project_id: 'PRJ' });
  assert.equal(t.approval_state, 'PENDING');

  const html = mainOf(await homePage(PM, {}));
  assert.ok(html.includes('مهمة إدارة مدير المشاريع'), 'الطلب غائب عن صفحة معتمِده');
  assert.ok(html.includes('data-action="apr-approve"'), 'لا زر قرار لمن لا شاشة له');
  assert.ok(!html.includes('href="/app/approvals"'), 'رابطٌ يعد بشاشةٍ يردّها النظام');

  // والفعل نفسه ينفذ من الخادم بلا بوابة دور — الموجَّه إليه يعتمد أياً كان دوره.
  const req = (await engine.myDirectApprovals(PM)).find((a) => a.resource_id === t.id);
  await engine.actOnApproval(ctx(PM), req.id, 'approve');
  const row = await db.get('SELECT * FROM task WHERE id = ?', [t.id]);
  assert.equal(row.approval_state, null, 'الاعتماد من الخادم فشل لدورٍ خارج القائمة');
  assert.equal(row.approved_by, 'u_pm');

  const after = mainOf(await homePage(PM, {}));
  assert.ok(!after.includes('مهمة إدارة مدير المشاريع'), 'الطلب المحسوم بقي في البطاقة');
});

test('وتأكيد التسكين يظهر في البطاقة نفسها بنوعه واسم صاحبه', async () => {
  await db.insert('membership', { id: 'mem_1', employee_id: 'e_emp', group_kind: 'project',
    group_id: 'PRJ', role_in_group: 'member', created_at: T });
  await engine.raiseDirectApproval(ctx(EMP), { workflowKey: engine.STAFFING_WORKFLOW_KEY,
    resource: 'membership', resourceId: 'mem_1', assigneeUserId: 'u_mgr', sectorId: 'SOL' });
  const html = mainOf(await homePage(MGR, {}));
  assert.ok(html.includes('تأكيد تسكين'), 'نوع تأكيد التسكين غائب');
  assert.ok(html.includes('سجى لشكر'), 'اسم الموظف المسكَّن غائب');
});
