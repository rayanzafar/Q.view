// وحدة: forecastRange — ثلاثة سيناريوهات من سجلات حقيقية: low ≤ base ≤ high دائماً،
// فرصة بلا احتمال فوز تساهم بصفر في الأساس وبكامل قيمتها في المتفائل، وفرصة بلا سنة **داخل**
// المجموعة (سقوطها كان يعرض «مرجّحين» مختلفين للقطاع نفسه في الصفحة الواحدة).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-fcr-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { forecastRange } = await import('../../src/core/reports/metrics.js');

const T = '2026-01-10T08:00:00.000Z';
before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 5, is_won: 1, is_lost: 0 });
  await insert('stage', { id: 'LOST', name_ar: 'مفقودة', default_win_pct: 0, sort_order: 6, is_won: 0, is_lost: 1 });
  // المحقق: مليون صافٍ
  await insert('revenue_line', { id: 'RL-1', sector_id: 'S1', year: 2026, month: 5, amount_halalas: 1_150_000, net_amount_halalas: 1_000_000, created_at: T });
  const opp = (id, extra) => insert('opportunity', { id, title_ar: id, sector_id: 'S1', year: 2026,
    stage_id: 'LEAD', value_halalas: 0, exclude_from_sales: 0, created_at: T, ...extra });
  // المفتوح: 1M باحتمال 50 + 0.5M بلا احتمال (null) + 0.2M بلا سنة باحتمال 100
  await opp('O-a', { value_halalas: 1_000_000, win_pct: 50 });
  await opp('O-b', { value_halalas: 500_000, win_pct: null });
  await opp('O-c', { value_halalas: 200_000, win_pct: 100, year: null });
  // المحسوم في 2026: فوز واحد وثلاث خسائر ⇒ نسبة فوز تاريخية 25%
  await opp('W-1', { stage_id: 'WON', win_pct: 100, value_halalas: 300_000 });
  await opp('L-1', { stage_id: 'LOST' });
  await opp('L-2', { stage_id: 'LOST' });
  await opp('L-3', { stage_id: 'LOST' });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('forecastRange: الصيغ الثلاث كما أُعلنت، وlow ≤ base ≤ high', async () => {
  const r = await forecastRange('S1', 2026);
  assert.equal(r.actual, 1_000_000);
  assert.equal(r.open_raw, 1_700_000);        // O-a + O-b + O-c (بلا سنة: داخل)
  assert.equal(r.open_weighted, 700_000);     // 500k من O-a + 0 من O-b (null⇒صفر) + 200k من O-c
  assert.equal(r.rate, 25);                   // فوز من أربع محسومة
  assert.equal(r.base, 1_700_000);            // المحقق + المرجّح
  assert.equal(r.low, 1_425_000);             // المحقق + min(700k، 1.7M×25% = 425k)
  assert.equal(r.high, 2_700_000);            // المحقق + كامل المفتوح
  assert.ok(r.low <= r.base && r.base <= r.high);
});

test('forecastRange: بلا فرص محسومة تبقى النطاقات سليمة (rate صفر ⇒ low = المحقق)', async () => {
  await insert('sector', { id: 'S9', name_ar: 'قطاع خالٍ', active: 1, sort_order: 9, created_at: T });
  await insert('opportunity', { id: 'O-s9', title_ar: 'وحيدة', sector_id: 'S9', year: 2026,
    stage_id: 'LEAD', value_halalas: 400_000, win_pct: 30, exclude_from_sales: 0, created_at: T });
  const r = await forecastRange('S9', 2026);
  assert.equal(r.actual, 0);
  assert.equal(r.low, 0);                     // min(120k، 400k×0%) = 0
  assert.equal(r.base, 120_000);
  assert.equal(r.high, 400_000);
  assert.ok(r.low <= r.base && r.base <= r.high);
});

// ── انحدار المصالحة: ثلاثة مواضع، رقم مرجّح واحد ─────────────────────────────────────────
test('المصالحة: revenueForecast وforecastRange واستعلام الصفحة تُخرج المرجّح نفسه', async () => {
  const { revenueForecast, WEIGHTED_OPEN } = await import('../../src/core/reports/metrics.js');
  const { all } = await import('../../src/core/db/index.js');
  const [rf, fr] = await Promise.all([revenueForecast('S1', 2026), forecastRange('S1', 2026)]);
  assert.equal(rf.weightedOpen, fr.open_weighted);           // 700k — الفرص بلا سنة داخل الاثنين
  assert.equal(rf.forecast, fr.base);
  const pipe = await all(`SELECT ${WEIGHTED_OPEN} weighted FROM opportunity o
     JOIN stage st ON st.id = o.stage_id
     WHERE st.is_won = 0 AND st.is_lost = 0 AND o.deleted_at IS NULL AND o.sector_id = ?`, ['S1']);
  assert.equal(Math.round(pipe[0].weighted), fr.open_weighted); // تعبير الصفحة = التعبير القانوني
});
