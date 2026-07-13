// Security + correctness tests. Bootstraps an isolated temp DB, then asserts RBAC
// scope filtering + field-level redaction at the service layer (the real enforcement point).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-security.db');
process.env.SANAD_DB = TEST_DB;

let db, seedRbac, migrate, can, redact, matrix, opps, projects, ids, pw;

before(async () => {
  rmSync(TEST_DB, { force: true }); rmSync(TEST_DB + '-wal', { force: true }); rmSync(TEST_DB + '-shm', { force: true });
  db = await import('../src/core/db/index.js');
  ({ migrate } = await import('../scripts/migrate.js'));
  ({ seedRbac } = await import('../scripts/seed-rbac.js'));
  ({ can, redact } = await import('../src/core/rbac/index.js'));
  matrix = await import('../src/core/rbac/matrix.js');
  ids = await import('../src/core/util/ids.js');
  pw = await import('../src/core/auth/password.js');
  migrate();
  seedRbac();
  const { loadGrants } = await import('../src/core/rbac/index.js');
  loadGrants();
  // fixtures: 2 sectors, 2 projects, 2 employees
  const now = ids.nowIso();
  db.insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  db.insert('sector', { id: 'S1', name_ar: 'قطاع 1', active: 1, created_at: now });
  db.insert('sector', { id: 'S2', name_ar: 'قطاع 2', active: 1, created_at: now });
  db.insert('project', { id: 'P1', name_ar: 'مشروع 1', sector_id: 'S1', status: 'IN_PROGRESS',
    actual_spend_halalas: 500000, margin_pct: 22, created_at: now });
  db.insert('project', { id: 'P2', name_ar: 'مشروع 2', sector_id: 'S2', status: 'IN_PROGRESS',
    actual_spend_halalas: 900000, margin_pct: 30, created_at: now });
  db.insert('opportunity', { id: 'O1', title_ar: 'فرصة 1', sector_id: 'S1', stage_id: 'LEAD', value_halalas: 100000, created_at: now });
  db.insert('opportunity', { id: 'O2', title_ar: 'فرصة 2', sector_id: 'S2', stage_id: 'LEAD', value_halalas: 200000, created_at: now });
  db.insert('employee', { id: 'E1', name_ar: 'موظف 1', sector_id: 'S1', salary_halalas: 2400000, created_at: now });
  opps = await import('../src/modules/crm/opportunities.js');
  projects = await import('../src/modules/pmo/projects.js');
});

after(() => { db.close(); rmSync(TEST_DB, { force: true }); rmSync(TEST_DB + '-wal', { force: true }); rmSync(TEST_DB + '-shm', { force: true }); });

const U = (role, sector, scope = 'own') => ({ id: 'u_' + role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });

test('password: hash/verify round-trips and rejects wrong password', () => {
  const h = pw.hashPassword('S3cret!!');
  assert.equal(pw.verifyPassword('S3cret!!', h), true);
  assert.equal(pw.verifyPassword('wrong', h), false);
});

test('money: SAR↔halalas round-trips as integers', () => {
  assert.equal(ids.toHalalas(2597760), 259776000);
  assert.equal(ids.toSar(259776000), 2597760);
});

test('RBAC: admin can do everything; employee cannot read opportunities', () => {
  assert.equal(can(U('admin', null, 'company'), 'read', 'opportunity'), true);
  assert.equal(can(U('employee', 'S1'), 'read', 'opportunity'), false);
});

test('RBAC scope: sector_lead reads own sector only', () => {
  const lead = U('sector_lead', 'S1', 'sector');
  assert.equal(can(lead, 'read', 'opportunity', { sector_id: 'S1' }), true);
  assert.equal(can(lead, 'read', 'opportunity', { sector_id: 'S2' }), false);
});

test('list scoping: bd_manager in S1 sees only S1 opportunities', () => {
  const bd = U('bd_manager', 'S1', 'own');
  const rows = opps.listOpportunities(bd);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((o) => o.sector_id === 'S1'), 'bd must not see other sectors');
});

test('list scoping: employee sees zero opportunities (no permission)', () => {
  assert.equal(opps.listOpportunities(U('employee', 'S1')).length, 0);
});

test('redaction: salary hidden from sector_lead, visible to hr/admin', () => {
  const emp = db.get('SELECT * FROM employee WHERE id = ?', ['E1']);
  const lead = redact(U('sector_lead', 'S1', 'sector'), 'employee', emp);
  assert.equal(lead.salary_halalas, null);
  assert.equal(lead._redacted_salary_halalas, true);
  const hr = redact(U('hr', null, 'company'), 'employee', emp);
  assert.equal(hr.salary_halalas, 2400000);
  const admin = redact(U('admin', null, 'company'), 'employee', emp);
  assert.equal(admin.salary_halalas, 2400000);
});

test('redaction: project cost/margin hidden from bd, visible to finance', () => {
  const proj = db.get('SELECT * FROM project WHERE id = ?', ['P1']);
  const bd = redact(U('bd_manager', 'S1'), 'project', proj);
  assert.equal(bd.actual_spend_halalas, null);
  assert.equal(bd.margin_pct, null);
  const fin = redact(U('finance', null, 'company'), 'project', proj);
  assert.equal(fin.actual_spend_halalas, 500000);
  assert.equal(fin.margin_pct, 22);
});

test('list redaction end-to-end: finance list carries cost, bd list does not', () => {
  const finRows = projects.listProjects(U('finance', null, 'company'));
  assert.ok(finRows.some((p) => p.actual_spend_halalas != null), 'finance should see cost');
  const bdRows = projects.listProjects(U('bd_manager', 'S1'));
  assert.ok(bdRows.every((p) => p.actual_spend_halalas == null), 'bd must never receive cost values');
});

test('regression: project-scope user lists projects by id (not project_id) without SQL error', () => {
  // project_manager has scope=project on the project resource. The project table keys on `id`,
  // so the scope filter must use `id IN (...)`, never `project_id` (which does not exist here).
  const pm = { id: 'u_pm', role_id: 'project_manager', sector_id: 'S1', scope: 'project',
    projectIds: new Set(['P1']), teamIds: new Set() };
  const rows = projects.listProjects(pm); // must NOT throw "no such column: project_id"
  assert.deepEqual(rows.map((p) => p.id), ['P1'], 'PM sees exactly their own project');
  // an empty project set yields no rows (never all projects)
  const pmEmpty = { ...pm, projectIds: new Set() };
  assert.equal(projects.listProjects(pmEmpty).length, 0);
});

test('regression: consultant lists opportunities at own-scope without SQL error', () => {
  // opportunity has no project_id column; consultant reads it at own-scope, filtered by owner.
  const consultant = { id: 'u_cons', role_id: 'consultant', sector_id: 'S1', scope: 'project',
    projectIds: new Set(['P1']), teamIds: new Set() };
  const rows = opps.listOpportunities(consultant); // must NOT throw
  assert.ok(rows.every((o) => o.owner_user_id === 'u_cons'), 'consultant sees only owned opportunities');
});
