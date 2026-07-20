// Staffing roster v3 summary math — opportunity soft load, bench/overload/underused counts,
// monthDelta — deterministic via opts.month. Isolated temp DB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-staffing-summary.db');
process.env.SANAD_DB = TEST_DB;

let db, org;
const YEAR = new Date().getUTCFullYear();
const now = () => new Date().toISOString();
const admin = { id: 'u_admin', username: 'admin', role_id: 'admin', sector_id: null, scope: 'company', projectIds: new Set(), teamIds: new Set() };

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  org = await import('../../src/modules/org/org.js');

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع ١', active: 1, created_at: now() });
  await db.insert('stage', { id: 'OPEN1', name_ar: 'عرض', default_win_pct: 60, sort_order: 2 });
  await db.insert('stage', { id: 'WONX', name_ar: 'فائزة', default_win_pct: 100, sort_order: 5, is_won: 1 });
  // employees: E1 overloaded, E2 underused, E3 bench, E4 opportunity-only soft load, E5 inactive
  for (const [id, name, active] of [['E1', 'أروى', 1], ['E2', 'بدر', 1], ['E3', 'جواهر', 1], ['E4', 'دانة', 1], ['E5', 'هيثم', 0]])
    await db.insert('employee', { id, name_ar: name, sector_id: 'S1', status: 'نشط', active, created_at: now() });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع ألف', sector_id: 'S1', status: 'IN_PROGRESS', created_at: now() });
  await db.insert('project', { id: 'P2', name_ar: 'مشروع باء', sector_id: 'S1', status: 'IN_PROGRESS', created_at: now() });
  // E1: 60% Jun+Jul on P1 + 70% Jul on P2 → July = 130%
  await db.insert('allocation', { id: 'A1', employee_id: 'E1', project_id: 'P1', sector_id: 'S1', year: YEAR, monthly_json: JSON.stringify({ 6: 0.6, 7: 0.6 }), created_at: now() });
  await db.insert('allocation', { id: 'A2', employee_id: 'E1', project_id: 'P2', sector_id: 'S1', year: YEAR, monthly_json: JSON.stringify({ 7: 0.7 }), created_at: now() });
  // E2: 20% Jul on P1
  await db.insert('allocation', { id: 'A3', employee_id: 'E2', project_id: 'P1', sector_id: 'S1', year: YEAR, monthly_json: JSON.stringify({ 7: 0.2 }), created_at: now() });
  // E4: opportunity team membership at 30% on an OPEN opportunity → current-month soft load
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة رقمية', sector_id: 'S1', stage_id: 'OPEN1', created_at: now() });
  await db.insert('membership', { id: 'M1', employee_id: 'E4', group_kind: 'opportunity', group_id: 'O1', role_in_group: 'member', allocation_pct: 30, created_at: now() });
  // E3: membership on a WON opportunity must NOT count as load → stays on bench
  await db.insert('opportunity', { id: 'O2', title_ar: 'فرصة مكسوبة', sector_id: 'S1', stage_id: 'WONX', created_at: now() });
  await db.insert('membership', { id: 'M2', employee_id: 'E3', group_kind: 'opportunity', group_id: 'O2', role_in_group: 'member', allocation_pct: 50, created_at: now() });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('roster month math: allocations sum into month cells; soft load lands on the chosen month', async () => {
  const { roster, currentMonth } = await org.staffingRoster(admin, { month: 7 });
  assert.equal(currentMonth, 7);
  const e1 = roster.find((e) => e.id === 'E1');
  assert.equal(e1.months[6], 130, 'July = 60% + 70%');
  assert.equal(e1.months[5], 60, 'June = 60%');
  assert.equal(e1.currentUtil, 130);
  const e4 = roster.find((e) => e.id === 'E4');
  assert.equal(e4.currentUtil, 30, 'opportunity soft load counts on the current month');
  assert.equal(e4.months[6], 30);
  assert.equal(e4.opportunities.length, 1);
  assert.equal(e4.opportunities[0].label, 'فرصة');
  assert.equal(e4.opportunities[0].pct, 30);
  assert.equal(e4.projectCount, 0);
});

test('summary block: capacity / assignedNow / bench / overloaded / underused', async () => {
  const { summary } = await org.staffingRoster(admin, { month: 7 });
  assert.equal(summary.capacityFte, 4, 'active employees only (E5 inactive excluded)');
  assert.equal(summary.assignedNowFte, 1.8, 'Σ fractions = 1.3 + 0.2 + 0 + 0.3');
  assert.equal(summary.benchNow, 1, 'E3 only — WON-opportunity membership is not load');
  assert.equal(summary.overloadedNow, 1, 'E1 at 130% (> 110)');
  assert.equal(summary.underusedNow, 2, 'E2 (20%) and E4 (30%)');
});

test('monthDelta = currentUtil − prevMonthUtil (soft load excluded from prev)', async () => {
  const { roster } = await org.staffingRoster(admin, { month: 7 });
  const e1 = roster.find((e) => e.id === 'E1');
  assert.equal(e1.prevMonthUtil, 60);
  assert.equal(e1.monthDelta, 70, '130 now − 60 in June');
  const e2 = roster.find((e) => e.id === 'E2');
  assert.equal(e2.monthDelta, 20);
  const e4 = roster.find((e) => e.id === 'E4');
  assert.equal(e4.monthDelta, 30, 'soft load counts as new load vs an empty June');
});

test('opts.month override is deterministic: June view shifts the numbers', async () => {
  const { roster, summary } = await org.staffingRoster(admin, { month: 6 });
  const e1 = roster.find((e) => e.id === 'E1');
  assert.equal(e1.currentUtil, 60, 'June = 60% only');
  assert.equal(e1.monthDelta, 60, 'May was empty');
  const e4 = roster.find((e) => e.id === 'E4');
  assert.equal(e4.currentUtil, 30, 'soft load follows the chosen "now" month');
  assert.equal(summary.overloadedNow, 0, 'no one exceeds 110 in June');
  assert.equal(summary.benchNow, 2, 'E2 and E3 have nothing in June (E4 carries soft load)');
});

test('roster is sorted busiest-now first', async () => {
  const { roster } = await org.staffingRoster(admin, { month: 7 });
  assert.equal(roster[0].id, 'E1');
  assert.ok(roster.findIndex((e) => e.id === 'E1') < roster.findIndex((e) => e.id === 'E3'));
});

test('sector-scoped user is locked to their sector', async () => {
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع ٢', active: 1, created_at: now() });
  await db.insert('employee', { id: 'EX', name_ar: 'خارج النطاق', sector_id: 'S2', status: 'نشط', active: 1, created_at: now() });
  const lead = { id: 'u_l', username: 'lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
  const { roster } = await org.staffingRoster(lead, { sector: 'S2', month: 7 });
  assert.ok(!roster.some((e) => e.id === 'EX'), 'sector filter from a sector-scoped user cannot escape the lock');
});
