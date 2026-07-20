// وحدة: تركيبة "يحتاج انتباهك الآن" + مقاييس v3 — على قاعدة مصغّرة محكومة بالكامل.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-attn-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { attentionFeed } = await import('../../src/core/reports/attention.js');
const { revenueForecast, pipelineAging } = await import('../../src/core/reports/metrics.js');

const T = '2026-07-20';
before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع الاختبار', active: 1, sort_order: 1, created_at: T });
  await insert('stage', { id: 'OPEN1', name_ar: 'مؤهلة', default_win_pct: 40, sort_order: 2, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, sort_order: 9, is_won: 1, is_lost: 0 });
  await insert('client', { id: 'C1', name_ar: 'عميل', created_at: T });
  // فرصة راكدة (60 يوماً في مرحلتها) بلا خطوة تالية + فرصة حديثة
  await insert('opportunity', { id: 'O1', title_ar: 'فرصة راكدة', sector_id: 'S1', stage_id: 'OPEN1', win_pct: 50, value_halalas: 100000000, year: 2026, stage_changed_at: '2026-05-01T00:00:00Z', created_at: '2026-05-01T00:00:00Z' });
  await insert('opportunity', { id: 'O2', title_ar: 'فرصة نشطة', sector_id: 'S1', stage_id: 'OPEN1', win_pct: 50, value_halalas: 50000000, year: 2026, next_action: 'اجتماع', stage_changed_at: '2026-07-15T00:00:00Z', created_at: '2026-07-15T00:00:00Z' });
  // فاتورة متأخرة
  await insert('invoice', { id: 'I1', sector_id: 'S1', client_id: 'C1', amount_halalas: 25000000, status: 'ISSUED', issue_date: '2026-05-01', due_date: '2026-06-01', created_at: T });
  // إيراد محقق 1000 ريال
  await insert('revenue_line', { id: 'R1', sector_id: 'S1', amount_halalas: 100000, month: 3, year: 2026, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('attentionFeed: يرصد الفاتورة المتأخرة والفرصة الراكدة بجمل عربية وإجراءات', async () => {
  const user = { id: 'u1', role_id: 'admin', scope: 'company' };
  const items = await attentionFeed(user, 'S1', { year: 2026, today: T });
  assert.ok(items.length >= 2, 'بندان على الأقل');
  const inv = items.find((i) => i.title.includes('متأخرة'));
  assert.ok(inv, 'بند الفواتير المتأخرة موجود');
  assert.ok(inv.title.includes('250,000'), 'المبلغ بالريال في الجملة: ' + inv.title);
  const stall = items.find((i) => i.title.includes('متوقفة'));
  assert.ok(stall, 'بند الفرص المتوقفة موجود');
  assert.ok(stall.action, 'لكل بند إجراء');
  assert.ok(items.length <= 7, 'لا يتجاوز 7 بنود');
});

test('revenueForecast = المحقق + المرجّح من الفرص المفتوحة', async () => {
  const fc = await revenueForecast('S1', 2026);
  assert.equal(fc.actual, 100000);
  // O1: 100000000×50% + O2: 50000000×50% = 75,000,000
  assert.equal(fc.weightedOpen, 75000000);
  assert.equal(fc.forecast, 75100000);
});

test('pipelineAging يوزّع الفرص على سلال العمر الصحيحة', async () => {
  const b = await pipelineAging('S1', T);
  const sixty = b.find((x) => x.key === '60+');
  const fresh = b.find((x) => x.key === '0-14');
  assert.equal(sixty.n, 1, 'الفرصة الراكدة في سلة 60+');
  assert.equal(fresh.n, 1, 'الفرصة الحديثة في سلة 0-14');
});
