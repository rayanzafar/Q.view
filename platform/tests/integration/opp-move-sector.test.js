// moveSector: نقل الفرصة بين القطاعات — من يملك تعديلها يسلّمها، وتخرج من نطاقه بعد النقل
// (لا يُرفض الرد بإعادة قراءتها). القطاع الشركي ينقل أي فرصة؛ من لا يملك التعديل يُمنع.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-move-sector.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, opps;
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const lead = { id: 'u_sl', username: 'sl', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const admin = { id: 'u_ad', username: 'ad', role_id: 'admin', sector_id: null, scope: 'company', projectIds: new Set(), teamIds: new Set() };
const cons = { id: 'u_cn', username: 'cn', role_id: 'consultant', sector_id: 'S1', scope: 'own', projectIds: new Set(), teamIds: new Set() };

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
  for (const u of [lead, admin, cons]) await db.insert('app_user', { id: u.id, username: u.username, role_id: u.role_id, sector_id: u.sector_id, scope: u.scope, active: 1, created_at: now });
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة الحلول', sector_id: 'S1', owner_user_id: 'u_cn', stage_id: 'LEAD', value_halalas: 100000, stage_changed_at: now, created_at: now });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('sector lead hands an opportunity off to another sector (succeeds even though it leaves their scope)', async () => {
  const res = await opps.moveSector(ctx(lead), 'O1', 'S2', 'إعادة إسناد');
  assert.equal(res.ok, true);
  assert.equal(res.sector_id, 'S2');
  const row = await db.get('SELECT sector_id FROM opportunity WHERE id = ?', ['O1']);
  assert.equal(row.sector_id, 'S2', 'الفرصة انتقلت فعلاً إلى S2 في القاعدة');
});

test('admin (company scope) moves it back', async () => {
  const res = await opps.moveSector(ctx(admin), 'O1', 'S1');
  assert.equal(res.sector_id, 'S1');
});

test('a consultant who does not own the opportunity is refused', async () => {
  const other = { ...cons, id: 'u_other', username: 'other' };
  await assert.rejects(() => opps.moveSector(ctx(other), 'O1', 'S2'), /صلاح|forbidden/i);
  const row = await db.get('SELECT sector_id FROM opportunity WHERE id = ?', ['O1']);
  assert.equal(row.sector_id, 'S1', 'لم تتغير');
});

test('unknown target sector is rejected', async () => {
  await assert.rejects(() => opps.moveSector(ctx(admin), 'O1', 'NOPE'), /قطاع غير معروف/);
});
