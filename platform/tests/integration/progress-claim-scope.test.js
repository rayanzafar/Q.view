// المستخلص لا يخرج من مشروعه: انحدارٌ محروس على عطل نسبة إيراد مؤكَّد.
//
// العطل الذي تحرسه هذه الاختبارات (كان يقع فعلاً ويردّ 200): تمرير معرّفات مخرجات صريحة في طلب
// المستخلص كان يُسقط شرطَي الأهلية معاً — «المخرَج من مشروع هذا العقد» و«حالته تسمح بالمطالبة» —
// فتُصدَر فاتورة عقدِ قطاعٍ على مخرَجِ مشروعِ قطاعٍ آخر. أثران، ثانيهما لا رجعة فيه عملياً:
//   ① الإيراد يُنسب إلى قطاع وعميل ليسا صاحبَيه.
//   ② المخرَج الغريب يُختم «مفوتراً»، فيتخطاه فحص «سبق تفويتره» في عقده الحقيقي فلا يُطالَب به أبداً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-claim-scope-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { createProgressClaim } = await import('../../src/modules/finance/finance.js');

const T = '2026-01-05T08:00:00.000Z';
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const finance = { id: 'u_fin', username: 'fin1', role_id: 'finance', sector_id: null, scope: 'company',
  projectIds: new Set(), teamIds: new Set() };

const statusOf = async (id) => (await db.get('SELECT status FROM deliverable WHERE id = ?', [id])).status;
const invoiceCount = async () => Number((await db.get('SELECT COUNT(*) AS "n" FROM invoice')).n);

before(async () => {
  await db.insert('sector', { id: 'SOL', name_ar: 'الحلول', active: 1, created_at: T });
  await db.insert('sector', { id: 'CON', name_ar: 'الاستشارات', active: 1, created_at: T });
  await db.insert('client', { id: 'CL_SOL', name_ar: 'عميل الحلول', active: 1, created_at: T });
  await db.insert('client', { id: 'CL_CON', name_ar: 'عميل الاستشارات', active: 1, created_at: T });
  await db.insert('project', { id: 'P_SOL', name_ar: 'مشروع الحلول', sector_id: 'SOL', client_id: 'CL_SOL',
    status: 'IN_PROGRESS', created_at: T });
  await db.insert('project', { id: 'P_CON', name_ar: 'مشروع الاستشارات', sector_id: 'CON', client_id: 'CL_CON',
    status: 'IN_PROGRESS', created_at: T });
  await db.insert('contract', { id: 'K_SOL', code: 'SOL-1', client_id: 'CL_SOL', project_id: 'P_SOL',
    sector_id: 'SOL', value_halalas: 1_000_000, status: 'ACTIVE', created_at: T });
  await db.insert('contract', { id: 'K_NOPRJ', code: 'NOPRJ-1', client_id: 'CL_SOL', sector_id: 'SOL',
    value_halalas: 500_000, status: 'ACTIVE', created_at: T });
  // مخرجات: واحد جاهز في مشروع العقد · واحد لم يُسلَّم بعد · وواحد في مشروع قطاع آخر
  const d = (id, project, sector, name, status, amount) => db.insert('deliverable', { id, project_id: project,
    sector_id: sector, name_ar: name, status, amount_halalas: amount, month: 2, created_at: T });
  await d('D_SOL_OK', 'P_SOL', 'SOL', 'تقرير الحلول الأول', 'DELIVERED', 300_000);
  await d('D_SOL_WIP', 'P_SOL', 'SOL', 'تقرير الحلول الثاني', 'PENDING', 200_000);
  await d('D_CON', 'P_CON', 'CON', 'تقرير الاستشارات', 'DELIVERED', 400_000);
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('مخرَج مشروع قطاع آخر يُرفض صراحةً، ولا يُلمَس صفّه', async () => {
  const before = await invoiceCount();
  await assert.rejects(
    () => createProgressClaim(ctx(finance), { contractId: 'K_SOL', deliverableIds: ['D_CON'] }),
    /من مشروع آخر/,
    'المخرَج الغريب يُرَدّ برسالة تقول ما الخطأ');
  assert.equal(await statusOf('D_CON'), 'DELIVERED', 'حالة المخرَج الغريب لم تتغير — لم يُختم مفوتراً');
  assert.equal(await invoiceCount(), before, 'ولا فاتورة صدرت');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS "n" FROM invoice_line WHERE deliverable_id = ?', ['D_CON'])).n), 0);
});

test('خلط مخرَج سليم بمخرَج غريب يُرَدّ كاملاً — لا فوترة جزئية صامتة', async () => {
  const before = await invoiceCount();
  await assert.rejects(
    () => createProgressClaim(ctx(finance), { contractId: 'K_SOL', deliverableIds: ['D_SOL_OK', 'D_CON'] }),
    /من مشروع آخر/);
  assert.equal(await statusOf('D_SOL_OK'), 'DELIVERED', 'ولا حتى السليم فُوتر — الطلب يُرَدّ كوحدة واحدة');
  assert.equal(await invoiceCount(), before);
});

test('مخرَج لم يُسلَّم بعد يُرفض باسمه لا بالصمت', async () => {
  await assert.rejects(
    () => createProgressClaim(ctx(finance), { contractId: 'K_SOL', deliverableIds: ['D_SOL_WIP'] }),
    /لم تُسلَّم بعد/);
  assert.equal(await statusOf('D_SOL_WIP'), 'PENDING');
});

test('معرّف غير موجود يُرفض ويُعدّ', async () => {
  await assert.rejects(
    () => createProgressClaim(ctx(finance), { contractId: 'K_SOL', deliverableIds: ['D_LA_YUJAD'] }),
    /غير موجود/);
});

test('عقد بلا مشروع لا يُصدر مستخلصاً، ولا يبتلع مخرجات غيره', async () => {
  await assert.rejects(
    () => createProgressClaim(ctx(finance), { contractId: 'K_NOPRJ', deliverableIds: ['D_SOL_OK'] }),
    /غير مرتبط بمشروع/);
  await assert.rejects(
    () => createProgressClaim(ctx(finance), { contractId: 'K_NOPRJ' }),
    /غير مرتبط بمشروع/);
  assert.equal(await statusOf('D_SOL_OK'), 'DELIVERED');
});

test('المسار السليم يعمل كما كان: مخرَج مشروع العقد يُفوتر مرة واحدة ويُدقَّق', async () => {
  const inv = await createProgressClaim(ctx(finance), { contractId: 'K_SOL', deliverableIds: ['D_SOL_OK'],
    periodLabel: 'فبراير 2026' });
  assert.equal(inv.amount_halalas, 300_000);
  assert.equal(inv.project_id, 'P_SOL');
  assert.equal(inv.sector_id, 'SOL');
  assert.equal(inv.client_id, 'CL_SOL', 'الفاتورة منسوبة إلى عميل العقد ومشروعه');
  assert.equal(await statusOf('D_SOL_OK'), 'INVOICED');
  const aud = await db.get('SELECT * FROM audit_log WHERE resource = ? AND resource_id = ?', ['invoice', inv.id]);
  assert.equal(aud.action, 'create');
  assert.equal(aud.sector_id, 'SOL');
  // الحماية القائمة باقية: لا يُفوتر مرتين — وبمعرّف صريح يُقال ذلك صراحةً لا بالصمت
  await assert.rejects(
    () => createProgressClaim(ctx(finance), { contractId: 'K_SOL', deliverableIds: ['D_SOL_OK'] }),
    /سبق تفويترها/);
  await assert.rejects(
    () => createProgressClaim(ctx(finance), { contractId: 'K_SOL' }),
    /لا توجد مخرجات مؤهلة/, 'والاختيار التلقائي يتخطاه بلا إزعاج ثم يقول إنه لا مؤهل');
});
