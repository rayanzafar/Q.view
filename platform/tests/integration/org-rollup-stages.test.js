// انحدار (B2): توزيع العمل على الإدارات كان يجمع المكسوب والخاسر والمفتوح في رقم واحد.
//
// القصة المقيسة: departmentRollup كان يحسب قيمة فرص الإدارة بلا أي شرط على المرحلة
// (`SELECT … SUM(value_halalas) … FROM opportunity WHERE sector_id = ? AND …`)، فصار
// «قيمة فرص الإدارة» مجموع الفائزة والخاسرة والمفتوحة معاً. المدير الذي يضع هذا الرقم بجانب
// «مبيعات القطاع» — المعرَّفة في core/reports/metrics.js بأنها الفرص الفائزة غير المستبعدة من
// المبيعات لسنة بعينها — يقارن شيئين مختلفين بلا أن يخبره أحد.
//
// ما تحرسه هذه الاختبارات:
//   ١) الأرقام تعود مفصولة: مفتوحة / مكسوبة / خاسرة / أخرى، وكلٌّ باسمه.
//   ٢) «المكسوبة» تطابق تعريف المبيعات في تقارير الشركة **حرفياً** فتُصالح معه إلى الهللة.
//   ٣) الإجمالي القديم والحقول التي تقرأها شاشة الهيكل باقية كما هي (لا كسر لمستهلك قائم).
//   ٤) الثابت: مفتوحة + مكسوبة + خاسرة + أخرى = الإجمالي، عدداً وقيمةً، في كل دلو.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-rollup-stg-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const attr = await import('../../src/modules/org/attribution.js');
const { companyOverview } = await import('../../src/core/reports/metrics.js');

const T = '2026-01-01T00:00:00Z';
const admin = { id: 'u_admin', username: 'u_admin', role_id: 'admin', sector_id: null, scope: 'company',
  projectIds: new Set(), teamIds: new Set() };

let server = null, port = 0;
const apiGet = async (path) => {
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`);
  return { status: res.status, body: await res.json() };
};

// تعريف المبيعات كما هو في core/reports/metrics.js — لا نعيد صياغته، ننسخه كمرجع مقارنة.
const salesOfSector = async (sectorId, year) => (await get(
  `SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o
     JOIN stage st ON st.id = o.stage_id
    WHERE o.sector_id = ? AND o.year = ? AND st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL`,
  [sectorId, year])).v;

const bucketsOf = (r) => [...r.departments, r.unassigned, r.orphaned];
const sumOver = (r, k) => bucketsOf(r).reduce((a, b) => a + (Number(b[k]) || 0), 0);

before(async () => {
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, kind: 'delivery',
    target_revenue_halalas: 0, target_sales_halalas: 0, created_at: T });
  await insert('sector', { id: 'STRATEGIC', name_ar: 'المشاريع الاستراتيجية', active: 1, sort_order: 2, kind: 'delivery',
    target_revenue_halalas: 0, target_sales_halalas: 0, created_at: T });
  await insert('department', { id: 'D_SMART', sector_id: 'SOLUTIONS', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await insert('department', { id: 'D_AI', sector_id: 'SOLUTIONS', name_ar: 'إدارة البيانات', active: 1, created_at: T });
  await insert('app_user', { id: 'u_admin', username: 'u_admin', name_ar: 'مدير النظام', role_id: 'admin',
    scope: 'company', active: 1, created_at: T });

  await insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, sort_order: 9, is_won: 1, is_lost: 0 });
  await insert('stage', { id: 'LOST', name_ar: 'خاسرة', default_win_pct: 0, sort_order: 10, is_won: 0, is_lost: 1 });

  const opp = (id, dep, stage, value, win, year, extra = {}) => insert('opportunity', { id, code: id,
    title_ar: 'فرصة ' + id, sector_id: 'SOLUTIONS', department_id: dep, stage_id: stage, win_pct: win,
    value_halalas: value, year, created_at: T, ...extra });

  // ── إدارة المدن الذكية: واحدة من كل حالة، والقيم مختلفة كي لا يختبئ خلط خلف تساوٍ ──
  await opp('OS_OPEN', 'D_SMART', 'LEAD', 4000000, 50, 2026);
  await opp('OS_WON', 'D_SMART', 'WON', 10000000, 100, 2026);
  await opp('OS_LOST', 'D_SMART', 'LOST', 7000000, 0, 2026);
  await opp('OS_WON_EXCL', 'D_SMART', 'WON', 2500000, 100, 2026, { exclude_from_sales: 1 });  // مستبعدة بعلم
  await opp('OS_WON_NOYEAR', 'D_SMART', 'WON', 1100000, 100, null);      // مكسوبة بلا سنة ⟵ خارج المبيعات
  await opp('OS_NOSTAGE', 'D_SMART', null, 300000, null, 2026);          // بلا مرحلة ⟵ لا تختفي ولا تُحسب فوزاً
  await opp('OS_OLD_WON', 'D_SMART', 'WON', 9000000, 100, 2025);         // سنة أخرى

  await opp('AI_OPEN', 'D_AI', 'LEAD', 1000000, 20, 2026);

  // ── غير المُسند: الدلو الذي تقرأه شاشة الإسناد ──
  await opp('UN_WON', null, 'WON', 5000000, 100, 2026);
  await opp('UN_OPEN', null, 'LEAD', 2000000, 10, 2026);
  await opp('UN_LOST', null, 'LOST', 800000, 0, 2026);

  // ── ما يجب ألا يدخل الحساب إطلاقاً ──
  await opp('OS_DEL_WON', 'D_SMART', 'WON', 6600000, 100, 2026, { deleted_at: T });
  await insert('opportunity', { id: 'ST_WON', code: 'ST_WON', title_ar: 'فرصة قطاع آخر', sector_id: 'STRATEGIC',
    stage_id: 'WON', win_pct: 100, value_halalas: 12000000, year: 2026, created_at: T });

  const express = (await import('express')).default;
  const { attributionRouter } = await import('../../src/modules/org/attribution.routes.js');
  const { errorHandler } = await import('../../src/core/http/errors.js');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.ctx = { user: admin, ip: '127.0.0.1' }; next(); });
  app.use('/api', attributionRouter);
  app.use(errorHandler());
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await close();
  rmSync(dir, { recursive: true, force: true });
});

test('قيمة فرص الإدارة تعود مفصولة: مفتوحة ومكسوبة وخاسرة كلٌّ باسمه', async () => {
  const r = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year: 2026 });
  const smart = r.departments.find((d) => d.id === 'D_SMART');

  // الرقم المخلوط القديم باقٍ كما كان (شاشة الهيكل تقرأه) — وهو وحده لا يُقارن بشيء
  assert.equal(smart.opportunity_value_halalas, 24900000, 'الإجمالي القديم لم يتغيّر');

  assert.equal(smart.opportunities_open, 1);
  assert.equal(smart.opportunity_open_value_halalas, 4000000, 'المفتوح وحده: لا فائزة ولا خاسرة');
  assert.equal(smart.opportunity_open_weighted_halalas, 2000000, '4,000,000 × 50% — المرجّح للمفتوح فقط');

  assert.equal(smart.opportunities_won, 1);
  assert.equal(smart.opportunity_won_value_halalas, 10000000,
    'المكسوب وحده: المستبعدة من المبيعات وبلا سنة والخاسرة خارجه');

  assert.equal(smart.opportunities_lost, 1);
  assert.equal(smart.opportunity_lost_value_halalas, 7000000);

  // البقية: مكسوبة مستبعدة بعلم + مكسوبة بلا سنة + بلا مرحلة — تُعرَض ولا تُحسب فوزاً
  assert.equal(smart.opportunities_other, 3);
  assert.equal(smart.opportunity_other_value_halalas, 3900000, '2,500,000 + 1,100,000 + 300,000');

  const ai = r.departments.find((d) => d.id === 'D_AI');
  assert.equal(ai.opportunity_open_value_halalas, 1000000);
  assert.equal(ai.opportunity_open_weighted_halalas, 200000);
  assert.equal(ai.opportunity_won_value_halalas, 0, 'إدارة بلا فوز تقول صفراً صريحاً');
  assert.equal(ai.opportunity_lost_value_halalas, 0);
});

test('«مكسوبة» الإدارات تُصالح «مبيعات القطاع» إلى الهللة — نفس التعريف حرفياً', async () => {
  const year = 2026;
  const r = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year });
  const sales = await salesOfSector('SOLUTIONS', year);
  assert.equal(sales, 15000000, 'مرجع المبيعات: 10,000,000 (مُسندة) + 5,000,000 (غير مُسندة)');
  assert.equal(r.totals.opportunity_won_value_halalas, sales,
    'مجموع مكسوب الإدارات + غير المُسند + الشاذ = مبيعات القطاع');

  // ونفس المصالحة أمام الرقم الذي يقرأه المالك فعلاً في مقارنة القطاعات
  const co = await companyOverview(admin, { year });
  const sol = co.sectors.find((s) => s.id === 'SOLUTIONS');
  assert.equal(r.totals.opportunity_won_value_halalas, sol.sales_halalas,
    'رقم الإدارة ورقم لوحة الشركة رقم واحد لا رقمان');
  // والرقم المخلوط القديم ليس هو — وهذا بالضبط ما كان يُقارَن قبل الإصلاح
  assert.notEqual(r.totals.opportunity_value_halalas, sol.sales_halalas,
    'الإجمالي المخلوط لا يساوي المبيعات، فلا يجوز عرضه مكانها');
});

test('الثابت: مفتوحة + مكسوبة + خاسرة + أخرى = الإجمالي، في كل دلو وفي الإجماليات', async () => {
  for (const year of [2026, 2025]) {
    const r = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year });
    for (const b of [...bucketsOf(r), r.totals]) {
      assert.equal(b.opportunities_open + b.opportunities_won + b.opportunities_lost + b.opportunities_other,
        b.opportunities, `العدد يُصالح (سنة ${year})`);
      assert.equal(
        b.opportunity_open_value_halalas + b.opportunity_won_value_halalas
        + b.opportunity_lost_value_halalas + b.opportunity_other_value_halalas,
        b.opportunity_value_halalas, `القيمة تُصالح (سنة ${year})`);
      assert.ok(b.opportunities_other >= 0 && b.opportunity_other_value_halalas >= 0, 'الدلاء غير متداخلة');
    }
    // والإجماليات تظل مجموع الدلاء لكل حقل جديد كما للقديم
    for (const k of Object.keys(r.totals)) assert.equal(r.totals[k], sumOver(r, k), `الإجمالي يطابق التفصيل: ${k}`);
  }
});

test('سنة الفرصة تُحترم كما تحترمها المبيعات: مكسوبة بلا سنة لا تُنسب لأي سنة', async () => {
  const r26 = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year: 2026 });
  const r25 = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year: 2025 });
  const smart26 = r26.departments.find((d) => d.id === 'D_SMART');
  const smart25 = r25.departments.find((d) => d.id === 'D_SMART');

  assert.equal(smart25.opportunity_won_value_halalas, 9000000, 'فوز 2025 يظهر في 2025 وحدها');
  assert.equal(await salesOfSector('SOLUTIONS', 2025), 9000000);
  assert.equal(r25.totals.opportunity_won_value_halalas, await salesOfSector('SOLUTIONS', 2025), 'المصالحة قائمة لكل سنة');

  // OS_WON_NOYEAR تظهر في كل سنة (كي لا يختفي عمل بسبب حقل ناقص) لكنها لا تُحسب فوزاً في أيٍّ منها
  assert.ok(smart26.opportunities_other >= 1 && smart25.opportunities_other >= 1, 'المكسوبة بلا سنة تُعرض في الدلو المحايد');
  assert.equal(smart26.opportunity_won_value_halalas, 10000000, 'ولا تُضاف إلى فوز 2026');
});

test('الفرص المحذوفة وفرص القطاعات الأخرى خارج كل الدلاء الجديدة', async () => {
  const r = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year: 2026 });
  assert.equal(r.totals.opportunities, 10, 'المحذوفة وفرصة القطاع الآخر غير معدودتين');
  assert.equal(r.totals.opportunity_won_value_halalas, 15000000, 'ولا قيمتاهما داخل المكسوب');
  const st = await attr.departmentRollup(admin, { sectorId: 'STRATEGIC', year: 2026 });
  assert.equal(st.unassigned.opportunity_won_value_halalas, 12000000, 'كل قطاع يرى فوزه هو');
});

test('حقول شاشة الهيكل القائمة باقية بأسمائها ومعانيها (لا كسر لمستهلك)', async () => {
  const r = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year: 2026 });
  // ما تقرأه src/web/views/org.js حرفياً: عدّادات العقدة + سطر «قيمتها … · مرجّحة …» لغير المُسند
  const consumed = ['employees', 'projects', 'project_value_halalas', 'opportunities',
    'opportunity_value_halalas', 'opportunity_weighted_halalas', 'allocations'];
  for (const b of [...bucketsOf(r), r.totals])
    for (const k of consumed) assert.equal(typeof b[k], 'number', `الحقل ${k} ما زال رقماً`);

  const smart = r.departments.find((d) => d.id === 'D_SMART');
  assert.equal(smart.opportunities, 6, 'العدّاد «فرص» في الشجرة كما كان: كل فرص السنة');
  assert.equal(smart.opportunity_weighted_halalas, 15600000, 'المرجّح الإجمالي القديم لم يُمسّ');
  assert.equal(r.unassigned.opportunities, 3);
  assert.equal(r.unassigned.opportunity_value_halalas, 7800000);
  assert.equal(r.unassigned.opportunity_weighted_halalas, 5200000);
  assert.equal(r.unassigned.opportunity_open_weighted_halalas, 200000, 'والمرجّح الصحيح متاح بجانبه');
  assert.deepEqual(Object.keys(r).sort(), ['departments', 'orphaned', 'sector', 'totals', 'unassigned', 'year']);
});

test('المسار /org/rollup يُخرج الحقول الجديدة كما تُخرجها الخدمة', async () => {
  const res = await apiGet('/org/rollup?sector=SOLUTIONS&year=2026');
  assert.equal(res.status, 200);
  assert.equal(res.body.totals.opportunity_won_value_halalas, 15000000);
  assert.equal(res.body.totals.opportunity_open_value_halalas, 7000000);
  assert.equal(res.body.totals.opportunity_lost_value_halalas, 7800000);
  assert.equal(res.body.totals.opportunity_value_halalas, 33700000, 'والإجمالي القديم ما زال في الحمولة');
  const smart = res.body.departments.find((d) => d.id === 'D_SMART');
  assert.equal(smart.opportunity_won_value_halalas, 10000000);
  assert.equal(smart.name_ar, 'إدارة المدن الذكية');
});
