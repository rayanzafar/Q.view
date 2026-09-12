// مطابقة ملف المالك لقطاع الاستشارات — عيّنةٌ ممثِّلة تغطي الأربع الحاسمة:
//   • المعاينة **لا تكتب شيئاً** إطلاقاً.
//   • التصحيح يقع على القاطع وحده (تاريخ خاطئ، تسكين ناقص، نسبة مختلفة، مشروع غائب).
//   • المشكوك فيه يُترك (اسمٌ يطابق سجلَّي موظف، حالة «غير معتمد»، اسم عميل مختلف).
//   • إعادة التشغيل بلا تكرار.
// وفوق ذلك القيد المُلزَم: **لا يُنشأ حساب دخول لأي موظف** — عدد الحسابات لا يتغير بحال.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-consulting-reconcile.db');
process.env.SANAD_DB = TEST_DB;

const T = '2026-01-15T08:00:00.000Z';
const YEAR = 2026;
const FIXTURE = resolve(process.cwd(), 'data/test-consulting-fixture.xlsx');

let db, XLSX, rec, app;

// ── ملف مالكٍ مصغَّر بالأوراق الخمس التي يقرأها الكشف ────────────────────────────
function buildFixture() {
  const projects = [
    ['رقم المشروع', 'اسم المشروع', 'حالة المشروع', 'اسم العميل', 'مدير المشروع', 'قيمة المشروع',
      'ميزانية 2026 المعتمدة', 'تكاليف 2026 الفعلية', 'إيرادات 2026 الفعلية', 'نسبة الفوترة من المشروع',
      'PO قيمة', 'بداية الPO', 'نهاية ال PO', 'تاريخ بداية المشروع', 'تاريخ نهاية المشروع'],
    // ① قائم وتاريخ نهايته خاطئ في المنصة → يُصحَّح
    [101, 'مشروع الامتثال', 'قيد التشغيل', 'وزارة التجربة', 'سامي الشمري', 1000000, 500000, 0, 0, 0.5, null, null, null, '2026-01-01', '2026-12-31'],
    // ② قائم وحالته في الملف «غير معتمد» + اسم عميله مختلف → يُترك ويُذكر
    [102, 'مشروع التميز', 'غير معتمد', 'وزارة التجربة - فرع', 0, 400000, null, 0, 0, 0, null, null, null, '2026-02-01', '2026-11-30'],
    // ③ غائب عن المنصة → يُنشأ
    [103, 'مشروع جديد كلياً', 'قيد التشغيل', 'وزارة التجربة', 'نوريا النجد', 250000, 100000, 0, 0, 0, null, null, null, '2026-03-01', '2026-09-30'],
  ];
  const team = [
    ['رقم المشروع', 'الاسم', 'المسمى الوظيفي', 'نسبة التحمل على المشروع'],
    [101, 'عامر روميه', 'استشاري أول', 0.9],      // الموظف قائم بلا تسكين → يُسكَّن
    [101, 'سلمان الصبي', 'اخصائي بنية مؤسسية', 0.7], // لا سجل له → يُنشأ سجلّه (بلا حساب) ويُسكَّن
    [101, 'وعد باعبدالله', 'محلل أعمال', 0.3],     // مسكَّن بنسبة خاطئة → تُصحَّح
    [101, 'محمد النور', 'استشاري', 0.5],           // اسمٌ يطابق سجلَّين → يُترك
    [103, 'عامر روميه', 'استشاري أول', 0.2],       // تسكين على مشروعٍ يُنشأ في الجولة نفسها
  ];
  const invoices = [
    ['رقم المشروع', 'المشروع', 'تاريخ الفاتورة', 'قيمة الفاتورة بدون ضريبة'],
    [101, 'وزارة التجربة', '2026-03-10', 250000],   // له نظير مسجَّل
    [101, 'وزارة التجربة', '2026-06-10', 125000],   // بلا نظير
  ];
  const costs = [
    ['رقم المشروع', 'الشهر', 'نوع التكلفة', 'القيمة'],
    [101, 'Jan', 'رواتب', 40000],
  ];
  const items = [
    ['رقم المشروع', 'رقم البند', 'اسم البند حسب جدول الكميات', 'قيمة البند حسب جدول الكميات بدون ضريبة', 'حالة البند', 'حالة الفوترة'],
    [101, 1, 'تقرير الوضع الحالي', 250000, 'منجز', 'مفوتر'],
    [101, 2, 'تقرير الفجوات', 125000, 'متأخر', 'مفوتر'],   // مفوتر في الملف / مسودة في المنصة
  ];
  const wb = XLSX.utils.book_new();
  const add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  add('المشاريع قيد التشغيل', projects);
  add('فريق العمل', team);
  add('فواتير 2026', invoices);
  add('التكاليف', costs);
  add('DB_البنود', items);
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
  writeFileSync(FIXTURE, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const counts = async () => ({
  accounts: (await db.get('SELECT COUNT(*) AS "c" FROM app_user WHERE deleted_at IS NULL')).c,
  employees: (await db.get('SELECT COUNT(*) AS "c" FROM employee WHERE deleted_at IS NULL')).c,
  allocations: (await db.get('SELECT COUNT(*) AS "c" FROM allocation WHERE deleted_at IS NULL')).c,
  projects: (await db.get('SELECT COUNT(*) AS "c" FROM project WHERE deleted_at IS NULL')).c,
});

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  XLSX = await import('../../vendor/xlsx/xlsx.mjs');
  await migrate(); await seedRbac();
  rec = await import('../../scripts/reconcile-consulting.mjs');
  app = await import('../../scripts/apply-consulting.mjs');
  buildFixture();

  await db.insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, created_at: T });
  await db.insert('client', { id: 'c_test', name_ar: 'وزارة التجربة', active: 1, created_at: T });

  await db.insert('project', { id: 'p101', code: 'CONS-101', name_ar: 'مشروع الامتثال', sector_id: 'CONSULTING',
    client_id: 'c_test', pm_name: 'سامي الشمري', status: 'IN_PROGRESS', rag: 'GREEN',
    contract_value_halalas: 100000000, budget_halalas: 50000000, actual_spend_halalas: 4000000,
    revenue_halalas: 25000000, start_date: '2026-01-01', end_date: '2026-10-31', created_at: T });
  await db.insert('project', { id: 'p102', code: 'CONS-102', name_ar: 'مشروع التميز', sector_id: 'CONSULTING',
    client_id: 'c_test', status: 'IN_PROGRESS', rag: 'GREEN', contract_value_halalas: 40000000,
    start_date: '2026-02-01', end_date: '2026-11-30', created_at: T });

  // البنود والإيراد المسجَّلان — نظير أحد سطري الفواتير وأحد البندين
  await db.insert('deliverable', { id: 'd1', project_id: 'p101', name_ar: 'تقرير الوضع الحالي',
    amount_halalas: 25000000, status: 'DELIVERED', sector_id: 'CONSULTING', created_at: T });
  await db.insert('deliverable', { id: 'd2', project_id: 'p101', name_ar: 'تقرير الفجوات',
    amount_halalas: 12500000, status: 'DRAFT', sector_id: 'CONSULTING', created_at: T });
  await db.insert('revenue_line', { id: 'rl1', project_id: 'p101', sector_id: 'CONSULTING',
    amount_halalas: 25000000, month: 3, year: YEAR, label: 'فاتورة', auto: 0, created_at: T });
  await db.insert('cost_line', { id: 'k1', project_id: 'p101', sector_id: 'CONSULTING', type: 'رواتب',
    amount_halalas: 4000000, month: 1, year: YEAR, created_at: T });

  // الموظفون: قائمٌ بلا تسكين · قائمٌ بتسكينٍ خاطئ النسبة · اسمٌ مكرر في سجلَّين
  for (const [id_, name] of [['e_amer', 'عامر روميه'], ['e_waad', 'وعد باعبدالله'],
    ['e_dup1', 'محمد النور'], ['e_dup2', 'محمد النور']]) {
    await db.insert('employee', { id: id_, name_ar: name, sector_id: 'CONSULTING', status: 'نشط', active: 1, created_at: T });
  }
  await db.insert('allocation', { id: 'a_waad', employee_id: 'e_waad', person_name_ar: 'وعد باعبدالله',
    project_id: 'p101', project_name: 'مشروع الامتثال', sector_id: 'CONSULTING', type: 'مشروع',
    year: YEAR, monthly_json: JSON.stringify({ 1: 0.6, 2: 0.6 }), source: 'manual', created_at: T });

  // حسابٌ قائم باسم «سلمان الصبي» غير مربوط بموظف → يُربط، ولا يُنشأ حسابٌ جديد لأحد.
  await db.insert('app_user', { id: 'u_salman', username: 'salman', name_ar: 'سلمان الصبي',
    role_id: 'admin', scope: 'own', active: 1, created_at: T });
});

after(async () => { await db.close?.(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); rmSync(FIXTURE, { force: true }); });

test('الكشف يصنّف الفروق بلا تخمين', async () => {
  const file = rec.readWorkbook(FIXTURE);
  const plat = await rec.readPlatformDb();
  const res = rec.reconcile(file, plat);

  const r101 = res.rows.find((r) => r.code === 'CONS-101');
  assert.ok(r101.diffs.some((d) => d.label === 'تاريخ النهاية'), 'يلتقط فرق تاريخ النهاية');
  assert.ok(r101.fixes.some((f) => f.end_date === '2026-12-31'), 'يقترح التاريخ الذي في الملف');

  const r102 = res.rows.find((r) => r.code === 'CONS-102');
  assert.ok(r102.diffs.some((d) => d.label === 'حالة المشروع' && d.undecidable), '«غير معتمد» تُذكر ولا تُفرض');
  assert.equal(r102.fixes.length, 0, 'لا إصلاح آلي لمشروعٍ حالته «غير معتمد» واسم عميله مختلف');

  assert.ok(res.rows.find((r) => r.code === 'CONS-103').missing, 'CONS-103 غائب عن المنصة');

  const dup = res.staffing.find((s) => s.person === 'محمد النور');
  assert.equal(dup.state, 'اسم مكرر', 'الاسم المكرر لا يُطابَق');
  assert.equal(res.staffing.find((s) => s.person === 'وعد باعبدالله').state, 'نسبة مختلفة');
  assert.equal(res.staffing.find((s) => s.person === 'سلمان الصبي').state, 'موظف غير موجود');

  assert.equal(res.counts.invoicesOk, 1, 'فاتورة واحدة لها نظير بدون ضريبة');
  assert.ok(res.invoiceRows.some((v) => v.state === 'غير موجود في المنصة' && v.net_sar === 125000));

  const it = res.itemRows.find((x) => x.code === 'CONS-101');
  assert.equal(it.matched, 2, 'البندان يُطابَقان بالاسم والقيمة');
  assert.equal(it.billingDiff.length, 1, 'بندٌ مفوتر في الملف وحالته مسودة في المنصة');

  const text = rec.renderReport(res, { file: FIXTURE, source: 'اختبار' });
  assert.ok(text.includes('تحتاج قرار إنسان'), 'التقرير يحمل قائمة قرار الإنسان');
  assert.ok(!/DRAFT|DELIVERED/.test(text), 'لا رموز إنجليزية في تقرير يقرأه المالك');
});

test('المعاينة لا تكتب صفاً واحداً', async () => {
  const before_ = await counts();
  const { plan } = await app.planApply({ path: FIXTURE });
  const done = await app.applyPlan(plan, { apply: false });
  const after_ = await counts();
  assert.deepEqual(after_, before_, 'حالة القاعدة لم تتغير في المعاينة');
  assert.equal(done.projectsUpdated + done.projectsCreated + done.employeesCreated
    + done.allocationsCreated + done.allocationsUpdated + done.accountsLinked, 0);
  assert.ok(plan.projects.some((x) => x.kind === 'create' && x.code === 'CONS-103'));
  assert.ok(plan.employees.some((x) => x.person === 'سلمان الصبي'));
  assert.ok(!plan.employees.some((x) => x.person === 'محمد النور'), 'المشكوك فيه خارج الخطة');
  assert.ok(plan.skipped.some((s) => s.what.includes('محمد النور')));
  const text = app.renderPlan(plan, { apply: false });
  assert.ok(text.includes('معاينة'), 'العنوان يقول إنها معاينة');
});

test('التنفيذ يصحّح القاطع ويترك المشكوك فيه — وبلا حساب دخول واحد', async () => {
  const before_ = await counts();
  const { plan } = await app.planApply({ path: FIXTURE });
  const done = await app.applyPlan(plan, { apply: true });
  assert.deepEqual(done.failures, [], 'لا إخفاقات');

  const after_ = await counts();
  assert.equal(after_.accounts, before_.accounts, 'لم يُنشأ حساب دخول واحد');

  const p101 = await db.get('SELECT * FROM project WHERE id = ?', ['p101']);
  assert.equal(p101.end_date, '2026-12-31', 'تاريخ النهاية صار كما في الملف');
  const p102 = await db.get('SELECT * FROM project WHERE id = ?', ['p102']);
  assert.equal(p102.status, 'IN_PROGRESS', '«غير معتمد» لم تُفرض على المنصة');
  const p103 = await db.get('SELECT * FROM project WHERE code = ? AND deleted_at IS NULL', ['CONS-103']);
  assert.ok(p103, 'المشروع الغائب أُنشئ');
  assert.equal(p103.client_id, null, 'لا يُربط عميلٌ بالتخمين');

  const salman = await db.get('SELECT * FROM employee WHERE name_ar = ? AND deleted_at IS NULL', ['سلمان الصبي']);
  assert.ok(salman, 'سجلّ الموظف أُنشئ');
  const acc = await db.get('SELECT * FROM app_user WHERE id = ?', ['u_salman']);
  assert.equal(acc.employee_id, salman.id, 'رُبط بالحساب القائم لا بحسابٍ جديد');

  const amer = await db.get(`SELECT a.* FROM allocation a WHERE a.employee_id = ? AND a.project_id = ? AND a.deleted_at IS NULL`, ['e_amer', 'p101']);
  assert.ok(amer, 'التسكين الناقص أُنشئ');
  assert.equal(rec.pctOf(amer), 90);

  const waad = await db.get('SELECT * FROM allocation WHERE id = ?', ['a_waad']);
  assert.equal(rec.pctOf(waad), 30, 'النسبة المختلفة صُحِّحت إلى ما في الملف');

  const dupAlloc = await db.get(
    `SELECT COUNT(*) AS "c" FROM allocation WHERE person_name_ar = ? AND deleted_at IS NULL`, ['محمد النور']);
  assert.equal(dupAlloc.c, 0, 'الاسم المكرر لم يُسكَّن على شيء');

  // كل كتابة تركت أثر تدقيق باسم المُنفِّذ
  const aud = await db.get('SELECT COUNT(*) AS "c" FROM audit_log WHERE username = ?', [app.APPLIER.username]);
  assert.ok(aud.c > 0, 'سطور التدقيق مكتوبة');
});

test('إعادة التشغيل بلا أثر مضاعف', async () => {
  const before_ = await counts();
  const { plan } = await app.planApply({ path: FIXTURE });
  assert.equal(plan.projects.length, 0, 'لا مشروع يحتاج تصحيحاً بعد الجولة الأولى');
  assert.equal(plan.employees.length, 0, 'لا سجل موظف ناقص');
  assert.equal(plan.allocations.length, 0, 'لا تسكين ناقص ولا نسبة مختلفة');
  const done = await app.applyPlan(plan, { apply: true });
  assert.deepEqual(done.failures, []);
  assert.deepEqual(await counts(), before_, 'لا صفوف جديدة في الجولة الثانية');
});
