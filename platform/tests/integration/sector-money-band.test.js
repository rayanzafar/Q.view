// ── بطاقة «المال في القطاع» بعد إعادة بنائها ──────────────────────────────────────────────
// كانت أربعَ خلايا (الإيراد، المفوتر، التكاليف، الهامش) ثلاثةٌ منها مكرَّرةٌ على الشاشة نفسها:
// الإيراد في «نبض القطاع» فوقها، والمفوتر والمحصَّل محطتان في «رحلة القيمة»، والتكلفة سطرٌ في
// نافذة الهامش. فبقيت ثلاثةُ أسئلةٍ لا يجيبها غيرها:
//   ١) «المتبقي من العقود» — قيمة العقود النشطة ناقص ما تحقق منها إيراداً. رصيدٌ **تراكمي**
//      لا يتبع الفترة، ولذلك يقوله سطرُه صراحةً كي لا يُحسب عطلاً حين يبدّل القارئ الشهر.
//   ٢) «منجَز لم يُفوتر» — فارقُ المتحقق عن المفوتر في الفترة نفسها، صافيَين. وسالبُه حالةٌ
//      أخرى باسمها: «المفوتر قبل الإنجاز».
//   ٣) «الهامش الإجمالي» — بمنطقه كما كان: لا نسبةَ حتى يُسجَّل طرفاها.
//
// ما تحرسه هذه الاختبارات:
//   • ثلاثُ خلايا لا أكثر، وبموضع البطاقة بين «نبض القطاع» و«قراءة سند التنفيذية».
//   • كل رقمٍ بأساسه المعلَن: العقدُ المسودّة خارج المتبقي، والمسودّة والملغاة خارج المفوتر،
//     والمصروف الذي ينتظر اعتماداً ليس تكلفة.
//   • الفترة تحكم خليّة الفارق وحدها — والمتبقي من العقود لا يتحرّك بها.
//   • لا تكرار: خلايا الأمس («الإيراد المحقق»، «المفوتر»، «المحصَّل») لم تعد في البطاقة،
//     و«الهامش الإجمالي» يُقرأ مرّةً واحدة في متن الصفحة.
//   • الصفرُ يُقال «لم يُسجَّل» لا «٠ ر.س.» — قاعدة المنصة منذ v5.47.
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
const DRY = U('u_dry', 'ZER');   // قطاعٌ بلا عقدٍ ولا إيرادٍ ولا تكلفة

before(async () => {
  for (const [id, name] of [['SOL', 'قطاع الحلول'], ['ZER', 'قطاع بلا أرقام']]) {
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

  // ── العقود: النشط وحده يدخل «المتبقي»، والمسودّة التزامٌ لم يُوقَّع بعد ──
  //   متعاقد صافياً 2.0M − ما تحقق 1.0M = متبقٍّ 1.0M (تحقق 50%)
  await insert('contract', { id: 'K_ACT', code: 'CN-1', client_id: 'C1', project_id: 'P1', sector_id: 'SOL',
    value_halalas: 2_300_000_00, net_value_halalas: 2_000_000_00, status: 'ACTIVE',
    start_date: `${YEAR}-01-01`, signed_at: `${YEAR}-01-01`, created_at: T });
  await insert('contract', { id: 'K_DRAFT', code: 'CN-2', client_id: 'C1', project_id: 'P1', sector_id: 'SOL',
    value_halalas: 10_350_000_00, net_value_halalas: 9_000_000_00, status: 'DRAFT',
    start_date: `${YEAR}-02-01`, created_at: T });

  // ── الإيراد: صافي ثلاثة أشهر — مارس 400 ألفاً وسبتمبر 100 ألفاً وديسمبر 500 ألفاً (مليون) ──
  await insert('revenue_line', { id: 'RL3', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 460_000_00, net_amount_halalas: 400_000_00, created_at: T });
  await insert('revenue_line', { id: 'RL9', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 9,
    amount_halalas: 115_000_00, net_amount_halalas: 100_000_00, created_at: T });
  await insert('revenue_line', { id: 'RL12', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 12,
    amount_halalas: 575_000_00, net_amount_halalas: 500_000_00, created_at: T });

  // ── الفواتير: قطاعها يُستنتج من مشروعها (بلا sector_id) — والمسودّة والملغاة خارج الحساب ──
  //   صافي السنة = 260 + 175 + 130 = 565 ألفاً
  await insert('invoice', { id: 'I_ISS', code: 'INV-1', project_id: 'P1', client_id: 'C1',
    amount_halalas: 300_000_00, net_amount_halalas: 260_000_00,
    issue_date: `${YEAR}-03-10`, status: 'ISSUED', created_at: T });
  await insert('invoice', { id: 'I_PAID', code: 'INV-2', project_id: 'P1', client_id: 'C1',
    amount_halalas: 200_000_00, net_amount_halalas: 175_000_00,
    issue_date: `${YEAR}-06-15`, status: 'PAID', created_at: T });
  await insert('invoice', { id: 'I_DRAFT', code: 'INV-3', project_id: 'P1', client_id: 'C1',
    amount_halalas: 900_000_00, issue_date: `${YEAR}-04-01`, status: 'DRAFT', created_at: T });
  await insert('invoice', { id: 'I_CAN', code: 'INV-4', project_id: 'P1', client_id: 'C1',
    amount_halalas: 800_000_00, issue_date: `${YEAR}-05-01`, status: 'CANCELLED', created_at: T });
  // فاتورةٌ متأخرة السداد — تكفّل بأن تُصيَّر تسميةُ الحالة فعلاً فتُفحَص لا تُفترض
  await insert('invoice', { id: 'I_OD', code: 'INV-5', project_id: 'P1', client_id: 'C1',
    amount_halalas: 150_000_00, net_amount_halalas: 130_000_00,
    issue_date: `${YEAR}-09-01`, due_date: `${YEAR}-10-01`, status: 'OVERDUE', created_at: T });
  await insert('collection', { id: 'COL1', invoice_id: 'I_PAID', amount_halalas: 200_000_00,
    collected_at: `${YEAR}-06-20`, created_at: T });
  await insert('collection', { id: 'COL2', invoice_id: 'I_ISS', amount_halalas: 50_000_00,
    collected_at: `${YEAR}-08-12`, created_at: T });

  // ── المخرجات المسلَّمة بلا فاتورةٍ مرتبطة — قائمةُ نافذة «منجَز لم يُفوتر» ──
  await insert('deliverable', { id: 'D1', project_id: 'P1', sector_id: 'SOL', name_ar: 'تقرير التشخيص',
    amount_halalas: 120_000_00, month: 3, year: YEAR, status: 'DELIVERED',
    delivered_at: `${YEAR}-03-20`, created_at: T });
  await insert('deliverable', { id: 'D2', project_id: 'P1', sector_id: 'SOL', name_ar: 'خارطة الطريق',
    amount_halalas: 80_000_00, month: 12, year: YEAR, status: 'ACCEPTED',
    accepted_at: `${YEAR}-12-05`, created_at: T });

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
const band = async (user, p) => bandOf(await sectorPage(user, { year: String(YEAR), p }));

// خلايا البطاقة مقطوعةٌ عند وسمها لا عند نوع عنصرها: الخليّة زرٌّ اليوم وقد تصير عنصراً
// بدورٍ معلَن غداً، والفحص على `class="mcell"` يبقى صادقاً في الحالتين.
const cellsOf = (b) => b.split('class="mcell"').slice(1);
const cellOf = (b, eye) => {
  const hit = cellsOf(b).find((c) => c.includes(eye));
  assert.ok(hit, `خلية «${eye}» في البطاقة`);
  return hit;
};
// نافذةُ تفصيلٍ بعينها من الصفحة
const ddOf = (html, key) => {
  const a = html.indexOf(`<template id="dd-${key}">`);
  assert.ok(a > -1, `نافذة ${key} مبنيّة`);
  return html.slice(a, html.indexOf('</template>', a));
};
// ما يقرأه الإنسان: بلا أوراق أنماطٍ ولا برمجةٍ ولا نوافذَ مطويّة، ثم بلا وسمٍ أصلاً — فلا
// يُحسب نصٌّ في `aria-label` تكراراً مرئياً، ولا تعليقُ تصميمٍ داخل `<style>` سطراً معروضاً.
const bodyText = (html) => html
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<template[\s\S]*?<\/template>/g, ' ')
  .replace(/<[^>]*>/g, ' ');
// علامات الاتجاه والمسافة غير القاطعة التي يضعها منسّق العملة حول المبالغ تُزال قبل الفحص
// النصّي — هي شكلُ العرض لا لفظُه، ومقارنتها حرفياً تُفشل الفحص على تنسيقٍ سليم.
const plain = (h) => h.replace(/[‎‏]/g, '').replace(/ /g, ' ');

test('البطاقة بموضعها وبعنوانها ووسمها', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  const kpi = html.indexOf('id="kpi-band"');
  const money = html.indexOf('id="money-band"');
  const exec = html.indexOf('class="exec-band"');
  assert.ok(kpi > -1 && money > kpi, 'البطاقة بعد «نبض القطاع»');
  assert.ok(exec > money, 'البطاقة قبل «قراءة سند التنفيذية»');
  assert.ok(html.includes('<section id="money-band" class="money-band card" aria-labelledby="mb-h">'),
    'فصلٌ كامل موسومٌ بعنوانه — لا سطرٌ بلا رتبة');
  assert.ok(html.includes('<h2 id="mb-h">المال في القطاع</h2>'), 'العنوان بالرتبة نفسها التي لجارتيه');
  const b = bandOf(html);
  assert.ok(b.includes(`سنة ${YEAR}`), 'صدى الفترة على رأس البطاقة');
});

test('ثلاثُ خلايا لا أكثر — بأسمائها الثلاثة وبنوافذها الثلاث', async () => {
  const b = await band(LEAD, 'y');
  assert.equal(cellsOf(b).length, 3, 'ثلاث خلايا');
  assert.ok(b.includes('class="mcells" style="--n:3"'), 'ثلاثة أعمدة لثلاث خلايا — لا عمودٌ فارغ');
  for (const eye of ['المتبقي من العقود', 'منجَز لم يُفوتر', 'الهامش الإجمالي']) {
    assert.ok(cellOf(b, eye), `الخلية «${eye}»`);
  }
  for (const dd of ['seccontracts', 'secunbilled', 'seccost']) {
    assert.ok(b.includes(`data-dd="${dd}"`), `الخلية تفتح ${dd}`);
  }
  assert.equal((b.match(/data-action="open-dd"/g) || []).length, 3, 'كل خلية تفتح تفصيلها');
  assert.ok(!b.includes('onclick='), 'لا برمجة داخل الوسم');
  assert.ok(!b.includes('aria-label=""'), 'كل خلية تُنطق باسمها');
});

test('لا تكرار: خلايا الأمس خرجت، و«الهامش الإجمالي» يُقرأ مرّةً واحدة في المتن', async () => {
  // الإيراد في «نبض القطاع» فوقها، والمفوتر والمحصَّل محطتان في «رحلة القيمة» — فتكرارها هنا
  // كان يجعل القارئ يقارن رقماً بنفسه ويحسب الاختلافَ في الصياغة اختلافاً في الرقم.
  for (const p of ['y', 'm3', 'm9', 'm12']) {
    const b = await band(LEAD, p);
    assert.ok(!b.includes('الإيراد المحقق'), `«الإيراد المحقق» خارج البطاقة في ${p}`);
    assert.ok(!b.includes('المحصَّل'), `«المحصَّل» خارج البطاقة في ${p}`);
    assert.ok(!/class="ml">المفوتر</.test(b), `لا خليّة اسمها «المفوتر» في ${p}`);
    assert.ok(!/class="ml">التكاليف</.test(b), `ولا خليّة اسمها «التكاليف» في ${p}`);
  }
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  assert.equal((bodyText(html).match(/الهامش الإجمالي/g) || []).length, 1,
    '«الهامش الإجمالي» عنوانٌ واحد في المتن — سطرُ الهامش في الدرج حُذف');
});

// ── (١) المتبقي من العقود ────────────────────────────────────────────────────────────────
test('المتبقي من العقود: النشط ناقص ما تحقق — والمسودّة خارجه', async () => {
  const c = cellOf(await band(LEAD, 'y'), 'المتبقي من العقود');
  // متعاقد صافياً 2.0M − ما تحقق 1.0M = 1.0M
  assert.ok(c.includes('>1.0M<'), 'المتبقي = العقود النشطة صافيةً ناقص ما تحقق');
  assert.ok(/title="[^"]*1[,٬]000[,٬]000/.test(c), 'القيمة الكاملة على التلميح لا مبتورة');
  assert.ok(c.includes('تحقق <b class="tnum"><bdi dir="ltr">50%</bdi></b>'),
    'نسبةُ ما تحقق من المتعاقد — داخل عازلٍ يقرأ يساراً');
  assert.ok(c.includes('من قيمة تعاقد 2.0M'), 'مرجعُ النسبة قيمةُ التعاقد الصافية — لا الإجمالي 2.3M');
  assert.ok(!c.includes('2.3M'), 'ولا مرجعان لنسبةٍ واحدة');
  assert.ok(c.includes('رصيد تراكمي'), 'يقول إنه تراكمي كي لا يُحسب عطلاً حين تتغيّر الفترة');
  const b = await band(LEAD, 'y');
  assert.ok(!b.includes('9.0M') && !b.includes('10.4M'), 'العقد المسودّة التزامٌ لم يُوقَّع — خارج المتبقي');
});

test('الفترة لا تحرّك المتبقي من العقود — وتحرّك خليّة الفارق', async () => {
  const y = await band(LEAD, 'y');
  const q1 = await band(LEAD, 'q1');
  const m3 = await band(LEAD, 'm3');
  assert.ok(q1.includes('الربع الأول'), 'اسم الربع على رأس البطاقة');
  for (const b of [y, q1, m3]) {
    const c = cellOf(b, 'المتبقي من العقود');
    assert.ok(c.includes('>1.0M<') && c.includes('<bdi dir="ltr">50%</bdi>'),
      'الرصيد التراكمي نفسه في كل فترة');
  }
  // والفارق يتبع أشهر الفترة: الربع الأول = مارس وحده هنا (يناير وفبراير بلا حركة)
  assert.ok(cellOf(q1, 'منجَز لم يُفوتر').includes('>140K<'), 'فارقُ الربع الأول بأشهره');
  assert.ok(cellOf(m3, 'منجَز لم يُفوتر').includes('>140K<'), 'ومارس وحده مثلُه هنا');
  assert.ok(cellOf(y, 'منجَز لم يُفوتر').includes('>435K<'), 'وفارقُ السنة بأشهرها كلها');
});

test('قطاعٌ بلا عقودٍ نشطة يقول «لا عقود نشطة» لا صفراً', async () => {
  const c = cellOf(await band(DRY, 'y'), 'المتبقي من العقود');
  assert.ok(c.includes('<span class="mv mz">لا عقود نشطة</span>'), 'العبارة المصمَّمة للفراغ');
  assert.ok(!/\d+%/.test(c), 'لا نسبةَ تُطبع بلا مرجع');
  assert.ok(!c.includes('<span class="ms">') && !c.includes('fig-b'), 'ولا سطرَ مرجعٍ ولا مقياسَ لرقمٍ غائب');
  assert.ok(!/>0<|٠ ر\.س|SAR 0/.test(c), 'لا صفر مطبوع في وجه القارئ');
});

// ── (٢) خليّة الفارق: منجَز لم يُفوتر / المفوتر قبل الإنجاز ───────────────────────────────
test('منجَز لم يُفوتر: فارقُ المتحقق عن المفوتر صافيَين — والمسودّة والملغاة خارجه', async () => {
  const c = cellOf(await band(LEAD, 'y'), 'منجَز لم يُفوتر');
  // 1,000,000 محققاً − 565,000 مفوترةً صافيةً = 435,000
  assert.ok(c.includes('>435K<'), 'الفارق للسنة');
  assert.ok(/title="[^"]*435[,٬]000/.test(c), 'القيمة الكاملة على التلميح');
  assert.ok(c.includes('من إيراد محقق قدره 1.0M'), 'مرجعُ الفارق: ما تحقق في الفترة نفسها');
  const b = await band(LEAD, 'y');
  assert.ok(!b.includes('900K') && !b.includes('800K'), 'المسودّة والملغاة لا تدخلان المفوتر');
  // ولو دخلت المسودّة لصار الفارق سالباً كبيراً — فالحارس على الرقم لا على غيابه وحده
  assert.ok(!b.includes('المفوتر قبل الإنجاز'), 'السنةُ أنجزت أكثرَ مما فوترت');
});

test('شهرٌ فُوتر فيه قبل الإنجاز: الحالة باسمها ونسبةُ ما أُنجز مما فُوتر', async () => {
  // سبتمبر: تحقق 100 ألفاً وفُوتر 130 ألفاً صافيةً — التزامٌ لا أصل
  const b = await band(LEAD, 'm9');
  const c = cellOf(b, 'المفوتر قبل الإنجاز');
  assert.ok(c.includes('>30K<'), 'قيمة الخليّة فارقُ الطرفين لا أحدهما');
  assert.ok(c.includes('أُنجز <b class="tnum"><bdi dir="ltr">77%</bdi></b> من 130K مفوترة'),
    'حصةُ المفوتر التي أُنجزت — لا الرقمُ ذاته مقسوماً على نفسه');
  assert.ok(!b.includes('منجَز لم يُفوتر'), 'لفظٌ واحد للحالة الواحدة');
});

test('فترةٌ بلا إيرادٍ ولا فاتورة: الفراغ يُقال ولا يُطبع صفراً', async () => {
  // أغسطس: تحصيلٌ لفاتورة مارس فقط — لا إيراد ولا فاتورة صادرة
  const c = cellOf(await band(LEAD, 'm8'), 'منجَز لم يُفوتر');
  assert.ok(c.includes('لم يُسجَّل'), 'قيمةُ الخليّة عبارةُ الفراغ');
  assert.ok(c.includes('لا إيراد ولا فواتير في هذه الفترة'), 'وسببُه تحتها');
  assert.ok(!/>0<|٠ ر\.س|SAR 0/.test(c), 'لا صفر مطبوع');
  // وقطاعٌ خالٍ تماماً كذلك
  const dry = cellOf(await band(DRY, 'y'), 'منجَز لم يُفوتر');
  assert.ok(dry.includes('لم يُسجَّل') && dry.includes('لا إيراد ولا فواتير في هذه الفترة'),
    'القطاع الخالي بالعبارة نفسها');
});

// ── (٣) الهامش الإجمالي — منطقُه كما كان ─────────────────────────────────────────────────
test('الهامش: نسبةٌ وربحٌ في قلب العدّاد وتركيبةُ تكلفةٍ بأسطورتها', async () => {
  const b = await band(LEAD, 'y');
  const c = cellOf(b, 'الهامش الإجمالي');
  // (مليون − 210 ألفاً) ÷ مليون
  assert.ok(c.includes('<bdi dir="ltr">79%</bdi>'), 'النسبة داخل عازلٍ يقرأ يساراً');
  assert.ok(c.includes('>790K<ربح') || /790K<small>ربح<\/small>/.test(c), 'الربح المطلق في قلب العدّاد');
  assert.ok(c.includes('بعد التكاليف') && c.includes('>210K<'), 'مجموع التكاليف تحت النسبة');
  assert.ok(!/1\.2M/.test(b), 'المصروف المقدَّم أو المرفوض لا يدخل التكلفة');
  // الأسطورة: عائلتان بلونيهما ورقمَيهما — شريطٌ بلا أسطورة شريطٌ ملوَّن لا يقول شيئاً
  assert.ok(c.includes('بنود التكلفة') && c.includes('>180K<'), 'بنود التكلفة في الأسطورة');
  assert.ok(c.includes('مصروفات معتمدة') && c.includes('>30K<'), 'والمصروفات المعتمدة معها');
  assert.ok(c.includes('fig-s mini'), 'وشريطُ التركيبة حيث العائلتان موجودتان');
});

test('نسبةُ الهامش لا تحمل اتجاهاً على خليّتها — العازل داخلها لا على الشبكة', async () => {
  // `.mcell` شبكةٌ: dir على عنصرها يقلب حافةَ بدايته فينزلق الرقم خارج الشاشة الضيّقة
  const b = await band(LEAD, 'y');
  assert.ok(!/class="mv tnum"[^>]*\sdir=/.test(b), 'لا اتجاه على قيمة الخليّة نفسها');
  for (const eye of ['المتبقي من العقود', 'منجَز لم يُفوتر']) {
    const c = cellOf(b, eye);
    assert.ok(/<span class="mv tnum"[^>]*title="/.test(c), `قيمة «${eye}» بوسمها وتلميحها`);
  }
});

test('فترةٌ بإيرادٍ بلا تكلفةٍ مسجَّلة: لا «100%» ولا دعوى ربحٍ كامل', async () => {
  // ديسمبر: إيرادٌ 500 ألفاً ولا بندَ تكلفةٍ ولا مصروف — القسمةُ وحدها تقول «100% ربحاً»
  const dec = await band(LEAD, 'm12');
  const c = cellOf(dec, 'الهامش الإجمالي');
  assert.ok(c.includes('<span class="mv mz">—</span>'), 'الهامش «—» حتى تُسجَّل التكلفة');
  assert.ok(c.includes('لا تكاليف مسجَّلة — يُحسب الهامش بعد تسجيلها'), 'السبب مكتوبٌ تحت القيمة');
  assert.ok(/aria-label="[^"]*لا تكاليف مسجَّلة — يُحسب الهامش بعد تسجيلها[^"]*"/.test(c),
    'ومنطوقٌ لقارئ الشاشة كما هو مكتوب');
  assert.ok(!c.includes('100%'), 'لا نسبةَ ربحٍ كاملٍ صنعها غيابُ الإدخال');
  assert.ok(!c.includes('ربح') && !c.includes('خسارة'), 'ولا حكمَ ربحٍ ولا خسارة');
  assert.ok(!c.includes('fig-s mini') && !c.includes('بنود التكلفة'), 'ولا تركيبةَ تكلفةٍ لتكلفةٍ لم تُسجَّل');
  // وشهرٌ لا إيراد فيه أصلاً يقول سببه هو الآخر
  const aug = cellOf(await band(LEAD, 'm8'), 'الهامش الإجمالي');
  assert.ok(aug.includes('لا إيراد في هذه الفترة'), 'الهامش بلا إيرادٍ يقول سببه');
  // ومارس — وفيه طرفان مسجَّلان — يعرض نسبته
  assert.ok(cellOf(await band(LEAD, 'm3'), 'الهامش الإجمالي').includes('70%'),
    'نسبةُ مارس محسوبةٌ على طرفين مسجَّلين');
});

// ── نوافذ التفصيل الثلاث ─────────────────────────────────────────────────────────────────
test('نافذة «منجَز لم يُفوتر» تكشف طرفَي الفارق وقائمةَ المخرجات', async () => {
  const dd = plain(ddOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }), 'secunbilled'));
  assert.ok(dd.includes('طرفا الفارق'), 'الحساب مكشوفٌ لا رقمٌ عارٍ');
  assert.ok(dd.includes('<span>الإيراد المحقق</span><b class="tnum">1,000,000 ر.س.</b>'), 'ما تحقق صافياً');
  assert.ok(dd.includes('<span>الفواتير الصادرة</span><b class="tnum">565,000 ر.س.</b>'), 'وما فُوتر صافياً');
  assert.ok(dd.includes('مخرجات مسلَّمة بلا فاتورة'), 'وقائمةُ المخرجات تحتهما');
  assert.ok(dd.includes('لا تُجمع إلى الرقم أعلاه'), 'وتقول إنها للاسترشاد لا جزءٌ من الحساب');
  assert.ok(dd.includes('تقرير التشخيص') && dd.includes('خارطة الطريق'), 'المخرجان بأسمائهما');
  assert.ok(dd.includes('مسلَّم') && dd.includes('مقبول'), 'وحالتاهما بالعربية لا برمزهما');
  assert.ok(!/\b(DELIVERED|ACCEPTED|INVOICED)\b/.test(dd), 'لا حالة مخزَّنة خام');
});

test('نافذة التكاليف والهامش مبنيّة بمحتواها — وبأشهرٍ عربية', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
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
  // ونافذةُ العقود خلف خليّة المتبقي
  assert.ok(html.includes('<template id="dd-seccontracts">'), 'نافذة سجل العقود مبنيّة');
  assert.ok(ddOf(html, 'seccontracts').includes('أكبر العقود'), 'وفيها قائمةُ العقود');
});

test('نافذة التكاليف تقول «لم تُسجَّل» حيث تقول البطاقة — لا «0 ر.س.»', async () => {
  const dd = plain(ddOf(await sectorPage(LEAD, { year: String(YEAR), p: 'm12' }), 'seccost'));
  assert.ok(!/(?<![\d,])0 ر\.س\./.test(dd), 'لا صفرٌ مطبوعٌ بعملته في نافذة التكاليف');
  assert.ok(dd.includes('لم تُسجَّل'), 'رأس النافذة بلفظ الفراغ نفسه');
  assert.ok(dd.includes('لا هامش يُحسب قبل تسجيل التكاليف'), 'جملةٌ واحدة بدل معادلةٍ طرفُها فارغ');
  assert.ok(!dd.includes('100%'), 'ولا نسبةٌ في النافذة أيضاً');
  const yd = plain(ddOf(await sectorPage(LEAD, { year: String(YEAR), p: 'y' }), 'seccost'));
  assert.ok(yd.includes('الإيراد بدون الضريبة') && yd.includes('− التكاليف') && yd.includes('79%'),
    'المعادلة بحسابها حين يكتمل طرفاها');
});

test('نافذةٌ خاليةٌ لا تنكسر: قطاعٌ بلا تكلفةٍ ولا مخرجات', async () => {
  const html = await sectorPage(DRY, { year: String(YEAR), p: 'y' });
  assert.ok(html.includes('<template id="dd-seccost">'), 'نافذة التكاليف مبنيّة ولو خلا القطاع');
  assert.ok(html.includes(`لا تكاليف مسجَّلة خلال ${YEAR}`), 'ظرفُ السنة بحرفه');
  assert.ok(ddOf(html, 'secunbilled').includes(`لا مخرجات مسلَّمة أو مقبولة خلال ${YEAR}`),
    'حالةُ الفراغ في نافذة الفارق — جملةٌ تامة بظرفها');
  assert.ok(!/undefined|NaN|\[object|(?<![a-z])null(?![a-z])/.test(html), 'قطاعٌ خالٍ بلا قيمةٍ خام');
  const m = await sectorPage(DRY, { year: String(YEAR), p: 'm3' });
  assert.ok(m.includes(`لا تكاليف مسجَّلة في مارس ${YEAR}`), 'ظرفُ الشهر بحرفه');
  assert.ok(!m.includes('لا تكاليف مسجَّلة مارس'), 'لا جملة بلا حرف جر');
});

// ── لسانُ البطاقة واحدٌ مع لسان المنصة، ولا قيمةَ خامٍ تتسرّب ────────────────────────────
test('ألفاظ الضريبة من المعجم وحده — لا مصطلح ثانٍ لمعنىً واحد', async () => {
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  assert.ok(bandOf(html).includes('بدون الضريبة'), 'لفظ المعجم على علامة الأساس');
  for (const drift of ['صافٍ بعد الضريبة', 'شامل الضريبة', 'الإيراد الصافي']) {
    assert.ok(!html.includes(drift), `لفظٌ خارج المعجم تسرّب: «${drift}»`);
  }
  // ونافذة الفواتير — وإن لم تعد تُفتح من البطاقة — تبقى بلسان المعجم: «متأخرة» وحدها تُقرأ
  // تأخّراً في التسليم لا في الدفع
  const inv = ddOf(html, 'secinv');
  assert.ok(inv.includes('متأخرة السداد'), 'الحالة بلفظ المعجم كاملاً');
  assert.ok(!/متأخرة(?!\s*السداد)/.test(inv), 'ولا «متأخرة» عاريةً');
});

test('لا تسرّب قيمةٍ خام في نصّ البطاقة', async () => {
  for (const p of ['y', 'm3', 'm8', 'm9', 'm12', 'q1', 'q2']) {
    const b = await band(LEAD, p);
    const text = b.replace(/<[^>]*>/g, ' ');
    assert.ok(!/undefined|NaN|\[object|(?<![a-z])null(?![a-z])/i.test(text), `نصّ البطاقة نظيف في ${p}`);
    assert.ok(!/\b(DRAFT|CANCELLED|ISSUED|PAID|APPROVED|SUBMITTED|REJECTED|ACTIVE)\b/.test(text),
      `لا حالة مخزَّنة خام في ${p}`);
  }
  const html = await sectorPage(LEAD, { year: String(YEAR), p: 'y' });
  assert.ok(!/undefined|NaN|\[object|(?<![a-z])null(?![a-z])/.test(html), 'الصفحة كلها بلا قيمةٍ خام');
});
