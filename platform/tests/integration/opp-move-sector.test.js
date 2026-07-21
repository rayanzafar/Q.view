// moveSector: hand an opportunity from one sector to another — scope-checked + audited.
// These assertions are invariants shared by BOTH the current service and the fixed version
// on main (they intentionally do NOT pin the return-shape or the sector-lead cross-move
// outcome, which differ between versions), so the test stays green across the merge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-opp-move-sector.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, opps;
const U = (role, sector, scope = 'own') => ({
  id: 'u_' + role, username: role, role_id: role, sector_id: sector, scope,
  projectIds: new Set(), teamIds: new Set(),
});
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const admin = U('admin', null, 'company');
const cons = U('consultant', 'S1', 'own');

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');

  const now = ids.nowIso();
  await db.insert('stage', { id: 'LEAD', name_ar: 'فرصة أولية', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  for (const s of ['S1', 'S2']) await db.insert('sector', { id: s, name_ar: 'قطاع ' + s, active: 1, created_at: now });
  await db.insert('sector', { id: 'S3OFF', name_ar: 'قطاع متوقف', active: 0, created_at: now });
  for (const r of ['admin', 'consultant']) {
    await db.insert('app_user', { id: 'u_' + r, username: r, role_id: r, sector_id: r === 'admin' ? null : 'S1', scope: r === 'admin' ? 'company' : 'own', active: 1, created_at: now });
  }
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة الحلول', sector_id: 'S1', owner_user_id: 'u_admin', stage_id: 'LEAD', value_halalas: 100000, stage_changed_at: now, created_at: now });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('company scope hands an opportunity to another active sector, and it is audited', async () => {
  assert.equal((await db.get('SELECT sector_id FROM opportunity WHERE id=?', ['O1'])).sector_id, 'S1');
  await opps.moveSector(ctx(admin), 'O1', 'S2', 'أنسب لخبرة القطاع الآخر');
  assert.equal((await db.get('SELECT sector_id FROM opportunity WHERE id=?', ['O1'])).sector_id, 'S2', 'sector_id updated in the DB');
  const aud = await db.get("SELECT * FROM audit_log WHERE resource='opportunity' AND action='update' AND resource_id='O1' LIMIT 1");
  assert.ok(aud, 'the hand-off is written to the audit trail');
  await opps.moveSector(ctx(admin), 'O1', 'S1'); // restore for the following tests
});

test('an unknown or inactive sector is rejected with an Arabic error (not a crash)', async () => {
  await assert.rejects(() => opps.moveSector(ctx(admin), 'O1', 'NOPE'), /قطاع/);
  await assert.rejects(() => opps.moveSector(ctx(admin), 'O1', 'S3OFF'), /قطاع/);
  assert.equal((await db.get('SELECT sector_id FROM opportunity WHERE id=?', ['O1'])).sector_id, 'S1', 'sector unchanged after a rejected target');
});

test('a user without update rights on the opportunity cannot move it (403)', async () => {
  await assert.rejects(() => opps.moveSector(ctx(cons), 'O1', 'S2'), (e) => e.status === 403);
  assert.equal((await db.get('SELECT sector_id FROM opportunity WHERE id=?', ['O1'])).sector_id, 'S1', 'sector unchanged after a denied move');
});

test('moving to the same sector is a harmless no-op', async () => {
  await opps.moveSector(ctx(admin), 'O1', 'S1'); // must not throw
  assert.equal((await db.get('SELECT sector_id FROM opportunity WHERE id=?', ['O1'])).sector_id, 'S1');
});
