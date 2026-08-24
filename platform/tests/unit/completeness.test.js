// وحدة: completenessScore — نِسَبٌ مسمّاة البسط والمقام، متوسط موزون 8/4/1، بندٌ بلا مقام يسقط
// من الوزن، وبنود الموارد المحجوبة تسقط لمن لا يقرؤها ويُعاد توزين الباقي (لا تسريب ولا غش).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-cmpl-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { completenessScore } = await import('../../src/core/reports/completeness.js');

const T = '2026-01-10T08:00:00.000Z';
before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  // فرصتان مفتوحتان: واحدة باحتمالٍ وخطوة، وواحدة عارية ⇒ البندان العاليان 50%
  await insert('opportunity', { id: 'O1', title_ar: 'أ', sector_id: 'S1', year: 2026, stage_id: 'LEAD',
    value_halalas: 1, win_pct: 40, next_action: 'اتصال', exclude_from_sales: 0, created_at: T });
  await insert('opportunity', { id: 'O2', title_ar: 'ب', sector_id: 'S1', year: 2026, stage_id: 'LEAD',
    value_halalas: 1, win_pct: null, next_action: null, exclude_from_sales: 0, created_at: T });
  // مشروعان في سنة 2026: واحد بتاريخ انتهاء ومخرج مؤرّخ، وآخر عارٍ ⇒ 50% و50%
  await insert('project', { id: 'P1', name_ar: 'مشروع أ', sector_id: 'S1', status: 'IN_PROGRESS',
    start_date: '2026-02-01', end_date: '2026-11-30', created_at: T });
  await insert('project', { id: 'P2', name_ar: 'مشروع ب', sector_id: 'S1', status: 'IN_PROGRESS',
    start_date: '2026-03-01', created_at: T });
  await insert('deliverable', { id: 'D1', project_id: 'P1', sector_id: 'S1', name_ar: 'مخرج',
    amount_halalas: 100, status: 'ACCEPTED', accepted_at: '2026-04-01T00:00:00.000Z', created_at: T });
  // موظفان نشطان: واحد بمسمى وتسكين ⇒ 50% و50%
  await insert('employee', { id: 'E1', name_ar: 'موظف أ', sector_id: 'S1', active: 1, job_title: 'استشاري', created_at: T });
  await insert('employee', { id: 'E2', name_ar: 'موظف ب', sector_id: 'S1', active: 1, created_at: T });
  await insert('allocation', { id: 'A1', employee_id: 'E1', person_name_ar: 'موظف أ', sector_id: 'S1',
    year: 2026, monthly_json: '{"8":1}', created_at: T });
  // فاتورة واحدة بلا استحقاق ⇒ inv_due صفر من واحد. ولا عقود أصلاً ⇒ con_signed يسقط.
  await insert('invoice', { id: 'I1', code: 'INV-1', sector_id: 'S1', amount_halalas: 100, status: 'ISSUED',
    issue_date: '2026-04-01', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const LEAD = { id: 'u-lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' };
const VIEWER = { id: 'u-view', role_id: 'viewer', sector_id: 'S1', scope: 'sector' };

test('البنود بأسمائها وبسطها ومقامها، والدرجة متوسطٌ موزون، وبند بلا مقام يسقط', async () => {
  const r = await completenessScore(LEAD, 'S1', { year: 2026 });
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.ok(!('con_signed' in by), 'لا عقود ⇒ البند يسقط لا يصفر');
  assert.deepEqual([by.opp_win_pct.num, by.opp_win_pct.den, by.opp_win_pct.pct], [1, 2, 50]);
  assert.deepEqual([by.prj_end_date.num, by.prj_end_date.den], [1, 2]);
  assert.deepEqual([by.prj_deliverables.num, by.prj_deliverables.den], [1, 2]);
  assert.deepEqual([by.dlv_dates.num, by.dlv_dates.den, by.dlv_dates.pct], [1, 1, 100]);
  assert.deepEqual([by.emp_job_title.num, by.emp_job_title.den], [1, 2]);
  assert.deepEqual([by.inv_due.num, by.inv_due.den, by.inv_due.pct], [0, 1, 0]);
  // الوزن: أربعة عالية(8)×50 + مؤرّخة(4)×100 + ثلاثة متوسطة(4)×50 + فاتورة(1)×0
  const wSum = 8 * 3 + 4 * 4 + 1;
  const wAcc = 8 * 50 * 3 + 4 * 100 + 4 * 50 * 3;
  assert.equal(r.score, Math.round(wAcc / wSum));
  for (const it of r.items) {
    assert.ok(it.label && it.hint && it.href, it.id);
    assert.ok(Number.isInteger(it.num) && Number.isInteger(it.den) && it.den > 0, it.id);
  }
});

test('من لا يقرأ الفواتير والموظفين تسقط بنودها ويُعاد التوزين — والدرجة تبقى 0-100', async () => {
  const r = await completenessScore(VIEWER, 'S1', { year: 2026 });
  const ids = r.items.map((i) => i.id);
  assert.ok(!ids.includes('inv_due') && !ids.includes('con_signed'), 'المالية ساقطة');
  assert.ok(r.score >= 0 && r.score <= 100);
  // الفرص والمشاريع حاضرة لمن يقرؤها
  assert.ok(ids.includes('opp_win_pct') && ids.includes('prj_end_date'));
});

test('قطاع بلا أي بيانات ⇒ درجة null لا صفر مخيف', async () => {
  await insert('sector', { id: 'S0', name_ar: 'فارغ', active: 1, sort_order: 9, created_at: T });
  const r = await completenessScore(LEAD, 'S0', { year: 2026 });
  assert.equal(r.score, null);
  assert.equal(r.items.length, 0);
});
