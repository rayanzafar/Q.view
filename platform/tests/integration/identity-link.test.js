// الهوية: ربط سجل الموظف بحساب الدخول (app_user.employee_id).
// العطل الحقيقي الذي يغطيه هذا الاختبار: العمود موجود منذ أول إصدار ولا مسار يكتبه، فبقي فارغاً
// لكل الحسابات — ومعه تتعطّل عضوية المشاريع ونطاقا «الإدارة» و«الفريق» في الصلاحيات.
// يثبت الاختبار: الربط يكتب العمودين ويُدقَّق، الربط المكرر مرفوض برسالة عربية، ومن لا يملك
// صلاحية تعديل الموظف يُرفض بـ403 على مستوى الخدمة وعلى المسار الفعلي معاً.
// قاعدة بيانات مؤقتة معزولة (بلا DATABASE_URL ⟵ محرّك SQLite).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { request } from 'node:http';

const TEST_DB = resolve(process.cwd(), 'data/test-identity-link.db');
process.env.SANAD_DB = TEST_DB;

let db, org, server, port;
let CURRENT = null; // المستخدم الذي ينتحله خادم الاختبار في الطلب الحالي
const now = () => new Date().toISOString();
const U = (role, sector, scope, extra = {}) => ({ id: 'u_' + role + (sector || ''), username: role, role_id: role,
  sector_id: sector, scope, projectIds: new Set(), teamIds: new Set(), ...extra });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const HR = () => U('hr', null, 'company');
const LEAD = () => U('sector_lead', 'S1', 'sector');
const CONS = () => U('consultant', 'S1', 'project');

const auditRows = (resource, resourceId) =>
  db.all('SELECT * FROM audit_log WHERE resource = ? AND resource_id = ? ORDER BY at', [resource, resourceId]);
const userRow = (id) => db.get('SELECT * FROM app_user WHERE id = ?', [id]);
const empRow = (id) => db.get('SELECT * FROM employee WHERE id = ?', [id]);
const is403 = (e) => e.status === 403;

let empSeq = 0, accSeq = 0;
async function mkEmp(sector, name) {
  const id = 'E' + (++empSeq);
  await db.insert('employee', { id, name_ar: name || ('موظف ' + empSeq), sector_id: sector, active: 1, created_at: now() });
  return id;
}
async function mkAcct(sector, name, role = 'employee') {
  const id = 'acc' + (++accSeq);
  await db.insert('app_user', { id, username: 'user' + accSeq, name_ar: name || ('حساب ' + accSeq),
    role_id: role, sector_id: sector, scope: 'own', active: 1, created_at: now() });
  return id;
}

// طلب فعلي على المسار (بلا fetch كي لا يتدخل أي وسيط شبكة في بيئة التشغيل)
function call(method, path, body) {
  return new Promise((resolve2, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port, path, method,
      headers: Object.assign({ accept: 'application/json' },
        data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
    (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let parsed = b;
        try { parsed = JSON.parse(b); } catch { /* نص خام */ }
        resolve2({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  org = await import('../../src/modules/org/org.js');

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع ١', active: 1, created_at: now() });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع ٢', active: 1, created_at: now() });

  // خادم اختبار يركّب مسارات org وحدها (api.routes.js تملكه جلسة التكامل)
  const express = (await import('express')).default;
  const { orgRouter } = await import('../../src/modules/org/org.routes.js');
  const { errorHandler } = await import('../../src/core/http/errors.js');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.ctx = { user: CURRENT, ip: '127.0.0.1' }; next(); });
  app.use('/api', orgRouter);
  app.use(errorHandler());
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await db.close();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
});

test('الربط ينجح: يكتب العمود على الطرفين ويُدقَّق على الموظف والحساب معاً', async () => {
  const e = await mkEmp('S1', 'أحمد الشمري');
  const a = await mkAcct('S1', 'أحمد الشمري');
  const r = await org.linkUserToEmployee(ctx(HR()), { employeeId: e, userId: a });
  assert.equal(r.ok, true);
  assert.equal(r.employee_id, e);
  assert.equal(r.user_id, a);

  assert.equal((await userRow(a)).employee_id, e, 'app_user.employee_id مكتوب فعلاً');
  assert.equal((await empRow(e)).user_id, a, 'الطرف المقابل في سجل الموظف متسق');

  const empAudit = await auditRows('employee', e);
  assert.equal(empAudit.length, 1, 'سطر تدقيق واحد على الموظف');
  assert.equal(empAudit[0].action, 'update');
  assert.equal(empAudit[0].sector_id, 'S1');
  assert.equal(empAudit[0].role_id, 'hr');
  assert.equal(JSON.parse(empAudit[0].detail_json).linked_user_id, a);

  const accAudit = await auditRows('app_user', a);
  assert.equal(accAudit.length, 1, 'سطر تدقيق واحد على الحساب');
  assert.equal(JSON.parse(accAudit[0].detail_json).linked_employee_id, e);
});

test('الربط المكرر مرفوض: حساب آخر لنفس الموظف، ونفس الزوج مرتين، وحساب مربوط بموظف آخر', async () => {
  const e1 = await mkEmp('S1');
  const e2 = await mkEmp('S1');
  const a1 = await mkAcct('S1');
  const a2 = await mkAcct('S1');
  await org.linkUserToEmployee(ctx(HR()), { employeeId: e1, userId: a1 });

  await assert.rejects(() => org.linkUserToEmployee(ctx(HR()), { employeeId: e1, userId: a2 }),
    /مربوط بحساب/, 'الموظف محجوز لحساب آخر');
  await assert.rejects(() => org.linkUserToEmployee(ctx(HR()), { employeeId: e1, userId: a1 }),
    /مسبقاً/, 'نفس الزوج لا يُربط مرتين');
  await assert.rejects(() => org.linkUserToEmployee(ctx(HR()), { employeeId: e2, userId: a1 }),
    /مربوط بالموظف/, 'الحساب محجوز لموظف آخر');

  // لا كتابة ولا تدقيق نتيجة المحاولات المرفوضة
  assert.equal((await userRow(a2)).employee_id, null);
  assert.equal((await empRow(e2)).user_id, null);
  assert.equal((await auditRows('employee', e2)).length, 0);
  assert.equal((await auditRows('app_user', a2)).length, 0);
  assert.equal((await auditRows('app_user', a1)).length, 1, 'سطر واحد فقط من الربط الناجح');
});

// العطل الذي رآه المالك: «لما يضغط على إسحاق أو يعقوب ما يبين ملفهم وهم مسكنين على أيش». والسبب
// ربطٌ نصفيّ — الحساب يشير إلى الموظف وسجلّ الموظف لا يشير إلى الحساب. وكان المسار يردّ على محاولة
// الإصلاح بـ«مربوط مسبقاً»: يخبر المشغّل أن الأمر سليم بينما نصفه ساقط، فلا سبيل إلى الإصلاح من
// الواجهة إطلاقاً. الردّ الآن مشروط باتفاق العمودين، والنصف الناقص يُكمَل.
test('الربط النصفيّ يُصلَح لا يُردّ — والردّ يبقى حين يتفق العمودان', async () => {
  const e = await mkEmp('S1', 'إسحاق');
  const a = await mkAcct('S1', 'إسحاق');
  // نصفٌ مكتوب ونصفٌ ساقط: الحساب يعرف الموظف، والموظف لا يعرف الحساب.
  await db.update('app_user', a, { employee_id: e });
  assert.equal((await empRow(e)).user_id, null, 'التهيئة نفسها يجب أن تكون نصفية');

  const r = await org.linkUserToEmployee(ctx(HR()), { employeeId: e, userId: a });
  assert.equal(r.ok, true);
  assert.equal((await empRow(e)).user_id, a, 'النصف الناقص لم يُكتب — والملف يبقى مجهولاً');
  assert.equal((await userRow(a)).employee_id, e);

  // وبعد اكتمال الطرفين يعود الردّ: لا ربط مكرر لزوجٍ متفق.
  await assert.rejects(() => org.linkUserToEmployee(ctx(HR()), { employeeId: e, userId: a }), /مسبقاً/);
});

test('من لا يملك صلاحية تعديل الموظف يُرفض بـ403 ولا يكتب شيئاً', async () => {
  const e = await mkEmp('S1');
  const a = await mkAcct('S1');
  await assert.rejects(() => org.linkUserToEmployee(ctx(CONS()), { employeeId: e, userId: a }), is403);
  await assert.rejects(() => org.unlinkUserFromEmployee(ctx(CONS()), { employeeId: e }), is403);
  assert.equal((await userRow(a)).employee_id, null);
  assert.equal((await auditRows('employee', e)).length, 0);
});

test('قائد القطاع يربط داخل قطاعه فقط — وموظف قطاع آخر يُرفض بـ403', async () => {
  const mine = await mkEmp('S1');
  const other = await mkEmp('S2');
  const a1 = await mkAcct('S1');
  const a2 = await mkAcct('S2');
  const r = await org.linkUserToEmployee(ctx(LEAD()), { employeeId: mine, userId: a1 });
  assert.equal(r.ok, true);
  assert.equal((await userRow(a1)).employee_id, mine);
  await assert.rejects(() => org.linkUserToEmployee(ctx(LEAD()), { employeeId: other, userId: a2 }), is403);
});

test('قائد القطاع لا يربط موظفه بحساب من قطاع آخر (نطاق الطرفين محفوظ)', async () => {
  const mine = await mkEmp('S1');
  const foreign = await mkAcct('S2');
  await assert.rejects(() => org.linkUserToEmployee(ctx(LEAD()), { employeeId: mine, userId: foreign }),
    (e) => e.status === 403 && /خارج نطاق قطاعك/.test(e.message));
  assert.equal((await userRow(foreign)).employee_id, null);
  // والموارد البشرية (نطاق شركة) تربطه بلا قيد
  const r = await org.linkUserToEmployee(ctx(HR()), { employeeId: mine, userId: foreign });
  assert.equal(r.ok, true);
});

test('فك الربط: يمسح العمودين ويُدقَّق، وتكراره يُرفض برسالة عربية', async () => {
  const e = await mkEmp('S1', 'نورة');
  const a = await mkAcct('S1', 'نورة');
  await org.linkUserToEmployee(ctx(HR()), { employeeId: e, userId: a });

  const r = await org.unlinkUserFromEmployee(ctx(HR()), { employeeId: e });
  assert.equal(r.ok, true);
  assert.equal((await userRow(a)).employee_id, null, 'العمود فُرِّغ');
  assert.equal((await empRow(e)).user_id, null);
  assert.equal((await auditRows('employee', e)).length, 2, 'ربط + فك ربط مُدقَّقان');
  assert.equal(JSON.parse((await auditRows('app_user', a))[1].detail_json).unlinked_employee_id, e);

  await assert.rejects(() => org.unlinkUserFromEmployee(ctx(HR()), { employeeId: e }), /غير مربوط/);
  // بعد فك الربط يعود الحساب متاحاً لموظف آخر
  const e2 = await mkEmp('S1');
  const again = await org.linkUserToEmployee(ctx(HR()), { employeeId: e2, userId: a });
  assert.equal(again.ok, true);
});

test('فك الربط بمعرّف الحساب وحده يعمل، ورسائل عربية لكل مُدخل ناقص أو محذوف', async () => {
  const e = await mkEmp('S1');
  const a = await mkAcct('S1');
  await org.linkUserToEmployee(ctx(HR()), { employeeId: e, userId: a });
  await org.unlinkUserFromEmployee(ctx(HR()), { userId: a });
  assert.equal((await userRow(a)).employee_id, null);

  await assert.rejects(() => org.linkUserToEmployee(ctx(HR()), {}), /اختر الموظف/);
  await assert.rejects(() => org.linkUserToEmployee(ctx(HR()), { employeeId: e }), /اختر حساب الدخول/);
  await assert.rejects(() => org.linkUserToEmployee(ctx(HR()), { employeeId: 'emp_لا_وجود_له', userId: a }), /غير موجود/);
  await assert.rejects(() => org.linkUserToEmployee(ctx(HR()), { employeeId: e, userId: 'acc_لا_وجود_له' }), /حساب الدخول غير موجود/);
  await assert.rejects(() => org.unlinkUserFromEmployee(ctx(HR()), {}), /حدّد الموظف/);

  // موظف محذوف ناعماً لا يُربط
  const gone = await mkEmp('S1');
  await org.softDeleteEmployee(ctx(HR()), gone);
  await assert.rejects(() => org.linkUserToEmployee(ctx(HR()), { employeeId: gone, userId: a }), /غير موجود أو محذوف/);
});

test('تعديل الموظف بحقل link_user_id يربط ويفك (المسار الذي تستعمله صفحة الفريق)', async () => {
  const e = await mkEmp('S1', 'سلطان');
  const a = await mkAcct('S1', 'سلطان');
  const after1 = await org.updateEmployee(ctx(HR()), e, { link_user_id: a });
  assert.equal(after1.id, e, 'يعيد سجل الموظف كما كان يفعل دائماً');
  assert.equal((await userRow(a)).employee_id, e);
  assert.equal((await auditRows('employee', e)).length, 1, 'طلب ربط فقط ⟵ سطر تدقيق واحد بلا تعديل فارغ');

  // ربط + تعديل بيانات في طلب واحد
  const b = await mkAcct('S1');
  await org.unlinkUserFromEmployee(ctx(HR()), { employeeId: e });
  const after2 = await org.updateEmployee(ctx(HR()), e, { link_user_id: b, job_title: 'مستشار' });
  assert.equal(after2.job_title, 'مستشار');
  assert.equal((await userRow(b)).employee_id, e);

  const after3 = await org.updateEmployee(ctx(HR()), e, { link_user_id: null });
  assert.equal(after3.id, e);
  assert.equal((await userRow(b)).employee_id, null, 'قيمة فارغة ⟵ فك ربط');
});

test('لوحة الربط: عدّ من بلا حساب، والحسابات المتاحة محصورة بنطاق القارئ', async () => {
  const eA = await mkEmp('S1');
  const eB = await mkEmp('S1');
  const eOff = await mkEmp('S1');
  await db.run('UPDATE employee SET active = 0 WHERE id = ?', [eOff]); // غير النشط لا يُحسب
  const acc = await mkAcct('S1');
  await mkAcct('S2'); // حساب خارج قطاع القائد
  await org.linkUserToEmployee(ctx(HR()), { employeeId: eA, userId: acc });

  const hrView = await org.identityLinks(HR(), { sector: 'S1' });
  assert.equal(hrView.canLink, true);
  assert.deepEqual(hrView.byEmployee[eA], { user_id: acc, username: (await userRow(acc)).username, name_ar: (await userRow(acc)).name_ar, role_id: 'employee' });
  assert.equal(hrView.byEmployee[eB], null, 'موظف بلا حساب يظهر بقيمة فارغة');
  assert.ok(hrView.unlinkedCount >= 1);
  assert.ok(!Object.prototype.hasOwnProperty.call(hrView.byEmployee, 'emp_غير_موجود'));
  assert.ok(hrView.freeAccounts.every((u) => u.id !== acc), 'الحساب المربوط يخرج من قائمة المتاح');
  assert.ok(hrView.freeAccounts.some((u) => u.sector_id === 'S2'), 'نطاق الشركة يرى حسابات كل القطاعات');

  const leadView = await org.identityLinks(LEAD(), {});
  assert.ok(leadView.freeAccounts.length > 0);
  assert.ok(leadView.freeAccounts.every((u) => u.sector_id === 'S1'), 'قائد القطاع يرى حسابات قطاعه فقط');

  // الموارد البشرية تقرأ ولا يقرأ الاستشاري
  await assert.rejects(() => org.identityLinks(CONS(), {}), is403);
});

test('اللوحة لا تفتح قائمة الحسابات لمن لا يملك الربط (قراءة فقط)', async () => {
  const viewer = U('ceo_office', null, 'company');
  const v = await org.identityLinks(viewer, {});
  assert.equal(v.canLink, false, 'مكتب الرئيس يقرأ الفريق ولا يعدّله');
  assert.deepEqual(v.freeAccounts, [], 'لا تُسرَّب قائمة الحسابات لمن لا يربط');
  assert.ok(typeof v.unlinkedCount === 'number');
});

test('المسار الفعلي: الربط 200 لمن يملك الصلاحية، و403 لمن لا يملكها، وفك الربط يعمل', async () => {
  const e = await mkEmp('S1', 'ماجد');
  const a = await mkAcct('S1', 'ماجد');

  CURRENT = CONS();
  const denied = await call('POST', '/api/employees/' + e + '/link', { user_id: a });
  assert.equal(denied.status, 403, 'من لا يملك الصلاحية يُرفض بـ403');
  assert.match(denied.body.error.message, /صلاحية/);
  assert.equal((await userRow(a)).employee_id, null);

  CURRENT = HR();
  const ok = await call('POST', '/api/employees/' + e + '/link', { user_id: a });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.employee_id, e);
  assert.equal((await userRow(a)).employee_id, e);

  const dup = await call('POST', '/api/org/employees/' + e + '/link', { user_id: a });
  assert.equal(dup.status, 400, 'الربط المكرر يُرفض على المسار أيضاً');
  assert.match(dup.body.error.message, /مسبقاً/);

  const links = await call('GET', '/api/org/identity-links?sector=S1');
  assert.equal(links.status, 200);
  assert.equal(links.body.byEmployee[e].user_id, a);

  const off = await call('DELETE', '/api/employees/' + e + '/link');
  assert.equal(off.status, 200);
  assert.equal((await userRow(a)).employee_id, null);
  CURRENT = null;
});
