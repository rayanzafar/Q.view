// setAllocationCell — single-month heat-grid edit: writes monthly_json, audits, clamps to 0–150%,
// rejects bad months, and 403s a manager from another sector. Isolated temp DB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-staffing-edit.db');
process.env.SANAD_DB = TEST_DB;

let db, projects;
const YEAR = new Date().getUTCFullYear();
const now = () => new Date().toISOString();
const U = (role, sector, scope, extra = {}) => ({ id: 'u_' + role + (sector || ''), username: role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set(), ...extra });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const mjOf = async (id) => JSON.parse((await db.get('SELECT monthly_json FROM allocation WHERE id = ?', [id])).monthly_json);

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  projects = await import('../../src/modules/pmo/projects.js');

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع ١', active: 1, created_at: now() });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع ٢', active: 1, created_at: now() });
  await db.insert('employee', { id: 'E1', name_ar: 'موظف', sector_id: 'S1', status: 'نشط', active: 1, created_at: now() });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع', sector_id: 'S1', status: 'IN_PROGRESS', created_at: now() });
  await db.insert('allocation', { id: 'A1', employee_id: 'E1', person_name_ar: 'موظف', project_id: 'P1', project_name: 'مشروع',
    sector_id: 'S1', type: 'member', year: YEAR, monthly_json: JSON.stringify({ 7: 1 }), source: 'manual', created_at: now() });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('cell edit writes ONLY that month and audits it', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  const r = await projects.setAllocationCell(ctx(lead), 'A1', 3, 50);
  assert.equal(r.pct, 50);
  assert.deepEqual(await mjOf('A1'), { 3: 0.5, 7: 1 }, 'existing months preserved, edited month written as a fraction');
  const aud = await db.get(`SELECT * FROM audit_log WHERE resource='allocation' AND resource_id='A1' AND action='update' ORDER BY at DESC LIMIT 1`);
  assert.ok(aud, 'audited');
  const det = JSON.parse(aud.detail_json);
  assert.equal(det.month, 3);
  assert.equal(det.pct, 50);
  assert.equal(aud.sector_id, 'S1');
});

test('clamps: >150 → 150; negative → 0 (clears the month); 0 clears the month key', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  await projects.setAllocationCell(ctx(lead), 'A1', 4, 900);
  assert.equal((await mjOf('A1'))[4], 1.5, 'clamped to the 1.5 fraction ceiling');
  await projects.setAllocationCell(ctx(lead), 'A1', 4, -20);
  assert.ok(!('4' in await mjOf('A1')), 'negative clamps to 0 which clears the key');
  await projects.setAllocationCell(ctx(lead), 'A1', 7, 0);
  assert.ok(!('7' in await mjOf('A1')), 'explicit 0 removes the month');
});

test('validation: month out of range and non-numeric pct are rejected in Arabic', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  await assert.rejects(() => projects.setAllocationCell(ctx(lead), 'A1', 13, 50), /الشهر/);
  await assert.rejects(() => projects.setAllocationCell(ctx(lead), 'A1', 0, 50), /الشهر/);
  await assert.rejects(() => projects.setAllocationCell(ctx(lead), 'A1', 5, 'abc'), /نسبة/);
});

test('403: a sector lead from ANOTHER sector cannot edit the cell', async () => {
  const other = U('sector_lead', 'S2', 'sector');
  await assert.rejects(() => projects.setAllocationCell(ctx(other), 'A1', 5, 40), /صلاحية|forbidden/);
});

test('403: an employee role cannot edit allocations at all', async () => {
  const emp = U('employee', 'S1', 'own');
  await assert.rejects(() => projects.setAllocationCell(ctx(emp), 'A1', 5, 40), /صلاحية|forbidden/);
});

test('setAllocation dispatches {month, pct} bodies to the single-cell editor (PATCH /projects/staff/:id)', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  await projects.setAllocationCell(ctx(lead), 'A1', 6, 80); // seed another month
  const r = await projects.setAllocation(ctx(lead), 'A1', { month: 5, pct: 25 });
  assert.equal(r.month, 5, 'routed to the cell editor, not the range rewrite');
  const mj = await mjOf('A1');
  assert.equal(mj[5], 0.25);
  assert.equal(mj[6], 0.8, 'other months untouched — NOT a full-range rewrite');
});

test('unknown allocation → not-found in Arabic', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  await assert.rejects(() => projects.setAllocationCell(ctx(lead), 'A_missing', 5, 40), /غير موجود/);
});
