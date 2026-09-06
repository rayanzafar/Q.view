import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'sanad-targets-'));
process.env.DATABASE_URL = '';
process.env.SANAD_DB = join(dir, 'test.db');
const root = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) execFileSync(process.execPath, ['--experimental-sqlite', join(root, s)], { env: process.env, stdio: 'ignore' });
const { insert, get, all, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { sectorTargets, saveSectorTargets } = await import('../../src/modules/org/sector-targets.js');
const { companyOverview, sectorDashboard, pipelineCoverage } = await import('../../src/core/reports/metrics.js');
const { sectorTargetsPage } = await import('../../src/web/views/sector-targets.js');
const { updateSector } = await import('../../src/modules/org/org.js');
const admin = { id: 'admin-targets', username: 'admin-targets', role_id: 'admin', scope: 'company' };
const lead = { id: 'lead-targets', username: 'lead-targets', role_id: 'sector_lead', scope: 'sector', sector_id: 'A' };
const ctx = { user: lead };
for (const sid of ['A', 'B']) await insert('sector', { id: sid, name_ar: sid, active: 1, created_at: '2026-01-01', target_sales_halalas: 9900, target_revenue_halalas: 8800 });
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });
const payload = (year, more = {}) => ({ year, revision: 0, target_sales_sar: '100.25', target_revenue_sar: '80.10', reason: 'خطة سنوية معتمدة', ...more });
test('legacy targets stay unchanged and are not assigned to every year', async () => {
  const d = await sectorTargets(lead, { sector: 'A', year: 2025 });
  assert.equal(d.status, 'missing'); assert.equal(d.budget, null); assert.equal(d.legacy.target_sales_halalas, 9900);
  assert.equal((await sectorDashboard(lead, 'A', { year: 2025 })).target_sales_halalas, null);
  assert.equal((await pipelineCoverage('A', 2025)).remaining_target_halalas, null);
  assert.equal((await companyOverview(admin, { year: 2025 })).totals.target_sales, null);
});
test('annual writes preserve other years, decimals, legacy fields and audit history', async () => {
  const first = await saveSectorTargets(ctx, 'A', payload(2025));
  assert.equal(first.budget.target_sales_halalas, 10025); assert.equal(first.budget.revision, 1);
  await saveSectorTargets(ctx, 'A', payload(2026));
  const second = await saveSectorTargets(ctx, 'A', payload(2026, { revision: 1, target_sales_sar: '0', reason: 'مراجعة المستهدف السنوي' }));
  assert.equal(second.budget.target_sales_halalas, 0); assert.equal(second.history.length, 2);
  const changed = second.history.find((r) => r.revision === 2);
  assert.equal(changed.before.target_sales_halalas, 10025); assert.equal(changed.after.target_sales_halalas, 0); assert.equal(changed.actor, lead.username);
  assert.equal((await sectorTargets(lead, { sector: 'A', year: 2025 })).budget.target_sales_halalas, 10025);
  assert.equal((await get("SELECT target_sales_halalas FROM sector WHERE id='A'")).target_sales_halalas, 9900);
  assert.equal((await sectorDashboard(lead, 'A', { year: 2025 })).target_sales_halalas, 10025);
  assert.equal((await sectorDashboard(lead, 'A', { year: 2026 })).target_sales_halalas, 0);
});
test('cross-sector, invalid money/year/reason and stale edits cannot mutate target', async () => {
  await assert.rejects(() => sectorTargets(lead, { sector: 'B', year: 2026 }), (e) => e.code === 'forbidden');
  await assert.rejects(() => saveSectorTargets(ctx, 'B', payload(2026)), (e) => e.code === 'forbidden');
  for (const patch of [{ year: '2026abc' }, { reason: '' }, { target_sales_sar: '-1' }, { target_sales_sar: '1.111' }, { revision: 1 }])
    await assert.rejects(() => saveSectorTargets(ctx, 'A', payload(2026, patch)), (e) => e.code === 'bad_request');
  assert.equal((await sectorTargets(lead, { sector: 'A', year: 2026 })).budget.revision, 2);
  await assert.rejects(() => updateSector({ user: admin }, 'A', { target_sales_sar: 100 }), (e) => e.code === 'bad_request');
});
test('duplicate annual budgets remain intact and surface an explicit conflict', async () => {
  for (const id of ['dup1', 'dup2']) await insert('budget', { id, sector_id: 'B', fiscal_year: 2026, target_sales_halalas: 300, created_at: '2026-01-01' });
  const d = await sectorTargets(admin, { sector: 'B', year: 2026 });
  assert.equal(d.status, 'conflict'); assert.equal(d.budget, null); assert.equal(d.can_edit, false);
  await assert.rejects(() => saveSectorTargets({ user: admin }, 'B', payload(2026)), (e) => e.code === 'bad_request');
  assert.equal((await all("SELECT * FROM budget WHERE sector_id='B'")).length, 2);
  assert.equal((await companyOverview(admin, { year: 2026 })).totals.target_sales, null);
});
test('SSR includes selected year, legacy warning, revision and escaped audit content', async () => {
  await saveSectorTargets(ctx, 'A', payload(2027, { reason: '<script>alert(1)</script>' }));
  const html = await sectorTargetsPage(lead, { sector: 'A', year: 2027 });
  assert.match(html, /data-year="2027"/); assert.match(html, /data-revision="1"/);
  assert.match(html, /قيم قديمة تحتاج تحديد السنة/); assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});
test('concurrent new-year saves produce one annual row and one audit revision', async () => {
  const outcomes = await Promise.allSettled([
    saveSectorTargets(ctx, 'A', payload(2028, { target_sales_sar: '110' })),
    saveSectorTargets(ctx, 'A', payload(2028, { target_sales_sar: '120' })),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
  const rows = await all("SELECT * FROM budget WHERE sector_id='A' AND fiscal_year=2028");
  assert.equal(rows.length, 1); assert.equal(rows[0].revision, 1);
  assert.equal((await sectorTargets(lead, { sector: 'A', year: 2028 })).history.length, 1);
});
test('public response excludes unrelated budget cost assumptions and preserves stored monthly plan', async () => {
  await insert('budget', { id: 'private-plan', sector_id: 'A', fiscal_year: 2029, target_sales_halalas: 1, target_revenue_halalas: 2,
    target_margin_pct: 42, cost_assumptions_json: '{"confidential":true}', monthly_json: '{"1":123}', created_at: '2026-01-01' });
  const d = await saveSectorTargets(ctx, 'A', payload(2029));
  assert.equal(d.budget.has_monthly_plan, true);
  assert.ok(!('cost_assumptions_json' in d.budget)); assert.ok(!('target_margin_pct' in d.budget));
  const row = await get("SELECT * FROM budget WHERE id='private-plan'");
  assert.equal(row.monthly_json, '{"1":123}'); assert.equal(row.target_margin_pct, 42); assert.equal(row.cost_assumptions_json, '{"confidential":true}');
});
test('generic targets page provides a scoped chooser and defaults only the permitted own sector', async () => {
  const adminHtml = await sectorTargetsPage(admin);
  assert.match(adminHtml, /اختر القطاع للبدء/);
  assert.match(adminHtml, /<option value="A"/); assert.match(adminHtml, /<option value="B"/);
  assert.match(adminHtml, /id="target-period-form"/); assert.match(adminHtml, /id="target-values"/);
  const leadHtml = await sectorTargetsPage(lead);
  assert.match(leadHtml, /<option value="A" selected/);
  assert.doesNotMatch(leadHtml, /<option value="B"/);
  await assert.rejects(() => sectorTargetsPage(lead, { sector: 'B' }), (e) => e.code === 'forbidden');
  await assert.rejects(() => sectorTargetsPage({ role_id: 'employee', scope: 'own', id: 'no-budget' }), (e) => e.code === 'forbidden');
});
