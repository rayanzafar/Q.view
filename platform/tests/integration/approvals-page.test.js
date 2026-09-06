// شاشة الاعتمادات تقول ما الذي ينتظرك بلسانٍ صحيح: الطلب الموجَّه إليك بشخصك (اعتماد مهمة
// موظفك) لا مبلغ له ولا «خطوة دور» — بل اسم المهمة، ومن طلبها، ووسم «بانتظارك». وكان الصف
// يطبع «0 ر.س.» و«الخطوة 1» فيقرأ المديرُ حوكمةً مالية في طلبٍ ليس منها.
// وفوق الجدول تنبيهٌ لمن يملك التعيين: إدارةٌ بلا مسؤولٍ معيَّن تعني مهامَّ تُضاف دون اعتماد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-aprpage-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, engine, depts, P, fmtSar;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
// الموظف: إدارته D_INNO التي يديرها u_mgr — فمهمته على مشروعٍ تُرفع اعتماداً موجَّهاً إلى مديره.
const EMP = { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', employee_id: 'e_emp', projectIds: new Set(['PRJ']) };
const SL_SOL = { id: 'u_sl', username: 'sl', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL' };
let MGR;
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
  engine = await import('../../src/modules/workflow/engine.js');
  depts = await import('../../src/core/rbac/departments.js');
  P = await import('../../src/web/pages.js');
  ({ fmtSar } = await import('../../src/core/util/ids.js'));

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'CON', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_mgr', username: 'mgr', name_ar: 'مدير الابتكار', role_id: 'department_manager',
    scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', employee_id: 'e_emp', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_sl', username: 'sl', name_ar: 'قائد الحلول', role_id: 'sector_lead',
    scope: 'sector', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL',
    manager_user_id: 'u_mgr', active: 1, created_at: T });
  // إدارتان بلا مسؤول — موضوع التنبيه: واحدة في كل قطاع، لفحص نطاق قائد القطاع.
  await db.insert('department', { id: 'D_ORPH', name_ar: 'إدارة التحول', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_ORPH2', name_ar: 'إدارة الدراسات', sector_id: 'CON', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_emp', name_ar: 'سجى لشكر', sector_id: 'SOL', department_id: 'D_INNO',
    user_id: 'u_emp', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_mgr', name_ar: 'مدير الابتكار', sector_id: 'SOL', department_id: 'D_INNO',
    user_id: 'u_mgr', active: 1, created_at: T });
  await db.insert('project', { id: 'PRJ', name_ar: 'منصة تحليلات', sector_id: 'SOL', status: 'IN_PROGRESS',
    owner_user_id: 'u_mgr', created_at: T });

  MGR = { id: 'u_mgr', username: 'mgr', name_ar: 'مدير الابتكار', role_id: 'department_manager', scope: 'department',
    sector_id: 'SOL', employee_id: 'e_mgr', department_id: 'D_INNO',
    departmentIds: await depts.readerDepartmentIds('u_mgr', null) };
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ═══ ① الطلب الموجَّه يُقرأ باسمه — لا مبلغ صفري ولا خطوة دور ═══════════════════

test('طلب اعتماد المهمة يظهر للمدير باسمه ورافعِه ووسم «بانتظارك»', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'إعداد خطة الاختبار', project_id: 'PRJ' });
  assert.equal(t.approval_state, 'PENDING', 'العيّنة بلا طلبٍ معلَّق — الفحص لا يقيس شيئاً');
  const pending = await engine.myDirectApprovals(MGR);
  assert.equal(pending.filter((a) => a.resource === 'task').length, 1, 'الطلب لم يصل إلى المدير');

  const html = await P.approvalsPage(MGR, {});
  assert.ok(html.includes('إعداد خطة الاختبار'), 'عنوان المهمة غائب — يقرّر المدير في شيءٍ لا يعرفه');
  assert.ok(html.includes('اعتماد مهمة'), 'وسم «اعتماد مهمة» غائب عن الصف');
  assert.ok(html.includes('بانتظارك'), 'الطلب الموجَّه لا يحمل وسم «بانتظارك»');
  assert.ok(html.includes('طلبها') && html.includes('سجى لشكر'), 'اسم رافع الطلب غائب');
});

test('ولا يطبع الصفُّ الموجَّه مبلغاً صفرياً ولا «الخطوة 1»', async () => {
  const html = await P.approvalsPage(MGR, {});
  assert.ok(!html.includes('٠٫٠٠'), 'ظهر مبلغ صفري بأرقام عربية على طلبٍ لا مبلغ له');
  assert.ok(!html.includes(fmtSar(0)), `ظهر «${fmtSar(0)}» على طلبٍ لا مبلغ له`);
  assert.ok(!html.includes('الخطوة 1'), '«الخطوة 1» على طلبٍ موجَّهٍ بشخصه لا بخطوات دور');
});

test('والأزرار بتفويض الأحداث لا استدعاءً داخل السمة — وملف الشاشة مسجَّل', async () => {
  const html = await P.approvalsPage(MGR, {});
  assert.ok(html.includes('data-action="apr-approve"'), 'زر الاعتماد بلا تفويض حدث');
  assert.ok(html.includes('data-action="apr-reject"'), 'زر الرفض بلا تفويض حدث');
  assert.ok(!html.includes('Sanad.approve('), 'بقي استدعاء مباشر داخل سمة onclick');
  assert.ok(html.includes('/static/pages/approvals.js'), 'ملف صفحة الاعتمادات غير مسجَّل');
});

// ═══ ② تنبيه الإدارات بلا مسؤول — لمن يملك التعيين وحده ═══════════════════════

test('مدير النظام يرى التنبيه بأسماء الإدارات ورابط الهيكل التنظيمي', async () => {
  const html = await P.approvalsPage(ADMIN, {});
  assert.ok(html.includes('بلا مسؤول معيَّن'), 'التنبيه غائب عن مدير النظام');
  assert.ok(html.includes('إدارة التحول'), 'اسم الإدارة اليتيمة غائب عن التنبيه');
  assert.ok(html.includes('إدارة الدراسات'), 'إدارة القطاع الآخر غائبة — والمدى شركة كاملة');
  assert.ok(html.includes('مهام أهلها تُضاف دون اعتماد'), 'أثر الغياب غير مكتوب — تنبيهٌ بلا سبب');
  assert.ok(html.includes('/app/org'), 'رابط الهيكل التنظيمي غائب — تنبيهٌ بلا طريق للفعل');
  assert.ok(!html.includes('إدارة الابتكار ('), 'إدارةٌ لها مسؤول ظهرت في التنبيه');
});

test('وقائد القطاع يرى إدارات قطاعه وحدها — والموظف والمدير لا يريان التنبيه', async () => {
  const sl = await P.approvalsPage(SL_SOL, {});
  assert.ok(sl.includes('إدارة التحول'), 'إدارة قطاعه غائبة عن قائد القطاع');
  assert.ok(!sl.includes('إدارة الدراسات'), 'ظهرت لقائد القطاع إدارةُ قطاعٍ ليس بيده');

  const emp = await P.approvalsPage(EMP, {});
  assert.ok(!emp.includes('بلا مسؤول معيَّن'), 'التنبيه ظهر لموظفٍ لا يملك التعيين');
  const mgr = await P.approvalsPage(MGR, {});
  assert.ok(!mgr.includes('بلا مسؤول معيَّن'), 'التنبيه ظهر لمدير إدارةٍ لا يملك التعيين');
});
