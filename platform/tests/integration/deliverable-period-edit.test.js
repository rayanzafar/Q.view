// ── شهر استحقاق المخرَج يُعدَّل من صفّه (v5.72) ──────────────────────────────────
//
// «الإيرادات لسنة ٢٠٢٦ طالعة غلط» — قائدة قطاع الاستشارات (2026-09-02). والسبب ليس في
// حساب الإيراد: مخرجاتُها كلها بلا شهر استحقاق، فيؤرَّخ إيرادُ كلٍّ منها بيوم تسليمه لا
// بشهر استحقاقه. والشهر كان يُختار مرةً واحدة **عند الإضافة** ولا سبيل إلى تصحيحه بعدها
// أبداً — لا في الصفّ ولا في أي شاشة. فالمطالبة برقمٍ صحيح كانت مطالبةً بعملٍ لا أداة له.
//
// هذا الفحص يحرس ثلاثة معانٍ: أن الشهر يُكتب على مخرَجٍ قائم، وأن **سطر إيراده يتحرّك معه**
// (وإلا صار على الشاشة شهرٌ وفي الحساب شهرٌ آخر)، وأن الخانة لا تظهر لمن لا يملك التعديل.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dlvperiod-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, P, gov;
const T = '2026-01-05T00:00:00Z';
const DELIVERED_AT = '2026-07-14T09:00:00Z';
const LEAD = { id: 'u_lead', username: 'lead', name_ar: 'قائدة القطاع', role_id: 'sector_lead', scope: 'sector',
  sector_id: 'CONS', departmentIds: new Set(), projectIds: new Set(), teamIds: new Set(),
  opportunityIds: new Set(), departmentGrants: [], managedDepartmentIds: new Set() };
const EMP = { id: 'u_emp', username: 'emp', name_ar: 'عضو الفريق', role_id: 'employee', scope: 'own',
  sector_id: 'CONS', projectIds: new Set(['PRJ']), teamIds: new Set() };
const ctx = () => ({ user: LEAD, ip: '127.0.0.1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  P = await import('../../src/web/pages.js');
  gov = await import('../../src/modules/pmo/governance.js');
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T });
  await db.insert('department', { id: 'D1', sector_id: 'CONS', name_ar: 'إدارة الاستشارات', active: 1, created_at: T });
  for (const u of [LEAD, EMP]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      scope: u.scope, sector_id: 'CONS', active: 1, created_at: T });
  }
  // مشروعٌ يمتدّ ٢٠٢٦ كله — مخرَجٌ مُسلَّم بقيمة وبلا شهر (حالة بلاغ القطاع حرفاً)، ومخرَجٌ له شهره.
  await db.insert('project', { id: 'PRJ', name_ar: 'برنامج التحول', sector_id: 'CONS', department_id: 'D1',
    owner_user_id: 'u_lead', status: 'IN_PROGRESS', rag: 'GREEN', start_date: '2026-01-01', end_date: '2026-12-31', created_at: T });
  await db.insert('deliverable', { id: 'DLV_NOMONTH', project_id: 'PRJ', sector_id: 'CONS', name_ar: 'تقرير الوضع الراهن',
    status: 'DELIVERED', amount_halalas: 1000000, month: null, year: null, delivered_at: DELIVERED_AT,
    status_at: DELIVERED_AT, created_at: T });
  await db.insert('deliverable', { id: 'DLV_HASMONTH', project_id: 'PRJ', sector_id: 'CONS', name_ar: 'خارطة الطريق',
    status: 'DELIVERED', amount_halalas: 500000, month: 4, year: 2026, delivered_at: DELIVERED_AT,
    status_at: DELIVERED_AT, created_at: T });
  // سطرا الإيراد المشتقّان كما يكتبهما محرّك الاعتراف اليوم: الأول مؤرَّخ بيوم التسليم (٧/٢٠٢٦).
  for (const [rid, dlvId, amt, m] of [['rl_dlv_DLV_NOMONTH', 'DLV_NOMONTH', 1000000, 7],
    ['rl_dlv_DLV_HASMONTH', 'DLV_HASMONTH', 500000, 4]]) {
    await db.insert('revenue_line', { id: rid, project_id: 'PRJ', sector_id: 'CONS', deliverable_id: dlvId,
      amount_halalas: amt, month: m, year: 2026, auto: 1, rule_id: 'deliverable_delivered', created_at: T });
  }
  // مشروعٌ ثانٍ لا مخرَج فيه بلا شهر — به يُقاس غياب العدّاد.
  await db.insert('project', { id: 'PRJ_OK', name_ar: 'مشروع مكتمل الشهور', sector_id: 'CONS', department_id: 'D1',
    owner_user_id: 'u_lead', status: 'IN_PROGRESS', rag: 'GREEN', start_date: '2026-01-01', end_date: '2026-12-31', created_at: T });
  await db.insert('deliverable', { id: 'DLV_OK', project_id: 'PRJ_OK', sector_id: 'CONS', name_ar: 'دليل التشغيل',
    status: 'DELIVERED', amount_halalas: 300000, month: 2, year: 2026, delivered_at: DELIVERED_AT,
    status_at: DELIVERED_AT, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const dlvOf = (id) => db.get('SELECT * FROM deliverable WHERE id = ?', [id]);
const lineOf = (id) => db.get('SELECT * FROM revenue_line WHERE id = ?', ['rl_dlv_' + id]);

test('كتابة الشهر على مخرَجٍ مُسلَّم قائم تنقل سطر إيراده إلى الشهر نفسه', async () => {
  await gov.updateItem(ctx(), 'deliverable', 'DLV_NOMONTH', { period: '2026-03' });
  const d = await dlvOf('DLV_NOMONTH');
  assert.equal(Number(d.month), 3, 'شهر المخرَج لم يُكتب');
  assert.equal(Number(d.year), 2026, 'سنة المخرَج لم تُكتب');
  const rl = await lineOf('DLV_NOMONTH');
  assert.ok(rl, 'سطر الإيراد اختفى بتغيير الشهر');
  assert.equal(Number(rl.month), 3, 'الإيراد بقي في شهر التسليم — فالشاشة تقول شهراً والحساب شهراً آخر');
  assert.equal(Number(rl.year), 2026, 'سنة الإيراد لم تتبع شهر الاستحقاق');
  assert.equal(Number(rl.amount_halalas), 1000000, 'قيمة الإيراد تغيّرت مع الشهر');
});

test('محو الشهر يُفرغ الخانتين ويعيد تأريخ الإيراد بيوم التسليم', async () => {
  await gov.updateItem(ctx(), 'deliverable', 'DLV_NOMONTH', { period: '' });
  const d = await dlvOf('DLV_NOMONTH');
  assert.equal(d.month, null, 'الشهر لم يُمحَ');
  assert.equal(d.year, null, 'السنة لم تُمحَ');
  const rl = await lineOf('DLV_NOMONTH');
  assert.ok(rl, 'محو الشهر أسقط سطر الإيراد');
  assert.equal(Number(rl.month), 7, 'الإيراد لم يرجع إلى شهر التسليم');
  assert.equal(Number(rl.year), 2026, 'سنة الإيراد لم ترجع إلى سنة التسليم');
});

test('شهرٌ خارج القائمة يُردّ برسالة عربية تقول ما يُفعل', async () => {
  await assert.rejects(
    () => gov.updateItem(ctx(), 'deliverable', 'DLV_HASMONTH', { period: '2026-13' }),
    (e) => { assert.match(e.message, /اختر شهر الاستحقاق من القائمة/); assert.equal(e.status, 400); return true; },
    'شهرٌ غير موجود مرّ إلى القاعدة');
  const d = await dlvOf('DLV_HASMONTH');
  assert.equal(Number(d.month), 4, 'الشهر المحفوظ تغيّر رغم ردّ الطلب');
});

test('سنةٌ خارج المعقول تُردّ ولا تُهرِّب الإيراد إلى سنةٍ لا تُقرأ', async () => {
  for (const per of ['2099-01', '0001-12']) {
    await assert.rejects(
      () => gov.updateItem(ctx(), 'deliverable', 'DLV_HASMONTH', { period: per }),
      (e) => { assert.match(e.message, /سنة شهر الاستحقاق خارج المعقول/); assert.equal(e.status, 400); return true; },
      `سنةٌ خارج المعقول (${per}) مرّت إلى القاعدة`);
  }
  const d = await dlvOf('DLV_HASMONTH');
  assert.equal(Number(d.year), 2026, 'سنة المخرَج تغيّرت رغم ردّ الطلب');
  const rl = await lineOf('DLV_HASMONTH');
  assert.equal(Number(rl.year), 2026, 'سطر الإيراد انتقل إلى سنةٍ مردودة');
});

test('خانة الشهر تظهر في صفّ المخرَج لمن يملك تعديله — وتحمل شهره المحفوظ', async () => {
  const html = await P.projectDetailPage(LEAD, 'PRJ', {});
  assert.ok(html.includes('data-action-change="dlv-period"'), 'خانة الشهر غائبة عن صفّ المخرَج');
  assert.ok(html.includes('data-action-change="dlv-period" data-id="DLV_HASMONTH"'), 'الخانة لا تحمل المخرَج المقصود');
  assert.match(html, /<option value="2026-04" selected>أبريل 2026<\/option>/, 'الشهر المحفوظ لا يظهر مختاراً في الخانة');
  assert.ok(html.includes('data-prev="2026-04"'), 'الخانة لا تحفظ قيمتها السابقة لاستعادتها عند الردّ');
  assert.ok(html.includes('>بلا شهر</option>'), 'لا خيار لمحو الشهر');
  assert.ok(!/undefined|NaN|\[object/.test(html), 'تسرَّب نصٌّ تقنيّ إلى الصفحة');
});

test('القارئ بلا صلاحية تعديل لا يرى خانة الشهر أصلاً', async () => {
  const html = await P.projectDetailPage(EMP, 'PRJ', {});
  assert.ok(!html.includes('data-action-change="dlv-period"'), 'خانة تعديل الشهر ظهرت لقارئٍ لا يملك التعديل');
  assert.ok(!html.includes('data-action-blur="dlv-amount"'), 'بوابة الخانة لا تطابق بوابة القيمة — الفحص يقيس شيئاً آخر');
});

test('عدّاد «بلا شهر» يُقال حين ينقص شهرٌ ويسكت حين تكتمل الشهور', async () => {
  const html = await P.projectDetailPage(LEAD, 'PRJ', {});
  assert.ok(html.includes('بلا شهر استحقاق — والإيراد يؤرَّخ بيوم التسليم'), 'العدّاد لا يقول أثر نقص الشهر');
  assert.ok(!/إيرادها يؤرَّخ|تسليمها/.test(html), 'ضميرُ جمعٍ على معدودٍ مفرد — العدد لا يوافق معدوده');
  assert.ok(/مخرَجٌ واحد بلا شهر استحقاق/.test(html), 'العدّاد لا يوافق العدد معدودَه');
  const clean = await P.projectDetailPage(LEAD, 'PRJ_OK', {});
  assert.ok(!clean.includes('بلا شهر استحقاق'), 'العدّاد بقي على مشروعٍ كل مخرجاته لها شهورها');
});
