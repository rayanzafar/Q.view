// وحدة: DLV_YEAR_SQL — سنة المخرَج المخزَّنة إن سُجِّلت وإلا سنة حدثه (قبول ← تسليم ← حالة ←
// إنشاء)، حرفاً كترحيلة 020. الترشيح بها لا بعمود year العاري الذي كان يُسقط الصفوف المستوردة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dlvy-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });

const { insert, get, close } = await import('../../src/core/db/index.js');
const { DLV_YEAR_SQL } = await import('../../src/modules/finance/recognition.js');

const T25 = '2025-06-10T08:00:00.000Z';
before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T25 });
  await insert('project', { id: 'P1', name_ar: 'مشروع أ', sector_id: 'S1', status: 'IN_PROGRESS', created_at: T25 });
  const d = (id, extra) => insert('deliverable', { id, project_id: 'P1', sector_id: 'S1', name_ar: id,
    amount_halalas: 100_000, status: 'ACCEPTED', created_at: T25, ...extra });
  return Promise.all([
    d('D-year', { year: 2026, month: 2 }),                                  // سنة مخزَّنة تفوز
    d('D-acc', { accepted_at: '2026-04-01T00:00:00.000Z' }),                // قبول 2026
    d('D-dlv', { delivered_at: '2026-05-01T00:00:00.000Z' }),               // تسليم 2026
    d('D-status', { status_at: '2026-06-01T00:00:00.000Z' }),               // حالة 2026
    d('D-created', {}),                                                      // إنشاء 2025 فقط ⇒ فترة غير موثقة
    d('D-stored-wins', { year: 2025, accepted_at: '2026-07-01T00:00:00.000Z' }), // المخزَّنة تغلب الحدث
  ]);
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('التعبير يُرجع سنة كل صف على سلّم الأسبقية الصحيح', async () => {
  const y26 = await get(`SELECT COUNT(*) n FROM deliverable WHERE ${DLV_YEAR_SQL} = 2026`);
  const y25 = await get(`SELECT COUNT(*) n FROM deliverable WHERE ${DLV_YEAR_SQL} = 2025`);
  assert.equal(y26.n, 4); // year + accepted + delivered + status
  assert.equal(y25.n, 1); // explicit 2025 only; import timestamp is not financial evidence
  assert.equal((await get(`SELECT ${DLV_YEAR_SQL} y FROM deliverable WHERE id = 'D-created'`)).y, null);
});

test('المجموع بالتعبير يلتقط الصفوف التي كان year العاري يُسقطها', async () => {
  const bare = await get('SELECT COUNT(*) n FROM deliverable WHERE year = 2026');
  const expr = await get(`SELECT COUNT(*) n FROM deliverable WHERE ${DLV_YEAR_SQL} = 2026`);
  assert.equal(bare.n, 1);
  assert.equal(expr.n, 4);
});
