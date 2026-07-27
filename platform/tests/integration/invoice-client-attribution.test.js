// تكامل: «لمن هذه الفاتورة؟» — إجابة واحدة على الشاشات الثلاث.
//
// قبل الإصلاح كان لكل شاشة قاعدتها الخاصة في نسبة الفاتورة إلى عميل:
//   • قائمة العملاء وصفحة العميل 360: عميل الفاتورة، وإن غاب فعميل مشروعها.
//   • شاشة المالية (financeByClient): عميلُ **العقد** — فتنسب الفاتورة إلى عميل غير المكتوب
//     عليها، وتُسقط تماماً كل فاتورة بلا عقد.
// فيقرأ المسؤول ثلاثة أرقام لعميل واحد حسب الصفحة التي فتحها. هذه الاختبارات تثبّت القاعدة
// الواحدة (عميل الفاتورة ثم عميل مشروعها، والمشروع المحذوف لا ينسب فاتورته إلى أحد) وتثبت
// أنها هي نفسها التي يكتبها مسار المستخلص عند إصدار فاتورة من عقد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-inv-attr-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, get, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { financeByClient, createProgressClaim } = await import('../../src/modules/finance/finance.js');
const { listClients, clientOverview } = await import('../../src/modules/clients/clients.js');

const T = '2026-01-10T08:00:00.000Z';
const day = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

const FIN = { id: 'u_fin', username: 'demo.finance', role_id: 'finance', sector_id: null, scope: 'company', projectIds: new Set() };
const CTX = { user: FIN, ip: '127.0.0.1' };

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('app_user', { id: 'u_pm', username: 'pm', name_ar: 'مدير المشروع', role_id: 'project_manager',
    sector_id: 'S1', scope: 'project', active: 1, created_at: T });
  await insert('client', { id: 'CX', code: 'CL-X', name_ar: 'العميل المكتوب على الفاتورة', type: 'حكومي', active: 1, created_at: T });
  await insert('client', { id: 'CY', code: 'CL-Y', name_ar: 'عميل العقد', type: 'خاص', active: 1, created_at: T });
  await insert('client', { id: 'CZ', code: 'CL-Z', name_ar: 'عميل المستخلص', type: 'خاص', active: 1, created_at: T });

  // P1 يخصّ CY — والفاتورة المرفوعة عليه تحمل CX صراحةً: التعارض الذي يفرّق القواعد الثلاث
  await insert('project', { id: 'P1', name_ar: 'مشروع العقد', client_id: 'CY', sector_id: 'S1',
    status: 'IN_PROGRESS', start_date: day(70), created_at: T });
  await insert('project', { id: 'P2', name_ar: 'مشروع العميل', client_id: 'CX', sector_id: 'S1',
    status: 'IN_PROGRESS', start_date: day(60), created_at: T });
  // مشروع محذوف: فاتورته بلا عميل ⇒ لا تُنسب إلى أحد، ولا تصنع «آخر تواصل» وهمياً
  await insert('project', { id: 'P3', name_ar: 'مشروع محذوف', client_id: 'CX', sector_id: 'S1',
    status: 'IN_PROGRESS', start_date: day(2), deleted_at: T, created_at: T });
  await insert('project', { id: 'PZ', name_ar: 'مشروع المستخلص', client_id: 'CZ', sector_id: 'S1',
    owner_user_id: 'u_pm', status: 'IN_PROGRESS', start_date: day(65), created_at: T });

  await insert('contract', { id: 'TX', code: 'CT-X', client_id: 'CX', sector_id: 'S1',
    value_halalas: 1_000_000, status: 'ACTIVE', signed_at: day(50), created_at: T });
  await insert('contract', { id: 'TY', code: 'CT-Y', client_id: 'CY', project_id: 'P1', sector_id: 'S1',
    value_halalas: 2_000_000, status: 'ACTIVE', signed_at: day(45), created_at: T });
  await insert('contract', { id: 'TZ', code: 'CT-Z', client_id: 'CZ', project_id: 'PZ', sector_id: 'S1',
    value_halalas: 3_000_000, status: 'ACTIVE', signed_at: day(55), created_at: T });

  // الفاتورة تحمل CX بينما عقدها ومشروعها يخصّان CY
  await insert('invoice', { id: 'INV1', code: 'INV-1', client_id: 'CX', contract_id: 'TY', project_id: 'P1',
    sector_id: 'S1', amount_halalas: 500_000, status: 'ISSUED', issue_date: day(40), due_date: day(-10), created_at: T });
  // فاتورة قديمة بلا عميل وبلا عقد: مشروعها وحده يدلّ عليها (وكانت تسقط تماماً من شاشة المالية)
  await insert('invoice', { id: 'INV2', code: 'INV-2', client_id: null, project_id: 'P2',
    sector_id: 'S1', amount_halalas: 300_000, status: 'ISSUED', issue_date: day(30), due_date: day(-20), created_at: T });
  // فاتورة بلا عميل ومشروعها محذوف: بلا نسبة
  await insert('invoice', { id: 'INV3', code: 'INV-3', client_id: null, project_id: 'P3',
    sector_id: 'S1', amount_halalas: 900_000, status: 'ISSUED', issue_date: day(1), due_date: day(-5), created_at: T });
  await insert('collection', { id: 'K1', invoice_id: 'INV1', amount_halalas: 200_000, collected_at: day(20), created_at: T });

  await insert('deliverable', { id: 'DZ', project_id: 'PZ', name_ar: 'مخرج المستخلص',
    amount_halalas: 400_000, status: 'DELIVERED', sector_id: 'S1', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const byId = (rows, id) => rows.find((r) => r.id === id);

test('شاشة المالية تنسب الفاتورة إلى عميلها المكتوب لا إلى عميل عقدها', async () => {
  const rows = await financeByClient(FIN);
  const cx = byId(rows, 'CX'), cy = byId(rows, 'CY');
  assert.ok(cx && cy, 'العميلان في الجدول (لكلٍّ عقد)');
  assert.equal(cx.invoiced_halalas, 800_000, 'قبل الإصلاح صفر: لا فاتورة على عقد CX');
  assert.equal(cx.collected_halalas, 200_000);
  assert.equal(cx.outstanding_halalas, 600_000);
  assert.equal(cy.invoiced_halalas, 0, 'قبل الإصلاح 500,000: فاتورة CX كانت تُحسب على عميل العقد');
  assert.equal(cy.collected_halalas, 0);
});

test('صفحة العميل 360 تعطي الرقم نفسه', async () => {
  const o = await clientOverview(FIN, 'CX');
  assert.equal(o.invoices_summary.invoiced, 800_000);
  assert.equal(o.invoices_summary.collected, 200_000);
  assert.equal(o.invoices_summary.outstanding, 600_000);
  assert.equal(o.kpis.open_ar_halalas, 600_000);
  assert.deepEqual(o.invoices.map((i) => i.id).sort(), ['INV1', 'INV2'],
    'فاتورة المشروع المحذوف لا تُنسب إلى العميل');
  const oy = await clientOverview(FIN, 'CY');
  assert.equal(oy.invoices_summary.invoiced, 0);
});

test('قائمة العملاء تعطي الرقم نفسه — والشاشات الثلاث لا تختلف على فاتورة واحدة', async () => {
  const list = await listClients(FIN);
  const cx = byId(list, 'CX'), cy = byId(list, 'CY');
  assert.equal(cx.open_ar_halalas, 600_000);
  assert.equal(cy.open_ar_halalas, 0);
  // نفس البيانات، ثلاثة مسارات استعلام، رقم واحد
  const fin = byId(await financeByClient(FIN), 'CX');
  const o = await clientOverview(FIN, 'CX');
  assert.equal(fin.outstanding_halalas, o.invoices_summary.outstanding);
  assert.equal(o.invoices_summary.outstanding, cx.open_ar_halalas);
});

test('المشروع المحذوف لا يصنع «آخر تواصل» ولا مستحقاً على عميله', async () => {
  const cx = byId(await listClients(FIN), 'CX');
  assert.equal(cx.last_activity_at, day(20),
    'قبل الإصلاح كان آخر تواصل تاريخَ فاتورة مشروعٍ محذوف — نشاطٌ لم يحدث');
  assert.ok(cx.open_ar_halalas < 900_000, 'مبلغ فاتورة المشروع المحذوف لا يدخل مستحق العميل');
});

test('المستخلص من عقد يكتب عميل العقد في الفاتورة — فتتّفق الشاشات تلقائياً (مع سجل تدقيق)', async () => {
  const inv = await createProgressClaim(CTX, { contractId: 'TZ', periodLabel: 'يونيو' });
  assert.equal(inv.amount_halalas, 400_000);
  assert.equal(inv.client_id, 'CZ', 'مسار الإصدار نفسه ينسخ عميل العقد إلى الفاتورة — فلا حاجة لمسار نسبة ثالث');
  const aud = await get("SELECT * FROM audit_log WHERE resource = 'invoice' AND action = 'create' AND resource_id = ?", [inv.id]);
  assert.ok(aud, 'كل كتابة تُسجَّل في سجل التدقيق');
  assert.equal(aud.user_id, 'u_fin');
  assert.equal(aud.sector_id, 'S1');

  const fin = byId(await financeByClient(FIN), 'CZ');
  const o = await clientOverview(FIN, 'CZ');
  const cz = byId(await listClients(FIN), 'CZ');
  assert.equal(fin.invoiced_halalas, 400_000);
  assert.equal(o.invoices_summary.invoiced, 400_000);
  assert.equal(cz.open_ar_halalas, 400_000);
});
