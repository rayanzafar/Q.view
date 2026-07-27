// تغطية الأدوار — كل دور في src/core/rbac/matrix.js له حساب تجريبي، والحساب لا يتجاوز منح دوره.
//
// سبعة أدوار (department_manager, line_manager, bd_head, operations, procurement, approver,
// external) عاشت بلا حساب تجريبي، فلم يفتح لها المسح الحيّ ولا مصفوفة الصلاحيات صفحةً واحدة قط.
// هذا الملف يقفل الثغرة من طرفيها: يمنع عودتها (فحص التطابق أدناه)، ويثبّت السلوك الصحيح الذي
// كشفته التغطية الجديدة على الشبكة الحقيقية — ختم الراتب، وحدود القراءة، وعزل القطاعات.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-role-coverage.db');
process.env.SANAD_DB = TEST_DB;

const T = '2026-01-15T08:00:00.000Z';
const SCOPE_RANK = { company: 5, sector: 4, department: 3, project: 2, team: 2, own: 1 };

let db, server, base, EXP, ROLE_GRANTS, DEMO_USERS;
const cookies = {};
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  const seedMod = await import('../../scripts/seed.js');
  const { seedFixture } = await import('../../scripts/lib/seed-fixture.mjs');
  await migrate(); await seedRbac(); await seedMod.seed(); await seedFixture();
  DEMO_USERS = seedMod.DEMO_USERS;
  ({ ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js'));
  EXP = await import('../../scripts/lib/expectations.mjs');

  // مشروع في قطاع آخر: بدونه لا يُثبت عزل القطاع — «لم يرَ الاستشارات» بلا استشارات ليس دليلاً.
  await db.insert('project', { id: 'RC-PRJ-CONS', code: 'CON-26-09', name_ar: 'مشروع حوكمة الاستشارات',
    sector_id: 'CONSULTING', status: 'IN_PROGRESS', rag: 'GREEN', budget_halalas: 50_000_000,
    start_date: '2026-02-01', end_date: '2026-11-30', created_at: T });

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // 17 شخصاً على 17 جهازاً: حدّ محاولات الدخول عشرة لكل عنوان (core/http/security.js)، والتطبيق
  // يعمل خلف وكيل موثوق كما في الإنتاج. لا فحص يُضعَّف هنا — الحدّ نفسه مُغطّى في login-limiter.
  for (const [i, { username }] of EXP.ROLES.entries()) {
    const r = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close', 'x-forwarded-for': `10.40.50.${i + 1}` },
      body: JSON.stringify({ username, password: EXP.DEMO_PW }),
    });
    assert.equal(r.status, 200, `تسجيل دخول ${username}`);
    cookies[username] = r.headers.getSetCookie().find((c) => c.startsWith('sanad_sid=')).split(';')[0];
    await r.text();   // يُستهلك الجسم هنا أيضاً — سبعة عشر مقبساً معلّقاً تكفي وحدها لإسقاط التفكيك
  }
});

after(async () => {
  server?.closeAllConnections?.();
  await new Promise((r) => (server ? server.close(r) : r()));
  await db?.close();
  wipe();
});

// كل استجابة تُستهلك هنا مرة واحدة، ويعود النص جاهزاً — لا كائن استجابة مفتوح يخرج من الدالة.
// السبب ليس أناقة: جسم لم يُقرأ يُبقي محلّل undici معلّقاً على مقبس حيّ، فتتراكم عشرات المقابس
// عبر ١٧ شخصاً × صفحات؛ وعند إغلاق الخادم في `after` يُهدَم محلّل معلّق فيرمي استثناءً غير
// ملتقَط (assert(!this.paused)) يُسقط الاختبار كله. ظهر في الفحص الآلي دون المحلي لأن الأمر
// توقيتي بحت. الاستهلاك داخل الدالة يجعل التسريب **مستحيلاً بنيوياً** لا معتمداً على انتباه
// كل موضع نداء — وكان أربعة عشر موضعاً يقرأ الحالة ويترك الجسم.
const req = async (username, path, { method = 'GET', body } = {}) => {
  const r = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { cookie: cookies[username], 'content-type': 'application/json', connection: 'close' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
const json = async (username, path, opts) => JSON.parse((await req(username, path, opts)).text);
const userOf = (role) => EXP.ROLES.find((r) => r.role === role).username;

// أوسع نطاق تصل إليه منح الدور فعلاً (أعلى رتبة بين منحه كلها).
const maxGrantScope = (role) => (ROLE_GRANTS[role] || [])
  .reduce((best, g) => ((SCOPE_RANK[g.scope] || 0) > (SCOPE_RANK[best] || 0) ? g.scope : best), 'own');

// ── الثغرة نفسها: دور بلا حساب = دور بلا فحص ────────────────────────────────────
test('regression: every role in the RBAC matrix has exactly one demo account', () => {
  const roles = Object.keys(ROLE_GRANTS);
  const seeded = DEMO_USERS.map((d) => d.role);
  const missing = roles.filter((r) => !seeded.includes(r));
  assert.deepEqual(missing, [], `أدوار بلا حساب تجريبي — لا يمسحها أحد: ${missing.join('، ')}`);
  assert.equal(new Set(seeded).size, seeded.length, 'لا حسابان لدور واحد');
  assert.equal(seeded.length, roles.length, 'عدد الحسابات = عدد الأدوار');
});

test('regression: the sweep/matrix role table matches the seeded accounts exactly', () => {
  const seeded = new Map(DEMO_USERS.map((d) => [d.u, d]));
  assert.equal(EXP.ROLES.length, DEMO_USERS.length, 'جدول الفحص يغطي كل حساب مزروع');
  for (const r of EXP.ROLES) {
    const d = seeded.get(r.username);
    assert.ok(d, `${r.username} مذكور في جدول الفحص وغير مزروع`);
    assert.equal(r.role, d.role, `${r.username}: الدور`);
    assert.equal(r.scope, d.scope, `${r.username}: النطاق`);
    assert.equal(r.sector_id, d.sector ?? null, `${r.username}: القطاع`);
  }
});

test('provisioning: no demo account is granted a broader scope than its role actually reaches', () => {
  for (const d of DEMO_USERS) {
    const max = maxGrantScope(d.role);
    assert.ok(SCOPE_RANK[d.scope] <= SCOPE_RANK[max],
      `${d.u} (${d.role}) نطاق الحساب «${d.scope}» أوسع من أوسع منح لدوره «${max}»`);
    if (['sector', 'department', 'team'].includes(d.scope))
      assert.ok(d.sector, `${d.u} نطاقه «${d.scope}» فلا معنى له بلا قطاع`);
    if (d.scope === 'company') assert.equal(d.sector, null, `${d.u} نطاقه الشركة فلا يُقيَّد بقطاع`);
  }
});

// ── الراتب مختوم لمدير النظام وحده — عبر الشبكة، لكل الأدوار السبعة عشر ─────────
test('sensitive: salary stays sealed to admin across ALL 17 personas (roster + team page)', async () => {
  for (const { username, role } of EXP.ROLES) {
    const roster = await req(username, '/api/org/roster');
    const body = roster.text;
    if (role === 'admin') {
      assert.equal(roster.status, 200);
      assert.match(body, /"salary_halalas":\s*[1-9]/, 'مدير النظام يستقبل الراتب');
    } else if (roster.status === 200) {
      assert.doesNotMatch(body, /"salary_halalas"/, `${username} يجب ألا يستقبل حقل الراتب إطلاقاً`);
    }
    for (const page of ['/app/team', '/app/staffing']) {
      const p = await req(username, page);
      if (p.status !== 200 || role === 'admin') continue;
      const html = p.text;
      assert.doesNotMatch(html, /emp-sal/, `${username} يجب ألا يرى عمود الراتب في ${page}`);
      assert.doesNotMatch(html, /"salary_(halalas|sar)":\s*[1-9]/, `${username} يجب ألا تُضخّ له قيم رواتب في ${page}`);
    }
  }
});

// ── حدود القراءة للأدوار السبعة الجديدة ────────────────────────────────────────
test('people surfaces: only employee-readers reach the roster/tree; the rest are 403', async () => {
  // منح «قراءة الموظف» موجود لدى: admin, ceo_office, sector_lead, hr, department_manager,
  // line_manager, bd_head — ولا أحد سواهم. operations/procurement/approver/external بلا منح.
  for (const role of ['operations', 'procurement', 'approver', 'external']) {
    const u = userOf(role);
    for (const path of ['/api/org/roster', '/api/org/tree']) {
      const r = await req(u, path);
      assert.equal(r.status, 403, `${role} ${path}`);
      assert.equal(JSON.parse(r.text).error?.code, 'forbidden');
    }
    for (const page of ['/app/team', '/app/staffing']) {
      assert.equal((await req(u, page)).status, 403, `${role} ${page}`);
    }
  }
  for (const role of ['department_manager', 'line_manager', 'bd_head']) {
    assert.equal((await req(userOf(role), '/api/org/roster')).status, 200, `${role} يملك منح قراءة الموظفين`);
  }
});

test('approver: approve grants never imply read — its lists are empty and row reads are 403', async () => {
  const u = userOf('approver');
  assert.deepEqual(await json(u, '/api/opportunities'), [], 'اعتماد الفرصة لا يمنح قراءتها');
  assert.deepEqual(await json(u, '/api/projects'), []);
  assert.equal((await req(u, '/api/opportunities/FX-OPP-CONS')).status, 403);
  assert.equal((await req(u, '/api/finance/contracts/FX-CON-1')).status, 403);
  // «الاعتمادات» مفتوحة له بحكم PAGE_ACCESS، ومركز البيانات ليس كذلك (لا منح قراءة/كتابة عليه).
  assert.equal((await req(u, '/app/approvals')).status, 200);
  assert.equal((await req(u, '/app/imports')).status, 403);
});

test('external: the client-portal account carries no EVC data and cannot export staff data', async () => {
  const u = userOf('external');
  assert.deepEqual(await json(u, '/api/opportunities'), [], 'بلا منح فرص');
  assert.deepEqual(await json(u, '/api/projects'), [], 'مشاريعه هو فقط — ولا مشروع له');
  assert.deepEqual(await json(u, '/api/finance/by-contract'), [], 'بلا منح عقود');
  for (const type of ['employees', 'clients', 'opportunities', 'staffing', 'revenues']) {
    assert.equal((await req(u, `/api/io/export/${type}?format=csv`)).status, 403,
      `تصدير «${type}» يتطلب منح قراءته`);
  }
  // مقاييس القطاع تحتاج عضوية القطاع أو نطاق الشركة — وليس له أيّهما.
  assert.equal((await req(u, '/api/metrics/sector/SOLUTIONS')).status, 403);
  assert.equal((await req(u, '/api/metrics/company')).status, 403);
});

// ── عزل القطاعات للأدوار القطاعية الجديدة ──────────────────────────────────────
test('sector isolation: operations and approver never see another sector’s rows', async () => {
  const ops = await json(userOf('operations'), '/api/projects');
  assert.ok(ops.length > 0, 'العمليات ترى مشاريع قطاعها');
  assert.ok(ops.every((p) => p.sector_id === 'SOLUTIONS'), 'ولا ترى قطاعاً آخر');
  assert.ok(!ops.some((p) => p.id === 'RC-PRJ-CONS'), 'مشروع الاستشارات خارج نطاقها');
  assert.equal((await req(userOf('operations'), '/api/opportunities/FX-OPP-CONS')).status, 403);
});

test('bd_head: company-wide operations by design, but READ-ONLY on money', async () => {
  const u = userOf('bd_head');
  const projects = await json(u, '/api/projects');
  assert.ok(projects.some((p) => p.sector_id === 'CONSULTING'), 'رئيس تطوير الأعمال وحدة مساندة على مستوى الشركة');
  assert.equal((await req(u, '/api/opportunities/FX-OPP-CONS')).status, 200, 'يقرأ فرص القطاعات كلها');
  assert.equal((await req(u, '/api/finance/contracts/FX-CON-1')).status, 200, 'يقرأ العقد');
  // «المال قراءة فقط» — تحصيل أو تعديل فاتورة مرفوض قبل أي تحقّق من المبلغ.
  const col = await req(u, '/api/finance/collections', { method: 'POST', body: { invoiceId: 'FX-INV-2', amountSar: 1000 } });
  assert.equal(col.status, 403, 'تسجيل تحصيل خارج صلاحيته');
  // ولا راتب بأي شكل — الختم لا يُفتح لدور جديد مهما اتسعت مسؤوليته.
  assert.doesNotMatch((await req(u, '/api/org/roster')).text, /"salary_halalas"/);
});

test('operations: sector-scoped writer reaches validation on create, 403 on out-of-grant resources', async () => {
  const u = userOf('operations');
  // مشروع: يملك الإنشاء بنطاق قطاعه ⟵ يصل إلى التحقّق (اسم المشروع مطلوب)
  const prj = await req(u, '/api/projects', { method: 'POST', body: {} });
  assert.equal(prj.status, 400);
  assert.match(JSON.parse(prj.text).error.message, /اسم المشروع/);
  // فرصة وموظف: بلا منح إنشاء ⟵ رفض قبل التحقّق
  assert.equal((await req(u, '/api/opportunities', { method: 'POST', body: {} })).status, 403);
  assert.equal((await req(u, '/api/org/employees', { method: 'POST', body: {} })).status, 403);
});
