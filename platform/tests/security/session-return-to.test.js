// حارسُ الوجهة المحفوظة — «ستعود إلى الصفحة نفسها» بابٌ لا يُفتح على الخارج.
//
// الوجهة تصل من مصدرين يملك المهاجم أحدهما بالكامل: مسار الطلب المرفوض (`req.originalUrl`)،
// و`?next=` في عنوان شاشة الدخول. ورابطٌ مثل `/login?next=https://evil.example` يجعل المنصة
// نفسها تحوّل موظفاً — بعد دخولٍ ناجح، وهو أخطر ما يكون — إلى شاشة دخولٍ مزيّفة يثق بها لأنه
// وصلها من سند. فالمقبول مسارٌ داخلي تحت `/app/` وحده.
//
// و`//host` هو الفخّ الذي يسقط فيه فحصُ البادئة وحده: يبدأ بشرطة مائلة فيبدو داخلياً، ويقرؤه
// المتصفح عنواناً خارجياً كامل البروتوكول.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-session-return-to.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, server, base;

// الدخول بكلمة المرور مفتوحٌ في الاختبار (قناة البريد في وضع المعاينة) — وهو أقصر
// طريقٍ إلى «دخولٍ ناجح»، وهي اللحظة الوحيدة التي تُتَّبع فيها الوجهة.
const PASSWORD = 'كلمة-مرور-اختبار-9';

const nextCookieOf = (res) => res.headers.getSetCookie().find((c) => c.startsWith('sanad_next='));

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  await migrate();
  await seedRbac();

  const now = ids.nowIso();
  const { hashPassword } = await import('../../src/core/auth/password.js');
  await db.insert('app_user', { id: 'u_ret', username: 'demo.ret', name_ar: 'موظف',
    role_id: 'employee', scope: 'own', active: 1, created_at: now,
    password_hash: hashPassword(PASSWORD) });

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

// ── ما يُرفض ─────────────────────────────────────────────────────────────────

const HOSTILE = [
  ['عنوان خارجي كامل', 'https://evil.example/steal'],
  ['بلا بروتوكول — يقرؤه المتصفح خارجياً', '//evil.example/steal'],
  ['شرطة عكسية، وبعض المتصفحات تعاملها كالمائلة', '/\\evil.example'],
  ['مسار داخلي خارج /app/', '/auth/logout-web'],
  ['جذر الموقع', '/'],
  ['بروتوكول جافاسكربت', 'javascript:alert(1)'],
  ['بروتوكول بيانات', 'data:text/html,<script>alert(1)</script>'],
  ['يبدأ بما يشبه المسار ثم يخرج', '//app/tasks@evil.example'],
  // عائلة `..`: تمرّ بفحص البادئة، ويحلّها المتصفّح المطابق للمواصفة داخل أصلنا — لكن أي
  // وسيطٍ يُسوّي المسار ثم يُعيد تحليله يرى `//evil.example` مضيفاً.
  ['تسويةٌ تُخرج من المسار', '/app/..//evil.example'],
  ['تسويةٌ بنقطةٍ قبلها', '/app/./..//evil.example'],
  ['صعودٌ إلى الجذر', '/app/../../evil.example'],
];

for (const [why, hostile] of HOSTILE) {
  test(`وجهةٌ معادية تُرفض ولا تُحفظ — ${why}`, async () => {
    const r = await fetch(base + '/login?next=' + encodeURIComponent(hostile), { redirect: 'manual' });
    assert.equal(r.status, 200, 'شاشة الدخول تُعرض كالمعتاد');
    assert.equal(nextCookieOf(r), undefined, `حُفظت وجهةٌ معادية: ${hostile}`);
  });
}

test('وجهةٌ معادية في مسار الطلب المرفوض لا تُحفظ أيضاً', async () => {
  // مسارٌ خارج `/app/` يصل الحارس نفسه: المصدر الثاني للوجهة، وحُكمه واحد.
  const expired = 'sess_ret_dead';
  await db.insert('session', { id: expired, user_id: 'u_ret', created_at: ids.nowIso(),
    expires_at: new Date(Date.now() - 60000).toISOString() });
  const r = await fetch(base + '/', { redirect: 'manual', headers: { cookie: `sanad_sid=${expired}` } });
  assert.equal(r.headers.get('location'), '/login?e=7');
  assert.equal(nextCookieOf(r), undefined, 'الجذر ليس وجهةً تُحفظ');
});

// ── ما يُقبل ─────────────────────────────────────────────────────────────────

test('وجهةٌ داخلية سليمة تُحفظ في كعكةٍ مقصورةٍ على الخادم', async () => {
  const sid = 'sess_ret_ok';
  await db.run('DELETE FROM session WHERE id = ?', [sid]);
  await db.insert('session', { id: sid, user_id: 'u_ret', created_at: ids.nowIso(),
    expires_at: new Date(Date.now() - 60000).toISOString() });
  const r = await fetch(base + '/app/projects?tab=open', { redirect: 'manual', headers: { cookie: `sanad_sid=${sid}` } });
  const c = nextCookieOf(r);
  assert.ok(c, 'الوجهة السليمة لم تُحفظ');
  assert.ok(decodeURIComponent(c).includes('/app/projects?tab=open'), `الوجهة مشوّهة: ${c}`);
  assert.ok(/HttpOnly/i.test(c), 'كعكة الوجهة مقروءة من نص المتصفح');
  assert.ok(/Max-Age=\d+/.test(c), 'كعكة الوجهة بلا عمر — تبقى إلى الأبد');
});

// ── العنوان ليس مصدراً للوجهة إطلاقاً ────────────────────────────────────────
// `?next=` كانت كتابةَ كعكةٍ بلا جلسةٍ ولا رمز حماية: رابطٌ واحد يُرسَل إلى موظف يزرع في
// متصفّحه وجهةً تُطبَّق على دخوله التالي بعد ساعة. أُغلق المصدر كله — الوجهة من الخادم وحده.
test('عنوان شاشة الدخول لا يكتب وجهةً — ولا حتى سليمة', async () => {
  const r = await fetch(base + '/login?next=' + encodeURIComponent('/app/imports'), { redirect: 'manual' });
  assert.equal(r.status, 200);
  assert.equal(nextCookieOf(r), undefined, 'غريبٌ بلا جلسة كتب وجهةً في متصفّح الموظف');
});

// ── ولا تُطبع داخليات المحرّك في صندوق الخطأ ─────────────────────────────────
for (const probe of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
  test(`\`?e=${probe}\` لا يطبع نصاً برمجياً على شاشة الدخول`, async () => {
    const html = await fetch(base + '/login?e=' + probe).then((x) => x.text());
    assert.ok(!/native code|function \w*\s*\(/.test(html), 'داخليات المحرّك ظهرت للمستخدم');
    assert.ok(!/class="err"/.test(html), 'صندوق خطأٍ بلا خطأ');
  });
}

// ── الحارس عند القراءة أيضاً، لا عند الكتابة وحدها ────────────────────────────
// كعكةٌ وُضعت بطريقٍ آخر (إضافة متصفح، نطاقٌ شقيق يكتب على النطاق الأب) لا تكسب ثقةً
// بمجرد وجودها. والقياس على الدخول الناجح نفسه — اللحظة التي تُتَّبع فيها الوجهة فعلاً.
//
// وعيّنةٌ من العائلات لا القائمة كلها: كل حالةٍ هنا **دخولٌ حقيقي**، وحدّ الدخول عشرُ
// محاولات لكل عنوان ثم قطرة كل ست ثوانٍ — فقائمةٌ أطول تصطدم بالحدّ نفسه فيصير الاختبار
// يقيس المُقيِّد لا الحارس. والرفض عند **الكتابة** مُقاسٌ على القائمة كاملةً أعلاه.
const HOSTILE_AT_LOGIN = [HOSTILE[0], HOSTILE[1], HOSTILE[2], HOSTILE[3], HOSTILE[8]];

for (const [why, hostile] of HOSTILE_AT_LOGIN) {
  test(`كعكةُ وجهةٍ معادية مدسوسة لا تُتَّبع بعد دخولٍ ناجح — ${why}`, async () => {
    const r = await fetch(base + '/auth/login-web', {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded',
        cookie: `sanad_next=${encodeURIComponent(hostile)}` },
      body: 'username=demo.ret&password=' + encodeURIComponent(PASSWORD),
    });
    assert.equal(r.status, 302, 'الدخول لم ينجح فالاختبار لا يقيس شيئاً');
    const dest = r.headers.get('location');
    assert.ok(dest.startsWith('/app/'), `تحويلة خارجية بعد دخولٍ ناجح: ${dest}`);
    assert.ok(!dest.includes('evil.example'), `الوجهة المعادية اتُّبعت: ${dest}`);
  });
}

test('وكعكةٌ داخلية سليمة تُتَّبع فعلاً — الوعد مُنفَّذ لا مجاملة', async () => {
  const r = await fetch(base + '/auth/login-web', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded',
      cookie: 'sanad_next=' + encodeURIComponent('/app/projects?tab=open') },
    body: 'username=demo.ret&password=' + encodeURIComponent(PASSWORD),
  });
  assert.equal(r.headers.get('location'), '/app/projects?tab=open', 'لم يُعَد إلى صفحته');
  const cleared = r.headers.getSetCookie().find((c) => c.startsWith('sanad_next='));
  assert.ok(cleared && /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(cleared),
    'الوجهة بقيت بعد استعمالها فتخطف الدخول التالي');
});

test('الخروج بالإرادة يمحو الوجهة معه', async () => {
  const r = await fetch(base + '/auth/logout-web', {
    method: 'POST', redirect: 'manual',
    headers: { cookie: 'sanad_next=/app/projects' },
  });
  const cleared = r.headers.getSetCookie().find((c) => c.startsWith('sanad_next='));
  assert.ok(cleared && /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(cleared),
    'الوجهة نجت من خروجٍ متعمَّد فتخطف الدخول التالي');
});
