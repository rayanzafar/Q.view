// وحدة: تكاليف القطاع (sectorCosts) والهامش المبني عليها — قاعدة مصغّرة محكومة.
// التكلفة طرفان: بنود الكلفة + المصروفات المعتمدة أو المدفوعة (صافيةً إن سُجِّل صافيها).
// النافذة تُقصّ بالأشهر، والصفوف بلا شهر تدخل السنة كلها وتسقط من النافذة، وشقوق السنة
// الاثنا عشر تعود كاملةً دائماً. وgrossMargin يقرأ من المصدر نفسه فلا يفترق رقمان.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-cost-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { sectorCosts, grossMargin } = await import('../../src/core/reports/metrics.js');

const T = '2026-01-10T08:00:00.000Z';
before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, sort_order: 2, created_at: T });
  const cost = (id, x) => insert('cost_line', { id, sector_id: 'S1', year: 2026, amount_halalas: 0, created_at: T, ...x });
  // بنود الكلفة — قطاع أ سنة 2026: مارس 700، يوليو 300، وبندٌ بلا شهر ولا نوع 50
  await cost('CL-m3-a', { month: 3, type: 'رواتب', amount_halalas: 500_000 });
  await cost('CL-m3-b', { month: 3, type: 'تعاقد باطني', amount_halalas: 200_000 });
  await cost('CL-m7', { month: 7, type: 'رواتب', amount_halalas: 300_000 });
  await cost('CL-nom', { month: null, type: null, amount_halalas: 50_000 });
  await cost('CL-2025', { month: 3, type: 'رواتب', year: 2025, amount_halalas: 999_000 }); // سنة أخرى
  await cost('CL-s2', { month: 3, type: 'رواتب', sector_id: 'S2', amount_halalas: 777_000 }); // قطاع آخر
  const exp = (id, x) => insert('expense', { id, sector_id: 'S1', incurred_year: 2026, amount_halalas: 0,
    status: 'APPROVED', created_at: T, ...x });
  // المصروفات المعتمدة/المدفوعة — الصافي المسجَّل يسبق الإجمالي
  await exp('EX-m3-a', { incurred_month: 3, type: 'سفر', amount_halalas: 115_000, net_amount_halalas: 100_000 });
  await exp('EX-m3-b', { incurred_month: 3, type: 'ضيافة', amount_halalas: 60_000, status: 'PAID' });
  await exp('EX-m7', { incurred_month: 7, type: 'سفر', amount_halalas: 40_000 });
  await exp('EX-nom', { incurred_month: null, type: null, amount_halalas: 25_000 });
  // ما لا يُحتسب كلفةً: تحت الاعتماد، مرفوض، مسودّة، محذوف
  await exp('EX-draft', { incurred_month: 3, type: 'سفر', amount_halalas: 900_000, status: 'DRAFT' });
  await exp('EX-sub', { incurred_month: 3, type: 'سفر', amount_halalas: 900_000, status: 'SUBMITTED' });
  await exp('EX-rej', { incurred_month: 3, type: 'سفر', amount_halalas: 900_000, status: 'REJECTED' });
  await exp('EX-del', { incurred_month: 3, type: 'سفر', amount_halalas: 900_000, deleted_at: '2026-04-01T00:00:00.000Z' });
  await exp('EX-2025', { incurred_month: 3, type: 'سفر', amount_halalas: 900_000, incurred_year: 2025 });
  await exp('EX-s2', { incurred_month: 3, type: 'سفر', amount_halalas: 80_000, sector_id: 'S2' });
  // إيراد صافٍ للقطاع أ سنة 2026 = 2,000,000
  await insert('revenue_line', { id: 'RL-1', sector_id: 'S1', year: 2026, month: 3,
    amount_halalas: 2_300_000, net_amount_halalas: 2_000_000, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('السنة كلها: الطرفان يُجمعان، والصفوف بلا شهر داخلة، وسنةٌ أخرى أو قطاعٌ آخر خارج', async () => {
  const c = await sectorCosts('S1', 2026);
  assert.equal(c.cost_lines_halalas, 1_050_000);  // 500+200+300+50
  assert.equal(c.expenses_halalas, 225_000);      // 100(صافي)+60+40+25
  assert.equal(c.cost_halalas, 1_275_000);
  const s2 = await sectorCosts('S2', 2026);
  assert.equal(s2.cost_lines_halalas, 777_000);
  assert.equal(s2.expenses_halalas, 80_000);
});

test('نافذة أشهر: مارس وحده — لا يوليو ولا صفٌّ بلا شهر', async () => {
  const c = await sectorCosts('S1', 2026, { months: [3] });
  assert.equal(c.cost_lines_halalas, 700_000);   // 500+200 (وبند «بلا شهر» ساقط)
  assert.equal(c.expenses_halalas, 160_000);     // 100+60
  assert.equal(c.cost_halalas, 860_000);
  const jul = await sectorCosts('S1', 2026, { months: [7] });
  assert.equal(jul.cost_halalas, 340_000);       // 300+40
  const both = await sectorCosts('S1', 2026, { months: [3, 7] });
  assert.equal(both.cost_halalas, 1_200_000);    // مجموع الشهرين = السنة ناقص ما بلا شهر (75,000)
});

test('المصروف لا يُحتسب إلا معتمَداً أو مدفوعاً وغير محذوف', async () => {
  // لو دخلت المسودّة أو المرسَل أو المرفوض أو المحذوف لقفز الرقم بـ900,000 لكلٍّ منها
  const c = await sectorCosts('S1', 2026, { months: [3] });
  assert.equal(c.expenses_halalas, 160_000);
  const year = await sectorCosts('S1', 2026);
  assert.equal(year.expenses_halalas, 225_000);
  const t = Object.fromEntries(year.by_type.expenses.map((r) => [r.type || 'بلا نوع', r.amount_halalas]));
  assert.equal(t['سفر'], 140_000);               // 100 + 40 فقط (لا 900,000 المحذوفة)
});

test('التصنيف بالنوع: مجموعٌ لكل نوع، والنوع غير المسجَّل مجموعةٌ قائمة بذاتها، والأكبر أولاً', async () => {
  const c = await sectorCosts('S1', 2026);
  assert.deepEqual(c.by_type.cost_lines, [
    { type: 'رواتب', amount_halalas: 800_000 },
    { type: 'تعاقد باطني', amount_halalas: 200_000 },
    { type: null, amount_halalas: 50_000 },
  ]);
  assert.deepEqual(c.by_type.expenses, [
    { type: 'سفر', amount_halalas: 140_000 },
    { type: 'ضيافة', amount_halalas: 60_000 },
    { type: null, amount_halalas: 25_000 },
  ]);
  // النافذة تقصّ التصنيف أيضاً: مارس وحده بلا يوليو وبلا ما لا شهر له
  const m3 = await sectorCosts('S1', 2026, { months: [3] });
  assert.deepEqual(m3.by_type.cost_lines, [
    { type: 'رواتب', amount_halalas: 500_000 },
    { type: 'تعاقد باطني', amount_halalas: 200_000 },
  ]);
});

test('شقوق السنة: اثنا عشر شقّاً دائماً، الأول يناير، وبلا الصفوف التي لا شهر لها', async () => {
  const c = await sectorCosts('S1', 2026);
  assert.equal(c.by_month.length, 12);
  assert.equal(c.by_month[2], 860_000);   // مارس: 700 بنود + 160 مصروفات
  assert.equal(c.by_month[6], 340_000);   // يوليو: 300 + 40
  assert.equal(c.by_month.reduce((a, b) => a + b, 0), 1_200_000); // = الكل ناقص ما بلا شهر
  assert.deepEqual(c.by_month.filter((_, i) => i !== 2 && i !== 6), Array(10).fill(0));
  // ولا تضيق الشقوق بضيق النافذة — الأعمدة تعرض شكل السنة كاملاً خلف الفترة المختارة
  const m3 = await sectorCosts('S1', 2026, { months: [3] });
  assert.deepEqual(m3.by_month, c.by_month);
});

test('نافذة بلا أشهر صالحة = لا تكلفة، والشقوق تبقى سنةً كاملة', async () => {
  const c = await sectorCosts('S1', 2026, { months: [] });
  assert.equal(c.cost_halalas, 0);
  assert.deepEqual(c.by_type, { cost_lines: [], expenses: [] });
  assert.equal(c.by_month[2], 860_000);
  const bad = await sectorCosts('S1', 2026, { months: [0, 13, 'x'] });
  assert.equal(bad.cost_halalas, 0);
});

test('الشركة كلها حين لا يُذكر قطاع', async () => {
  const c = await sectorCosts(null, 2026);
  assert.equal(c.cost_lines_halalas, 1_827_000);  // 1,050,000 + 777,000
  assert.equal(c.expenses_halalas, 305_000);      // 225,000 + 80,000
});

test('سنةٌ بلا سجلّ: أصفار وشقوق كاملة لا فراغ', async () => {
  const c = await sectorCosts('S1', 2024);
  assert.equal(c.cost_halalas, 0);
  assert.deepEqual(c.by_month, Array(12).fill(0));
  assert.deepEqual(c.by_type, { cost_lines: [], expenses: [] });
});

test('الهامش يقرأ التكلفة من المصدر نفسه — لا رقمان لشيء واحد', async () => {
  const c = await sectorCosts('S1', 2026);
  const gm = await grossMargin('S1', 2026);
  assert.deepEqual(Object.keys(gm).sort(),
    ['cost_halalas', 'gross_profit_halalas', 'margin_pct', 'revenue_halalas'].sort());
  assert.equal(gm.cost_halalas, c.cost_halalas);
  assert.equal(gm.revenue_halalas, 2_000_000);
  assert.equal(gm.gross_profit_halalas, 2_000_000 - 1_275_000);
  assert.equal(gm.margin_pct, Math.round((gm.gross_profit_halalas / gm.revenue_halalas) * 100)); // 36
  assert.equal(gm.margin_pct, 36);
});

test('الهامش بلا إيراد: نسبةٌ غير محسوبة لا صفر كاذب', async () => {
  const gm = await grossMargin('S2', 2026);
  assert.equal(gm.revenue_halalas, 0);
  assert.equal(gm.margin_pct, null);
  assert.equal(gm.cost_halalas, 857_000);
  assert.equal(gm.gross_profit_halalas, -857_000);
});
