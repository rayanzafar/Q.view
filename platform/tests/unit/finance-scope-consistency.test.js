// وحدة: اتساق النطاق والسنة داخل المالية — «فترة التحصيل» وجدول مديري المشاريع.
//
// ما كان يحدث قبل الإصلاح (وهو ما تفشل عليه هذه الاختبارات بالضبط):
//   • dso: البسط مستحقُّ نطاق القارئ، والمقام إيرادُ الشركة كاملةً بلا أي مرشّح — فيخرج لقائد
//     قطاعٍ رقمٌ أصغر من الحقيقة بأضعاف (36 يوماً بدل 180 في هذه البيانات).
//   • financeByPM: «المحصَّل» و«قيمة العقود» يُستعلمان بمعرّف المدير وحده — بلا شرط النطاق،
//     وبلا استبعاد الفواتير المحذوفة، وقيمةُ العقود بلا شرط سنة أصلاً. النتيجة صفٌّ يخلط
//     سنةً واحدة بتاريخٍ كامل، ويعرض تحصيلاً أكبر من الفوترة، ويسرّب أرقام قطاع آخر.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-fin-scope-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { config } = await import('../../src/core/config.js');
const { dso, financeSummary, financeByPM } = await import('../../src/modules/finance/finance.js');

const T = '2024-01-10T08:00:00.000Z';
// سنةٌ ماضية عمداً: dso يستعمل فترة سنة كاملة (360 يوماً) لغير السنة الجارية، فيبقى الرقم حتمياً
// مهما كان يوم التشغيل. YR-1 تُستعمل للتأكد أن السنة تُحترم في كل عمود.
const YR = config.fiscalYear - 2;
const PREV = YR - 1;

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, sort_order: 2, created_at: T });
  await insert('app_user', { id: 'u_pm1', username: 'pm1', name_ar: 'مدير المشاريع الأول',
    role_id: 'project_manager', sector_id: 'S1', scope: 'project', active: 1, created_at: T });

  // مشاريع المدير نفسه موزّعة على قطاعين + مشروع ثالث بلا فوترة في السنة المختارة
  await insert('project', { id: 'P1', name_ar: 'مشروع أ', sector_id: 'S1', owner_user_id: 'u_pm1',
    status: 'IN_PROGRESS', contract_value_halalas: 4_000_000, created_at: T });
  await insert('project', { id: 'P2', name_ar: 'مشروع ب', sector_id: 'S2', owner_user_id: 'u_pm1',
    status: 'IN_PROGRESS', contract_value_halalas: 9_000_000, created_at: T });
  await insert('project', { id: 'P3', name_ar: 'مشروع ج', sector_id: 'S1', owner_user_id: 'u_pm1',
    status: 'IN_PROGRESS', contract_value_halalas: 5_000_000, created_at: T });

  // الإيراد: قطاع أ 1.2م · قطاع ب 4.8م ⇒ إيراد الشركة 6م
  await insert('revenue_line', { id: 'R1', project_id: 'P1', sector_id: 'S1', amount_halalas: 1_200_000, month: 3, year: YR, created_at: T });
  await insert('revenue_line', { id: 'R2', project_id: 'P2', sector_id: 'S2', amount_halalas: 4_800_000, month: 3, year: YR, created_at: T });

  // فواتير السنة المختارة
  await insert('invoice', { id: 'IA', code: 'INV-A', sector_id: 'S1', project_id: 'P1', owner_user_id: 'u_pm1',
    amount_halalas: 1_000_000, status: 'ISSUED', issue_date: `${YR}-03-01`, created_at: T });
  await insert('invoice', { id: 'IB', code: 'INV-B', sector_id: 'S2', project_id: 'P2', owner_user_id: 'u_pm1',
    amount_halalas: 2_000_000, status: 'ISSUED', issue_date: `${YR}-04-01`, created_at: T });
  // فاتورة سنة سابقة
  await insert('invoice', { id: 'IC', code: 'INV-C', sector_id: 'S1', project_id: 'P1', owner_user_id: 'u_pm1',
    amount_halalas: 700_000, status: 'ISSUED', issue_date: `${PREV}-05-01`, created_at: T });
  // فاتورة محذوفة داخل السنة والقطاع — يجب ألا يظهر منها شيء، ولا حتى تحصيلها
  await insert('invoice', { id: 'ID', code: 'INV-D', sector_id: 'S1', project_id: 'P3', owner_user_id: 'u_pm1',
    amount_halalas: 300_000, status: 'ISSUED', issue_date: `${YR}-06-01`, deleted_at: T, created_at: T });

  await insert('collection', { id: 'KA', invoice_id: 'IA', amount_halalas: 400_000, collected_at: `${YR}-05-01`, created_at: T });
  await insert('collection', { id: 'KB', invoice_id: 'IB', amount_halalas: 900_000, collected_at: `${YR}-06-01`, created_at: T });
  await insert('collection', { id: 'KC', invoice_id: 'IC', amount_halalas: 100_000, collected_at: `${PREV}-07-01`, created_at: T });
  await insert('collection', { id: 'KD', invoice_id: 'ID', amount_halalas: 250_000, collected_at: `${YR}-07-01`, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const LEAD = { id: 'u_lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector', projectIds: new Set() };
const ADMIN = { id: 'u_admin', role_id: 'admin', sector_id: null, scope: 'company', projectIds: new Set() };

// ── فترة التحصيل ─────────────────────────────────────────────────────────────
test('فترة التحصيل: مستحقُّ القطاع يُقسم على إيراد القطاع لا على إيراد الشركة', async () => {
  // مستحقّ قطاع أ = 1,000,000 − 400,000 = 600,000 · إيراد قطاع أ = 1,200,000 · الفترة 360 يوماً
  assert.equal(await dso(LEAD, YR), 180, 'قبل الإصلاح كان 36 يوماً: 600,000 ÷ إيراد الشركة 6,000,000');
  // قارئ الشركة: (600,000 + 1,100,000) ÷ 6,000,000 × 360
  assert.equal(await dso(ADMIN, YR), 102, 'قارئ الشركة لا يتغيّر رقمه — البسط والمقام كلاهما شركة');
});

test('الجسر المالي و«فترة التحصيل» يقرآن الإيراد نفسه لنفس القارئ', async () => {
  const s = await financeSummary(LEAD, YR);
  assert.equal(s.revenue_halalas, 1_200_000, 'إيراد القطاع وحده في الجسر');
  assert.equal(s.ar_halalas, 600_000);
  assert.equal(s.dso, 180, 'رقم الجسر ورقم البطاقة من مصدر واحد');
  assert.equal(s.dso, await dso(LEAD, YR));
});

test('من لا يقرأ الفواتير لا يُعرض له إيراد ولا فترة تحصيل', async () => {
  const hr = { id: 'u_hr', role_id: 'hr', sector_id: 'S1', scope: 'company', projectIds: new Set() };
  assert.equal(await dso(hr, YR), 0);
  assert.equal((await financeSummary(hr, YR)).revenue_halalas, 0);
});

// ── جدول مديري المشاريع ──────────────────────────────────────────────────────
test('مديرو المشاريع: المحصَّل وقيمة العقود داخل نطاق القارئ وسنته', async () => {
  const rows = await financeByPM(LEAD, YR);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.pm, 'مدير المشاريع الأول');
  assert.equal(r.invoices, 1);
  assert.equal(r.invoiced_halalas, 1_000_000);
  assert.equal(r.collected_halalas, 400_000,
    'قبل الإصلاح 1,550,000: تحصيل فاتورة قطاع آخر + تحصيل فاتورة محذوفة');
  assert.equal(r.outstanding_halalas, 600_000, 'قبل الإصلاح صفر لأن المحصَّل تجاوز المفوتر');
  assert.equal(r.contract_halalas, 4_000_000,
    'قبل الإصلاح 18,000,000: كل مشاريع المدير في كل القطاعات ومنذ البداية');
  assert.ok(r.collected_halalas <= r.invoiced_halalas, 'المحصَّل لا يتجاوز المفوتر على الصف نفسه');
});

test('مديرو المشاريع لقارئ الشركة: القطاعان معاً، بلا محذوف وبلا سنة أخرى', async () => {
  const rows = await financeByPM(ADMIN, YR);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.invoices, 2);
  assert.equal(r.invoiced_halalas, 3_000_000);
  assert.equal(r.collected_halalas, 1_300_000, 'تحصيل الفاتورة المحذوفة (250,000) لا يُحتسب');
  assert.equal(r.contract_halalas, 13_000_000, 'عقود المشروعين المفوترين فقط — لا المشروع الثالث');
});

test('مديرو المشاريع: تبديل السنة يبدّل كل أعمدة الصف معاً', async () => {
  const [r] = await financeByPM(ADMIN, PREV);
  assert.equal(r.invoiced_halalas, 700_000);
  assert.equal(r.collected_halalas, 100_000);
  assert.equal(r.contract_halalas, 4_000_000, 'قيمة العقود تتبع السنة كبقية الأعمدة، لا تبقى تاريخية');
  assert.deepEqual(await financeByPM(ADMIN, YR - 5), [], 'سنة بلا فواتير = جدول فارغ');
});
