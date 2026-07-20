// Opportunity-team service: add/list/remove members, team-row auto-create, audit trail,
// scope enforcement (consultant cannot touch an opportunity outside their own book).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-opp-team.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, oppteam;

const U = (role, sector, scope = 'own') => ({
  id: 'u_' + role, username: role, role_id: role, sector_id: sector, scope,
  projectIds: new Set(), teamIds: new Set(),
});
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const bd = U('bd_manager', 'S1', 'sector');
const cons = U('consultant', 'S1', 'own');

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  oppteam = await import('../../src/modules/crm/oppteam.js');

  const now = ids.nowIso();
  await db.insert('stage', { id: 'LEAD', name_ar: 'فرصة أولية', default_win_pct: 10, sort_order: 1 });
  for (const s of ['S1', 'S2']) await db.insert('sector', { id: s, name_ar: 'قطاع ' + s, active: 1, created_at: now });
  for (const r of ['admin', 'bd_manager', 'consultant']) {
    await db.insert('app_user', { id: 'u_' + r, username: r, role_id: r, sector_id: r === 'admin' ? null : 'S1', scope: r === 'admin' ? 'company' : 'own', active: 1, created_at: now });
  }
  await db.insert('employee', { id: 'E1', name_ar: 'سارة الأحمد', job_title: 'مستشارة أولى', sector_id: 'S1', active: 1, created_at: now });
  await db.insert('employee', { id: 'E2', name_ar: 'خالد العتيبي', job_title: 'محلل أعمال', sector_id: 'S1', active: 1, created_at: now });
  // O1 in the BD manager's sector; O2 in another sector owned by admin
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة الحلول', sector_id: 'S1', owner_user_id: 'u_bd_manager', stage_id: 'LEAD', value_halalas: 100000, stage_changed_at: now, created_at: now });
  await db.insert('opportunity', { id: 'O2', title_ar: 'فرصة قطاع آخر', sector_id: 'S2', owner_user_id: 'u_admin', stage_id: 'LEAD', value_halalas: 200000, stage_changed_at: now, created_at: now });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('addMember auto-creates the team container row and persists allocation_pct', async () => {
  const team = await oppteam.addMember(ctx(bd), 'O1', { employee_id: 'E1', role_in_group: 'lead', allocation_pct: 50 });
  assert.equal(team.length, 1);
  assert.equal(team[0].employee_id, 'E1');
  assert.equal(team[0].name_ar, 'سارة الأحمد');
  assert.equal(team[0].job_title, 'مستشارة أولى');
  assert.equal(team[0].role_in_group, 'lead');
  assert.equal(team[0].allocation_pct, 50);
  // team container row created once with the opp's sector
  const t = await db.all("SELECT * FROM team WHERE kind='opportunity' AND ref_id='O1' AND deleted_at IS NULL");
  assert.equal(t.length, 1, 'exactly one team row auto-created');
  assert.equal(t[0].sector_id, 'S1');
  // allocation persisted in the DB (not just in the response)
  const m = await db.get("SELECT allocation_pct FROM membership WHERE group_kind='opportunity' AND group_id='O1' AND employee_id='E1' AND deleted_at IS NULL");
  assert.equal(m.allocation_pct, 50);
  // audited
  const aud = await db.get("SELECT * FROM audit_log WHERE resource='opp_team' AND action='create'");
  assert.ok(aud, 'add is audited');
  assert.equal(aud.sector_id, 'S1');
});

test('second member joins the SAME team row (no duplicate container)', async () => {
  const team = await oppteam.addMember(ctx(bd), 'O1', { employee_id: 'E2', role_in_group: 'member' });
  assert.equal(team.length, 2);
  const t = await db.all("SELECT id FROM team WHERE kind='opportunity' AND ref_id='O1' AND deleted_at IS NULL");
  assert.equal(t.length, 1, 'container row not duplicated');
  // lead sorts before member
  assert.equal(team[0].role_in_group, 'lead');
});

test('duplicate member and unknown role are rejected with Arabic errors', async () => {
  await assert.rejects(() => oppteam.addMember(ctx(bd), 'O1', { employee_id: 'E1', role_in_group: 'member' }), /مسبق/);
  await assert.rejects(() => oppteam.addMember(ctx(bd), 'O1', { employee_id: 'E2', role_in_group: 'boss' }), /دور غير معروف/);
  await assert.rejects(() => oppteam.addMember(ctx(bd), 'O1', { employee_id: 'E2', role_in_group: 'member', allocation_pct: 150 }), /نسبة/);
});

test('consultant is denied on an opportunity outside their own book (403)', async () => {
  // consultant grant = opportunity read OWN only → O2 (owned by admin, sector S2) is invisible
  await assert.rejects(() => oppteam.getTeam(cons, 'O2'), (e) => e.status === 403);
  // and has no update grant at all → cannot manage any team, even in their sector
  await assert.rejects(() => oppteam.addMember(ctx(cons), 'O1', { employee_id: 'E2' }), (e) => e.status === 403);
});

test('getTeam respects read scope (admin sees, listing joins employee names)', async () => {
  const team = await oppteam.getTeam(U('admin', null, 'company'), 'O1');
  assert.equal(team.length, 2);
  for (const m of team) {
    assert.ok(m.membership_id && m.employee_id && m.name_ar, 'shape: membership_id/employee_id/name_ar');
  }
});

test('removeMember soft-deletes, audits, and returns the shrunken team', async () => {
  const before_ = await oppteam.getTeam(bd, 'O1');
  const target = before_.find((m) => m.employee_id === 'E2');
  const team = await oppteam.removeMember(ctx(bd), target.membership_id);
  assert.equal(team.length, 1);
  const row = await db.get('SELECT deleted_at FROM membership WHERE id = ?', [target.membership_id]);
  assert.ok(row.deleted_at, 'soft-deleted, not hard-deleted');
  assert.ok(await db.get("SELECT id FROM audit_log WHERE resource='opp_team' AND action='delete'"), 'remove is audited');
  // removing an unknown/deleted membership → 404
  await assert.rejects(() => oppteam.removeMember(ctx(bd), target.membership_id), (e) => e.status === 404);
});

test('re-adding a removed member works (dup-check ignores soft-deleted rows)', async () => {
  const team = await oppteam.addMember(ctx(bd), 'O1', { employee_id: 'E2', role_in_group: 'reviewer' });
  assert.equal(team.length, 2);
  assert.ok(team.some((m) => m.employee_id === 'E2' && m.role_in_group === 'reviewer'));
});
