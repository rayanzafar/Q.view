// Stage-age + rot thresholds + no-next-action flags (deterministic: today is pinned via opts.today).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-opp-rot.db');
process.env.SANAD_DB = TEST_DB;

const TODAY = '2026-07-20';
let db, ids, opps;
const admin = { id: 'u_admin', username: 'admin', role_id: 'admin', sector_id: null, scope: 'company', projectIds: new Set(), teamIds: new Set() };

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
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع', active: 1, created_at: now });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: now });
  const stages = [
    ['LEAD', 'فرصة أولية', 10, 1, 0, 0], ['QUALIFIED', 'مؤهلة', 25, 2, 0, 0],
    ['PROPOSAL', 'قُدِّم العرض', 50, 3, 0, 0], ['NEGOTIATION', 'تفاوض', 75, 4, 0, 0],
    ['WON', 'مكسوبة', 100, 5, 1, 0],
  ];
  for (const [id_, name, wp, so, won, lost] of stages) {
    await db.insert('stage', { id: id_, name_ar: name, default_win_pct: wp, sort_order: so, is_won: won, is_lost: lost });
  }
  const mk = (id_, stage, changed, next, created = '2026-01-01T00:00:00.000Z') =>
    db.insert('opportunity', {
      id: id_, title_ar: 'فرصة ' + id_, sector_id: 'S1', stage_id: stage,
      value_halalas: 100000, win_pct: 10, next_action: next,
      stage_changed_at: changed, created_at: created,
    });
  await mk('A', 'LEAD', '2026-07-06T09:00:00.000Z', 'اتصال متابعة');   // 14 days = at threshold
  await mk('B', 'LEAD', '2026-07-05T23:59:00.000Z', null);              // 15 days   > 14
  await mk('C', 'PROPOSAL', '2026-06-29T00:00:00.000Z', 'عرض تقديمي'); // 21 days = at threshold
  await mk('D', 'PROPOSAL', '2026-06-28T00:00:00.000Z', '   ');         // 22 days   > 21 (blank action)
  await mk('E', 'NEGOTIATION', '2026-06-19T00:00:00.000Z', 'مسودة عقد'); // 31 > 30
  await mk('F', 'WON', '2026-01-10T00:00:00.000Z', null);               // old but won → never rots
  await mk('G', 'QUALIFIED', null, 'تأكيد الميزانية', '2026-07-10T00:00:00.000Z'); // falls back to created_at (10d)
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('ROT_THRESHOLDS is the exported contract (LEAD/QUALIFIED 14, PROPOSAL 21, NEGOTIATION 30)', () => {
  assert.deepEqual(opps.ROT_THRESHOLDS, { LEAD: 14, QUALIFIED: 14, PROPOSAL: 21, NEGOTIATION: 30 });
});

test('stage_age_days counts whole days from stage_changed_at to the bound today', async () => {
  const m = byId(await opps.listOpportunities(admin, {}, { today: TODAY }));
  assert.equal(m.A.stage_age_days, 14);
  assert.equal(m.B.stage_age_days, 15);
  assert.equal(m.C.stage_age_days, 21);
  assert.equal(m.D.stage_age_days, 22);
  assert.equal(m.E.stage_age_days, 31);
  assert.equal(m.G.stage_age_days, 10, 'null stage_changed_at falls back to created_at');
});

test('rot flags: strictly greater than the per-stage threshold; won/lost never rot', async () => {
  const m = byId(await opps.listOpportunities(admin, {}, { today: TODAY }));
  assert.equal(m.A.rot, false, 'age == threshold is not yet rot');
  assert.equal(m.B.rot, true, '15 > 14');
  assert.equal(m.C.rot, false, '21 == 21');
  assert.equal(m.D.rot, true, '22 > 21');
  assert.equal(m.E.rot, true, '31 > 30');
  assert.equal(m.F.rot, false, 'WON has no threshold → never rots');
  assert.equal(m.G.rot, false, '10 < 14');
});

test('no_next_action: null and whitespace-only count as missing; real text does not', async () => {
  const m = byId(await opps.listOpportunities(admin, {}, { today: TODAY }));
  assert.equal(m.A.no_next_action, false);
  assert.equal(m.B.no_next_action, true, 'null → missing');
  assert.equal(m.D.no_next_action, true, 'whitespace-only → missing');
  assert.equal(m.G.no_next_action, false);
});

test('deterministic: same today → same ages; different today shifts ages', async () => {
  const a = byId(await opps.listOpportunities(admin, {}, { today: TODAY }));
  const b = byId(await opps.listOpportunities(admin, {}, { today: TODAY }));
  assert.deepEqual(
    Object.values(a).map((r) => [r.id, r.stage_age_days, r.rot]),
    Object.values(b).map((r) => [r.id, r.stage_age_days, r.rot]));
  const later = byId(await opps.listOpportunities(admin, {}, { today: '2026-07-21' }));
  assert.equal(later.A.stage_age_days, 15);
  assert.equal(later.A.rot, true, 'one more day pushes A over the threshold');
  assert.equal(later.C.stage_age_days, 22);
  assert.equal(later.C.rot, true, 'C crosses its 21-day threshold too');
});

test('stageAgeDays helper clamps future dates to 0 and handles bad input as null', () => {
  assert.equal(opps.stageAgeDays({ stage_changed_at: '2026-07-25T00:00:00Z' }, TODAY), 0, 'future → 0, never negative');
  assert.equal(opps.stageAgeDays({ stage_changed_at: null, created_at: null }, TODAY), null);
  assert.equal(opps.stageAgeDays({ stage_changed_at: 'غير تاريخ' }, TODAY), null);
});

test('opportunityDetail carries the same flags + weighted value', async () => {
  const d = await opps.opportunityDetail(admin, 'B', { today: TODAY });
  assert.equal(d.stage_age_days, 15);
  assert.equal(d.rot, true);
  assert.equal(d.no_next_action, true);
  assert.equal(d.weighted_halalas, Math.round(100000 * 0.10));
  assert.ok(Array.isArray(d.team) && Array.isArray(d.activities), 'detail includes team + activities arrays');
  assert.ok(d.stages.every((s) => 'default_win_pct' in s), 'stage ladder exposes default_win_pct');
});
