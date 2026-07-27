// Permissions matrix — programmatic role × surface sweep over the REAL HTTP app.
//
// Boots createApp() on an isolated seeded temp DB (migrate → seed-rbac → seed → demo fixture),
// logs in all 10 demo personas via POST /auth/login (JSON), then requests every /app/<page> in the
// PAGES map plus ~20 API endpoints and asserts the exact status per role from the shared
// expectation table (scripts/lib/expectations.mjs — verified against src/core/rbac/matrix.js).
//
// Page-level authorization is PENDING nav-guard: today every authenticated role gets 200 on every
// page except team/org (service-guarded 403s). The expectation table asserts that CURRENT behavior
// strictly, and flips to strict 200-vs-302 per role automatically once src/web/nav.js exists and
// exports PAGE_ACCESS (detected at runtime by loadPageAccess()).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-permissions.db');
process.env.SANAD_DB = TEST_DB;

let db, server, base, EXP, pageAccess;
const cookies = {}; // username → 'sanad_sid=…'

const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  const { seed } = await import('../../scripts/seed.js');
  const { seedFixture } = await import('../../scripts/lib/seed-fixture.mjs');
  await migrate();
  await seedRbac();
  await seed();
  await seedFixture();
  EXP = await import('../../scripts/lib/expectations.mjs');
  pageAccess = await EXP.loadPageAccess();

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Login every persona ONCE. The anti-brute-force limiter allows a burst of exactly 10 per IP
  // (core/http/security.js: capacity 10, refill 1 token / 6s) and the matrix now drives 17 personas,
  // so each login comes from its own forwarded address — the app runs with `trust proxy`, exactly as
  // it does behind Railway's edge. This does not relax any assertion: it models 17 people on 17
  // machines instead of one machine hammering the login endpoint. The limiter itself is covered
  // directly by tests/security/login-limiter.test.js, so nothing is lost by separating the IPs here.
  for (const [i, { username }] of EXP.ROLES.entries()) {
    const r = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close', 'x-forwarded-for': `10.20.30.${i + 1}` },
      body: JSON.stringify({ username, password: EXP.DEMO_PW }),
    });
    assert.equal(r.status, 200, `login ${username} must succeed (got ${r.status})`);
    const sid = r.headers.getSetCookie().find((c) => c.startsWith('sanad_sid='));
    assert.ok(sid, `login ${username} must set the session cookie`);
    cookies[username] = sid.split(';')[0];
    await r.text();   // يُستهلك الجسم — سبعة عشر مقبساً معلّقاً تكفي وحدها لإسقاط التفكيك
  }
});

after(async () => {
  server?.closeAllConnections?.();
  await new Promise((r) => (server ? server.close(r) : r()));
  await db?.close();
  wipe();
});

// الجسم يُستهلك داخل الدالة دائماً. جسم غير مقروء يُبقي محلّل undici معلّقاً على مقبس حيّ،
// وعند إغلاق الخادم في `after` يُهدَم محلّل معلّق فيرمي استثناءً غير ملتقَط يُسقط الملف كله.
// هذه أضخم مصفوفة شبكية في المستودع (١٧ دوراً × الصفحات والمسارات)، فهي الأكثر تعرّضاً — وقد
// سقط ملفٌ شقيق بهذا العيب نفسه في الفحص الآلي دون المحلي لأن الأمر توقيتي بحت.
const req = async (username, path, { method = 'GET', body } = {}) => {
  const r = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { cookie: cookies[username], 'content-type': 'application/json', connection: 'close' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, text: await r.text() };
};

// ── anonymous baseline ────────────────────────────────────────────────────────
test('anonymous: pages redirect to /login, APIs return 401', async () => {
  const pg = await fetch(base + '/app/ceo', { redirect: 'manual' });
  assert.equal(pg.status, 302);
  assert.equal(pg.headers.get('location'), '/login');
  await pg.text();
  const api = await fetch(base + '/api/opportunities');
  assert.equal(api.status, 401);
  await api.text();
});

// ── page matrix: every role × every page in the PAGES map ─────────────────────
test('page matrix: exact status per role for all 15 pages', async () => {
  const mode = pageAccess ? 'STRICT (nav.js PAGE_ACCESS detected)' : 'PENDING nav-guard (no src/web/nav.js — asserting current 200-for-all-authed behavior)';
  console.log(`    page-authz mode: ${mode}`);
  let pending = 0;
  for (const { username, role } of EXP.ROLES) {
    for (const page of EXP.PAGES) {
      const want = EXP.pageExpected(role, page, pageAccess);
      const r = await req(username, `/app/${page}`);
      const bodyText = r.text;
      assert.equal(r.status, want.status,
        `${role} GET /app/${page} → expected ${want.status}, got ${r.status}`);
      if (r.status === 200) {
        assert.match(bodyText, /dir="rtl"/, `${role} /app/${page} must render the RTL layout`);
        assert.doesNotMatch(bodyText, /__RENDER_THREW__|حدث خطأ غير متوقع/, `${role} /app/${page} must not surface an error page`);
      }
      if (want.pendingNavGuard) pending++;
    }
  }
  if (!pageAccess) console.log(`    ${pending} role×page cells are 200 only because page-level guards are PENDING nav-guard`);
});

// ── API matrix: shared probes + fixture-id probes ─────────────────────────────
test('API matrix: exact status per role for every probe', async () => {
  for (const probe of [...EXP.API_PROBES, ...EXP.FIXTURE_PROBES]) {
    for (const { username, role } of EXP.ROLES) {
      const want = EXP.expectedStatus(probe.expect, role);
      const r = await req(username, probe.path, { method: probe.method, body: probe.body });
      assert.equal(r.status, want,
        `${role} ${probe.method} ${probe.path} → expected ${want}, got ${r.status}`);
      // API error envelopes must be JSON (never an HTML page) and 403s must carry the typed code.
      const text = r.text;
      if (probe.path.startsWith('/api')) {
        const parsed = JSON.parse(text);
        if (r.status === 403) assert.equal(parsed.error?.code, 'forbidden', `${role} ${probe.path} 403 envelope`);
      }
    }
  }
});

// ── list scoping through the wire (not just the service layer) ────────────────
test('scoping: opportunity lists respect sector/own scope per role', async () => {
  const rows = async (u) => JSON.parse((await req(u, '/api/opportunities')).text);
  const admin = await rows('demo.admin');
  assert.ok(admin.some((o) => o.id === 'FX-OPP-CONS'), 'company scope sees the CONSULTING opportunity');
  for (const u of ['demo.bd', 'demo.viewer', 'demo.sectorlead']) {
    const r = await rows(u);
    assert.ok(r.length > 0, `${u} sees their sector pipeline`);
    assert.ok(r.every((o) => o.sector_id === 'SOLUTIONS'), `${u} must not see other sectors`);
  }
  for (const u of ['demo.employee', 'demo.hr', 'demo.pm', 'demo.consultant']) {
    assert.equal((await rows(u)).length, 0, `${u} has no opportunity read scope → empty list`);
  }
});

// ── sensitive fields over the wire ────────────────────────────────────────────
test('sensitive: salary reaches ADMIN ONLY — sealed from every other role over real HTTP', async () => {
  // قرار المالك: الراتب لا يراه إلا مدير النظام حتى يتم التكامل مع Odoo.
  // هذا الاختبار يمرّ عبر الشبكة فعلاً، فيغطي الخدمة والصفحة والتصدير معاً.
  const adminRoster = await req('demo.admin', '/api/org/roster');
  assert.equal(adminRoster.status, 200);
  assert.match(adminRoster.text, /"salary_halalas":\s*[1-9]/, 'مدير النظام يستقبل الراتب');
  assert.match((await req('demo.admin', '/app/team')).text, /emp-sal/, 'صفحة الفريق تعرض عمود الراتب لمدير النظام');

  // demo.bd has no employee read at all → the roster (API and page) is denied outright.
  assert.equal((await req('demo.bd', '/api/org/roster')).status, 403);
  assert.equal((await req('demo.bd', '/app/team')).status, 403);

  // كل دور آخر يقرأ الموظفين: يصل للقائمة لكن بلا أي قيمة راتب — لا في البيانات ولا في الصفحة.
  for (const who of ['demo.hr', 'demo.sectorlead', 'demo.ceo']) {
    const roster = (await req(who, '/api/org/roster')).text;
    assert.doesNotMatch(roster, /"salary_halalas":\s*[1-9]/, `${who} يجب ألا يستقبل الراتب`);
    const page = await req(who, '/app/team');
    if (page.status === 200) {
      const html = page.text;
      assert.doesNotMatch(html, /emp-sal/, `${who} يجب ألا يرى عمود الراتب`);
      assert.doesNotMatch(html, /"salary_sar":\s*[1-9]/, `${who} يجب ألا تُضخّ له قيم رواتب في الصفحة`);
    }
  }
});

test('sensitive: project cost/margin redacted for bd, visible to finance', async () => {
  const bd = JSON.parse((await req('demo.bd', '/api/projects')).text);
  assert.ok(bd.length > 0, 'bd sees sector projects');
  assert.ok(bd.every((p) => p.actual_spend_halalas == null && p.margin_pct == null),
    'bd must never receive cost/margin values');
  const fin = JSON.parse((await req('demo.finance', '/api/projects')).text);
  assert.ok(fin.some((p) => p.actual_spend_halalas > 0), 'finance sees cost values');
});

// ── row-level guards (IDOR) ───────────────────────────────────────────────────
test('IDOR: out-of-sector single-row reads are 403, not silently redacted', async () => {
  const lead = await req('demo.sectorlead', '/api/opportunities/FX-OPP-CONS');
  assert.equal(lead.status, 403, 'sector_lead must not read another sector’s opportunity');
  const admin = await req('demo.admin', '/api/opportunities/FX-OPP-CONS');
  assert.equal(admin.status, 200);
  assert.equal(JSON.parse(admin.text).id, 'FX-OPP-CONS');
});
