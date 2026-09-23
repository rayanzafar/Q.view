// ── هويةٌ واحدة للشخص عبر أدوات المساعد ────────────────────────────────────────────────────
// ما تحرسه:
//   ١) البحث في الموارد يعيد معرّف الموظف ومعرّف حسابه معاً — ويقول ما كلٌّ منهما.
//   ٢) إسنادُ مهمةٍ يقبل معرّف الموظف كما يقبل معرّف الحساب، ويحلّه إلى الحساب نفسه.
//   ٣) قراءةُ التسكين تقبل معرّف الحساب وتحلّه إلى موظفه.
//   ٤) موظفٌ بلا حسابٍ فعّال: يُسكَّن ولا تُسند إليه مهمة — ويُقال ذلك بجملة لا برمز.
//   ٥) تحديثُ المهمة ينقلها إلى زميل ويسمّيها ويربطها بمشروع، بقبل/بعد يُقرأ أسماءً لا معرّفات.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-identity-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, get, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { runTool, registerTools } = await import('../../src/modules/ai/team-tools.js');
const { TASK_TOOLS } = await import('../../src/modules/ai/tasks-tools.js');
const { CONFIRM_TOOLS } = await import('../../src/modules/ai/confirm-tools.js');
registerTools(TASK_TOOLS); registerTools(CONFIRM_TOOLS);
const { resolvePerson } = await import('../../src/modules/org/people.js');

const T = '2026-03-01T00:00:00Z';
const LEAD = { id: 'u_lead', username: 'u_lead', name_ar: 'قائد القطاع', role_id: 'sector_lead', sector_id: 'SOL', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const ctx = { user: LEAD, ip: '127.0.0.1' };
const viaAssistant = { user: LEAD, ip: '127.0.0.1', mcpClient: { id: 'cl_1', name_ar: 'مساعد التجربة' } };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  await insert('department', { id: 'D1', name_ar: 'إدارة البيانات', sector_id: 'SOL', created_at: T });
  await insert('app_user', { id: LEAD.id, username: LEAD.username, name_ar: LEAD.name_ar, role_id: LEAD.role_id, sector_id: 'SOL', scope: 'sector', active: 1, created_at: T });
  // يعقوب: موظفٌ له حساب — الربط من جهة الموظف (employee.user_id)
  await insert('app_user', { id: 'u_jacob', username: 'jacob', name_ar: 'يعقوب سيد', role_id: 'consultant', sector_id: 'SOL', scope: 'own', active: 1, created_at: T });
  await insert('employee', { id: 'emp_jacob', user_id: 'u_jacob', name_ar: 'يعقوب سيد', job_title: 'مستشار', sector_id: 'SOL', department_id: 'D1', active: 1, status: 'active', capacity_pct: 100, created_at: T });
  // إسحاق: الربط من جهة الحساب (app_user.employee_id)
  await insert('employee', { id: 'emp_isaac', name_ar: 'إسحاق منصور', job_title: 'محلل', sector_id: 'SOL', department_id: 'D1', active: 1, status: 'active', capacity_pct: 100, created_at: T });
  await insert('app_user', { id: 'u_isaac', username: 'isaac', name_ar: 'إسحاق منصور', role_id: 'consultant', sector_id: 'SOL', scope: 'own', employee_id: 'emp_isaac', active: 1, created_at: T });
  // نورة: موردٌ بلا حساب
  await insert('employee', { id: 'emp_noura', name_ar: 'نورة العلي', job_title: 'منسّقة', sector_id: 'SOL', department_id: 'D1', active: 1, status: 'active', capacity_pct: 100, created_at: T });
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('project', { id: 'P1', code: 'PRJ-1', name_ar: 'منصة الثقافة', sector_id: 'SOL', client_id: 'C1', status: 'IN_PROGRESS', rag: 'GREEN', owner_user_id: LEAD.id, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('الجسر يحلّ أيَّ المعرّفين إلى الاثنين — من الجهتين', async () => {
  assert.deepEqual(await resolvePerson('emp_jacob'), { employeeId: 'emp_jacob', userId: 'u_jacob', name_ar: 'يعقوب سيد' });
  assert.deepEqual(await resolvePerson('u_jacob'), { employeeId: 'emp_jacob', userId: 'u_jacob', name_ar: 'يعقوب سيد' });
  assert.deepEqual(await resolvePerson('emp_isaac'), { employeeId: 'emp_isaac', userId: 'u_isaac', name_ar: 'إسحاق منصور' });
  assert.deepEqual(await resolvePerson('u_isaac'), { employeeId: 'emp_isaac', userId: 'u_isaac', name_ar: 'إسحاق منصور' });
  assert.deepEqual(await resolvePerson('emp_noura'), { employeeId: 'emp_noura', userId: null, name_ar: 'نورة العلي' });
  assert.equal(await resolvePerson('لا_وجود'), null);
});

test('البحث يعيد المعرّفين معاً ويقول ما كلٌّ منهما', async () => {
  const out = await runTool(ctx, 'sanad_search', { q: 'يعقوب', kind: 'resource' });
  const hit = out.results.find((r) => r.title === 'يعقوب سيد');
  assert.ok(hit, 'وُجد');
  assert.equal(hit.employee_id, 'emp_jacob');
  assert.equal(hit.user_id, 'u_jacob');
  assert.match(hit.ids_ar, /معرّف الموظف للتسكين، ومعرّف الحساب للمهام/);
  const noura = (await runTool(ctx, 'sanad_search', { q: 'نورة', kind: 'resource' })).results[0];
  assert.equal(noura.user_id, null);
  assert.match(noura.ids_ar, /بلا حساب فعّال/);
});

test('إسنادُ مهمة بمعرّف الموظف يصل إلى حسابه — وبلا حسابٍ يُقال ذلك', async () => {
  const pv = await runTool(ctx, 'sanad_preview_task_create', { title: 'تجهيز العرض', assigneeUserId: 'emp_jacob', priority: 'P1' });
  assert.equal(pv.will_be.assignee_ar, 'يعقوب سيد', 'حُلّ المعرّف إلى صاحبه');
  const created = await runTool(ctx, 'sanad_create_task', { previewToken: pv.previewToken });
  assert.equal(created.task.assignee.id, 'u_jacob', 'المهمة على حسابه لا على معرّف موظفه');
  await assert.rejects(() => runTool(ctx, 'sanad_preview_task_create', { title: 'مهمة', assigneeUserId: 'emp_noura' }),
    (e) => { assert.match(e.message, /بلا حسابٍ فعّال/); return true; });
});

test('قراءةُ التسكين تقبل معرّف الحساب وتحلّه إلى موظفه', async () => {
  const out = await runTool(ctx, 'sanad_get_allocations', { employeeIds: ['u_isaac'] });
  assert.ok(JSON.stringify(out).includes('emp_isaac'), 'عاد الموظف نفسه بمعرّفه');
  assert.ok(!JSON.stringify(out).includes('"u_isaac"') || JSON.stringify(out).includes('emp_isaac'), 'ولم يُردّ معرّف الحساب كأنه مجهول');
});

test('تحديثُ المهمة ينقلها ويسمّيها ويربطها — وقبل/بعد أسماءٌ لا معرّفات', async () => {
  const created = await runTool(ctx, 'sanad_preview_task_create', { title: 'dd', priority: 'P2', assigneeUserId: 'u_jacob' });
  const t = (await runTool(ctx, 'sanad_create_task', { previewToken: created.previewToken })).task;
  const pv = await runTool(ctx, 'sanad_preview_task_update', {
    taskId: t.id, title: 'مراجعة نموذج البيانات', assigneeUserId: 'emp_isaac', linkKind: 'project', projectId: 'P1',
  });
  const by = Object.fromEntries(pv.changes.map((c) => [c.field, c]));
  assert.equal(by.title.before_ar, 'dd'); assert.equal(by.title.after_ar, 'مراجعة نموذج البيانات');
  assert.equal(by.assignee_user_id.before_ar, 'يعقوب سيد'); assert.equal(by.assignee_user_id.after_ar, 'إسحاق منصور');
  assert.equal(by.work_link.before_ar, 'عمل داخلي'); assert.equal(by.work_link.after_ar, 'مشروع «منصة الثقافة»');
  const out = await runTool(ctx, 'sanad_update_task', { previewToken: pv.previewToken });
  const row = await get('SELECT title, assignee_user_id, project_id, work_kind FROM task WHERE id = ?', [t.id]);
  assert.equal(row.title, 'مراجعة نموذج البيانات');
  assert.equal(row.assignee_user_id, 'u_isaac');
  assert.equal(row.project_id, 'P1'); assert.equal(row.work_kind, 'project');
  assert.equal(out.applied, true);
});

test('ومن نافذة المساعد: التحديث نفسه يقف بحالةٍ مبنيّة ثم يُنفَّذ من البطاقة', async () => {
  const t = (await get("SELECT id FROM task WHERE title = 'مراجعة نموذج البيانات'"));
  const pv = await runTool(viaAssistant, 'sanad_preview_task_update', { taskId: t.id, assigneeUserId: 'u_jacob' });
  const held = await runTool(viaAssistant, 'sanad_update_task', { previewToken: pv.previewToken });
  assert.equal(held.awaiting_confirmation, true);
  assert.equal((await get('SELECT assignee_user_id FROM task WHERE id = ?', [t.id])).assignee_user_id, 'u_isaac', 'لم يتغيّر بعد');
  const done = await runTool(viaAssistant, 'sanad_confirm_change', { changeId: held.change_id });
  assert.equal(done.executed, true);
  assert.equal((await get('SELECT assignee_user_id FROM task WHERE id = ?', [t.id])).assignee_user_id, 'u_jacob', 'تغيّر بالضغطة');
});
