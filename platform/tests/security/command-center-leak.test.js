// أمن: حمولة «مركز القطاع» لا تُسرّب رقماً خلف بوابةٍ مغلقة.
//
// الفحص هنا **نصّيٌّ على الحمولة المُسلسَلة** لا على مفاتيحها: الشاشة والملفّ يقرآن الحمولة
// كاملةً، فرقمُ كلفةٍ اختبأ في قسمٍ جانبيّ (تغذيةٍ، أو تغييرٍ، أو صفِّ مشروع) مسرَّبٌ كما لو
// كُتب في سطرٍ صريح. فكلُّ مبلغٍ يُبذَر هنا **مميَّزُ الأرقام**، ويُبحث عنه حرفاً في نصّ JSON.
//
// وثلاث بوابات تُفحص: الكلفة والهامش معاً (سطور القائمة والمطابقة وكلفة المشروع)، والراتب
// المختوم (لا يخرج لأي دور مهما علا)، ورقمُ الخطة لمن لا يقرأ المستهدف.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ccleak-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_nocost','قارئ بلا كلفة','No Cost',0,'2026-01-01T00:00:00.000Z')");
for (const r of ['revenue_line', 'budget', 'project', 'opportunity', 'client', 'employee', 'contract', 'invoice']) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_nocost', r, 'read', 'sector']);
}
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_nobudget','قارئ بلا مستهدف','No Budget',0,'2026-01-01T00:00:00.000Z')");
for (const r of ['revenue_line', 'project', 'opportunity', 'client', 'cost', 'margin']) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_nobudget', r, 'read', 'sector']);
}
await (await import('../../src/core/rbac/index.js')).initRbac();
const { buildCommandCenterDataset } = await import('../../src/modules/finance/command-center.js');
const { savePlActuals, savePlPlan } = await import('../../src/modules/finance/pl-lines.js');

const T = '2026-01-10T08:00:00.000Z';
const YR = new Date().getUTCFullYear() - 1;

// أرقامٌ لا تتشابه ولا يتولّد بعضها من بعض بالجمع أو القسمة — فظهورُ أيٍّ منها في النصّ تسريبٌ
// لا مصادفة.
const SEEDED = {
  plSal: 5_100_037,      // رواتبُ التشغيل كما أقفلتها المالية
  plCon: 1_230_041,      // أتعابُ المستشارين كما أقفلتها المالية
  plPlanSal: 4_560_043,  // خطةُ الرواتب لشهرٍ بعينه
  expCon: 70_100_047,    // صرفٌ مصنَّفٌ في سند على مشروع
  expCtr: 30_200_053,    // صرفٌ آخر مصنَّف
  salary: 12_345_059,    // راتبُ موظفٍ في الكشف — مختومٌ على الجميع
};

const person = (id, role, sector) => ({ id, username: id, name_ar: id, role_id: role, sector_id: sector, scope: 'sector' });
const LEAD = person('u_lead', 'sector_lead', 'S1');
const NOCOST = person('u_nocost', 't_nocost', 'S1');
const NOBUDGET = person('u_nobudget', 't_nobudget', 'S1');

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  for (const u of [LEAD, NOCOST, NOBUDGET]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: 'sector', active: 1, created_at: T });
  }
  await db.insert('client', { id: 'C1', name_ar: 'جهة ألف', created_at: T });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع ألف', sector_id: 'S1', client_id: 'C1', rag: 'GREEN',
    status: 'IN_PROGRESS', contract_value_halalas: 90_000_000, margin_pct: 37,
    start_date: `${YR}-01-01`, end_date: `${YR}-12-31`, created_at: T });
  await db.insert('revenue_line', { id: 'RL1', sector_id: 'S1', project_id: 'P1', year: YR, month: 1,
    amount_halalas: 127_765, net_amount_halalas: 111_100, created_at: T });
  await db.insert('expense', { id: 'EX1', sector_id: 'S1', project_id: 'P1', type: 'مستشار', category: 'con',
    amount_halalas: SEEDED.expCon, net_amount_halalas: SEEDED.expCon, incurred_year: YR, incurred_month: 1,
    status: 'APPROVED', created_at: T });
  await db.insert('cost_line', { id: 'CL1', sector_id: 'S1', project_id: 'P1', type: 'تعاقد', category: 'ctr',
    amount_halalas: SEEDED.expCtr, year: YR, month: 2, created_at: T });
  await db.insert('employee', { id: 'E1', name_ar: 'موظف ألف', sector_id: 'S1', active: 1,
    salary_halalas: SEEDED.salary, created_at: T });
  await db.insert('budget', { id: 'B1', sector_id: 'S1', fiscal_year: YR, target_revenue_halalas: 12_000_000,
    target_sales_halalas: 20_000_000, created_at: T });
  await db.insert('allocation', { id: 'AL1', sector_id: 'S1', employee_id: 'E1', person_name_ar: 'موظف ألف',
    project_name: 'مشروع ألف', year: YR, monthly_json: JSON.stringify({ 1: 0.5, 2: 0.75 }), created_at: T });

  const ctx = { user: LEAD, ip: '127.0.0.1' };
  await savePlActuals(ctx, { sectorId: 'S1', year: YR, rows: [
    { month: 1, line_key: 'sal', amount_halalas: SEEDED.plSal },
    { month: 1, line_key: 'con', amount_halalas: SEEDED.plCon },
  ] });
  await savePlPlan(ctx, { sectorId: 'S1', year: YR, rows: [
    { month: 1, line_key: 'sal', amount_halalas: SEEDED.plPlanSal },
  ] });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const jsonFor = async (user) => JSON.stringify(await buildCommandCenterDataset(user, 'S1', { year: YR }));

test('حمولةُ من أُغلق عليه بابا الكلفة والهامش لا تحمل رقمَ كلفةٍ واحداً', async () => {
  const text = await jsonFor(NOCOST);
  for (const [name, v] of Object.entries(SEEDED)) {
    assert.ok(!text.includes(String(v)), `مبلغ «${name}» (${v}) خرج في حمولةٍ لا كلفةَ فيها`);
  }
  for (const key of ['salary_halalas', 'amount_halalas', 'margin_pct', 'actual_spend_halalas']) {
    assert.ok(!text.includes(key), `اسمُ الحقل الحسّاس «${key}» حاضرٌ في الحمولة`);
  }
  for (const key of ['"recon"', '"sal"', '"cor"', '"gp"']) {
    assert.ok(!text.includes(key), `قسمُ كلفةٍ «${key}» حاضرٌ في الحمولة`);
  }
  // وما وراء البوابة يصل كاملاً: الحجب لا يُفرّغ الشاشة.
  assert.ok(text.includes('111100'), 'الإيراد المقروء لهذا الدور غاب هو الآخر');
});

test('الراتب مختومٌ على الجميع — ولا يُشتقّ من كلفةٍ ولا من تسكين', async () => {
  for (const [who, user] of [['قائد القطاع', LEAD], ['بلا كلفة', NOCOST], ['بلا مستهدف', NOBUDGET]]) {
    const text = await jsonFor(user);
    assert.ok(!text.includes(String(SEEDED.salary)), `راتبٌ خرج في حمولة «${who}»`);
    assert.ok(!text.includes('salary_halalas'), `اسمُ حقل الراتب حاضرٌ في حمولة «${who}»`);
  }
});

test('من لا يقرأ المستهدف لا يصله رقمُ خطةٍ ولا قسمُها', async () => {
  const data = await buildCommandCenterDataset(NOBUDGET, 'S1', { year: YR });
  const text = JSON.stringify(data);
  assert.ok(!text.includes(String(SEEDED.plPlanSal)), 'رقمُ خطةٍ خرج لمن لا يقرأ المستهدف');
  assert.ok(!text.includes('12000000'), 'مستهدفُ القطاع خرج لمن لا يقرؤه');
  assert.ok(!text.includes('20000000'), 'مستهدفُ المبيعات خرج لمن لا يقرؤه');
  // قسمُ الخطة يغيب غياباً، وعمودُها يسقط من كل سطر. و`projects[].plan` يبقى فارغاً صراحةً
  // لسببٍ آخر مكتوبٍ في الملاحظات: لا خطة على مستوى المشروع في المنصة لأي قارئ.
  assert.ok(!('plan' in data), 'قسمُ الخطة حاضرٌ لمن لا يقرأ المستهدف');
  for (const l of data.lines) assert.ok(!('plan' in l), `${l.id}: عمودُ الخطة حاضرٌ لمن لا يقرؤه`);
  assert.ok(data.notes.includes('plan_hidden'));
  // وبابا الكلفة والهامش مفتوحان له: أرقامُهما تصله كاملةً.
  assert.ok(text.includes(String(SEEDED.plSal)) && text.includes(String(SEEDED.expCon)));
});

test('حمولةُ قائد القطاع تحمل ما يملكه فعلاً — فالفحص أعلاه ليس فراغاً عامّاً', async () => {
  const text = await jsonFor(LEAD);
  for (const v of [SEEDED.plSal, SEEDED.plCon, SEEDED.plPlanSal, SEEDED.expCon, SEEDED.expCtr]) {
    assert.ok(text.includes(String(v)), `المبلغ ${v} غائبٌ عمّن يملك قراءته`);
  }
});
