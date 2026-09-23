// تحميل كشف فواتير المالية — العينة الممثِّلة تغطي ما يقع عليه الخطأ فعلاً:
//   • المعاينة **لا تكتب صفاً واحداً**.
//   • يُحمَّل المحسوم وحده (CONFIDENT + LIKELY)؛ وغير المحسوم يُترك ويُذكر بمبالغه.
//   • المبلغ المخزَّن **إجمالي** وصافيه صافي الملف حرفياً والضريبة الفارق.
//   • التاريخ تاريخ الملف لا يوم التشغيل، والحالة «صادرة» لا مسودة.
//   • العميل عميلُ المشروع لا خانة Partner في الملف (وهي مزاحة عمداً في العيّنة).
//   • صفُّ المجموع الكلي لا يُحمَّل.
//   • إشعار الخصم يُحمَّل سالباً ويطرح من مفوتر القطاع.
//   • إعادة التشغيل لا تُنشئ شيئاً.
//   • صفٌّ بتاريخ غير مقروء يوقف كل شيء برسالة عربية ولا يكتب صفاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-invoice-statement-load.db');
process.env.SANAD_DB = TEST_DB;

const T = '2026-01-05T08:00:00.000Z';
const YEAR = 2026;
const WB_OK = resolve(process.cwd(), 'data/test-invoice-statement.xlsx');
const WB_BAD = resolve(process.cwd(), 'data/test-invoice-statement-baddate.xlsx');
const MAP_FILE = resolve(process.cwd(), 'data/test-invoice-statement-map.json');

// مراكز التكلفة الثلاثة في العيّنة
const CC_A = 'مركز تكلفة مشروع الامتثال';        // CONFIDENT → p1
const CC_B = 'مركز تكلفة مشروع التحول';          // LIKELY   → p2
const CC_C = 'مركز تكلفة بلا مشروع';             // UNRESOLVED → لا يُحمَّل

// تواريخ إكسل التسلسلية: 46047 = 2026-01-25 · 46061 = 2026-02-08 · 46203 = 2026-06-30
const D_JAN = 46047, D_FEB = 46061, D_JUN = 46203;

let db, XLSX, lib, metrics;

function buildWorkbooks() {
  const head = ['Date', 'Partner', 'Description', 'Cost Center', 'Amount'];
  // Partner مزاحٌ عمداً: الجهة المكتوبة أمام كل صف ليست عميل مشروعه.
  const rows = [
    [D_JAN, 'عميل المشروع الثاني', 'المطالبة الأولى', CC_A, 1000],
    [D_FEB, 'عميل المشروع الثاني', 'المطالبة الثانية', CC_A, 500],
    [D_JUN, 'عميل المشروع الأول', 'إلغاء المطالبة الأولى', CC_B, -200],
    [D_JAN, 'عميل المشروع الأول', 'مطالبة على مركز غير محسوم', CC_C, 777],
  ];
  const total = rows.reduce((a, r) => a + r[4], 0); // 2077
  const aoa = [head, ...rows, [null, null, null, null, total]];  // صفُّ المجموع الكلي

  const write = (path, data) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Sheet1');
    writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  };
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
  write(WB_OK, aoa);

  // النسخة المعطوبة: صفٌّ تاريخه نصٌّ لا يُقرأ تاريخاً
  const bad = aoa.map((r) => r.slice());
  bad[1] = ['لاحقاً', 'عميل المشروع الثاني', 'المطالبة الأولى', CC_A, 1000];
  write(WB_BAD, bad);

  writeFileSync(MAP_FILE, JSON.stringify([
    { cost_center: CC_A, project_id: 'p1', project_name: 'مشروع الامتثال', client_id: 'c1', client_name: 'عميل المشروع الأول', verdict: 'CONFIDENT' },
    { cost_center: CC_B, project_id: 'p2', project_name: 'مشروع التحول', client_id: 'c2', client_name: 'عميل المشروع الثاني', verdict: 'LIKELY' },
    { cost_center: CC_C, project_id: null, project_name: null, client_id: null, client_name: null, verdict: 'UNRESOLVED' },
  ], null, 1), 'utf8');
}

const invoiceCount = async () =>
  (await db.get('SELECT COUNT(*) AS "c" FROM invoice WHERE deleted_at IS NULL')).c;
const auditCount = async () =>
  (await db.get('SELECT COUNT(*) AS "c" FROM audit_log WHERE resource = ?', ['invoice'])).c;

let CTX;

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  XLSX = (await import('../../vendor/xlsx/xlsx.mjs')).default;
  await migrate(); await seedRbac();
  lib = await import('../../scripts/load-invoice-statement.mjs');
  metrics = await import('../../src/core/reports/metrics.js');
  buildWorkbooks();

  await db.insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, created_at: T });
  await db.insert('client', { id: 'c1', name_ar: 'عميل المشروع الأول', active: 1, created_at: T });
  await db.insert('client', { id: 'c2', name_ar: 'عميل المشروع الثاني', active: 1, created_at: T });
  await db.insert('project', { id: 'p1', code: 'CONS-1', name_ar: 'مشروع الامتثال', sector_id: 'CONSULTING',
    client_id: 'c1', status: 'IN_PROGRESS', rag: 'GREEN', contract_value_halalas: 100000000, created_at: T });
  await db.insert('project', { id: 'p2', code: 'CONS-2', name_ar: 'مشروع التحول', sector_id: 'CONSULTING',
    client_id: 'c2', status: 'IN_PROGRESS', rag: 'GREEN', contract_value_halalas: 50000000, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin_test', name_ar: 'مدير النظام',
    role_id: 'admin', scope: 'company', active: 1, created_at: T });
  CTX = { user: { id: 'u_admin', username: 'admin_test', role_id: 'admin' }, ip: null };
});

after(async () => {
  await db.close?.();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  for (const f of [WB_OK, WB_BAD, MAP_FILE]) rmSync(f, { force: true });
});

const plan = () => lib.planLoad({ file: WB_OK, map: MAP_FILE, sector: 'CONSULTING' });

test('القراءة تستبعد صفّ المجموع الكلي وتطابقه بمجموع الصفوف', async () => {
  const st = lib.readStatement(WB_OK);
  assert.equal(st.rows.length, 4, 'أربعة صفوف بيانات — صفّ المجموع ليس منها');
  assert.equal(st.grandTotal, 207700, 'المجموع الكلي قُرئ من صفّه المنفصل');
  assert.equal(st.rows[0].issueDate, '2026-01-25', 'التاريخ التسلسلي فُكّ إلى تاريخ الملف');
  assert.equal(st.rows.reduce((a, r) => a + r.netHalalas, 0), st.grandTotal, 'مجموع الصفوف = المجموع المكتوب');
});

test('المعاينة لا تكتب صفاً واحداً، وتذكر المتروك بمبالغه', async () => {
  const before_ = { inv: await invoiceCount(), aud: await auditCount() };
  const p = await plan();
  const done = await lib.applyPlan(p, CTX, { apply: false });
  assert.equal(done.created, 0, 'المعاينة لا تُنشئ');
  assert.equal(await invoiceCount(), before_.inv, 'عدد الفواتير لم يتغير');
  assert.equal(await auditCount(), before_.aud, 'لا سطر تدقيق في المعاينة');

  assert.equal(p.load.length, 3, 'ثلاثة صفوف محسومة فقط');
  assert.equal(p.skipped.length, 1, 'مركز تكلفة واحد متروك');
  assert.equal(p.skipped[0].center, CC_C);
  assert.equal(p.skipped[0].netHalalas, 77700, 'مبلغ المتروك يُذكر كما هو');

  const echo = await lib.dashboardEcho(p, { sectorId: 'CONSULTING', year: YEAR });
  const text = lib.renderPreview(p, { apply: false, sectorId: 'CONSULTING', echo });
  assert.ok(text.includes('معاينة'), 'العنوان يقول إنها معاينة');
  assert.ok(text.includes(CC_C), 'المركز المتروك مذكور بالاسم');
  assert.ok(text.includes('777.00'), 'مبلغ المتروك مطبوع');
  assert.ok(text.includes('غير مرئي في أعمار'), 'أثر الفاتورة السالبة على الأعمار مُعلن');
});

test('التنفيذ يحمّل المحسوم وحده بمبالغ إجمالية وتواريخ الملف', async () => {
  const p = await plan();
  const done = await lib.applyPlan(p, CTX, { apply: true });
  assert.equal(done.created, 3, 'أُنشئت الثلاثة المحسومة');
  assert.equal(await invoiceCount(), 3, 'ولا شيء غيرها — صفّ المجموع الكلي لم يُحمَّل');
  assert.equal(await auditCount(), 3, 'سطر تدقيق لكل فاتورة');

  const rows = await db.all('SELECT * FROM invoice WHERE deleted_at IS NULL ORDER BY amount_halalas DESC');

  // ① المبالغ: المخزَّن إجمالي، والصافي صافي الملف حرفياً، والضريبة الفارق.
  const a1 = rows.find((r) => r.net_amount_halalas === 100000);
  assert.ok(a1, 'صف الألف ريال موجود');
  assert.equal(a1.amount_halalas, 115000, 'المخزَّن إجمالي = صافي × ١٫١٥');
  assert.equal(a1.vat_halalas, 15000, 'الضريبة هي الفارق');
  assert.equal(a1.amount_halalas, a1.net_amount_halalas + a1.vat_halalas, 'صافٍ + ضريبة = إجمالي');

  // ② التاريخ تاريخ الملف لا يوم التشغيل.
  assert.equal(a1.issue_date, '2026-01-25', 'تاريخ الإصدار من الملف');
  assert.notEqual(a1.issue_date, new Date().toISOString().slice(0, 10), 'ليس يوم التشغيل');

  // ③ الحالة صادرة — المسودة مستبعدة من كل مجموع مفوتر.
  assert.deepEqual([...new Set(rows.map((r) => r.status))], ['ISSUED']);

  // ④ العميل عميل المشروع لا خانة Partner (وهي تشير للعميل الآخر في الملف).
  assert.equal(a1.project_id, 'p1');
  assert.equal(a1.client_id, 'c1', 'عميل المشروع لا الجهة المكتوبة في الملف');
  const neg = rows.find((r) => r.net_amount_halalas < 0);
  assert.equal(neg.project_id, 'p2');
  assert.equal(neg.client_id, 'c2', 'العميل من المشروع في الصف السالب أيضاً');

  // ⑤ ما لا يُكتب عمداً.
  for (const r of rows) {
    assert.equal(r.code, null, 'لا يُخترع رقم فاتورة');
    assert.equal(r.due_date, null, 'لا يُخترع تاريخ استحقاق');
    assert.equal(r.deliverable_id, null, 'التحميل على مستوى المشروع');
    assert.equal(r.contract_id, null);
    assert.equal(r.kind, 'standard');
    assert.equal(r.sector_id, 'CONSULTING');
  }

  // ⑥ المركز غير المحسوم غائب تماماً.
  const stray = await db.get('SELECT COUNT(*) AS "c" FROM invoice WHERE net_amount_halalas = 77700');
  assert.equal(stray.c, 0, 'صفوف المركز غير المحسوم لم تُحمَّل');
  // ⑦ صفّ المجموع الكلي غائب كذلك.
  const grand = await db.get('SELECT COUNT(*) AS "c" FROM invoice WHERE net_amount_halalas = 207700');
  assert.equal(grand.c, 0, 'صفّ المجموع الكلي ليس فاتورة');
});

test('الفاتورة السالبة تُحمَّل وتطرح من مفوتر القطاع', async () => {
  const neg = await db.get('SELECT * FROM invoice WHERE net_amount_halalas < 0 AND deleted_at IS NULL');
  assert.ok(neg, 'إشعار الخصم حُمِّل ولم يُرفض');
  assert.equal(neg.net_amount_halalas, -20000);
  assert.equal(neg.amount_halalas, -23000, 'الإجمالي السالب أيضاً');

  const inv = await metrics.invoicedNet('CONSULTING', YEAR);
  assert.equal(inv.count, 3);
  assert.equal(inv.invoiced_net_halalas, 130000, '١٠٠٠ + ٥٠٠ − ٢٠٠ صافياً — السالب طرح فعلاً');
});

test('إعادة التشغيل لا تُنشئ شيئاً', async () => {
  const before_ = { inv: await invoiceCount(), aud: await auditCount() };
  const p = await plan();
  assert.ok(p.load.every((l) => l.exists), 'كل الصفوف معروفةٌ مكتوبةً أصلاً');
  const done = await lib.applyPlan(p, CTX, { apply: true });
  assert.equal(done.created, 0, 'لم يُنشأ صف');
  assert.equal(done.already, 3);
  assert.equal(await invoiceCount(), before_.inv, 'العدد كما هو');
  assert.equal(await auditCount(), before_.aud, 'ولا سطر تدقيق مكرر');
});

test('صفٌّ بتاريخ غير مقروء يوقف كل شيء برسالة عربية ولا يكتب صفاً', async () => {
  const before_ = { inv: await invoiceCount(), aud: await auditCount() };
  await assert.rejects(
    () => lib.planLoad({ file: WB_BAD, map: MAP_FILE, sector: 'CONSULTING' }),
    (e) => {
      assert.match(e.message, /بلا تاريخ مقروء/, 'الرسالة تقول ما وقع بالعربية');
      assert.ok(!/undefined|null|NaN|Error:/.test(e.message), 'بلا مصطلحات تقنية');
      return true;
    });
  assert.equal(await invoiceCount(), before_.inv, 'لم تُكتب فاتورة');
  assert.equal(await auditCount(), before_.aud, 'ولا سطر تدقيق');
});

test('مشروعٌ في التسكين غير موجود في القاعدة يوقف التشغيل', async () => {
  const badMap = resolve(process.cwd(), 'data/test-invoice-statement-map-bad.json');
  writeFileSync(badMap, JSON.stringify([
    { cost_center: CC_A, project_id: 'p_ghost', verdict: 'CONFIDENT' },
    { cost_center: CC_B, project_id: 'p2', verdict: 'LIKELY' },
    { cost_center: CC_C, project_id: null, verdict: 'UNRESOLVED' },
  ]), 'utf8');
  try {
    await assert.rejects(
      () => lib.planLoad({ file: WB_OK, map: badMap, sector: 'CONSULTING' }),
      /p_ghost/);
  } finally { rmSync(badMap, { force: true }); }
});
