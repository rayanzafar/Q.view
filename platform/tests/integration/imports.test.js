// اختبار تكامل مركز البيانات عبر HTTP الحقيقي (createApp): رفع → معاينة → تنفيذ → سجل → تراجع
// بحساب demo.admin، ورفض 403 لحساب المشاهدة، وخطأ صف عند تجاوز نطاق قائد القطاع، ووجود التدقيق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-imports-http.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, xlsx, server, base;
const cookies = {}; // username → cookie

async function login(username) {
  if (cookies[username]) return cookies[username];
  const r = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Sanad@2026' }),
  });
  assert.equal(r.status, 200, `تسجيل دخول ${username}`);
  const cookie = (r.headers.getSetCookie() || [])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('sanad_sid='));
  assert.ok(cookie, 'ملف تعريف الجلسة موجود');
  cookies[username] = cookie;
  return cookie;
}
async function call(username, method, path, { json, raw, headers } = {}) {
  const cookie = await login(username);
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}),
      ...(headers || {}),
    },
    body: json ? JSON.stringify(json) : raw,
  });
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await r.json() : await r.arrayBuffer();
  return { status: r.status, body, headers: r.headers };
}
const buildFile = (columns, rows) => xlsx.buildExport({ columns, rows, format: 'xlsx' }).buffer;

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  xlsx = await import('../../src/modules/io/xlsx.js');
  await migrate(); await seedRbac();
  const now = ids.nowIso();
  await db.insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await db.insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, created_at: now });
  await db.insert('sector', { id: 'STUDIES', name_ar: 'قطاع الدراسات', active: 1, created_at: now });
  const { seed } = await import('../../scripts/seed.js'); // حسابات demo.* بكلمة المرور القياسية
  await seed();
  // نفس سطر التركيب الذي تنفذه جلسة التكامل في api.routes.js: apiRouter.use(ioRouter)
  const { apiRouter } = await import('../../src/modules/api.routes.js');
  const { ioRouter } = await import('../../src/modules/io/io.routes.js');
  apiRouter.use(ioRouter);
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((res) => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
});

const CLIENT_COLS = [
  { key: 'code', labelAr: 'الكود' }, { key: 'name_ar', labelAr: 'اسم العميل' },
  { key: 'type', labelAr: 'التصنيف' }, { key: 'contact_name', labelAr: 'جهة الاتصال' },
];

test('HTTP: types lists importable types for demo.admin', async () => {
  const { status, body } = await call('demo.admin', 'GET', '/api/io/types');
  assert.equal(status, 200);
  const clients = body.find((t) => t.type === 'clients');
  assert.ok(clients?.canImport && clients?.canExport);
  assert.ok(clients.columns.some((c) => c.labelAr === 'اسم العميل' && c.required));
});

test('HTTP: export template carries the Arabic UTF-8 filename', async () => {
  const { status, headers } = await call('demo.admin', 'GET', '/api/io/export/clients?format=xlsx&template=1');
  assert.equal(status, 200);
  const cd = headers.get('content-disposition') || '';
  assert.match(cd, /attachment/);
  assert.match(cd, /filename\*=UTF-8''/);
  assert.ok(cd.includes(encodeURIComponent('العملاء')), 'اسم الملف العربي مرمّز في الترويسة');
});

let runId, confirmToken;
test('HTTP: upload → preview → apply as demo.admin creates the records', async () => {
  const file = buildFile(CLIENT_COLS, [
    { code: 'CL-100', name_ar: 'أمانة العاصمة المقدسة', type: 'حكومي', contact_name: 'أ. فهد' },
    { code: 'CL-101', name_ar: 'شركة تطوير مكة', type: 'شبه حكومي', contact_name: '' },
  ]);
  const up = await call('demo.admin', 'POST', '/api/io/import/clients/upload', {
    raw: file, headers: { 'x-file-name': encodeURIComponent('عملاء-جدد.xlsx') },
  });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.ok(up.body.runId);
  assert.equal(up.body.rowCount, 2);
  assert.equal(up.body.autoMapping.name_ar, 1, 'المطابقة التلقائية وجدت اسم العميل');
  runId = up.body.runId;

  const pv = await call('demo.admin', 'POST', '/api/io/import/clients/preview', {
    json: { runId, mapping: up.body.autoMapping, mode: 'upsert' },
  });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.counts.create, 2);
  assert.equal(pv.body.counts.error, 0);
  confirmToken = pv.body.confirmToken;

  const ap = await call('demo.admin', 'POST', '/api/io/import/clients/apply', { json: { runId, confirmToken } });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(ap.body.created, 2);
  assert.ok(await db.get("SELECT id FROM client WHERE code = 'CL-100' AND deleted_at IS NULL"));
  assert.ok(await db.get("SELECT id FROM contact WHERE name = 'أ. فهد' AND deleted_at IS NULL"), 'جهة الاتصال أُنشئت مع العميل');
  assert.ok(await db.get("SELECT id FROM audit_log WHERE action = 'import.apply' AND resource_id = ?", [runId]), 'تدقيق التنفيذ موجود');
});

test('HTTP: runs list + run detail show the applied run', async () => {
  const ls = await call('demo.admin', 'GET', '/api/io/runs?type=clients');
  assert.equal(ls.status, 200);
  const run = ls.body.find((r) => r.id === runId);
  assert.ok(run);
  assert.equal(run.status, 'applied');
  assert.equal(run.counts.create, 2);
  assert.ok(run.canUndo);
  const dt = await call('demo.admin', 'GET', '/api/io/runs/' + runId);
  assert.equal(dt.status, 200);
  assert.equal(dt.body.rows.length, 2);
  assert.ok(dt.body.rows.every((r) => r.action === 'create'));
});

test('HTTP: 403 for demo.viewer on upload and on apply of another user\'s run', async () => {
  const file = buildFile(CLIENT_COLS, [{ code: 'CL-X', name_ar: 'تجربة' }]);
  const up = await call('demo.viewer', 'POST', '/api/io/import/clients/upload', {
    raw: file, headers: { 'x-file-name': 'x.xlsx' },
  });
  assert.equal(up.status, 403);
  const ap = await call('demo.viewer', 'POST', '/api/io/import/clients/apply', { json: { runId, confirmToken } });
  assert.equal(ap.status, 403);
});

test('HTTP: sector_lead row-scope violation becomes an Arabic row error (not a silent skip)', async () => {
  const cols = [{ key: 'name_ar', labelAr: 'الاسم' }, { key: 'sector', labelAr: 'القطاع' }];
  const file = buildFile(cols, [
    { name_ar: 'موظف ضمن قطاعي', sector: 'قطاع الحلول' },
    { name_ar: 'موظف من قطاع آخر', sector: 'قطاع الدراسات' },
  ]);
  const up = await call('demo.sectorlead', 'POST', '/api/io/import/employees/upload', {
    raw: file, headers: { 'x-file-name': 'emps.xlsx' },
  });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const pv = await call('demo.sectorlead', 'POST', '/api/io/import/employees/preview', {
    json: { runId: up.body.runId, mapping: up.body.autoMapping, mode: 'upsert' },
  });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.counts.create, 1);
  assert.equal(pv.body.counts.error, 1);
  assert.match(pv.body.errors[0].message, /خارج نطاق صلاحيتك/);
  // وعند التنفيذ يُسجَّل الصف المتعثر خطأً في دفتر الصفوف أيضاً
  const ap = await call('demo.sectorlead', 'POST', '/api/io/import/employees/apply', {
    json: { runId: up.body.runId, confirmToken: pv.body.confirmToken },
  });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(ap.body.created, 1);
  assert.equal(ap.body.errors, 1);
  const errRow = await db.get("SELECT * FROM import_row WHERE run_id = ? AND action = 'error'", [up.body.runId]);
  assert.match(errRow.error, /خارج نطاق/);
});

test('HTTP: undo reverses the run and audits it', async () => {
  const un = await call('demo.admin', 'POST', '/api/io/runs/' + runId + '/undo', { json: {} });
  assert.equal(un.status, 200, JSON.stringify(un.body));
  assert.equal(un.body.undone, true);
  const gone = await db.get("SELECT deleted_at FROM client WHERE code = 'CL-100'");
  assert.ok(gone.deleted_at, 'العميل المستورد حُذف حذفاً ناعماً بالتراجع');
  assert.ok(await db.get("SELECT id FROM audit_log WHERE action = 'import.undo' AND resource_id = ?", [runId]), 'تدقيق التراجع موجود');
  // التراجع مرتين مرفوض
  const again = await call('demo.admin', 'POST', '/api/io/runs/' + runId + '/undo', { json: {} });
  assert.equal(again.status, 400);
});
