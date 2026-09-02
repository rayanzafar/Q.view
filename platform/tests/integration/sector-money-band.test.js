// ── شريط «المال في القطاع» (v5.71) ─────────────────────────────────────────────────────────
// طلب المالك (2026-09-02): «في الداشبورد الأساسية نحتاج يكون معروض الإيراد والمفوتر والتكاليف
// بشكل واضح على كل القطاع». الأرقام كانت في الصفحة لكنها متفرّقة على ثلاثة مواضع تحت ألسنة
// مختلفة، فجُمعت في سطرٍ واحد ثابت فوق الفصول كلها.
//
// ما تحرسه هذه الاختبارات:
//   ١) الشريط موجود بموضعه: بعد «نبض القطاع» وقبل «قراءة سند التنفيذية» — أعلى الشاشة لا داخل لسان.
//   ٢) كل رقمٍ بأساسه المعلَن: المفوتر بلا مسودّاتٍ ولا ملغاة، والتكلفة بلا طلبٍ ينتظر اعتماداً.
//   ٣) الفترة تحكم الشريط فعلاً: شهرٌ بعينه يعرض تكلفته وحدها ويصدى بمجموع السنة تحته.
//   ٤) الصفرُ يُقال «لم يُسجَّل» لا «٠ ر.س.» — قاعدة المنصة منذ v5.47.
//   ٥) نافذتا التفصيل الجديدتان مبنيّتان في الصفحة (الفواتير الصادرة، والتكاليف والهامش).
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
const DRY = U('u_dry', 'ZER');   // قطاعٌ بلا تكلفة مسجَّلة

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

  // ── الإيراد: صافي شهرين — مارس 400 ألفاً وديسمبر 600 ألفاً (مليون للسنة) ──
  await insert('revenue_line', { id: 'RL3', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 460_000_00, net_amount_halalas: 400_000_00, created_at: T });
  await insert('revenue_line', { id: 'RL12', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 12,
    amount_halalas: 690_000_00, net_amount_halalas: 600_000_00, created_at: T });

  // ── الفواتير: قطاعها يُستنتج من مشروعها (بلا sector_id) — والمسودّة والملغاة خارج الحساب ──
  await insert('invoice', { id: 'I_ISS', code: 'INV-1', project_id: 'P1', client_id: 'C1',
    amount_halalas: 300_000_00, issue_date: `${YEAR}-03-10`, status: 'ISSUED', created_at: T });
  await insert('invoice', { id: 'I_PAID', code: 'INV-2', project_id: 'P1', client_id: 'C1',
    amount_halalas: 200_000_00, issue_date: `${YEAR}-06-15`, status: 'PAID', created_at: T });
  await insert('invoice', { id: 'I_DRAFT', code: 'INV-3', project_id: 'P1', client_id: 'C1',
    amount_halalas: 900_000_00, issue_date: `${YEAR}-04-01`, status: 'DRAFT', created_at: T });
  await insert('invoice', { id: 'I_CAN', code: 'INV-4', project_id: 'P1', client_id: 'C1',
    amount_halalas: 800_000_00, issue_date: `${YEAR}-05-01`, status: 'CANCELLED', created_at: T });
  // فاتورةٌ متأخرة السداد — تكفّل بأن تُصيَّر تسميةُ الحالة فعلاً فتُفحَص لا تُفترض
  await insert('invoice', { id: 'I_OD', code: 'INV-5', project_id: 'P1', client_id: 'C1',
    amount_halalas: 150_000_00, issue_date: `${YEAR}-09-01`, due_date: `${YEAR}-10-01`,
    status: 'OVERDUE', created_at: T });
  await insert('collection', { id: 'COL1', invoice_id: 'I_PAID', amount_halalas: 200_000_00,
    collected_at: `${YEAR}-06-20`, created_at: T });
  // وتحصيلٌ في أغسطس لفاتورة مارس: شهرٌ فيه محصَّلٌ ولا فاتورة صادرة — الحالة التي كان
  // «المفوتر: لم يُسجَّل» فوق «المحصَّل …» يُقرأ فيها جزءاً من عنوانٍ غائب
  await insert('collection', { id: 'COL2', invoice_id: 'I_ISS', amount_halalas: 50_000_00,
    collected_at: `${YEAR}-08-12`, created_at: T });

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

// منطقة الشريط وحدها — كي لا يجتاز الفحصُ برقمٍ من بطاقةٍ أخرى في الصفحة
const bandOf = (html) => {
  const a = html.indexOf('id="money-band"');
  assert.ok(a > -1, 'شريط المال مُصيَّر في الصفحة');
  const b = html.indexOf('</section>', a);
  return html.slice(a, b);
};

// خليةٌ بعينها من الشريط: الاسم في سطرها الأول («الهامش الإجمالي»، «المفوتر»…)
const cellOf = (band, eye) => {
  const cells = band.split('<button type="button" class="mcell"').slice(1);
  const hit = cells.find((c) => c.slice(0, c.indexOf('</button>')).includes(eye));
  assert.ok(hit, `خلية «${eye}» في الشريط`);
  return hit.slice(0, hit.indexOf('</button>'));
};
// نافذةُ تفصيلٍ بعينها من الصفحة
const ddOf = (html, key) => {
  const a = html.indexOf(`<template id="dd-${key}">`);
  assert.ok(a > -1, `نافذة ${key} مبنيّة`);
  return html.slice(a, html.indexOf('</template>', a));
};
// علامات الاتجاه التي يضعها المنسّق حول المبالغ تُزال قبل الفحص النصّي
const plain = (h) => h.replace(/[\u200e\u200f]/g, '');

test('الشريط موجود بموضعه ويحمل عناوينه الأربعة', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  const kpi = html.indexOf('id="kpi-band"');
  const money = html.indexOf('id="money-band"');
  const exec = html.indexOf('class="exec-band"');
  assert.ok(kpi > -1 && money > kpi, 'الشريط بعد «نبض القطاع»');
  assert.ok(exec > money, 'الشريط قبل «قراءة سند التنفيذية»');
  const band = bandOf(html);
  for (const label of ['الإيراد المحقق', 'المفوتر', 'التكاليف', 'الهامش الإجمالي']) {
    assert.ok(band.includes(label), `العنوان «${label}» في الشريط`);
  }
  assert.ok(band.includes('المال في القطاع'), 'عنوان الشريط الصغير');
  assert.ok(band.includes(`سنة ${YEAR}`), 'صدى الفترة على رأس الشريط');
});

test('كل رقمٍ بأساسه: المفوتر بلا مسودّةٍ ولا ملغاة، والتكلفة بلا طلبٍ ينتظر اعتماداً', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  // الإيراد الصافي للسنة = 400 ألف + 600 ألف
  assert.ok(band.includes('1.0M'), 'إيراد السنة الصافي في الشريط');
  // المفوتر = الصادرة + المحصَّلة + المتأخرة (650 ألفاً) — لا المسودّة (900) ولا الملغاة (800)
  assert.ok(band.includes('650K'), 'المفوتر مجموع الصادر والمحصَّل والمتأخر');
  assert.ok(!band.includes('900K') && !band.includes('800K'), 'المسودّة والملغاة خارج المفوتر');
  assert.ok(band.includes('250K'), 'المحصَّل في السطر الثاني — تحصيلا يونيو وأغسطس');
  // التكلفة = بنود 180 ألفاً (منها بندٌ بلا شهر) + مصروفات معتمدة 30 ألفاً = 210
  assert.ok(band.includes('210K'), 'مجموع التكاليف للسنة');
  assert.ok(band.includes('180K'), 'بنود التكلفة في السطر الثاني');
  assert.ok(band.includes('30K'), 'المصروفات المعتمدة في السطر الثاني');
  assert.ok(!/1\.2M/.test(band), 'المصروف المقدَّم أو المرفوض لا يدخل التكلفة');
  // الهامش = (مليون − 210 ألفاً) ÷ مليون
  assert.ok(band.includes('79%'), 'نسبة الهامش الإجمالي');
  assert.ok(band.includes('790K') && band.includes('ربحاً'), 'الربح المطلق في السطر الثاني');
  // القيمة الكاملة على التلميح لا مبتورة
  assert.ok(/title="[^"]*210[,٬]000/.test(band), 'القيمة الكاملة للتكلفة على التلميح');
});

test('الفترة تحكم الشريط: شهرٌ بعينه يعرض تكلفته وحدها ويصدى بمجموع السنة', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm3' }));
  assert.ok(band.includes('مارس'), 'اسم الشهر على رأس الشريط');
  assert.ok(band.includes('400K'), 'إيراد مارس وحده');
  assert.ok(band.includes(`سنة ${YEAR}:`), 'صدى مجموع السنة تحت إيراد الشهر');
  assert.ok(band.includes('1.0M'), 'مجموع السنة في صدى الشهر');
  // تكلفة مارس = بند 100 ألفاً + مصروف معتمد 20 ألفاً — والبند بلا شهر خارجها
  assert.ok(band.includes('120K'), 'تكلفة مارس وحدها');
  assert.ok(!band.includes('210K'), 'مجموع تكلفة السنة لا يظهر في شهرٍ بعينه');
  assert.ok(band.includes('300K'), 'فاتورة مارس وحدها في المفوتر');
  assert.ok(band.includes('70%'), 'هامش مارس محسوبٌ على أرقام مارس');
  // ديسمبر: لا تكلفة ولا فاتورة — والصفر يُقال لا يُطبع
  const dec = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm12' }));
  assert.ok(dec.includes('600K'), 'إيراد ديسمبر');
  assert.ok(dec.includes('لم يُسجَّل'), 'ما لم يُسجَّل يُقال بلفظه في ديسمبر');
});

test('قطاعٌ بلا تكلفةٍ مسجَّلة يقول «لم يُسجَّل» لا صفراً', async () => {
  const html = await sectorPage(DRY, { year: String(YEAR), p: 'y' });
  const band = bandOf(html);
  // ونافذة التكاليف تُبنى على قطاعٍ خالٍ بلا كسر: أعمدةُ الأشهر كلها أصفار وحالةٌ مصمَّمة فوقها
  assert.ok(html.includes('<template id="dd-seccost">'), 'نافذة التكاليف مبنيّة ولو خلا القطاع');
  assert.ok(html.includes('لا تكاليف مسجَّلة'), 'حالة الفراغ داخل النافذة');
  assert.ok(!/undefined|NaN|\[object|(?<![a-z])null(?![a-z])/.test(html), 'قطاعٌ خالٍ بلا قيمةٍ خام');
  assert.ok(band.includes('لم يُسجَّل'), 'العبارة المصمَّمة للفراغ');
  assert.ok(!/>0<|٠ ر\.س|SAR 0/.test(band), 'لا صفر مطبوع في وجه القارئ');
  assert.ok(band.includes('لا إيراد في هذه الفترة'), 'الهامش بلا إيرادٍ يقول سببه');
});

test('نافذتا التفصيل الجديدتان مبنيّتان بمحتواهما', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  assert.ok(html.includes('<template id="dd-secinv">'), 'نافذة الفواتير الصادرة');
  assert.ok(html.includes('<template id="dd-seccost">'), 'نافذة التكاليف والهامش');
  const inv = html.slice(html.indexOf('<template id="dd-secinv">'));
  const invEnd = inv.slice(0, inv.indexOf('</template>'));
  assert.ok(invEnd.includes('حسب الحالة') && invEnd.includes('صادرة') && invEnd.includes('محصَّلة'),
    'الفواتير مبوَّبة بحالتها بالعربية');
  assert.ok(invEnd.includes('أحدث الفواتير') && invEnd.includes('وزارة الثقافة') && invEnd.includes('INV-1'),
    'أحدث الفواتير باسم العميل ورمزها');
  assert.ok(invEnd.includes(`${YEAR}-06-15`), 'تاريخ الإصدار في القائمة');
  assert.ok(!invEnd.includes('INV-3') && !invEnd.includes('INV-4'), 'المسودّة والملغاة خارج القائمة');
  const cost = html.slice(html.indexOf('<template id="dd-seccost">'));
  const costEnd = cost.slice(0, cost.indexOf('</template>'));
  assert.ok(costEnd.includes('بنود التكلفة حسب النوع') && costEnd.includes('رواتب') && costEnd.includes('تعاقد باطني'),
    'بنود التكلفة بأنواعها');
  assert.ok(costEnd.includes('غير مصنَّف'), 'البند بلا نوعٍ يُسمّى لا يُخفى');
  assert.ok(costEnd.includes('المصروفات المعتمدة حسب النوع') && costEnd.includes('سفر') && costEnd.includes('ضيافة'),
    'المصروفات المعتمدة بأنواعها');
  assert.ok(costEnd.includes('حسب الشهر') && costEnd.includes('مارس') && costEnd.includes('ديسمبر'),
    'أشهر السنة بأسمائها العربية — لا Jan/Dec في نافذةٍ عربية');
  assert.ok(!/Jan|Feb|Mar|Dec/.test(costEnd), 'لا اختصار لاتيني في نافذةٍ عربية');
  assert.ok(!/class="v tnum">0</.test(costEnd), 'شهرٌ خالٍ يُقال «—» لا «٠»');
  assert.ok(costEnd.includes('الإيراد بدون الضريبة') && costEnd.includes('التكاليف'), 'سطر الهامش مكشوف الحساب');
});

// ── لسانُ الشريط واحدٌ مع لسان المنصة: ألفاظ الضريبة والحالات والتذكير والتأنيث ──────────────
test('ألفاظ الضريبة من المعجم وحده — لا مصطلح ثانٍ لمعنىً واحد', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  const band = bandOf(html);
  assert.ok(band.includes('بدون الضريبة') && band.includes('مع الضريبة'), 'لفظا المعجم على علامات الأساس');
  for (const drift of ['صافٍ بعد الضريبة', 'شامل الضريبة', 'الإيراد الصافي']) {
    assert.ok(!html.includes(drift), `لفظٌ خارج المعجم تسرّب: «${drift}»`);
  }
});

test('تأنيثٌ سليم وحرفُ جرٍّ في مكانه', async () => {
  // «بنود التكلفة» و«مصروفات معتمدة» جمعٌ غير عاقل — خبرُه مؤنّثٌ مفرد
  const dry = bandOf(await sectorPage(DRY, { year: String(YEAR), p: 'y' }));
  assert.ok(dry.includes('لم تُسجَّل'), 'بنود التكلفة والمصروفات: «لم تُسجَّل»');
  // وحالةُ الفراغ في نافذة التكاليف جملةٌ تامة بحرفها: «… خلال ٢٠٢٦» / «… في مارس ٢٠٢٦»
  const y = await sectorPage(DRY, { year: String(YEAR), p: 'y' });
  assert.ok(y.includes(`لا تكاليف مسجَّلة خلال ${YEAR}`), 'ظرفُ السنة بحرفه');
  const m = await sectorPage(DRY, { year: String(YEAR), p: 'm3' });
  assert.ok(m.includes(`لا تكاليف مسجَّلة في مارس ${YEAR}`), 'ظرفُ الشهر بحرفه');
  assert.ok(!m.includes(`لا تكاليف مسجَّلة مارس`), 'لا جملة بلا حرف جر');
});

test('حالةُ الفاتورة المتأخرة تُسمّى «متأخرة السداد» لا «متأخرة» وحدها', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  const inv = html.slice(html.indexOf('<template id="dd-secinv">'));
  const invEnd = inv.slice(0, inv.indexOf('</template>'));
  assert.ok(invEnd.includes('متأخرة السداد'), 'الحالة بلفظ المعجم كاملاً');
  assert.ok(!/متأخرة(?!\s*السداد)/.test(invEnd),
    '«متأخرة» وحدها تُقرأ تأخّراً في التسليم لا في الدفع');
});

test('رأس الشريط عنوانٌ في الترتيب، وعدد الخلايا مكتوبٌ على الشبكة', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  assert.ok(band.includes('<h2 class="me">المال في القطاع</h2>'), 'العنوان بالرتبة نفسها التي لجارتيه');
  assert.ok(band.includes('class="mcells" style="--n:4"'), 'أربع خلايا وأربعة أعمدة — لا عمودٌ فارغ');
});

test('خلايا الشريط أزرارٌ تفتح تفصيلها بلا برمجةٍ داخل الوسم', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  for (const dd of ['secrev', 'secinv', 'seccost']) {
    assert.ok(band.includes(`data-dd="${dd}"`), `الخلية تفتح ${dd}`);
  }
  assert.equal((band.match(/<button type="button" class="mcell"/g) || []).length, 4, 'أربع خلايا');
  assert.ok(!band.includes('onclick='), 'لا برمجة داخل الوسم');
  assert.ok(!band.includes('aria-label=""'), 'كل خلية تُنطق باسمها');
});

test('لا تسرّب قيمةٍ خام في نصّ الشريط', async () => {
  for (const p of ['y', 'm3', 'm12', 'q2']) {
    const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p }));
    const text = band.replace(/<[^>]*>/g, ' ');
    assert.ok(!/undefined|NaN|\[object|(?<![a-z])null(?![a-z])/i.test(text), `نصّ الشريط نظيف في ${p}`);
    assert.ok(!/\b(DRAFT|CANCELLED|ISSUED|PAID|APPROVED|SUBMITTED|REJECTED)\b/.test(text),
      `لا حالة مخزَّنة خام في ${p}`);
  }
  // والصفحة كلها معها — الشريط يُضيف نافذتين وأرقاماً، فلا يكفي فحص منطقته وحدها
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  assert.ok(!/undefined|NaN|\[object|(?<![a-z])null(?![a-z])/.test(html), 'الصفحة كلها بلا قيمةٍ خام');
});

// ── ما وجده فحصُ المتصفح على الشريط (2026-09-02) — أربعةُ عيوبٍ لكلٍّ منها حارسٌ هنا ────────────
// كان الفحصُ على شاشةٍ عرضها 390 يقرأ «0%» مكان «84%»، و«100% ربحاً» لفترةٍ لم تُسجَّل تكلفتُها،
// و«0 ر.س.» في نافذة التكاليف حيث يقول الشريطُ «لم يُسجَّل»، و«المحصَّل» معلَّقاً تحت مفوترٍ غائب.

test('نسبةُ الهامش لا تحمل اتجاهاً على خليّتها — العازل داخلها لا على الشبكة', async () => {
  const band = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  // `.mcell` شبكةٌ: dir على عنصرها يقلب حافةَ بدايته فينزلق الرقم خارج الشاشة الضيّقة
  assert.ok(!/class="mv tnum"[^>]*\sdir=/.test(band), 'لا اتجاه على قيمة الخليّة نفسها');
  const margin = cellOf(band, 'الهامش الإجمالي');
  assert.ok(margin.includes('<bdi dir="ltr">79%</bdi>'), 'النسبة داخل عازلٍ يقرأ يساراً');
  // وبقيةُ الخلايا كما كانت: قيمةٌ في `.mv` بلا اتجاهٍ أصلاً
  for (const eye of ['الإيراد المحقق', 'المفوتر', 'التكاليف']) {
    const c = cellOf(band, eye);
    assert.ok(/<span class="mv tnum"[^>]*title="/.test(c), `قيمة «${eye}» بوسمها الأصلي وتلميحها`);
    assert.ok(!c.includes('dir='), `لا اتجاه في خلية «${eye}»`);
  }
});

test('فترةٌ بإيرادٍ بلا تكلفةٍ مسجَّلة: لا «100%» ولا دعوى ربحٍ كامل', async () => {
  // ديسمبر: إيرادٌ 600 ألفاً ولا بندَ تكلفةٍ ولا مصروف — القسمةُ وحدها تقول «100% ربحاً»
  const dec = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm12' }));
  const margin = cellOf(dec, 'الهامش الإجمالي');
  assert.ok(margin.includes('<span class="mv mz">—</span>'), 'الهامش «—» حتى تُسجَّل التكلفة');
  assert.ok(margin.includes('لا تكاليف مسجَّلة — يُحسب الهامش بعد تسجيلها'), 'السبب مكتوبٌ تحت القيمة');
  assert.ok(/aria-label="[^"]*لا تكاليف مسجَّلة — يُحسب الهامش بعد تسجيلها[^"]*"/.test(margin),
    'ومنطوقٌ لقارئ الشاشة كما هو مكتوب');
  assert.ok(!dec.includes('100%'), 'لا نسبةَ ربحٍ كاملٍ صنعها غيابُ الإدخال');
  assert.ok(!dec.includes('ربحاً') && !dec.includes('خسارة'), 'ولا حكمَ ربحٍ ولا خسارة');
  // والسنةُ — وفيها تكلفةٌ مسجَّلة — تعرض نسبتها كما كانت
  const y = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }));
  assert.ok(cellOf(y, 'الهامش الإجمالي').includes('79%'), 'نسبةُ السنة محسوبةٌ على طرفين مسجَّلين');
});

test('نافذة التكاليف تقول «لم تُسجَّل» حيث يقول الشريط — لا «0 ر.س.»', async () => {
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

test('محصَّلٌ في شهرٍ بلا فاتورةٍ صادرة يقول أساسه: لفواتير سابقة', async () => {
  const aug = bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm8' }));
  const inv = cellOf(aug, 'المفوتر');
  assert.ok(inv.includes('لم يُسجَّل'), 'لا فاتورة صادرة في أغسطس');
  assert.ok(inv.includes('المحصَّل <b class="tnum">50K</b> — لفواتير سابقة، بتاريخ التحصيل'),
    'المحصَّل بأساسه لا معلَّقاً تحت عنوانٍ غائب');
  assert.ok(inv.includes('والمحصَّل يُحسب بتاريخ التحصيل'), 'التلميح يقول تاريخَي الطرفين');
  // وشهرٌ فيه فاتورةٌ صادرة: السطر الثاني رقمٌ مختصرٌ كما كان
  const mar = cellOf(bandOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm3' })), 'المفوتر');
  assert.ok(!mar.includes('لفواتير سابقة'), 'لا تفسير حيث لا لبس');
});
