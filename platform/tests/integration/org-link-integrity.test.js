// صحّة الربط بين حساب الدخول وسجل الموظف — الكشف والإصلاح.
//
// العطل المُغطّى: العلاقة مخزَّنة في عمودين متقابلين (`employee.user_id` و`app_user.employee_id`)
// وامتلاء أحدهما دون الآخر لا يُنتج خطأً — يُنتج صمتاً مزدوجاً: الشجرة تقول «بلا حساب دخول»
// وملفُّ الشخص يقول «غير مربوط بسجل موظف»، وكلاهما كاذب.
//
// القاعدة هنا تحمل الحالات كلها: نصف ربط في الاتجاهين · توأم غير مرتبط · حساب بلا موظف ·
// موظف بلا حساب · حساب مغلق وعليه عملٌ نشط · تعارض · إشارة مكسورة · موظف بلا قطاع/إدارة ·
// إدارة بلا مسؤول · مدير من خارج إدارته.
//
// ما يثبته:
//   ١ الكشف يجد كل صنف **بالاسم**.
//   ٢ الإصلاح يعالج القاطع وحده.
//   ٣ لا يمسّ المشكوك فيه (التوأم) إطلاقاً.
//   ٤ لا يمسّ الحساب المعطَّل: لا `active` ولا `deactivated_at`.
//   ٥ المعاينة لا تكتب صفاً ولا سطر تدقيق.
//   ٦ إعادة التشغيل بلا أثر مضاعف.
// كل التواريخ تُمرَّر لا تُقرأ من الساعة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-org-link-integrity.db');
process.env.SANAD_DB = TEST_DB;

let db, auditMod, fixMod;
const TODAY = '2026-07-31';
const YEAR = 2026;
const now = () => new Date().toISOString();

const userRow = (id) => db.get('SELECT * FROM app_user WHERE id = ?', [id]);
const empRow = (id) => db.get('SELECT * FROM employee WHERE id = ?', [id]);
const auditCount = async () => (await db.get('SELECT COUNT(*) AS n FROM audit_log')).n;
const auditFor = (resource, resourceId) =>
  db.all('SELECT * FROM audit_log WHERE resource = ? AND resource_id = ? ORDER BY at', [resource, resourceId]);

// أدوات القاعدة — تُبقي التركيب مقروءاً في الجسم.
const mkUser = (o) => db.insert('app_user', { scope: 'own', role_id: 'employee', active: 1, created_at: now(), ...o });
const mkEmp = (o) => db.insert('employee', { active: 1, status: 'نشط', employment_type: 'أساسي', created_at: now(), ...o });

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate();
  await seedRbac();
  const { initRbac } = await import('../../src/core/rbac/index.js');
  await initRbac();

  await db.insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: now() });
  await db.insert('sector', { id: 'CONSULT', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, sort_order: 2, created_at: now() });
  await db.insert('sector', { id: 'SHARED', name_ar: 'الخدمات المشتركة', kind: 'support', active: 1, sort_order: 3, created_at: now() });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });

  // ترتيب الإدخال يتبع قيود المفاتيح لا ترتيب الحالات: `employee.user_id` و`department.manager_user_id`
  // كلاهما مفتاح خارجي إلى `app_user`، و`employee.department_id` مفتاح إلى `department` — فالحسابات
  // أولاً، ثم الإدارات، ثم سجلات الموظفين. (`app_user.employee_id` بلا مفتاح خارجي عمداً في البنية،
  // ولهذا وحده أمكن أصلاً أن يشير حسابٌ إلى سجلٍ غير موجود — وهي إحدى الحالات المفحوصة أدناه.)

  // ── الحسابات ──────────────────────────────────────────────────────────────
  // نصف ربط ① — من جهة الحساب (عين إسحاق سيد): app_user.employee_id مملوء، employee.user_id فارغ
  await mkUser({ id: 'u_ishaq_sayed', username: 'ishaq.sayed', email: 'ishaq.sayed@evcsol.com',
    name_ar: 'إسحاق سيد', employee_id: 'E_ISHAQ', sector_id: 'SOLUTIONS' });
  // نصف ربط ② — من جهة سجل الموظف: employee.user_id مملوء، app_user.employee_id فارغ
  await mkUser({ id: 'u_jacob_sayed', username: 'jacob.sayed', email: 'jacob.sayed@evcsol.com',
    name_ar: 'يعقوب سيد', sector_id: 'SOLUTIONS' });
  // توأم غير مرتبط: العمودان فارغان معاً، والاسمان متطابقان
  await mkUser({ id: 'u_twin', username: 'sarah.alqahtani', email: 'sarah.alqahtani@evcsol.com',
    name_ar: 'سارة القحطاني', sector_id: 'SOLUTIONS' });
  // حساب بلا سجل موظف: فجوة · ومشروع (حساب عرض)
  await mkUser({ id: 'u_orphan', username: 'noor.k', email: 'noor.k@evcsol.com', name_ar: 'نور الكعبي', sector_id: 'CONSULT' });
  await mkUser({ id: 'u_demo', username: 'demo.admin', email: 'demo.admin@evcsol.com', name_ar: 'مدير تجريبي', role_id: 'admin', scope: 'company' });
  // حساب مغلق وعليه عملٌ نشط — مربوط تماماً، فلا يلتقطه الإصلاح من باب نصف الربط
  await mkUser({ id: 'u_closed', username: 'khalid.h', email: 'khalid.h@evcsol.com', name_ar: 'خالد الحربي',
    employee_id: 'E_CLOSED', sector_id: 'CONSULT', active: 0, deactivated_at: '2026-06-01T00:00:00.000Z' });
  // حساب مغلق وعليه عملٌ نشط **ونصف ربط معاً**: يُكمَل الرابط ولا يُفتح الحساب
  await mkUser({ id: 'u_dorm', username: 'haya.z', email: 'haya.z@evcsol.com', name_ar: 'هيا الزهراني',
    employee_id: 'E_DORM', sector_id: 'CONSULT', active: 0, deactivated_at: '2026-06-15T00:00:00.000Z' });
  // تعارض: حسابان يدّعيان سجلاً واحداً
  await mkUser({ id: 'u_claim_a', username: 'a.ghamdi', email: 'a.ghamdi@evcsol.com', name_ar: 'عبدالله الغامدي', employee_id: 'E_CONTESTED', sector_id: 'CONSULT' });
  await mkUser({ id: 'u_claim_b', username: 'abdullah.g', email: 'abdullah.g@evcsol.com', name_ar: 'عبدالله غ.', employee_id: 'E_CONTESTED', sector_id: 'CONSULT' });
  // إشارة مكسورة: الحساب يشير إلى سجل غير موجود
  await mkUser({ id: 'u_broken', username: 'ghost.link', email: 'ghost.link@evcsol.com', name_ar: 'حساب معلّق', employee_id: 'E_MISSING' });
  // مديرٌ يقود إدارةً لا ينتمي إليها (حالة ريان ظفر)
  await mkUser({ id: 'u_rayan', username: 'rayan.z', email: 'rayan.z@evcsol.com', name_ar: 'ريان ظفر',
    employee_id: 'E_RAYAN', role_id: 'department_manager', sector_id: 'CONSULT' });
  // شخص في قطاع الحلول ببريد ليس عنواناً، وحسابه لم يُفعَّل بعد
  await mkUser({ id: 'u_badmail', username: 'badr.a', email: 'badr(at)evcsol', name_ar: 'بدر العنزي',
    employee_id: 'E_BADMAIL', sector_id: 'SOLUTIONS', active: 0 });

  // ── الإدارات: واحدة بمسؤول من خارجها (خبر لا عطل) · وواحدة بلا مسؤول ───────
  await db.insert('department', { id: 'D_AI', sector_id: 'SOLUTIONS', name_ar: 'إدارة الذكاء الاصطناعي والبيانات',
    manager_user_id: 'u_rayan', active: 1, created_at: now() });
  await db.insert('department', { id: 'D_CON', sector_id: 'CONSULT', name_ar: 'إدارة الاستشارات', active: 1, created_at: now() });

  // ── سجلات الموظفين ────────────────────────────────────────────────────────
  await mkEmp({ id: 'E_ISHAQ', name_ar: 'إسحاق سيد', name_en: 'Ishaq Sayed', sector_id: 'SOLUTIONS', department_id: 'D_AI' });
  await mkEmp({ id: 'E_JACOB', name_ar: 'يعقوب سيد', name_en: 'Jacob Sayed', sector_id: 'SOLUTIONS',
    department_id: 'D_AI', user_id: 'u_jacob_sayed' });
  await mkEmp({ id: 'E_TWIN', name_ar: 'سارة القحطاني', name_en: 'Sarah Alqahtani', sector_id: 'SOLUTIONS', department_id: 'D_AI' });
  // سجل موظف بلا حساب: فجوة · ومشروعان (غادر · متدرب)
  await mkEmp({ id: 'E_SOLO', name_ar: 'فهد العتيبي', sector_id: 'SOLUTIONS', department_id: 'D_AI', job_title: 'مهندس بيانات' });
  await mkEmp({ id: 'E_LEFT', name_ar: 'ماجد الشمري', sector_id: 'SOLUTIONS', department_id: 'D_AI', end_date: '2026-05-31', active: 0 });
  await mkEmp({ id: 'E_INTERN', name_ar: 'ريم الدوسري', sector_id: 'SOLUTIONS', department_id: 'D_AI', employment_type: 'متدرب' });
  await mkEmp({ id: 'E_CLOSED', name_ar: 'خالد الحربي', sector_id: 'CONSULT', department_id: 'D_CON', user_id: 'u_closed' });
  await mkEmp({ id: 'E_DORM', name_ar: 'هيا الزهراني', sector_id: 'CONSULT', department_id: 'D_CON' });
  await mkEmp({ id: 'E_CONTESTED', name_ar: 'عبدالله الغامدي', sector_id: 'CONSULT', department_id: 'D_CON' });
  await mkEmp({ id: 'E_RAYAN', name_ar: 'ريان ظفر', sector_id: 'CONSULT', department_id: 'D_CON', user_id: 'u_rayan' });
  await mkEmp({ id: 'E_BADMAIL', name_ar: 'بدر العنزي', sector_id: 'SOLUTIONS', department_id: 'D_AI', user_id: 'u_badmail' });
  // بلا قطاع (وله تسكين) · بلا إدارة داخل قطاع تسليم · بلا إدارة في وحدة مساندة (شكلٌ مشروع)
  await mkEmp({ id: 'E_NOSEC', name_ar: 'منى الشهري' });
  await mkEmp({ id: 'E_NODEP', name_ar: 'طلال المطيري', sector_id: 'CONSULT' });
  await mkEmp({ id: 'E_FLAT', name_ar: 'لمى السبيعي', sector_id: 'SHARED' });

  // ── العمل القائم ──────────────────────────────────────────────────────────
  await db.insert('task', { id: 'T1', title: 'إغلاق تقرير الربع', assignee_user_id: 'u_closed', status: 'IN_PROGRESS', created_at: now() });
  await db.insert('task', { id: 'T2', title: 'مراجعة عرض', assignee_user_id: 'u_dorm', status: 'TODO', created_at: now() });
  await db.insert('allocation', { id: 'A1', employee_id: 'E_CLOSED', project_id: null, project_name: 'مشروع قائم',
    sector_id: 'CONSULT', year: YEAR, monthly_json: '{"7":1}', created_at: now() });
  await db.insert('allocation', { id: 'A2', employee_id: 'E_NOSEC', project_name: 'مشروع بلا قطاع',
    year: YEAR, monthly_json: '{"7":0.5}', created_at: now() });

  auditMod = await import('../../scripts/audit-org-links.mjs');
  fixMod = await import('../../scripts/fix-org-links.mjs');
});

after(async () => {
  await db.close();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
});

const run = () => auditMod.auditOrgLinks({ today: TODAY, year: YEAR, sector: 'SOLUTIONS' });
const names = (rows, key) => rows.map((r) => r[key]);

// ─────────────────────────────────────────────────────────────────────────────
// ١ · الكشف يجد كل صنف بالاسم
// ─────────────────────────────────────────────────────────────────────────────

test('الكشف: نصف ربط في الاتجاهين — كلٌّ في خانته الصحيحة، وبالاسم', async () => {
  const rep = await run();
  // الحساب يشير والسجل فارغ (إسحاق · وهيا التي حسابها مغلق أيضاً)
  assert.deepEqual(names(rep.halfLinks.fromUser, 'employee_id').sort(), ['E_DORM', 'E_ISHAQ']);
  const ishaq = rep.halfLinks.fromUser.find((r) => r.employee_id === 'E_ISHAQ');
  assert.equal(ishaq.employee_name_ar, 'إسحاق سيد');
  assert.equal(ishaq.username, 'ishaq.sayed');
  assert.equal(ishaq.missing_side, 'employee.user_id');
  // السجل يشير والحساب فارغ (يعقوب)
  assert.deepEqual(names(rep.halfLinks.fromEmployee, 'employee_id'), ['E_JACOB']);
  assert.equal(rep.halfLinks.fromEmployee[0].username, 'jacob.sayed');
  assert.equal(rep.halfLinks.fromEmployee[0].missing_side, 'app_user.employee_id');
});

test('الكشف: توأم غير مرتبط بدرجة ثقة — ولا يُخلط بنصف الربط', async () => {
  const rep = await run();
  const twin = rep.twins.find((t) => t.employee_id === 'E_TWIN');
  assert.ok(twin, 'التوأم غير المرتبط لم يُكشف');
  assert.equal(twin.user_id, 'u_twin');
  assert.equal(twin.confidence, 'عالية', 'اسم عربي متطابق وفريد الطرفين');
  assert.ok(twin.basis && twin.basis.length > 0, 'درجة الثقة بلا سبب مكتوب لا تُقرأ');
  // التوأم ليس نصف ربط: كلا العمودين فارغ
  assert.ok(!rep.halfLinks.fromUser.some((r) => r.employee_id === 'E_TWIN'));
  assert.ok(!rep.halfLinks.fromEmployee.some((r) => r.employee_id === 'E_TWIN'));
});

test('الكشف: حساب بلا سجل موظف — والمشروع مفصولٌ عن العطل', async () => {
  const rep = await run();
  assert.ok(names(rep.accountsNoEmployee.gaps, 'username').includes('noor.k'));
  assert.ok(!names(rep.accountsNoEmployee.gaps, 'username').includes('demo.admin'),
    'حساب العرض ليس عطلاً');
  assert.ok(names(rep.accountsNoEmployee.legit, 'username').includes('demo.admin'));
});

test('الكشف: سجل موظف بلا حساب — والغياب المشروع لا يُعدّ عطلاً', async () => {
  const rep = await run();
  const gaps = names(rep.employeesNoAccount.gaps, 'employee_name_ar');
  assert.ok(gaps.includes('فهد العتيبي'), 'موظف نشط بلا باب دخول فجوة حقيقية');
  assert.ok(!gaps.includes('ماجد الشمري'), 'من غادر لا يحتاج حساباً');
  assert.ok(!gaps.includes('ريم الدوسري'), 'المتدرب حسابه اختياري');
  const legit = names(rep.employeesNoAccount.legit, 'employee_name_ar');
  assert.ok(legit.includes('ماجد الشمري') && legit.includes('ريم الدوسري'));
});

test('الكشف: موظف بلا قطاع أو بلا إدارة — بأثرٍ مكتوب بلغة الإنسان', async () => {
  const rep = await run();
  const noSec = rep.placement.noSector.find((r) => r.employee_name_ar === 'منى الشهري');
  assert.ok(noSec, 'الموظف بلا قطاع لم يُكشف');
  assert.equal(noSec.allocations, 1, 'سطر التسكين الذي لا يصل أي قطاع لم يُحسب');
  assert.match(noSec.impact, /لا يظهر في كشف فريق أي قطاع/);
  assert.match(noSec.impact, /تسكين واحد/, 'الأثر بلا الرقم الضائع خبرٌ ناقص');

  const noDep = rep.placement.noDepartment.find((r) => r.employee_name_ar === 'طلال المطيري');
  assert.ok(noDep, 'الموظف بلا إدارة داخل قطاع تسليم لم يُكشف');
  assert.match(noDep.impact, /مدير إدارة/);
  // وحدة المساندة شكلها الصحيح مسطّح — لا تُعدّ ملاحظةً لا سبيل إلى إغلاقها
  assert.ok(!names(rep.placement.noDepartment, 'employee_name_ar').includes('لمى السبيعي'));
});

test('الكشف: إدارة بلا مسؤول · ومديرٌ يقود إدارةً لا ينتمي إليها (خبرٌ لا عطل)', async () => {
  const rep = await run();
  assert.deepEqual(names(rep.departments.noManager, 'department_id'), ['D_CON']);
  const out = rep.departments.managerOutside.find((r) => r.department_id === 'D_AI');
  assert.ok(out, 'المدير من خارج إدارته لم يُكشف');
  assert.equal(out.manager_name_ar, 'ريان ظفر');
  assert.equal(out.own_department_ar, 'إدارة الاستشارات');
  assert.match(out.note, /خبرٌ لا عطل/);
});

test('الكشف: حسابات مغلقة عليها عملٌ نشط — بالعمل معدوداً', async () => {
  const rep = await run();
  const closed = rep.dormantWithWork.find((r) => r.user_id === 'u_closed');
  assert.ok(closed, 'الحساب المغلق ذو العمل القائم لم يُكشف');
  assert.equal(closed.work.tasks, 1);
  assert.equal(closed.work.allocations, 1);
  assert.match(closed.work_phrase, /مهامّ مفتوحة: 1/);
  assert.match(closed.work_phrase, /تسكين: 1/);
  assert.ok(rep.dormantWithWork.some((r) => r.user_id === 'u_dorm'));
  // الحساب الذي لا عمل عليه لا يُزعج به المالك
  assert.ok(!rep.dormantWithWork.some((r) => r.user_id === 'u_badmail'));
});

test('الكشف: التعارض والإشارة المكسورة يُفرزان عن القاطع', async () => {
  const rep = await run();
  assert.ok(rep.halfLinks.conflicts.some((c) => c.employee_id === 'E_CONTESTED'),
    'حسابان يتنازعان سجلاً واحداً — تعارض لا إصلاح');
  assert.ok(rep.halfLinks.broken.some((b) => b.points_to === 'E_MISSING'));
  // ولا يتسرّب أيٌّ منهما إلى خانة نصف الربط
  const certainIds = [...rep.halfLinks.fromUser, ...rep.halfLinks.fromEmployee].map((r) => r.employee_id);
  assert.ok(!certainIds.includes('E_CONTESTED'));
});

test('regression: نصفُ الربط عطلٌ واحد — لا يُعدّ ثلاث مرات ولا يُرشَّح توأماً لنفسه', async () => {
  // العطل: «حرٌّ» كان يُقرأ من عمودٍ واحد. فإسحاق (سجلُّه فارغ) يظهر أيضاً في «سجل بلا حساب»،
  // ويعقوب (حسابُه فارغ) يظهر أيضاً في «حساب بلا سجل» — فيُقرأ عطلان لا عطل، ويُرسل المالك
  // دعوةً إلى شخصٍ حسابُه بين يديه أصلاً. والأخطر: لو تطابق الاسمان لرُشِّح الشخص «توأماً» لنفسه.
  const rep = await run();
  const halfEmpIds = ['E_ISHAQ', 'E_JACOB', 'E_DORM'];
  const halfUserIds = ['u_ishaq_sayed', 'u_jacob_sayed', 'u_dorm'];
  for (const bucket of [rep.accountsNoEmployee.gaps, rep.accountsNoEmployee.legit]) {
    for (const id of halfUserIds) assert.ok(!names(bucket, 'user_id').includes(id), `${id} عُدّ مرتين`);
  }
  for (const bucket of [rep.employeesNoAccount.gaps, rep.employeesNoAccount.legit]) {
    for (const id of halfEmpIds) assert.ok(!names(bucket, 'employee_id').includes(id), `${id} عُدّ مرتين`);
  }
  for (const t of rep.twins) {
    assert.ok(!halfEmpIds.includes(t.employee_id), 'صاحبُ نصف ربطٍ رُشِّح توأماً');
    assert.ok(!halfUserIds.includes(t.user_id), 'صاحبُ نصف ربطٍ رُشِّح توأماً');
  }
});

test('الكشف: قطاع الحلول شخصاً شخصاً — حساب · ربط · تفعيل · بريد صالح', async () => {
  const rep = await run();
  const by = (n) => rep.solutions.people.find((p) => p.name_ar === n);
  assert.equal(rep.solutions.sector_name_ar, 'قطاع الحلول');

  // صاحبُ نصف الربط يُقرأ من الطرفين معاً: سطرٌ واحد يقول «نصف ربط»، لا سطران أحدهما «بلا حساب»
  assert.equal(rep.solutions.people.filter((p) => p.name_ar === 'إسحاق سيد').length, 1);
  assert.equal(rep.solutions.people.filter((p) => p.name_ar === 'يعقوب سيد').length, 1);
  assert.equal(by('إسحاق سيد').link_state, 'نصف ربط');
  assert.equal(by('يعقوب سيد').link_state, 'نصف ربط');
  // والتوأم المرشَّح سطران عن قصد — وموسومان، وإلا قُرئ القطاع كأن فيه شخصين باسم واحد
  const twinRows = rep.solutions.people.filter((p) => p.name_ar === 'سارة القحطاني');
  assert.equal(twinRows.length, 2);
  assert.ok(twinRows.every((p) => p.twin_candidate === true));
  assert.equal(by('فهد العتيبي').has_account, false);
  assert.equal(by('فهد العتيبي').link_state, 'بلا حساب');

  // البريد: صالح لمن عنوانه سليم، وغير صالح لمن ليس عنواناً — قبل أن يُرسَل شيء إلى إنسان
  assert.equal(by('إسحاق سيد').email_ok, true);
  assert.equal(by('بدر العنزي').email_ok, false, 'عنوان بلا @ ولا نقطة لا يُرسَل إليه بريد');
  assert.equal(by('بدر العنزي').activated, false);
  // «يصلح لدعوةٍ اليوم» يستثني من لا بريد صالح له، ومن فُعِّل أصلاً
  assert.equal(rep.solutions.summary.invitable, 0);
  assert.equal(rep.solutions.summary.halfLinked, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// ٢ · المعاينة لا تكتب شيئاً
// ─────────────────────────────────────────────────────────────────────────────

test('المعاينة: لا صفٌّ يُكتب ولا سطر تدقيق — والخطة تذكر القاطع والمشكوك فيه', async () => {
  const before = {
    audits: await auditCount(),
    ishaq: await empRow('E_ISHAQ'),
    jacob: await userRow('u_jacob_sayed'),
    twinEmp: await empRow('E_TWIN'),
    twinUser: await userRow('u_twin'),
  };
  const plan = await fixMod.planFixes({ today: TODAY, year: YEAR, sector: 'SOLUTIONS' });
  assert.equal(plan.applied, undefined, 'المعاينة لا تدّعي التنفيذ');
  assert.equal(plan.certain.length, 3, 'القاطع: إسحاق · يعقوب · هيا');
  assert.ok(plan.human.length > 0);
  // النص المعروض يقول صراحةً إنه لم يُكتب شيء
  assert.match(fixMod.renderPlan(plan), /معاينة فقط، لم يُكتب صفٌّ واحد/);

  assert.equal(await auditCount(), before.audits, 'المعاينة كتبت سطر تدقيق');
  assert.equal((await empRow('E_ISHAQ')).user_id, before.ishaq.user_id);
  assert.equal((await userRow('u_jacob_sayed')).employee_id, before.jacob.employee_id);
  assert.equal((await empRow('E_TWIN')).user_id, before.twinEmp.user_id);
  assert.equal((await userRow('u_twin')).employee_id, before.twinUser.employee_id);
  // وقبل التنفيذ: العمودان ما زالا على حالهما المعطوب
  assert.equal(before.ishaq.user_id, null, 'شرط العطل: عمود الموظف فارغ');
  assert.equal(before.jacob.employee_id, null, 'شرط العطل: عمود الحساب فارغ');
});

// ─────────────────────────────────────────────────────────────────────────────
// ٣ · التنفيذ: القاطع وحده
// ─────────────────────────────────────────────────────────────────────────────

test('التنفيذ: يُكمل نصف الربط في الاتجاهين — والعمودان يتطابقان بعده', async () => {
  const res = await fixMod.applyFixes({ today: TODAY, year: YEAR, sector: 'SOLUTIONS' });
  assert.deepEqual(res.failed, [], 'تعذّر إصلاحٌ كان يُفترض أن يكون قاطعاً');
  assert.equal(res.done.length, 3);

  // إسحاق: كان الحساب يشير والسجل فارغ ⟵ صار العمودان متطابقين
  assert.equal((await empRow('E_ISHAQ')).user_id, 'u_ishaq_sayed');
  assert.equal((await userRow('u_ishaq_sayed')).employee_id, 'E_ISHAQ');
  // يعقوب: كان السجل يشير والحساب فارغ ⟵ صار العمودان متطابقين
  assert.equal((await empRow('E_JACOB')).user_id, 'u_jacob_sayed');
  assert.equal((await userRow('u_jacob_sayed')).employee_id, 'E_JACOB');
});

test('التنفيذ: كل كتابة مدقَّقة على الطرفين معاً — لا كتابة صامتة', async () => {
  const onEmp = await auditFor('employee', 'E_ISHAQ');
  const onUser = await auditFor('app_user', 'u_ishaq_sayed');
  assert.ok(onEmp.length >= 1, 'الربط بلا سطر تدقيق على سجل الموظف');
  assert.ok(onUser.length >= 1, 'الربط بلا سطر تدقيق على الحساب');
  const last = JSON.parse(onUser[onUser.length - 1].detail_json || '{}');
  assert.equal(last.linked_employee_id, 'E_ISHAQ');
  assert.equal(onUser[onUser.length - 1].user_id, fixMod.FIXER.id, 'سطر التدقيق لا يقول من كتبه');
});

test('التنفيذ: لا يمسّ المشكوك فيه — التوأم يبقى كما هو', async () => {
  assert.equal((await empRow('E_TWIN')).user_id, null, 'رُبط توأمٌ بتشابه اسم');
  assert.equal((await userRow('u_twin')).employee_id, null, 'رُبط توأمٌ بتشابه اسم');
  // ويبقى معروضاً كقرارِ إنسان لا كعملٍ منجَز
  const plan = await fixMod.planFixes({ today: TODAY, year: YEAR, sector: 'SOLUTIONS' });
  assert.ok(plan.human.some((h) => h.kind === 'توأم مرشَّح' && h.who.includes('سارة القحطاني')));
});

test('التنفيذ: لا يمسّ المعطَّل — لا تفعيل ولا محو لختم الإغلاق', async () => {
  const closed = await userRow('u_closed');
  assert.equal(closed.active, 0, 'فُتح حسابٌ أُغلق بقرار');
  assert.equal(closed.deactivated_at, '2026-06-01T00:00:00.000Z', 'مُسّ ختم الإغلاق');
  // وحتى من أُصلح ربطُه وهو مغلق: الرابط اكتمل، والحساب بقي مغلقاً بختمه
  const dorm = await userRow('u_dorm');
  assert.equal(dorm.employee_id, 'E_DORM', 'الربط القاطع لم يكتمل لمجرد أن الحساب مغلق');
  assert.equal((await empRow('E_DORM')).user_id, 'u_dorm');
  assert.equal(dorm.active, 0, 'التفعيل قرارُ المالك لا أثرٌ جانبي لإصلاح ربط');
  assert.equal(dorm.deactivated_at, '2026-06-15T00:00:00.000Z');
});

test('التنفيذ: التعارض والإشارة المكسورة لم تُمسّا', async () => {
  assert.equal((await empRow('E_CONTESTED')).user_id, null, 'حُسم تنازعٌ بلا إنسان');
  assert.equal((await userRow('u_claim_a')).employee_id, 'E_CONTESTED');
  assert.equal((await userRow('u_claim_b')).employee_id, 'E_CONTESTED');
  assert.equal((await userRow('u_broken')).employee_id, 'E_MISSING', 'مُحيت إشارة مكسورة بلا قرار');
});

// ─────────────────────────────────────────────────────────────────────────────
// ٤ · إعادة التشغيل
// ─────────────────────────────────────────────────────────────────────────────

test('إعادة التشغيل: لا يبقى قاطعٌ يُصلَح، ولا سطر تدقيق يُكتب مرتين', async () => {
  const rep = await run();
  assert.equal(rep.halfLinks.fromUser.length, 0);
  assert.equal(rep.halfLinks.fromEmployee.length, 0);

  const before = await auditCount();
  const res = await fixMod.applyFixes({ today: TODAY, year: YEAR, sector: 'SOLUTIONS' });
  assert.equal(res.certain.length, 0);
  assert.deepEqual(res.done, []);
  assert.equal(await auditCount(), before, 'التشغيل الثاني كتب أثراً مضاعفاً');
});

// ─────────────────────────────────────────────────────────────────────────────
// ٥ · انحدار: العطل الأصلي لا يعود
// ─────────────────────────────────────────────────────────────────────────────

test('regression: نصف ربطٍ من جهة الحساب يُكشف ويُصلَح — لا يمرّ بوصفه «مربوطاً مسبقاً»', async () => {
  // العطل: `linkUserToEmployee` وحدها ترفض هذه الحالة برسالة «مربوط بهذا الحساب مسبقاً — لا
  // حاجة لإعادة الربط» بينما `employee.user_id` فارغ، فيبقى نصف الربط إلى الأبد. من يعتمد على
  // الخدمة وحدها في الإصلاح سيراه «تمّ» ولا يتغيّر شيء.
  await mkEmp({ id: 'E_REG', name_ar: 'نايف القرني', sector_id: 'SOLUTIONS', department_id: 'D_AI' });
  await mkUser({ id: 'u_reg', username: 'naif.q', email: 'naif.q@evcsol.com', name_ar: 'نايف القرني',
    employee_id: 'E_REG', sector_id: 'SOLUTIONS' });

  const rep = await run();
  assert.deepEqual(names(rep.halfLinks.fromUser, 'employee_id'), ['E_REG'], 'الكشف لم يرَ نصف الربط');

  const res = await fixMod.applyFixes({ today: TODAY, year: YEAR, sector: 'SOLUTIONS' });
  assert.deepEqual(res.failed, [], 'الإصلاح سقط على الحالة التي جاء لها');
  assert.equal((await empRow('E_REG')).user_id, 'u_reg', 'بقي نصف الربط بعد «إصلاح» ادّعى النجاح');
  assert.equal((await userRow('u_reg')).employee_id, 'E_REG');
});

test('regression: نصف ربطٍ من جهة سجل الموظف يُكشف ويُصلَح', async () => {
  await mkUser({ id: 'u_reg2', username: 'wafa.h', email: 'wafa.h@evcsol.com', name_ar: 'وفاء الحازمي', sector_id: 'SOLUTIONS' });
  await mkEmp({ id: 'E_REG2', name_ar: 'وفاء الحازمي', sector_id: 'SOLUTIONS', department_id: 'D_AI', user_id: 'u_reg2' });

  const rep = await run();
  assert.deepEqual(names(rep.halfLinks.fromEmployee, 'employee_id'), ['E_REG2']);

  await fixMod.applyFixes({ today: TODAY, year: YEAR, sector: 'SOLUTIONS' });
  assert.equal((await userRow('u_reg2')).employee_id, 'E_REG2');
  assert.equal((await empRow('E_REG2')).user_id, 'u_reg2');
});
