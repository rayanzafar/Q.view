// moveSector: نقل الفرصة بين القطاعات — من يملك تعديلها يسلّمها، وتخرج من نطاقه بعد النقل
// (لا يُرفض الرد بإعادة قراءتها)؛ النطاق الشركي ينقل أياً؛ من لا يملك التعديل يُمنع؛
// القطاع المجهول/المتوقف يُرفض بعربية؛ والنقل لنفس القطاع لا يضر. كل نقل يُدقَّق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-move-sector.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, opps;
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const U = (role, sector, scope) => ({ id: 'u_' + role, username: role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });
const lead = U('sector_lead', 'S1', 'sector');
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
  for (const u of [lead, admin, cons]) await db.insert('app_user', { id: u.id, username: u.username, role_id: u.role_id, sector_id: u.sector_id, scope: u.scope, active: 1, created_at: now });
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة الحلول', sector_id: 'S1', owner_user_id: 'u_consultant', stage_id: 'LEAD', value_halalas: 100000, stage_changed_at: now, created_at: now });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('sector lead hands the opportunity off to another sector (succeeds even though it leaves their scope), and it is audited', async () => {
  const res = await opps.moveSector(ctx(lead), 'O1', 'S2', 'إعادة إسناد');
  assert.equal(res.ok, true);
  assert.equal(res.sector_id, 'S2');
  assert.equal((await db.get('SELECT sector_id FROM opportunity WHERE id=?', ['O1'])).sector_id, 'S2', 'sector_id updated in the DB');
  const aud = await db.get("SELECT * FROM audit_log WHERE resource='opportunity' AND action='update' AND resource_id='O1' LIMIT 1");
  assert.ok(aud, 'the hand-off is written to the audit trail');
});

test('admin (company scope) moves it back', async () => {
  const res = await opps.moveSector(ctx(admin), 'O1', 'S1');
  assert.equal(res.sector_id, 'S1');
});

test('an unknown or inactive sector is rejected with an Arabic error (not a crash)', async () => {
  await assert.rejects(() => opps.moveSector(ctx(admin), 'O1', 'NOPE'), /قطاع/);
  await assert.rejects(() => opps.moveSector(ctx(admin), 'O1', 'S3OFF'), /قطاع/);
  assert.equal((await db.get('SELECT sector_id FROM opportunity WHERE id=?', ['O1'])).sector_id, 'S1', 'unchanged after a rejected target');
});

test('a user without update rights on the opportunity is refused (403)', async () => {
  const other = { ...cons, id: 'u_other', username: 'other' };
  await assert.rejects(() => opps.moveSector(ctx(other), 'O1', 'S2'), (e) => e.status === 403 || /صلاح|forbidden/i.test(e.message));
  assert.equal((await db.get('SELECT sector_id FROM opportunity WHERE id=?', ['O1'])).sector_id, 'S1', 'unchanged after a denied move');
});

test('moving to the same sector is a harmless no-op', async () => {
  await opps.moveSector(ctx(admin), 'O1', 'S1');
  assert.equal((await db.get('SELECT sector_id FROM opportunity WHERE id=?', ['O1'])).sector_id, 'S1');
});
