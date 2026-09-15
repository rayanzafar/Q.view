// Real HTTP boundary checks on a fresh disposable database; no production credentials/data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sanad-targets-http-'));
process.env.DATABASE_URL = '';
process.env.SANAD_DB = join(dir, 'fixture.db');
process.env.NODE_ENV = 'test';
let db, server, base, cookie;
const endpoint = (sector = 'SOLUTIONS', year = 2026) => `/api/org/sectors/${sector}/targets?year=${year}`;
const request = async (path, { method = 'GET', body, form = false, authenticated = true } = {}) => {
  const headers = { connection: 'close', ...(authenticated ? { cookie } : {}) };
  if (body !== undefined) headers['content-type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
  const r = await fetch(base + path, { method, redirect: 'manual', headers,
    body: body === undefined ? undefined : form ? new URLSearchParams(body).toString() : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { /* HTML or deliberately denied request */ }
  return { status: r.status, text, json };
};
const values = { year: 2026, revision: 0, target_sales_sar: '1000.25', target_revenue_sar: '800.50', reason: 'اعتماد خطة تجريبية معزولة' };

before(async () => {
  const { buildDb } = await import('../../scripts/lib/qa-instance.mjs');
  buildDb(process.env.SANAD_DB);
  db = await import('../../src/core/db/index.js');
  await db.insert('budget', { id: 'HTTP-TARGET-2025', fiscal_year: 2025, sector_id: 'SOLUTIONS',
    target_sales_halalas: 90000, target_revenue_halalas: 70000, revision: 3,
    monthly_json: '{"1":10}', created_at: '2025-01-01T00:00:00Z' });
  // No annual target for this fixture's current year: exercise the actual create boundary.
  assert.equal((await db.get('SELECT COUNT(*) n FROM budget WHERE sector_id = ? AND fiscal_year = ?', ['SOLUTIONS', 2026])).n, 0);
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const { DEMO_PW } = await import('../../scripts/seed.js');
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username: 'demo.sectorlead', password: DEMO_PW }) });
  const loginText = await login.text();
  assert.equal(login.status, 200, loginText);
  cookie = login.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ');
  assert.match(cookie, /sanad_sid=/);
});

after(async () => {
  server?.closeAllConnections?.();
  await new Promise((resolve) => server ? server.close(resolve) : resolve());
  await db?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('annual target page and API authorize the sector lead without inventing a target', async () => {
  const page = await request('/app/sector-targets?sector=SOLUTIONS&year=2026');
  assert.equal(page.status, 200, page.text.slice(0, 200));
  assert.match(page.text, /مستهدفات القطاع/);
  assert.match(page.text, /name="target_sales_sar"/);
  assert.match(page.text, /name="reason"/);
  const api = await request(endpoint());
  assert.equal(api.status, 200);
  assert.equal(api.json.status, 'missing');
  assert.equal(api.json.budget, null);
  assert.equal(api.json.year, 2026);
  assert.equal(api.json.can_edit, true);
  assert.equal((await request(endpoint(), { authenticated: false })).status, 401);
});

test('sector-scoped budget grants cannot read or write another sector through HTTP', async () => {
  const before = await db.all('SELECT * FROM budget WHERE sector_id = ?', ['CONSULTING']);
  const get = await request(endpoint('CONSULTING'));
  assert.equal(get.status, 403);
  const put = await request(endpoint('CONSULTING'), { method: 'PUT', body: values });
  assert.equal(put.status, 403);
  const page = await request('/app/sector-targets?sector=CONSULTING&year=2026');
  assert.equal(page.status, 403);
  assert.deepEqual(await db.all('SELECT * FROM budget WHERE sector_id = ?', ['CONSULTING']), before);
});

test('forged form requests are rejected by CSRF before annual targets are saved', async () => {
  for (const token of [undefined, 'incorrect-token']) {
    const body = { ...values, ...(token ? { _csrf: token } : {}) };
    const r = await request(endpoint(), { method: 'PUT', body, form: true });
    assert.equal(r.status, 403);
    assert.match(r.text, /رمز الحماية/);
  }
  assert.equal((await db.get('SELECT COUNT(*) n FROM budget WHERE sector_id = ? AND fiscal_year = ?', ['SOLUTIONS', 2026])).n, 0);
});

test('HTTP saves audit the revision, reject stale writes, and preserve prior-year and legacy data', async () => {
  const prior = await db.get('SELECT * FROM budget WHERE id = ?', ['HTTP-TARGET-2025']);
  const sector = await db.get('SELECT * FROM sector WHERE id = ?', ['SOLUTIONS']);
  const saved = await request(endpoint(), { method: 'PUT', body: values });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.budget.target_sales_halalas, 100025);
  assert.equal(saved.json.budget.target_revenue_halalas, 80050);
  assert.equal(saved.json.budget.revision, 1);
  assert.equal(saved.json.history.length, 1);
  assert.equal(saved.json.history[0].reason, values.reason);
  const stale = await request(endpoint(), { method: 'PUT', body: { ...values, target_sales_sar: '1' } });
  assert.equal(stale.status, 400);
  assert.match(stale.text, /أعد تحميل/);
  const current = await request(endpoint());
  assert.equal(current.json.budget.target_sales_halalas, 100025);
  assert.equal(current.json.budget.revision, 1);
  assert.equal(current.json.history.length, 1, 'rejected stale request must not add a successful edit to history');
  assert.deepEqual(await db.get('SELECT * FROM budget WHERE id = ?', ['HTTP-TARGET-2025']), prior);
  assert.deepEqual(await db.get('SELECT * FROM sector WHERE id = ?', ['SOLUTIONS']), sector);
  const previous = await request(endpoint('SOLUTIONS', 2025));
  assert.equal(previous.status, 200);
  assert.equal(previous.json.budget.target_sales_halalas, 90000);
  assert.equal(previous.json.budget.revision, 3);
  assert.equal(previous.json.history.length, 0);
});
