// وحدة: قائمة الدخل للقطاع — قاعدة مصغّرة محكومة.
//
// ما تحرسه هذه الاختبارات بالذات:
//   • قطاعٌ لم تُدخل له المالية شيئاً: كلفتُه **فارغة لا صفر** — والصفر كان سيُنتج «مجمل ربحٍ»
//     يساوي الإيراد كاملاً.
//   • المجموع والنتيجة يُفرَّغان ما دام سطرٌ واحد فارغاً — مجموعُ ما بعضه مجهول مجهول.
//   • الرياضيات نفسها صحيحة حين تصل البيانات — بالمحقون في الاختبار وبالمقروء من القاعدة سواءً.
//   • الخطة للقطاع كلّه: قصُّ الشاشة على مشروع يُفرِّغ أعمدة الخطة ويُبقي المحقَّق مقصوصاً.
//   • بوابة الكلفة تحذف صفوفها من القائمة ولا تعرضها فارغة.
//   • ومع وصل المصدر (`pl_line_amount` عبر `pl-lines.js`): الأرقام الحقيقية تصل السطور،
//     وصفٌّ مُدخَل بصفرٍ يبقى صفراً، وسطرٌ غائب يبقى فراغاً ويُفرِّغ المجموع والنتيجة،
//     ومجموعُ الأشهر المغلقة في الصورة الشهرية = «حتى تاريخه» في القائمة حرفاً.
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
const { PL_LINES, COST_KEYS, LINE_BY_KEY, sectorIncomeStatement, varianceTone, noteText } = await import('../../src/modules/finance/income-statement.js');
const { savePlActuals, savePlPlan, monthlyPlLines, closedThrough } = await import('../../src/modules/finance/pl-lines.js');

const T = '2026-01-10T08:00:00.000Z';
const YR = 2026;
// قائد القطاع: يقرأ الإيراد والمستهدف والكلفة والهامش في قطاعه.
const lead = { id: 'u_lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' };
// قارئٌ بلا بوابة كلفة.
const reader = { id: 'u_read', role_id: 't_reader', sector_id: 'S1', scope: 'sector' };
// قارئٌ يملك الكلفة ولا يملك الهامش، وآخر يملكهما بلا الإيراد.
const costNoMargin = { id: 'u_cnm', role_id: 't_costnomargin', sector_id: 'S1', scope: 'sector' };
const noRevenue = { id: 'u_nrv', role_id: 't_norev', sector_id: 'S1', scope: 'sector' };
// قطاعٌ ثالث مخصَّصٌ لسطور المالية المُدخَلة: قطاع أ يبقى بلا كلفةٍ مُدخَلة كي يظلّ حارساً
// لحالة «لم يُدخَل بعد» كما هي على الشاشة اليوم.
const lead3 = { id: 'u_lead3', role_id: 'sector_lead', sector_id: 'S3', scope: 'sector' };
const reader3 = { id: 'u_read3', role_id: 't_reader', sector_id: 'S3', scope: 'sector' };
const ctx3 = { user: lead3, ip: '10.0.0.3' };

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
  // أشهرُ قطاع أ مغلقةٌ كلُّها بتجاوزٍ من مدير النظام: الكلفة تُجمع على المغلق وحده، وقطاع أ
  // يبقى بلا كلفةٍ **مُدخَلة** (حارسُ حالة «لم يُدخَل بعد») بينما يبقى مُحمِّلاه المحقونان مقروءين.
  await insert('budget', { id: 'B1', sector_id: 'S1', fiscal_year: YR, target_revenue_halalas: 1_200_000, target_sales_halalas: 0, closed_through_month: 12, monthly_json: JSON.stringify(monthlyPlan), created_at: T });
  // قطاع ب: مستهدفٌ سنوي بلا توزيع شهري معتمد
  await insert('budget', { id: 'B2', sector_id: 'S2', fiscal_year: YR, target_revenue_halalas: 5_000_000, target_sales_halalas: 0, created_at: T });

  // ── قطاع ج: المالية أدخلت سطورها فعلاً ──────────────────────────────────────────────
  await insert('sector', { id: 'S3', name_ar: 'قطاع ج', active: 1, sort_order: 3, created_at: T });
  await insert('project', { id: 'P3', name_ar: 'مشروع ج', sector_id: 'S3', client_id: 'C1', status: 'IN_PROGRESS', created_at: T });
  // الصفّ يحمل كاتبه (`created_by` إلى `app_user`) فالحساب موجودٌ فعلاً في الدفاتر
  await insert('app_user', { id: lead3.id, username: lead3.id, name_ar: 'حساب اختباري',
    role_id: lead3.role_id, sector_id: lead3.sector_id, scope: lead3.scope, active: 1, created_at: T });
  // إيراد: يناير 1,000,000 وفبراير 500,000 (صافياً)
  await insert('revenue_line', { id: 'RL6', sector_id: 'S3', project_id: 'P3', year: YR, month: 1, amount_halalas: 1_150_000, net_amount_halalas: 1_000_000, created_at: T });
  await insert('revenue_line', { id: 'RL7', sector_id: 'S3', project_id: 'P3', year: YR, month: 2, amount_halalas: 575_000, net_amount_halalas: 500_000, created_at: T });
  await insert('budget', { id: 'B3', sector_id: 'S3', fiscal_year: YR, target_revenue_halalas: 4_800_000, target_sales_halalas: 0,
    monthly_json: JSON.stringify({ v: 2, months: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), { sales_halalas: 0, revenue_halalas: 400_000 }])) }), created_at: T });
  // ما أقفلته المالية: يناير كاملُ السطور الستة، وفبراير رواتبُ ومستشارون (**صفرٌ مُدخَل**)،
  // ومارس رواتبُ وحدها — فآخر شهرٍ مغلق مشتقٌّ = ٣.
  await savePlActuals(ctx3, { sectorId: 'S3', year: YR, rows: [
    { month: 1, line_key: 'sal', amount_halalas: 300_000 },
    { month: 1, line_key: 'con', amount_halalas: 50_000 },
    { month: 1, line_key: 'ctr', amount_halalas: 10_000 },
    { month: 1, line_key: 'lic', amount_halalas: 5_000 },
    { month: 1, line_key: 'rent', amount_halalas: 20_000 },
    { month: 1, line_key: 'oth', amount_halalas: 1_000 },
    { month: 2, line_key: 'sal', amount_halalas: 200_000 },
    { month: 2, line_key: 'con', amount_halalas: 0, note: 'أُقفل الشهر بلا أتعاب' },
    { month: 3, line_key: 'sal', amount_halalas: 100_000 },
  ] });
  // الخطة: رواتبُ اثني عشر شهراً، وبقيةُ السطور ليناير وحده
  await savePlPlan(ctx3, { sectorId: 'S3', year: YR, rows: [
    ...Array.from({ length: 12 }, (_, i) => ({ month: i + 1, line_key: 'sal', amount_halalas: 100_000 })),
    { month: 1, line_key: 'con', amount_halalas: 40_000 },
    { month: 1, line_key: 'ctr', amount_halalas: 8_000 },
    { month: 1, line_key: 'lic', amount_halalas: 4_000 },
    { month: 1, line_key: 'rent', amount_halalas: 20_000 },
    { month: 1, line_key: 'oth', amount_halalas: 2_000 },
  ] });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const rowOf = (st, key) => st.rows.find((r) => r.key === key);

test('السطور التسعة بترتيبها، والقائمة مجمَّدة', () => {
  assert.equal(PL_LINES.length, 9);
  assert.deepEqual(PL_LINES.map((l) => l.key), ['rev', 'sal', 'con',
    'ctr', 'lic', 'rent', 'oth', 'cor', 'gp']);
  assert.deepEqual(PL_LINES.map((l) => l.ar), ['الإيراد', 'رواتب التشغيل', 'أتعاب المستشارين', 'مصاريف التعاقد',
    'التراخيص', 'الإيجار', 'مصاريف تشغيلية أخرى', 'تكلفة الإيراد', 'مجمل الربح']);
  // المصطلح الإنجليزي يبقى في البيانات لورقة العمل وحدها، ولا يُعرض على الشاشة.
  assert.equal(PL_LINES[8].en, 'Gross Profit (Loss)');
  assert.ok(Object.isFrozen(PL_LINES) && Object.isFrozen(PL_LINES[0]));
  // مفاتيح الكلفة الستة مُصدَّرةً ومجمَّدة: تقرؤها القاعدة والمحوّل وقائمة التصنيف.
  assert.deepEqual(COST_KEYS, ['sal', 'con', 'ctr', 'lic', 'rent', 'oth']);
  assert.ok(Object.isFrozen(COST_KEYS));
  assert.equal(LINE_BY_KEY.cor.ar, 'تكلفة الإيراد');
  assert.equal(LINE_BY_KEY.gp.kind, 'result');
});

test('قطاعٌ بلا كلفةٍ مُدخَلة: فراغٌ لا صفر، والمجموع والنتيجة يُفرَّغان معه', async () => {
  const st = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [1, 2] });
  for (const k of COST_KEYS) {
    const r = rowOf(st, k);
    assert.equal(r.period_actual_halalas, null, `${k}: المحقَّق يجب أن يكون فارغاً لا صفراً`);
    assert.equal(r.ytd_actual_halalas, null);
    assert.equal(r.fy_plan_halalas, null);
    assert.equal(r.state, 'not_entered');
  }
  const sub = rowOf(st, 'cor');
  assert.equal(sub.period_actual_halalas, null);
  assert.equal(sub.state, 'not_entered');
  const gp = rowOf(st, 'gp');
  assert.equal(gp.period_actual_halalas, null);
  assert.equal(gp.ytd_actual_halalas, null);
  assert.deepEqual(st.gross_profit_pct, { fy_plan: null, period_plan: null, period_actual: null });
  // والإيراد وحده رقمٌ حقيقي: يناير 400,000 + فبراير 200,000
  const rev = rowOf(st, 'rev');
  assert.equal(rev.period_actual_halalas, 600_000);
  assert.equal(rev.state, 'ok');
});

test('الإيراد: صافٍ، بسنته، وبأشهر الفترة — و«حتى تاريخه» من يناير إلى آخر شهرٍ مختار', async () => {
  const feb = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [2] });
  const rev = rowOf(feb, 'rev');
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
  const rev = rowOf(jan, 'rev');
  assert.equal(rev.period_actual_halalas, 400_000);
  assert.equal(rev.variance_pct, 300);
  const mar = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [3] });
  const r3 = rowOf(mar, 'rev');
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
  const sub = rowOf(st, 'cor');
  assert.equal(sub.period_actual_halalas, 210_000);   // 10+20+30+40+50+60 ألفاً
  assert.equal(sub.ytd_actual_halalas, 420_000);
  assert.equal(sub.period_plan_halalas, 30_000);      // ستة سطور × 5,000
  assert.equal(sub.fy_plan_halalas, 360_000);
  assert.equal(sub.state, 'ok');
  assert.equal(sub.variance_pct, 600);                // (210,000 − 30,000) ÷ 30,000
  assert.equal(varianceTone(sub.kind, sub.variance_pct), 'bad');
  const gp = rowOf(st, 'gp');
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
  assert.equal(rowOf(st2, 'cor').period_actual_halalas, null);
  assert.equal(rowOf(st2, 'gp').period_actual_halalas, null);
  assert.equal(st2.gross_profit_pct.period_actual, null);
});

test('بلا توزيعٍ شهري معتمد: السنوي وحده يُقرأ، والفترة ونِسَبها فارغة', async () => {
  const st = await sectorIncomeStatement({ id: 'u_x', role_id: 'sector_lead', sector_id: 'S2', scope: 'sector' },
    'S2', { year: YR, months: [1, 2] });
  const rev = rowOf(st, 'rev');
  assert.equal(rev.fy_plan_halalas, 5_000_000);
  assert.equal(rev.period_plan_halalas, null);
  assert.equal(rev.variance_pct, null);
  assert.ok(st.notes.includes('no_monthly_plan'));
});

test('قصُّ الشاشة على مشروع: المحقَّق مقصوص، والخطة فارغة بملاحظةٍ تقول السبب', async () => {
  const st = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [1, 2], scope: { project: 'P2' } });
  const rev = rowOf(st, 'rev');
  assert.equal(rev.period_actual_halalas, 100_000);   // بند P2 وحده
  assert.equal(rev.ytd_actual_halalas, 100_000);
  assert.equal(rev.fy_plan_halalas, null);
  assert.equal(rev.period_plan_halalas, null);
  assert.equal(rev.attainment_pct, null);
  assert.equal(rev.variance_pct, null);
  assert.ok(st.notes.includes('plan_is_sector_wide'));
  // وقصُّ العميل يمرّ عبر مشروع البند بالقاعدة نفسها
  const cli = await sectorIncomeStatement(lead, 'S1', { year: YR, months: [1, 2], scope: { client: 'C1' } });
  assert.equal(rowOf(cli, 'rev').period_actual_halalas, 500_000);
});

test('بلا بوابة الكلفة: لا صفوف كلفة ولا مجموع ولا نتيجة — حذفاً لا تفريغاً', async () => {
  const st = await sectorIncomeStatement(reader, 'S1', { year: YR, months: [1, 2] });
  assert.deepEqual(st.rows.map((r) => r.key), ['rev']);
  assert.equal(rowOf(st, 'rev').period_actual_halalas, 600_000);
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
  assert.deepEqual(st.rows.map((r) => r.key), ['rev'],
    'سطور الكلفة أو مجموعها ظهرت لمن لا يملك الهامش — ومنها يُطرح مجمل الربح');
  assert.equal(rowOf(st, 'rev').period_actual_halalas, 600_000);
  assert.deepEqual(st.gross_profit_pct, { fy_plan: null, period_plan: null, period_actual: null });
});

test('كلفةٌ وهامشٌ بلا إيراد: سطور الكلفة ومجموعها، ولا سطرَ نتيجةٍ فارغاً أبداً', async () => {
  const actuals = Object.fromEntries(COST_KEYS.map((k) => [k, { period: 10_000, ytd: 20_000 }]));
  const st = await sectorIncomeStatement(noRevenue, 'S1', { year: YR, months: [1, 2],
    _loaders: { loadCostActuals: async () => actuals } });
  assert.deepEqual(st.rows.map((r) => r.key), [...COST_KEYS, 'cor']);
  assert.ok(!st.rows.some((r) => r.key === 'gp'), 'سطر مجمل الربح عُرض بلا طرفه الأعلى');
  assert.ok(!st.rows.some((r) => r.key === 'rev'), 'سطر الإيراد ظهر لمن لا يقرؤه');
  assert.equal(rowOf(st, 'cor').period_actual_halalas, 60_000);
  assert.deepEqual(st.gross_profit_pct, { fy_plan: null, period_plan: null, period_actual: null });
});

// ── المصدر موصولٌ: `pl_line_amount` يملأ سطور الكلفة ──────────────────────────────────────

test('الكلفة المُدخَلة تصل السطور: المجموع والنتيجة ونسبتها تُحسب كلها', async () => {
  const st = await sectorIncomeStatement(lead3, 'S3', { year: YR, months: [1] });
  const got = Object.fromEntries(COST_KEYS.map((k) => [k, rowOf(st, k).period_actual_halalas]));
  assert.deepEqual(got, { sal: 300_000, con: 50_000, ctr: 10_000, lic: 5_000, rent: 20_000, oth: 1_000 });
  for (const k of COST_KEYS) assert.equal(rowOf(st, k).state, 'ok', `${k}: الحالة يجب أن تكون «مُدخَل»`);
  const sub = rowOf(st, 'cor');
  assert.equal(sub.period_actual_halalas, 386_000);
  assert.equal(sub.period_plan_halalas, 174_000);     // 100+40+8+4+20+2 ألفاً
  assert.equal(sub.fy_plan_halalas, 1_274_000);       // رواتبُ سنةٍ كاملة + بقيةُ السطور ليناير
  assert.equal(sub.state, 'ok');
  const gp = rowOf(st, 'gp');
  assert.equal(gp.period_actual_halalas, 614_000);    // 1,000,000 − 386,000
  assert.equal(gp.period_plan_halalas, 226_000);      // 400,000 − 174,000
  assert.equal(gp.fy_plan_halalas, 3_526_000);        // 4,800,000 − 1,274,000
  assert.equal(st.gross_profit_pct.period_actual, 61);
  // وانحرافُ الرواتب من المصدرين معاً: (300,000 − 100,000) ÷ 100,000
  assert.equal(rowOf(st, 'sal').variance_pct, 200);
  assert.equal(varianceTone('cost', 200), 'bad');
});

test('صفٌّ مُدخَل بصفرٍ صفر، وسطرٌ غائب فراغ يُفرِّغ المجموع والنتيجة', async () => {
  const feb = await sectorIncomeStatement(lead3, 'S3', { year: YR, months: [2] });
  // أتعاب المستشارين: فبراير أُقفل بصفرٍ مُدخَل — صفرٌ لا فراغ
  const con = rowOf(feb, 'con');
  assert.equal(con.period_actual_halalas, 0);
  assert.equal(con.state, 'ok');
  // والتراخيص لم تُدخَل لفبراير: فراغٌ لا صفر
  assert.equal(rowOf(feb, 'lic').period_actual_halalas, null);
  // فيُفرَّغ المجموع والنتيجة معاً — مجموعُ ما بعضه مجهول مجهول
  assert.equal(rowOf(feb, 'cor').period_actual_halalas, null);
  assert.equal(rowOf(feb, 'gp').period_actual_halalas, null);
  assert.equal(feb.gross_profit_pct.period_actual, null);
  // وشهرٌ لم يُدخَل فيه شيء: كل السطور فارغةٌ في الفترة، وحالتُها من «حتى تاريخه»
  const apr = await sectorIncomeStatement(lead3, 'S3', { year: YR, months: [4] });
  for (const k of COST_KEYS) assert.equal(rowOf(apr, k).period_actual_halalas, null, `${k}: أبريل بلا إدخال`);
});

test('«حتى تاريخه» يجمع من يناير إلى آخر شهرٍ مختار، والفترة تجمع أشهرها وحدها', async () => {
  const feb = await sectorIncomeStatement(lead3, 'S3', { year: YR, months: [2] });
  const sal = rowOf(feb, 'sal');
  assert.equal(sal.period_actual_halalas, 200_000);   // فبراير وحده
  assert.equal(sal.ytd_actual_halalas, 500_000);      // يناير + فبراير
  assert.equal(sal.fy_plan_halalas, 1_200_000);
  assert.equal(sal.attainment_pct, 42);               // 500,000 من 1,200,000
  // والتراخيص: فبراير فارغٌ و«حتى تاريخه» فيه يناير — فالحالة «مُدخَل» والفترة فارغة
  const lic = rowOf(feb, 'lic');
  assert.equal(lic.period_actual_halalas, null);
  assert.equal(lic.ytd_actual_halalas, 5_000);
  assert.equal(lic.state, 'ok');
});

test('الصورة الشهرية والقائمة رقمٌ واحد: مجموع الأشهر المغلقة = «حتى تاريخه»', async () => {
  const closed = await closedThrough('S3', YR);
  assert.deepEqual(closed, { month: 3, source: 'derived' });   // آخر شهرٍ أدخلت فيه المالية
  const monthly = await monthlyPlLines('S3', YR);
  const st = await sectorIncomeStatement(lead3, 'S3',
    { year: YR, months: Array.from({ length: closed.month }, (_, i) => i + 1) });
  for (const k of COST_KEYS) {
    const cells = monthly[k].actual.slice(0, closed.month);
    const expected = cells.every((v) => v == null) ? null : cells.reduce((a, v) => a + (v || 0), 0);
    assert.equal(rowOf(st, k).ytd_actual_halalas, expected, `${k}: الصورة الشهرية تخالف القائمة`);
  }
  assert.equal(rowOf(st, 'sal').ytd_actual_halalas, 600_000);  // 300 + 200 + 100 ألفاً
});

test('قصُّ الشاشة على مشروع: الكلفة تُفرَّغ بملاحظةٍ تقول إنها للقطاع كلّه', async () => {
  const st = await sectorIncomeStatement(lead3, 'S3', { year: YR, months: [1], scope: { project: 'P3' } });
  // الإيراد وحده يُقصّ — والكلفة تُقفل على القطاع فلا تُنسب إلى مشروع
  assert.equal(rowOf(st, 'rev').period_actual_halalas, 1_000_000);
  for (const k of COST_KEYS) {
    const r = rowOf(st, k);
    assert.equal(r.period_actual_halalas, null, `${k}: المحقَّق ظهر على مقصوصٍ من القطاع`);
    assert.equal(r.ytd_actual_halalas, null);
    assert.equal(r.period_plan_halalas, null);
    assert.equal(r.state, 'not_entered');
  }
  assert.equal(rowOf(st, 'cor').period_actual_halalas, null);
  assert.equal(rowOf(st, 'gp').period_actual_halalas, null);
  // والسبب يُقال نصّاً لا يُترك فراغاً يُقرأ «لا كلفة»
  assert.ok(st.notes.includes('costs_are_sector_wide'));
  assert.ok(st.notes.includes('plan_is_sector_wide'));
  assert.ok(noteText('costs_are_sector_wide').length > 0);
  // وبلا قصٍّ لا ملاحظة: القطاع كلُّه هو المقياس نفسه
  const whole = await sectorIncomeStatement(lead3, 'S3', { year: YR, months: [1] });
  assert.ok(!whole.notes.includes('costs_are_sector_wide'));
});

test('بلا بوابة الكلفة: الأرقام المُدخَلة لا تخرج — حذفاً لا تفريغاً', async () => {
  const st = await sectorIncomeStatement(reader3, 'S3', { year: YR, months: [1] });
  assert.deepEqual(st.rows.map((r) => r.key), ['rev']);
  assert.equal(rowOf(st, 'rev').period_actual_halalas, 1_000_000);
  assert.deepEqual(st.gross_profit_pct, { fy_plan: null, period_plan: null, period_actual: null });
  // ولا يتسرّب رقمُ كلفةٍ في أي موضعٍ من المُسلَّم
  assert.ok(!JSON.stringify(st).includes('386000'));
  assert.ok(!JSON.stringify(st).includes('300000'));
});

// ── عدسةُ الإقفال: سطور الكلفة على المغلق وحده ──────────────────────────────────────────
test('كلفةٌ أُدخلت بعد آخر شهرٍ مغلق لا تدخل القائمة — والإيراد يبقى على ما اختير', async () => {
  // المالية تُقفل شهراً بشهر، وقد يُدخَل صفٌّ في شهرٍ لاحقٍ قبل إقفاله (تسوية، أو رفعٌ مبكّر).
  // فلو جُمع مع المغلق لخرج «مجمل ربحٍ» من إيراد فترةٍ وكلفةِ فترةٍ أطول.
  await insert('sector', { id: 'S5', name_ar: 'قطاع هـ', active: 1, sort_order: 5, created_at: T });
  await insert('project', { id: 'P5', name_ar: 'مشروع هـ', sector_id: 'S5', client_id: 'C1', status: 'IN_PROGRESS', created_at: T });
  await insert('app_user', { id: 'u_lead5', username: 'u_lead5', name_ar: 'حساب اختباري',
    role_id: 'sector_lead', sector_id: 'S5', scope: 'sector', active: 1, created_at: T });
  // تجاوزُ مدير النظام: الإقفال حتى فبراير، ولو أُدخلت أرقامُ مارس
  await insert('budget', { id: 'B5', sector_id: 'S5', fiscal_year: YR, target_revenue_halalas: 0,
    target_sales_halalas: 0, closed_through_month: 2, created_at: T });
  await insert('revenue_line', { id: 'RL8', sector_id: 'S5', project_id: 'P5', year: YR, month: 3,
    amount_halalas: 805_000, net_amount_halalas: 700_000, created_at: T });
  const lead5 = { id: 'u_lead5', role_id: 'sector_lead', sector_id: 'S5', scope: 'sector' };
  await savePlActuals({ user: lead5, ip: '10.0.0.5' }, { sectorId: 'S5', year: YR, rows: [
    { month: 1, line_key: 'sal', amount_halalas: 100_000 },
    { month: 2, line_key: 'sal', amount_halalas: 100_000 },
    { month: 3, line_key: 'sal', amount_halalas: 999_000 },   // شهرٌ لم يُقفل بعد
  ] });
  assert.deepEqual(await closedThrough('S5', YR), { month: 2, source: 'override' });

  const st = await sectorIncomeStatement(lead5, 'S5', { year: YR, months: [1, 2, 3] });
  const sal = rowOf(st, 'sal');
  assert.equal(sal.period_actual_halalas, 200_000, 'كلفةُ مارس دخلت القائمة وهو شهرٌ غير مغلق');
  assert.equal(sal.ytd_actual_halalas, 200_000, 'و«حتى تاريخه» يتوقّف عند آخر شهرٍ مغلق');
  // والإيراد على الأشهر المختارة كما سجّلها سند — لا ينتظر الإقفال
  assert.equal(rowOf(st, 'rev').period_actual_halalas, 700_000);
  assert.equal(rowOf(st, 'gp').period_actual_halalas, null, 'سطرٌ واحد فارغ يُفرِّغ النتيجة');

  // وفترةٌ كلُّها بعد الإقفال: الكلفة فراغٌ لا صفر، والإيراد حاضر
  const mar = await sectorIncomeStatement(lead5, 'S5', { year: YR, months: [3] });
  for (const k of COST_KEYS) assert.equal(rowOf(mar, k).period_actual_halalas, null, `${k}: مارس ليس مغلقاً`);
  assert.equal(rowOf(mar, 'rev').period_actual_halalas, 700_000);
});
