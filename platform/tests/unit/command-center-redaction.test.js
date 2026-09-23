// وحدة: حمولة «مركز القطاع» — الحجبُ بالغياب، والفراغُ الذي ليس صفراً.
//
// ما تحرسه هذه الاختبارات بالذات:
//   • **الحجب غيابٌ لا قيمةٌ فارغة**: من لا يقرأ الكلفة لا تصله سطورُها ولا المطابقة ولا
//     الهامش ولا كلفةُ المشروع — لا أصفاراً تُقرأ «لا يوجد صرف».
//   • **الفراغ ليس صفراً**: شهرٌ بلا صفٍّ يعود فارغاً، وصفٌّ مسجَّلٌ بصفرٍ يعود صفراً.
//   • **المجموع يمتدّ بالفراغ**: «تكلفة الإيراد» تفرغ متى فرغ سطرٌ واحد تحتها، و«مجمل الربح»
//     يتبعها — فصفرٌ واحد كان سيُنتج ربحاً يساوي الإيراد كاملاً.
//   • **الحمولة والقائمة رقمٌ واحد**: مجموعُ أشهر السطر حتى الشهر المقفل = «حتى تاريخه» في
//     `sectorIncomeStatement` حرفاً — لا رقمان لشيءٍ واحد في شاشةٍ واحدة.
//   • بوابةُ القطاع قبل أي رقم: قطاعٌ ليس قطاعَه يُردّ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-cc-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
// دوران اختباريان لا وجود لتوليفتهما في المصفوفة — وبناؤهما في القاعدة أصدق من تزوير قرار
// المحرّك: قارئُ إيرادٍ بلا بابَي الكلفة والهامش، وقارئُ كلفةٍ وهامشٍ بلا بابِ المستهدف.
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_nocost','قارئ بلا كلفة','No Cost',0,'2026-01-01T00:00:00.000Z')");
for (const r of ['revenue_line', 'budget', 'project', 'opportunity', 'client']) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_nocost', r, 'read', 'sector']);
}
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_nobudget','قارئ بلا مستهدف','No Budget',0,'2026-01-01T00:00:00.000Z')");
for (const r of ['revenue_line', 'project', 'opportunity', 'client', 'cost', 'margin']) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_nobudget', r, 'read', 'sector']);
}
await (await import('../../src/core/rbac/index.js')).initRbac();

const { buildCommandCenterDataset, resolveCommandCenterSector, monthsFromQuery, STALLED_DAYS } =
  await import('../../src/modules/finance/command-center.js');
const { sectorIncomeStatement } = await import('../../src/modules/finance/income-statement.js');
const { savePlActuals, savePlPlan } = await import('../../src/modules/finance/pl-lines.js');

const T = '2026-01-10T08:00:00.000Z';
// سنةٌ منقضية عمداً: لا تعلّقَ لأرقام الاختبار بشهر تشغيله.
const YR = new Date().getUTCFullYear() - 1;
const day = 86400000;
const dateAgo = (n) => new Date(Date.now() - n * day).toISOString().slice(0, 10);

const person = (id, role, sector) => ({ id, username: id, name_ar: id, role_id: role, sector_id: sector, scope: 'sector' });
const LEAD = person('u_lead', 'sector_lead', 'S1');
const NOCOST = person('u_nocost', 't_nocost', 'S1');
const NOBUDGET = person('u_nobudget', 't_nobudget', 'S1');
const OTHER = person('u_other', 'sector_lead', 'S2');

// مبالغُ كلفةٍ مميّزةٌ بأرقامها: الاختبار الأمني يبحث عنها نصّاً في الحمولة المُسلسَلة.
const PL = {
  sal1: 5_000_003, con1: 1_000_007, sal2: 4_000_009, planSal1: 4_500_017,
  expCon: 70_000_011, expCtr: 30_000_013, expDraft: 90_000_019,
};

const lineOf = (d, key) => d.lines.find((l) => l.id === key);

let asLead, asNoCost, asNoBudget;

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  for (const u of [LEAD, NOCOST, NOBUDGET, OTHER]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: 'sector', active: 1, created_at: T });
  }
  await db.insert('department', { id: 'D1', name_ar: 'إدارة الدال', sector_id: 'S1', created_at: T });
  await db.insert('client', { id: 'C1', name_ar: 'جهة ألف', created_at: T });
  await db.insert('client', { id: 'C2', name_ar: 'جهة باء', created_at: T });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع ألف', code: 'PR-1', sector_id: 'S1', client_id: 'C1',
    department_id: 'D1', rag: 'GREEN', status: 'IN_PROGRESS', contract_value_halalas: 90_000_000,
    margin_pct: 34, start_date: `${YR}-01-01`, end_date: `${YR}-06-30`, created_at: T });
  await db.insert('project', { id: 'P2', name_ar: 'مشروع باء', code: 'PR-2', sector_id: 'S1', client_id: 'C2',
    rag: 'AMBER', status: 'IN_PROGRESS', contract_value_halalas: 40_000_000, margin_pct: 12.54,
    start_date: `${YR}-01-01`, end_date: `${YR}-12-31`, created_at: T });

  // الإيراد الصافي المسجَّل يسبق الإجمالي (قاعدة ٠١٩).
  await db.insert('revenue_line', { id: 'RL1', sector_id: 'S1', project_id: 'P1', year: YR, month: 1,
    amount_halalas: 127_765, net_amount_halalas: 111_100, created_at: T });
  await db.insert('revenue_line', { id: 'RL2', sector_id: 'S1', project_id: 'P2', year: YR, month: 2,
    amount_halalas: 255_530, net_amount_halalas: 222_200, created_at: T });

  // صرفُ سند مصنَّفاً بالسطر: معتمدٌ ومدفوعٌ يدخلان، والمسودّة لا تدخل.
  await db.insert('expense', { id: 'EX1', sector_id: 'S1', project_id: 'P1', type: 'مستشار خارجي', category: 'con',
    amount_halalas: PL.expCon, net_amount_halalas: PL.expCon, incurred_year: YR, incurred_month: 1,
    status: 'APPROVED', created_at: T });
  await db.insert('expense', { id: 'EX2', sector_id: 'S1', project_id: 'P2', type: 'تعاقد', category: 'ctr',
    amount_halalas: PL.expCtr, net_amount_halalas: PL.expCtr, incurred_year: YR, incurred_month: 2,
    status: 'PAID', created_at: T });
  await db.insert('expense', { id: 'EX3', sector_id: 'S1', project_id: 'P1', type: 'مسودّة', category: 'con',
    amount_halalas: PL.expDraft, net_amount_halalas: PL.expDraft, incurred_year: YR, incurred_month: 1,
    status: 'DRAFT', created_at: T });

  // المستهدف: توزيعٌ شهري معتمد (مليون هللة لكل شهر).
  const monthly = { v: 2, months: Object.fromEntries(Array.from({ length: 12 }, (_, i) =>
    [String(i + 1), { sales_halalas: 0, revenue_halalas: 1_000_000 }])) };
  await db.insert('budget', { id: 'B1', sector_id: 'S1', fiscal_year: YR, target_revenue_halalas: 12_000_000,
    target_sales_halalas: 20_000_000, monthly_json: JSON.stringify(monthly), created_at: T });

  // الفرص ومراحلها: مرحلةٌ مفتوحةٌ واحدة تكفي — المقصود قاعدةُ الركود لا قمعُ المراحل.
  await db.insert('stage', { id: 'QUALIFIED', name_ar: 'مؤهلة', default_win_pct: 40, sort_order: 2,
    color: '#1d4ed8', is_won: 0, is_lost: 0 });
  await db.insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 9,
    color: '#047857', is_won: 1, is_lost: 0 });
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة ألف', client_id: 'C1', sector_id: 'S1',
    stage_id: 'QUALIFIED', win_pct: 40, value_halalas: 100_000_000, year: YR,
    stage_changed_at: dateAgo(10), created_at: T });
  await db.insert('opportunity', { id: 'O2', title_ar: 'فرصة باء', client_id: 'C2', sector_id: 'S1',
    stage_id: 'QUALIFIED', win_pct: 70, value_halalas: 250_000_000, year: YR,
    stage_changed_at: dateAgo(STALLED_DAYS + 40), created_at: T });
  await db.insert('opportunity', { id: 'O3', title_ar: 'فرصة مكسوبة', client_id: 'C1', sector_id: 'S1',
    stage_id: 'WON', win_pct: 100, value_halalas: 500_000_000, year: YR, created_at: T });

  // ما أقفلته المالية: يناير بسطوره الستة كاملةً (وفيها أصفارٌ **مسجَّلة**)، وفبراير بسطرٍ
  // واحد — فيناير يجمع، وفبراير يفرغ. والخطة على سطرٍ واحدٍ من يناير.
  const ctx = { user: LEAD, ip: '127.0.0.1' };
  await savePlActuals(ctx, { sectorId: 'S1', year: YR, rows: [
    { month: 1, line_key: 'sal', amount_halalas: PL.sal1 },
    { month: 1, line_key: 'con', amount_halalas: PL.con1 },
    { month: 1, line_key: 'ctr', amount_halalas: 0 },
    { month: 1, line_key: 'lic', amount_halalas: 0 },
    { month: 1, line_key: 'rent', amount_halalas: 0 },
    { month: 1, line_key: 'oth', amount_halalas: 0 },
    { month: 2, line_key: 'sal', amount_halalas: PL.sal2 },
  ] });
  await savePlPlan(ctx, { sectorId: 'S1', year: YR, rows: [
    { month: 1, line_key: 'sal', amount_halalas: PL.planSal1 },
  ] });

  asLead = await buildCommandCenterDataset(LEAD, 'S1', { year: YR });
  asNoCost = await buildCommandCenterDataset(NOCOST, 'S1', { year: YR });
  asNoBudget = await buildCommandCenterDataset(NOBUDGET, 'S1', { year: YR });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── ١) الشكل: اثنا عشر شهراً دائماً، وصفرُ يناير فهرسُه صفر ──────────────────────────────
test('الحمولة تحمل قطاعها وسنتها، وكلُّ سلسلةٍ اثنا عشر شقّاً أولها يناير', () => {
  assert.equal(asLead.meta.sector.id, 'S1');
  assert.equal(asLead.meta.sector.name_ar, 'قطاع الحلول');
  assert.equal(asLead.meta.year, YR);
  assert.equal(asLead.lines.length, 9, 'سطور القائمة التسعة كلها مرئيةٌ لقائد القطاع');
  for (const l of asLead.lines) {
    for (const k of ['plan', 'fin', 'sanad']) {
      assert.ok(Array.isArray(l[k]) && l[k].length === 12, `${l.id}.${k} ليست اثني عشر شقّاً`);
    }
  }
  assert.equal(lineOf(asLead, 'rev').fin[0], 111_100, 'الفهرس صفر ليس يناير');
  assert.equal(lineOf(asLead, 'rev').fin[1], 222_200);
});

// ── ٢) الفراغ ليس صفراً، والصفر المسجَّل ليس فراغاً ─────────────────────────────────────
test('شهرٌ بلا صفٍّ يعود فارغاً، وصفٌّ مسجَّلٌ بصفرٍ يعود صفراً', () => {
  const sal = lineOf(asLead, 'sal');
  assert.equal(sal.fin[0], PL.sal1);
  assert.equal(sal.fin[1], PL.sal2);
  assert.equal(sal.fin[2], null, 'شهرٌ لم تُدخله المالية عاد صفراً بدل فراغ');
  const ctr = lineOf(asLead, 'ctr');
  assert.equal(ctr.fin[0], 0, 'صفرٌ مسجَّل عاد فراغاً — والصفر خبرٌ لا غياب');
  assert.equal(ctr.fin[1], null);
  // الخطة كذلك: شهرٌ بلا خطةٍ فارغ، ولا يُملأ بقسمةِ سنةٍ على اثني عشر.
  assert.equal(sal.plan[0], PL.planSal1);
  assert.equal(sal.plan[1], null);
  // وسطرُ الإيراد فارغٌ فيما لم يُسجَّل، ولا يُقرأ صفراً.
  assert.equal(lineOf(asLead, 'rev').fin[5], null);
});

// ── ٣) المجموع يمتدّ بالفراغ ─────────────────────────────────────────────────────────────
test('«تكلفة الإيراد» تجمع شهراً اكتملت سطورُه وتفرغ شهراً نقص أحدها، و«مجمل الربح» يتبعها', () => {
  const cor = lineOf(asLead, 'cor');
  const gp = lineOf(asLead, 'gp');
  assert.equal(cor.fin[0], PL.sal1 + PL.con1, 'يناير مكتملُ السطور فمجموعه مكتوب');
  assert.equal(cor.fin[1], null, 'فبراير ناقصُ سطورٍ فمجموعه يجب أن يفرغ');
  assert.equal(gp.fin[0], 111_100 - (PL.sal1 + PL.con1));
  assert.equal(gp.fin[1], null, 'مجمل الربح تبع مجموعاً فارغاً فوجب أن يفرغ');
  assert.equal(gp.fin[6], null, 'شهرٌ بلا إيرادٍ ولا كلفة لا ربحَ محسوباً له');
});

// ── ٤) ما سجّله سند مقابلَ ما أقفلته المالية ────────────────────────────────────────────
test('عمودُ سند يحمل الصرف المصنَّف وحده: المعتمد والمدفوع دون المسودّة', () => {
  assert.equal(lineOf(asLead, 'con').sanad[0], PL.expCon);
  assert.equal(lineOf(asLead, 'ctr').sanad[1], PL.expCtr);
  assert.equal(lineOf(asLead, 'sal').sanad[0], null, 'سطرٌ بلا صرفٍ مصنَّفٍ في سند عاد صفراً');
  assert.equal(lineOf(asLead, 'con').sanad[1], null);
  // والمطابقة حاضرةٌ لمن يقرأ الكلفة، باثني عشر شهراً.
  assert.ok(Array.isArray(asLead.recon?.months) && asLead.recon.months.length === 12);
});

// ── ٥) الحمولة والقائمة رقمٌ واحد ───────────────────────────────────────────────────────
test('مجموعُ أشهر السطر حتى الشهر المقفل = «حتى تاريخه» في قائمة الدخل حرفاً', async () => {
  assert.equal(asLead.meta.closed_through, 2, 'الشهر المقفل يُشتقّ من آخر شهرٍ أدخلته المالية');
  assert.equal(asLead.meta.closed_source, 'derived');
  const st = await sectorIncomeStatement(LEAD, 'S1', { year: YR, months: [] });
  for (const key of ['sal', 'con']) {
    const sum = lineOf(asLead, key).fin.slice(0, asLead.meta.closed_through)
      .reduce((a, v) => a + (v || 0), 0);
    assert.equal(sum, st.rows.find((r) => r.key === key).ytd_actual_halalas, `${key}: الحمولة تخالف القائمة`);
  }
});

// ── ٦) المشاريع والعملاء والفرص ─────────────────────────────────────────────────────────
test('المشروع: حالُه ومتبقّيه وكلفتُه المصنَّفة، ولا خطة على مستواه', () => {
  const p1 = asLead.projects.find((p) => p.id === 'P1');
  assert.equal(p1.name, 'مشروع ألف');
  assert.equal(p1.code, 'PR-1');
  assert.equal(p1.client_id, 'C1');
  assert.equal(p1.dept_id, 'D1');
  assert.equal(p1.rag, 'GREEN');
  assert.equal(p1.contract, 90_000_000);
  assert.equal(p1.remaining, 90_000_000 - 111_100);
  assert.equal(p1.end_m, 6);
  assert.equal(p1.act.rev[0], 111_100);
  // كلفةُ المشروع اثنا عشر شقّاً كإيراده: الشاشة تقصّ الأشهر في المتصفّح.
  assert.equal(p1.act.con.length, 12);
  assert.equal(p1.act.con[0], PL.expCon);
  assert.equal(p1.act.con[1], null, 'شهرٌ لا صرفَ فيه عاد صفراً بدل فراغ');
  assert.deepEqual(p1.act.ctr, Array(12).fill(null), 'بندٌ لا صرفَ عليه أصلاً يبقى اثني عشر فراغاً');
  // الهامش نسبةٌ مئوية صريحة: ٣٤ تعني ٣٤٪ — لا كسراً (٠٫٣٤) ولا هللات. والشاشة تطبعها مرةً
  // واحدة؛ خلطُ العُرفين هو ما طبع «الهامش ١٨٠٠٪» على الشاشة الحية.
  assert.equal(p1.margin_pct, 34);
  const p2 = asLead.projects.find((p) => p.id === 'P2');
  assert.equal(p2.margin_pct, 12.5, 'نصفُ نقطةٍ من هامشٍ ضيّق ابتلعه التقريب');
  assert.equal(p1.plan, null);
  assert.ok(asLead.notes.includes('no_project_plan'), 'سببُ فراغ خطة المشروع غير مذكور');
});

test('حصصُ العملاء من الإيراد تجمع مئةً، والفرصةُ الراكدة تُوسَم بقاعدتها', () => {
  const shares = asLead.clients.map((c) => c.share_pct).filter((v) => v != null);
  assert.ok(shares.length >= 2);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 100) <= 0.2, `مجموع الحصص ${shares}`);
  const c1 = asLead.clients.find((c) => c.id === 'C1');
  assert.equal(c1.revenue, 111_100);
  assert.equal(c1.projects, 1);
  assert.equal(c1.prospect, 100_000_000, 'ما للعميل من فرصٍ مفتوحةٍ — دون المكسوبة');

  assert.equal(asLead.opps.length, 2, 'المكسوبة ليست فرصةً مفتوحة');
  const o1 = asLead.opps.find((o) => o.id === 'O1');
  const o2 = asLead.opps.find((o) => o.id === 'O2');
  assert.equal(o1.idle_days, 10);
  assert.equal(o1.stalled, false);
  assert.equal(o1.prob, 0.4, 'الاحتمال كسرٌ لا نسبةٌ مئوية');
  assert.equal(o2.stalled, true, `ركودٌ فوق ${STALLED_DAYS} يوماً لم يُوسَم`);
  assert.ok(asLead.stages.some((s) => s.key === 'QUALIFIED' && s.name === 'مؤهلة'));
});

// ── ٧) الحجب بالغياب: بلا كلفةٍ ولا هامش ────────────────────────────────────────────────
test('قارئٌ بلا بابَي الكلفة والهامش: لا سطورَ كلفةٍ ولا مطابقةَ ولا هامشَ ولا كلفةَ مشروع', () => {
  assert.deepEqual(asNoCost.lines.map((l) => l.id), ['rev'], 'سطرُ كلفةٍ ظهر لمن لا يقرؤها');
  assert.ok(!('recon' in asNoCost), 'المطابقة يجب أن تغيب غياباً لا أن تعود فارغة');
  for (const p of asNoCost.projects) {
    assert.ok(!('margin_pct' in p), 'الهامش حاضرٌ كمفتاحٍ لمن لا يقرؤه');
    assert.deepEqual(Object.keys(p.act), ['rev'], 'كلفةُ المشروع حاضرةٌ لمن لا يقرؤها');
  }
  assert.ok(asNoCost.notes.includes('costs_hidden'), 'سببُ غياب الكلفة غير مذكور');
  // وما بقي من الحمولة كاملٌ: الحجب لا يُعطّل الشاشة.
  assert.equal(asNoCost.projects.length, 2);
  assert.equal(lineOf(asNoCost, 'rev').fin[0], 111_100);
  assert.ok(asNoCost.plan, 'المستهدف مقروءٌ لهذا الدور فيجب أن يصله');
});

test('قارئٌ بلا بابِ المستهدف: لا خطةَ في السطور ولا قسمَ خطةٍ في الحمولة', () => {
  assert.ok(!('plan' in asNoBudget), 'قسم الخطة حاضرٌ لمن لا يقرأ المستهدف');
  for (const l of asNoBudget.lines) assert.ok(!('plan' in l), `${l.id}: عمودُ الخطة حاضرٌ لمن لا يقرؤه`);
  assert.ok(asNoBudget.notes.includes('plan_hidden'));
  // وبابا الكلفة والهامش مفتوحان له، فسطورُها ومطابقتُها حاضرة.
  assert.equal(asNoBudget.lines.length, 9);
  assert.ok(asNoBudget.recon);
  assert.equal(lineOf(asNoBudget, 'sal').fin[0], PL.sal1);
});

// ── ٨) البوابة قبل أي رقم ───────────────────────────────────────────────────────────────
test('قطاعٌ ليس قطاعَ القارئ يُردّ، وقطاعٌ لا وجود له يُقال إنه غير موجود', async () => {
  await assert.rejects(() => buildCommandCenterDataset(OTHER, 'S1', { year: YR }),
    (e) => e.status === 403 && /خارج نطاقك/.test(e.message));
  await assert.rejects(() => resolveCommandCenterSector(LEAD, { sector: 'S2' }), (e) => e.status === 403);
  // اسمٌ لا وجود له يُردّ بالرفض نفسه لمن نطاقه قطاعُه — فلا يُفرَّق «غير موجود» عن «ليس لك».
  await assert.rejects(() => resolveCommandCenterSector(LEAD, { sector: 'S_NOPE' }),
    (e) => e.status === 403 && /خارج نطاقك/.test(e.message));
  // ومن نطاقه الشركة يقرأ كلَّ قطاع، فرابطُه المكسور يُقال إنه مكسور لا إنه ممنوع.
  const boss = { id: 'u_boss', username: 'u_boss', role_id: 'admin', sector_id: null, scope: 'company' };
  await assert.rejects(() => resolveCommandCenterSector(boss, { sector: 'S_NOPE' }), (e) => e.status === 404);
  const own = await resolveCommandCenterSector(LEAD, { sector: 'S1' });
  assert.equal(own.id, 'S1');
});

// ── ٩) الخطة والطاقة والمصدر ────────────────────────────────────────────────────────────
test('الخطة والطاقة والمصدر: مستهدفٌ موزَّع، ووحداتُ دوامٍ بلا مال، وآخر رفعةٍ باسم صاحبها', () => {
  assert.equal(asLead.plan.sector_target, 12_000_000);
  assert.equal(asLead.plan.sales_target, 20_000_000);
  assert.equal(asLead.plan.monthly_target[0], 1_000_000);
  assert.equal(asLead.plan.finance_plan_fy, null, 'لا خطة إيرادٍ مرفوعةً من المالية بعد');
  assert.equal(asLead.staffing.head, 0);
  assert.equal(asLead.staffing.cap.length, 12);
  assert.equal(asLead.staffing.alloc.length, 12);
  assert.equal(asLead.meta.finance_upload.by, 'u_lead', 'آخر رفعةٍ بلا اسمِ صاحبها');
  assert.ok(asLead.meta.finance_upload.at, 'آخر رفعةٍ بلا ختمِ وقت');
  assert.ok(asLead.meta.today.iso && asLead.meta.today.m >= 1 && asLead.meta.today.m <= 12);
});

// ── ١٠) قارئُ الأشهر الواحد: لسانُ الفترة ولسانُ الاختيار المتفرّق ──────────────────────
test('أشهرُ الفترة تُقرأ من «الفترة» ومن اختيارٍ متفرّقٍ معاً، والأخصُّ يفوز', () => {
  assert.deepEqual(monthsFromQuery({}, YR), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(monthsFromQuery({ p: 'q2' }, YR), [4, 5, 6]);
  assert.deepEqual(monthsFromQuery({ months: '1,3,5' }, YR), [1, 3, 5]);
  assert.deepEqual(monthsFromQuery({ months: [5, 1, 3, 3] }, YR), [1, 3, 5], 'التكرار يُطوى والترتيب يُصحَّح');
  assert.deepEqual(monthsFromQuery({ p: 'q2', months: '9,11' }, YR), [9, 11], 'الاختيار المتفرّق يعلو على اسم الفترة');
  assert.throws(() => monthsFromQuery({ months: '0,13' }, YR), (e) => e.status === 400);
});
