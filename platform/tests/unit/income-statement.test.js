// وحدة: قائمة الدخل للقطاع — قاعدة مصغّرة محكومة.
//
// ما تحرسه هذه الاختبارات بالذات:
//   • الكلفة في المرحلة الأولى **فارغة لا صفر** — والصفر كان سيُنتج «مجمل ربحٍ» يساوي الإيراد.
//   • المجموع والنتيجة يُفرَّغان ما دام سطرٌ واحد فارغاً — مجموعُ ما بعضه مجهول مجهول.
//   • الرياضيات نفسها صحيحة حين تصل البيانات (المحمِّلان محقونان بأرقام) — فالمرحلة الثانية
//     توصِّل بياناتٍ لا تكتب حساباً.
//   • الخطة للقطاع كلّه: قصُّ الشاشة على مشروع يُفرِّغ أعمدة الخطة ويُبقي المحقَّق مقصوصاً.
//   • بوابة الكلفة تحذف صفوفها من القائمة ولا تعرضها فارغة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-pl-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, run, close } = await import('../../src/core/db/index.js');
// دورٌ اختباري يقرأ الإيراد والمستهدف بلا بابَي الكلفة والهامش — لا يوجد في المصفوفة دورٌ
// بهذه التوليفة، وبناؤه في القاعدة أصدق من تزوير قرار المحرّك.
await run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_reader','قارئ اختباري','Test Reader',0,'2026-01-01T00:00:00.000Z')");
for (const r of ['revenue_line', 'budget']) {
  await run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_reader', r, 'read', 'sector']);
}
// دورٌ يقرأ الإيراد والكلفة **بلا الهامش**: هو بالضبط التوليفة التي كانت تُسلِّم مجمل الربح
// طرحاً (إيرادٌ ناقص «تكلفة الإيراد»)، فوجودها في القاعدة شرطُ الفحص.
await run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_costnomargin','قارئ كلفةٍ بلا هامش','Cost No Margin',0,'2026-01-01T00:00:00.000Z')");
for (const r of ['revenue_line', 'budget', 'cost']) {
  await run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_costnomargin', r, 'read', 'sector']);
}
// ودورٌ يقرأ الكلفة والهامش **بلا الإيراد**: سطرُ النتيجة عنده فارغٌ أبداً لغياب طرفه الأعلى.
await run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_norev','قارئ كلفةٍ بلا إيراد','Cost No Revenue',0,'2026-01-01T00:00:00.000Z')");
for (const r of ['budget', 'cost', 'margin']) {
  await run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_norev', r, 'read', 'sector']);
}
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { PL_LINES, sectorIncomeStatement, varianceTone } = await import('../../src/modules/finance/income-statement.js');

const T = '2026-01-10T08:00:00.000Z';
const YR = 2026;
// قائد القطاع: يقرأ الإيراد والمستهدف والكلفة والهامش في قطاعه.
const lead = { id: 'u_lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' };
// قارئٌ بلا بوابة كلفة.
const reader = { id: 'u_read', role_id: 't_reader', sector_id: 'S1', scope: 'sector' };
// قارئٌ يملك الكلفة ولا يملك الهامش، وآخر يملكهما بلا الإيراد.
const costNoMargin = { id: 'u_cnm', role_id: 't_costnomargin', sector_id: 'S1', scope: 'sector' };
const noRevenue = { id: 'u_nrv', role_id: 't_norev', sector_id: 'S1', scope: 'sector' };
const COST_KEYS = PL_LINES.filter((l) => l.kind === 'cost').map((l) => l.key);

// توزيعٌ شهري معتمد: 100,000 هللة لكل شهر ⇒ سنةٌ 1,200,000.
const monthlyPlan = { v: 2, months: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), { sales_halalas: 0, revenue_halalas: 100_000 }])) };

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, sort_order: 2, created_at: T });
  await insert('client', { id: 'C1', name_ar: 'جهة أ', created_at: T });
  await insert('project', { id: 'P1', name_ar: 'مشروع أ', sector_id: 'S1', client_id: 'C1', status: 'IN_PROGRESS', created_at: T });
  await insert('project', { id: 'P2', name_ar: 'مشروع ب', sector_id: 'S1', status: 'IN_PROGRESS', created_at: T });
  // الإيراد الصافي المسجَّل يسبق الإجمالي (قاعدة ٠١٩): P1 يناير 300,000 وفبراير 200,000، P2 يناير 100,000
  await insert('revenue_line', { id: 'RL1', sector_id: 'S1', project_id: 'P1', year: YR, month: 1, amount_halalas: 345_000, net_amount_halalas: 300_000, created_at: T });
  await insert('revenue_line', { id: 'RL2', sector_id: 'S1', project_id: 'P1', year: YR, month: 2, amount_halalas: 230_000, net_amount_halalas: 200_000, created_at: T });
  await insert('revenue_line', { id: 'RL3', sector_id: 'S1', project_id: 'P2', year: YR, month: 1, amount_halalas: 115_000, net_amount_halalas: 100_000, created_at: T });
  await insert('revenue_line', { id: 'RL4', sector_id: 'S1', project_id: 'P1', year: 2025, month: 1, amount_halalas: 999_000, net_amount_halalas: 900_000, created_at: T });
  await insert('revenue_line', { id: 'RL5', sector_id: 'S2', project_id: null, year: YR, month: 1, amount_halalas: 888_000, net_amount_halalas: 800_000, created_at: T });
  await insert('budget', { id: 'B1', sector_id: 'S1', fiscal_year: YR, target_revenue_halalas: 1_200_000, target_sales_halalas: 0, monthly_json: JSON.stringify(monthlyPlan), created_at: T });
  // قطاع ب: مستهدفٌ سنوي بلا توزيع شهري معتمد
  await insert('budget', { id: 'B2', sector_id: 'S2', fiscal_year: YR, target_revenue_halalas: 5_000_000, target_sales_halalas: 0, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const rowOf = (st, key) => st.rows.find((r) => r.key === key);

test('السطور التسعة بترتيبها، والقائمة مجمَّدة', () => {
  assert.equal(PL_LINES.length, 9);
  assert.deepEqual(PL_LINES.map((l) => l.key), ['revenue', 'op_salaries', 'consultant_fees',
    'contracting', 'licenses', 'rent', 'other_opex', 'cost_of_revenue', 'gross_profit']);
  assert.equal(PL_LINES[0].ar, 'الإيراد');
  assert.equal(PL_LINES[8].en, 'Gross Profit (Loss)');
  assert.ok(Object.isFrozen(PL_LINES) && Object.isFrozen(PL_LINES[0]));
});

test('المرحلة الأولى: الكلفة فارغة لا صفر، والمجموع والنتيجة يُفرَّغان معها', async () => {
  const st = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [1, 2] });
  for (const k of COST_KEYS) {
    const r = rowOf(st, k);
    assert.equal(r.period_actual_halalas, null, `${k}: المحقَّق يجب أن يكون فارغاً لا صفراً`);
    assert.equal(r.ytd_actual_halalas, null);
    assert.equal(r.fy_plan_halalas, null);
    assert.equal(r.state, 'not_entered');
  }
  const sub = rowOf(st, 'cost_of_revenue');
  assert.equal(sub.period_actual_halalas, null);
  assert.equal(sub.state, 'not_entered');
  const gp = rowOf(st, 'gross_profit');
  assert.equal(gp.period_actual_halalas, null);
  assert.equal(gp.ytd_actual_halalas, null);
  assert.deepEqual(st.gross_profit_pct, { fy_plan: null, period_plan: null, period_actual: null });
  // والإيراد وحده رقمٌ حقيقي: يناير 400,000 + فبراير 200,000
  const rev = rowOf(st, 'revenue');
  assert.equal(rev.period_actual_halalas, 600_000);
  assert.equal(rev.state, 'ok');
});

test('الإيراد: صافٍ، بسنته، وبأشهر الفترة — و«حتى تاريخه» من يناير إلى آخر شهرٍ مختار', async () => {
  const feb = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [2] });
  const rev = rowOf(feb, 'revenue');
  assert.equal(rev.period_actual_halalas, 200_000);   // فبراير وحده
  assert.equal(rev.ytd_actual_halalas, 600_000);      // يناير + فبراير
  assert.equal(rev.period_plan_halalas, 100_000);     // شهرٌ واحد من التوزيع المعتمد
  assert.equal(rev.fy_plan_halalas, 1_200_000);
  assert.equal(rev.attainment_pct, 50);               // 600,000 من 1,200,000
  assert.equal(rev.variance_pct, 100);                // (200,000 − 100,000) ÷ 100,000
  assert.equal(varianceTone(rev.kind, rev.variance_pct), 'good');
});

test('إشارة الانحراف ولونها: تحت الخطة في الإيراد سيّئ، وفوقها في الكلفة سيّئ', async () => {
  const jan = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [1] });
  const rev = rowOf(jan, 'revenue');
  assert.equal(rev.period_actual_halalas, 400_000);
  assert.equal(rev.variance_pct, 300);
  const mar = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [3] });
  const r3 = rowOf(mar, 'revenue');
  assert.equal(r3.period_actual_halalas, 0);
  assert.equal(r3.variance_pct, -100);
  assert.equal(varianceTone('revenue', -100), 'bad');
  assert.equal(varianceTone('result', -5), 'bad');
  assert.equal(varianceTone('result', 5), 'good');
  assert.equal(varianceTone('cost', 12), 'bad');
  assert.equal(varianceTone('subtotal', -12), 'good');
  assert.equal(varianceTone('cost', 0), 'neutral');
  assert.equal(varianceTone('revenue', null), 'neutral');
});

test('الرياضيات كاملةً حين تصل بيانات الكلفة (المحمِّلان محقونان)', async () => {
  const actuals = Object.fromEntries(COST_KEYS.map((k, i) => [k, { period: (i + 1) * 10_000, ytd: (i + 1) * 20_000 }]));
  const plans = Object.fromEntries(COST_KEYS.map((k) => [k, { fy: 60_000, period: 5_000 }]));
  const st = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [1, 2],
    _loaders: { loadCostActuals: async () => actuals, loadCostPlans: async () => plans } });
  const sub = rowOf(st, 'cost_of_revenue');
  assert.equal(sub.period_actual_halalas, 210_000);   // 10+20+30+40+50+60 ألفاً
  assert.equal(sub.ytd_actual_halalas, 420_000);
  assert.equal(sub.period_plan_halalas, 30_000);      // ستة سطور × 5,000
  assert.equal(sub.fy_plan_halalas, 360_000);
  assert.equal(sub.state, 'ok');
  assert.equal(sub.variance_pct, 600);                // (210,000 − 30,000) ÷ 30,000
  assert.equal(varianceTone(sub.kind, sub.variance_pct), 'bad');
  const gp = rowOf(st, 'gross_profit');
  assert.equal(gp.period_actual_halalas, 390_000);    // 600,000 − 210,000
  assert.equal(gp.ytd_actual_halalas, 180_000);       // 600,000 − 420,000
  assert.equal(gp.period_plan_halalas, 170_000);      // 200,000 − 30,000
  assert.equal(gp.fy_plan_halalas, 840_000);          // 1,200,000 − 360,000
  assert.equal(gp.attainment_pct, 21);                // 180,000 ÷ 840,000
  assert.equal(st.gross_profit_pct.period_actual, 65);
  assert.equal(st.gross_profit_pct.period_plan, 85);
  assert.equal(st.gross_profit_pct.fy_plan, 70);
  // سطرٌ واحد فارغ يكفي لتفريغ المجموع والنتيجة معاً
  const holed = { ...actuals, rent: { period: null, ytd: null } };
  const st2 = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [1, 2],
    _loaders: { loadCostActuals: async () => holed, loadCostPlans: async () => plans } });
  assert.equal(rowOf(st2, 'cost_of_revenue').period_actual_halalas, null);
  assert.equal(rowOf(st2, 'gross_profit').period_actual_halalas, null);
  assert.equal(st2.gross_profit_pct.period_actual, null);
});

test('بلا توزيعٍ شهري معتمد: السنوي وحده يُقرأ، والفترة ونِسَبها فارغة', async () => {
  const st = await sectorIncomeStatement({ id: 'u_x', role_id: 'sector_lead', sector_id: 'S2', scope: 'sector' },
    'S2', { year: YR, months: [1, 2] });
  const rev = rowOf(st, 'revenue');
  assert.equal(rev.fy_plan_halalas, 5_000_000);
  assert.equal(rev.period_plan_halalas, null);
  assert.equal(rev.variance_pct, null);
  assert.ok(st.notes.includes('no_monthly_plan'));
});

test('قصُّ الشاشة على مشروع: المحقَّق مقصوص، والخطة فارغة بملاحظةٍ تقول السبب', async () => {
  const st = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [1, 2], scope: { project: 'P2' } });
  const rev = rowOf(st, 'revenue');
  assert.equal(rev.period_actual_halalas, 100_000);   // بند P2 وحده
  assert.equal(rev.ytd_actual_halalas, 100_000);
  assert.equal(rev.fy_plan_halalas, null);
  assert.equal(rev.period_plan_halalas, null);
  assert.equal(rev.attainment_pct, null);
  assert.equal(rev.variance_pct, null);
  assert.ok(st.notes.includes('plan_is_sector_wide'));
  // وقصُّ العميل يمرّ عبر مشروع البند بالقاعدة نفسها
  const cli = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [1, 2], scope: { client: 'C1' } });
  assert.equal(rowOf(cli, 'revenue').period_actual_halalas, 500_000);
});

test('بلا بوابة الكلفة: لا صفوف كلفة ولا مجموع ولا نتيجة — حذفاً لا تفريغاً', async () => {
  const st = await sectorIncomeStatement(reader, 'S1', { year: YR, months: [1, 2] });
  assert.deepEqual(st.rows.map((r) => r.key), ['revenue']);
  assert.equal(rowOf(st, 'revenue').period_actual_halalas, 600_000);
  assert.deepEqual(st.gross_profit_pct, { fy_plan: null, period_plan: null, period_actual: null });
});

test('قطاعٌ آخر لمن نطاقه قطاع: يُرَدّ برسالةٍ عربية', async () => {
  await assert.rejects(() => sectorIncomeStatement(lead, 'S2', { year: YR, months: [1] }),
    (e) => e.status === 403 && /خارج نطاقك/.test(e.message));
});

test('بلا قارئٍ أصلاً: رفضٌ صريح لا قائمةٌ تُبنى', async () => {
  for (const u of [null, undefined]) {
    await assert.rejects(() => sectorIncomeStatement(u, 'S1', { year: YR, months: [1] }),
      (e) => e.status === 403);
  }
});

// ── بابا الكلفة والهامش معاً: القائمة مترابطةٌ حسابياً فلا يُسلَّم نصفُها ────────────────────
test('كلفةٌ بلا هامش: سطر الإيراد وحده — فلا يُطرح مجملُ الربح طرحاً', async () => {
  const st = await sectorIncomeStatement(costNoMargin, 'S1', { year: YR, months: [1, 2] });
  assert.deepEqual(st.rows.map((r) => r.key), ['revenue'],
    'سطور الكلفة أو مجموعها ظهرت لمن لا يملك الهامش — ومنها يُطرح مجمل الربح');
  assert.equal(rowOf(st, 'revenue').period_actual_halalas, 600_000);
  assert.deepEqual(st.gross_profit_pct, { fy_plan: null, period_plan: null, period_actual: null });
});

test('كلفةٌ وهامشٌ بلا إيراد: سطور الكلفة ومجموعها، ولا سطرَ نتيجةٍ فارغاً أبداً', async () => {
  const actuals = Object.fromEntries(COST_KEYS.map((k) => [k, { period: 10_000, ytd: 20_000 }]));
  const st = await sectorIncomeStatement(noRevenue, 'S1', { year: YR, months: [1, 2],
    _loaders: { loadCostActuals: async () => actuals } });
  assert.deepEqual(st.rows.map((r) => r.key), [...COST_KEYS, 'cost_of_revenue']);
  assert.ok(!st.rows.some((r) => r.key === 'gross_profit'), 'سطر مجمل الربح عُرض بلا طرفه الأعلى');
  assert.ok(!st.rows.some((r) => r.key === 'revenue'), 'سطر الإيراد ظهر لمن لا يقرؤه');
  assert.equal(rowOf(st, 'cost_of_revenue').period_actual_halalas, 60_000);
  assert.deepEqual(st.gross_profit_pct, { fy_plan: null, period_plan: null, period_actual: null });
});
