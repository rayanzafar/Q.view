// حدّ محاولات الدخول: العدّ واحد للمسارين، والردّ يختلف بحسب من يسأل.
//
// العطل الذي كشفه هذا الملف لم يُكتشف بقراءة الكود بل بتعقّب فحص ساقط: حزمة e2e تسجّل الدخول
// عشرات المرّات من عنوان واحد، فينفد الدلو في منتصف التشغيل ويُرَدّ أول دخول بعده. وحين نُظر
// في الردّ تبيّن أنه **حمولة خام** — والمسار مركَّب على نموذج HTML. أي أن موظفاً يخطئ كلمة
// مروره عشر مرات يرى نصاً تقنياً بين أقواس معقوفة مكان صفحة الدخول. والتفعيل لكل الموظفين
// يجعل هذا التعثّر متوقَّعاً في أول يوم، لا حالةً نادرة.
//
// ولم يُوسَّع الحدّ ليمرّ الفحص: توسيعه يحذف الحماية التي نشحنها. الحزمة هي التي تنتظر رمزاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-login-throttle.db');
process.env.SANAD_DB = TEST_DB;

let db, server, base;

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate();
  await seedRbac();
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
});

// اسم لا وجود له: الغاية استنفاد الدلو لا اختبار كلمة المرور، والحساب غير موجود فلا يُقفل حساب حقيقي.
const form = (u) => fetch(`${base}/auth/login-web`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `username=${u}&password=خطأ`,
});

test('نموذج الدخول المحجوب يُعاد إلى صفحته برسالة عربية — لا حمولة خام', async () => {
  let throttled = null;
  for (let i = 0; i < 14 && !throttled; i++) {
    const r = await form('لا.أحد');
    const loc = r.headers.get('location') || '';
    if (loc.includes('e=2')) throttled = r;
    else await r.text();                       // يُستنزف الجسد دائماً كي لا يبقى المقبس حيّاً
  }
  assert.ok(throttled, 'لم يُفعَّل الحدّ إطلاقاً خلال ١٤ محاولة — الحارس لا يعمل');
  await throttled.text();
  assert.equal(throttled.status, 302, 'المتصفّح يُحوَّل، ولا يُعطى رمز حالة برمجياً');
  assert.match(throttled.headers.get('location'), /^\/login\?e=2$/);

  // والصفحة نفسها تقول السبب بلغة الموظف، وتقول ماذا يفعل: ينتظر، لا يعيد المحاولة فوراً.
  const page = await (await fetch(`${base}/login?e=2`)).text();
  assert.match(page, /محاولات كثيرة/);
  assert.match(page, /انتظر/, 'الرسالة تقول ما يفعله — لا تصف الخطأ فقط');
  assert.doesNotMatch(page, /\{"error"/, 'لا أثر لحمولة خام في صفحة يراها المستخدم');

  // ورسالة البيانات الخاطئة تبقى مستقلة: العلاجان مختلفان فلا تُخلط الرسالتان.
  const bad = await (await fetch(`${base}/login?e=1`)).text();
  assert.match(bad, /بيانات الدخول غير صحيحة/);
  assert.doesNotMatch(bad, /محاولات كثيرة/);
});

test('الواجهة البرمجية تبقى تأخذ ٤٢٩ — والدلو نفسه يخدم المسارين فلا يتضاعف المسموح', async () => {
  // الدلو استُنفد في الفحص السابق (نفس العنوان)، فالمسار البرمجي محجوب الآن أيضاً. ولو كان
  // لكل مسار دلوُه لصار المسموح عشرين لا عشراً، ولانفتح الباب بالتبديل بينهما.
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'لا.أحد', password: 'خطأ' }),
  });
  const body = await r.json();
  assert.equal(r.status, 429, 'المسار البرمجي يأخذ رمز الحالة لا تحويلاً');
  assert.match(body.error, /محاولات كثيرة/);
  assert.ok(r.headers.get('Retry-After'), 'ويقول متى يُعاد المحاولة');
});
