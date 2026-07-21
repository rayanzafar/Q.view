// Clients LIST aggregates (Lane D v2.1) — the decision-table numbers behind /app/clients.
// Isolated temp DB + real HTTP (createApp + grafted clientsRouter, same as clients.test.js).
// Seeds ONE client with fully known opps/contracts/invoices/revenue and asserts every new
// aggregate exactly, then cross-checks المستحق/المرجّح against the 360 payload so the list
// and the client page can never tell two different stories.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-clients-list.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, config, server, base, FY;

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const day = (daysAgo) => iso(daysAgo).slice(0, 10);

async function jf(path, { method = 'GET', body, as = 'admin' } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: `sanad_sid=sess_${as}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  ({ config } = await import('../../src/core/config.js'));
  FY = config.fiscalYear;
  await migrate();
  await seedRbac();

  const now = ids.nowIso();
  for (const [sid, name, ord] of [['S1', 'قطاع الأعمال', 1], ['S2', 'قطاع التقنية', 2], ['S3', 'قطاع التطوير', 3]])
    await db.insert('sector', { id: sid, name_ar: name, sort_order: ord, active: 1, created_at: now });
  await db.insert('stage', { id: 'LEAD', name_ar: 'رصد', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await db.insert('stage', { id: 'PROP', name_ar: 'عرض مقدم', default_win_pct: 60, sort_order: 2, is_won: 0, is_lost: 0 });
  await db.insert('stage', { id: 'WON', name_ar: 'فوز', default_win_pct: 100, sort_order: 3, is_won: 1, is_lost: 0 });
  await db.insert('stage', { id: 'LOST', name_ar: 'خسارة', default_win_pct: 0, sort_order: 4, is_won: 0, is_lost: 1 });

  const personas = [
    ['admin', 'admin', null, 'company'],
    ['lead', 'sector_lead', 'S1', 'sector'],
  ];
  const expires = new Date(Date.now() + 86400000).toISOString();
  for (const [key, role, sector, scope] of personas) {
    await db.insert('app_user', { id: 'u_' + key, username: 'demo.' + key, name_ar: 'مستخدم ' + key,
      role_id: role, sector_id: sector, scope, active: 1, created_at: now });
    await db.insert('session', { id: 'sess_' + key, user_id: 'u_' + key, created_at: now, expires_at: expires });
  }
  // relationship-owner candidates (no login needed — only the name join matters)
  await db.insert('app_user', { id: 'u_own1', username: 'own1', name_ar: 'أحمد المالك', role_id: 'employee', scope: 'own', active: 1, created_at: now });
  await db.insert('app_user', { id: 'u_own2', username: 'own2', name_ar: 'سعد الثاني', role_id: 'employee', scope: 'own', active: 1, created_at: now });

  // ── client CA: every aggregate has a hand-computable value ──
  await db.insert('client', { id: 'CA', code: 'CL-A', name_ar: 'هيئة الاختبار الرقمية', type: 'حكومي', active: 1, created_at: now });
  // open: 100k×60% (S1, own1) + 200k×25% (S2, own1) + 50k×40% (S1, own2) → pipe 350k · weighted 130k · owner own1 (2 vs 1)
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة أ', client_id: 'CA', sector_id: 'S1', owner_user_id: 'u_own1',
    stage_id: 'PROP', win_pct: 60, value_halalas: 100000, year: FY, created_at: now });
  await db.insert('opportunity', { id: 'O2', title_ar: 'فرصة ب', client_id: 'CA', sector_id: 'S2', owner_user_id: 'u_own1',
    stage_id: 'LEAD', win_pct: 25, value_halalas: 200000, year: FY, created_at: now });
  await db.insert('opportunity', { id: 'O3', title_ar: 'فرصة ج', client_id: 'CA', sector_id: 'S1', owner_user_id: 'u_own2',
    stage_id: 'PROP', win_pct: 40, value_halalas: 50000, year: FY, created_at: now });
  // decided: 1 real won (500k) + 1 historic won (300k, excluded) + 1 lost (120k)
  await db.insert('opportunity', { id: 'O4', title_ar: 'فوز حقيقي', client_id: 'CA', sector_id: 'S1', owner_user_id: 'u_own2',
    stage_id: 'WON', win_pct: 100, value_halalas: 500000, year: FY, exclude_from_sales: 0, stage_changed_at: iso(10), created_at: now });
  await db.insert('opportunity', { id: 'O5', title_ar: 'فوز تاريخي مستورد', client_id: 'CA', sector_id: 'S1',
    stage_id: 'WON', win_pct: 100, value_halalas: 300000, year: FY - 2, exclude_from_sales: 1, stage_changed_at: iso(700), created_at: now });
  await db.insert('opportunity', { id: 'O6', title_ar: 'خسارة', client_id: 'CA', sector_id: 'S1',
    stage_id: 'LOST', win_pct: 0, value_halalas: 120000, year: FY, stage_changed_at: iso(90), created_at: now });
  // soft-deleted giant won — must never leak into any aggregate
  await db.insert('opportunity', { id: 'O7', title_ar: 'محذوفة', client_id: 'CA', sector_id: 'S1',
    stage_id: 'WON', win_pct: 100, value_halalas: 9999999, year: FY, deleted_at: now, created_at: now });
  // projects: 1 active (S1) + 1 completed (S3 → sector union only)
  await db.insert('project', { id: 'P1', name_ar: 'مشروع التحول', client_id: 'CA', sector_id: 'S1',
    status: 'IN_PROGRESS', progress_pct: 40, start_date: day(120), created_at: now });
  await db.insert('project', { id: 'P2', name_ar: 'مشروع منتهٍ', client_id: 'CA', sector_id: 'S3',
    status: 'COMPLETED', progress_pct: 100, start_date: day(500), end_date: day(200), created_at: now });
  // contracts: 900k + 100k → 1,000k / 2 عقود
  await db.insert('contract', { id: 'T1', code: 'CT-1', client_id: 'CA', project_id: 'P1', sector_id: 'S1',
    value_halalas: 900000, status: 'ACTIVE', signed_at: day(100), created_at: now });
  await db.insert('contract', { id: 'T2', code: 'CT-2', client_id: 'CA', sector_id: 'S1',
    value_halalas: 100000, status: 'ACTIVE', signed_at: day(60), created_at: now });
  // revenue: FY 750k · FY-1 250k (growth base)
  await db.insert('revenue_line', { id: 'R1', project_id: 'P1', sector_id: 'S1', amount_halalas: 750000, month: 3, year: FY, created_at: now });
  await db.insert('revenue_line', { id: 'R2', project_id: 'P1', sector_id: 'S1', amount_halalas: 250000, month: 11, year: FY - 1, created_at: now });
  // invoices → open AR 280k of which overdue 200k (exactly the clientOverview arithmetic):
  //   I1 direct, 300k ISSUED past-due, collected 100k → out 200k (overdue)
  await db.insert('invoice', { id: 'I1', code: 'INV-1', client_id: 'CA', project_id: 'P1', sector_id: 'S1',
    amount_halalas: 300000, status: 'ISSUED', issue_date: day(80), due_date: day(50), created_at: now });
  await db.insert('collection', { id: 'L1', invoice_id: 'I1', amount_halalas: 100000, collected_at: day(40), created_at: now });
  //   I2 legacy (client via project), 80k ISSUED due in the future → out 80k (not overdue)
  await db.insert('invoice', { id: 'I2', code: 'INV-2', client_id: null, project_id: 'P1', sector_id: 'S1',
    amount_halalas: 80000, status: 'ISSUED', issue_date: day(20), due_date: day(-30), created_at: now });
  //   I3 fully paid → out 0
  await db.insert('invoice', { id: 'I3', code: 'INV-3', client_id: 'CA', project_id: 'P1', sector_id: 'S1',
    amount_halalas: 50000, status: 'PAID', issue_date: day(70), due_date: day(40), created_at: now });
  await db.insert('collection', { id: 'L3', invoice_id: 'I3', amount_halalas: 50000, collected_at: day(35), created_at: now });
  //   I4 draft → ignored entirely
  await db.insert('invoice', { id: 'I4', code: 'INV-4', client_id: 'CA', sector_id: 'S1',
    amount_halalas: 999999, status: 'DRAFT', issue_date: day(5), created_at: now });
  //   I5 over-collected (40k invoiced, 60k collected) past-due → capped at 0, never negative
  await db.insert('invoice', { id: 'I5', code: 'INV-5', client_id: 'CA', sector_id: 'S1',
    amount_halalas: 40000, status: 'ISSUED', issue_date: day(90), due_date: day(60), created_at: now });
  await db.insert('collection', { id: 'L5a', invoice_id: 'I5', amount_halalas: 30000, collected_at: day(50), created_at: now });
  await db.insert('collection', { id: 'L5b', invoice_id: 'I5', amount_halalas: 30000, collected_at: day(45), created_at: now });

  // ── client CB: pipeline-only (no revenue, ownerless open opp) — sort + null-owner behavior ──
  await db.insert('client', { id: 'CB', code: 'CL-B', name_ar: 'شركة بلا إيراد', type: 'خاص', active: 1, created_at: now });
  await db.insert('opportunity', { id: 'O8', title_ar: 'فرصة بلا مالك', client_id: 'CB', sector_id: 'S1',
    stage_id: 'PROP', win_pct: 50, value_halalas: 400000, year: FY, created_at: now });

  const { createApp } = await import('../../src/server.js');
  const { clientsRouter } = await import('../../src/modules/clients/clients.routes.js');
  const { errorHandler } = await import('../../src/core/http/errors.js');
  const app = await createApp();
  app.use('/api', clientsRouter);
  app.use(errorHandler());
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
});

test('list aggregates: every new field carries the exact hand-computed number', async () => {
  const { status, body } = await jf('/api/clients');
  assert.equal(status, 200);
  const ca = body.find((c) => c.id === 'CA');
  assert.ok(ca, 'client CA in the list');

  // الفرص المفتوحة
  assert.equal(ca.open_opps, 3);
  assert.equal(ca.open_pipeline_halalas, 350000);
  assert.equal(ca.weighted_pipeline_halalas, 130000, '100k×60% + 200k×25% + 50k×40%');
  // الفوز/الخسارة (التاريخي على حدة، والمحذوف لا يظهر أبداً)
  assert.equal(ca.won_count, 1);
  assert.equal(ca.won_value_halalas, 500000, 'excluded historic + soft-deleted never counted');
  assert.equal(ca.hist_won_count, 1);
  assert.equal(ca.lost_count, 1);
  // العقود
  assert.equal(ca.contracts_count, 2);
  assert.equal(ca.contracts_value_halalas, 1000000);
  // المستحق
  assert.equal(ca.open_ar_halalas, 280000, 'I1 200k + I2 80k; PAID/DRAFT/over-collected = 0');
  assert.equal(ca.overdue_ar_halalas, 200000, 'only I1 is past due');
  // الإيراد والنمو والمشاريع
  assert.equal(ca.fy_revenue_halalas, 750000);
  assert.equal(ca.prev_fy_revenue_halalas, 250000);
  assert.equal(ca.active_projects, 1);
  // القطاعات (اتحاد فرص+مشاريع+عقود، أسماء عربية بترتيب القطاعات)
  assert.deepEqual(ca.sectors, ['قطاع الأعمال', 'قطاع التقنية', 'قطاع التطوير']);
  // مالك العلاقة (الأكثر فرصاً مفتوحة)
  assert.equal(ca.rel_owner, 'أحمد المالك');
  assert.equal(ca.rel_owner_user_id, 'u_own1');
  assert.equal(ca.relationship, 'نشطة');
});

test('client with no revenue/owner: zeros and null owner, never NaN', async () => {
  const { body } = await jf('/api/clients');
  const cb = body.find((c) => c.id === 'CB');
  assert.ok(cb);
  assert.equal(cb.open_opps, 1);
  assert.equal(cb.open_pipeline_halalas, 400000);
  assert.equal(cb.weighted_pipeline_halalas, 200000);
  assert.equal(cb.won_count + cb.hist_won_count + cb.lost_count, 0);
  assert.equal(cb.contracts_value_halalas, 0);
  assert.equal(cb.open_ar_halalas, 0);
  assert.equal(cb.fy_revenue_halalas, 0);
  assert.equal(cb.rel_owner, null, 'opp without owner ⇒ no relationship owner');
  assert.deepEqual(cb.sectors, ['قطاع الأعمال']);
  for (const [k, v] of Object.entries(cb)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} is a finite number`);
});

test('list numbers MATCH the 360 page for the same client (المستحق/المرجّح/الإيراد)', async () => {
  const list = (await jf('/api/clients')).body.find((c) => c.id === 'CA');
  const { body: o } = await jf('/api/clients/CA/360');
  assert.equal(list.open_ar_halalas, o.kpis.open_ar_halalas, 'open AR identical to the 360 kpi');
  assert.equal(list.overdue_ar_halalas, o.invoices_summary.overdue, 'overdue identical to the 360 summary');
  assert.equal(list.weighted_pipeline_halalas, o.kpis.weighted_pipeline_halalas);
  assert.equal(list.open_pipeline_halalas, o.kpis.open_pipeline_halalas);
  assert.equal(list.fy_revenue_halalas, o.kpis.fy_revenue_halalas);
  assert.equal(list.active_projects, o.kpis.active_projects);
  assert.equal(list.won_count + list.hist_won_count, o.opportunities.won.length, 'list won split sums to the 360 won list');
  assert.equal(list.lost_count, o.opportunities.lost.length);
});

test('default sort = largest relationship first (revenue ثم pipeline); pipeline sort flips it', async () => {
  const def = (await jf('/api/clients')).body;
  assert.deepEqual(def.map((c) => c.id), ['CA', 'CB'], 'CA (750k revenue) before CB (0 revenue)');
  const byPipe = (await jf('/api/clients?sort=pipeline')).body;
  assert.deepEqual(byPipe.map((c) => c.id), ['CB', 'CA'], 'CB (400k pipe) before CA (350k pipe)');
});

test('sector scope: S1 lead sees the aggregates without leaking other sectors’ names beyond the client footprint', async () => {
  const { status, body } = await jf('/api/clients', { as: 'lead' });
  assert.equal(status, 200);
  const ca = body.find((c) => c.id === 'CA');
  assert.ok(ca, 'CA has an S1 footprint so the S1 lead sees it');
  assert.equal(ca.open_ar_halalas, 280000, 'aggregates identical for in-scope viewers');
  assert.equal(ca.rel_owner, 'أحمد المالك');
});

test('/app/clients page renders the 6-column decision table with populated cells (no NaN/undefined leaks)', async () => {
  const r = await fetch(base + '/app/clients', { headers: { cookie: 'sanad_sid=sess_admin' } });
  assert.equal(r.status, 200);
  const html = await r.text();
  // الأعمدة الجديدة: الهوية (تطوي النوع+القطاعات) · العلاقة+آخر تواصل · الفرص المفتوحة · الفوز·الخسارة · مشاريع نشطة · المال (إيراد+مستحق)
  for (const needle of ['هيئة الاختبار الرقمية', 'قطاع الأعمال', 'حالة العلاقة',
    'الفرص المفتوحة', 'الفوز · الخسارة', 'مشاريع نشطة', `إيراد ${FY}`, 'العميل الأول', 'نمو الإيراد',
    `نسبة الفوز · ${FY}`, 'تاريخي', '1 فوز', '1 خسارة', '+1 تاريخي', 'متأخر السداد'])
    assert.ok(html.includes(needle), `page contains «${needle}»`);
  // أعمدة أُسقطت لخلوّها/طُويت في 360، ومؤشر الفوز صار سنوياً موحّداً مع لوحة الفرص
  for (const gone of ['مالك العلاقة', 'قيمة العقود', 'نسبة الفوز التاريخية'])
    assert.ok(!html.includes(gone), `dropped/renamed «${gone}» no longer present`);
  assert.ok(!/NaN|undefined/.test(html), 'no NaN/undefined in the rendered page');
});
