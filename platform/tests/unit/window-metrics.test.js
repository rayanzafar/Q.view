// وحدة: أرقام النافذة والمرسّى شهرياً وإيراد النافذة — قاعدة مصغّرة محكومة (بلا ساعة حائط).
// windowFigures مصدرٌ واحد للشريط والرقائق؛ winsByMonth سلسلة متدحرجة تعبر حدود السنة بتاريخ
// الفوز الفعلي؛ windowRevenue مجموع الأشهر المتقاطعة مع النافذة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-winm-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { winsByMonth, windowFigures, windowRevenue } = await import('../../src/core/reports/metrics.js');

const T = '2026-01-10T08:00:00.000Z';
before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, sort_order: 2, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 5, is_won: 1, is_lost: 0 });
  await insert('stage', { id: 'LOST', name_ar: 'مفقودة', default_win_pct: 0, sort_order: 6, is_won: 0, is_lost: 1 });
  const opp = (id, extra) => insert('opportunity', { id, title_ar: id, sector_id: 'S1', year: 2026,
    stage_id: 'WON', value_halalas: 1_000_000, exclude_from_sales: 0, created_at: T, ...extra });
  // فوزان في أغسطس 2026 وواحد في سبتمبر 2025 (يعبر حدود السنة) — والسلسلة حتى 2026-09-01
  await opp('W-aug1', { stage_changed_at: '2026-08-05T10:00:00.000Z' });
  await opp('W-aug2', { stage_changed_at: '2026-08-20T10:00:00.000Z', value_halalas: 2_000_000 });
  await opp('W-sep25', { stage_changed_at: '2025-09-15T10:00:00.000Z', year: 2025 });
  await opp('W-out', { stage_changed_at: '2025-08-20T10:00:00.000Z', year: 2025 });          // قبل النافذة
  await opp('W-excl', { stage_changed_at: '2026-08-06T10:00:00.000Z', exclude_from_sales: 1 }); // مستبعد من المبيعات
  await opp('W-s2', { stage_changed_at: '2026-08-07T10:00:00.000Z', sector_id: 'S2' });       // قطاع آخر
  await opp('L-aug', { stage_id: 'LOST', stage_changed_at: '2026-08-10T10:00:00.000Z' });     // خسارة في النافذة
  await opp('O-open', { stage_id: 'LEAD', stage_changed_at: '2026-08-03T10:00:00.000Z' });    // مفتوحة — لا تُحسب
  // فواتير وتحصيلات للنافذة
  await insert('invoice', { id: 'I1', code: 'INV-1', sector_id: 'S1', amount_halalas: 300_000, status: 'ISSUED', issue_date: '2026-08-10', created_at: T });
  await insert('invoice', { id: 'I2', code: 'INV-2', sector_id: 'S1', amount_halalas: 900_000, status: 'ISSUED', issue_date: '2026-07-01', created_at: T });
  await insert('collection', { id: 'K1', invoice_id: 'I2', amount_halalas: 150_000, collected_at: '2026-08-12', created_at: T });
  // بنود إيراد شهرية: يوليو 400، أغسطس 200، مارس 100 (صافية مباشرة)
  await insert('revenue_line', { id: 'RL-3', sector_id: 'S1', year: 2026, month: 3, amount_halalas: 115_000, net_amount_halalas: 100_000, created_at: T });
  await insert('revenue_line', { id: 'RL-7', sector_id: 'S1', year: 2026, month: 7, amount_halalas: 460_000, net_amount_halalas: 400_000, created_at: T });
  await insert('revenue_line', { id: 'RL-8', sector_id: 'S1', year: 2026, month: 8, amount_halalas: 230_000, net_amount_halalas: 200_000, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const LEAD = { id: 'u-lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' };
const VIEWER = { id: 'u-view', role_id: 'viewer', sector_id: 'S1', scope: 'sector' };

test('winsByMonth: اثنا عشر شقّاً متتابعاً يعبر حدود السنة، بلا مستبعدٍ ولا قطاعٍ آخر', async () => {
  const r = await winsByMonth('S1', { untilIso: '2026-09-01' });
  assert.equal(r.slots.length, 12);
  assert.equal(r.sinceIso, '2025-09-01');
  assert.equal(r.slots[0].ym, '2025-09'); // أقدم شقّ
  assert.equal(r.slots[11].ym, '2026-08'); // أحدث شقّ
  assert.equal(r.slots[0].n, 1);            // فوز سبتمبر 2025 داخل السلسلة
  assert.equal(r.slots[11].n, 2);           // فوزا أغسطس (المستبعد والقطاع الآخر خارجها)
  assert.equal(r.slots[11].v, 3_000_000);
  assert.equal(r.slots.reduce((a, s) => a + s.n, 0), 3); // W-out قبل النافذة لا يظهر
});

test('windowFigures: المكسوب والمحسوم معاً، والمالية لمن يقرؤها', async () => {
  const r = await windowFigures(LEAD, 'S1', '2026-08-01', '2026-09-01');
  assert.deepEqual(r.wins, { n: 2, v: 3_000_000 });
  assert.deepEqual(r.decided, { won: 2, lost: 1, rate: 67 });
  assert.deepEqual(r.invoiced, { n: 1, v: 300_000 });   // فاتورة يوليو خارج النافذة
  assert.deepEqual(r.collected, { n: 1, v: 150_000 });
});

test('windowFigures: لا محسوم في النافذة ⇒ نسبة الفوز null لا صفر كاذب', async () => {
  const r = await windowFigures(LEAD, 'S1', '2026-02-01', '2026-03-01');
  assert.equal(r.decided.rate, null);
  assert.deepEqual(r.wins, { n: 0, v: 0 });
});

test('windowFigures: من لا يقرأ الفواتير يستلم null للمالية لا صفراً', async () => {
  const r = await windowFigures(VIEWER, 'S1', '2026-08-01', '2026-09-01');
  assert.equal(r.invoiced, null);
  assert.equal(r.collected, null);
  assert.deepEqual(r.wins, { n: 2, v: 3_000_000 }); // ويرى المبيعات
});

test('windowRevenue: مجموع الأشهر المتقاطعة مع النافذة، والفارغة صفر بأشهر مسمّاة', async () => {
  const jul = await windowRevenue('S1', 2026, '2026-07-01', '2026-08-25'); // يوليو+أغسطس
  assert.equal(jul.v, 600_000);
  assert.deepEqual(jul.months, [7, 8]);
  const q1 = await windowRevenue('S1', 2026, '2026-01-01', '2026-04-01'); // يناير..مارس
  assert.equal(q1.v, 100_000);
  assert.deepEqual(q1.months, [1, 2, 3]);
  const empty = await windowRevenue('S1', 2027, '2027-01-01', '2027-01-01'); // نافذة فارغة
  assert.deepEqual(empty, { v: 0, months: [] });
});
