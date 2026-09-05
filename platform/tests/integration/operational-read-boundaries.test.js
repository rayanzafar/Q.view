import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sanad-read-boundaries-'));
process.env.SANAD_DB = join(dir, 'test.db');
const db = await import('../../src/core/db/index.js');
const { initRbac, can } = await import('../../src/core/rbac/index.js');
const { financeSummary, financeByContract } = await import('../../src/modules/finance/finance.js');
const { myTasks, mySectorTasks, teamTasks } = await import('../../src/modules/pmo/tasks.js');
const { tasksPage } = await import('../../src/web/views/pmo.js');
const { listResources } = await import('../../src/modules/team/resources.js');
const { loadReadableResource } = await import('../../src/modules/team/access.js');
const { recordDemo } = await import('../../src/core/demo/registry.js');
const { pickablePeople } = await import('../../src/modules/org/people.js');
const stamp = '2026-09-01T00:00:00.000Z';
const admin = { id: 'A', role_id: 'admin', scope: 'company', username: 'admin' };
const lead = { id: 'L', role_id: 'sector_lead', scope: 'sector', sector_id: 'S1' };
const worker = { id: 'W', role_id: 'consultant', scope: 'own', sector_id: 'S1', projectIds: new Set(), opportunityIds: new Set() };

before(async () => {
  await (await import('../../scripts/migrate.js')).migrate();
  await (await import('../../scripts/seed-rbac.js')).seedRbac();
  await initRbac();
  for (const id of ['S1', 'S2']) await db.insert('sector', { id, name_ar: id, active: 1, created_at: stamp });
  for (const u of [admin, lead, worker]) await db.insert('app_user', { id: u.id, role_id: u.role_id, scope: u.scope, sector_id: u.sector_id,
    username: u.id, name_ar: 'مستخدم ' + u.id, active: 1, created_at: stamp });
  await db.insert('stage', { id: 'WIN', name_ar: 'فوز', is_won: 1, is_lost: 0, sort_order: 1 });
  for (const sector of ['S1', 'S2']) {
    await db.insert('project', { id: 'P_' + sector, name_ar: 'مشروع مخول ' + sector, sector_id: sector, created_at: stamp });
    await db.insert('opportunity', { id: 'O_' + sector, title_ar: 'فرصة مخولة ' + sector, sector_id: sector,
      owner_user_id: 'L', stage_id: 'WIN', year: 2026, value_halalas: 50000, created_at: stamp });
    await db.insert('invoice', { id: 'I_' + sector, sector_id: sector, project_id: 'P_' + sector,
      amount_halalas: 10000, status: 'ISSUED', issue_date: '2026-03-01', created_at: stamp });
    await db.insert('collection', { id: 'C_' + sector, invoice_id: 'I_' + sector, amount_halalas: sector === 'S1' ? 2000 : 9000, created_at: stamp });
  }
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('collection totals exclude other sectors, deleted invoices and drafts in summary and contract buckets', async () => {
  await db.insert('contract', { id: 'K1', project_id: 'P_S1', sector_id: 'S1', value_halalas: 20000, created_at: stamp });
  await db.insert('invoice', { id: 'VALID_K', project_id: 'P_S1', sector_id: 'S1', contract_id: 'K1', amount_halalas: 5000,
    status: 'ISSUED', issue_date: '2026-03-01', created_at: stamp });
  await db.insert('collection', { id: 'VALID_K_C', invoice_id: 'VALID_K', amount_halalas: 1000, created_at: stamp });
  for (const contract of [null, 'K1']) for (const status of ['DRAFT', 'DELETED', 'OTHER_SECTOR']) {
    const id = String(contract) + status;
    await db.insert('invoice', { id, sector_id: status === 'OTHER_SECTOR' ? 'S2' : 'S1', contract_id: contract,
      amount_halalas: 90000, status: status === 'DRAFT' ? 'DRAFT' : 'ISSUED', issue_date: '2026-03-01',
      deleted_at: status === 'DELETED' ? stamp : null, created_at: stamp });
    await db.insert('collection', { id: 'COL_' + id, invoice_id: id, amount_halalas: 80000, created_at: stamp });
  }
  const summary = await financeSummary(lead, 2026);
  assert.equal(summary.invoiced_halalas, 15000);
  assert.equal(summary.collected_halalas, 3000);
  const contracts = await financeByContract(lead);
  assert.equal(contracts.find((c) => c.id === 'K1').invoiced_halalas, 5000);
  assert.equal(contracts.find((c) => c.id === 'K1').collected_halalas, 1000);
  assert.equal(contracts.find((c) => c.unassigned).collected_halalas, 2000);
});

test('bookings cannot reveal sector sales to a reader whose opportunity scope is own', async () => {
  assert.equal((await financeSummary(worker, 2026)).bookings_halalas, 0);
  await db.insert('opportunity', { id: 'OWN_WIN', title_ar: 'فرصتي', sector_id: 'S1', owner_user_id: worker.id,
    stage_id: 'WIN', year: 2026, value_halalas: 700, created_at: stamp });
  assert.equal((await financeSummary(worker, 2026)).bookings_halalas, 700);
  assert.equal((await financeSummary(worker, 2025)).bookings_halalas, 0);
});

test('task context follows parent permissions; membership restores a real link without hiding the task', async () => {
  for (const kind of ['project', 'opportunity']) await db.insert('task', { id: 'T_' + kind, title: 'راجع المهمة ' + kind,
    assignee_user_id: worker.id, sector_id: 'S1', work_kind: kind, [kind + '_id']: kind === 'project' ? 'P_S2' : 'O_S2',
    status: 'TODO', priority: 'P2', due_date: new Date().toISOString().slice(0, 10), created_at: stamp });
  let rows = await myTasks(worker);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !r.project_name && !r.opportunity_name));
  const html = await tasksPage(worker);
  assert.ok(html.includes('جهة خارج نطاقك'));
  assert.ok(!html.includes('href="/app/project/P_S2"'));
  assert.ok(!html.includes('href="/app/opportunity/O_S2"'));
  assert.ok(!JSON.stringify(await mySectorTasks(worker, 'S1')).includes('مشروع مخول S2'));
  assert.ok(!JSON.stringify(await teamTasks(lead)).includes('مشروع مخول S2'));
  worker.projectIds.add('P_S2'); worker.opportunityIds.add('O_S2');
  rows = await myTasks(worker);
  assert.equal(rows.find((r) => r.project_id).project_name, 'مشروع مخول S2');
  assert.equal(rows.find((r) => r.opportunity_id).opportunity_name, 'فرصة مخولة S2');
});

test('registered unlinked demo resources stay out of lists and direct profiles; similar real names stay', async () => {
  for (const id of ['DEMO_E', 'REAL_E']) await db.insert('employee', { id, name_ar: 'اسم متشابه تجريبي',
    sector_id: 'S1', active: 1, status: 'نشط', created_at: stamp });
  await recordDemo('isolated-fixture', 'employee', 'DEMO_E');
  const listing = await listResources(lead);
  assert.ok(!JSON.stringify(listing).includes('DEMO_E'));
  assert.ok(JSON.stringify(listing).includes('REAL_E'));
  await assert.rejects(loadReadableResource(lead, 'DEMO_E'), (e) => e.status === 404);
  assert.equal((await loadReadableResource(admin, 'DEMO_E')).id, 'DEMO_E');
  assert.equal((await loadReadableResource(lead, 'REAL_E')).id, 'REAL_E');
});

test('restoring retired finance grants cannot reactivate the role at runtime', async () => {
  await db.insert('role', { id: 'finance', name_ar: 'دور قديم', name_en: 'Retired finance', is_system: 1, created_at: stamp });
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?, ?, ?, ?)', ['finance', 'invoice', 'read', 'company']);
  await initRbac();
  assert.equal(can({ id: 'legacy', role_id: 'finance', scope: 'company' }, 'read', 'invoice'), false);
  assert.equal(can(lead, 'read', 'invoice'), true);
});

test('assignee choices exclude registered demo employees through either account link, without name matching', async () => {
  for (const id of ['PICK_FORWARD', 'PICK_REVERSE', 'PICK_REAL']) {
    await db.insert('app_user', { id, username: id.toLowerCase(), name_ar: 'اسم متشابه تجريبي',
      role_id: 'consultant', scope: 'own', sector_id: 'S1', active: 1, created_at: stamp });
    await db.insert('employee', { id: 'E_' + id, name_ar: 'اسم متشابه تجريبي', sector_id: 'S1', active: 1,
      user_id: id === 'PICK_REVERSE' ? id : null, created_at: stamp });
    if (id !== 'PICK_REVERSE') await db.run('UPDATE app_user SET employee_id=? WHERE id=?', ['E_' + id, id]);
    if (id !== 'PICK_REAL') await recordDemo('isolated-fixture', 'employee', 'E_' + id);
  }
  const staff = new Set((await pickablePeople({ viewer: lead })).map((p) => p.id));
  assert.ok(staff.has('PICK_REAL'));
  assert.ok(!staff.has('PICK_FORWARD'));
  assert.ok(!staff.has('PICK_REVERSE'));
  const adminChoices = new Set((await pickablePeople({ viewer: admin })).map((p) => p.id));
  assert.ok(adminChoices.has('PICK_FORWARD') && adminChoices.has('PICK_REVERSE'));
});
