// حسابات الأدوار السبعة الناقصة — والبرهان أن إنشاءها لا يمسّ بيانات العميل.
//
// الخطر الحقيقي الذي يحرسه هذا الملف ليس خطأً في seed-roles.js، بل **الإغراء**: من يريد
// الحسابات السبعة سيجدها في `scripts/seed.js` ويمدّ يده إلى `npm run seed`. وذاك السكربت بلا
// حارس بيئة، وسطوره 203-237 تُنفِّذ تعديلات غير مشروطة على صفوف أعمال حقيقية — يكتب قائد قطاع
// الحلول فوق قائده الحقيقي، ويكتب مالك مشروع حقيقي، ويُعيد إسناد مالكي عشرات الفرص إلى شخصيات
// العرض ويكتب فوق «الإجراء التالي» فيها. على بيئة تحمل بيانات عميل حقيقية هذا إتلاف لا بذر.
//
// لذلك القاعدة هنا **تُحاكي البيئة الحيّة**: قائد قطاع حقيقي، مالك مشروع حقيقي، ست فرص مملوكة
// بإجراءاتها التالية، والحسابات العشرة القائمة فعلاً. ثم يُشغَّل seed-roles ويُقارَن كل صفّ من
// sector/project/opportunity **حرفاً بحرف** قبل وبعد. أي انزلاق نحو مسار seed.js الكامل يسقط هنا.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-seed-roles.db');
process.env.SANAD_DB = TEST_DB;

let db, seedRoles, MISSING_ROLE_ACCOUNTS, DEMO_PW, DEMO_USERS, verifyPassword, ROLE_GRANTS;
const now = () => new Date().toISOString();
const REAL_TABLES = ['sector', 'project', 'opportunity', 'client', 'stage'];

// بصمة صفوف الأعمال: كل الأعمدة، لا عيّنة منها — «لم يتغيّر شيء» لا تُثبَت بمقارنة ما نتوقّعه.
async function fingerprint() {
  const out = {};
  for (const t of REAL_TABLES) out[t] = JSON.stringify(await db.all(`SELECT * FROM ${t} ORDER BY id`));
  out.real_users = JSON.stringify(
    await db.all("SELECT * FROM app_user WHERE username LIKE 'real.%' ORDER BY id"));
  return out;
}
function assertUntouched(before_, after_, label) {
  for (const k of Object.keys(before_))
    assert.equal(after_[k], before_[k], `${label}: صفوف «${k}» تغيّرت — seed-roles لا يجوز أن يمسّها`);
}
const countUsers = async () => (await db.get('SELECT COUNT(*) n FROM app_user')).n;
const userRow = (u) => db.get('SELECT * FROM app_user WHERE username = ?', [u]);
const capture = () => { const lines = []; return { lines, log: (s) => lines.push(String(s)) }; };

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ verifyPassword } = await import('../../src/core/auth/password.js'));
  ({ ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js'));
  ({ DEMO_PW, DEMO_USERS } = await import('../../scripts/seed.js'));
  ({ seedRoles, MISSING_ROLE_ACCOUNTS } = await import('../../scripts/seed-roles.js'));

  const at = now();
  await db.insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, created_at: at });
  // «حقيقي» هنا = صفّ لا يخصّ العرض، وهو ما يكتب فوقه seed.js الكامل.
  await db.insert('app_user', { id: 'u_real_lead', username: 'real.lead', email: 'real.lead@evc.com.sa',
    name_ar: 'قائد القطاع الحقيقي', role_id: 'sector_lead', sector_id: 'SOLUTIONS', scope: 'sector',
    active: 1, must_change_pw: 0, created_at: at });
  await db.insert('app_user', { id: 'u_real_pm', username: 'real.pm', email: 'real.pm@evc.com.sa',
    name_ar: 'مدير مشروع حقيقي', role_id: 'project_manager', sector_id: 'SOLUTIONS', scope: 'own',
    active: 1, must_change_pw: 0, created_at: at });
  await db.run('UPDATE sector SET lead_user_id = ? WHERE id = ?', ['u_real_lead', 'SOLUTIONS']);
  await db.insert('client', { id: 'cl_1', name_ar: 'جهة حقيقية', created_at: at });
  await db.insert('project', { id: 'pr_1', code: 'P-001', name_ar: 'مشروع حقيقي', client_id: 'cl_1',
    sector_id: 'SOLUTIONS', owner_user_id: 'u_real_pm', status: 'قيد التنفيذ', created_at: at });
  await db.insert('stage', { id: 'st_open', name_ar: 'تأهيل', sort_order: 1, is_won: 0, is_lost: 0 });
  await db.insert('stage', { id: 'st_won', name_ar: 'فوز', sort_order: 9, is_won: 1, is_lost: 0 });
  await db.insert('stage', { id: 'st_lost', name_ar: 'خسارة', sort_order: 10, is_won: 0, is_lost: 1 });
  for (let i = 1; i <= 6; i++)
    await db.insert('opportunity', { id: 'op_' + i, title_ar: 'فرصة حقيقية ' + i, client_id: 'cl_1',
      sector_id: 'SOLUTIONS', stage_id: i > 4 ? 'st_won' : 'st_open', owner_user_id: 'u_real_lead',
      next_action: 'إجراء حقيقي ' + i, created_at: at });
  // الحسابات التسعة القائمة على البيئة الحيّة اليوم — والسبعة غائبة، كما هي الحال هناك.
  // (وكانت عشرة: `demo.finance` مُختَّم بعد إلغاء دور «المالية» — الترحيلة ٠١٨.)
  for (const u of ['demo.admin', 'demo.ceo', 'demo.sectorlead', 'demo.bd', 'demo.pm',
    'demo.hr', 'demo.consultant', 'demo.employee', 'demo.viewer']) {
    const d = DEMO_USERS.find((x) => x.u === u);
    await db.insert('app_user', { id: 'u_' + u.replace('.', '_'), username: d.u, email: d.email || d.u + '@evc.com.sa',
      name_ar: d.name, role_id: d.role, sector_id: d.sector, scope: d.scope, active: 1, must_change_pw: 0, created_at: at });
  }
});

after(async () => {
  await db.close();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
});

test('الأدوار السبعة معرَّفة في seed.js — لا تعريفات مُخترعة في سكربت ثانٍ', () => {
  assert.equal(MISSING_ROLE_ACCOUNTS.length, 7);
  for (const u of MISSING_ROLE_ACCOUNTS)
    assert.ok(DEMO_USERS.some((d) => d.u === u), `${u} غير معرَّف في DEMO_USERS`);
});

test('العرض بلا تنفيذ: لا صفّ يُكتب ولا سطر تدقيق', async () => {
  const before_ = await fingerprint();
  const users = await countUsers();
  const cap = capture();
  const r = await seedRoles({ log: cap.log });
  assert.equal(r.applied, false);
  assert.equal(await countUsers(), users, 'العرض كتب حساباً');
  assert.equal((await db.get('SELECT COUNT(*) n FROM audit_log')).n, 0, 'العرض كتب سطر تدقيق');
  assert.equal((await db.get('SELECT COUNT(*) n FROM department')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*) n FROM employee')).n, 0);
  assertUntouched(before_, await fingerprint(), 'العرض');
  const text = cap.lines.join('\n');
  for (const u of MISSING_ROLE_ACCOUNTS) assert.match(text, new RegExp(u.replace('.', '\\.')));
  assert.match(text, /لم تُكتب أي بيانات/);
});

test('تعارض البريد يوقف قبل أول كتابة — ويسمّي الحساب المتعارض', async () => {
  const at = now();
  await db.insert('app_user', { id: 'u_real_ops', username: 'real.ops', email: 'demo.ops@evc.com.sa',
    name_ar: 'موظف تشغيل حقيقي', role_id: 'operations', sector_id: 'SOLUTIONS', scope: 'sector',
    active: 1, must_change_pw: 0, created_at: at });
  const before_ = await fingerprint();
  const users = await countUsers();
  await assert.rejects(() => seedRoles({ apply: true, log: () => {} }), (e) => {
    assert.match(e.message, /demo\.ops/);
    assert.match(e.message, /real\.ops/, 'الرسالة لا تسمّي الحساب المتعارض');
    assert.match(e.message, /[؀-ۿ]/, 'الرسالة ليست عربية');
    return true;
  });
  assert.equal(await countUsers(), users, 'كُتب حساب رغم التعارض — التوقّف يجب أن يسبق أول كتابة');
  assert.equal(await userRow('demo.deptmgr'), undefined, 'أُنشئ حساب قبل الاصطدام بالتعارض');
  assertUntouched(before_, await fingerprint(), 'التعارض');
  await db.run('DELETE FROM app_user WHERE id = ?', ['u_real_ops']); // تنظيف تجهيزة الاختبار
});

// ── الفحص الجوهري ───────────────────────────────────────────────────────────
test('التنفيذ يُنشئ السبعة ولا يمسّ قائد القطاع ولا مالك المشروع ولا فرصةً واحدة', async () => {
  const before_ = await fingerprint();
  const r = await seedRoles({ apply: true, log: () => {} });
  assert.equal(r.applied, true);
  assert.deepEqual(r.created.sort(), [...MISSING_ROLE_ACCOUNTS].sort());
  assert.equal(r.updated.length, 0);

  assertUntouched(before_, await fingerprint(), 'التنفيذ');
  // وبالاسم صراحةً، كي تقول رسالة الفشل ما ضاع لا «تغيّرت جداول»:
  assert.equal((await db.get('SELECT lead_user_id FROM sector WHERE id = ?', ['SOLUTIONS'])).lead_user_id,
    'u_real_lead', 'كُتب قائد القطاع فوق الحقيقي — هذا ما يفعله seed.js:204');
  assert.equal((await db.get('SELECT owner_user_id FROM project WHERE id = ?', ['pr_1'])).owner_user_id,
    'u_real_pm', 'كُتب مالك المشروع فوق الحقيقي — seed.js:207');
  const opps = await db.all('SELECT id, owner_user_id, next_action FROM opportunity ORDER BY id');
  for (const o of opps) {
    assert.equal(o.owner_user_id, 'u_real_lead', `أُعيد إسناد الفرصة ${o.id} — seed.js:230`);
    assert.match(o.next_action, /^إجراء حقيقي/, `كُتب فوق الإجراء التالي في ${o.id} — seed.js:233`);
  }
  // ولا سطر تدقيق على تلك الموارد أصلاً: لا كتابة صامتة ولا كتابة مُدقَّقة.
  const touched = await db.all(
    "SELECT DISTINCT resource FROM audit_log WHERE resource IN ('sector','project','opportunity') ORDER BY resource");
  assert.deepEqual(touched, [], 'seed-roles كتب على مورد أعمال');
});

test('السبعة تدخل فعلاً: مُفعَّلة، بدورها ونطاقها، وكلمة المرور القياسية تعمل', async () => {
  for (const u of MISSING_ROLE_ACCOUNTS) {
    const row = await userRow(u);
    const want = DEMO_USERS.find((d) => d.u === u);
    assert.ok(row, `${u} لم يُنشأ`);
    assert.equal(row.deleted_at, null, `${u} محذوف — الدخول سيفشل`);
    assert.equal(Number(row.active), 1, `${u} غير مُفعَّل — الدخول سيفشل`);
    assert.equal(Number(row.must_change_pw), 0);
    assert.equal(row.role_id, want.role);
    assert.equal(row.scope, want.scope);
    assert.equal(row.sector_id, want.sector);
    assert.equal(row.email, want.email || u + '@evc.com.sa');
    assert.ok(verifyPassword(DEMO_PW, row.password_hash), `${u}: كلمة المرور القياسية لا تفتح الحساب`);
  }
  // المستخدم الخارجي عميلٌ لا زميل: بلا قطاع، وبريده على نطاق العميل.
  const ext = await userRow('demo.external');
  assert.equal(ext.sector_id, null);
  assert.ok(!ext.email.endsWith('@evc.com.sa'), 'بريد المستخدم الخارجي على نطاق الشركة');
});

// العطل الذي وُجد السكربت لأجله، مقيساً من طرفه: هذه الحسابات كانت تُرجع 302 ⟵ /login?e=1
// لأن صفوفها غير موجودة أصلاً. فحص وجود الصف لا يكفي — الفحص هو الدخول نفسه.
test('الدخول ينجح فعلاً بالحسابات السبعة', async () => {
  const { login } = await import('../../src/core/auth/service.js');
  for (const u of MISSING_ROLE_ACCOUNTS) {
    const r = await login({ username: u, password: DEMO_PW, ip: '127.0.0.1', userAgent: 'test' });
    assert.equal(r.ok, true, `${u}: الدخول ما زال يفشل (${r.reason || ''})`);
    assert.equal(r.mustChangePassword, false, `${u}: يُطالَب بتغيير كلمة المرور فيتعثّر المسح الحيّ`);
  }
});

test('مدير الإدارة والمدير المباشر لهما سجل موظف بإدارة — وإلا فنطاق «الإدارة» غير قابل للفحص', async () => {
  for (const u of ['demo.deptmgr', 'demo.linemgr']) {
    const acc = await userRow(u);
    assert.ok(acc.employee_id, `${u} بلا سجل موظف — context.js يستنتج الإدارة من هذا الربط`);
    const emp = await db.get('SELECT * FROM employee WHERE id = ?', [acc.employee_id]);
    assert.ok(emp && emp.department_id, `${u} مربوط بموظف بلا إدارة`);
    assert.equal(emp.user_id, acc.id, 'الطرف المقابل في سجل الموظف غير متسق');
    const dep = await db.get('SELECT * FROM department WHERE id = ?', [emp.department_id]);
    assert.equal(dep.sector_id, 'SOLUTIONS');
  }
  // إدارتان لا واحدة: «رأى إدارته» ليس إثباتاً ما لم يوجد أشخاص خارجها يثبت غيابهم.
  assert.equal((await db.get('SELECT COUNT(*) n FROM department WHERE deleted_at IS NULL')).n, 2);
  const deps = await db.all(
    'SELECT department_id, COUNT(*) n FROM employee WHERE deleted_at IS NULL GROUP BY department_id ORDER BY department_id');
  assert.equal(deps.length, 2, 'الموظفون كلهم في إدارة واحدة');
});

test('كل دور في المصفوفة صار له حساب حيّ — التغطية ١٦ من ١٦ (أُلغي دور «المالية»)', async () => {
  const have = new Set((await db.all(
    'SELECT DISTINCT role_id FROM app_user WHERE active = 1 AND deleted_at IS NULL')).map((r) => r.role_id));
  const missing = Object.keys(ROLE_GRANTS).filter((r) => !have.has(r));
  assert.deepEqual(missing, [], `أدوار بلا حساب: ${missing.join('، ')}`);
});

test('إعادة التشغيل آمنة: بلا تكرار وبلا مساس بصفوف الأعمال', async () => {
  const before_ = await fingerprint();
  const users = await countUsers();
  const deps = (await db.get('SELECT COUNT(*) n FROM department')).n;
  const emps = (await db.get('SELECT COUNT(*) n FROM employee')).n;
  const r = await seedRoles({ apply: true, log: () => {} });
  assert.equal(r.created.length, 0, 'أُنشئ حساب ثانٍ لنفس الشخص');
  assert.equal(r.updated.length, 7);
  assert.equal(await countUsers(), users);
  assert.equal((await db.get('SELECT COUNT(*) n FROM department')).n, deps, 'إدارة مكرَّرة');
  assert.equal((await db.get('SELECT COUNT(*) n FROM employee')).n, emps, 'موظف مكرَّر');
  assertUntouched(before_, await fingerprint(), 'إعادة التشغيل');
});

test('حساب محذوف بنفس اسم الدخول يوقف التشغيل — الإحياء قرار بشري', async () => {
  await db.run('UPDATE app_user SET deleted_at = ? WHERE username = ?', [now(), 'demo.approver']);
  await assert.rejects(() => seedRoles({ apply: true, log: () => {} }), (e) => {
    assert.match(e.message, /demo\.approver/);
    assert.match(e.message, /محذوف/);
    return true;
  });
  await db.run('UPDATE app_user SET deleted_at = NULL WHERE username = ?', ['demo.approver']);
});

test('--accounts-only لا يقترب من الإدارات ولا الموظفين', async () => {
  const deps = JSON.stringify(await db.all('SELECT * FROM department ORDER BY id'));
  const emps = JSON.stringify(await db.all('SELECT * FROM employee ORDER BY id'));
  const r = await seedRoles({ apply: true, accountsOnly: true, log: () => {} });
  assert.equal(r.orgResult, null);
  assert.equal(JSON.stringify(await db.all('SELECT * FROM department ORDER BY id')), deps);
  assert.equal(JSON.stringify(await db.all('SELECT * FROM employee ORDER BY id')), emps);
});
