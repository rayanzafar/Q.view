// أربع ثغرات تكميلية أغلقتها المراجعة الأمنية بعد الموجة الأولى — كلها مؤكَّدة بالتنفيذ.
//
// ١) إنشاء المهمة كان بلا بوابة إطلاقاً: حارس «الإسناد لغيرك» يعود مبكّراً حين يُسنِد المرء
//    لنفسه، فبقي الباب مفتوحاً لكل حساب مسجَّل — ومنه حساب بوابة العميل، أنشأ مهمة في قطاع
//    لا علاقة له به لأن القطاع يُؤخذ من الطلب بلا تحقق.
// ٢) سجل الوقت كان يُعرَض بلا تهريب — ذاتيّ الضرر اليوم، مخزَّن على غيره لحظة ظهور أول شاشة
//    إدارية تعرض سجلات الفريق، وهي الشاشة المطلوبة في الموجة القادمة.
// ٣) صفحة الخطأ تحقن نصّ الرسالة في HTML بلا تهريب.
// ٤) ثلاثة عشر دوراً موظَّفاً لا يستطيعون تسجيل وقتهم بينما الصفحة ونموذجها مفتوحان لهم —
//    الصفحة تَعِد بما يرفضه الخادم.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-write-gates-followup.db');
process.env.SANAD_DB = TEST_DB;

const T = '2026-04-01T08:00:00.000Z';
const TODAY = new Date().toISOString().slice(0, 10);   // صفحة سجل الوقت تقرأ آخر سبعة أيام
let db, tasks, timesheets, ROLE_GRANTS, can;
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const U = (role, sector, scope, id) => ({ id: id || 'u_' + role, username: role, role_id: role,
  sector_id: sector, scope, employee_id: null, projectIds: new Set(), teamIds: new Set() });

const external = U('external', null, 'own');
const employee = U('employee', 'S1', 'own');
const lead = U('sector_lead', 'S1', 'sector');

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ can } = await import('../../src/core/rbac/index.js'));
  ({ ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js'));
  tasks = await import('../../src/modules/pmo/tasks.js');
  timesheets = await import('../../src/modules/timesheets/timesheets.js');
  for (const s of ['S1', 'S2']) await db.insert('sector', { id: s, name_ar: 'قطاع ' + s, active: 1, created_at: T });
  for (const u of [external, employee, lead])
    await db.insert('app_user', { id: u.id, username: u.username, role_id: u.role_id, sector_id: u.sector_id,
      scope: u.scope, active: 1, created_at: T });
});
after(async () => { await db.close(); wipe(); });

test('حساب بوابة العميل لا يُنشئ مهمة — كان يُنشئها في أي قطاع', async () => {
  await assert.rejects(
    async () => tasks.quickAddTask(ctx(external), { title: 'مهمة من عميل', sector_id: 'S2' }),
    (e) => e.status === 403,
  );
  assert.equal((await db.get('SELECT COUNT(*) n FROM task')).n, 0, 'ولا صف يُكتب');
});

test('الموظف يُنشئ مهمته في قطاعه — البوابة لا تكسر المسار المشروع', async () => {
  const t = await tasks.quickAddTask(ctx(employee), { title: 'مهمتي' });
  assert.ok(t.id);
  assert.equal(t.sector_id, 'S1');
  assert.equal(t.assignee_user_id, employee.id, 'المُسنَد إليه هو المنشئ افتراضاً');
});

test('من نطاقه «خاصتي» لا يزرع مهمة في لوحة قطاع آخر — القطاع يُثبَّت على قطاعه', async () => {
  // الرفض ليس الإصلاح الصحيح هنا: منح «خاصتي» يمرّ على «المهمة لي» بصرف النظر عن القطاع
  // المكتوب في الطلب، فالفحص وحده لا يمنع الزرع. التثبيت يُبقي المسار المشروع يعمل ويسدّ الزرع.
  const t = await tasks.quickAddTask(ctx(employee), { title: 'مهمة موجَّهة لقطاع آخر', sector_id: 'S2' });
  assert.equal(t.sector_id, 'S1', 'القطاع المطلوب أُهمل وثُبِّت قطاع صاحبها');
  const a = await db.get("SELECT sector_id FROM audit_log WHERE resource = 'task' AND resource_id = ?", [t.id]);
  assert.equal(a.sector_id, 'S1', 'وسجل التدقيق يحمل القطاع المثبَّت لا المطلوب');
});

test('كل دور موظَّف يسجّل وقته — والمستثنيان بقصد', async () => {
  const logs = (r) => r === 'admin'
    || ROLE_GRANTS[r].some((g) => g.resource === 'timesheet' && g.action === 'create' && g.scope === 'own');
  for (const r of Object.keys(ROLE_GRANTS)) {
    if (['external', 'viewer'].includes(r)) assert.equal(logs(r), false, `${r} ليس موظفاً منتِجاً للعمل`);
    else assert.equal(logs(r), true, `${r} دور موظَّف ويجب أن يسجّل وقته`);
  }
});

test('المنح بنطاق «خاصتي» — لا أحد يسجّل وقتاً باسم غيره', () => {
  assert.equal(can(lead, 'create', 'timesheet', { user_id: lead.id }), true, 'وقته هو');
  assert.equal(can(lead, 'create', 'timesheet', { user_id: employee.id }), false, 'لا وقت غيره');
});

test('قائد القطاع يسجّل وقته فعلاً عبر الخدمة — لا وعدَ شاشةٍ يردّه الخادم', async () => {
  const e = await timesheets.addEntry(ctx(lead), { hours: 3, entry_date: TODAY, work_kind: 'project' });
  assert.ok(e && (e.id || e.entry_date), 'السجل يُكتب');
});

test('سجل الوقت يُعرَض مُهرَّباً — ونوع العمل بالعربية لا كما هو مخزَّن', async () => {
  await timesheets.addEntry(ctx(employee), {
    hours: 2, entry_date: TODAY, work_kind: 'project',
    note: '<b id="xss-probe">محاولة</b>',
  });
  const { timesheetPage } = await import('../../src/web/views/people.js');
  const html = await timesheetPage(employee);
  assert.ok(!html.includes('<b id="xss-probe">'), 'الوسم لا يصل خاماً إلى الصفحة');
  assert.match(html, /&lt;b id=&quot;xss-probe&quot;&gt;/, 'بل مُهرَّباً');
  assert.ok(!/<td class="px-3 text-\[13px\]">project</.test(html), 'نوع العمل لا يُطبع كما هو مخزَّن');
  assert.match(html, /مشروع/, 'بل بتسميته العربية');
});

test('صفحة الخطأ تُهرِّب نص الرسالة — بابٌ يُغلَق قبل أن يُفتح', async () => {
  const { errorHandler, badRequest } = await import('../../src/core/http/errors.js');
  const handler = errorHandler();
  let sent = '';
  const res = { statusCode: 0, status(s) { this.statusCode = s; return this; },
    type() { return this; }, send(b) { sent = String(b); return this; }, json(b) { sent = JSON.stringify(b); return this; } };
  handler(badRequest('<script>alert(1)</script>'),
    { originalUrl: '/app/tasks', accepts: () => 'html', get: () => 'text/html' }, res, () => {});
  assert.match(sent, /&lt;script&gt;/, 'بل مُهرَّباً');
  assert.ok(!sent.includes('<script>alert(1)</script>'), 'الوسم لا يُحقَن خاماً');
});
