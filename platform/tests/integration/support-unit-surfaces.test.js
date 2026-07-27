// وحدة المساندة لا تظهر «قطاعاً خامساً» في أي شاشة أعمال — الموجة 009، الحارس الثاني.
//
// الوعد الذي يحرسه هذا الملف بلسان المالك: قطاعات التسليم **أربعة** لا خامس لها. الترحيلة 009
// أضافت خانة النوع، لكن الخانة وحدها لا تحمي أحداً: كل شاشة تسرد الوحدات كلها كانت ستضع
// «الخدمات المشتركة» بجوار «قطاع الحلول» في مقارنة المالك بأصفار، وتجمع مستهدفها في مستهدف
// الشركة، وتعرضها خياراً في كل محوّل قطاع. لا شيء مكسور اليوم فقط لأن أول وحدة مساندة لم تُنشأ
// بعد في البيانات الحيّة — وهذا الملف يجب أن يسبقها.
//
// ما يُثبَت هنا (كل بند بوحدة مساندة **موجودة فعلاً** في البيانات، لا بغيابها):
//   (١) مقارنة القطاعات (companyOverview): الوحدة غائبة عن الصفوف وعن كل مجموع.
//   (٢) مستهدف المبيعات وتغطية خط الفرص: هدفٌ سُجّل سهواً على وحدة مساندة لا يتضخّم به مستهدف
//       الشركة ولا تنخفض به التغطية.
//   (٣) اختيار قطاع التقرير التلقائي: لا يقع على وحدة مساندة ولو كانت أول الجدول ترتيباً.
//   (٤) محوّلات القطاع في الصفحات (الفريق · التسكين · المشاريع · الفرص): لا شريحة ولا خيار.
//   (٥) وفي المقابل — وهو نصف الوعد الآخر — الوحدة **حاضرة** حيث تُدار: شجرة الهيكل، وخانة
//       القطاع في نافذة إضافة موظف، واسمها في عمود «القطاع» لموظفيها. إخفاؤها هناك يفقدها
//       أشخاصها ويجعل «الخدمات المشتركة» وحدة لا يمكن تسكين أحد فيها أصلاً.
//   (٦) لوحة وحدة المساندة تعمل ولا تُرفض، لكنها لا تدّعي هدفاً (قرار موثَّق في metrics.js).
//   (٧) نقل فرصة إلى وحدة مساندة مرفوض في **الخدمة** لا في الشاشة وحدها — بلا صف يُكتب وبلا
//       سطر تدقيق (اختفاء صامت لفرصة من مقارنة القطاعات هو عين ما نمنعه).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sanad-supsurf-'));
process.env.SANAD_DB = join(dir, 't.db');

const T = '2026-01-01T00:00:00.000Z';
const YEAR = 2026; // = config.fiscalYear الافتراضية

const { migrate } = await import('../../scripts/migrate.js');
const { seedRbac } = await import('../../scripts/seed-rbac.js');
const { all, get, insert, close } = await import('../../src/core/db/index.js');

const U = (id, role, sector, scope) => ({ id, username: id, name_ar: 'مستخدم ' + id, role_id: role,
  sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });
const admin = U('u_admin', 'admin', null, 'company');
const sharedLead = U('u_shared', 'sector_lead', 'SHARED', 'sector'); // شخص وحدته وحدة مساندة
const CTX = (user) => ({ user, ip: '127.0.0.1' });

// أهداف بالهللات — رقم مميز لكل وحدة كي يظهر أثر أي مجموع خاطئ في الرقم نفسه لا في الاتجاه فقط
const TGT = { SOLUTIONS: 30_000_000, CONSULTING: 20_000_000, SHARED: 7_777_777 };

let metrics, engine, org, opps, clients, pagesPeople, pagesPmo, pagesCrm, pagesSector;

before(async () => {
  await migrate();
  await seedRbac();
  const { initRbac } = await import('../../src/core/rbac/index.js');
  await initRbac();
  metrics = await import('../../src/core/reports/metrics.js');
  engine = await import('../../src/core/reports/engine.js');
  org = await import('../../src/modules/org/org.js');
  opps = await import('../../src/modules/crm/opportunities.js');
  clients = await import('../../src/modules/clients/clients.js');
  pagesPeople = await import('../../src/web/views/people.js');
  pagesPmo = await import('../../src/web/views/pmo.js');
  pagesCrm = await import('../../src/web/views/crm.js');
  pagesSector = await import('../../src/web/views/sector.js');

  // ── الوحدات: قطاعا تسليم + وحدة مساندة ترتيبها **الأول** (لتُختار تلقائياً لولا الترشيح) ──
  await insert('sector', { id: 'SHARED', name_ar: 'الخدمات المشتركة', kind: 'support', active: 1,
    sort_order: 1, target_sales_halalas: TGT.SHARED, target_revenue_halalas: 5_000_000, created_at: T });
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1,
    sort_order: 2, target_sales_halalas: TGT.SOLUTIONS, target_revenue_halalas: 40_000_000, created_at: T });
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1,
    sort_order: 3, target_sales_halalas: TGT.CONSULTING, target_revenue_halalas: 10_000_000, created_at: T });
  await insert('department', { id: 'D_SMART', sector_id: 'SOLUTIONS', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });

  for (const u of [admin, sharedLead]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar,
      role_id: u.role_id, sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await insert('stage', { id: 'LEAD', name_ar: 'مبدئية', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, sort_order: 9, is_won: 1, is_lost: 0 });

  await insert('client', { id: 'C1', name_ar: 'أمانة المنطقة', type: 'حكومي', created_at: T });
  await insert('project', { id: 'P_SOL', name_ar: 'منظومة رصد الحافلات', sector_id: 'SOLUTIONS',
    client_id: 'C1', status: 'IN_PROGRESS', contract_value_halalas: 12_000_000, created_at: T });
  // مشروع مسجَّل على وحدة المساندة بلا عميل: الحالة التي يظهر فيها اسم الوحدة سطراً تعريفياً
  await insert('project', { id: 'P_SH', name_ar: 'تطوير الأنظمة الداخلية', sector_id: 'SHARED',
    status: 'IN_PROGRESS', created_at: T });

  // فرصة مكسوبة في الحلول + فرصة مفتوحة في الاستشارات (لخط الفرص والتغطية)
  await insert('opportunity', { id: 'O_WON', title_ar: 'صفقة الحلول', sector_id: 'SOLUTIONS', client_id: 'C1',
    stage_id: 'WON', value_halalas: 9_000_000, win_pct: 100, year: YEAR, exclude_from_sales: 0, created_at: T });
  await insert('opportunity', { id: 'O_OPEN', title_ar: 'فرصة الاستشارات', sector_id: 'CONSULTING', client_id: 'C1',
    stage_id: 'LEAD', value_halalas: 4_000_000, win_pct: 40, year: YEAR, created_at: T });
  // فرصة مسجَّلة سهواً على وحدة المساندة — تُثبت أنها لا تدخل مقارنة ولا شارة عميل
  await insert('opportunity', { id: 'O_SH', title_ar: 'فرصة على وحدة مساندة', sector_id: 'SHARED', client_id: 'C1',
    stage_id: 'LEAD', value_halalas: 1_000_000, win_pct: 50, year: YEAR, created_at: T });

  await insert('revenue_line', { id: 'R_SOL', sector_id: 'SOLUTIONS', project_id: 'P_SOL',
    year: YEAR, month: 3, amount_halalas: 6_000_000, created_at: T });
  await insert('revenue_line', { id: 'R_SH', sector_id: 'SHARED', year: YEAR, month: 3,
    amount_halalas: 1_500_000, created_at: T });

  await insert('employee', { id: 'E_SH1', name_ar: 'أمل القحطاني', sector_id: 'SHARED', active: 1, created_at: T });
  await insert('employee', { id: 'E_SOL1', name_ar: 'سارة الحربي', sector_id: 'SOLUTIONS',
    department_id: 'D_SMART', active: 1, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const NO_LEAK = [/undefined/, /\bNaN\b/, /\[object/];
const clean = (html, where) => { for (const rx of NO_LEAK) assert.ok(!rx.test(html), `${where}: تسرّب ${rx}`); };
// محتوى كتلة البيانات المُسلَّمة للمتصفّح (window.__SANAD) — قوائم النوافذ تُقرأ منها لا من الشرائح
const sanadBlob = (html) => (html.match(/window\.__SANAD=[\s\S]*?<\/script>/g) || []).join('\n');

// ═════════════════ (١) مقارنة القطاعات: أربعة لا خمسة ═════════════════

test('مقارنة القطاعات لا تعرض وحدة المساندة صفاً — ولا في مجاميعها', async () => {
  const ov = await metrics.companyOverview(admin, { year: YEAR });
  const ids = ov.sectors.map((s) => s.id);
  assert.deepEqual(ids, ['SOLUTIONS', 'CONSULTING'], 'قطاعات التسليم وحدها وبترتيبها');
  assert.equal(ids.includes('SHARED'), false, 'الخدمات المشتركة ليست قطاعاً في لوحة المالك');
  assert.equal(ov.sectors.some((s) => s.name_ar === 'الخدمات المشتركة'), false);
  // المجاميع: هدف المبيعات = هدفا التسليم فقط، والإيراد لا يشمل سطر إيراد وحدة المساندة
  assert.equal(ov.totals.target_sales, TGT.SOLUTIONS + TGT.CONSULTING);
  assert.equal(ov.totals.target_revenue, 40_000_000 + 10_000_000);
  assert.equal(ov.totals.revenue, 6_000_000, 'إيراد الحلول وحده — سطر وحدة المساندة خارج المقارنة');
  assert.equal(ov.totals.sales, 9_000_000);
});

test('صفٌّ خامس بأصفار هو الضرر بعينه: لو دخلت الوحدة لتغيّر متوسط الإنجاز', async () => {
  // الحارس بصيغة الأثر لا بصيغة القائمة: نسبة الإنجاز المعروضة تُحسب على قطاعات التسليم فقط
  const ov = await metrics.companyOverview(admin, { year: YEAR });
  const attain = Math.round((ov.totals.sales / ov.totals.target_sales) * 100);
  const withSupport = Math.round((ov.totals.sales / (ov.totals.target_sales + TGT.SHARED)) * 100);
  assert.notEqual(attain, withSupport, 'الفرق حقيقي — الترشيح ليس تجميلاً');
  assert.equal(attain, 18);
});

// ═════════════════ (٢) المستهدف والتغطية ═════════════════

test('مستهدف المبيعات على مستوى الشركة يجمع قطاعات التسليم وحدها', async () => {
  const cov = await metrics.pipelineCoverage(null, YEAR);
  const remaining = TGT.SOLUTIONS + TGT.CONSULTING - 9_000_000; // المستهدف − المكسوب
  assert.equal(cov.remaining_target_halalas, remaining);
  assert.notEqual(cov.remaining_target_halalas, remaining + TGT.SHARED, 'لا هدف وحدة مساندة في الحساب');
  // خط الفرص المفتوح يبقى كما هو (لا يمس هذا الترشيح الفرص)
  assert.equal(cov.open_halalas, 4_000_000 + 1_000_000);
});

test('طلب التغطية لوحدة مساندة بعينها: لا هدف ⟵ لا نسبة موهومة', async () => {
  const cov = await metrics.pipelineCoverage('SHARED', YEAR);
  assert.equal(cov.remaining_target_halalas, 0, 'وحدة المساندة لا تُقاس بمستهدف مبيعات');
  assert.equal(cov.coverage, null, 'ولا تُعرض لها نسبة تغطية');
});

// ═════════════════ (٣) اختيار قطاع التقرير التلقائي ═════════════════

test('تقرير أداء القطاع لا يقع تلقائياً على وحدة مساندة ولو كانت أول الترتيب', async () => {
  const first = await get('SELECT id FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order LIMIT 1');
  assert.equal(first.id, 'SHARED', 'المقدّمة: الوحدة فعلاً أول الجدول ترتيباً');
  const data = await engine.buildReport('monthly_sector_performance', admin, { year: YEAR });
  assert.equal(data.sectorName, 'قطاع الحلول', 'أول قطاع تسليم — لا أول صف في الجدول');
  assert.notEqual(data.sectorName, 'الخدمات المشتركة');
});

// ═════════════════ (٤) محوّلات القطاع في الصفحات ═════════════════

test('صفحة الفريق: لا شريحة قطاع لوحدة المساندة — واسمها باقٍ على موظفيها', async () => {
  const html = await pagesPeople.teamPage(admin, {});
  clean(html, 'صفحة الفريق');
  assert.match(html, /\/app\/team\?sector=SOLUTIONS/, 'شرائح قطاعات التسليم كما كانت');
  assert.equal(html.includes('/app/team?sector=SHARED'), false, 'لا شريحة «قطاع» لوحدة مساندة');
  // النصف الآخر من الوعد: الشخص وحدته مذكورة، ولا يظهر بقطاع فارغ
  assert.match(html, /أمل القحطاني/);
  assert.match(html, /الخدمات المشتركة/, 'اسم الوحدة يظهر في عمود القطاع لموظفيها');
  // وخانة القطاع في نافذة إضافة/تعديل موظف تشمل الوحدة، وإلا استحال تسكين أحد فيها
  assert.match(sanadBlob(html), /teamSectors[\s\S]*SHARED/, 'الوحدة خيار متاح عند إضافة موظف');
});

test('صفحة التسكين: لا شريحة قطاع لوحدة المساندة، ولا «خارج القطاعات» لموظفيها', async () => {
  const html = await pagesPeople.staffingPage(admin, {});
  clean(html, 'صفحة التسكين');
  assert.match(html, /\/app\/staffing\?sector=CONSULTING/);
  assert.equal(html.includes('/app/staffing?sector=SHARED'), false);
  // سطر الشخص يحمل اسم وحدته لا «خارج القطاعات» (وهي عبارة قائمة في الصفحة كعنوان مجموعة،
  // فالفحص على سطره هو وحده): الاسم ثم سطر الوصف الذي يحمل الوحدة.
  assert.match(html, /أمل القحطاني[\s\S]{0,300}الخدمات المشتركة/,
    'موظفة وحدة المساندة تُنسب إلى وحدتها لا إلى الفراغ');
});

test('صفحة المشاريع: لا شريحة ولا خيار «قطاع» لوحدة المساندة', async () => {
  const html = await pagesPmo.projectsPage(admin, {});
  clean(html, 'صفحة المشاريع');
  assert.match(html, /\/app\/projects\?sector=SOLUTIONS/);
  assert.equal(html.includes('/app/projects?sector=SHARED'), false, 'لا شريحة تصفية');
  assert.equal(sanadBlob(html).includes('SHARED'), false, 'ولا خيار في نافذة «مشروع جديد»');
  // ولا يختفي عمل قائم: مشروع مسجَّل على الوحدة يبقى في المحفظة، وسطره يحمل اسم وحدته لا فراغاً
  assert.match(html, /تطوير الأنظمة الداخلية/, 'الترشيح على القوائم لا على العمل نفسه');
  assert.match(html, /تطوير الأنظمة الداخلية[\s\S]{0,400}الخدمات المشتركة/,
    'جدول الأسماء غير مرشَّح عمداً: ترشيحه يمحو الاسم ولا يمنع ظهور السطر');
});

test('صفحة الفرص: لا شريحة ولا خيار ولا وجهة نقل إلى وحدة مساندة', async () => {
  const html = await pagesCrm.opportunitiesPage(admin, {});
  clean(html, 'صفحة الفرص');
  assert.match(html, /\/app\/opportunities\?sector=SOLUTIONS/);
  assert.equal(html.includes('/app/opportunities?sector=SHARED'), false);
  assert.equal(sanadBlob(html).includes('"SHARED"'), false, 'قائمة القطاعات المُسلَّمة للمتصفّح بلا وحدة مساندة');
  // وفي الوقت نفسه لا تختفي فرصة قائمة من اللوحة: الترشيح على قائمة القطاعات لا على الفرص
  assert.match(html, /فرصة على وحدة مساندة/, 'ما كان ظاهراً يبقى ظاهراً — لا اختفاء صامت');
});

test('مركز القيادة: محوّل القطاع بلا وحدة مساندة', async () => {
  const html = await pagesSector.sectorPage(admin, { year: YEAR });
  clean(html, 'مركز القيادة');
  assert.match(html, /sector=SOLUTIONS/, 'قطاعات التسليم في المحوّل');
  assert.equal(html.includes('sector=SHARED'), false, 'ولا وحدة مساندة فيه');
});

test('صفحة من وحدته وحدة مساندة تُفتح ولا تقول له «لا يوجد قطاع مرتبط بحسابك»', async () => {
  // هذا هو الوجه الآخر لقرار metrics.js: الرفض كان سيُفرغ الصفحة الرئيسية لشخص لم يخطئ.
  const html = await pagesSector.sectorPage(sharedLead, { year: YEAR });
  clean(html, 'مركز قيادة وحدة مساندة');
  assert.equal(html.includes('لا يوجد قطاع مرتبط بحسابك'), false);
  assert.match(html, /الخدمات المشتركة/, 'الصفحة باسم وحدته');
  assert.match(html, /لا هدف مسجّل لهذه السنة/, 'وبلا نسبة إنجاز موهومة أمام هدف لا وجود له');
});

test('شارات قطاعات العميل: قطاعات التسليم وحدها', async () => {
  const rows = await clients.listClients(admin, {});
  const c1 = rows.find((r) => r.id === 'C1');
  assert.deepEqual(c1.sectors, ['قطاع الحلول', 'قطاع الاستشارات'], 'حسب الترتيب، وبلا وحدة مساندة');
  assert.equal(c1.sectors.includes('الخدمات المشتركة'), false);
  assert.ok(c1.open_opps >= 2, 'أرقام العميل لم تُمسّ — الترشيح على الشارات وحدها');
});

// ═════════════════ (٥) الوحدة حاضرة حيث تُدار ═════════════════

test('شجرة الهيكل تعرض وحدة المساندة كاملةً بموظفيها', async () => {
  const tree = await org.orgTree(admin);
  const ids = tree.map((s) => s.id);
  assert.deepEqual(ids, ['SHARED', 'SOLUTIONS', 'CONSULTING'], 'الوحدات كلها بترتيبها — بلا ترشيح نوع');
  const shared = tree.find((s) => s.id === 'SHARED');
  assert.equal(shared.kind, 'support', 'النوع مرافق للصف كي تميّزه الشاشة');
  assert.equal(shared.employees, 1, 'موظفوها محسوبون — لو رُشّحت الشجرة لاختفوا من المنصة كلها');
});

test('قائمة قطاعات التسليم وشجرة الهيكل لا تفترقان إلا في وحدات المساندة', async () => {
  const delivery = (await org.listDeliverySectors()).map((s) => s.id).sort();
  const tree = (await org.orgTree(admin)).map((s) => s.id).sort();
  assert.deepEqual(delivery, ['CONSULTING', 'SOLUTIONS']);
  assert.deepEqual(tree.filter((id) => !delivery.includes(id)), ['SHARED']);
});

// ═════════════════ (٦) لوحة وحدة المساندة: تعمل ولا تدّعي هدفاً ═════════════════

test('لوحة وحدة المساندة لا تُرفض — لكنها بلا مستهدف ومعلَّمة بنوعها', async () => {
  const sd = await metrics.sectorDashboard(admin, 'SHARED', { year: YEAR });
  assert.ok(sd, 'لا رفض: موظف الوحدة يفتح صفحته ولا يجد رسالة «لا يوجد قطاع مرتبط بحسابك»');
  assert.equal(sd.sector.is_support, true);
  assert.equal(sd.sector.kind, 'support');
  assert.equal(sd.target_sales_halalas, null, 'لا هدف مبيعات ⟵ لا نسبة إنجاز على الشريط');
  assert.equal(sd.target_revenue_halalas, null);
  assert.equal(sd.revenue_halalas, 1_500_000, 'أما المحقق الفعلي فيبقى كما هو — إخفاؤه كذبة ثانية');
});

test('لوحة قطاع التسليم لم تتغيّر: مستهدفاتها كما هي ومعلَّمة أنها ليست وحدة مساندة', async () => {
  const sd = await metrics.sectorDashboard(admin, 'SOLUTIONS', { year: YEAR });
  assert.equal(sd.sector.is_support, false);
  assert.equal(sd.target_sales_halalas, TGT.SOLUTIONS);
  assert.equal(sd.target_revenue_halalas, 40_000_000);
  assert.equal(sd.revenue_halalas, 6_000_000);
});

// ═════════════════ (٧) الخدمة ترفض نقل فرصة إلى وحدة مساندة ═════════════════

test('نقل فرصة إلى وحدة مساندة مرفوض برسالة عربية — بلا كتابة وبلا سطر تدقيق', async () => {
  const auditsBefore = (await all('SELECT id FROM audit_log')).length;
  await assert.rejects(() => opps.moveSector(CTX(admin), 'O_OPEN', 'SHARED'), (e) => {
    assert.equal(e.status, 400);
    assert.match(e.message, /وحدة مساندة/);
    assert.match(e.message, /اختر قطاعاً/);
    return true;
  });
  assert.equal((await get('SELECT sector_id FROM opportunity WHERE id = ?', ['O_OPEN'])).sector_id, 'CONSULTING');
  assert.equal((await all('SELECT id FROM audit_log')).length, auditsBefore, 'الرفض لا يترك أثر كتابة');
});

test('النقل بين قطاعَي تسليم يبقى عاملاً ومدقَّقاً — لم يُغلق الباب على الاستعمال الصحيح', async () => {
  const r = await opps.moveSector(CTX(admin), 'O_OPEN', 'SOLUTIONS', 'مناولة');
  assert.equal(r.sector_id, 'SOLUTIONS');
  const rows = await all('SELECT * FROM audit_log WHERE resource = ? AND resource_id = ? ORDER BY at, id',
    ['opportunity', 'O_OPEN']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'update');
  assert.equal(rows[0].sector_id, 'SOLUTIONS');
  assert.match(JSON.parse(rows[0].detail_json).moveSector, /CONSULTING→SOLUTIONS/);
});
