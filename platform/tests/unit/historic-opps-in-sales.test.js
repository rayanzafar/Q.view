// وحدة: الفرصة الموسومة «تاريخي» تُحتسب في مبيعات سنتها (قرار المالك ٢٠٢٦-٠٩-٠٨).
// كان العمود `exclude_from_sales` يُخرِج الفرصة من كل رقم مبيعات؛ صار وسماً للتمييز وحده،
// فالمبيعات تجمع كل فرصةٍ فائزةٍ غيرِ محذوفةٍ مُسنَدةٍ إلى السنة — موسومةً كانت أو لا.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-histsales-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { sectorDashboard, sectorWins } = await import('../../src/core/reports/metrics.js');

const T = '2025-01-10T08:00:00.000Z';
const YEAR = 2025;

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, kind: 'delivery', created_at: T });
  await insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 5, is_won: 1, is_lost: 0 });
  await insert('stage', { id: 'LOST', name_ar: 'مفقودة', default_win_pct: 0, sort_order: 6, is_won: 0, is_lost: 1 });
  const opp = (id, extra) => insert('opportunity', { id, title_ar: id, sector_id: 'S1', year: YEAR,
    stage_id: 'WON', win_pct: 100, value_halalas: 1_000_000, exclude_from_sales: 0,
    stage_changed_at: T, created_at: T, ...extra });
  await opp('W-plain');                                                  // فوز عادي
  await opp('W-hist', { value_halalas: 400_000, exclude_from_sales: 1 }); // فوز موسوم «تاريخي»
  await opp('L-1', { stage_id: 'LOST', value_halalas: 900_000, win_pct: 0 });
  await opp('W-hist-del', { value_halalas: 5_000_000, exclude_from_sales: 1, deleted_at: T });
  await opp('W-hist-2026', { value_halalas: 7_000_000, exclude_from_sales: 1, year: 2026 });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('مبيعات القطاع تضمّ الفرصة الموسومة «تاريخي» في سنتها — والوسم للتمييز لا للاستبعاد', async () => {
  const d = await sectorDashboard(null, 'S1', { year: YEAR });
  assert.equal(d.sales_halalas, 1_400_000, '1,000,000 + 400,000 الموسومة «تاريخي»');

  const w = await sectorWins('S1', YEAR);
  assert.equal(w.won, 2, 'الموسومة «تاريخي» فوزٌ معدود كغيره');
  assert.equal(w.wonValue_halalas, 1_400_000);
  assert.equal(w.lost, 1);

  // والحدود تبقى حدوداً: المحذوفة لا تدخل، وسنةُ الفرصة هي التي تحكم لا الوسم
  const next = await sectorDashboard(null, 'S1', { year: 2026 });
  assert.equal(next.sales_halalas, 7_000_000, 'موسومة 2026 تُحسب في 2026 وحدها');
});
