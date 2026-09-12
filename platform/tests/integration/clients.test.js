// Clients module (WP11+WP12) — end-to-end over real HTTP (createApp + fetch) on an isolated
// temp DB: client CRUD + dedupe + audit, contacts, activities (log/list/filters), the §6
// clientOverview payload (exact keys + arithmetic), the relationship rule, and sector scoping.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-clients.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, config, server, base, FY;
let CX = null; // main fixture client id (created over HTTP in the first test)

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const day = (daysAgo) => iso(daysAgo).slice(0, 10);

// authenticated JSON fetch as one of the demo personas (session injected in before())
async function jf(path, { method = 'GET', body, as = 'lead' } = {}) {
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
  for (const [sid, name] of [['S1', 'قطاع 1'], ['S2', 'قطاع 2']])
    await db.insert('sector', { id: sid, name_ar: name, active: 1, created_at: now });
  await db.insert('stage', { id: 'LEAD', name_ar: 'رصد', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await db.insert('stage', { id: 'PROP', name_ar: 'عرض مقدم', default_win_pct: 60, sort_order: 2, is_won: 0, is_lost: 0 });
  await db.insert('stage', { id: 'WON', name_ar: 'فوز', default_win_pct: 100, sort_order: 3, is_won: 1, is_lost: 0 });
  await db.insert('stage', { id: 'LOST', name_ar: 'خسارة', default_win_pct: 0, sort_order: 4, is_won: 0, is_lost: 1 });

  const personas = [
    ['admin', 'admin', null, 'company'],
    ['lead', 'sector_lead', 'S1', 'sector'],
    ['viewer', 'viewer', 'S1', 'sector'],
  ];
  const expires = new Date(Date.now() + 86400000).toISOString();
  for (const [key, role, sector, scope] of personas) {
    await db.insert('app_user', { id: 'u_' + key, username: 'demo.' + key, name_ar: 'مستخدم ' + key,
      role_id: role, sector_id: sector, scope, active: 1, created_at: now });
    await db.insert('session', { id: 'sess_' + key, user_id: 'u_' + key, created_at: now, expires_at: expires });
  }

  // Real HTTP through the real app stack. api.routes.js is integration-owned (frozen to this
  // lane), so the clients router is grafted here exactly as the integration mount will run it:
  // under /api, after apiRouter's requireAuth(), with the JSON error envelope behind it.
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

// ── client CRUD ───────────────────────────────────────────────────────────────
test('POST /api/clients creates a client and writes an audit row', async () => {
  const r = await jf('/api/clients', { method: 'POST', as: 'lead',
    body: { name_ar: 'وزارة التجربة', type: 'حكومي', code: 'GOV-1', name_en: 'Ministry of Test' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.id, 'returns the created client');
  assert.equal(r.body.name_ar, 'وزارة التجربة');
  CX = r.body.id;
  const aud = await db.get("SELECT id FROM audit_log WHERE resource='client' AND action='create' AND resource_id = ?", [CX]);
  assert.ok(aud, 'audit row recorded for the create');
});

test('duplicate client name (normalized) is rejected with an Arabic message', async () => {
  const r = await jf('/api/clients', { method: 'POST', as: 'lead', body: { name_ar: '  وزارة   التجربة ' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /موجود/);
});

test('missing name is a 400 with an Arabic message', async () => {
  const r = await jf('/api/clients', { method: 'POST', as: 'lead', body: { type: 'خاص' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /اسم العميل/);
});

test('demo.viewer gets 403 on POST /api/clients', async () => {
  const r = await jf('/api/clients', { method: 'POST', as: 'viewer', body: { name_ar: 'عميل ممنوع' } });
  assert.equal(r.status, 403);
});

test('PATCH /api/clients/:id whitelists fields and audits', async () => {
  const r = await jf(`/api/clients/${CX}`, { method: 'PATCH', as: 'lead', body: { sector_market: 'قطاع حكومي', notes_hack: 'x' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.sector_market, 'قطاع حكومي');
  assert.equal(r.body.notes_hack, undefined, 'non-whitelisted field never lands');
});

// ── business fixtures around CX ──────────────────────────────────────────────
test('fixtures: opportunities, project, revenue, contract, invoices land around the client', async () => {
  const now = ids.nowIso();
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة مفتوحة', client_id: CX, sector_id: 'S1',
    stage_id: 'PROP', win_pct: 60, value_halalas: 100000, year: FY, created_at: now });
  await db.insert('opportunity', { id: 'O2', title_ar: 'فرصة مكسوبة', client_id: CX, sector_id: 'S1',
    stage_id: 'WON', win_pct: 100, value_halalas: 500000, year: FY, stage_changed_at: iso(10), created_at: now });
  await db.insert('opportunity', { id: 'O3', title_ar: 'فرصة مفقودة', client_id: CX, sector_id: 'S1',
    stage_id: 'LOST', win_pct: 0, value_halalas: 200000, year: FY, stage_changed_at: iso(90), created_at: now });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع التحول', client_id: CX, sector_id: 'S1',
    status: 'IN_PROGRESS', progress_pct: 40, start_date: day(120), created_at: now });
  await db.insert('revenue_line', { id: 'R1', project_id: 'P1', sector_id: 'S1', amount_halalas: 750000, month: 3, year: FY, created_at: now });
  await db.insert('revenue_line', { id: 'R2', project_id: 'P1', sector_id: 'S1', amount_halalas: 250000, month: 11, year: FY - 1, created_at: now });
  // unlinked company revenue in the same FY → concentration denominator ≠ client revenue
  await db.insert('revenue_line', { id: 'R3', project_id: null, sector_id: 'S2', amount_halalas: 250000, month: 5, year: FY, created_at: now });
  await db.insert('contract', { id: 'T1', code: 'CT-9', client_id: CX, project_id: 'P1', sector_id: 'S1',
    value_halalas: 900000, status: 'ACTIVE', signed_at: day(100), created_at: now });
  await db.insert('invoice', { id: 'I1', code: 'INV-1', client_id: CX, project_id: 'P1', sector_id: 'S1',
    amount_halalas: 300000, status: 'ISSUED', issue_date: day(80), due_date: day(50), created_at: now });
  await db.insert('collection', { id: 'L1', invoice_id: 'I1', amount_halalas: 100000, collected_at: day(40), created_at: now });
  await db.insert('invoice', { id: 'I2', code: 'INV-2', client_id: CX, project_id: 'P1', sector_id: 'S1',
    amount_halalas: 50000, status: 'PAID', issue_date: day(70), due_date: day(40), created_at: now });
  await db.insert('collection', { id: 'L2', invoice_id: 'I2', amount_halalas: 50000, collected_at: day(35), created_at: now });
  assert.equal((await db.get('SELECT COUNT(*) n FROM opportunity WHERE client_id = ?', [CX])).n, 3);
});

// ── contacts CRUD ────────────────────────────────────────────────────────────
test('contacts: add → edit → soft-delete round-trip', async () => {
  const add = await jf(`/api/clients/${CX}/contacts`, { method: 'POST', as: 'lead',
    body: { name: 'م. سالم القحطاني', title: 'مدير المشاريع', email: 'salem@example.gov.sa' } });
  assert.equal(add.status, 200);
  const cid = add.body.id;
  assert.ok(await db.get("SELECT id FROM audit_log WHERE resource='contact' AND action='create' AND resource_id = ?", [cid]));

  const edit = await jf(`/api/contacts/${cid}`, { method: 'PATCH', as: 'lead', body: { title: 'مدير عام' } });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.title, 'مدير عام');

  const del = await jf(`/api/contacts/${cid}`, { method: 'DELETE', as: 'lead' });
  assert.equal(del.status, 200);
  const row = await db.get('SELECT deleted_at FROM contact WHERE id = ?', [cid]);
  assert.ok(row.deleted_at, 'soft-deleted, never dropped');
  const o = await jf(`/api/clients/${CX}/360`, { as: 'lead' });
  assert.equal(o.body.contacts.length, 0, 'deleted contact leaves the 360 payload');
});

test('contact with no name is rejected in Arabic', async () => {
  const r = await jf(`/api/clients/${CX}/contacts`, { method: 'POST', as: 'lead', body: { title: 'بلا اسم' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /اسم جهة الاتصال/);
});

// ── activities ───────────────────────────────────────────────────────────────
test('logActivity: client-linked + opportunity-linked (sector inferred, client backfilled)', async () => {
  const a1 = await jf('/api/activities', { method: 'POST', as: 'lead',
    body: { kind: 'call', title: 'اتصال متابعة العرض', detail: 'اتفاق على اجتماع الأسبوع القادم', client_id: CX } });
  assert.equal(a1.status, 200);
  assert.equal(a1.body.sector_id, 'S1', 'client-only activity falls back to the actor sector');
  assert.equal(a1.body.source, 'app');

  const a2 = await jf('/api/activities', { method: 'POST', as: 'lead',
    body: { kind: 'meeting', title: 'اجتماع مراجعة النطاق', opportunity_id: 'O1' } });
  assert.equal(a2.status, 200);
  assert.equal(a2.body.client_id, CX, 'client inherited from the linked opportunity');
  assert.equal(a2.body.sector_id, 'S1', 'sector inferred from the linked opportunity');
});

test('logActivity validation: unknown kind, missing title, missing link', async () => {
  assert.equal((await jf('/api/activities', { method: 'POST', as: 'lead', body: { kind: 'fax', title: 'س', client_id: CX } })).status, 400);
  assert.equal((await jf('/api/activities', { method: 'POST', as: 'lead', body: { kind: 'call', client_id: CX } })).status, 400);
  assert.equal((await jf('/api/activities', { method: 'POST', as: 'lead', body: { kind: 'call', title: 'بلا ربط' } })).status, 400);
});

test('listActivities filters: client_id, opportunity_id, limit, before', async () => {
  const byClient = await jf(`/api/activities?client_id=${CX}`, { as: 'lead' });
  assert.equal(byClient.status, 200);
  assert.ok(byClient.body.length >= 2);
  assert.ok(byClient.body.every((a) => a.client_id === CX));

  const byOpp = await jf('/api/activities?opportunity_id=O1', { as: 'lead' });
  assert.equal(byOpp.body.length, 1);
  assert.equal(byOpp.body[0].kind, 'meeting');

  const limited = await jf(`/api/activities?client_id=${CX}&limit=1`, { as: 'lead' });
  assert.equal(limited.body.length, 1);
  const newestAt = limited.body[0].at;
  const before = await jf(`/api/activities?client_id=${CX}&limit=50&before=${encodeURIComponent(newestAt)}`, { as: 'lead' });
  assert.ok(before.body.every((a) => a.at < newestAt), 'before excludes the newest');
});

// ── the §6 payload ───────────────────────────────────────────────────────────
test('clientOverview: every §6 key exists with the right arithmetic', async () => {
  const { status, body: o } = await jf(`/api/clients/${CX}/360`, { as: 'lead' });
  assert.equal(status, 200);
  for (const key of ['client', 'contacts', 'kpis', 'activities', 'opportunities', 'projects',
    'contracts', 'invoices_summary', 'documents', 'yoy', 'concentration_pct'])
    assert.ok(key in o, `payload has ${key}`);
  for (const key of ['fy_revenue_halalas', 'lifetime_revenue_halalas', 'open_pipeline_halalas',
    'weighted_pipeline_halalas', 'active_projects', 'open_ar_halalas', 'last_activity_at', 'relationship'])
    assert.ok(key in o.kpis, `kpis has ${key}`);
  for (const key of ['open', 'won', 'lost', 'win_rate']) assert.ok(key in o.opportunities);
  for (const key of ['invoiced', 'collected', 'outstanding', 'overdue']) assert.ok(key in o.invoices_summary);

  assert.equal(o.kpis.open_pipeline_halalas, 100000);
  assert.equal(o.kpis.weighted_pipeline_halalas, 60000, 'Σ value×win_pct/100');
  // الإيراد صار **صافياً من الضريبة** (الترحيلة ٠١٩، قرار مالك: «افصل الضريبة عن المبلغ»).
  // وسطرا الإيراد هنا مُدرَجان بلا عمود صافٍ، فيُشتقّ عند القراءة: ٧٥٠٬٠٠٠ ÷ ١٫١٥ = ٦٥٢٬١٧٣
  // و٢٥٠٬٠٠٠ ÷ ١٫١٥ = ٢١٧٬٣٩١. الرقم لم يُضعَّف بل تبدّل معناه: صار إيراد الشركة لا مطالبتها.
  assert.equal(o.kpis.fy_revenue_halalas, 652173);
  // ومجموع العمر ٨٦٩٬٥٦٤ = ٦٥٢٬١٧٣ + ٢١٧٬٣٩١ — **مجموع اقتطاعَي السطرين لا اقتطاع مجموعهما**
  // (١٬٠٠٠٬٠٠٠ ÷ ١٫١٥ = ٨٦٩٬٥٦٥). والفارق هللةٌ واحدة، وهو الصحيح: الاقتطاع يقع على كل صفٍّ
  // على حدة فيبقى «صافٍ + ضريبة = إجمالي» مغلقاً لكل سطرٍ ولكل مجموع.
  assert.equal(o.kpis.lifetime_revenue_halalas, 869564);
  assert.equal(o.kpis.active_projects, 1);
  assert.equal(o.invoices_summary.invoiced, 350000);
  assert.equal(o.invoices_summary.collected, 150000);
  assert.equal(o.invoices_summary.outstanding, 200000);
  assert.equal(o.invoices_summary.overdue, 200000, 'ISSUED past due with open balance');
  assert.equal(o.kpis.open_ar_halalas, 200000);
  assert.equal(o.opportunities.win_rate, 50, '1 won / 2 decided');
  assert.equal(o.kpis.relationship, 'نشطة', 'open opportunity ⇒ نشطة');
  assert.equal(o.yoy.length, 2);
  assert.equal(o.concentration_pct, 75, 'client FY revenue ÷ company FY revenue');
});

test('clientOverview activities: real dated derived events only, sorted desc, ≤50', async () => {
  const { body: o } = await jf(`/api/clients/${CX}/360`, { as: 'lead' });
  const kinds = new Set(o.activities.map((a) => a.kind));
  for (const k of ['call', 'meeting', 'won', 'lost', 'contract_signed', 'invoice_issued', 'collection', 'project_started'])
    assert.ok(kinds.has(k), `timeline includes ${k}`);
  assert.ok(o.activities.every((a) => a.at && a.title), 'no fabricated/undated entries');
  assert.ok(o.activities.length <= 50);
  const ats = o.activities.map((a) => String(a.at));
  assert.deepEqual(ats, [...ats].sort().reverse(), 'sorted newest first');
  assert.ok(o.activities.filter((a) => a.source === 'derived').length >= 5);
});

// ── documents ────────────────────────────────────────────────────────────────
test('documents: add by URL (viewer forbidden), appears in 360', async () => {
  const bad = await jf(`/api/clients/${CX}/documents`, { method: 'POST', as: 'viewer', body: { name: 'ملف', url: 'https://x.example/a.pdf' } });
  assert.equal(bad.status, 403);
  const ok = await jf(`/api/clients/${CX}/documents`, { method: 'POST', as: 'lead',
    body: { name: 'العقد الموقع', url: 'https://example.com/contract.pdf', kind: 'contract' } });
  assert.equal(ok.status, 200);
  const badUrl = await jf(`/api/clients/${CX}/documents`, { method: 'POST', as: 'lead', body: { name: 'ملف', url: 'ftp://x' } });
  assert.equal(badUrl.status, 400);
  const o = await jf(`/api/clients/${CX}/360`, { as: 'lead' });
  assert.equal(o.body.documents.length, 1);
  assert.equal(o.body.documents[0].kind, 'contract');
});

// ── relationship rule ────────────────────────────────────────────────────────
test('relationship: ≤30d or open opp ⇒ نشطة · ≤120d ⇒ فاترة · else خاملة', async () => {
  const { relationshipOf } = await import('../../src/modules/clients/clients.js');
  assert.equal(relationshipOf(iso(400), 2), 'نشطة', 'open opportunity wins regardless of age');
  assert.equal(relationshipOf(iso(25), 0), 'نشطة');
  assert.equal(relationshipOf(iso(60), 0), 'فاترة');
  assert.equal(relationshipOf(iso(121), 0), 'خاملة');
  assert.equal(relationshipOf(null, 0), 'خاملة');

  const now = ids.nowIso();
  await db.insert('client', { id: 'CY', name_ar: 'هيئة فاترة', type: 'حكومي', active: 1, created_at: now });
  await db.insert('opportunity', { id: 'O4', title_ar: 'قديمة مكسوبة', client_id: 'CY', sector_id: 'S1',
    stage_id: 'WON', value_halalas: 10000, stage_changed_at: iso(60), created_at: now });
  await db.insert('client', { id: 'CD', name_ar: 'شركة خاملة', type: 'خاص', active: 1, created_at: now });
  await db.insert('opportunity', { id: 'O5', title_ar: 'قديمة مفقودة', client_id: 'CD', sector_id: 'S1',
    stage_id: 'LOST', value_halalas: 10000, stage_changed_at: iso(200), created_at: now });

  const list = await jf('/api/clients', { as: 'lead' });
  const byName = Object.fromEntries(list.body.map((c) => [c.name_ar, c]));
  assert.equal(byName['وزارة التجربة'].relationship, 'نشطة');
  assert.equal(byName['هيئة فاترة'].relationship, 'فاترة');
  assert.equal(byName['شركة خاملة'].relationship, 'خاملة');
});

// ── scoping ──────────────────────────────────────────────────────────────────
test('scope: sector lead sees only clients with a footprint in their sector', async () => {
  const now = ids.nowIso();
  await db.insert('client', { id: 'CZ', name_ar: 'جهة قطاع آخر', type: 'خاص', active: 1, created_at: now });
  await db.insert('opportunity', { id: 'O6', title_ar: 'فرصة قطاع 2', client_id: 'CZ', sector_id: 'S2',
    stage_id: 'LEAD', value_halalas: 5000, created_at: now });

  const lead = await jf('/api/clients', { as: 'lead' });
  const leadNames = lead.body.map((c) => c.name_ar);
  assert.ok(leadNames.includes('وزارة التجربة'), 'S1 footprint visible');
  assert.ok(!leadNames.includes('جهة قطاع آخر'), 'S2-only client invisible to the S1 lead');

  const admin = await jf('/api/clients', { as: 'admin' });
  assert.ok(admin.body.map((c) => c.name_ar).includes('جهة قطاع آخر'), 'company scope sees all');

  const forbidden360 = await jf('/api/clients/CZ/360', { as: 'lead' });
  assert.equal(forbidden360.status, 403, 'direct 360 fetch outside scope is blocked (IDOR guard)');

  const viewer = await jf('/api/clients', { as: 'viewer' });
  assert.equal(viewer.status, 200);
  assert.ok(viewer.body.map((c) => c.name_ar).includes('وزارة التجربة'), 'sector viewer reads their sector clients');
});

// صفوف الفرص المفتوحة داخل 360 تفاصيل صفقةٍ قبل ترسيتها: تُقصّ على نطاق قائمة الفرص نفسه،
// بينما مؤشرات العميل (خط الفرص والمرجّح) تبقى على البصمة كاملة — مجاميع بلا عناوين.
test('client-360: own-scoped BD sees only their open deal rows; KPIs still count the full footprint', async () => {
  const now = ids.nowIso();
  const expires = new Date(Date.now() + 86400000).toISOString();
  await db.insert('app_user', { id: 'u_bd', username: 'demo.bd', name_ar: 'مدير تطوير الأعمال',
    role_id: 'bd_manager', sector_id: 'S1', scope: 'own', active: 1, created_at: now });
  await db.insert('session', { id: 'sess_bd', user_id: 'u_bd', created_at: now, expires_at: expires });
  await db.insert('opportunity', { id: 'O7', title_ar: 'فرصة يملكها مدير التطوير', client_id: CX,
    sector_id: 'S1', stage_id: 'PROP', win_pct: 50, value_halalas: 40000, year: FY,
    owner_user_id: 'u_bd', created_at: now });

  const bd = await jf(`/api/clients/${CX}/360`, { as: 'bd' });
  assert.equal(bd.status, 200, 'client is a sector-wide relationship record — the page opens');
  assert.deepEqual(bd.body.opportunities.open.map((o) => o.id), ['O7'],
    'colleague pre-award rows (title/value/win%/next action) dropped for the own-scoped reader');
  // KPIs stay full-footprint: O1 (100000, 60%) + O7 (40000, 50%)
  assert.equal(bd.body.kpis.open_pipeline_halalas, 140000);
  assert.equal(bd.body.kpis.weighted_pipeline_halalas, 80000);
  // post-award lists are sector-public as before
  assert.equal(bd.body.opportunities.won.length, 1);
  assert.equal(bd.body.opportunities.lost.length, 1);

  const lead = await jf(`/api/clients/${CX}/360`, { as: 'lead' });
  assert.deepEqual(lead.body.opportunities.open.map((o) => o.id).sort(), ['O1', 'O7'],
    'sector lead unchanged — sees every open row in the sector');
  assert.equal(lead.body.kpis.open_pipeline_halalas, 140000);
});

test('list filters: query, type, and sort variants respond consistently', async () => {
  const q = await jf('/api/clients?query=' + encodeURIComponent('وزارة'), { as: 'admin' });
  assert.ok(q.body.length >= 1 && q.body.every((c) => (c.name_ar + (c.name_en || '') + (c.code || '')).includes('وزارة')));
  const t = await jf('/api/clients?type=' + encodeURIComponent('خاص'), { as: 'admin' });
  assert.ok(t.body.every((c) => c.type === 'خاص'));
  const byRev = await jf('/api/clients?sort=revenue', { as: 'admin' });
  const revs = byRev.body.map((c) => c.fy_revenue_halalas);
  assert.deepEqual(revs, [...revs].sort((a, b) => b - a), 'revenue sort is descending');
  const byPipe = await jf('/api/clients?sort=pipeline', { as: 'admin' });
  const pipes = byPipe.body.map((c) => c.open_pipeline_halalas);
  assert.deepEqual(pipes, [...pipes].sort((a, b) => b - a), 'pipeline sort is descending');
});
