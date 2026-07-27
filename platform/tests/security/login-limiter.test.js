// حدّ محاولات الدخول (core/http/security.js): دلو رموز سعته 10 لكل عنوان، ثم 429 مع Retry-After.
// كان بلا أي اختبار رغم أنه الحاجز الوحيد أمام التخمين المتسلسل فوق قفل الحساب. وُثِّق هنا لأن
// مصفوفة الصلاحيات صارت تفصل عناوين الدخول (17 شخصاً) — الفصل مقبول فقط ما دام الحدّ نفسه محروساً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-login-limiter.db');
process.env.SANAD_DB = TEST_DB;

let db, server, base;
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.closeAllConnections?.();
  await new Promise((r) => (server ? server.close(r) : r()));
  await db?.close();
  wipe();
});

// اسم غير موجود عمداً: يقيس الحدّ بلا أن يقفل حساباً تجريبياً (قفل الحساب حاجز مستقل).
// الجسم يُستهلك دائماً: أحد عشر جسماً غير مقروء تُبقي محلّلات undici معلّقة على مقابس حيّة،
// فتُهدَم عند إغلاق الخادم وترمي استثناءً غير ملتقَط يُسقط الملف كله — عيب توقيتي لا يظهر محلياً.
const attempt = async (ip) => {
  const r = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close', 'x-forwarded-for': ip },
    body: JSON.stringify({ username: 'la.yujad', password: 'كلمة-خاطئة' }),
  });
  return { status: r.status, headers: r.headers, text: await r.text() };
};

test('login limiter: the 11th attempt from one address is 429 with Retry-After', async () => {
  const ip = '203.0.113.7';
  const seen = [];
  for (let i = 0; i < 10; i++) seen.push((await attempt(ip)).status);
  assert.ok(seen.every((s) => s === 401), `أول عشر محاولات تصل إلى المصادقة: ${seen.join(',')}`);
  const blocked = await attempt(ip);
  assert.equal(blocked.status, 429, 'المحاولة الحادية عشرة محجوبة');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'الرد يحمل مهلة إعادة المحاولة');
  assert.match(JSON.parse(blocked.text).error, /محاولات كثيرة/);
});

test('login limiter: buckets are per-address — a different address is unaffected', async () => {
  const fresh = await attempt('203.0.113.8');
  assert.equal(fresh.status, 401, 'عنوان آخر له دلوه الخاص');
});
