// وحدة: revenueOutlook — التوقع من الإيراد المُسجَّل وحده، لا من قيمة الصفقات.
// الصيغة السابقة (المحقق + الخط المرجّح) كانت تجمع قيمةً تعاقديةً إجمالية متعددة السنوات إلى
// إيراد سنةٍ معترفٍ به، فأخرجت «+1057%» على بيانات حقيقية. الحارس هنا: قيمةُ فرصةٍ ضخمة لا
// تحرّك التوقع بمقدار هللة، والحدود من تباين الأشهر، والسنة المنقضية لا تُتنبَّأ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-outlook-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { revenueOutlook, outlookFromMonths, availableYears, pipelineCoverage } = await import('../../src/core/reports/metrics.js');
const { config } = await import('../../src/core/config.js');

const T = '2026-01-10T08:00:00.000Z';
// منتصف السنة تماماً: 2026-07-02 ⇒ انقضى ~50% وستة أشهر مسجَّلة
const MID = new Date('2026-07-02T00:00:00Z');

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', kind: 'delivery', active: 1, sort_order: 1,
    target_revenue_halalas: 24_000_000, target_sales_halalas: 40_000_000, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 5, is_won: 1, is_lost: 0 });
  await insert('stage', { id: 'ON_HOLD', name_ar: 'معلّقة', sort_order: 9, is_won: 0, is_lost: 0 });
  // ستة أشهر مسجَّلة: 1M ثم 3M ×4 ثم 2M — أدنى شهر 1M وأفضله 3M، والمجموع 12M
  const m = [1, 3, 3, 3, 3, 2];
  for (let i = 0; i < m.length; i++) {
    await insert('revenue_line', { id: `RL-${i + 1}`, sector_id: 'S1', year: 2026, month: i + 1,
      amount_halalas: m[i] * 1_150_000, net_amount_halalas: m[i] * 1_000_000, created_at: T });
  }
  // فرصةٌ ضخمة متعددة السنوات — هي بالضبط ما كان يفجّر التوقع
  await insert('opportunity', { id: 'O-mega', title_ar: 'خدمات مُدارة خمس سنوات', sector_id: 'S1',
    year: 2026, stage_id: 'LEAD', value_halalas: 270_000_000, win_pct: 30, exclude_from_sales: 0, created_at: T });
  await insert('opportunity', { id: 'O-hold', title_ar: 'معلّقة', sector_id: 'S1', year: 2026,
    stage_id: 'ON_HOLD', value_halalas: 80_000_000, win_pct: 40, exclude_from_sales: 0, created_at: T });
  await insert('opportunity', { id: 'O-excl', title_ar: 'مستبعدة من المبيعات', sector_id: 'S1', year: 2026,
    stage_id: 'LEAD', value_halalas: 50_000_000, win_pct: 50, exclude_from_sales: 1, created_at: T });
  await insert('opportunity', { id: 'W-1', title_ar: 'مكسوبة', sector_id: 'S1', year: 2026,
    stage_id: 'WON', value_halalas: 10_000_000, win_pct: 100, exclude_from_sales: 0, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('قيمة الفرص لا تدخل التوقع: 270 مليوناً مفتوحة لا تحرّكه هللةً واحدة', async () => {
  const r = await revenueOutlook('S1', 2026, MID);
  assert.equal(r.actual, 15_000_000);           // 15M هللة صافية
  // الأساس = المحقق ÷ ما انقضى — لا أثر لأي فرصة
  assert.ok(r.base < 32_000_000, `التوقع ${r.base} تسرّبت إليه قيمة الفرص`);
  assert.equal(r.base, Math.round(r.actual / (r.elapsedPct / 100)));
  // ولو تضاعفت الفرصة الضخمة عشر مرات لبقي الرقم نفسه (حارس البنية لا القيمة)
  assert.equal(r.closed, false);
  assert.equal(r.tooEarly, false);
});

test('الحدود من تباين الأشهر المسجَّلة، والأساس بينهما', async () => {
  const r = await revenueOutlook('S1', 2026, MID);
  assert.equal(r.monthsSeen, 6);
  assert.equal(r.remainingMonths, 6);
  assert.equal(r.minMonth, 1_000_000);          // أبطأ شهر
  assert.equal(r.maxMonth, 3_000_000);          // أفضل شهر
  assert.equal(r.low, 15_000_000 + 1_000_000 * 6);
  assert.equal(r.high, 15_000_000 + 3_000_000 * 6);
  assert.ok(r.low <= r.base && r.base <= r.high, `${r.low} ≤ ${r.base} ≤ ${r.high}`);
});

test('سنةٌ منقضية: التوقع محقّقها لا تنبّؤ؛ وسنةٌ لم يكتمل شهرُها: لا توقع', async () => {
  const past = await revenueOutlook('S1', 2026, new Date('2027-03-01T00:00:00Z'));
  assert.equal(past.closed, true);
  assert.equal(past.base, past.actual);
  assert.equal(past.low, past.actual);
  assert.equal(past.high, past.actual);

  const early = await revenueOutlook('S1', 2026, new Date('2026-01-03T00:00:00Z'));
  assert.equal(early.tooEarly, true);
  assert.equal(early.base, null);
});

test('سنةٌ قادمة: امتدادُ الوتيرة — متوسط الشهر ×12 والحدّان أبطأ/أفضل شهر ×12', async () => {
  // MID في 2026 ⇒ السنة القادمة 2027. الأساس من أشهر 2026 الستة: مجموعها 15M ومتوسطها 2.5M،
  // أدناها 1M وأعلاها 3M — فالأساس 30M بين حدّي 12M و36M، والوسم صريح.
  const r = await revenueOutlook('S1', 2027, MID);
  assert.equal(r.nextYear, true);
  assert.equal(r.basisYear, 2026);
  assert.equal(r.base, 30_000_000);
  assert.equal(r.low, 12_000_000);
  assert.equal(r.high, 36_000_000);
  assert.equal(r.avgMonth, 2_500_000);
  assert.equal(r.remainingMonths, 12);
  assert.equal(r.actual, 0, 'لا سجلّ للسنة القادمة — المحقق صفر لا اختلاق');
  // وأبعد من سنة: لا توقّع — لا أساس يُمدّ
  const far = await revenueOutlook('S1', 2028, MID);
  assert.equal(far.base, null);
  assert.equal(far.tooEarly, true);
  assert.ok(!far.nextYear, 'سنة+2 ليست «السنة القادمة»');
});

test('منتقي السنوات: سنوات البيانات وحدها — سنةٌ قادمة فارغة لا تُعرض (قرار 2026-08-25)', async () => {
  // لا سجلّ لسنةٍ قادمة في هذه البذرة ⇒ لا تظهر. متى أُسنِدت صفقةٌ لسنةٍ قادمة ظهرت وحدها
  // (يحرسه فحص التكامل sector-next-year).
  const years = await availableYears();
  assert.ok(!years.includes(config.fiscalYear + 1), 'سنةٌ قادمة فارغة حُقنت في المنتقي');
  assert.ok(years.includes(config.fiscalYear), 'السنة الجارية غائبة');
  assert.deepEqual(years, [...years].sort((a, b) => b - a), 'الترتيب تنازلي');
});

test('outlookFromMonths: رياضيات revenueOutlook نفسها على سلسلةٍ جاهزة (المرشَّحة)', async () => {
  const months = [1, 3, 3, 3, 3, 2, 0, 0, 0, 0, 0, 0].map((v) => v * 1_000_000);
  const r = outlookFromMonths(months, 2026, MID);
  const full = await revenueOutlook('S1', 2026, MID);
  assert.equal(r.actual, full.actual);
  assert.equal(r.base, full.base);
  assert.equal(r.low, full.low);
  assert.equal(r.high, full.high);
  // سنة منقضية: محقّقها؛ وسلسلة سنةٍ لم يكتمل شهرها: لا توقع
  assert.equal(outlookFromMonths(months, 2020, MID).closed, true);
  assert.equal(outlookFromMonths(Array(12).fill(0), 2027, new Date('2027-01-05T00:00:00Z')).tooEarly, true);
});

test('تغطية خط الفرص: مرجّحة، بلا معلّقة، وبلا المستبعد من المبيعات', async () => {
  const c = await pipelineCoverage('S1', 2026);
  // المفتوح المؤهَّل: الفرصة الضخمة وحدها (المعلّقة والمستبعدة خارج) ⇒ 270M×30% = 81M
  assert.equal(c.weighted_halalas, 81_000_000);
  assert.equal(c.open_halalas, 270_000_000);
  // المتبقي من هدف المبيعات = 40M − 10M مكسوبة = 30M ⇒ التغطية بالمرجّح لا بالخام
  assert.equal(c.remaining_target_halalas, 30_000_000);
  assert.equal(c.coverage, 2.7);
});
