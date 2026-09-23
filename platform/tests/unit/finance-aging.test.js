// وحدة: arAging — سلال أعمار المستحقات + مرشّح القطاع الاختياري الجديد {sector}
// (قطاع الفاتورة نفسه أو قطاع مشروعها عبر COALESCE) دون تغيير سلوك المستدعين الحاليين.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-aging-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { arAging } = await import('../../src/modules/finance/finance.js');

const T = '2026-01-10T08:00:00.000Z';
// تواريخ إصدار نسبية لساعة التشغيل (arAging يقيس منذ الإصدار بساعة الحائط) — نثبّت العمر لا التاريخ
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, sort_order: 2, created_at: T });
  await insert('project', { id: 'P1', name_ar: 'مشروع أ', sector_id: 'S1', status: 'IN_PROGRESS', created_at: T });
  // S1 مباشرة: عمرها ~10 أيام → سلة 0-30
  await insert('invoice', { id: 'I1', sector_id: 'S1', amount_halalas: 1_000_000, status: 'ISSUED', issue_date: daysAgo(10), created_at: T });
  // بلا قطاع لكن مشروعها S1 (مسار COALESCE): عمرها ~45 يوماً → سلة 31-60
  await insert('invoice', { id: 'I2', sector_id: null, project_id: 'P1', amount_halalas: 700_000, status: 'ISSUED', issue_date: daysAgo(45), created_at: T });
  // قطاع آخر: عمرها ~100 يوم → سلة 90+ في الإجمالي فقط
  await insert('invoice', { id: 'I3', sector_id: 'S2', amount_halalas: 500_000, status: 'ISSUED', issue_date: daysAgo(100), created_at: T });
  // تحصيل جزئي على I1 — السلة تحمل المتبقي لا كامل المبلغ
  await insert('collection', { id: 'K1', invoice_id: 'I1', amount_halalas: 400_000, collected_at: daysAgo(2), created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const FIN = { id: 'u-fin', role_id: 'ceo_office', scope: 'company' };
// حول رأس السنة قد تتوزع تواريخ الإصدار على سنتين ماليتين — نجمع السلال عبر السنوات المعنية
// حتى يبقى الاختبار حتمياً في أي يوم تشغيل (الأعمار 10/45/100 تقع دائماً في سلال متمايزة).
const YEARS = [...new Set([daysAgo(10), daysAgo(45), daysAgo(100)].map((d) => Number(d.slice(0, 4))))];
const agg = async (opts) => {
  const out = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const y of YEARS) {
    const b = await arAging(FIN, y, opts);
    for (const k of Object.keys(out)) out[k] += b[k];
  }
  return out;
};

test('arAging بدون مرشّح: سلوك المستدعين الحاليين كما هو (كل القطاعات)', async () => {
  const b = await agg(undefined);
  assert.equal(b['0-30'], 600_000);   // I1: 1,000,000 − 400,000 محصّلة
  assert.equal(b['31-60'], 700_000);  // I2 عبر مشروعها
  assert.equal(b['90+'], 500_000);    // I3 قطاع ب
});

test('arAging مع {sector}: فواتير القطاع نفسه + فواتير مشاريعه فقط', async () => {
  const b = await agg({ sector: 'S1' });
  assert.equal(b['0-30'], 600_000);
  assert.equal(b['31-60'], 700_000, 'فاتورة بلا قطاع لكن مشروعها في S1 يجب أن تُحتسب (COALESCE)');
  assert.equal(b['61-90'], 0);
  assert.equal(b['90+'], 0, 'فاتورة القطاع الآخر تسرّبت إلى مرشّح S1');
});

test('arAging مع قطاع آخر: فاتورته العتيقة فقط، لا شيء من S1', async () => {
  const b = await agg({ sector: 'S2' });
  assert.equal(b['0-30'] + b['31-60'] + b['61-90'], 0);
  assert.equal(b['90+'], 500_000);
});
