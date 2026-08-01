// أساسُ كل رقم بعد فصل الضريبة: الإيراد صافياً، والمطالبة والمستحق والتحصيل إجمالاً.
//
// هذا هو الفحص الذي يحرس **القرار** لا الحساب: أن الرقم المسمّى «إيراداً» صار إيراد الشركة
// حقاً (بلا الضريبة)، وأن الرقم المسمّى «مستحقاً» بقي ما يُطالَب به العميل فعلاً (بالضريبة).
// انعكاسُ أحدهما يمرّ في فحص الحساب أخضرَ ولا يُكشف إلا هنا.
//
// ويحرس معه ثلاثة أمور لا تظهر في الوحدة:
//   • الفصل عند الكتابة: المستخلص والتحصيل يُسجَّلان مفصولَين لا يُفصلان عند القراءة فقط.
//   • صيغة COALESCE: صفٌّ كتبه مسارٌ لا يعرف بالضريبة (بذرٌ أو استيراد) يُقرأ صافيه صحيحاً
//     ولا يسقط من المجموع صفراً.
//   • الإعفاء المسجَّل صراحةً يُحترم ولا يُعاد اشتقاقه بخمسة عشر بالمئة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-vat-basis-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const fin = await import('../../src/modules/finance/finance.js');
const { splitGross } = await import('../../src/modules/finance/vat.js');
const metrics = await import('../../src/core/reports/metrics.js');

const T = '2026-01-05T08:00:00.000Z';
const YEAR = 2026;
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const admin = { id: 'u_adm', username: 'adm', role_id: 'ceo_office', sector_id: null, scope: 'company',
  projectIds: new Set(), teamIds: new Set() };

// مبلغان: أحدهما من المواصفة ويقبل القسمة، والآخر مضافٌ عمداً ولا يقبلها.
const DIVISIBLE = 41262000;  // ٤١٢٬٦٢٠٫٠٠ ر.س. — صافيه ٣٥٨٨٠٠٠٠
const ODD = 10000;           // ١٠٠٫٠٠ ر.س. — صافيه ٨٦٩٥ وضريبته ١٣٠٥

before(async () => {
  await db.insert('sector', { id: 'VS', name_ar: 'قطاع', kind: 'delivery', active: 1, created_at: T,
    target_revenue_halalas: 100000000, sort_order: 1 });
  await db.insert('client', { id: 'VC', name_ar: 'عميل', active: 1, created_at: T });
  await db.insert('project', { id: 'VP', name_ar: 'مشروع', sector_id: 'VS', client_id: 'VC',
    status: 'IN_PROGRESS', created_at: T });
  await db.insert('contract', { id: 'VCON', code: 'C-1', client_id: 'VC', project_id: 'VP', sector_id: 'VS',
    value_halalas: DIVISIBLE + ODD, start_date: '2026-01-01', status: 'ACTIVE', created_at: T });

  // بنود الإيراد: أحدهما مفصولٌ صراحةً (كما تكتبه المنصة)، والآخر **بلا فصل** — كما يصل من
  // البذر أو الاستيراد. الثاني هو ما يحرس صيغة COALESCE.
  const s = splitGross(DIVISIBLE);
  await db.insert('revenue_line', { id: 'R1', project_id: 'VP', sector_id: 'VS', amount_halalas: DIVISIBLE,
    net_amount_halalas: s.net_halalas, vat_halalas: s.vat_halalas, month: 1, year: YEAR, auto: 0, created_at: T });
  await db.insert('revenue_line', { id: 'R2', project_id: 'VP', sector_id: 'VS', amount_halalas: ODD,
    month: 2, year: YEAR, auto: 0, created_at: T });

  // فاتورة مصدَرة يدوياً بلا فصل (مسار خارجي) — ثم تحصيلٌ جزئي عليها عبر الخدمة.
  await db.insert('invoice', { id: 'VINV', code: 'INV-1', contract_id: 'VCON', project_id: 'VP', client_id: 'VC',
    sector_id: 'VS', amount_halalas: DIVISIBLE, issue_date: '2026-02-01', status: 'ISSUED', created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('الإيراد في ملخّص المالية صافٍ — والإجمالي مذكور بجانبه لا مكانه', async () => {
  const s = await fin.financeSummary(admin, YEAR);
  const expectedNet = splitGross(DIVISIBLE).net_halalas + splitGross(ODD).net_halalas;
  assert.equal(s.revenue_halalas, expectedNet, 'الرقم المسمّى إيراداً هو إيراد الشركة بلا الضريبة');
  assert.equal(s.revenue_gross_halalas, DIVISIBLE + ODD);
  assert.equal(s.revenue_halalas + s.revenue_vat_halalas, s.revenue_gross_halalas, 'الجمع مغلق');
  // وبند الإيراد الذي وصل بلا فصل لم يسقط صفراً: لولا صيغة COALESCE لنقص الإيراد بمقداره كاملاً.
  assert.ok(s.revenue_halalas > splitGross(DIVISIBLE).net_halalas, 'البند غير المفصول محسوبٌ بصافيه المشتقّ');
});

test('المفوتر والمحصَّل والمستحق تبقى إجمالية — لأن العميل يدفع الإجمالي', async () => {
  const s = await fin.financeSummary(admin, YEAR);
  assert.equal(s.invoiced_halalas, DIVISIBLE, 'المفوتر مطالبةٌ على العميل: بالضريبة');
  assert.equal(s.invoiced_net_halalas, splitGross(DIVISIBLE).net_halalas, 'وصافيه بجانبه');
  assert.equal(s.invoiced_net_halalas + s.invoiced_vat_halalas, s.invoiced_halalas);
  assert.equal(s.ar_halalas, DIVISIBLE, 'المستحق ما يبقى على العميل كاملاً — بالضريبة');
});

test('التحصيل يُسجَّل مفصولاً عند الكتابة لا عند القراءة', async () => {
  await fin.recordCollection(ctx(admin), { invoiceId: 'VINV', amountSar: ODD / 100 });
  const col = await db.get('SELECT * FROM collection WHERE invoice_id = ?', ['VINV']);
  assert.equal(col.amount_halalas, ODD, 'المبلغ المُدخَل إجمالي كما حوّله العميل');
  assert.equal(col.net_amount_halalas, 8695);
  assert.equal(col.vat_halalas, 1305);
  assert.equal(col.net_amount_halalas + col.vat_halalas, col.amount_halalas);

  const s = await fin.financeSummary(admin, YEAR);
  assert.equal(s.collected_halalas, ODD, 'المحصَّل نقدٌ دخل فعلاً: بالضريبة');
  assert.equal(s.collected_net_halalas, 8695, 'وصافيه هو ما يخصّ الشركة منه');
  assert.equal(s.ar_halalas, DIVISIBLE - ODD, 'والمستحق نقص بما دُفع، إجمالياً بإجمالي');
});

test('المستخلص يُصدَر مفصولاً، والفصل يجري على مجموع الفاتورة لا على كل مخرَج', async () => {
  // ثلاثة مخرجات كلٌّ منها لا يقبل القسمة: جمعُ صوافيها يقلّ عن صافي مجموعها بهللتين.
  for (let i = 1; i <= 3; i++) {
    await db.insert('deliverable', { id: `D${i}`, project_id: 'VP', sector_id: 'VS', name_ar: `مخرج ${i}`,
      amount_halalas: ODD, status: 'DELIVERED', delivered_at: T, created_at: T });
  }
  const inv = await fin.createProgressClaim(ctx(admin), { contractId: 'VCON' });
  assert.equal(inv.amount_halalas, ODD * 3, 'مبلغ المستخلص إجمالي كمبالغ مخرجاته');
  const whole = splitGross(ODD * 3);
  assert.equal(inv.net_amount_halalas, whole.net_halalas);
  assert.equal(inv.net_amount_halalas + inv.vat_halalas, inv.amount_halalas, 'الجمع مغلق على المستند');
  assert.notEqual(inv.net_amount_halalas, splitGross(ODD).net_halalas * 3,
    'الفصل مرة واحدة على المجموع — جمعُ صوافي المخرجات كان سينقص عنه');
});

test('إعفاءٌ مسجَّل صراحةً يُحترم ولا يُعاد اشتقاقه', async () => {
  // صفٌّ صافيه = إجماليه وضريبته صفر: خبرٌ محاسبي (بندٌ غير خاضع)، لا فراغٌ يُملأ بالقاعدة.
  await db.insert('revenue_line', { id: 'R_EX', project_id: 'VP', sector_id: 'VS', amount_halalas: ODD,
    net_amount_halalas: ODD, vat_halalas: 0, month: 3, year: YEAR, auto: 0, created_at: T });
  const s = await fin.financeSummary(admin, YEAR);
  const expected = splitGross(DIVISIBLE).net_halalas + splitGross(ODD).net_halalas + ODD;
  assert.equal(s.revenue_halalas, expected, 'الصف المعفى دخل بكامل مبلغه لأن ذلك ما سُجِّل عليه');
});

test('نسبة تحقّق المستهدف تُقاس بالصافي — والمستهدف صافٍ أصلاً فلا يُقلب معه', async () => {
  const d = await metrics.sectorDashboard(admin, 'VS', { year: YEAR });
  const s = await fin.financeSummary(admin, YEAR);
  assert.equal(d.revenue_halalas, s.revenue_halalas, 'إيرادٌ واحد في اللوحتين — لا رقمان لسؤال واحد');
  assert.equal(d.target_revenue_halalas, 100000000, 'المستهدف كما وضعه المالك بلا مساس');
  // ولو قُرئ الإيراد إجمالياً لخرجت النسبة أعلى من حقيقتها بخمسة عشر بالمئة.
  assert.ok(d.revenue_halalas < s.revenue_gross_halalas);
});

// ── المصروف: تُسجَّل ضريبته ولا تُفترض ──────────────────────────────────────────────────────
test('مصروف بلا ذكرٍ للضريبة يبقى «غير مُسجَّل» — لا صفراً ولا خمسة عشر بالمئة مفترضة', async () => {
  const exp = await import('../../src/modules/finance/expenses.js');
  const r = await exp.createExpense(ctx(admin), 'VP', { type: 'مستردّ موظف', amount_sar: 100, month: 1, year: YEAR });
  assert.equal(r.amount_halalas, ODD);
  assert.equal(r.net_amount_halalas, null, 'افتراض الضريبة هنا اختراعُ استردادٍ لم يُثبته أحد');
  assert.equal(r.vat_recorded, false, 'ويُقال ذلك صراحةً بدل أن يُقرأ من الفراغ');
});

test('مصروف يشمل ضريبةً بالنسبة القياسية يُفصَل بالقاعدة الواحدة', async () => {
  const exp = await import('../../src/modules/finance/expenses.js');
  const r = await exp.createExpense(ctx(admin), 'VP',
    { type: 'طباعة', amount_sar: 100, month: 1, year: YEAR, vat_included: true });
  assert.equal(r.net_amount_halalas, 8695);
  assert.equal(r.vat_halalas, 1305);
  assert.equal(r.net_amount_halalas + r.vat_halalas, r.amount_halalas);
});

test('مصروف معفى: صفرٌ مقيس لا غياب — وضريبةٌ صريحة تُقرأ كما كُتبت', async () => {
  const exp = await import('../../src/modules/finance/expenses.js');
  const ex = await exp.createExpense(ctx(admin), 'VP',
    { type: 'رسم حكومي', amount_sar: 100, month: 1, year: YEAR, vat_exempt: true });
  assert.equal(ex.vat_halalas, 0, 'صفرٌ يعني «لا ضريبة على هذا البند» وهو خبر محاسبي');
  assert.equal(ex.net_amount_halalas, ODD, 'فكامل المبلغ كلفة');
  assert.equal(ex.vat_recorded, true, 'ويُفرَّق عن غير المسجَّل');

  const named = await exp.createExpense(ctx(admin), 'VP',
    { type: 'استضافة', amount_sar: 100, month: 1, year: YEAR, vat_sar: 12 });
  assert.equal(named.vat_halalas, 1200, 'ما قُرئ من فاتورة المورّد يُكتب كما هو');
  assert.equal(named.net_amount_halalas, ODD - 1200);
});

test('تغيير المبلغ يُسقط الضريبة المسجَّلة إلى «غير مُسجَّل» بدل إبقاء صافٍ لا يطابقه', async () => {
  const exp = await import('../../src/modules/finance/expenses.js');
  const r = await exp.createExpense(ctx(admin), 'VP',
    { type: 'سفر', amount_sar: 100, month: 1, year: YEAR, vat_included: true });
  assert.equal(r.vat_recorded, true);
  const after = await exp.updateExpense(ctx(admin), r.id, { amount_sar: 200 });
  assert.equal(after.amount_halalas, 20000);
  assert.equal(after.net_amount_halalas, null, 'صافي المبلغ القديم بجانب مبلغ جديد لا يعني شيئاً');
  assert.equal(after.vat_recorded, false);
  // وإعادة ذكرها في الطلب نفسه تُبقيها مسجَّلة على المبلغ الجديد.
  const again = await exp.updateExpense(ctx(admin), r.id, { amount_sar: 300, vat_included: true });
  assert.equal(again.net_amount_halalas + again.vat_halalas, again.amount_halalas);
});

test('فترة التحصيل تقسم مستحقاً إجمالياً على إيرادٍ إجمالي — طرفان من عالمٍ واحد', async () => {
  // البسط (المستحق) إجمالي بالضرورة. لو بقي المقام صافياً لطالت الفترة خمسة عشر بالمئة وهماً،
  // وهي رقمٌ يُقرأ إنذاراً تشغيلياً ويُتَّخذ عليه قرار.
  const s = await fin.financeSummary(admin, YEAR);
  const rev = await db.get('SELECT COALESCE(SUM(amount_halalas),0) g FROM revenue_line WHERE year = ?', [YEAR]);
  const month = new Date().getUTCFullYear() === YEAR ? new Date().getUTCMonth() + 1 : 12;
  assert.equal(s.dso, Math.round((s.ar_halalas / rev.g) * (month * 30)));
});
