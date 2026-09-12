// التراجع عن استيراد التسكين عبر المسار الحقيقي (HTTP → engine.undo → staffing.undoRow).
// يغطي فرعَي التراجع معاً:
//   • صف «تحديث» → يجب أن يعيد المخطط الشهري والدور والسنة إلى ما قبل الاستيراد.
//   • صف «إضافة»  → يجب أن يحذف التسكين حذفاً ناعماً.
// الوقت يُمرَّر كسنة ثابتة (YEAR) لا من الساعة، والمعرّفات ثابتة، فالاختبار حتمي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-imports-staffing-undo.db');
process.env.SANAD_DB = TEST_DB;

const YEAR = 2026;
const T = '2026-01-15T08:00:00.000Z';

let db, xlsx, server, base;
const cookies = {};

async function login(username) {
  if (cookies[username]) return cookies[username];
  const r = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username, password: 'Sanad@2026' }),
  });
  assert.equal(r.status, 200, `تسجيل دخول ${username}`);
  const cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('sanad_sid='));
  assert.ok(cookie, 'ملف تعريف الجلسة موجود');
  cookies[username] = cookie;
  return cookie;
}

async function call(username, method, path, { json, raw, headers } = {}) {
  const cookie = await login(username);
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie, connection: 'close',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}),
      ...(headers || {}),
    },
    body: json ? JSON.stringify(json) : raw,
  });
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await r.json() : await r.text();
  return { status: r.status, body };
}

// أعمدة ملف التسكين كما يصدّرها المحوّل نفسه (الموظف/المشروع/السنة/الدور + أعمدة الأشهر).
const STAFF_COLS = [
  { key: 'employee', labelAr: 'الموظف' }, { key: 'project', labelAr: 'المشروع' },
  { key: 'year', labelAr: 'السنة' }, { key: 'type', labelAr: 'الدور' },
  ...['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    .map((m, i) => ({ key: `m${i + 1}`, labelAr: m })),
];
const buildFile = (rows) => xlsx.buildExport({ columns: STAFF_COLS, rows, format: 'xlsx' }).buffer;

// رفع → معاينة → تنفيذ، ويعيد { runId, counts }
async function runImport(user, rows) {
  const up = await call(user, 'POST', '/api/io/import/staffing/upload', {
    raw: buildFile(rows), headers: { 'x-file-name': 'staffing.xlsx' },
  });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const pv = await call(user, 'POST', '/api/io/import/staffing/preview', {
    json: { runId: up.body.runId, mapping: up.body.autoMapping, mode: 'upsert' },
  });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.counts.error, 0, `لا أخطاء صفوف: ${JSON.stringify(pv.body.errors)}`);
  const ap = await call(user, 'POST', '/api/io/import/staffing/apply', {
    json: { runId: up.body.runId, confirmToken: pv.body.confirmToken },
  });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  return { runId: up.body.runId, counts: pv.body.counts, applied: ap.body };
}

const alloc = (id) => db.get('SELECT * FROM allocation WHERE id = ?', [id]);
const months = (row) => JSON.parse(row.monthly_json || '{}');

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  xlsx = await import('../../src/modules/io/xlsx.js');
  await migrate(); await seedRbac();

  await db.insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, created_at: T });
  await db.insert('employee', { id: 'E1', name_ar: 'سارة الحربي', sector_id: 'SOLUTIONS', status: 'نشط', active: 1, created_at: T });
  await db.insert('employee', { id: 'E2', name_ar: 'خالد العتيبي', sector_id: 'SOLUTIONS', status: 'نشط', active: 1, created_at: T });
  await db.insert('project', { id: 'P1', code: 'SOL-26-01', name_ar: 'مشروع منصة الخدمات', sector_id: 'SOLUTIONS',
    status: 'IN_PROGRESS', created_at: T });
  // تسكين قائم مسبقاً (ليس من استيراد) — استيراد لاحق عليه يُنتج صف «تحديث» صافياً
  await db.insert('allocation', { id: 'A1', employee_id: 'E1', person_name_ar: 'سارة الحربي', project_id: 'P1',
    project_name: 'مشروع منصة الخدمات', sector_id: 'SOLUTIONS', type: 'member', year: YEAR,
    monthly_json: JSON.stringify({ 1: 0.5, 2: 0.5 }), source: 'manual', created_at: T });

  const { seed } = await import('../../scripts/seed.js');
  await seed();
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((res) => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
});

test('regression: undoing an UPDATED staffing row restores it (no write to a non-existent column)', async () => {
  // العلة: undoRow كان يكتب `updated_at` على جدول التسكين — وهو عمود غير موجود في المخطط
  // (001_init.sql:720 + 007) — فيفشل التراجع بخطأ سائق قاعدة البيانات على SQLite وPostgres معاً.
  const before = await alloc('A1');
  assert.deepEqual(months(before), { 1: 0.5, 2: 0.5 });
  assert.equal(before.type, 'member');

  const { runId, counts } = await runImport('demo.admin', [
    { employee: 'سارة الحربي', project: 'SOL-26-01', year: YEAR, type: 'lead',
      m1: 100, m2: 100, m3: 100, m4: 100 },
  ]);
  assert.equal(counts.update, 1, 'الاستيراد صنّف الصف تحديثاً لا إضافة');

  const applied = await alloc('A1');
  assert.deepEqual(months(applied), { 1: 1, 2: 1, 3: 1, 4: 1 }, 'التنفيذ كتب المخطط الجديد');
  assert.equal(applied.type, 'lead');

  // التراجع — كان يرجع 500 قبل الإصلاح
  const un = await call('demo.admin', 'POST', `/api/io/runs/${runId}/undo`, { json: {} });
  assert.equal(un.status, 200, `التراجع نجح: ${JSON.stringify(un.body)}`);
  assert.equal(un.body.undone, true);
  assert.equal(un.body.restored, 1);

  const after = await alloc('A1');
  assert.deepEqual(months(after), { 1: 0.5, 2: 0.5 }, 'المخطط الشهري عاد إلى ما قبل الاستيراد');
  assert.equal(after.type, 'member', 'الدور عاد إلى ما قبل الاستيراد');
  assert.equal(Number(after.year), YEAR);
  assert.equal(after.deleted_at, null, 'صف التحديث لا يُحذف بالتراجع');

  const aud = await db.get(
    "SELECT * FROM audit_log WHERE resource='allocation' AND resource_id='A1' AND action='update' ORDER BY at DESC LIMIT 1");
  assert.ok(aud, 'التراجع كتب سطر تدقيق');
  assert.equal(JSON.parse(aud.detail_json).undoImport, true);
  assert.equal(aud.sector_id, 'SOLUTIONS');

  const runRow = await db.get('SELECT status FROM import_run WHERE id = ?', [runId]);
  assert.equal(runRow.status, 'undone');
});

test('undoing a CREATED staffing row soft-deletes the allocation and audits it', async () => {
  const { runId, counts } = await runImport('demo.admin', [
    { employee: 'خالد العتيبي', project: 'SOL-26-01', year: YEAR, type: 'member', m5: 60, m6: 60 },
  ]);
  assert.equal(counts.create, 1);
  const created = await db.get(
    'SELECT * FROM allocation WHERE employee_id = ? AND project_id = ? AND deleted_at IS NULL', ['E2', 'P1']);
  assert.ok(created, 'التسكين أُنشئ');
  assert.deepEqual(months(created), { 5: 0.6, 6: 0.6 });

  const un = await call('demo.admin', 'POST', `/api/io/runs/${runId}/undo`, { json: {} });
  assert.equal(un.status, 200, JSON.stringify(un.body));
  assert.equal(un.body.restored, 1);

  const after = await alloc(created.id);
  assert.ok(after.deleted_at, 'التسكين المُنشأ حُذف حذفاً ناعماً');
  const aud = await db.get(
    "SELECT * FROM audit_log WHERE resource='allocation' AND resource_id=? AND action='delete' ORDER BY at DESC LIMIT 1",
    [created.id]);
  assert.ok(aud, 'حذف التراجع مُدقَّق');
  assert.equal(JSON.parse(aud.detail_json).undoImport, true);
});
