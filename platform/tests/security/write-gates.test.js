// بوابات الكتابة — تسجيل الوقت ورفع طلبات الاعتماد، على الشبكة الحقيقية بكل الأشخاص السبعة عشر.
//
// ثلاثة عيوب كشفها مسح الأدوار (سبعة أدوار عاشت بلا حساب تجريبي، فلم يفتح لها أحد باباً قط):
//   ① `submitForApproval` بلا أي فحص صلاحية إطلاقاً: حساب البوابة الخارجية (عميل، لا موظف)
//      كان يفتح مساراً داخلياً على أي معرّف يكتبه — بما فيه فرصة قطاع آخر وفترة وقت موظف آخر —
//      فيصل الطلب إلى شاشة قائد القطاع وإلى تنبيهاته باسم عميل.
//   ② رسالة المسار المجهول كانت تُدرج القيمة المرسلة حرفيةً، فتظهر لصاحب العمل كلمة تقنية
//      محظورة حين تغيب القيمة. أظرف الأخطاء سطحٌ لا يمسحه فاحص المصطلحات (يقرأ الصفحات فقط).
//   ③ `addEntry` بلا فحص إنشاء: أي حساب مسجَّل يسجّل ساعات في دفاتر الشركة، ويرفع «الساعات
//      الفعلية» لأي مهمة في الشركة عبر معرّف مهمة لا يملكها.
//
// كل توقّع هنا مشتقّ من منح الدور في src/core/rbac/matrix.js لا من استجابة مرصودة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-write-gates.db');
process.env.SANAD_DB = TEST_DB;

let db, server, base, EXP, ROLE_GRANTS, BANNED;
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
  ({ ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js'));
  ({ BANNED } = await import('../../scripts/check-glossary.mjs'));
  EXP = await import('../../scripts/lib/expectations.mjs');

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // سبعة عشر شخصاً على سبعة عشر عنواناً: حدّ محاولات الدخول عشرة لكل عنوان (core/http/security.js).
  for (const [i, { username }] of EXP.ROLES.entries()) {
    const r = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close', 'x-forwarded-for': `10.60.70.${i + 1}` },
      body: JSON.stringify({ username, password: EXP.DEMO_PW }),
    });
    assert.equal(r.status, 200, `تسجيل دخول ${username}`);
    cookies[username] = r.headers.getSetCookie().find((c) => c.startsWith('sanad_sid=')).split(';')[0];
    await r.text();   // الجسم يُستهلك دائماً — جسم معلَّق يُبقي مقبساً حيّاً فيسقط التفكيك
  }
});

after(async () => {
  server?.closeAllConnections?.();
  await new Promise((r) => (server ? server.close(r) : r()));
  await db?.close();
  wipe();
});

// كل استجابة تُستهلك داخل الدالة مرة واحدة ويعود النص جاهزاً — لا كائن استجابة مفتوح يخرج منها.
const req = async (username, path, { method = 'GET', body } = {}) => {
  const r = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { cookie: cookies[username], 'content-type': 'application/json', connection: 'close' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
const userOf = (role) => EXP.ROLES.find((r) => r.role === role).username;
const idOf = async (username) => (await db.get('SELECT id FROM app_user WHERE username = ?', [username])).id;
const msgOf = (r) => JSON.parse(r.text).error?.message || '';

// وجود المنح كما تقرؤه can(): منح شامل، أو تطابق المورد مع الإجراء (أو «إدارة» التي تشملها).
// نطاق الصف هنا «خاصتي» دائماً (القيد يُكتب باسم صاحبه)، وكل نطاق مستخدَم فعلاً في المصفوفة
// يجتازه — فوجود المنح وحده يحسم التوقّع.
const hasGrant = (role, resource, action) => (ROLE_GRANTS[role] || []).some(
  (g) => (g.resource === '*' && g.action === 'admin') || (g.resource === resource && (g.action === action || g.action === 'admin')));

// ── ① تسجيل الوقت: المنح يفصل، والحساب غير الموظف مرفوض ─────────────────────────
test('timesheet: the create grant decides — every persona, over real HTTP', async () => {
  let allowed = 0; let denied = 0;
  for (const [i, { username, role }] of EXP.ROLES.entries()) {
    const want = hasGrant(role, 'timesheet', 'create') ? 200 : 403;
    // يوم مختلف لكل شخص: سقف اليوم (١٦ ساعة) شخصيّ، والفصل يمنع تداخل الاختبارات.
    const day = `2026-06-${String(i + 1).padStart(2, '0')}`;
    const r = await req(username, '/api/timesheets', { method: 'POST', body: { hours: 3, entry_date: day, note: 'فحص' } });
    assert.equal(r.status, want, `${role} POST /api/timesheets → ${want}`);
    if (want === 403) { assert.equal(JSON.parse(r.text).error?.code, 'forbidden'); denied++; } else allowed++;
  }
  assert.ok(allowed >= 3, 'الموظف والاستشاري ومدير النظام يسجّلون وقتهم');
  assert.ok(denied >= 1, 'وبعض الأدوار لا تملك المنح');
});

test('timesheet: the client-portal account cannot log time — no row, no trail', async () => {
  const u = userOf('external');
  const uid = await idOf(u);
  const before = (await db.get('SELECT COUNT(*) n FROM time_entry WHERE user_id = ?', [uid])).n;
  const r = await req(u, '/api/timesheets', { method: 'POST', body: { hours: 3, entry_date: '2026-07-20' } });
  assert.equal(r.status, 403, 'حساب البوابة الخارجية ليس موظفاً ولا يملك ساعات في المنصة');
  assert.equal(JSON.parse(r.text).error?.code, 'forbidden');
  assert.equal((await db.get('SELECT COUNT(*) n FROM time_entry WHERE user_id = ?', [uid])).n, before, 'لا قيد يُكتب');
  assert.equal((await db.get(
    "SELECT COUNT(*) n FROM audit_log WHERE user_id = ? AND resource = 'timesheet'", [uid])).n, 0, 'ولا أثر كتابة في سجل التدقيق');
  // والفترة كذلك: نفس البوابة على تقديم سجل الوقت.
  const p = await req(u, '/api/timesheets/submit', { method: 'POST', body: { periodStart: '2026-07-01', periodEnd: '2026-07-31' } });
  assert.equal(p.status, 403);
  assert.equal((await db.get('SELECT COUNT(*) n FROM timesheet_period WHERE user_id = ?', [uid])).n, 0);
});

test('timesheet: an ordinary employee still logs their own time — and it is audited', async () => {
  const u = userOf('employee');
  const uid = await idOf(u);
  const r = await req(u, '/api/timesheets', { method: 'POST', body: { hours: 4, entry_date: '2026-07-22', note: 'عمل' } });
  assert.equal(r.status, 200, 'الموظف يملك timesheet:create@own');
  const entry = JSON.parse(r.text);
  assert.equal(entry.user_id, uid, 'القيد باسم صاحبه لا باسم غيره');
  assert.equal(entry.hours, 4);
  const trail = await db.get(
    "SELECT username, role_id FROM audit_log WHERE resource = 'timesheet' AND resource_id = ?", [entry.id]);
  assert.equal(trail?.username, u, 'أثر الكتابة يحمل الفاعل الحقيقي');
  // والاستشاري كذلك (نفس المنح بنطاق «خاصتي»).
  assert.equal((await req(userOf('consultant'), '/api/timesheets',
    { method: 'POST', body: { hours: 2, entry_date: '2026-07-22' } })).status, 200);
});

test('timesheet: hours never roll up to a task the logger may not touch', async () => {
  const emp = userOf('employee');
  // FX-TSK-4 مُسنَدة إلى مدير المشروع لا إلى الموظف — والترحيل كتابة على صفّها.
  const before = (await db.get('SELECT COALESCE(actual_hours,0) h FROM task WHERE id = ?', ['FX-TSK-4'])).h;
  const bad = await req(emp, '/api/timesheets', { method: 'POST', body: { hours: 5, entry_date: '2026-07-23', task_id: 'FX-TSK-4' } });
  assert.equal(bad.status, 403, 'مهمة خارج عمل المسجِّل');
  assert.equal((await db.get('SELECT COALESCE(actual_hours,0) h FROM task WHERE id = ?', ['FX-TSK-4'])).h, before,
    'ساعات المهمة لا تتحرّك');
  assert.equal((await db.get('SELECT COUNT(*) n FROM time_entry WHERE task_id = ?', ['FX-TSK-4'])).n, 0, 'ولا قيد يُكتب');
  // مهمته هو (FX-TSK-1 مُسنَدة إليه): تمرّ ويُرحَّل الوقت.
  const mineBefore = (await db.get('SELECT COALESCE(actual_hours,0) h FROM task WHERE id = ?', ['FX-TSK-1'])).h;
  const ok = await req(emp, '/api/timesheets', { method: 'POST', body: { hours: 3, entry_date: '2026-07-24', task_id: 'FX-TSK-1' } });
  assert.equal(ok.status, 200, 'الموظف يسجّل وقتاً على مهمته');
  assert.equal((await db.get('SELECT COALESCE(actual_hours,0) h FROM task WHERE id = ?', ['FX-TSK-1'])).h, mineBefore + 3);
  // ومعرّف مهمة لا وجود له لا يكتب شيئاً.
  assert.equal((await req(emp, '/api/timesheets',
    { method: 'POST', body: { hours: 1, entry_date: '2026-07-25', task_id: 'لا-وجود-لها' } })).status, 404);
});

// ── ② رفع طلبات الاعتماد: من يرى العمل ويملك تغييره ─────────────────────────────
test('approvals: the client-portal account cannot open an internal workflow', async () => {
  const u = userOf('external');
  const uid = await idOf(u);
  const notifBefore = (await db.get("SELECT COUNT(*) n FROM notification WHERE kind = 'approval'")).n;
  // فرصة قائمة في قطاع لا يملك فيه شيئاً
  const a = await req(u, '/api/approvals', { method: 'POST',
    body: { workflowKey: 'opportunity_go_nogo', resource: 'opportunity', resourceId: 'FX-OPP-CONS' } });
  assert.equal(a.status, 403, 'بلا منح على الفرص إطلاقاً');
  assert.equal(JSON.parse(a.text).error?.code, 'forbidden');
  // ومعرّف مخترَع لا يفتح طلباً أيضاً
  const b = await req(u, '/api/approvals', { method: 'POST',
    body: { workflowKey: 'expense_approval', resource: 'expense', resourceId: 'لا-وجود-له' } });
  assert.equal(b.status, 404);
  assert.equal((await db.get('SELECT COUNT(*) n FROM approval_request WHERE requested_by = ?', [uid])).n, 0,
    'لا طلب اعتماد واحد باسمه');
  assert.equal((await db.get("SELECT COUNT(*) n FROM notification WHERE kind = 'approval'")).n, notifBefore,
    'ولا تنبيه يصل معتمِداً');
});

test('approvals: reading a row is not enough — a viewer cannot open a workflow on it', async () => {
  const u = userOf('viewer');
  // «مشاهدة فقط» تقرأ فرص قطاعها (منح قراءة بنطاق قطاع) ولا تملك إنشاءً ولا تعديلاً.
  assert.equal((await req(u, '/api/opportunities/FX-OPP-3')).status, 200, 'يقرأ الفرصة فعلاً');
  const r = await req(u, '/api/approvals', { method: 'POST',
    body: { workflowKey: 'opportunity_go_nogo', resource: 'opportunity', resourceId: 'FX-OPP-3' } });
  assert.equal(r.status, 403, 'القراءة وحدها لا تفتح مسار حوكمة');
  assert.match(msgOf(r), /صلاحيتك/);
});

test('approvals: row-level scope — a sector lead cannot submit another sector’s opportunity', async () => {
  const u = userOf('sector_lead');
  const r = await req(u, '/api/approvals', { method: 'POST',
    body: { workflowKey: 'opportunity_go_nogo', resource: 'opportunity', resourceId: 'FX-OPP-CONS' } });
  assert.equal(r.status, 403, 'الفحص على الصف لا على وجود المنح');
  assert.equal((await db.get('SELECT COUNT(*) n FROM approval_request WHERE resource_id = ?', ['FX-OPP-CONS'])).n, 0);
});

test('approvals: a valid submitter opens a request — sector and amount come from the row, not the body', async () => {
  const u = userOf('bd_manager');
  const uid = await idOf(u);
  const r = await req(u, '/api/approvals', { method: 'POST', body: {
    workflowKey: 'opportunity_go_nogo', resource: 'opportunity', resourceId: 'FX-OPP-3',
    sectorId: 'CONSULTING', amountHalalas: 1 } });   // قيم مزوّرة في الجسم
  assert.equal(r.status, 200, 'مدير تطوير الأعمال يرفع فرصة قطاعه');
  const ar = JSON.parse(r.text);
  assert.equal(ar.status, 'PENDING');
  assert.equal(ar.requested_by, uid);
  assert.equal(ar.sector_id, 'SOLUTIONS', 'القطاع من الفرصة لا من الجسم — وإلا اختار الرافع من يعتمد طلبه');
  assert.equal(ar.amount_halalas, 150_000_000, 'والمبلغ من الفرصة لا من الجسم');
  assert.ok(await db.get("SELECT id FROM audit_log WHERE resource = 'approval' AND resource_id = ? AND username = ?", [ar.id, u]),
    'كل كتابة تترك أثراً بالفاعل الحقيقي');
});

test('approvals: an employee submits their own period; nobody submits someone else’s', async () => {
  const emp = userOf('employee');
  const sub = await req(emp, '/api/timesheets/submit', { method: 'POST', body: { periodStart: '2026-07-20', periodEnd: '2026-07-26' } });
  assert.equal(sub.status, 200);
  const periodId = JSON.parse(sub.text).id;
  const mine = await req(emp, '/api/approvals', { method: 'POST',
    body: { workflowKey: 'timesheet_approval', resource: 'timesheet', resourceId: periodId } });
  assert.equal(mine.status, 200, 'الموظف يرفع فترته للاعتماد');
  assert.equal(JSON.parse(mine.text).resource, 'timesheet');
  // فترة غيره: لا مدير تطوير الأعمال ولا الحساب الخارجي.
  for (const role of ['bd_manager', 'external']) {
    const r = await req(userOf(role), '/api/approvals', { method: 'POST',
      body: { workflowKey: 'timesheet_approval', resource: 'timesheet', resourceId: periodId } });
    assert.equal(r.status, 403, `${role} يرفع فترة موظف آخر`);
  }
});

test('approvals: the workflow decides the resource kind — a mismatched body is refused', async () => {
  const u = userOf('bd_manager');
  const r = await req(u, '/api/approvals', { method: 'POST',
    body: { workflowKey: 'timesheet_approval', resource: 'opportunity', resourceId: 'FX-OPP-3' } });
  assert.equal(r.status, 400, 'اختيار النوع بيد المستخدم = اختيار الفحص المطبَّق عليه');
  assert.equal((await db.get("SELECT COUNT(*) n FROM approval_request WHERE resource_id = ? AND resource = 'timesheet'", ['FX-OPP-3'])).n, 0);
});

// ── ③ رسائل الأخطاء: سطح لا يمسحه فاحص المصطلحات ────────────────────────────────
test('errors: no banned technical term leaks into an error message — including a missing value', async () => {
  const probes = [
    ['/api/approvals', {}],
    ['/api/approvals', { resource: 'opportunity', resourceId: 'FX-OPP-1' }],   // بلا مسار ⟵ كانت تطبع القيمة الغائبة
    ['/api/approvals', { workflowKey: 'مسار-غير-موجود', resourceId: 'FX-OPP-1' }],
    ['/api/approvals', { workflowKey: 'opportunity_go_nogo' }],
    ['/api/timesheets', {}],
    ['/api/timesheets', { hours: 99, entry_date: '2026-07-01' }],
    ['/api/timesheets', { hours: 3 }],
    ['/api/timesheets', { hours: 3, entry_date: '<img src=x>' }],   // تاريخ ليس تاريخاً
  ];
  for (const who of ['demo.employee', 'demo.external']) {
    for (const [path, body] of probes) {
      const r = await req(who, path, { method: 'POST', body });
      const message = msgOf(r);
      assert.ok(message.length > 0, `${path} يعيد رسالة`);
      const hit = BANNED.find((re) => re.test(message));
      assert.equal(hit, undefined, `«${message}» تحمل مصطلحاً محظوراً (${hit})`);
      assert.doesNotMatch(message, /FX-OPP-1|مسار-غير-موجود/, 'الرسالة لا تعيد ما أرسله المستخدم');
    }
  }
});

// ── فصل المهام على باب الاعتماد نفسه ───────────────────────────────────────────
test('approvals: the submitter never approves their own request; a real approver still can', async () => {
  const lead = userOf('sector_lead');
  // قائد القطاع يرفع فرصة قطاعه (FX-OPP-7 يملكها) — وخطوة المسار الأولى دورها «قائد قطاع».
  const sub = await req(lead, '/api/approvals', { method: 'POST',
    body: { workflowKey: 'opportunity_go_nogo', resource: 'opportunity', resourceId: 'FX-OPP-7' } });
  assert.equal(sub.status, 200);
  const rid = JSON.parse(sub.text).id;
  const self = await req(lead, `/api/approvals/${rid}/act`, { method: 'POST', body: { action: 'approve' } });
  assert.equal(self.status, 403, 'من رفع الطلب لا يعتمده');
  assert.equal((await db.get('SELECT status FROM approval_request WHERE id = ?', [rid])).status, 'PENDING');
  // ولا يظهر في طابوره أصلاً: «بانتظار اعتمادك» لا تعرض ما لا يستطيع اعتماده.
  const queue = JSON.parse((await req(lead, '/api/approvals/queue')).text);
  assert.ok(!queue.some((q) => q.id === rid), 'طلب الرافع نفسه خارج طابوره');
  // قرار غير معروف لا يُسجَّل إجراءً على الطلب.
  const junk = await req(userOf('admin'), `/api/approvals/${rid}/act`, { method: 'POST', body: { action: 'ماذا' } });
  assert.equal(junk.status, 400);
  assert.equal((await db.get('SELECT COUNT(*) n FROM approval_action WHERE request_id = ?', [rid])).n, 0);
  // ومعتمِد حقيقي (غير الرافع) يُغلق الطلب.
  const done = await req(userOf('admin'), `/api/approvals/${rid}/act`, { method: 'POST', body: { action: 'approve' } });
  assert.equal(done.status, 200);
  assert.equal(JSON.parse(done.text).status, 'APPROVED');
});
