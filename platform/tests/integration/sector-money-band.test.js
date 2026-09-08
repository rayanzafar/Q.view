// ── بطاقة «المال في القطاع» (v5.85 — كانت شريطاً بأربع خلايا في v5.71) ─────────────────────
// طلب المالك (2026-09-02): «في الداشبورد الأساسية نحتاج يكون معروض الإيراد والمفوتر والتكاليف
// بشكل واضح على كل القطاع». فجُمعت الثلاثة في سطرٍ واحد فوق الفصول كلها. ثم تبيّن أن ثلاثتها
// مكرَّرةٌ على الشاشة نفسها — الإيراد بطاقةٌ في «نبض القطاع» فوقها، والمفوتر والمحصَّل محطتان في
// «رحلة القيمة»، والتكلفة سطرٌ داخل نافذة الهامش — فبقي في البطاقة ثلاثةُ أسئلةٍ لا يجيبها
// سواها: كم بقي علينا من العقود؟ وكم أنجزنا ولم نطالب به (أو طالبنا ولم نُنجزه)؟ وكم ربحنا؟
// أرقامُ الطلب الأصلي لم تُحذف من الشاشة — انتقلت وحدها، وقرارُ المالك (2026-09-08) أقرّ ذلك.
//
// ما تحرسه هذه الاختبارات:
//   ١) البطاقة بموضعها ورتبتها: بعد «نبض القطاع» وقبل «قراءة سند التنفيذية» — أعلى الشاشة لا داخل لسان.
//   ٢) كل رقمٍ بأساسه المعلَن: العقد المسودّة خارج المتبقي، والمفوتر بلا مسودّةٍ ولا ملغاة،
//      والتكلفة بلا طلبٍ ينتظر اعتماداً — والطرفان صافيان في الفارق فلا تظهر الضريبة عملاً.
//   ٣) الفترة تحكم خليّتين وتترك الثالثة: التكلفة والفارق يتبعان النافذة، والمتبقي تراكميٌّ يقول ذلك.
//   ٤) الفارق حالتان باسمين: «منجَز لم يُفوتر» موجباً و«مفوتر قبل الإنجاز» سالباً.
//   ٥) الصفرُ يُقال بعبارةٍ مصمَّمة لا «٠ ر.س.» — قاعدة المنصة منذ v5.47.
//   ٦) نوافذ التفصيل الثلاث مبنيّة بمحتواها (العقود، الفارق، التكاليف والهامش).
// السنة المعروضة **ماضية** عمداً: كل فتراتها تقويمية منتهية فلا يتأثر الفحص بيوم تشغيله.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-moneyband-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');

const T = '2024-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear() - 1;   // سنة ماضية — حدود فتراتها حتمية
const U = (id, sector) => ({ id, username: id, name_ar: 'قائد ' + id, role_id: 'sector_lead',
  sector_id: sector, scope: 'sector', projectIds: new Set(), teamIds: new Set() });
const LEAD = U('u_lead', 'SOL');
const DRY = U('u_dry', 'ZER');   // قطاعٌ بلا عقدٍ ولا فاتورةٍ ولا تكلفة

before(async () => {
  for (const [id, name] of [['SOL', 'قطاع الحلول'], ['ZER', 'قطاع بلا تكلفة']]) {
    await insert('sector', { id, name_ar: name, kind: 'delivery', active: 1, sort_order: id === 'SOL' ? 1 : 2,
      target_revenue_halalas: 200_000_000, target_sales_halalas: 200_000_000, created_at: T });
  }
  for (const u of [LEAD, DRY]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('project', { id: 'P1', code: 'PRJ-1', name_ar: 'مشروع التحول', sector_id: 'SOL', client_id: 'C1',
    status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 40, created_at: T });

  // ── العقود: نشطٌ صافيه 2.5M بإجمالي 3.0M، ومسودّةٌ ضخمة يجب أن تسقط من «المتبقي» ──
  await insert('contract', { id: 'K_ACT', code: 'CTR-1', project_id: 'P1', client_id: 'C1', sector_id: 'SOL',
    value_halalas: 3_000_000_00, net_value_halalas: 2_500_000_00, status: 'ACTIVE',
    start_date: `${YEAR}-01-01`, created_at: T });
  await insert('contract', { id: 'K_DRF', code: 'CTR-2', project_id: 'P1', client_id: 'C1', sector_id: 'SOL',
    value_halalas: 5_000_000_00, net_value_halalas: 4_400_000_00, status: 'DRAFT', created_at: T });

  // ── الإيراد: صافي شهرين — مارس 400 ألفاً وديسمبر 600 ألفاً (مليون للسنة) ──
  await insert('revenue_line', { id: 'RL3', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 460_000_00, net_amount_halalas: 400_000_00, created_at: T });
  await insert('revenue_line', { id: 'RL12', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 12,
    amount_halalas: 690_000_00, net_amount_halalas: 600_000_00, created_at: T });

  // ── الفواتير: قطاعها يُستنتج من مشروعها (بلا sector_id) — والمسودّة والملغاة خارج الحساب.
  // وصافيها مسجَّلٌ صراحةً كي يكون طرفا الفارق صافيَين بأرقامٍ مدوَّرة يقرؤها الفحص. ──
  await insert('invoice', { id: 'I_ISS', code: 'INV-1', project_id: 'P1', client_id: 'C1',
    amount_halalas: 345_000_00, net_amount_halalas: 300_000_00, issue_date: `${YEAR}-03-10`,
    status: 'ISSUED', created_at: T });
  await insert('invoice', { id: 'I_PAID', code: 'INV-2', project_id: 'P1', client_id: 'C1',
    amount_halalas: 230_000_00, net_amount_halalas: 200_000_00, issue_date: `${YEAR}-06-15`,
    status: 'PAID', created_at: T });
  await insert('invoice', { id: 'I_DRAFT', code: 'INV-3', project_id: 'P1', client_id: 'C1',
    amount_halalas: 900_000_00, net_amount_halalas: 782_600_00, issue_date: `${YEAR}-04-01`,
    status: 'DRAFT', created_at: T });
  await insert('invoice', { id: 'I_CAN', code: 'INV-4', project_id: 'P1', client_id: 'C1',
    amount_halalas: 800_000_00, net_amount_halalas: 695_650_00, issue_date: `${YEAR}-05-01`,
    status: 'CANCELLED', created_at: T });
  // فاتورةٌ متأخرة السداد — تكفّل بأن تُصيَّر تسميةُ الحالة فعلاً فتُفحَص لا تُفترض
  await insert('invoice', { id: 'I_OD', code: 'INV-5', project_id: 'P1', client_id: 'C1',
    amount_halalas: 115_000_00, net_amount_halalas: 100_000_00, issue_date: `${YEAR}-09-01`,
    due_date: `${YEAR}-10-01`, status: 'OVERDUE', created_at: T });
  await insert('collection', { id: 'COL1', invoice_id: 'I_PAID', amount_halalas: 200_000_00,
    collected_at: `${YEAR}-06-20`, created_at: T });

  // ── المخرجات: مسلَّمٌ بلا فاتورةٍ مرتبطة (يظهر في نافذة الفارق)، وآخرُ مربوطٌ بفوترة ──
  await insert('deliverable', { id: 'D_UNB', project_id: 'P1', sector_id: 'SOL',
    name_ar: 'تقرير المرحلة الأولى', amount_halalas: 230_000_00, month: 3, year: YEAR,
    status: 'DELIVERED', delivered_at: `${YEAR}-03-20`, created_at: T });
  await insert('deliverable', { id: 'D_LNK', project_id: 'P1', sector_id: 'SOL',
    name_ar: 'ورشة الإطلاق', amount_halalas: 115_000_00, month: 3, year: YEAR,
    status: 'DELIVERED', delivered_at: `${YEAR}-03-25`, invoiced_at: `${YEAR}-03-28`, created_at: T });

  // ── التكاليف: بندان بشهرهما وثالثٌ بلا شهر (يدخل السنة ويسقط من نافذة الشهر) ──
  await insert('cost_line', { id: 'CL3', project_id: 'P1', sector_id: 'SOL', type: 'رواتب',
    amount_halalas: 100_000_00, month: 3, year: YEAR, created_at: T });
  await insert('cost_line', { id: 'CL7', project_id: 'P1', sector_id: 'SOL', type: 'تعاقد باطني',
    amount_halalas: 50_000_00, month: 7, year: YEAR, created_at: T });
  await insert('cost_line', { id: 'CLX', project_id: 'P1', sector_id: 'SOL',
    amount_halalas: 30_000_00, year: YEAR, created_at: T });
  // ── المصروفات: المعتمد والمدفوع وحدهما — والمقدَّم والمرفوض لا يُحمَّلان على القطاع ──
  await insert('expense', { id: 'E_APP', project_id: 'P1', sector_id: 'SOL', type: 'سفر',
    amount_halalas: 20_000_00, incurred_month: 3, incurred_year: YEAR, status: 'APPROVED', created_at: T });
  await insert('expense', { id: 'E_PAID', project_id: 'P1', sector_id: 'SOL', type: 'ضيافة',
    amount_halalas: 11_500_00, net_amount_halalas: 10_000_00, incurred_month: 5, incurred_year: YEAR,
    status: 'PAID', created_at: T });
  await insert('expense', { id: 'E_SUB', project_id: 'P1', sector_id: 'SOL', type: 'سفر',
    amount_halalas: 500_000_00, incurred_month: 3, incurred_year: YEAR, status: 'SUBMITTED', created_at: T });
  await insert('expense', { id: 'E_REJ', project_id: 'P1', sector_id: 'SOL', type: 'سفر',
    amount_halalas: 700_000_00, incurred_month: 3, incurred_year: YEAR, status: 'REJECTED', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// منطقة البطاقة وحدها — كي لا يجتاز الفحصُ برقمٍ من بطاقةٍ أخرى في الصفحة
const bandOf = (html) => {
  const a = html.indexOf('id="money-band"');
  assert.ok(a > -1, 'بطاقة المال مُصيَّرة في الصفحة');
  const b = html.indexOf('</section>', a);
  return html.slice(a, b);
};

// خليةٌ بعينها من البطاقة: الاسم في سطرها الأول («الهامش الإجمالي»، «المتبقي من العقود»…)
const cellOf = (band, eye) => {
  const cells = band.split('<button type="button" class="mcell"').slice(1);
  const hit = cells.find((c) => c.slice(0, c.indexOf('</button>')).includes(eye));
  assert.ok(hit, `خلية «${eye}» في البطاقة`);
  return hit.slice(0, hit.indexOf('</button>'));
};
// نافذةُ تفصيلٍ بعينها من الصفحة
const ddOf = (html, key) => {
  const a = html.indexOf(`<template id="dd-${key}">`);
  assert.ok(a > -1, `نافذة ${key} مبنيّة`);
  return html.slice(a, html.indexOf('</template>', a));
};
// علامات الاتجاه التي يضعها المنسّق حول المبالغ تُزال قبل الفحص النصّي
const plain = (h) => h.replace(/[‎‏]/g, '');

test('البطاقة بموضعها وتحمل أسئلتها الثلاثة', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  const kpi = html.indexOf('id="kpi-band"');
  const money = html.indexOf('id="money-band"');
  const exec = html.indexOf('class="exec-band"');
  assert.ok(kpi > -1 && money > kpi, 'البطاقة بعد «نبض القطاع»');
  assert.ok(exec > money, 'البطاقة قبل «قراءة سند التنفيذية»');
  const band = bandOf(html);
  for (const label of ['المتبقي من العقود', 'منجَز لم يُفوتر', 'الهامش الإجمالي']) {
    assert.ok(band.includes(label), `العنوان «${label}» في البطاقة`);
  }
  assert.ok(band.includes('المال في القطاع'), 'عنوان البطاقة');
  assert.ok(band.includes(`سنة ${YEAR}`), 'صدى الفترة على رأس البطاقة');
  // والأرقام التي خرجت من البطاقة لم تخرج من الشاشة: الإيراد بطاقةٌ في «نبض القطاع» فوقها
  assert.ok(html.slice(kpi, money).includes('المحقق'), 'الإيراد المحقق باقٍ في صفّ «نبض القطاع»');
});

test('كل رقمٍ بأساسه: العقد المسودّة خارج المتبقي، والمفوتر بلا مسودّةٍ ولا ملغاة', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  // المتبقي = صافي العقود النشطة (2.5M) ناقص ما تحقق إيراداً (1.0M) — والمسودّة لا تدخل
  const backlog = cellOf(band, 'المتبقي من العقود');
  assert.ok(backlog.includes('1.5M'), 'المتبقي صافي النشط ناقص المحقق');
  assert.ok(backlog.includes('تحقق <b class="tnum">40%</b>'), 'نسبة التحقق من المتعاقد');
  assert.ok(backlog.includes('من 3.0M متعاقد'), 'الإجمالي المتعاقد بجانبه');
  assert.ok(!band.includes('4.4M') && !band.includes('5.0M'), 'العقد المسودّة خارج المتبقي');
  assert.ok(backlog.includes('تراكمي'), 'ويقول إنه رصيدٌ لا يتبع الفترة');
  // الفارق = المحقق (1.0M) ناقص المفوتر الصافي (600K = 300+200+100) — لا المسودّة ولا الملغاة
  const gap = cellOf(band, 'منجَز لم يُفوتر');
  assert.ok(gap.includes('400K'), 'الفارق بين المحقق والمفوتر صافيَين');
  assert.ok(gap.includes('من 1.0M محقق'), 'مرجع الفارق معلَن');
  assert.ok(!band.includes('783K') && !band.includes('696K'), 'المسودّة والملغاة خارج المفوتر');
  // الهامش = (مليون − 210 ألفاً) ÷ مليون، والتكلفة بنودٌ 180 ألفاً + مصروفات معتمدة 30 ألفاً
  const margin = cellOf(band, 'الهامش الإجمالي');
  assert.ok(margin.includes('79%'), 'نسبة الهامش الإجمالي');
  assert.ok(margin.includes('بعد تكاليف <b class="tnum">210K</b>'), 'التكلفة أساس النسبة معلَنةٌ تحتها');
  assert.ok(margin.includes('790K') && margin.includes('ربح'), 'الربح المطلق في قلب العدّاد');
  assert.ok(!/1\.2M/.test(band), 'المصروف المقدَّم أو المرفوض لا يدخل التكلفة');
  assert.ok(margin.includes('بنود التكلفة <b class="tnum">180K</b>'), 'تركيبة التكلفة: البنود');
  assert.ok(margin.includes('مصروفات <b class="tnum">30K</b>'), 'تركيبة التكلفة: المصروفات المعتمدة');
});

test('الفترة تحكم خليّتين وتترك الثالثة: التكلفة والفارق يتبعانها والمتبقي تراكمي', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm3' }));
  assert.ok(band.includes('مارس'), 'اسم الشهر على رأس البطاقة');
  // تكلفة مارس = بند 100 ألفاً + مصروف معتمد 20 ألفاً — والبند بلا شهر خارجها
  const margin = cellOf(band, 'الهامش الإجمالي');
  assert.ok(margin.includes('بعد تكاليف <b class="tnum">120K</b>'), 'تكلفة مارس وحدها');
  assert.ok(!margin.includes('210K'), 'مجموع تكلفة السنة لا يظهر في شهرٍ بعينه');
  assert.ok(margin.includes('70%'), 'هامش مارس محسوبٌ على أرقام مارس');
  // فارق مارس = 400K محققاً − 300K مفوتراً
  const gap = cellOf(band, 'منجَز لم يُفوتر');
  assert.ok(gap.includes('100K') && gap.includes('من 400K محقق'), 'فارق مارس بطرفيه');
  // والمتبقي من العقود هو هو في كل فترة — رصيدٌ تراكمي
  assert.ok(cellOf(band, 'المتبقي من العقود').includes('1.5M'), 'المتبقي لا يتغيّر بالفترة');
});

test('الفارق حالتان باسمين: «مفوتر قبل الإنجاز» حين تسبق الفوترةُ الإنجاز', async () => {
  // يونيو: فاتورةٌ صافيها 200 ألفاً ولا إيراد متحقق — فُوتر قبل أن يُنجَز
  const jun = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm6' }));
  assert.ok(!jun.includes('منجَز لم يُفوتر'), 'لا يُسمّى الفارق بالاسم المعاكس');
  const gap = cellOf(jun, 'مفوتر قبل الإنجاز');
  assert.ok(gap.includes('200K'), 'قيمة الفارق مطلقةً لا سالبة');
  assert.ok(gap.includes('مما فُوتر'), 'والمرجع المفوتر لا المحقق');
  // وديسمبر: إيرادٌ بلا فاتورة — الحالة الموجبة باسمها
  const dec = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm12' }));
  assert.ok(cellOf(dec, 'منجَز لم يُفوتر').includes('600K'), 'إيراد ديسمبر كله بلا فاتورة');
});

test('قطاعٌ بلا عقدٍ ولا فاتورةٍ ولا تكلفة يقول عباراته المصمَّمة لا صفراً', async () => {
  const html = await sectorPage(DRY, { year: String(YEAR), p: 'y' });
  const band = bandOf(html);
  // ونافذة التكاليف تُبنى على قطاعٍ خالٍ بلا كسر: أعمدةُ الأشهر كلها أصفار وحالةٌ مصمَّمة فوقها
  assert.ok(html.includes('<template id="dd-seccost">'), 'نافذة التكاليف مبنيّة ولو خلا القطاع');
  assert.ok(html.includes('لا تكاليف مسجَّلة'), 'حالة الفراغ داخل النافذة');
  assert.ok(!/undefined|NaN|\[object|(?<![a-z])null(?![a-z])/.test(html), 'قطاعٌ خالٍ بلا قيمةٍ خام');
  assert.ok(band.includes('لا عقود مسجَّلة'), 'المتبقي بلا عقدٍ يقول ذلك');
  assert.ok(band.includes('لا إيراد ولا فواتير في هذه الفترة'), 'الفارق بلا طرفين يقول ذلك');
  assert.ok(band.includes('لا إيراد في هذه الفترة'), 'الهامش بلا إيرادٍ يقول سببه');
  assert.ok(!/>0<|٠ ر\.س|SAR 0/.test(band), 'لا صفر مطبوع في وجه القارئ');
});

test('نوافذ التفصيل الثلاث مبنيّة بمحتواها', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  // (١) سجل العقود — خلف خلية «المتبقي من العقود»
  const ktr = ddOf(html, 'seccontracts');
  assert.ok(ktr.includes('سجل عقود القطاع'), 'عنوان نافذة العقود');
  assert.ok(ktr.includes('CTR-1'), 'العقد النشط في السجل');
  // (٢) نافذة الفارق — طرفاه مكشوفان والمخرجات غير المفوترة تحتهما
  const gap = ddOf(html, 'secunbilled');
  assert.ok(gap.includes('طرفا الفارق'), 'الحساب مكشوف الطرفين');
  assert.ok(gap.includes('تحقق إيراداً') && gap.includes('صدر من فواتير'), 'الطرفان مسمّيان');
  assert.ok(gap.includes('تقرير المرحلة الأولى'), 'المخرَج المسلَّم بلا فاتورة في القائمة');
  assert.ok(!gap.includes('ورشة الإطلاق'), 'والمربوط بفوترةٍ خارجها');
  // (٣) التكاليف والهامش — كما كانت
  const cost = ddOf(html, 'seccost');
  assert.ok(cost.includes('بنود التكلفة حسب النوع') && cost.includes('رواتب') && cost.includes('تعاقد باطني'),
    'بنود التكلفة بأنواعها');
  assert.ok(cost.includes('غير مصنَّف'), 'البند بلا نوعٍ يُسمّى لا يُخفى');
  assert.ok(cost.includes('المصروفات المعتمدة حسب النوع') && cost.includes('سفر') && cost.includes('ضيافة'),
    'المصروفات المعتمدة بأنواعها');
  assert.ok(cost.includes('حسب الشهر') && cost.includes('مارس') && cost.includes('ديسمبر'),
    'أشهر السنة بأسمائها العربية — لا Jan/Dec في نافذةٍ عربية');
  assert.ok(!/Jan|Feb|Mar|Dec/.test(cost), 'لا اختصار لاتيني في نافذةٍ عربية');
  assert.ok(!/class="v tnum">0</.test(cost), 'شهرٌ خالٍ يُقال «—» لا «٠»');
  assert.ok(cost.includes('الإيراد بدون الضريبة') && cost.includes('التكاليف'), 'سطر الهامش مكشوف الحساب');
  // ونافذة الفواتير الصادرة باقيةٌ خلف «رحلة القيمة»
  const inv = ddOf(html, 'secinv');
  assert.ok(inv.includes('حسب الحالة') && inv.includes('صادرة') && inv.includes('محصَّلة'),
    'الفواتير مبوَّبة بحالتها بالعربية');
  assert.ok(inv.includes('أحدث الفواتير') && inv.includes('وزارة الثقافة') && inv.includes('INV-1'),
    'أحدث الفواتير باسم العميل ورمزها');
  assert.ok(inv.includes(`${YEAR}-06-15`), 'تاريخ الإصدار في القائمة');
  assert.ok(!inv.includes('INV-3') && !inv.includes('INV-4'), 'المسودّة والملغاة خارج القائمة');
});

// ── لسانُ البطاقة واحدٌ مع لسان المنصة: ألفاظ الضريبة والحالات والتذكير والتأنيث ──────────────
test('ألفاظ الضريبة من المعجم وحده — لا مصطلح ثانٍ لمعنىً واحد', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  const band = bandOf(html);
  assert.ok(band.includes('بدون الضريبة'), 'لفظ المعجم على علامة أساس الفارق');
  assert.ok(ddOf(html, 'secinv').includes('مع الضريبة'), 'ولفظه المقابل على نافذة الفواتير');
  for (const drift of ['صافٍ بعد الضريبة', 'شامل الضريبة', 'الإيراد الصافي']) {
    assert.ok(!html.includes(drift), `لفظٌ خارج المعجم تسرّب: «${drift}»`);
  }
});

test('تأنيثٌ سليم وحرفُ جرٍّ في مكانه', async () => {
  // «بنود التكلفة» و«مصروفات معتمدة» جمعٌ غير عاقل — خبرُه مؤنّثٌ مفرد
  const dry = await sectorPage(DRY, { year: String(YEAR), p: 'y' });
  assert.ok(ddOf(dry, 'seccost').includes('لم تُسجَّل'), 'بنود التكلفة والمصروفات: «لم تُسجَّل»');
  // وحالةُ الفراغ في نافذة التكاليف جملةٌ تامة بحرفها: «… خلال ٢٠٢٦» / «… في مارس ٢٠٢٦»
  assert.ok(dry.includes(`لا تكاليف مسجَّلة خلال ${YEAR}`), 'ظرفُ السنة بحرفه');
  const m = await sectorPage(DRY, { year: String(YEAR), p: 'm3' });
  assert.ok(m.includes(`لا تكاليف مسجَّلة في مارس ${YEAR}`), 'ظرفُ الشهر بحرفه');
  assert.ok(!m.includes(`لا تكاليف مسجَّلة مارس`), 'لا جملة بلا حرف جر');
});

test('حالةُ الفاتورة المتأخرة تُسمّى «متأخرة السداد» لا «متأخرة» وحدها', async () => {
  const inv = ddOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }), 'secinv');
  assert.ok(inv.includes('متأخرة السداد'), 'الحالة بلفظ المعجم كاملاً');
  assert.ok(!/متأخرة(?!\s*السداد)/.test(inv),
    '«متأخرة» وحدها تُقرأ تأخّراً في التسليم لا في الدفع');
});

test('رأس البطاقة عنوانٌ في الترتيب، وعدد الخلايا مكتوبٌ على الشبكة', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  // عنوانٌ مرقَّم كجارتيه («نبض القطاع» ١ و«قراءة سند التنفيذية» ٣): من يتنقّل بالعناوين كان
  // يقفز فوق أرقام المال كلها حين كانت نصّاً مُصغَّراً بلا رقم فصل
  assert.ok(band.includes('<h2 id="mb-h">المال في القطاع</h2>'), 'العنوان بالرتبة نفسها التي لجارتيه');
  assert.ok(/<span class="n tnum">2<\/span>/.test(band), 'ورقمُ الفصل قبله');
  assert.ok(band.includes('class="mcells" style="--n:3"'), 'ثلاث خلايا وثلاثة أعمدة — لا عمودٌ فارغ');
});

test('خلايا البطاقة أزرارٌ تفتح تفصيلها بلا برمجةٍ داخل الوسم', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  for (const dd of ['seccontracts', 'secunbilled', 'seccost']) {
    assert.ok(band.includes(`data-dd="${dd}"`), `الخلية تفتح ${dd}`);
  }
  assert.equal((band.match(/<button type="button" class="mcell"/g) || []).length, 3, 'ثلاث خلايا');
  assert.ok(!band.includes('onclick='), 'لا برمجة داخل الوسم');
  assert.ok(!band.includes('aria-label=""'), 'كل خلية تُنطق باسمها');
});

test('لا تسرّب قيمةٍ خام في نصّ البطاقة', async () => {
  for (const p of ['y', 'm3', 'm6', 'm12', 'q2']) {
    const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p }));
    const text = band.replace(/<[^>]*>/g, ' ');
    assert.ok(!/undefined|NaN|\[object|(?<![a-z])null(?![a-z])/i.test(text), `نصّ البطاقة نظيف في ${p}`);
    assert.ok(!/\b(DRAFT|CANCELLED|ISSUED|PAID|APPROVED|SUBMITTED|REJECTED|ACTIVE|DELIVERED|ACCEPTED)\b/.test(text),
      `لا حالة مخزَّنة خام في ${p}`);
  }
  // والصفحة كلها معها — البطاقة تُضيف نوافذ وأرقاماً، فلا يكفي فحص منطقتها وحدها
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  assert.ok(!/undefined|NaN|\[object|(?<![a-z])null(?![a-z])/.test(html), 'الصفحة كلها بلا قيمةٍ خام');
});

// ── ما وجده فحصُ المتصفح على الشريط (2026-09-02) — العيوب الأربعة لكلٍّ منها حارسٌ هنا ──────────
// كان الفحصُ على شاشةٍ عرضها 390 يقرأ «0%» مكان «84%»، و«100% ربحاً» لفترةٍ لم تُسجَّل تكلفتُها،
// و«0 ر.س.» في نافذة التكاليف حيث تقول البطاقةُ «لم يُسجَّل». والحرّاس باقون بعد إعادة التشكيل.

test('نسبةُ الهامش لا تحمل اتجاهاً على خليّتها — العازل داخلها لا على الشبكة', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  // `.mcell` شبكةٌ: dir على عنصرها يقلب حافةَ بدايته فينزلق الرقم خارج الشاشة الضيّقة
  assert.ok(!/class="mv tnum"[^>]*\sdir=/.test(band), 'لا اتجاه على قيمة الخليّة نفسها');
  const margin = cellOf(band, 'الهامش الإجمالي');
  assert.ok(margin.includes('<bdi dir="ltr">79%</bdi>'), 'النسبة داخل عازلٍ يقرأ يساراً');
  // وبقيةُ الخلايا: قيمةٌ في `.mv` بتلميحها الكامل وبلا اتجاهٍ أصلاً
  for (const eye of ['المتبقي من العقود', 'منجَز لم يُفوتر']) {
    const c = cellOf(band, eye);
    assert.ok(/<span class="mv tnum"[^>]*title="/.test(c), `قيمة «${eye}» بوسمها الأصلي وتلميحها`);
    assert.ok(!c.includes('dir='), `لا اتجاه في خلية «${eye}»`);
  }
  // والقيمة الكاملة على التلميح لا مبتورة
  assert.ok(/title="[^"]*1[,٬]500[,٬]000/.test(band), 'القيمة الكاملة للمتبقي على التلميح');
});

test('فترةٌ بإيرادٍ بلا تكلفةٍ مسجَّلة: لا «100%» ولا دعوى ربحٍ كامل', async () => {
  // ديسمبر: إيرادٌ 600 ألفاً ولا بندَ تكلفةٍ ولا مصروف — القسمةُ وحدها تقول «100% ربحاً»
  const dec = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm12' }));
  const margin = cellOf(dec, 'الهامش الإجمالي');
  assert.ok(margin.includes('<span class="mv mz">—</span>'), 'الهامش «—» حتى تُسجَّل التكلفة');
  assert.ok(margin.includes('لا تكاليف مسجَّلة — يُحسب الهامش بعد تسجيلها'), 'السبب مكتوبٌ تحت القيمة');
  assert.ok(/aria-label="[^"]*لا تكاليف مسجَّلة — يُحسب الهامش بعد تسجيلها[^"]*"/.test(margin),
    'ومنطوقٌ لقارئ الشاشة كما هو مكتوب');
  assert.ok(!/%/.test(margin), 'لا نسبةَ ربحٍ كاملٍ صنعها غيابُ الإدخال');
  assert.ok(!margin.includes('ربح') && !margin.includes('خسارة'), 'ولا حكمَ ربحٍ ولا خسارة');
  // والسنةُ — وفيها تكلفةٌ مسجَّلة — تعرض نسبتها كما كانت
  const y = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  assert.ok(cellOf(y, 'الهامش الإجمالي').includes('79%'), 'نسبةُ السنة محسوبةٌ على طرفين مسجَّلين');
});

test('نافذة التكاليف تقول «لم تُسجَّل» حيث تقول البطاقة — لا «0 ر.س.»', async () => {
  const dd = plain(ddOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm12' }), 'seccost'));
  assert.ok(!/(?<![\d,])0 ر\.س\./.test(dd), 'لا صفرٌ مطبوعٌ بعملته في نافذة التكاليف');
  assert.ok(dd.includes('لم تُسجَّل'), 'رأس النافذة بلفظ الفراغ نفسه');
  assert.ok(dd.includes('لا هامش يُحسب قبل تسجيل التكاليف'), 'جملةٌ واحدة بدل معادلةٍ طرفُها فارغ');
  assert.ok(!dd.includes('−') || !/− التكاليف/.test(dd), 'لا معادلةَ طرحٍ من صفر');
  assert.ok(!dd.includes('100%'), 'ولا نسبةٌ في النافذة أيضاً');
  // وحيث تُسجَّل التكلفة تبقى المعادلة مكشوفةً كما كانت
  const yd = plain(ddOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }), 'seccost'));
  assert.ok(yd.includes('الإيراد بدون الضريبة') && yd.includes('− التكاليف') && yd.includes('79%'),
    'المعادلة بحسابها حين يكتمل طرفاها');
});
