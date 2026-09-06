// الجلسة تتدحرج مع العمل — ترحيلة ٠٣٥ وما بُني عليها.
//
// العيب المُغطّى هنا: `expires_at` كانت تُكتب مرةً واحدة لحظة الدخول ولا تُلمَس بعدها، فمن
// يعمل بلا انقطاع يُطرَد في منتصف عمله، وشاشةُ الدخول لا تقول له شيئاً ولا تُعيده إلى صفحته.
// لم يكن في المنتج اختبارٌ واحد يمسّ الانتهاء أصلاً: كل التجهيزات تكتب `expires_at` في ٢٠٩٩.
//
// قاعدة معزولة + خادمٌ حقيقي (createApp) — التدحرج يعيش في وسيطة الطلب، فلا يُقاس إلا بطلبٍ حي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-session-sliding.db');
process.env.SANAD_DB = TEST_DB;
// خانقُ الكتابة مُطفأ في الاختبار: قياسُ التدحرج لا انتظارُ خمس دقائق. وله اختبارُه أدناه.
process.env.SESSION_TOUCH_MINUTES = '0';

let db, ids, config, server, base;

const sessionRow = (sid) => db.get('SELECT * FROM session WHERE id = ?', [sid]);

// طلبٌ خام: نتحكّم في الكعكة يدوياً ولا نتبع التحويلات — التحويلة نفسها هي المقيس.
const hit = (path, { sid, headers = {}, method = 'GET' } = {}) => fetch(base + path, {
  method, redirect: 'manual',
  headers: { ...(sid ? { cookie: `sanad_sid=${sid}` } : {}), ...headers },
});

async function makeSession(sid, { userId = 'u_worker', createdAgoMs = 0, expiresInMs = 3600000, revoked = false, lastSeenAgoMs = null } = {}) {
  await db.run('DELETE FROM session WHERE id = ?', [sid]);
  const created = new Date(Date.now() - createdAgoMs).toISOString();
  const seen = lastSeenAgoMs == null ? created : new Date(Date.now() - lastSeenAgoMs).toISOString();
  await db.insert('session', {
    id: sid, user_id: userId, created_at: created, last_seen_at: seen,
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    revoked_at: revoked ? ids.nowIso() : null,
  });
  return sid;
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  ({ config } = await import('../../src/core/config.js'));
  await migrate();
  await seedRbac();

  const now = ids.nowIso();
  await db.insert('app_user', { id: 'u_worker', username: 'demo.worker', name_ar: 'موظف',
    role_id: 'employee', scope: 'own', active: 1, created_at: now });
  await db.insert('app_user', { id: 'u_off', username: 'demo.off', name_ar: 'موقوف',
    role_id: 'employee', scope: 'own', active: 0, created_at: now });

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  delete process.env.SESSION_TOUCH_MINUTES;
});

// ── التدحرج نفسه ─────────────────────────────────────────────────────────────

test('النشاط يدفع مهلة الجلسة إلى الأمام — وهو جوهر الإصلاح', async () => {
  const sid = await makeSession('sess_slide', { expiresInMs: 60000 });   // دقيقة واحدة باقية
  const before = (await sessionRow(sid)).expires_at;

  const r = await hit('/app/tasks', { sid });
  assert.equal(r.status, 200, 'الجلسة حيّة فالصفحة تُفتح');

  const after = (await sessionRow(sid)).expires_at;
  assert.ok(after > before, `المهلة لم تتقدّم: ${before} → ${after}`);
  const windowMs = new Date(after).getTime() - Date.now();
  const expected = config.sessionTtlHours * 3600000;
  assert.ok(Math.abs(windowMs - expected) < 15000,
    `النافذة الجديدة يجب أن تساوي نافذة الخمول كاملةً (${expected}ms) لا ${windowMs}ms`);
});

test('الكعكة تُجدَّد مع الصفّ — وإلا مات المتصفّح في الموعد الأول', async () => {
  const sid = await makeSession('sess_cookie', { expiresInMs: 60000 });
  const r = await hit('/app/tasks', { sid });
  const setCookie = r.headers.getSetCookie().find((c) => c.startsWith('sanad_sid='));
  assert.ok(setCookie, 'لم تُعَد كعكة الجلسة مع الرد');
  assert.ok(/HttpOnly/i.test(setCookie), 'الكعكة المجدَّدة فقدت HttpOnly');
  assert.ok(/SameSite=Lax/i.test(setCookie), 'الكعكة المجدَّدة فقدت SameSite');
  assert.ok(/Max-Age=\d+/.test(setCookie), 'الكعكة المجدَّدة بلا عمر');
});

test('خانق الكتابة: لمسةٌ واحدة كل نافذة، لا كتابةٌ مع كل طلب', async () => {
  const prev = process.env.SESSION_TOUCH_MINUTES;
  process.env.SESSION_TOUCH_MINUTES = '5';
  config.sessionTouchMinutes = 5;
  try {
    // آخر لمسةٍ قبل عشر دقائق: خارج نافذة الخنق، فاللمسة الأولى تقع.
    const sid = await makeSession('sess_throttle', { expiresInMs: 60000, lastSeenAgoMs: 10 * 60000 });
    const before = (await sessionRow(sid)).expires_at;
    await hit('/app/tasks', { sid });
    const first = (await sessionRow(sid)).expires_at;
    assert.ok(first > before, 'اللمسة الأولى لم تقع');
    // الصفّ صار «لُمس الآن»، فالطلبات التالية داخل النافذة لا تكتب شيئاً.
    for (let i = 0; i < 3; i++) await hit('/app/tasks', { sid });
    assert.equal((await sessionRow(sid)).expires_at, first, 'كُتبت لمسةٌ داخل نافذة الخنق');
  } finally {
    process.env.SESSION_TOUCH_MINUTES = prev;
    config.sessionTouchMinutes = 0;
  }
});

test('السقف المطلق يعلو التدحرج: جلسةٌ بلغت شهرها لا تُمدَّد', async () => {
  const capMs = config.sessionMaxDays * 86400000;
  // أُنشئت قبل السقف بدقيقة: التدحرج لا يملك أن يدفعها إلا دقيقةً واحدة على الأكثر.
  const sid = await makeSession('sess_cap', { createdAgoMs: capMs - 60000, expiresInMs: 30000 });
  await hit('/app/tasks', { sid });
  const after = new Date((await sessionRow(sid)).expires_at).getTime();
  assert.ok(after <= Date.now() + 61000, `التمديد تجاوز السقف المطلق: بقي ${(after - Date.now()) / 1000}ث`);

  // وبعد السقف تماماً: لا تمديد إطلاقاً.
  const sid2 = await makeSession('sess_past_cap', { createdAgoMs: capMs + 3600000, expiresInMs: 30000 });
  const before2 = (await sessionRow(sid2)).expires_at;
  await hit('/app/tasks', { sid: sid2 });
  assert.equal((await sessionRow(sid2)).expires_at, before2, 'جلسةٌ تجاوزت سقفها مُدِّدت');
});

test('الملغى لا يُبعث: لمسةٌ لا تُحيي جلسةً أنهاها مدير النظام', async () => {
  const sid = await makeSession('sess_revoked', { expiresInMs: 3600000, revoked: true });
  const before = (await sessionRow(sid)).expires_at;
  const r = await hit('/app/tasks', { sid });
  assert.equal(r.status, 302, 'الجلسة الملغاة يجب أن تُردّ');
  assert.equal((await sessionRow(sid)).expires_at, before, 'صفٌّ ملغى مُدِّد');
});

test('حسابٌ موقوف يُردّ فوراً ولا تُمدَّد جلسته', async () => {
  const sid = await makeSession('sess_inactive', { userId: 'u_off', expiresInMs: 3600000 });
  const before = (await sessionRow(sid)).expires_at;
  const r = await hit('/app/tasks', { sid });
  assert.equal(r.status, 302, 'الموقوف يجب أن يُردّ');
  assert.equal((await sessionRow(sid)).expires_at, before, 'جلسةُ موقوفٍ مُدِّدت');
});

// ── ما يراه من انتهت جلسته ───────────────────────────────────────────────────

test('الانتهاء يُقال ولا يُصمت عنه: تحويلة تحمل السبب ٧', async () => {
  const sid = await makeSession('sess_dead', { expiresInMs: -60000 });
  const r = await hit('/app/projects', { sid });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login?e=7', 'التحويلة بلا سبب — وهذا هو «الطرد الصامت»');
  const cleared = r.headers.getSetCookie().find((c) => c.startsWith('sanad_sid='));
  assert.ok(cleared && /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(cleared), 'الكعكة الميتة لم تُمحَ');
});

test('الرسالة تظهر فعلاً على شاشة الدخول — خبراً محايداً لا خطأً أحمر', async () => {
  const r = await hit('/login?e=7');
  const html = await r.text();
  assert.ok(html.includes('انتهت جلستك'), 'الرسالة غائبة عن الشاشة');
  // «انتهت جلستك» لا «انتهت مدّتها»: الفرع يقع أيضاً على جلسةٍ أنهاها مدير النظام أو
  // أنهاها تغييرُ كلمة مرور — فالتعميم على المدّة كذبٌ في الحالتين.
  assert.ok(!html.includes('انتهت مدة جلستك'), 'العبارة تعمّم على المدّة وحدها');
  // ولا يسكن الصندوق الأحمر: واقعةٌ يومية عادية لا يُصبغ عليها لون الخطر.
  assert.ok(/<div class="note" role="status">[^<]*انتهت جلستك/.test(html),
    'الخبر مُصاغٌ كخطأ — يقول للموظف إنه أخطأ وهو لم يفعل شيئاً');
  assert.ok(!/<div class="err"[^>]*>[^<]*انتهت جلستك/.test(html), 'الخبر في صندوق الخطأ');
});

test('زائرٌ بلا كعكة يبقى بلا رسالة — لا يُقال له «انتهت جلستك» ولم يدخل قط', async () => {
  const r = await hit('/app/projects');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
});

test('والرسالة ليست عرّافاً: كعكةٌ مختلَقة تأخذ نفس الردّ تماماً', async () => {
  // الفارق مبنيٌّ على **وجود** الكعكة لا على صحّتها — عمداً. ولو فحص الصحّة لصار الردّ
  // يقول «هذا المعرّف حقيقي» لمن يجرّب المعرّفات، وهو ما يُبنى عليه التخمين.
  const invented = await hit('/app/projects', { sid: 'sess_ZZZZZZZZZZZZ' });   // بشكل معرّفٍ حقيقي، بلا صفٍّ خلفه
  const real = await hit('/app/projects', { sid: await makeSession('sess_oracle', { expiresInMs: -60000 }) });
  assert.equal(invented.headers.get('location'), real.headers.get('location'),
    'الردّ يفرّق بين معرّفٍ قائمٍ ومختلَق — فيصير أداة تخمين');
  assert.equal(invented.status, real.status);
});

test('ختمُ إنشاءٍ تالف لا يُسقط الطلب — الفشل مغلق لا رمية', async () => {
  const sid = 'sess_bad_stamp';
  await db.run('DELETE FROM session WHERE id = ?', [sid]);
  await db.insert('session', { id: sid, user_id: 'u_worker', created_at: 'ليس تاريخاً',
    expires_at: new Date(Date.now() + 60000).toISOString(), last_seen_at: null });
  const r = await hit('/app/tasks', { sid });
  assert.equal(r.status, 200, 'صفٌّ بختمٍ تالف أسقط الطلب بخطأ خادم');
});

test('الوجهة تُحفظ ويُعاد إليها بعد الدخول', async () => {
  const sid = await makeSession('sess_dest', { expiresInMs: -60000 });
  const r = await hit('/app/projects?tab=open', { sid });
  const nextCookie = r.headers.getSetCookie().find((c) => c.startsWith('sanad_next='));
  assert.ok(nextCookie, 'الوجهة لم تُحفظ');
  assert.ok(decodeURIComponent(nextCookie).includes('/app/projects?tab=open'),
    `الوجهة المحفوظة خاطئة: ${nextCookie}`);
  assert.ok(/HttpOnly/i.test(nextCookie), 'كعكة الوجهة مقروءة من المتصفح');
});

// ثلاث شهاداتٍ تقول «هذا الطلب ينتظر بيانات لا صفحة» — وكلٌّ منها تُقاس وحدها.
for (const [why, headers] of [
  ['ترويسة المتصفح نفسه (كل fetch/XHR)', { 'sec-fetch-dest': 'empty' }],
  ['ترويستنا الصريحة', { 'x-requested-with': 'fetch' }],
  ['Accept صريحٌ للبيانات', { accept: 'application/json' }],
]) {
  test(`طلب بيانات بجلسةٍ منتهية يأخذ ٤٠١ لا صفحة HTML — ${why}`, async () => {
    const sid = await makeSession('sess_json', { expiresInMs: -60000 });
    const r = await hit('/app/reports/preview/x', { sid, headers });
    assert.equal(r.status, 401, 'تحويلةٌ إلى HTML تنكسر عند تحليل الرد في المتصفح');
    const j = await r.json();
    assert.equal(j.error.code, 'unauthorized');
    assert.ok(!/API|JSON|null|undefined/.test(j.error.message), 'مصطلح تقني في رسالة المستخدم');
  });
}

test('والتصفّح العادي يبقى تحويلةً — الشهادة تُفرّق ولا تُعمّم', async () => {
  const sid = await makeSession('sess_nav', { expiresInMs: -60000 });
  const r = await hit('/app/projects', { sid, headers: { 'sec-fetch-dest': 'document', accept: 'text/html' } });
  assert.equal(r.status, 302, 'متصفّحٌ ينتظر صفحةً أُعطي حمولةً خاماً');
  assert.equal(r.headers.get('location'), '/login?e=7');
});

// ── الكنس ────────────────────────────────────────────────────────────────────

test('الكنس يمحو ما تجاوز سقفه ولا يمسّ الحيّ', async () => {
  const { purgeExpiredSessions } = await import('../../src/core/auth/service.js');
  const capMs = config.sessionMaxDays * 86400000;
  await makeSession('sess_old', { createdAgoMs: capMs * 2, expiresInMs: -capMs - 86400000 });
  await makeSession('sess_fresh', { expiresInMs: 3600000 });
  // جلسةٌ انتهت اليوم فقط: تبقى — هي آخر أثرٍ لجهازٍ قد يُسأل عنه غداً.
  await makeSession('sess_recent', { expiresInMs: -3600000 });

  await purgeExpiredSessions();
  assert.equal(await sessionRow('sess_old'), undefined, 'القديم لم يُمحَ');
  assert.ok(await sessionRow('sess_fresh'), 'الحيّ مُحي');
  assert.ok(await sessionRow('sess_recent'), 'المنتهي حديثاً مُحي قبل أوانه');
});
