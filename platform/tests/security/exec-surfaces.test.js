// أسطح القيادة تُحرَس بمنحٍ قيادي لا بعمود اتساع البيانات.
//
// العطل الذي يقفله هذا الملف: `app_user.scope` عمودٌ يجيب «كم يبلغ عرض نافذة بياناته؟» — لا
// «هل أداء الشركة من شأنه؟». وكان الجواب الثاني يُقرأ من العمود الأول، فدور «المشتريات» —
// ومنحُه شركيّ بحقّ لأن الموردين وأوامر الشراء عبر الشركة كلها — كان يفتح لوحة القيادة
// ومحفظة المشاريع وشاشة العملاء ويستقبل إيراد كل قطاع ومبيعاته ومستهدفاته، وهو لا يملك منح
// تقرير ولا مؤشر ولا هامش ولا كلفة. تُحقّق منه على حساب حقيقي: ٢٠٠ على الأربعة جميعاً.
//
// ما يثبته هذا الملف:
//   • المشتريات تُرَدّ عن الأسطح الأربعة — ونافذة بياناتها تبقى شركية كما هي (لم يُضيَّق الحساب).
//   • ولا يخسر مستحقّ شيئاً: الأدوار الخمسة التي تقرأ تقارير الشركة ومؤشراتها (مدير النظام،
//     مكتب الرئيس التنفيذي، المالية، الموارد البشرية، رئيس تطوير الأعمال) تستقبل ٢٠٠ على الأربعة.
//   • القرار لكل دور من الأدوار السبعة عشر مثبَّت في جدول مكتوب هنا يدوياً — لا مشتقّ من الدالة
//     التي يفحصها، وإلا لصار الاختبار مرآةً للكود لا حكماً عليه.
//   • المصدر واحد لكل سطح: القائمة الجانبية والدليل والبحث تتبع القرار نفسه بلا شرط موازٍ.
//   • المعيار منحٌ لا نطاق حساب: قائد قطاع لو وُسِّع حسابه سهواً إلى «شركة» لا يمرّ، لأن تقاريره
//     قطاعية — وهذا بالضبط ما تُخطئ فيه can() بلا صفٍّ هدف، فيُسأل effectiveScope بدلاً منها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-exec-surfaces.db');
process.env.SANAD_DB = TEST_DB;

// ── الجدول المقصود: قرارٌ لكل دور، مشتقّ من منحه في src/core/rbac/matrix.js ──────
// «قيادي» = يقرأ التقارير أو المؤشرات **على مستوى الشركة**:
//   admin (منح شامل) · ceo_office · finance · hr · bd_head → report/kpi بنطاق «شركة».
//   sector_lead · bd_manager · operations · viewer → بنطاق «قطاع» فقط.
//   project_manager → بنطاق «مشروع». والبقية بلا منح تقرير أو مؤشر إطلاقاً.
const LEADERSHIP = ['admin', 'ceo_office', 'finance', 'hr', 'bd_head'];
// شاشة العملاء تفتح أيضاً لمن يملك منح قراءة «العميل» مهما ضاق نطاقه (قائمته تُرشَّح بنطاقه).
const CLIENT_READERS = ['admin', 'ceo_office', 'sector_lead', 'bd_manager', 'bd_head', 'finance', 'viewer'];

const expectExec = (role) => LEADERSHIP.includes(role);
const expectClients = (role) => CLIENT_READERS.includes(role) || LEADERSHIP.includes(role);

let db, server, base, EXP, ROLE_GRANTS, PAGE_ACCESS, seesCompanyPerformance;
const cookies = {};
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  const { seed } = await import('../../scripts/seed.js');
  const { seedFixture } = await import('../../scripts/lib/seed-fixture.mjs');
  await migrate(); await seedRbac(); await seed(); await seedFixture();
  const { initRbac } = await import('../../src/core/rbac/index.js');
  await initRbac();
  ({ ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js'));
  ({ PAGE_ACCESS, seesCompanyPerformance } = await import('../../src/core/policy/pages.js'));
  EXP = await import('../../scripts/lib/expectations.mjs');

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // سبعة عشر شخصاً على سبعة عشر جهازاً: حدّ محاولات الدخول عشرة لكل عنوان (core/http/security.js).
  for (const [i, { username }] of EXP.ROLES.entries()) {
    const r = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close', 'x-forwarded-for': `10.60.70.${i + 1}` },
      body: JSON.stringify({ username, password: EXP.DEMO_PW }),
    });
    assert.equal(r.status, 200, `تسجيل دخول ${username}`);
    cookies[username] = r.headers.getSetCookie().find((c) => c.startsWith('sanad_sid=')).split(';')[0];
    await r.text();   // الجسم يُستهلك هنا أيضاً — مقبس معلّق واحد يكفي لإسقاط التفكيك
  }
});

after(async () => {
  server?.closeAllConnections?.();
  await new Promise((r) => (server ? server.close(r) : r()));
  await db?.close();
  wipe();
});

// كل استجابة تُستهلك مرة واحدة داخل الدالة ويعود النص جاهزاً: جسمٌ لم يُقرأ يُبقي محلّل الشبكة
// معلّقاً على مقبس حيّ، وعند إغلاق الخادم في `after` يُهدَم محلّل معلّق فيرمي استثناءً غير
// ملتقَط يُسقط الملف كله — عطلٌ توقيتي يظهر في الفحص الآلي دون المحلي.
const req = async (username, path, { method = 'GET', body } = {}) => {
  const r = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { cookie: cookies[username], 'content-type': 'application/json', connection: 'close' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
const json = async (username, path) => JSON.parse((await req(username, path)).text);
const userOf = (role) => EXP.ROLES.find((r) => r.role === role).username;
const shapeOf = (role) => {
  const p = EXP.ROLES.find((r) => r.role === role);
  return { id: 'u_' + role, username: role, role_id: role, scope: p.scope, sector_id: p.sector_id,
    department_id: null, projectIds: new Set(), teamIds: new Set() };
};

// ── الجدول: قرار كل دور من السبعة عشر ─────────────────────────────────────────
test('الجدول يغطي الأدوار السبعة عشر كلها — لا دور بلا قرار معلن', () => {
  const roles = Object.keys(ROLE_GRANTS);
  assert.equal(roles.length, 17, 'عدد الأدوار في المصفوفة');
  for (const r of roles) assert.ok(EXP.ROLES.some((x) => x.role === r), `${r} بلا حساب تجريبي فلا يُفحص`);
  for (const r of [...LEADERSHIP, ...CLIENT_READERS]) assert.ok(roles.includes(r), `${r} ليس دوراً في المصفوفة`);
});

test('البوابة: قرار كل دور على أسطح القيادة مطابق للجدول المقصود', () => {
  for (const { role } of EXP.ROLES) {
    const u = shapeOf(role);
    assert.equal(seesCompanyPerformance(u), expectExec(role), `${role}: قراءة أداء الشركة`);
    assert.equal(PAGE_ACCESS.ceo(u), expectExec(role), `${role}: لوحة القيادة`);
    assert.equal(PAGE_ACCESS.portfolio(u), expectExec(role), `${role}: محفظة المشاريع`);
    assert.equal(PAGE_ACCESS.clients(u), expectClients(role), `${role}: شاشة العملاء`);
  }
});

test('المعيار منحٌ لا عمود اتساع: أربع حالات تفصل السؤالين', () => {
  const U = (role, scope) => ({ id: 'x', role_id: role, scope, sector_id: null, projectIds: new Set(), teamIds: new Set() });
  // ١) نافذة شركية بلا منح قيادي — عين العطل: المشتريات تُرَدّ.
  assert.equal(seesCompanyPerformance(U('procurement', 'company')), false);
  // ٢) منح تقرير موجود لكنه قطاعي — can() تقول «نعم» بلا صفٍّ هدف، وeffectiveScope تقول «قطاع».
  //    حتى لو وُسِّع الحساب سهواً إلى «شركة» تبقى الرتبة قطاعية فلا يمرّ.
  assert.equal(seesCompanyPerformance(U('sector_lead', 'company')), false);
  assert.equal(seesCompanyPerformance(U('viewer', 'company')), false);
  // ٣) منح قيادي ونافذة أضيق: الشاشة نفسها ترفض من نافذته أضيق من الشركة، فلا تُوعَد بها.
  assert.equal(seesCompanyPerformance(U('finance', 'sector')), false);
  // ٤) الاجتماع الصحيح: منح شركي + نافذة شركية.
  for (const role of LEADERSHIP) assert.equal(seesCompanyPerformance(U(role, 'company')), true, role);
  assert.equal(seesCompanyPerformance(null), false);
  assert.equal(seesCompanyPerformance(undefined), false);
});

// ── العطل نفسه، عبر الشبكة ────────────────────────────────────────────────────
test('المشتريات: نافذة بياناتها تبقى شركية ومع ذلك تُرَدّ عن الأسطح الأربعة', async () => {
  const u = userOf('procurement');
  // الإصلاح ليس بتضييق الحساب: نافذته شركية كما كانت — والمنح وحده هو ما تغيّر معناه.
  assert.equal((await json(u, '/auth/me')).user.scope, 'company', 'حساب المشتريات شركيّ النافذة');
  for (const page of ['/app/ceo', '/app/portfolio', '/app/clients']) {
    const r = await req(u, page);
    assert.equal(r.status, 403, `المشتريات يجب أن تُرَدّ عن ${page}`);
    assert.match(r.text, /خارج صلاحياتك/, `${page}: صفحة رفض عربية واضحة`);
  }
  const m = await req(u, '/api/metrics/company');
  assert.equal(m.status, 403, 'أرقام أداء الشركة خارج صلاحية المشتريات');
  const err = JSON.parse(m.text).error;
  assert.equal(err.code, 'forbidden');
  assert.match(err.message, /مدير النظام/, 'الرسالة تقول ما العمل لا ما المنع فقط');
  assert.doesNotMatch(m.text, /"revenue_halalas"|"target_revenue_halalas"|"sectors"/, 'لا رقم قطاع واحد يتسرّب مع الرفض');
});

test('لا مستحقّ يخسر شيئاً: الأدوار القيادية الخمسة تستقبل الأسطح الأربعة كاملة', async () => {
  for (const role of LEADERSHIP) {
    const u = userOf(role);
    for (const page of ['/app/ceo', '/app/portfolio', '/app/clients']) {
      const r = await req(u, page);
      assert.equal(r.status, 200, `${role} يجب أن يفتح ${page}`);
      assert.match(r.text, /dir="rtl"/, `${role} ${page}: الصفحة تُعرض فعلاً لا صفحة خطأ`);
      assert.doesNotMatch(r.text, /__RENDER_THREW__|حدث خطأ غير متوقع/, `${role} ${page}`);
    }
    const m = await req(u, '/api/metrics/company');
    assert.equal(m.status, 200, `${role} يقرأ أرقام أداء الشركة`);
    const ov = JSON.parse(m.text);
    assert.ok(Array.isArray(ov.sectors) && ov.sectors.length > 0, `${role}: الأرقام تصله فعلاً`);
  }
});

test('المصفوفة الكاملة: سبعة عشر دوراً × أربعة أسطح عبر الشبكة', async () => {
  for (const { role, username } of EXP.ROLES) {
    const want = expectExec(role) ? 200 : 403;
    for (const page of ['/app/ceo', '/app/portfolio']) {
      assert.equal((await req(username, page)).status, want, `${role} ${page}`);
    }
    const m = await req(username, '/api/metrics/company');
    assert.equal(m.status, want, `${role} أرقام أداء الشركة`);
    if (m.status === 403) assert.equal(JSON.parse(m.text).error.code, 'forbidden', `${role}: غلاف الرفض`);
    assert.equal((await req(username, '/app/clients')).status, expectClients(role) ? 200 : 403, `${role} شاشة العملاء`);
  }
});

// ── مصدر واحد: ما يُرفض لا يُعرَض ولا يُشرَح ولا يُبحث فيه ──────────────────────
test('القائمة الجانبية تتبع البوابة نفسها — لا رابط لشاشة تُرَدّ', async () => {
  const proc = await req(userOf('procurement'), '/app/tasks');
  assert.equal(proc.status, 200, 'المشتريات تفتح «مهامي» — فالقائمة الجانبية معروضة لها');
  for (const key of ['ceo', 'portfolio', 'clients']) {
    assert.doesNotMatch(proc.text, new RegExp(`href="/app/${key}[?"]`), `رابط ${key} يجب ألا يظهر للمشتريات`);
  }
  // البوابة ليست خاوية: من يملكها يرى روابطها في القائمة نفسها.
  const fin = await req(userOf('finance'), '/app/tasks');
  for (const key of ['ceo', 'portfolio', 'clients']) {
    assert.match(fin.text, new RegExp(`href="/app/${key}[?"]`), `رابط ${key} يجب أن يظهر للمالية`);
  }
});

test('الدليل والبحث يتبعان البوابة نفسها — لا شرح لشاشة تُرَدّ ولا نتيجة منها', async () => {
  const guide = await json(userOf('procurement'), '/api/guide');
  const keys = guide.pages.map((p) => p.key);
  for (const k of ['ceo', 'portfolio', 'clients']) assert.ok(!keys.includes(k), `دليل المشتريات يجب ألا يذكر ${k}`);
  assert.ok(keys.length > 0, 'ودليله ليس خاوياً');
  const finGuide = await json(userOf('finance'), '/api/guide');
  assert.ok(finGuide.pages.some((p) => p.key === 'ceo'), 'دليل المالية يذكر لوحة القيادة');

  const q = encodeURIComponent('أمانة');
  const procHits = (await json(userOf('procurement'), `/api/search?q=${q}`)).results;
  assert.ok(!procHits.some((r) => r.category === 'client'), 'البحث لا يعيد عملاء لمن لا يفتح شاشتهم');
  const adminHits = (await json(userOf('admin'), `/api/search?q=${q}`)).results;
  assert.ok(adminHits.some((r) => r.category === 'client'), 'الفحص ليس خاوياً: مدير النظام يجد العميل نفسه');
});

// ── ما لم يتغيّر: اتساع النافذة يبقى سؤال البيانات لا سؤال الرتبة ──────────────
test('مقاييس القطاع لم تُمَسّ: عضو القطاع يقرأ قطاعه ومن نافذته الشركة يقرأ أيّه', async () => {
  assert.equal((await req(userOf('procurement'), '/api/metrics/sector/SOLUTIONS')).status, 200,
    'نافذة المشتريات شركية فتبلغ لوحة أي قطاع — هذا سؤال اتساع لا رتبة، ولم يكن موضع العطل');
  assert.equal((await req(userOf('operations'), '/api/metrics/sector/SOLUTIONS')).status, 200, 'العمليات في قطاعها');
  assert.equal((await req(userOf('external'), '/api/metrics/sector/SOLUTIONS')).status, 403, 'الخارجي بلا قطاع');
});
