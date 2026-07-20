// Saved views: CRUD, the 20-per-user-per-page cap, default uniqueness, and strict
// own-only isolation (another user's view id behaves as not-found).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-saved-views.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, views;

const u1 = { id: 'u_one', username: 'one', role_id: 'employee', sector_id: 'S1', scope: 'own', projectIds: new Set(), teamIds: new Set() };
const u2 = { id: 'u_two', username: 'two', role_id: 'employee', sector_id: 'S1', scope: 'own', projectIds: new Set(), teamIds: new Set() };
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  views = await import('../../src/modules/views/views.js');
  const now = ids.nowIso();
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع', active: 1, created_at: now });
  for (const u of [u1, u2]) {
    await db.insert('app_user', { id: u.id, username: u.username, role_id: 'employee', sector_id: 'S1', scope: 'own', active: 1, created_at: now });
  }
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('saveView validates name and page', async () => {
  await assert.rejects(() => views.saveView(ctx(u1), { page: 'opportunities', name_ar: '  ' }), /اسم العرض مطلوب/);
  await assert.rejects(() => views.saveView(ctx(u1), { page: '', name_ar: 'عرض' }), /صفحة/);
  await assert.rejects(() => views.saveView(ctx(u1), { page: 'bad page!', name_ar: 'عرض' }), /صفحة/);
});

test('saveView stores an object params_json as a JSON string and audits', async () => {
  const v = await views.saveView(ctx(u1), { page: 'opportunities', name_ar: 'قطاع الحلول', params_json: { sector: 'SOLUTIONS', q: 'رقمي' } });
  assert.ok(v.id.startsWith('sv_'));
  assert.equal(v.page, 'opportunities');
  assert.deepEqual(JSON.parse(v.params_json), { sector: 'SOLUTIONS', q: 'رقمي' });
  assert.equal(v.is_default, 0);
  assert.ok(await db.get("SELECT id FROM audit_log WHERE resource='saved_view' AND action='create' AND resource_id=?", [v.id]), 'save is audited');
});

test('listViews is own-scoped — u2 sees none of u1’s views', async () => {
  assert.equal((await views.listViews(u1, 'opportunities')).length, 1);
  assert.equal((await views.listViews(u2, 'opportunities')).length, 0);
});

test('setDefault clears any other default on the same page (uniqueness)', async () => {
  const a = (await views.listViews(u1, 'opportunities'))[0];
  const b = await views.saveView(ctx(u1), { page: 'opportunities', name_ar: 'المتوقفة فقط', params_json: { q: 'متوقفة' } });
  await views.setDefault(ctx(u1), a.id);
  await views.setDefault(ctx(u1), b.id);
  const rows = await views.listViews(u1, 'opportunities');
  const defaults = rows.filter((r) => r.is_default === 1);
  assert.equal(defaults.length, 1, 'exactly one default per page');
  assert.equal(defaults[0].id, b.id, 'latest setDefault wins');
  // a default on ANOTHER page is untouched
  const other = await views.saveView(ctx(u1), { page: 'projects', name_ar: 'مشاريعي', params_json: {} });
  await views.setDefault(ctx(u1), other.id);
  assert.equal((await views.listViews(u1, 'opportunities')).filter((r) => r.is_default === 1).length, 1, 'default on opportunities survives');
});

test('another user cannot delete or default someone else’s view (not-found, no leak)', async () => {
  const mine = (await views.listViews(u1, 'opportunities'))[0];
  await assert.rejects(() => views.deleteView(ctx(u2), mine.id), (e) => e.status === 404);
  await assert.rejects(() => views.setDefault(ctx(u2), mine.id), (e) => e.status === 404);
  assert.equal((await views.listViews(u1, 'opportunities')).length, 2, 'nothing was deleted');
});

test('deleteView soft-deletes own view and audits', async () => {
  const rows = await views.listViews(u1, 'opportunities');
  const victim = rows.find((r) => r.is_default !== 1);
  await views.deleteView(ctx(u1), victim.id);
  assert.equal((await views.listViews(u1, 'opportunities')).length, 1);
  const raw = await db.get('SELECT deleted_at FROM saved_view WHERE id = ?', [victim.id]);
  assert.ok(raw.deleted_at, 'soft delete sets deleted_at');
  assert.ok(await db.get("SELECT id FROM audit_log WHERE resource='saved_view' AND action='delete' AND resource_id=?", [victim.id]), 'delete is audited');
  // deleting it again → 404
  await assert.rejects(() => views.deleteView(ctx(u1), victim.id), (e) => e.status === 404);
});

test('cap: a user cannot keep more than 20 views on one page', async () => {
  const have = (await views.listViews(u1, 'opportunities')).length;
  for (let i = have; i < 20; i++) {
    await views.saveView(ctx(u1), { page: 'opportunities', name_ar: 'عرض ' + i, params_json: { i } });
  }
  assert.equal((await views.listViews(u1, 'opportunities')).length, 20);
  await assert.rejects(() => views.saveView(ctx(u1), { page: 'opportunities', name_ar: 'الزائد' }), /الحد الأقصى/);
  // the cap is per page — another page still accepts views
  const ok = await views.saveView(ctx(u1), { page: 'my-opportunities', name_ar: 'عرض آخر' });
  assert.ok(ok.id);
  // and per user — u2 is unaffected
  const ok2 = await views.saveView(ctx(u2), { page: 'opportunities', name_ar: 'عرض المستخدم الثاني' });
  assert.ok(ok2.id);
});
