// شاشة «حركة المال على المشروع» داخل صفحة تفاصيل المشروع.
//
// ما تثبته هذه الاختبارات هو بالضبط ما يسهل أن تكذب فيه شاشةٌ مالية:
//   • **الغياب والتقييد والصفر ثلاث حالات لا تتشابه**: ما لم يُسجَّل يُكتب «غير مُسجَّل» ولا يظهر
//     مكانه «٠ ريال» أبداً؛ وما هو محجوب عن الدور يُكتب «مقيَّد» ويُقال سببه؛ والصفر لا يظهر إلا
//     حيث يوجد تسجيل فعلاً.
//   • الجسر المالي يُعرض مراحل متتابعة لا تُجمع (قيمة التعاقد ← الإيراد ← المفوتر ← المحصَّل).
//   • من لا يملك بوابة الكلفة يرى العدد ولا يرى مبلغاً، ولا يتسرب رقم راتب إلى الوسم أصلاً.
//   • الموردون والاشتراكات: تُعرض حالتهما المعلنة وما ينقص وبديله، ولا يُخترع لهما رقم.
//   • كل بند في `gaps` يظهر على الشاشة — النقص يُقال ولا يُبتلع.
//   • ولا يتسرب إلى الوسم نصٌّ تقني ولا قيمة فارغة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-money-view-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { config } = await import('../../src/core/config.js');
const { projectDetailPage } = await import('../../src/web/views/pmo.js');
const { fmtSar } = await import('../../src/core/util/ids.js');

const YR = config.fiscalYear;
const T = `${YR}-01-05T08:00:00.000Z`;
const SALARY = 7_654_321;                       // رقم مميّز يُبحث عنه حرفياً في الوسم
const U = (o) => ({ projectIds: new Set(), teamIds: new Set(), scope: 'own', sector_id: null, ...o });
const finance = U({ id: 'u_fin', username: 'fin1', name_ar: 'المالية', role_id: 'ceo_office', scope: 'company' });
const lead = U({ id: 'u_l1', username: 'lead1', name_ar: 'قائد القطاع', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' });
const proc = U({ id: 'u_pr', username: 'proc1', name_ar: 'المشتريات', role_id: 'procurement', scope: 'company' });
const pm = U({ id: 'u_pm', username: 'pm1', name_ar: 'مدير المشروع', role_id: 'project_manager',
  sector_id: 'S1', scope: 'project', projectIds: new Set(['P1', 'P2', 'P3']) });

// قسم المال وحده من الصفحة — كي لا يخلط الفحصُ أرقامَ بقية البطاقات بأرقامه.
// الحدّان مأخوذان من **مُعرِّفَي القسمين** لا من عنوانٍ مكتوب داخلهما: العناوين نصٌّ عربي
// يتغيّر بالمراجعة اللغوية، فربطُ الفحص بها يجعله يسقط عند تحرير كلمة. و`data-sec` عقدُ بنية.
function moneyOf(html) {
  const start = html.indexOf('data-sec="money"');
  assert.ok(start > 0, 'قسم مال المشروع موجود في الصفحة');
  const end = html.indexOf('data-sec="files"', start);
  return html.slice(start, end > start ? end : html.length);
}
const clean = (html) => html.replace(/<template[\s\S]*?<\/template>/g, ' ');

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_pm', username: 'pm1', name_ar: 'مدير المشروع', role_id: 'project_manager',
    sector_id: 'S1', scope: 'project', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_fin', username: 'fin1', name_ar: 'المالية', role_id: 'ceo_office',
    scope: 'company', active: 1, created_at: T });
  await db.insert('employee', { id: 'EMP1', name_ar: 'سارة العتيبي', job_title: 'مستشار أول', sector_id: 'S1',
    active: 1, salary_halalas: SALARY, created_at: T });
  await db.insert('client', { id: 'CL1', name_ar: 'وزارة الاقتصاد', created_at: T });

  // P1: مشروع كامل الحركة — فوترة وتحصيل ومصروفات وكلفة وتسكين
  await db.insert('project', { id: 'P1', name_ar: 'مشروع المال الكامل', code: 'PRJ-1', client_id: 'CL1',
    sector_id: 'S1', owner_user_id: 'u_pm', status: 'IN_PROGRESS', progress_pct: 40,
    contract_value_halalas: 1_000_000, actual_spend_halalas: 400_000,
    start_date: `${YR}-01-01`, end_date: `${YR}-12-31`, created_at: T });
  // P2: مشروع بلا أي حركة مالية — لا فواتير ولا تحصيل ولا مصروف ولا تسكين
  await db.insert('project', { id: 'P2', name_ar: 'مشروع بلا حركة', sector_id: 'S1', owner_user_id: 'u_pm',
    status: 'IN_PROGRESS', created_at: T });
  // P3: حركته كلها في السنة الماضية — يجب أن يقول ذلك بدل أن يُقرأ فارغاً
  await db.insert('project', { id: 'P3', name_ar: 'مشروع السنة الماضية', sector_id: 'S1', owner_user_id: 'u_pm',
    status: 'IN_PROGRESS', created_at: T });

  await db.insert('invoice', { id: 'INV1', code: 'INV-1', project_id: 'P1', client_id: 'CL1', sector_id: 'S1',
    amount_halalas: 300_000, retention_halalas: 20_000, status: 'ISSUED', issue_date: `${YR}-02-10`, created_at: T });
  await db.insert('invoice', { id: 'INV2', code: 'INV-2', project_id: 'P1', client_id: 'CL1', sector_id: 'S1',
    amount_halalas: 150_000, status: 'DRAFT', issue_date: `${YR}-03-01`, created_at: T });
  await db.insert('collection', { id: 'C1', invoice_id: 'INV1', amount_halalas: 120_000,
    collected_at: `${YR}-02-20`, method: 'تحويل', created_at: T });
  await db.insert('revenue_line', { id: 'RL1', project_id: 'P1', sector_id: 'S1', amount_halalas: 250_000,
    month: 2, year: YR, label: 'دفعة أولى', auto: 0, created_at: T });
  await db.insert('cost_line', { id: 'CL1', project_id: 'P1', sector_id: 'S1', type: 'رواتب',
    amount_halalas: 400_000, month: 2, year: YR, source: 'migration', created_at: T });

  const e = (id, type, amount, month, status) => db.insert('expense', { id, project_id: 'P1', sector_id: 'S1',
    type, amount_halalas: amount, incurred_month: month, incurred_year: YR, requested_by: 'u_fin',
    status, created_at: T });
  await e('E1', 'سفر ميداني', 50_000, 2, 'PAID');
  await e('E2', 'سفر ميداني', 40_000, 3, 'PAID');
  await e('E3', 'طباعة تقارير', 20_000, 3, 'APPROVED');
  await e('E4', 'ضيافة اجتماع', 10_000, 4, 'DRAFT');

  await db.insert('allocation', { id: 'A1', employee_id: 'EMP1', person_name_ar: 'سارة العتيبي', project_id: 'P1',
    project_name: 'مشروع المال الكامل', sector_id: 'S1', type: 'lead', monthly_json: '{"2":1,"3":0.5}',
    year: YR, source: 'manual', created_at: T });

  // P3: تحصيل ومصروف وتسكين في السنة الماضية وحدها
  await db.insert('invoice', { id: 'INV3', code: 'INV-3', project_id: 'P3', sector_id: 'S1',
    amount_halalas: 200_000, status: 'ISSUED', issue_date: `${YR - 1}-05-10`, created_at: T });
  await db.insert('collection', { id: 'C3', invoice_id: 'INV3', amount_halalas: 200_000,
    collected_at: `${YR - 1}-06-01`, method: 'تحويل', created_at: T });
  await db.insert('allocation', { id: 'A3', employee_id: 'EMP1', person_name_ar: 'سارة العتيبي', project_id: 'P3',
    sector_id: 'S1', type: 'lead', monthly_json: '{"6":1}', year: YR - 1, source: 'manual', created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── ① الشاشة تظهر لمن يملكها، وتقول قصة المال كاملة ─────────────────────────────────────────
test('القسم يُعرض لدور مسموح: الجسر مراحل لا تُجمع، والحركة الشهرية، وسجل المصروفات', async () => {
  const html = await projectDetailPage(finance, 'P1');
  const m = moneyOf(html);
  assert.ok(m.includes('حركة المال على المشروع'), 'عنوان القسم');
  assert.ok(html.includes('/static/pages/project-money.js'), 'ملف الصفحة الخاص بالقسم مُحمَّل');

  // الجسر: خمس مراحل مرقّمة يفصلها «ثم» — ولا مجموع في أي موضع
  for (const label of ['قيمة التعاقد', 'الإيراد المحقق', 'المفوتر', 'المحصَّل', 'المستحق']) {
    assert.ok(m.includes(label), `مرحلة «${label}» ظاهرة`);
  }
  assert.equal((m.match(/مرحلة <span class="tnum">\d<\/span> من/g) || []).length, 5, 'المراحل الخمس مرقّمة');
  assert.ok(m.includes('أضلاع متتابعة لا تُجمع'), 'يُقال صراحةً إنها لا تُجمع');
  assert.ok(!/المجموع الكلي|إجمالي الجسر/.test(m), 'لا مجموع للجسر في أي موضع');

  // الأرقام كما قالتها الخدمة: مفوتر 3,000 ريال · محصَّل 1,200 · مستحق 3,000−200−1,200
  assert.ok(m.includes(fmtSar(300_000)), 'المفوتر بقيمته');
  assert.ok(m.includes(fmtSar(120_000)), 'المحصَّل بقيمته');
  assert.ok(m.includes(fmtSar(160_000)), 'المستحق = المفوتر − المحتجز − المحصَّل');
  assert.ok(m.includes(fmtSar(150_000)), 'المسودة تُذكر منفصلة');

  // الحركة الشهرية: المفوتر بجوار المحصَّل بجوار المدفوع + شريط الأشهر الاثني عشر
  assert.ok(m.includes('الحركة الشهرية'), 'قسم الحركة الشهرية');
  assert.ok(m.includes('الداخل النقدي') && m.includes('الخارج النقدي'), 'الداخل والخارج معاً');
  for (const mn of ['يناير', 'ديسمبر']) assert.ok(m.includes(mn), `شريط الأشهر يحمل ${mn}`);
  assert.ok(m.includes('dd-money-months-' + YR), 'نافذة تفصيل الأشهر مبنيّة على الخادم');
  assert.ok(m.includes('data-action="money-dd"'), 'فتح النافذة عبر إجراء مفوَّض لا onclick');
  assert.ok(!/onclick=/.test(clean(m)), 'لا onclick داخل وسوم القسم');

  // المصروفات: التجميع حسب الوصف + الصفوف + شريط التسجيل
  assert.ok(m.includes('سجل المصروفات'), 'سجل المصروفات');
  assert.ok(m.includes('سفر ميداني') && m.includes('طباعة تقارير'), 'المصروفات مجمَّعة بوصفها');
  assert.ok(m.includes('data-action="exp-add"'), 'زر تسجيل المصروف متاح للمالية');
  assert.ok(m.includes('data-action="exp-edit"'), 'تعديل المصروف المفتوح متاح');
  assert.ok(m.includes('data-action-change="exp-status"'), 'اعتماد المصروف متاح لمن يملكه');
  assert.ok(m.includes('مرفوع للاعتماد'), 'الحالات بمعناها العربي');

  // التسكين بالنسب، وكلفة الشخص غير متاحة مع تعليل ظاهر
  assert.ok(m.includes('سارة العتيبي'), 'المسكَّن باسمه');
  assert.ok(m.includes('كلفة التسكين لكل شخص'), 'عنوان سبب غياب كلفة التسكين');
  assert.ok(m.includes('تقدير لا قياس'), 'السبب منصوص لا فراغ');
});

test('لا تسرّب تقني ولا قيمة فارغة في وسم القسم', async () => {
  for (const u of [finance, lead, proc, pm]) {
    const m = moneyOf(await projectDetailPage(u, 'P1'));
    for (const bad of ['undefined', 'NaN', '[object', '>null<', 'Infinity']) {
      assert.ok(!m.includes(bad), `${u.role_id}: لا يظهر «${bad}» في الوسم`);
    }
  }
});

// ── ② الحجب على الحقل لا على الصفحة ─────────────────────────────────────────────────────────
test('دور بلا بوابة الكلفة: يرى العدد ويقرأ «مقيَّد» بدل المبلغ، ولا رقم راتب في الوسم', async () => {
  const html = await projectDetailPage(proc, 'P1');
  const m = moneyOf(html);
  assert.ok(m.includes('مقيَّد'), 'المبالغ المحجوبة تُسمّى مقيَّدة');
  assert.ok(m.includes('مبالغ المصروفات محجوبة عن دورك'), 'سبب الحجب منصوص');
  assert.ok(m.includes('سفر ميداني'), 'الوصف والعدد يظهران — الحجب على المبلغ وحده');
  for (const v of [50_000, 40_000, 90_000, 20_000]) {
    assert.ok(!m.includes(fmtSar(v)), `مبلغ المصروف ${v} لا يظهر لمن لا يملك بوابة الكلفة`);
  }
  // الراتب مختوم في كل الأدوار — لا صيغته الخام ولا صيغته المعروضة
  for (const u of [finance, lead, proc, pm]) {
    const page = await projectDetailPage(u, 'P1');
    assert.ok(!page.includes(String(SALARY)), `${u.role_id}: لا رقم راتب خام`);
    assert.ok(!page.includes(fmtSar(SALARY)), `${u.role_id}: ولا راتب معروضاً بالريال`);
    assert.ok(!/salary/i.test(page), `${u.role_id}: لا حقل راتب في الوسم`);
  }
});

test('مدير المشروع يرى نِسَب التسكين وفوترة مشروعه — ولا يسجّل مصروفاً', async () => {
  const m = moneyOf(await projectDetailPage(pm, 'P1'));
  assert.ok(m.includes('سارة العتيبي'), 'النِّسَب حق تشغيلي');
  assert.ok(m.includes('قيمة المشروع'), 'ومالية مشروعه صارت له — قرار مالك نقض الحجب السابق');
  assert.ok(m.includes('خارج صلاحيات دورك'), 'وما بقي محجوباً (المصروفات) يُقال سببه لا يُسكت عنه');
  assert.ok(!m.includes('data-action="exp-add"'), 'ولا شريط تسجيل مصروف لمن لا يملك التسجيل');
});

// ── ③ الغياب ليس صفراً ──────────────────────────────────────────────────────────────────────
test('مشروع بلا حركة: تُكتب حالة الغياب ولا يظهر صفر مكانها', async () => {
  const m = clean(moneyOf(await projectDetailPage(finance, 'P2')));
  assert.ok(m.includes('غير مُسجَّل') || m.includes('لم يُسجَّل تحصيل'), 'الغياب مكتوب');
  assert.ok(m.includes('لا مصروفات مسجّلة على هذا المشروع'), 'سجل المصروفات يقول إنه لم يُسجَّل شيء');
  assert.ok(m.includes('الغياب هنا يعني أن شيئاً لم يُسجَّل بعد، لا أن المصروف صفر'), 'الفرق منصوص للمستخدم');
  // ولا صفرٌ في أي صيغة: لا «٠» العربية ولا «0 ريال» المعروضة
  assert.ok(!m.includes('٠'), 'لا صفر عربي في شاشة مشروع بلا تسجيل');
  assert.ok(!m.includes(fmtSar(0)), 'ولا «0 ر.س.» مكان ما لم يُسجَّل');
  assert.ok(!/>\s*0\s*</.test(m), 'ولا رقم صفر معروضاً وحده');
});

test('كل بند نقص يقوله المحرّك يظهر على الشاشة', async () => {
  const { projectMoney } = await import('../../src/modules/finance/finance.js');
  const payload = await projectMoney(finance, 'P2');
  const m = moneyOf(await projectDetailPage(finance, 'P2'));
  assert.ok(payload.gaps.length >= 4, 'المحرّك يرصد نقصاً');
  for (const g of payload.gaps) {
    assert.ok(m.includes(g.title_ar), `النقص «${g.title_ar}» معروض`);
    assert.ok(m.includes(g.detail_ar.slice(0, 40)), `وشرحه معه: ${g.key}`);
  }
});

// ── ④ الموردون والاشتراكات: حالة معلنة لا رقم مخترع ─────────────────────────────────────────
test('الموردون والاشتراكات: تُشرح حالتهما ويُقال ما ينقص وبديله المتاح', async () => {
  const m = moneyOf(await projectDetailPage(finance, 'P1'));
  assert.ok(m.includes('الموردون') && m.includes('الاشتراكات'), 'القسمان ظاهران');
  assert.ok(m.includes('لا مسار لتسجيله بعد'), 'حالة الموردين معلنة');
  assert.ok(m.includes('بلا سجل في المنصة'), 'حالة الاشتراكات معلنة');
  assert.ok(m.includes('ما يحتاجه التسجيل'), 'ما ينقص مكتوب');
  assert.ok(m.includes('البديل المتاح اليوم'), 'وبديله اليوم مكتوب');
  assert.ok(m.includes('غيابه ليس صفراً'), 'ويُقال إن الغياب ليس صفراً');
  assert.ok(m.includes('وصفٌ للمسجَّل'), 'المتكرر يُسمّى وصفاً للمسجَّل لا سجل اشتراكات');
  assert.ok(m.includes('لا سجل اشتراكات'), 'ولا يُقدَّم بديلاً عن سجل الاشتراكات');
});

// ── ⑤ سنة العرض: ما وقع في سنة أخرى يُقال ولا يُقرأ فراغاً ──────────────────────────────────
test('مشروع حركته في السنة الماضية: تظهر سنتان للاختيار ويُقال أين الحركة', async () => {
  const html = await projectDetailPage(finance, 'P3');
  const m = moneyOf(html);
  assert.ok(m.includes('data-action="money-year"'), 'مبدّل السنة معروض');
  assert.ok(m.includes(`data-year="${YR}"`) && m.includes(`data-year="${YR - 1}"`), 'السنتان متاحتان');
  assert.equal((m.match(/class="money-panel"/g) || []).length, 2, 'لوح لكل سنة مبنيّ على الخادم');
  assert.ok(m.includes('وللمشروع حركة مسجّلة في'), 'يُقال أن للمشروع حركة في سنة أخرى');
  assert.ok(m.includes(String(YR - 1)), 'وتُسمّى السنة');
  // لوح السنة الجارية لا يُقرأ فارغاً: يقول أين وقعت الحركة فعلاً
  const cur = m.slice(m.indexOf(`data-money-year="${YR}"`), m.indexOf(`data-money-year="${YR - 1}"`));
  assert.ok(cur.includes('وللمشروع حركة مسجّلة في'), 'اللوح الجاري يشير إلى سنة الحركة');
  assert.ok(cur.includes(`>${YR - 1}<`), 'وتُسمّى تلك السنة داخل اللوح نفسه');
});

// ── ⑥ وصف المصروف نصٌّ يكتبه مستخدم: يُهرَّب قبل أن يُحقن في الصفحة ────────────────────────
test('وصف المصروف المكتوب بيد المستخدم يُهرَّب في كل موضع يظهر فيه', async () => {
  await db.insert('expense', { id: 'EX', project_id: 'P1', sector_id: 'S1',
    type: '<img src=x onerror=alert(1)>سفر', amount_halalas: 1_000, incurred_month: 5,
    incurred_year: YR, requested_by: 'u_fin', status: 'DRAFT', created_at: T });
  const m = moneyOf(await projectDetailPage(finance, 'P1'));
  assert.ok(!m.includes('<img src=x'), 'لا وسم منفَّذ في الجدول ولا في حقل التعديل');
  assert.ok(m.includes('&lt;img src=x'), 'الوصف يظهر نصاً مهرَّباً كما كُتب');
  await db.run('DELETE FROM expense WHERE id = ?', ['EX']);
});

test('سنة العرض تصل من الرابط حين تُمرَّر', async () => {
  const m = moneyOf(await projectDetailPage(finance, 'P3', { year: YR - 1 }));
  assert.ok(m.includes(`الحركة الشهرية في سنة ${YR - 1}`), 'اللوح المعروض هو سنة الطلب');
  assert.ok(m.includes(fmtSar(200_000)), 'وتظهر أرقام تلك السنة');
});
