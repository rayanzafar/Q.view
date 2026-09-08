import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sanad-revenue-integrity-'));
if (process.env.DATABASE_URL) {
  const target = new URL(process.env.DATABASE_URL);
  if (process.env.SANAD_TEST_POSTGRES !== '1' || !['localhost', '127.0.0.1'].includes(target.hostname)
      || target.pathname !== '/sanad_test') throw new Error('Revenue tests require an explicitly isolated local test database');
}
process.env.SANAD_DB = join(dir, 'test.db');
const db = await import('../../src/core/db/index.js');
const { recognitionPeriod } = await import('../../src/modules/finance/revenue-period.js');
const { revenueReview } = await import('../../src/modules/finance/revenue-review.js');
const adapter = (await import('../../src/modules/io/adapters/revenues.js')).default;
const engine = await import('../../src/modules/io/engine.js');
const { buildExport } = await import('../../src/modules/io/xlsx.js');
const stamp = '2026-01-01T00:00:00.000Z';
const admin = { id: 'A', username: 'admin', role_id: 'admin', scope: 'company' };
const lead = { id: 'L', username: 'lead', role_id: 'sector_lead', scope: 'sector', sector_id: 'S' };
const ctx = { user: admin, ip: '127.0.0.1' };

before(async () => {
  await (await import('../../scripts/migrate.js')).migrate();
  await (await import('../../scripts/seed-rbac.js')).seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  for (const id of ['S', 'OTHER']) await db.insert('sector', { id, name_ar: id, active: 1, created_at: stamp });
  for (const u of [admin, lead]) await db.insert('app_user', { ...u, active: 1, created_at: stamp });
  for (const sector of ['S', 'OTHER']) await db.insert('project', { id: 'P_' + sector, name_ar: 'مشروع ' + sector, sector_id: sector, status: 'IN_PROGRESS', created_at: stamp });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });
const row = (id) => db.get('SELECT * FROM revenue_line WHERE id = ?', [id]);
async function manual(id, extra = {}) {
  await db.insert('revenue_line', { id, project_id: 'P_S', sector_id: 'S', year: 2026, month: 1,
    amount_halalas: 11500, net_amount_halalas: 10000, vat_halalas: 1500, auto: 0, label: id, created_at: stamp, ...extra });
}
const mapped = (r, extra = {}) => ({ id: r.id, sector: r.sector_id, project: r.project_id,
  year: r.year, month: r.month, amount: r.amount_halalas, label: r.label, ...extra });

test('regression: importing an amount updates net/VAT; undo restores every field exactly', async () => {
  await manual('ROUNDTRIP'); const beforeRow = await row('ROUNDTRIP');
  const file = buildExport({ columns: adapter.columns, rows: [{ id: 'ROUNDTRIP', sector: 'S', project: 'P_S',
    year: 2025, month: 12, amount: 230, label: 'تصحيح موثق' }], format: 'xlsx' }).buffer;
  const up = await engine.upload(ctx, 'revenues', file, 'review.xlsx');
  const pv = await engine.preview(ctx, 'revenues', { runId: up.runId, mapping: up.autoMapping });
  assert.equal(pv.counts.update, 1); assert.equal(pv.counts.error, 0);
  assert.match(pv.rows[0].detail, /السنة/); assert.match(pv.rows[0].detail, /الشهر/);
  const applied = await engine.apply(ctx, 'revenues', { runId: up.runId, confirmToken: pv.confirmToken });
  assert.equal(applied.updated, 1);
  const current = await row('ROUNDTRIP');
  assert.deepEqual([current.year, current.month, current.amount_halalas, current.net_amount_halalas, current.vat_halalas], [2025, 12, 23000, 20000, 3000]);
  await engine.undo(ctx, up.runId);
  assert.deepEqual(await row('ROUNDTRIP'), beforeRow);
  assert.ok(await db.get("SELECT id FROM audit_log WHERE resource_id = ? AND action = 'update'", ['ROUNDTRIP']));
});

test('regression: year/month-only edits are changes; auto rows can only round-trip unchanged', async () => {
  await manual('PERIOD'); const r = await row('PERIOD');
  assert.deepEqual((await adapter.resolveRow(ctx, mapped(r, { year: 2025, month: 7 }))).changes, ['year', 'month']);
  await manual('AUTO', { auto: 1, rule_id: 'deliverable_delivered' }); const auto = await row('AUTO');
  assert.equal((await adapter.resolveRow(ctx, mapped(auto))).action, 'skip');
  await assert.rejects(adapter.resolveRow(ctx, mapped(auto, { year: 2025 })), /يتبع مصدره/);
  await assert.rejects(adapter.applyRow(ctx, mapped(auto, { amount: 23000 }), { action: 'update', existing: auto }), /يتبع مصدره/);
});

test('regression: both original and destination scope are checked; project sector must match', async () => {
  await manual('OUTSIDE', { sector_id: 'OTHER', project_id: 'P_OTHER' });
  await assert.rejects(adapter.resolveRow({ user: lead }, mapped(await row('OUTSIDE'), { sector: 'S', project: 'P_S' })), (e) => e.status === 403);
  await assert.rejects(adapter.resolveRow(ctx, mapped(await row('PERIOD'), { project: 'P_OTHER' })), /لا يطابق/);
});

test('regression: nonstandard VAT and intervening edits are preserved, not overwritten', async () => {
  await manual('EXEMPT', { net_amount_halalas: 11500, vat_halalas: 0 }); const r = await row('EXEMPT');
  await assert.rejects(adapter.resolveRow(ctx, mapped(r, { amount: 23000 })), /ضريبية خاصة/);
  const m = mapped(r, { month: 2 }); const result = await adapter.applyRow(ctx, m, await adapter.resolveRow(ctx, m));
  assert.equal(result.after.net_amount_halalas, 11500); assert.equal(result.after.vat_halalas, 0);
  await db.update('revenue_line', r.id, { label: 'تعديل لاحق' });
  await assert.rejects(adapter.undoRow(ctx, { resource_id: r.id, action: 'update', before: r, after: result.after }), /تغيّر السطر/);
  assert.equal((await row(r.id)).label, 'تعديل لاحق');
});

test('regression: sale year/import time do not determine delivery revenue; partial conflicts stop', () => {
  assert.deepEqual(recognitionPeriod({ year: 2026, month: 3, sold_year: 2025, created_at: '2025-01-01' }), { year: 2026, month: 3, source: 'explicit' });
  assert.deepEqual(recognitionPeriod({ year: 2025, month: 12, delivered_at: stamp }), { year: 2025, month: 12, source: 'explicit' });
  assert.throws(() => recognitionPeriod({ year: 2025, delivered_at: stamp }), /تختلف/);
  assert.throws(() => recognitionPeriod({ created_at: stamp, updated_at: stamp }), /غير موثقة/);
  assert.throws(() => recognitionPeriod({ delivered_at: '2026-02-30' }), /غير موثقة/);
});

test('regression: quality review is scoped, read-only and does not silently move historical revenue', async () => {
  await db.insert('deliverable', { id: 'UNKNOWN', project_id: 'P_S', sector_id: 'S', name_ar: 'مخرج قديم',
    amount_halalas: 11500, status: 'DELIVERED', created_at: stamp });
  await manual('UNKNOWN', { deliverable_id: 'UNKNOWN', auto: 1 });
  await manual('MISSING_TAX', { net_amount_halalas: null, vat_halalas: null });
  const beforeRows = await db.all('SELECT * FROM revenue_line ORDER BY id');
  const d = await revenueReview(lead, { year: 2026 });
  assert.ok(d.rows.find((r) => r.id === 'UNKNOWN').reasons.some((s) => s.includes('غير موثقة')));
  assert.ok(!d.rows.some((r) => r.id === 'OUTSIDE'));
  assert.equal(d.rows.find((r) => r.id === 'MISSING_TAX').estimatedNet, true);
  assert.ok(d.rows.find((r) => r.id === 'MISSING_TAX').reasons.some((s) => s.includes('غير مكتمل')));
  assert.equal((await revenueReview(lead, { year: 2026, sector: 'OTHER' })).total, 0);
  assert.deepEqual(await db.all('SELECT * FROM revenue_line ORDER BY id'), beforeRows);
  await assert.rejects(revenueReview({ id: 'viewer', role_id: 'employee', scope: 'own' }), (e) => e.status === 403);
});
