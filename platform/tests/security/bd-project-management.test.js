// مدير تطوير الأعمال يدير مشاريع قطاعه — قرار المالك ٢٠٢٦-٠٨-١٧.
// المنحة الجديدة (matrix.js): project read/create/update بنطاق «قطاع» — إنشاءً وتعديلاً
// (الحالة والتواريخ ومدير المشروع والقيم)، **بلا حذف**، وبلا مشاريع القطاعات الأخرى.
// هذه الحارة تحرس حدود المنحة من جهتيها: ما فُتح يعمل، وما بقي مغلقاً يبقى مغلقاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-bdprj-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, close } = await import('../../src/core/db/index.js');
const { initRbac, can } = await import('../../src/core/rbac/index.js');
await initRbac();
const projects = await import('../../src/modules/pmo/projects.js');

const T = '2026-01-01T00:00:00Z';
const ctx = (user) => ({ user, ip: '127.0.0.1' });
const U = (id, role, sector, scope) =>
  ({ id, username: id, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });
const bd = U('u_bd', 'bd_manager', 'CONSULTING', 'sector');

before(async () => {
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, sort_order: 2, created_at: T });
  await insert('app_user', { id: 'u_bd', username: 'u_bd', role_id: 'bd_manager', sector_id: 'CONSULTING', scope: 'sector', active: 1, created_at: T });
  await insert('app_user', { id: 'u_lead', username: 'u_lead', role_id: 'sector_lead', sector_id: 'CONSULTING', scope: 'sector', active: 1, created_at: T });
  // مشروع قائم في قطاعه لا يملكه، وآخر في قطاعٍ آخر — طرفا الحدّ.
  await insert('project', { id: 'PC1', name_ar: 'مشروع استشاري قائم', sector_id: 'CONSULTING',
    owner_user_id: 'u_lead', status: 'IN_PROGRESS', created_at: T });
  await insert('project', { id: 'PS1', name_ar: 'مشروع حلول', sector_id: 'SOLUTIONS',
    owner_user_id: 'u_lead', status: 'IN_PROGRESS', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('ينشئ مشروعاً في قطاعه — ولو مكتملاً (إدخال تاريخي)', async () => {
  const r = await projects.createProject(ctx(bd), { name_ar: 'مشروع مرحَّل',
    status: 'COMPLETED', start_date: '2023-02-01', end_date: '2023-11-30' });
  const row = await get('SELECT sector_id, status, created_by FROM project WHERE id = ?', [r.id]);
  assert.equal(row.sector_id, 'CONSULTING', 'المشروع يقع في قطاعه تلقائياً');
  assert.equal(row.status, 'COMPLETED');
  assert.equal(row.created_by, 'u_bd');
});

test('يعدّل مشروع قطاعه الذي لا يملكه — الحالة والتواريخ ومدير المشروع', async () => {
  await projects.updateProject(ctx(bd), 'PC1',
    { status: 'COMPLETED', start_date: '2024-01-01', end_date: '2024-06-30', pm_name: 'مشاعل' });
  const row = await get('SELECT status, start_date, end_date, pm_name FROM project WHERE id = ?', ['PC1']);
  assert.equal(row.status, 'COMPLETED');
  assert.equal(row.start_date, '2024-01-01');
  assert.equal(row.end_date, '2024-06-30');
  assert.equal(row.pm_name, 'مشاعل');
  assert.ok(await get("SELECT id FROM audit_log WHERE resource = 'project' AND resource_id = 'PC1' AND username = 'u_bd'"),
    'التعديل يترك أثراً بالفاعل الحقيقي');
});

test('ما بقي مغلقاً: لا حذف، ولا مشاريع قطاعٍ آخر', async () => {
  assert.equal(can(bd, 'delete', 'project', { sector_id: 'CONSULTING' }), false,
    'الحذف لا رجعة فيه — يبقى لقائد القطاع ومدير النظام');
  await assert.rejects(
    () => projects.updateProject(ctx(bd), 'PS1', { status: 'ON_HOLD' }),
    (e) => e.code === 'forbidden' || e.code === 'not_found', 'مشروع قطاع آخر مردود');
  assert.equal((await get('SELECT status FROM project WHERE id = ?', ['PS1'])).status, 'IN_PROGRESS');
  await assert.rejects(
    () => projects.createProject(ctx(bd), { name_ar: 'مشروع خارج القطاع', sector_id: 'SOLUTIONS' }),
    (e) => e.code === 'forbidden', 'ولا إنشاء في قطاع غيره');
});
