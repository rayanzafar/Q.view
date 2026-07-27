// تصنيف المشروع والإيراد المعروض عليه — الموجة صفر، المسار ج.
//
// عطلان حقيقيان كانا يظهران على الشاشة كل يوم:
//
// (١) «داخلي» فوق مشاريع عملاء. صفحة المشروع كانت تطبع نوع المشروع من الخانة المخزَّنة حرفياً:
//     كل ما ليس «لعميل» يُطبع «داخلي». والترحيل من المنصة السابقة كتب «داخلي» على 34 مشروعاً من
//     43، منها 31 **له عميل مسجَّل** و23 تحمل قيمة تعاقدية بعشرات الملايين — ولا مسار في المنتج
//     كله يعدّل تلك الخانة بعد الإنشاء. فالنتيجة: عقد عميل حقيقي يقرؤه المالك «عملاً داخلياً».
//     العلاج عرضٌ صادق بلا لمس البيانات: التصنيف يُشتقّ من قرائن الصف (عميل ونوعه · قيمة تعاقدية
//     · أمر شراء · إيراد محقق · فرصة مصدر)، والخانة تُقرأ حين تقول شيئاً موجباً فقط.
//     والحارس هنا يمنع الكذبة **في الاتجاهين**: مشروع عميل لا يُسمّى داخلياً، وعملُ الشركة على
//     نفسها (العميل المسجَّل هو الشركة) لا يُسمّى مشروع عميل.
//
// (٢) رقم إيراد لا يحدّثه شيء. الخانة على صف المشروع كانت تُعرض في ثلاثة مواضع ولا يكتبها سطر
//     واحد في المنتج كله — رقم من الترحيل يشيخ بصمت بينما استيراد الإيراد يكتب **بنود الإيراد**.
//     العلاج: الرقم المعروض يُحسب من بنود الإيراد نفسها (المصدر الذي تقرأ منه كل أرقام الإيراد
//     في المنصة) باستعلام مجمّع واحد للمحفظة كلها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sanad-prjlabel-'));
process.env.SANAD_DB = join(dir, 't.db');

const T = '2026-01-01T00:00:00.000Z';
const NOW_Y = new Date().getUTCFullYear();

const { migrate } = await import('../../scripts/migrate.js');
const { seedRbac } = await import('../../scripts/seed-rbac.js');
const { all, get, insert, close } = await import('../../src/core/db/index.js');

const admin = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin',
  sector_id: null, scope: 'company', projectIds: new Set(), teamIds: new Set() };

let svc, pmo;

before(async () => {
  await migrate();
  await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  svc = await import('../../src/modules/pmo/projects.js');
  pmo = await import('../../src/web/views/pmo.js');

  await insert('sector', { id: 'S1', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1,
    sort_order: 1, created_at: T });
  await insert('app_user', { id: admin.id, username: admin.username, name_ar: admin.name_ar,
    role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'مبدئية', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });

  // عميلان: جهة حكومية حقيقية، والشركة نفسها مسجَّلة عميلاً من نوع «داخلي» (كما في البيانات الحيّة)
  await insert('client', { id: 'C_GOV', name_ar: 'هيئة حكومية', type: 'حكومي', created_at: T });
  await insert('client', { id: 'C_SELF', name_ar: 'قطاع الحلول — داخلي (رؤية الخبراء)', type: 'داخلي', created_at: T });

  await insert('opportunity', { id: 'O1', title_ar: 'فرصة المصدر', sector_id: 'S1', client_id: 'C_GOV',
    stage_id: 'LEAD', value_halalas: 260000000, year: 2026, created_at: T });

  // (أ) شكل «قياس التحول الرقمي»: عميل حكومي + عقد + فرصة مصدر — والخانة تقول «داخلي»
  await insert('project', { id: 'P_STALE', name_ar: 'مشروع قياس التحول', sector_id: 'S1', client_id: 'C_GOV',
    kind: 'internal', status: 'IN_PROGRESS', contract_value_halalas: 260000000, source_opp_id: 'O1',
    progress_pct: 40, created_at: T });
  // (ب) العميل المسجَّل هو الشركة نفسها، بلا عقد ولا إيراد — تشغيل داخلي حقيقي
  await insert('project', { id: 'P_SELF', name_ar: 'تطوير أعمال القطاع', sector_id: 'S1', client_id: 'C_SELF',
    kind: 'internal', status: 'IN_PROGRESS', created_at: T });
  // (ج) بلا عميل لكن بقيمة تعاقدية — عميل ناقص الربط لا عمل داخلي
  await insert('project', { id: 'P_CONTRACT', name_ar: 'منصة بلا ربط عميل', sector_id: 'S1',
    kind: 'internal', status: 'IN_PROGRESS', contract_value_halalas: 330000000, created_at: T });
  // (د) شكل «المنصة المكانية»: بلا عميل ولا عقد، لكن له إيراد محقق وتصريح «لعميل»
  await insert('project', { id: 'P_REV', name_ar: 'المنصة المكانية', sector_id: 'S1',
    kind: 'external', status: 'IN_PROGRESS', created_at: T });
  // (هـ) لا قرينة إطلاقاً — تشغيل داخلي
  await insert('project', { id: 'P_PLAIN', name_ar: 'مبادرة إدارة الابتكار', sector_id: 'S1',
    kind: 'internal', status: 'IN_PROGRESS', created_at: T });
  // (و) منتج من منتجات الشركة
  await insert('project', { id: 'P_PRODUCT', name_ar: 'منتج المنصة الذكية', sector_id: 'S1',
    kind: 'product', status: 'IN_PROGRESS', created_at: T });
  // (ز) خانة إيراد قديمة على الصف بلا بند إيراد واحد — الرقم الشبح الذي لا يحدّثه شيء
  await insert('project', { id: 'P_GHOST', name_ar: 'مشروع برقم إيراد قديم', sector_id: 'S1', client_id: 'C_GOV',
    kind: 'internal', status: 'IN_PROGRESS', revenue_halalas: 987654300, created_at: T });

  // بنود الإيراد: سنتان لمشروع واحد، سنة ثالثة لآخر، وبند بلا ربط مشروع (لا يُنسب لأحد)
  await insert('revenue_line', { id: 'R1', project_id: 'P_STALE', sector_id: 'S1', year: NOW_Y, month: 3,
    amount_halalas: 111000000, created_at: T });
  await insert('revenue_line', { id: 'R2', project_id: 'P_STALE', sector_id: 'S1', year: NOW_Y - 1, month: 9,
    amount_halalas: 222000000, created_at: T });
  await insert('revenue_line', { id: 'R3', project_id: 'P_REV', sector_id: 'S1', year: NOW_Y - 2, month: 6,
    amount_halalas: 444000000, created_at: T });
  await insert('revenue_line', { id: 'R4', project_id: null, sector_id: 'S1', year: NOW_Y, month: 4,
    amount_halalas: 999000000, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const kindOf = (row, evidence) => svc.projectKind(row, evidence).key;
const prjRow = (id) => get('SELECT * FROM project WHERE id = ?', [id]);
// سطر المشروع في جدول المحفظة (من فتح الصف إلى إغلاقه) — كي تُقاس القيم على مشروعها لا على الصفحة
const tableRow = (html, pid) => {
  const i = html.indexOf(`data-id="${pid}"`);
  assert.ok(i > 0, `صف المشروع ${pid} غير موجود في جدول المحفظة`);
  return html.slice(i, html.indexOf('</tr>', i));
};
const NO_LEAK = [/undefined/, /\bNaN\b/, /\[object/];
const clean = (html, where) => { for (const rx of NO_LEAK) assert.ok(!rx.test(html), `${where}: تسرّب ${rx}`); };

// ═════════════ (١) قاعدة التصنيف: قرينة الصف تسبق الخانة المخزَّنة ═════════════

test('العطل الأصلي: مشروع له عميل وخانته «داخلي» يُصنَّف مشروع عميل لا عملاً داخلياً', async () => {
  const p = await prjRow('P_STALE');
  assert.equal(p.kind, 'internal', 'المقدّمة: الخانة المخزَّنة فعلاً «داخلي» كما كتبها الترحيل');
  const c = svc.projectKind(p, { clientType: 'حكومي', revenueHalalas: 333000000 });
  assert.equal(c.key, 'client');
  assert.equal(c.basis, 'client', 'القرينة الأولى هي العميل المسجَّل');
  assert.equal(c.stale, true, 'التناقض مع الخانة مُعلن لا مطموس');
});

test('الكذبة المعاكسة: العميل المسجَّل هو الشركة نفسها ⟵ تشغيل داخلي لا مشروع عميل', async () => {
  // قاعدة «له عميل ⇒ مشروع عميل» وحدها تسقط هنا: أربعة مشاريع في البيانات الحيّة مربوطة بعميل
  // اسمه «قطاع الحلول — داخلي (رؤية الخبراء)» — وهي أعمال الشركة على نفسها بلا عقد ولا إيراد.
  const c = svc.projectKind(await prjRow('P_SELF'), { clientType: 'داخلي' });
  assert.equal(c.key, 'internal');
  assert.equal(c.basis, 'internal_client');
  assert.equal(c.stale, false, 'الخانة والقرينة متفقتان هنا — لا تناقض يُعلن');
});

test('بلا عميل لكن بقرينة تجارية: عقد أو أمر شراء أو إيراد أو فرصة ⟵ مشروع عميل', async () => {
  assert.equal(kindOf(await prjRow('P_CONTRACT')), 'client', 'قيمة تعاقدية = عمل لعميل ينقصه ربط العميل');
  assert.equal(kindOf({ kind: 'internal', po_value_halalas: 50000 }), 'client', 'أمر شراء قرينة كذلك');
  assert.equal(kindOf({ kind: 'internal' }, { revenueHalalas: 1 }), 'client', 'ريال إيراد محقق واحد يكفي');
  assert.equal(kindOf({ kind: 'internal', source_opp_id: 'O1' }), 'client', 'ما نشأ من فرصة بيع عملُ عميل');
});

test('الخانة تُقرأ حين تقول شيئاً موجباً: «لعميل» و«منتج» تصريحان، و«داخلي» قيمة افتراضية بلا معلومة', async () => {
  const rev = await prjRow('P_REV');
  assert.equal(kindOf(rev), 'client', 'تصريح «لعميل» يبقى مسموعاً ولو خلا الصف من عميل وعقد');
  assert.equal(svc.projectKind(rev).basis, 'stated_external');
  assert.equal(kindOf(await prjRow('P_PRODUCT')), 'product');
  assert.equal(kindOf(await prjRow('P_PLAIN')), 'internal', 'لا قرينة ⟵ تشغيل داخلي');
  assert.equal(svc.projectKind(await prjRow('P_PLAIN')).basis, 'none');
});

test('التصنيف لا يخمّن عند غياب المعطيات ولا ينهار على صف ناقص', () => {
  assert.equal(kindOf({}), 'internal', 'صف بلا خانة ولا قرينة: تشغيل داخلي');
  assert.equal(svc.projectKind({}).stale, false, 'لا خانة مخزَّنة ⟵ لا تناقض يُدّعى');
  assert.equal(kindOf({ client_id: 'C_GOV' }), 'client', 'نوع العميل مجهول ⟵ العميل عميل حتى يثبت العكس');
  assert.equal(kindOf({ client_id: 'C_GOV', kind: 'external' }, { clientType: 'داخلي' }), 'internal',
    'حتى تصريح «لعميل» لا يجعل عملَ الشركة على نفسها مشروعَ عميل');
});

// ═════════════ (٢) الشاشة: الكلمة المعروضة ═════════════

test('صفحة المشروع: مشروع العميل لا تُطبع فوقه «داخلي» — والتناقض يُذكر في التلميح', async () => {
  const html = await pmo.projectDetailPage(admin, 'P_STALE');
  clean(html, 'صفحة المشروع');
  assert.match(html, />مشروع عميل</, 'الوسم يقول ما هو المشروع فعلاً');
  assert.equal(/>\s*داخلي\s*</.test(html), false, 'الكلمة القديمة اختفت من الوسم');
  assert.equal(/>\s*خارجي\s*</.test(html), false, 'ولا تعود ترجمة الخانة الحرفية بأي صورة');
  assert.match(html, /التصنيف: مشروع عميل — له عميل مسجَّل/, 'التلميح يقول من أين جاءت الكلمة');
  assert.match(html, /يقول غير ذلك ولم يُصحَّح بعد/, 'ولا يُخفي أن البيانات نفسها تحتاج تصحيحاً');
});

test('صفحة المشروع: عمل الشركة على نفسها يُسمّى «تشغيل داخلي» — لا «مشاريع داخلية» ولا «داخلي»', async () => {
  const html = await pmo.projectDetailPage(admin, 'P_SELF');
  clean(html, 'صفحة المشروع الداخلي');
  assert.match(html, />تشغيل داخلي</);
  assert.equal(/>\s*داخلي\s*</.test(html), false);
  assert.equal(html.includes('مشاريع داخلية'), false, 'قرار المالك: لا كيان بهذا الاسم');
  assert.match(html, /التصنيف: تشغيل داخلي — العميل المسجَّل هو الشركة نفسها/);
  assert.equal(/يقول غير ذلك/.test(html), false, 'لا تناقض هنا فلا يُدّعى تناقض');
});

test('صفحة المشروع: المنتج يُسمّى منتجاً، والمشروع بلا قرينة تشغيلاً داخلياً', async () => {
  const prod = await pmo.projectDetailPage(admin, 'P_PRODUCT');
  assert.match(prod, />منتج</);
  const plain = await pmo.projectDetailPage(admin, 'P_PLAIN');
  assert.match(plain, />تشغيل داخلي</);
});

test('العرض الصادق لا يلمس البيانات: الخانة كما هي ولا سطر تدقيق واحد', async () => {
  const auditsBefore = (await all('SELECT id FROM audit_log')).length;
  await pmo.projectDetailPage(admin, 'P_STALE');
  await pmo.projectsPage(admin, {});
  assert.equal((await prjRow('P_STALE')).kind, 'internal', 'تصحيح البيانات قرار مالك لا قرار شاشة');
  assert.equal((await all('SELECT id FROM audit_log')).length, auditsBefore, 'العرض لا يكتب شيئاً');
});

// ═════════════ (٣) الإيراد المعروض: من بنود الإيراد لا من خانة جامدة ═════════════

test('الإيراد لكل مشروع: استعلام مجمّع واحد، بسنة وبلا سنة، ولا ينسب بنداً بلا مشروع', async () => {
  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.project_id, r.revenue_halalas]));
  const allYears = byId(await svc.projectRevenue(['P_STALE', 'P_REV', 'P_PLAIN', 'P_GHOST']));
  assert.equal(allYears.P_STALE, 333000000, 'سنتان تُجمعان للمشروع الواحد');
  assert.equal(allYears.P_REV, 444000000);
  assert.equal(allYears.P_PLAIN, undefined, 'مشروع بلا بنود لا يظهر صفاً');
  assert.equal(allYears.P_GHOST, undefined, 'والخانة القديمة على الصف لا تصنع بنداً');
  const thisYear = byId(await svc.projectRevenue(['P_STALE', 'P_REV'], NOW_Y));
  assert.equal(thisYear.P_STALE, 111000000, 'السنة تُرشِّح البنود');
  assert.equal(thisYear.P_REV, undefined, 'ما لا إيراد له في السنة يغيب');
  assert.deepEqual(await svc.projectRevenue([]), [], 'بلا معرّفات: لا استعلام ولا نتيجة');
  assert.deepEqual(await svc.projectRevenue(['لا-وجود-له']), []);
  const totalAttributed = (await svc.projectRevenue(['P_STALE', 'P_REV', 'P_GHOST', 'P_PLAIN']))
    .reduce((a, r) => a + r.revenue_halalas, 0);
  assert.equal(totalAttributed, 777000000, 'البند بلا ربط مشروع لا يُنسب لأحد');
});

test('صفحة المشروع: «الإيراد المُثبت» يأتي من البنود — والرقم الشبح القديم لا يُعرض', async () => {
  const html = await pmo.projectDetailPage(admin, 'P_STALE');
  assert.match(html, /3,330,000/, 'مجموع بنود المشروع لكل السنوات');
  const ghost = await pmo.projectDetailPage(admin, 'P_GHOST');
  clean(ghost, 'صفحة المشروع ذي الرقم القديم');
  assert.equal(ghost.includes('9,876,543'), false, 'رقم لا يحدّثه شيء لا يبقى على الشاشة');
  // المبلغ يُنسَّق بفاصل غير قابل للكسر بين الرقم والعملة، وقبله علامة اتجاه — لذا \s و\b
  assert.match(ghost, /الإيراد المُثبت[\s\S]{0,220}?\b0\sر\.س/, 'لا إيراد مسجَّل ⟵ صفر صريح لا رقم موروث');
});

test('جدول المحفظة: عمود الإيراد وأساس القيمة من البنود الحيّة لا من الخانة', async () => {
  const html = await pmo.projectsPage(admin, {});
  clean(html, 'جدول المحفظة');
  assert.match(tableRow(html, 'P_STALE'), /3,330,000/, 'إيراد المشروع = مجموع بنوده');
  // مشروع بلا عقد ولا أمر شراء ولا ميزانية: أساس قيمته «إيراد محقق» ويأتي من البنود
  const revRow = tableRow(html, 'P_REV');
  assert.match(revRow, /4,440,000/);
  assert.match(revRow, /إيراد محقق/);
  // والرقم الشبح لا يظهر لا قيمةً ولا إيراداً
  assert.equal(html.includes('9,876,543'), false, 'الخانة الجامدة خرجت من الصفحة كلها');
  assert.match(tableRow(html, 'P_GHOST'), /بلا قيمة مسجلة/);
  // بطاقة الملخص تحسب إيراد السنة المعروضة وحدها (بند السنة الحالية فقط)
  assert.match(html, /الإيراد المحقق[\s\S]{0,200}1,110,000/);
  assert.equal(html.includes('9,990,000'), false, 'بند بلا مشروع لا يدخل مجموع المحفظة');
});
