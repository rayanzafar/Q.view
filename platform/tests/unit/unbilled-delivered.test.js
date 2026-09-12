// وحدة: «المسلَّم غير المفوتَر» (unbilledDelivered) و«المتبقي المتعاقد عليه» (backlog) بحالاتٍ مختارة.
// المخرَج المسلَّم أو المعتمَد بمبلغٍ موجب يدخل الصفّ ما لم يُختم بـ invoiced_at أو يُربط بسطر
// فاتورةٍ في فاتورةٍ حيّة. والفاتورة الملغاة أو المحذوفة لا تُخرجه — إلغاؤها إعادةٌ إلى الانتظار.
// وسنةُ المخرَج وشهرُه يُقرآن بسلسلة الاعتراف (المخزَّن ثم القبول ثم التسليم ثم آخر تغيير حالة
// ثم الإنشاء)، فصفٌّ بلا شهرٍ مخزَّن ينسب إلى شهر حدثه لا يسقط. و`linked_count` حارس التغطية.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-unbilled-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { unbilledDelivered, invoicedNet, backlog } = await import('../../src/core/reports/metrics.js');

const T = '2026-01-10T08:00:00.000Z';
const dlv = (id, x) => insert('deliverable', { id, project_id: 'P1', sector_id: 'S1', name_ar: id,
  amount_halalas: 100_000, month: 3, year: 2026, status: 'DELIVERED', created_at: T, ...x });

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, sort_order: 2, created_at: T });
  await insert('project', { id: 'P1', name_ar: 'مشروع أ', sector_id: 'S1', created_at: T });
  await insert('project', { id: 'P2', name_ar: 'مشروع القطاع من المشروع', sector_id: 'S1', created_at: T });
  await insert('project', { id: 'PS2', name_ar: 'مشروع قطاع ب', sector_id: 'S2', created_at: T });

  // (أ) ما يُحتسب: مسلَّم ومعتمَد بمبلغ — وما لا يُحتسب: بقية الحالات وبلا مبلغ ومحذوف
  await dlv('D-dlv', { amount_halalas: 300_000 });
  await dlv('D-acc', { amount_halalas: 200_000, status: 'ACCEPTED' });
  await dlv('D-pending', { amount_halalas: 900_000, status: 'PENDING' });
  await dlv('D-rejected', { amount_halalas: 900_000, status: 'REJECTED' });
  await dlv('D-zero', { amount_halalas: 0 });
  await dlv('D-deleted', { amount_halalas: 900_000, deleted_at: '2026-04-01T00:00:00.000Z' });
  await dlv('D-2025', { amount_halalas: 900_000, year: 2025 });
  await dlv('D-s2', { amount_halalas: 115_000, sector_id: 'S2', project_id: 'PS2' });

  // (ب) الربط بسطر فاتورة: الحيّة تُخرج، والملغاة والمحذوفة لا
  await dlv('D-inv-live', { amount_halalas: 400_000 });
  await dlv('D-inv-cancelled', { amount_halalas: 500_000 });
  await dlv('D-inv-deleted', { amount_halalas: 600_000 });
  await insert('invoice', { id: 'I-live', code: 'F-1', project_id: 'P1', sector_id: 'S1',
    amount_halalas: 400_000, status: 'ISSUED', created_at: T });
  await insert('invoice', { id: 'I-cancelled', code: 'F-2', project_id: 'P1', sector_id: 'S1',
    amount_halalas: 500_000, status: 'CANCELLED', created_at: T });
  await insert('invoice', { id: 'I-deleted', code: 'F-3', project_id: 'P1', sector_id: 'S1',
    amount_halalas: 600_000, status: 'ISSUED', created_at: T, deleted_at: '2026-04-01T00:00:00.000Z' });
  await insert('invoice_line', { id: 'IL-live', invoice_id: 'I-live', deliverable_id: 'D-inv-live',
    label: 'سطر', amount_halalas: 400_000 });
  await insert('invoice_line', { id: 'IL-cancelled', invoice_id: 'I-cancelled', deliverable_id: 'D-inv-cancelled',
    label: 'سطر', amount_halalas: 500_000 });
  await insert('invoice_line', { id: 'IL-deleted', invoice_id: 'I-deleted', deliverable_id: 'D-inv-deleted',
    label: 'سطر', amount_halalas: 600_000 });

  // (ج) ختم invoiced_at وحده يُخرج
  await dlv('D-stamped', { amount_halalas: 700_000, invoiced_at: '2026-03-20T00:00:00.000Z' });

  // (د) قطاعٌ على المشروع وحده (المخرَج بلا sector_id)
  await dlv('D-viaproject', { amount_halalas: 250_000, sector_id: null, project_id: 'P2' });

  // (هـ) نافذة الأشهر: شهرٌ آخر، وصفٌّ بلا شهرٍ مخزَّن ينسب إلى شهر تسليمه
  await dlv('D-m7', { amount_halalas: 800_000, month: 7 });
  await dlv('D-nomonth-jul', { amount_halalas: 900_000, month: null, year: null,
    delivered_at: '2026-07-05T00:00:00.000Z' });

  // فواتير «المفوتَر»: الصادرة وما بعدها تُحسب، والمسودّة والملغاة والمحذوفة لا.
  // (I-live و I-cancelled و I-deleted أعلاه من هذه القاعدة نفسها: الأولى وحدها تُحسب.)
  const inv = (id, x) => insert('invoice', { id, code: id, project_id: 'P1', sector_id: 'S1',
    amount_halalas: 115_000, status: 'ISSUED', issue_date: '2026-03-15', created_at: T, ...x });
  await inv('I-paid', { amount_halalas: 230_000, status: 'PAID' });
  await inv('I-stored-net', { amount_halalas: 999_999, net_amount_halalas: 400_000 }); // صافيه المسجَّل يسبق الاشتقاق
  await inv('I-draft', { amount_halalas: 900_000, status: 'DRAFT' });
  await inv('I-overdue-jul', { amount_halalas: 345_000, status: 'OVERDUE', issue_date: '2026-07-02' });
  await inv('I-nodate-jan', { amount_halalas: 115_000, issue_date: null }); // بلا تاريخ إصدار ⇒ تاريخ إنشائها (يناير)
  await inv('I-2025', { amount_halalas: 900_000, issue_date: '2025-03-15' });
  await inv('I-s2-proj', { amount_halalas: 115_000, sector_id: null, project_id: 'PS2' }); // قطاعها من مشروعها

  // عقود «المتبقي المتعاقد عليه» + الإيراد المعترف به
  await insert('contract', { id: 'K-active', code: 'CT-1', project_id: 'P1', sector_id: 'S1',
    value_halalas: 2_300_000, net_value_halalas: 2_000_000, status: 'ACTIVE', created_at: T });
  await insert('contract', { id: 'K-draft', code: 'CT-2', project_id: 'P1', sector_id: 'S1',
    value_halalas: 1_150_000, net_value_halalas: 1_000_000, status: 'DRAFT', created_at: T });
  await insert('contract', { id: 'K-s2', code: 'CT-3', project_id: 'PS2', sector_id: 'S2',
    value_halalas: 115_000, net_value_halalas: 100_000, status: 'ACTIVE', created_at: T });
  // القطاع أ: إيرادٌ معترف به 1,200,000 صافياً — أقلّ من المتعاقد عليه
  await insert('revenue_line', { id: 'RL-1', sector_id: 'S1', year: 2026, month: 3,
    amount_halalas: 1_380_000, net_amount_halalas: 1_200_000, created_at: T });
  // القطاع ب: معترفٌ به أكثر من قيمة عقده — المتبقي صفر لا سالب
  await insert('revenue_line', { id: 'RL-2', sector_id: 'S2', year: 2026, month: 3,
    amount_halalas: 575_000, net_amount_halalas: 500_000, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// المجموع المتوقَّع للقطاع أ سنة 2026 (السنة كلها):
//   300 + 200 (مسلَّم/معتمَد) + 500 (فاتورة ملغاة) + 600 (فاتورة محذوفة)
// + 250 (قطاعه من مشروعه) + 800 (يوليو) + 900 (بلا شهر، يوليو من تسليمه) = 3,550,000
const YEAR_TOTAL = 3_550_000;

test('يُجمع المسلَّم والمعتمَد بمبلغٍ موجب وحدهما — وما عداهما خارج', async () => {
  const u = await unbilledDelivered('S1', 2026);
  assert.equal(u.unbilled_halalas, YEAR_TOTAL);
  assert.equal(u.count, 7);
  // لو دخلت «قيد الإعداد» أو «المرفوض» أو «المحذوف» لقفز الرقم 900,000 لكلٍّ منها
  const s2 = await unbilledDelivered('S2', 2026);
  assert.equal(s2.unbilled_halalas, 115_000);
  assert.equal(s2.count, 1);
  // والصافي يعود مع الإجمالي بقاعدة فصل الضريبة نفسها التي يُقرأ بها الإيراد المتحقّق —
  // فمن قارن الرقمين في بطاقةٍ واحدة قارن صافياً بصافٍ: ١١٥٬٠٠٠ إجمالياً = ١٠٠٬٠٠٠ صافياً.
  assert.equal(s2.unbilled_net_halalas, 100_000);
  assert.equal(u.unbilled_net_halalas, Math.trunc(300_000 * 100 / 115) + Math.trunc(200_000 * 100 / 115)
    + Math.trunc(500_000 * 100 / 115) + Math.trunc(600_000 * 100 / 115) + Math.trunc(250_000 * 100 / 115)
    + Math.trunc(800_000 * 100 / 115) + Math.trunc(900_000 * 100 / 115));
  assert.ok(u.unbilled_net_halalas < u.unbilled_halalas);
});

test('الفاتورة الحيّة تُخرج المخرَج، والملغاة أو المحذوفة تُبقيه في الصفّ', async () => {
  const u = await unbilledDelivered('S1', 2026);
  // 400,000 (الفاتورة الحيّة) ليست في المجموع، و500,000 + 600,000 فيه
  assert.equal(u.unbilled_halalas, YEAR_TOTAL);
  assert.equal(YEAR_TOTAL - 500_000 - 600_000, 2_450_000);
});

test('ختمُ الفوترة على المخرَج وحده يُخرجه ولو بلا سطر فاتورة', async () => {
  const u = await unbilledDelivered('S1', 2026);
  assert.equal(u.unbilled_halalas, YEAR_TOTAL); // 700,000 المختومة خارج المجموع
});

test('المخرَج بلا قطاعٍ يتبع قطاع مشروعه', async () => {
  const u = await unbilledDelivered('S1', 2026, { months: [3] });
  // مارس: 300+200+500+600+250 = 1,850,000 — و250 منها جاءت بقطاع المشروع
  assert.equal(u.unbilled_halalas, 1_850_000);
  assert.equal(u.count, 5);
});

test('نافذة الأشهر تقصّ، والصفّ بلا شهرٍ مخزَّن ينسب إلى شهر حدثه', async () => {
  const jul = await unbilledDelivered('S1', 2026, { months: [7] });
  assert.equal(jul.unbilled_halalas, 1_700_000); // 800 (يوليو مخزَّن) + 900 (يوليو من التسليم)
  assert.equal(jul.count, 2);
  const both = await unbilledDelivered('S1', 2026, { months: [3, 7] });
  assert.equal(both.unbilled_halalas, YEAR_TOTAL); // لا صفّ خارج الشهرين في هذه السنة
  const may = await unbilledDelivered('S1', 2026, { months: [5] });
  assert.equal(may.unbilled_halalas, 0);
  assert.equal(may.count, 0);
  const none = await unbilledDelivered('S1', 2026, { months: [] });
  assert.deepEqual(none, { unbilled_halalas: 0, unbilled_net_halalas: 0, count: 0, linked_count: 0 });
  const bad = await unbilledDelivered('S1', 2026, { months: [0, 13, 'x'] });
  assert.equal(bad.unbilled_halalas, 0);
});

test('حارس التغطية: صفرٌ حين لا ربط بفوترة أصلاً، وأكبرُ من صفر حين وُجد', async () => {
  const s1 = await unbilledDelivered('S1', 2026);
  assert.equal(s1.linked_count, 2); // الفاتورة الحيّة + المخرَج المختوم
  const s2 = await unbilledDelivered('S2', 2026);
  assert.equal(s2.linked_count, 0);
  const jul = await unbilledDelivered('S1', 2026, { months: [7] });
  assert.equal(jul.linked_count, 0); // الربط كله في مارس
});

test('سنةٌ بلا سجلّ: أصفار لا فراغ', async () => {
  const u = await unbilledDelivered('S1', 2024);
  assert.deepEqual(u, { unbilled_halalas: 0, unbilled_net_halalas: 0, count: 0, linked_count: 0 });
});

test('المتبقي المتعاقد عليه: المعترف به فوق المتعاقد عليه = صفر لا سالب', async () => {
  const b = await backlog('S2');
  assert.equal(b.contracted_halalas, 100_000);
  assert.equal(b.recognized_halalas, 500_000);
  assert.equal(b.backlog_halalas, 0);
});

test('حالات العقود تُختار: الموقَّع وحده يُسقط المسودّة', async () => {
  const def = await backlog('S1');
  assert.equal(def.contracted_halalas, 3_000_000);       // موقَّع + مسودّة
  assert.equal(def.contracted_gross_halalas, 3_450_000);
  assert.equal(def.backlog_halalas, 3_000_000 - 1_200_000);
  const active = await backlog('S1', { statuses: ['ACTIVE'] });
  assert.equal(active.contracted_halalas, 2_000_000);    // بلا المسودّة
  assert.equal(active.backlog_halalas, 2_000_000 - 1_200_000);
});

// فواتير القطاع أ سنة 2026 المحسوبة خمس: I-live (400,000 صادرة، بلا تاريخ إصدار ⇒ يناير من
// إنشائها) + I-nodate-jan (115,000 يناير) + I-paid (230,000 مارس) + I-stored-net (999,999 مارس
// بصافٍ مسجَّل 400,000) + I-overdue-jul (345,000 يوليو).
const derived = (g) => Math.trunc(g * 100 / 115); // اشتقاق الصافي حين لا صافي مسجَّل

test('المفوتَر: المسودّة والملغاة والمحذوفة خارج، وما صدر داخل', async () => {
  const iv = await invoicedNet('S1', 2026);
  assert.equal(iv.count, 5);
  assert.equal(iv.invoiced_halalas, 400_000 + 115_000 + 230_000 + 999_999 + 345_000);
  // لو دخلت المسودّة أو الملغاة أو المحذوفة لزاد العدد ولقفز الإجمالي بمبالغها (900+500+600 ألفاً)
  const s2 = await invoicedNet('S2', 2026);
  assert.equal(s2.count, 1);                    // I-s2-proj — قطاعها جاء من مشروعها
  assert.equal(s2.invoiced_halalas, 115_000);
  assert.equal(s2.invoiced_net_halalas, 100_000);
  const y2025 = await invoicedNet('S1', 2025);
  assert.equal(y2025.count, 1);                 // I-2025 خارج 2026 بسنتها وحدها — وهي قائمة في سنتها
  assert.equal(y2025.invoiced_halalas, 900_000);
  assert.deepEqual(await invoicedNet('S1', 2024), { invoiced_net_halalas: 0, invoiced_halalas: 0, count: 0 });
});

test('المفوتَر: الصافي المسجَّل يسبق الاشتقاق، وما لا صافي له يُشتقّ ١٠٠/١١٥', async () => {
  const iv = await invoicedNet('S1', 2026);
  assert.equal(iv.invoiced_net_halalas,
    derived(400_000) + derived(115_000) + derived(230_000) + 400_000 + derived(345_000));
  // لو أُهمل الصافي المسجَّل لصار نصيب I-stored-net 869,564 بدل 400,000
  assert.notEqual(iv.invoiced_net_halalas,
    derived(400_000) + derived(115_000) + derived(230_000) + derived(999_999) + derived(345_000));
  assert.ok(iv.invoiced_net_halalas < iv.invoiced_halalas);
});

test('المفوتَر: نافذة الأشهر تقصّ، وبلا تاريخ إصدارٍ يُنسب إلى شهر إنشائه', async () => {
  const mar = await invoicedNet('S1', 2026, { months: [3] });
  assert.equal(mar.count, 2);                   // I-paid + I-stored-net
  assert.equal(mar.invoiced_halalas, 230_000 + 999_999);
  assert.equal(mar.invoiced_net_halalas, derived(230_000) + 400_000);
  const jul = await invoicedNet('S1', 2026, { months: [7] });
  assert.equal(jul.count, 1);
  assert.equal(jul.invoiced_halalas, 345_000);
  const jan = await invoicedNet('S1', 2026, { months: [1] });
  assert.equal(jan.count, 2);                   // الفاتورتان بلا تاريخ إصدار ⇒ شهر إنشائهما
  assert.equal(jan.invoiced_halalas, 400_000 + 115_000);
  const may = await invoicedNet('S1', 2026, { months: [5] });
  assert.deepEqual(may, { invoiced_net_halalas: 0, invoiced_halalas: 0, count: 0 });
  assert.deepEqual(await invoicedNet('S1', 2026, { months: [] }),
    { invoiced_net_halalas: 0, invoiced_halalas: 0, count: 0 });
  // مجموع الأشهر الثلاثة = السنة كلها: لا فاتورة خارج يناير ومارس ويوليو
  assert.equal(jan.count + mar.count + jul.count, (await invoicedNet('S1', 2026)).count);
});
