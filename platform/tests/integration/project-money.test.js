// صورة المال على المشروع: الداخل النقدي والخارج النقدي والمصروفات والتسكين بالنسب الشهرية.
//
// ما تثبته هذه الاختبارات — وهي بالضبط الأخطاء التي يسهل الوقوع فيها في رقم مالي على شاشة:
//   • «الداخل النقدي» يُقرأ من التحصيلات وحدها، ولا يساوي المفوتر ولا يشمل تحصيلاً على فاتورة
//     محذوفة ولا فاتورة مسودة.
//   • النسب الشهرية للتسكين هي نفسها المخزَّنة في خريطة أشهر التسكين، بلا إعادة حساب ولا تقريب
//     يخترع رقماً.
//   • **الغياب ليس صفراً**: مشروع بلا مصروفات يعود بـ«لم يُسجَّل» لا بمبلغ صفر.
//   • كل كتابة على المصروف مُدقَّقة (إنشاء/تعديل/حذف)، والحذف ناعم.
//   • الموردون والاشتراكات لا يُخترع لهما رقم: حالة معلنة ونصّ يقول ما ينقص.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-project-money-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { config } = await import('../../src/core/config.js');
const { projectMoney } = await import('../../src/modules/finance/finance.js');
const expenses = await import('../../src/modules/finance/expenses.js');

const YR = config.fiscalYear;
const T = `${YR}-01-05T08:00:00.000Z`;
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const U = (o) => ({ projectIds: new Set(), teamIds: new Set(), scope: 'own', sector_id: null, ...o });
const finance = U({ id: 'u_fin', username: 'fin1', role_id: 'finance', scope: 'company' });
const lead1 = U({ id: 'u_l1', username: 'lead1', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' });
const lead2 = U({ id: 'u_l2', username: 'lead2', role_id: 'sector_lead', sector_id: 'S2', scope: 'sector' });
const pm = U({ id: 'u_pm', username: 'pm1', role_id: 'project_manager', sector_id: 'S1', scope: 'project', projectIds: new Set(['P1', 'P3']) });

const auditCount = async (resource, action) =>
  (await db.get('SELECT COUNT(*) AS "n" FROM audit_log WHERE resource = ? AND action = ?', [resource, action])).n;

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, created_at: T });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_pm', username: 'pm1', name_ar: 'مدير المشروع', role_id: 'project_manager',
    sector_id: 'S1', scope: 'project', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_fin', username: 'fin1', name_ar: 'المالية', role_id: 'finance',
    scope: 'company', active: 1, created_at: T });
  await db.insert('employee', { id: 'EMP1', name_ar: 'سارة', job_title: 'مستشار أول', sector_id: 'S1',
    active: 1, salary_halalas: 2_400_000, created_at: T });

  await db.insert('project', { id: 'P1', name_ar: 'مشروع المال', sector_id: 'S1', owner_user_id: 'u_pm',
    status: 'IN_PROGRESS', contract_value_halalas: 1_000_000, created_at: T });
  await db.insert('project', { id: 'P2', name_ar: 'مشروع قطاع ب', sector_id: 'S2', status: 'IN_PROGRESS', created_at: T });
  await db.insert('project', { id: 'P3', name_ar: 'مشروع بلا حركة', sector_id: 'S1', owner_user_id: 'u_pm',
    status: 'IN_PROGRESS', created_at: T });

  // فواتير: صادرة · مسودة · محذوفة — ثلاثتها على المشروع نفسه
  await db.insert('invoice', { id: 'INV1', code: 'INV-1', project_id: 'P1', sector_id: 'S1',
    amount_halalas: 300_000, status: 'ISSUED', issue_date: `${YR}-02-10`, created_at: T });
  await db.insert('invoice', { id: 'INV2', code: 'INV-2', project_id: 'P1', sector_id: 'S1',
    amount_halalas: 200_000, status: 'DRAFT', issue_date: `${YR}-03-01`, created_at: T });
  await db.insert('invoice', { id: 'INV3', code: 'INV-3', project_id: 'P1', sector_id: 'S1',
    amount_halalas: 400_000, status: 'ISSUED', issue_date: `${YR}-04-01`, deleted_at: T, created_at: T });

  // تحصيلات: شهران + تحصيل على فاتورة محذوفة (يجب استبعاده) + تحصيل بلا تاريخ
  await db.insert('collection', { id: 'C1', invoice_id: 'INV1', amount_halalas: 120_000, collected_at: `${YR}-02-20`, method: 'تحويل', created_at: T });
  await db.insert('collection', { id: 'C2', invoice_id: 'INV1', amount_halalas: 80_000, collected_at: `${YR}-05-03`, method: 'تحويل', created_at: T });
  await db.insert('collection', { id: 'C3', invoice_id: 'INV3', amount_halalas: 400_000, collected_at: `${YR}-04-20`, created_at: T });
  await db.insert('collection', { id: 'C4', invoice_id: 'INV1', amount_halalas: 5_000, created_at: T });

  // مصروفات: مدفوعان بوصف واحد (تكرار) · معتمد · مسودة · مرفوض · محذوف
  const e = (id, type, amount, month, status, deleted = null) => db.insert('expense', { id, project_id: 'P1',
    sector_id: 'S1', type, amount_halalas: amount, incurred_month: month, incurred_year: YR,
    requested_by: 'u_fin', status, created_at: T, deleted_at: deleted });
  await e('E1', 'سفر', 50_000, 2, 'PAID');
  await e('E2', 'سفر', 50_000, 3, 'PAID');
  await e('E3', 'طباعة', 20_000, 3, 'APPROVED');
  await e('E4', 'ضيافة', 10_000, 4, 'DRAFT');
  await e('E5', 'غرامة تأخير', 90_000, 4, 'REJECTED');
  await e('E6', 'مصروف ملغى', 70_000, 5, 'PAID', T);

  // بنود كلفة (اعتراف بكلفة لا حركة صرف)
  await db.insert('cost_line', { id: 'CL1', project_id: 'P1', sector_id: 'S1', type: 'رواتب',
    amount_halalas: 400_000, month: 2, year: YR, source: 'migration', created_at: T });
  await db.insert('cost_line', { id: 'CL2', project_id: 'P1', sector_id: 'S1', type: 'أخرى',
    amount_halalas: 100_000, month: 3, year: YR, source: 'migration', created_at: T });

  // إيراد محقق
  await db.insert('revenue_line', { id: 'RL1', project_id: 'P1', sector_id: 'S1', amount_halalas: 250_000,
    month: 2, year: YR, label: 'دفعة أولى', auto: 0, created_at: T });

  // تسكين: موظف بنسبتين + متعاون بلا صف موظف + تسكين سنة سابقة
  await db.insert('allocation', { id: 'A1', employee_id: 'EMP1', person_name_ar: 'سارة', project_id: 'P1',
    project_name: 'مشروع المال', sector_id: 'S1', type: 'lead', monthly_json: '{"2":1,"3":0.5}', year: YR,
    source: 'manual', created_at: T });
  await db.insert('allocation', { id: 'A2', person_name_ar: 'متعاون خارجي', project_id: 'P1',
    project_name: 'مشروع المال', sector_id: 'S1', type: 'member', monthly_json: '{"3":0.25}', year: YR,
    source: 'manual', created_at: T });
  await db.insert('allocation', { id: 'A3', employee_id: 'EMP1', person_name_ar: 'سارة', project_id: 'P1',
    sector_id: 'S1', type: 'lead', monthly_json: '{"6":1}', year: YR - 1, source: 'manual', created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── ① الداخل النقدي ─────────────────────────────────────────────────────────────────────────
test('الداخل النقدي = التحصيلات وحدها: لا المفوتر، ولا تحصيل فاتورة محذوفة', async () => {
  const m = await projectMoney(finance, 'P1');
  assert.equal(m.year, YR);
  assert.equal(m.cashIn.permitted, true);
  assert.equal(m.cashIn.recorded, true);
  // 120,000 + 80,000 + 5,000 (بلا تاريخ) — وتحصيل الفاتورة المحذوفة (400,000) خارج الحساب
  assert.equal(m.cashIn.total_halalas, 205_000, 'المجموع من جدول التحصيل عبر فواتير غير محذوفة');
  assert.equal(m.cashIn.count, 3);
  assert.equal(m.cashIn.in_year_halalas, 200_000, 'ما وقع داخل السنة فقط على الشريط الشهري');
  assert.deepEqual(m.cashIn.undated, { amount_halalas: 5_000, count: 1 }, 'تحصيل بلا تاريخ يُعزل ولا يُحشر في شهر');
  const feb = m.cashIn.monthly.find((x) => x.month === 2);
  const may = m.cashIn.monthly.find((x) => x.month === 5);
  const mar = m.cashIn.monthly.find((x) => x.month === 3);
  assert.equal(feb.amount_halalas, 120_000);
  assert.equal(may.amount_halalas, 80_000);
  assert.equal(mar.amount_halalas, 0, 'شهر بلا تحصيل في مشروع له تحصيل = صفر حقيقي');
  // الفصل الجوهري: المحصَّل ليس المفوتر
  assert.equal(m.bridge.invoiced_halalas, 300_000, 'المفوتر = الصادر وحده (المسودة والمحذوفة خارجه)');
  assert.notEqual(m.cashIn.total_halalas, m.bridge.invoiced_halalas);
  assert.equal(m.bridge.collected_halalas, 205_000);
  assert.equal(m.bridge.outstanding_halalas, 95_000, 'المتبقي = المفوتر − المحتجز − المحصَّل');
  assert.equal(m.bridge.draft_invoiced_halalas, 200_000, 'المسودة تُذكر منفصلة لا داخل المفوتر');
  assert.equal(m.bridge.revenue.total_halalas, 250_000, 'الإيراد المحقق ضلعٌ ثالث لا يساوي أياً منهما');
});

test('صفوف التحصيل تحمل تاريخها وفاتورتها، وما بلا تاريخ يبقى ظاهراً', async () => {
  const m = await projectMoney(finance, 'P1');
  assert.equal(m.cashIn.rows.length, 3);
  assert.ok(m.cashIn.rows.every((r) => r.invoice_code === 'INV-1'), 'كل صف منسوب لفاتورته');
  assert.equal(m.cashIn.rows.filter((r) => r.date == null).length, 1);
  assert.equal(m.cashIn.rows.reduce((a, r) => a + r.amount_halalas, 0), 205_000);
});

// ── ② الخارج النقدي والمصروفات ──────────────────────────────────────────────────────────────
test('الخارج النقدي = المصروف المدفوع وحده؛ المعتمد التزام والمطلوب لم يُعتمد', async () => {
  const m = await projectMoney(finance, 'P1');
  assert.equal(m.cashOut.recorded, true);
  assert.equal(m.cashOut.paid.total_halalas, 100_000);
  assert.equal(m.cashOut.committed.total_halalas, 20_000, 'المعتمد غير المدفوع لا يدخل الخارج النقدي');
  assert.equal(m.cashOut.requested.total_halalas, 10_000);
  assert.equal(m.cashOut.rejected.count, 1);
  const feb = m.cashOut.paid.monthly.find((x) => x.month === 2);
  const mar = m.cashOut.paid.monthly.find((x) => x.month === 3);
  assert.equal(feb.amount_halalas, 50_000);
  assert.equal(mar.amount_halalas, 50_000);
  assert.equal(m.expenses.count, 5, 'المحذوف ناعماً خارج العدّ');
  assert.ok(m.expenses.rows.every((r) => r.status_ar && r.status_ar !== r.status), 'الحالة تُعرض بمعناها العربي');
});

test('التكرار وصفٌ لما تكرر فعلاً — لا سجل اشتراكات مخترع', async () => {
  const m = await projectMoney(finance, 'P1');
  assert.equal(m.recurring.recorded, true);
  assert.equal(m.recurring.rows.length, 1);
  assert.equal(m.recurring.rows[0].type, 'سفر');
  assert.equal(m.recurring.rows[0].months, 2);
  assert.equal(m.recurring.rows[0].total_halalas, 100_000);
  assert.equal(m.subscriptions.status, 'not_tracked');
  assert.equal(m.subscriptions.total_halalas, null, 'لا رقم يُخترع لما لا سجل له');
  assert.ok(m.subscriptions.needs_ar.length >= 3, 'يُقال ما يحتاجه السجل بدل الصمت');
});

test('الكلفة المسجَّلة تبقى منفصلة عن الخارج النقدي', async () => {
  const m = await projectMoney(finance, 'P1');
  assert.equal(m.cost.recorded, true);
  assert.equal(m.cost.total_halalas, 500_000);
  assert.equal(m.cost.by_type[0].type, 'رواتب');
  assert.notEqual(m.cost.total_halalas, m.cashOut.paid.total_halalas, 'اعترافٌ بكلفة ≠ نقدٌ خرج');
});

// ── ③ التسكين بالنسب الشهرية ────────────────────────────────────────────────────────────────
test('النسب الشهرية للتسكين تطابق خريطة الأشهر المخزَّنة', async () => {
  const m = await projectMoney(finance, 'P1');
  assert.equal(m.staffing.recorded, true);
  assert.equal(m.staffing.people_count, 2);
  const sara = m.staffing.people.find((x) => x.employee_id === 'EMP1');
  assert.ok(sara, 'الموظف يظهر باسمه من صف الموظفين');
  assert.equal(sara.monthly[1], 100, 'الشهر الثاني: كسر 1 ⟵ 100%');
  assert.equal(sara.monthly[2], 50, 'الشهر الثالث: كسر 0.5 ⟵ 50%');
  assert.equal(sara.monthly[0], 0, 'شهر خارج الخريطة = صفر');
  assert.equal(sara.months_staffed, 2);
  assert.equal(sara.peak_pct, 100);
  const helper = m.staffing.people.find((x) => x.employee_id == null);
  assert.equal(helper.monthly[2], 25, 'المسكَّن بلا صف موظف يظهر باسمه المكتوب');
  assert.equal(m.staffing.monthly_total_pct[2], 75, 'مجموع الحمل على المشروع في الشهر الثالث');
  assert.deepEqual(m.staffing.other_years, [YR - 1], 'سنة أخرى فيها تسكين تُذكر ولا تُخلط بالسنة المعروضة');
  assert.equal(m.staffing.cost.available, false, 'كلفة التسكين لكل شخص غير متاحة أصلاً');
  assert.ok(/الراتب/.test(m.staffing.cost.reason_ar), 'السبب مذكور: لا تُشتق من الراتب');
});

test('سنة أخرى: النسب تتغير مع السنة المطلوبة ولا تتسرب من سنة إلى أخرى', async () => {
  const prev = await projectMoney(finance, 'P1', { year: YR - 1 });
  assert.equal(prev.year, YR - 1);
  assert.equal(prev.staffing.people_count, 1);
  assert.equal(prev.staffing.people[0].monthly[5], 100, 'الشهر السادس في السنة السابقة');
  assert.deepEqual(prev.staffing.other_years, [YR]);
  assert.equal(prev.cashIn.in_year_halalas, 0, 'لا تحصيل في تلك السنة — صفرٌ لأن للمشروع تحصيلاً مسجَّلاً');
  assert.equal(prev.cashIn.recorded, true, 'المشروع له تحصيل مسجَّل وإن لم يكن في هذه السنة');
});

// ── ④ الغياب ليس صفراً ──────────────────────────────────────────────────────────────────────
test('مشروع بلا حركة: كل قسم يقول «لم يُسجَّل» ولا يعرض صفراً', async () => {
  const m = await projectMoney(finance, 'P3');
  assert.equal(m.expenses.recorded, false);
  assert.equal(m.expenses.count, 0);
  assert.equal(m.cashOut.paid.total_halalas, null, 'لا مبلغ حيث لا تسجيل — لا صفر');
  assert.equal(m.cashOut.paid.monthly, null, 'لا شريط شهري يُرسم من العدم');
  assert.equal(m.cashIn.recorded, false);
  assert.equal(m.cashIn.total_halalas, null);
  assert.equal(m.cashIn.monthly, null);
  assert.equal(m.cost.recorded, false);
  assert.equal(m.cost.total_halalas, null);
  assert.equal(m.staffing.recorded, false);
  assert.equal(m.staffing.monthly_total_pct, null);
  assert.equal(m.bridge.contract_halalas, null, 'قيمة تعاقد غير مسجَّلة تعود فارغة لا صفراً');
  const keys = m.gaps.map((g) => g.key);
  for (const k of ['expenses', 'cash_in', 'staffing', 'subscriptions', 'suppliers']) {
    assert.ok(keys.includes(k), `النقص يُذكر صراحةً: ${k}`);
  }
  assert.ok(/لا مصروفات مسجّلة/.test(m.expenses.empty_ar));
});

test('الموردون: تُقرأ المشتريات المسجَّلة، ويُعلن أن لا مسار لتسجيلها', async () => {
  const m = await projectMoney(finance, 'P1');
  assert.equal(m.suppliers.status, 'no_write_path');
  assert.equal(m.suppliers.recorded, false);
  assert.equal(m.suppliers.total_halalas, null, 'لا مجموع يُعرض حيث لا سجل');
  assert.ok(m.suppliers.needs_ar.length >= 3);
  assert.ok(m.suppliers.workaround_ar.includes('مصروف'), 'البديل المتاح اليوم مذكور');
});

// ── ⑤ الكتابة: تسجيل مصروف · اعتماده · تعديله · حذفه — كلها مُدقَّقة ────────────────────────
test('تسجيل مصروف: يُحفظ بالهللات ويُدقَّق ويظهر فوراً في الصورة الشهرية', async () => {
  const before = await auditCount('expense', 'create');
  const created = await expenses.createExpense(ctx(finance), 'P1', {
    type: 'اشتراك منصة تحليل', amount_sar: 125.5, month: 6, year: YR,
  });
  assert.equal(created.amount_halalas, 12_550, 'المال عدد صحيح بالهللات');
  assert.equal(created.status, 'DRAFT');
  assert.equal(created.status_ar, 'مسودة');
  assert.equal(await auditCount('expense', 'create'), before + 1, 'كل كتابة تترك أثراً في سجل التدقيق');
  const row = await db.get('SELECT * FROM audit_log WHERE resource = ? AND action = ? ORDER BY at DESC', ['expense', 'create']);
  assert.equal(row.resource_id, created.id);
  assert.equal(row.sector_id, 'S1');
  const m = await projectMoney(finance, 'P1');
  assert.equal(m.expenses.count, 6);
  assert.equal(m.cashOut.requested.total_halalas, 22_550, 'المسجَّل حديثاً مطلوبٌ لم يُعتمد بعد');
});

test('المصروف يمرّ بالاعتماد قبل أن يصير خارجاً نقدياً، والاعتماد فعل صلاحية', async () => {
  const created = await expenses.createExpense(ctx(finance), 'P1', { type: 'شحن', amount_sar: 300, month: 7, year: YR });
  // مدير المشروع لا يملك منح المصروفات أصلاً
  await assert.rejects(() => expenses.updateExpense(ctx(pm), created.id, { status: 'APPROVED' }), /صلاحية/);
  const paid = await expenses.updateExpense(ctx(finance), created.id, { status: 'PAID' });
  assert.equal(paid.status, 'PAID');
  assert.equal(await auditCount('expense', 'update') >= 1, true);
  const m = await projectMoney(finance, 'P1');
  const jul = m.cashOut.paid.monthly.find((x) => x.month === 7);
  assert.equal(jul.amount_halalas, 30_000, 'بعد الصرف يدخل الشهر السابع في الخارج النقدي');
  // بيانات المصروف المحسوم لا تُعدَّل
  await assert.rejects(() => expenses.updateExpense(ctx(finance), created.id, { amount_sar: 900 }), /بعد حسمه/);
  await assert.rejects(() => expenses.deleteExpense(ctx(finance), created.id), /لا يُحذف/);
});

test('الحذف ناعم ومُدقَّق، والصف يختفي من الصورة لا من الجدول', async () => {
  const created = await expenses.createExpense(ctx(lead1), 'P1', { type: 'وقود', amount_sar: 40, month: 8, year: YR });
  const before = await auditCount('expense', 'delete');
  await expenses.deleteExpense(ctx(lead1), created.id);
  assert.equal(await auditCount('expense', 'delete'), before + 1);
  const row = await db.get('SELECT deleted_at FROM expense WHERE id = ?', [created.id]);
  assert.ok(row.deleted_at, 'حذف ناعم لا محو');
  const list = await expenses.listProjectExpenses(finance, 'P1');
  assert.ok(!list.some((r) => r.id === created.id), 'المحذوف خارج القائمة');
});

test('تحقق المدخلات: مبلغ وشهر وسنة ووصف — رسائل عربية تقول ما العمل', async () => {
  await assert.rejects(() => expenses.createExpense(ctx(finance), 'P1', { amount_sar: 10, month: 1, year: YR }), /وصف المصروف/);
  await assert.rejects(() => expenses.createExpense(ctx(finance), 'P1', { type: 'س', amount_sar: 0, month: 1, year: YR }), /مبلغ المصروف/);
  await assert.rejects(() => expenses.createExpense(ctx(finance), 'P1', { type: 'س', amount_sar: 10, year: YR }), /شهر الصرف/);
  await assert.rejects(() => expenses.createExpense(ctx(finance), 'P1', { type: 'س', amount_sar: 10, month: 13, year: YR }), /شهر الصرف/);
  await assert.rejects(() => expenses.createExpense(ctx(finance), 'P1', { type: 'س', amount_sar: 10, month: 1 }), /سنة الصرف/);
  await assert.rejects(() => expenses.createExpense(ctx(finance), 'P1',
    { type: 'س', amount_sar: 10, month: 1, year: YR, status: 'APPROVED' }), /مسودة/);
});

// ── ⑥ حارس الصف: مشروع خارج النطاق يُرَدّ قبل أي رقم ────────────────────────────────────────
test('مشروع خارج نطاق القارئ يُرَدّ في القراءة والكتابة معاً', async () => {
  await assert.rejects(() => projectMoney(lead2, 'P1'), /خارج نطاق/);
  await assert.rejects(() => expenses.listProjectExpenses(lead2, 'P1'), /خارج نطاق/);
  await assert.rejects(() => expenses.createExpense(ctx(lead2), 'P1', { type: 'س', amount_sar: 10, month: 1, year: YR }), /خارج نطاق/);
  await assert.rejects(() => projectMoney(finance, 'P404'), /غير موجود/);
});

test('مدير المشروع يرى النسب ولا يرى المال؛ ولا يسجّل مصروفاً', async () => {
  const m = await projectMoney(pm, 'P1');
  assert.equal(m.staffing.recorded, true, 'النسب الشهرية حق تشغيلي لمن يقرأ المشروع');
  assert.equal(m.staffing.people[0].monthly[1], 100);
  assert.equal(m.cashIn.permitted, false);
  assert.equal(m.cashIn.total_halalas, null);
  assert.equal(m.expenses.permitted, false);
  assert.equal(m.expenses.can_add, false);
  assert.equal(m.cost.permitted, false);
  assert.ok(m.cashIn.reason_ar && m.expenses.reason_ar, 'يُقال سبب الحجب لا أن يظهر فراغ');
  await assert.rejects(() => expenses.createExpense(ctx(pm), 'P1', { type: 'س', amount_sar: 10, month: 1, year: YR }), /صلاحية/);
});
