// إعادة فتح المهمة وحذفُها — بابان جديدان على قواعد قائمة:
//   ① إعادة الفتح تمحو ختم الإنجاز — وإلا بقيت تُعدّ في «أنجزت اليوم» وهي مفتوحة.
//   ② الحذف ملكيةُ كتابةٍ لا استلام: كاتبها يمحوها، والمُسنَد إليه وحده لا؛ والشخصية لغير
//      صاحبها «غير موجودة»؛ والمعلَّقة يُلغى طلبُ اعتمادها معها فلا يقرّر المدير في عدم؛
//      وصاحب الصلاحية الإدارية على قطاعها — ومدير النظام — يمحوان ما لم يكتباه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-taskdel-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, engine, depts;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
const EMP = { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', employee_id: 'e_emp', projectIds: new Set(['PRJ']) };
const LEAD = { id: 'u_lead', username: 'lead', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL' };
let MGR;
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });
const taskRow = (id) => db.get('SELECT * FROM task WHERE id = ?', [id]);

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
  engine = await import('../../src/modules/workflow/engine.js');
  depts = await import('../../src/core/rbac/departments.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_lead', username: 'lead', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_mgr', username: 'mgr', name_ar: 'مدير الابتكار', role_id: 'department_manager',
    scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', employee_id: 'e_emp', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL',
    manager_user_id: 'u_mgr', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_emp', name_ar: 'سجى لشكر', sector_id: 'SOL', department_id: 'D_INNO',
    user_id: 'u_emp', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_mgr', name_ar: 'مدير الابتكار', sector_id: 'SOL', department_id: 'D_INNO',
    user_id: 'u_mgr', active: 1, created_at: T });
  await db.insert('project', { id: 'PRJ', name_ar: 'منصة تحليلات', sector_id: 'SOL', status: 'IN_PROGRESS',
    owner_user_id: 'u_mgr', created_at: T });

  MGR = { id: 'u_mgr', username: 'mgr', role_id: 'department_manager', scope: 'department',
    sector_id: 'SOL', employee_id: 'e_mgr', department_id: 'D_INNO',
    departmentIds: await depts.readerDepartmentIds('u_mgr', null) };
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ═══ ① إعادة الفتح ═══════════════════════════════════════════════════════════

test('إعادة فتح مهمة منجزة تمحو ختم الإنجاز وتعيدها إلى بانتظار البدء', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة ستُنجز ثم تُفتح' });
  const done = await tasks.updateTask(ctx(EMP), t.id, { status: 'DONE' });
  assert.ok(done.completed_at, 'الإنجاز بلا ختم');
  assert.equal(Number(done.progress_pct), 100);
  const reopened = await tasks.updateTask(ctx(EMP), t.id, { status: 'TODO' });
  assert.equal(reopened.status, 'TODO');
  assert.equal(reopened.completed_at, null, 'بقي ختم الإنجاز على مهمة مفتوحة — فتُعدّ في «أنجزت اليوم» وهي لم تُنجز');
});

// ═══ ② الحذف: من يملكه ومن لا ═════════════════════════════════════════════════

test('كاتب المهمة يحذفها حذفاً ناعماً — والأثر مسجَّل في التدقيق باسمها', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة سيحذفها كاتبها' });
  const r = await tasks.deleteTask(ctx(EMP), t.id);
  assert.deepEqual(r, { ok: true });
  const row = await taskRow(t.id);
  assert.ok(row.deleted_at, 'الحذف لم يقع');
  assert.equal(row.updated_by, 'u_emp');
  const aud = await db.get(`SELECT * FROM audit_log
     WHERE action = 'delete' AND resource = 'task' AND resource_id = ?`, [t.id]);
  assert.ok(aud, 'حذفٌ بلا أثر في التدقيق');
  assert.match(String(aud.detail_json || ''), /مهمة سيحذفها كاتبها/, 'الأثر بلا اسم المهمة');
  // والمحذوفة لا تعود في قائمة صاحبها
  const mine = await tasks.myTasks(EMP, {});
  assert.ok(!mine.some((x) => x.id === t.id), 'بقيت المحذوفة في القائمة');
});

test('والمُسنَد إليه الذي لم يكتبها لا يحذف ما كتبه غيره', async () => {
  const t = await tasks.quickAddTask(ctx(MGR), { title: 'مهمة من المدير لموظفه', assignee_user_id: 'u_emp' });
  await assert.rejects(() => tasks.deleteTask(ctx(EMP), t.id),
    /حذف المهمة لمن أنشأها/, 'حذفَ المُسنَدُ إليه ما لم يكتبه');
  assert.equal((await taskRow(t.id)).deleted_at, null);
});

test('والشخصية لغير صاحبها «غير موجودة» — لا يُكشف وجودها ولو لمدير النظام', async () => {
  const p = await tasks.quickAddTask(ctx(EMP), { title: 'موعد خاص', work_kind: 'personal' });
  await assert.rejects(() => tasks.deleteTask(ctx(MGR), p.id), /غير موجودة/);
  await assert.rejects(() => tasks.deleteTask(ctx(ADMIN), p.id), /غير موجودة/);
  assert.equal((await taskRow(p.id)).deleted_at, null);
  // وصاحبها يحذف دفتره — الملكية بوجهيها: كتابةً أو مهمةً شخصيةً مُسنَدةً إليه.
  await tasks.deleteTask(ctx(EMP), p.id);
  assert.ok((await taskRow(p.id)).deleted_at);
});

test('حذف المعلَّقة يُلغي طلبَ اعتمادها — فلا يقرّر المدير في عدم', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة معلَّقة ستُحذف', project_id: 'PRJ' });
  assert.equal(t.approval_state, 'PENDING');
  const queued = (await engine.myDirectApprovals(MGR)).filter((a) => a.resource_id === t.id);
  assert.equal(queued.length, 1, 'لم يصل الطلب إلى المدير أصلاً');

  await tasks.deleteTask(ctx(EMP), t.id);
  assert.ok((await taskRow(t.id)).deleted_at);
  const req = await db.get('SELECT * FROM approval_request WHERE resource = ? AND resource_id = ?', ['task', t.id]);
  assert.equal(req.status, 'CANCELLED', 'بقي طلب الاعتماد معلَّقاً على مهمة محذوفة');
  assert.ok(req.closed_at, 'أُلغي الطلب بلا تاريخ إغلاق');
  const after = (await engine.myDirectApprovals(MGR)).filter((a) => a.resource_id === t.id);
  assert.equal(after.length, 0, 'ما زال طابور المدير يعرض قراراً على عدم');
});

test('والمعلَّقة لغير كاتبها «غير موجودة» حتى في باب الحذف — إلا لمدير النظام', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'معلَّقة محجوبة عن الحذف', project_id: 'PRJ' });
  assert.equal(t.approval_state, 'PENDING');
  await assert.rejects(() => tasks.deleteTask(ctx(LEAD), t.id), /غير موجودة/,
    'كُشف وجودُ معلَّقةٍ لمن لا يقرؤها في أي قائمة');
  await tasks.deleteTask(ctx(ADMIN), t.id);
  assert.ok((await taskRow(t.id)).deleted_at, 'مدير النظام يرى كل شيء — وحجبُها عنه تمثيلٌ لا حماية');
});

test('وصاحب الصلاحية الإدارية على القطاع يحذف ما لم يكتبه — ومدير النظام كذلك', async () => {
  const a = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة يحذفها قائد القطاع' });
  await tasks.deleteTask(ctx(LEAD), a.id);
  assert.ok((await taskRow(a.id)).deleted_at, 'منح الحذف القطاعي لم يصل إلى مهمة قطاعه');

  const b = await tasks.quickAddTask(ctx(EMP), { title: 'مهمة يحذفها مدير النظام' });
  await tasks.deleteTask(ctx(ADMIN), b.id);
  assert.ok((await taskRow(b.id)).deleted_at);
});

test('ومهمة محذوفة أو معرّف لا وجود له: «غير موجودة» — لا فرق بين البابين', async () => {
  const t = await tasks.quickAddTask(ctx(EMP), { title: 'تُحذف مرتين' });
  await tasks.deleteTask(ctx(EMP), t.id);
  await assert.rejects(() => tasks.deleteTask(ctx(EMP), t.id), /غير موجودة/);
  await assert.rejects(() => tasks.deleteTask(ctx(EMP), 'tsk_no_such'), /غير موجودة/);
});
