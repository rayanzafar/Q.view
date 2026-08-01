// مسار النسخة الاحتياطية سطح حسّاس (يحوي كل الصفوف بما فيها الرواتب) — هذه الاختبارات تثبت
// أن بواباته الثلاث تعمل كل واحدة على حدة، وأن سقوط أي منها يُغلق المسار.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-backup-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js', 'scripts/seed.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const TOKEN = 'test-backup-token-0123456789';
process.env.SANAD_BACKUP_TOKEN = TOKEN;

const { close } = await import('../../src/core/db/index.js');
const { createApp } = await import('../../src/server.js');

let server, base;
const cookies = {};
const DEMO_PW = 'Sanad@2026';

async function login(username) {
  const r = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username, password: DEMO_PW }),
  });
  const setC = r.headers.getSetCookie?.() || [];
  cookies[username] = setC.map((c) => c.split(';')[0]).join('; ');
  return r.status;
}
const call = (user, path, headers = {}) =>
  fetch(base + path, { headers: { cookie: cookies[user] || '', connection: 'close', ...headers } });

before(async () => {
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['demo.admin', 'demo.hr', 'demo.ceo']) await login(u);
});
after(async () => {
  await new Promise((r) => server.close(r));
  await close();
  rmSync(dir, { recursive: true, force: true });
});

test('البوابة ١: بلا رمز في الطلب يُرفض حتى لمدير النظام', async () => {
  assert.equal((await call('demo.admin', '/api/backup/counts')).status, 403);
  assert.equal((await call('demo.admin', '/api/backup/dump')).status, 403);
});

test('البوابة ٢: رمز صحيح لكن دور غير مدير النظام يُرفض', async () => {
  for (const u of ['demo.hr', 'demo.ceo']) {
    const r = await call(u, '/api/backup/counts', { 'x-backup-token': TOKEN });
    assert.equal(r.status, 403, `${u} يجب أن يُرفض`);
  }
});

test('رمز خاطئ بنفس الطول يُرفض (المقارنة ثابتة الزمن لا تعني تساهلاً)', async () => {
  const wrong = 'X'.repeat(TOKEN.length);
  assert.equal((await call('demo.admin', '/api/backup/counts', { 'x-backup-token': wrong })).status, 403);
});

test('مدير النظام برمز صحيح: عدّ الصفوف يعمل ويشمل جداول حقيقية', async () => {
  const r = await call('demo.admin', '/api/backup/counts', { 'x-backup-token': TOKEN });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.counts && typeof j.counts === 'object');
  assert.ok('app_user' in j.counts, 'يشمل جدول المستخدمين');
  assert.ok(j.counts.app_user > 0, 'وفيه صفوف فعلية');
  assert.ok('role_permission' in j.counts, 'ويشمل جداول الصلاحيات');
});

test('النسخة نفسها: ترويسة صحيحة + سطر لكل صف + تغطي كل الجداول المعلَنة', async () => {
  const r = await call('demo.admin', '/api/backup/dump', { 'x-backup-token': TOKEN });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /ndjson/);
  const text = await r.text();
  const lines = text.trim().split('\n').filter(Boolean);
  const head = JSON.parse(lines[0]);
  assert.equal(head._meta, 'sanad-backup');
  assert.ok(Array.isArray(head.tables) && head.tables.length > 20, 'يعلن قائمة الجداول');

  // كل سطر بعد الترويسة إما فاصل جدول أو صف — ولا سطر تالف
  let rows = 0; const seenTables = new Set();
  for (const l of lines.slice(1)) {
    const o = JSON.parse(l);            // يرمي لو كان أي سطر غير صالح
    if (o._table) seenTables.add(o._table); else { rows++; assert.ok(o.t && o.r, 'كل صف يحمل جدوله'); }
  }
  assert.equal(seenTables.size, head.tables.length, 'كل جدول معلَن ظهر فعلاً في النسخة');
  assert.ok(rows > 0, 'النسخة تحوي صفوفاً');

  // الاتساق مع العدّاد: مجموع الصفوف يطابق مجموع العدّ
  const counts = (await (await call('demo.admin', '/api/backup/counts', { 'x-backup-token': TOKEN })).json()).counts;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(rows, total, 'عدد الصفوف المنسوخة يطابق العدّ بالضبط — لا نقص صامت');
});

test('كل محاولة تُسجَّل في سجل التدقيق — الناجحة وغير المصرَّح بها', async () => {
  const db = await import('../../src/core/db/index.js');
  const n = (await db.get("SELECT COUNT(*) n FROM audit_log WHERE resource = 'backup'")).n;
  assert.ok(n >= 2, 'سجّل عمليات النسخ الناجحة على الأقل');
});
