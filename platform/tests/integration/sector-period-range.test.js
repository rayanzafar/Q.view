// ── عدسة الفترة الموسَّعة: «من بداية السنة» ومدى الأشهر ────────────────────────────────────
// القاعدة التي يحرسها هذا الفحص: **الفترة المختارة تعود في كل رابط كما اختيرت**. كان مفتاح
// الرابط يُركَّب من (النوع + الرقم)، وهي تركيبةٌ لا تصلح لـ«من بداية السنة» ولا للمدى أصلاً
// (لا رقمَ ترتيبٍ لهما) — فكانت أي رقاقةٍ أو مُنتقٍ يُعيد القارئ إلى السنة كاملةً صامتاً.
// ويحرس أيضاً: المدى يُصنع بنقرتين على الرقائق نفسها بلا نصٍّ برمجي (أشهراً أو أرباعاً)،
// والروابط القديمة (pa/pb وm3-m8) تبقى تعمل، وألسنة الفترة القديمة (y | q2 | m5) لم يتغيّر
// شيءٌ من سلوكها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-prange-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');

const T = '2026-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL',
  projectIds: new Set(), teamIds: new Set() };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1,
    target_revenue_halalas: 100_000_000, target_sales_halalas: 100_000_000, created_at: T });
  await insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company',
    sector_id: 'SOL', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 9, is_won: 1, is_lost: 0 });
  await insert('client', { id: 'CL_A', name_ar: 'جهة ألف', created_at: T });
  // فرصتان مكسوبتان في نصفَي السنة: كتلةُ المقارنة السابقة لمدى الربعين الأخيرين هي النصف
  // الأول، فلا تُقرأ دلتاها من صفرٍ — والقاعدة التي تُفحص هي وجود السابق لا قيمتُه.
  await insert('opportunity', { id: 'OP_H1', title_ar: 'فرصة النصف الأول', sector_id: 'SOL', client_id: 'CL_A',
    stage_id: 'WON', value_halalas: 1_000_000_00, stage_changed_at: `${YEAR}-02-10T00:00:00Z`, created_at: T });
  await insert('opportunity', { id: 'OP_H2', title_ar: 'فرصة النصف الثاني', sector_id: 'SOL', client_id: 'CL_A',
    stage_id: 'WON', value_halalas: 2_000_000_00, stage_changed_at: `${YEAR}-08-10T00:00:00Z`, created_at: T });
  await insert('project', { id: 'P_ONE', name_ar: 'مشروع المنصة', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: `${YEAR}-01-15`, client_id: 'CL_A', created_at: T });
  // بندان داخل المدى (مارس ويونيو) وبندٌ خارجه (سبتمبر) — كي يُقرأ حدّا المدى من الأرقام
  for (const [id, month, net] of [['RL_M3', 3, 1_000_000_00], ['RL_M6', 6, 2_000_000_00], ['RL_M9', 9, 5_000_000_00]]) {
    await insert('revenue_line', { id, sector_id: 'SOL', project_id: 'P_ONE', year: YEAR, month,
      amount_halalas: Math.round(net * 1.15), net_amount_halalas: net, created_at: T });
  }
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// كل رابطٍ تبنيه الصفحة لنفسها (يُعرف بحمله الفصل) — قيمة الفترة فيه
const stateLinks = (h) => (h.match(/\/app\/sector\?[^"']+/g) || []).filter((l) => l.includes('tab='));
const periodOf = (l) => (/[?&]p=([^&"']+)/.exec(l) || [])[1];

test('«من بداية السنة» لسانٌ قائم: يُصيَّر بلا خطأ، ويُعلَن مختاراً، ولا يتحوّل إلى سنةٍ في الروابط', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), p: 'ytd', tab: 'com' });
  assert.ok(h.includes('من بداية السنة'), 'رقاقة «من بداية السنة» غائبة عن عدسة الفترة');
  assert.ok(h.includes('aria-current="true"'), 'لا رقاقةَ فترةٍ معلَّمةً مختارة');
  // الرقاقة المختارة هي «من بداية السنة» نفسها
  assert.ok(/<a class="on"[^>]*>من بداية السنة<\/a>/.test(h) || /aria-current="true">من بداية السنة</.test(h),
    'رقاقة «من بداية السنة» لم تُعلَّم مختارة');
  const links = stateLinks(h);
  assert.ok(links.length, 'روابط الصفحة غائبة');
  const carry = links.filter((l) => periodOf(l) === 'ytd');
  assert.ok(carry.length >= 3, 'ألسنة الصفحة لم تحمل «من بداية السنة» معها');
  assert.ok(!links.some((l) => /[?&]p=ytd0/.test(l)), 'مفتاحُ الرابط رُكِّب من النوع+الرقم فخرج مشوَّهاً');
  assert.ok(!h.includes('undefined') && !h.includes('NaN'), 'قيمةٌ غير محسوبة تسرّبت إلى الشاشة');
});

test('مدى الأشهر: يُصيَّر، ويُسمّى بحدّيه، ويعود في كل رابطٍ كما اختير', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), p: 'm3-m8', tab: 'com' });
  assert.ok(h.includes('من مارس إلى أغسطس'), 'اسم المدى بحدّيه غائب عن الشاشة');
  const links = stateLinks(h);
  const carry = links.filter((l) => periodOf(l) === 'm3-m8');
  assert.ok(carry.length >= 1, 'روابط الصفحة لم تحمل المدى معها');
  // ومُنتقيا العميل والمشروع صارا نموذجَي GET (v6.01) لا قائمتَي روابط: يحملان حالة الشاشة —
  // والمدى منها — في حقولٍ خفيّة، فيُفحص الحملُ هناك لا في href.
  assert.equal((h.match(/name="p" value="m3-m8"/g) || []).length, 2, 'نموذجا المُنتقيَين لم يحملا المدى');
  assert.ok(!links.some((l) => /[?&]p=range/.test(l)), 'مفتاحُ المدى خرج «range» بدل حدّيه');
  assert.ok(!h.includes('undefined') && !h.includes('NaN'), 'قيمةٌ غير محسوبة تسرّبت إلى الشاشة');
});

test('المدى يقصّ الإيراد إلى أشهره: مارس ويونيو داخله وسبتمبر خارجه', async () => {
  const inside = await sectorPage(ADMIN, { year: String(YEAR), p: 'm3-m8' });
  // 1.0M + 2.0M داخل المدى — و5.0M من سبتمبر خارجه
  assert.ok(inside.includes('3.0M'), 'مجموع أشهر المدى غائب عن بطاقة الإيراد');
  const sept = await sectorPage(ADMIN, { year: String(YEAR), p: 'm9' });
  assert.ok(sept.includes('5.0M'), 'شهرٌ خارج المدى فقد إيراده');
});

// ── الروابط القديمة تبقى تعمل بعد رفع نموذج المدى ─────────────────────────────────────────
// النموذج (من شهر / إلى شهر / اعرض المدى) رُفع من الشريط — والمدى صار يُصنع بنقرتين على
// الرقائق نفسها. لكنّ `pa`/`pb` تبقى مقبولةً من الخادم: رابطٌ قديمٌ حُفظ في مفضلةٍ أو أُرسل
// في رسالةٍ لا يجوز أن ينكسر، وقبولُ مدخلٍ قديم أرخص من كسر عهدٍ قُطع.
test('نموذج المدى رُفع من الشريط، و«pa/pb» تبقى مقبولةً من الخادم', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), p: 'y', tab: 'com' });
  assert.ok(!/class="prange"/.test(h), 'نموذج مدى الأشهر لم يُرفع من الشريط');
  assert.ok(!h.includes('name="pa"') && !h.includes('name="pb"'), 'مُنتقيا المدى بقيا في الصفحة');
  assert.ok(!h.includes('اعرض المدى'), 'زرّ «اعرض المدى» بقي في الشريط');
  // والحقلان يصلان الصفحة فتُركّب منهما فترةٌ واحدة تطابق المفتاح القانوني
  const viaSelects = await sectorPage(ADMIN, { year: String(YEAR), pa: '3', pb: '8', tab: 'com' });
  assert.ok(viaSelects.includes('من مارس إلى أغسطس'), 'رابطٌ قديم بـpa/pb لم يُركِّب المدى');
  assert.ok(stateLinks(viaSelects).some((l) => periodOf(l) === 'm3-m8'), 'المدى المركَّب لم يصر مفتاحاً في الروابط');
  // مُنتقيان معكوسان يُقلبان، وشهران متطابقان يعودان شهراً واحداً
  const rev = await sectorPage(ADMIN, { year: String(YEAR), pa: '8', pb: '3' });
  assert.ok(rev.includes('من مارس إلى أغسطس'), 'المدى المعكوس لم يُقلب');
  const one = await sectorPage(ADMIN, { year: String(YEAR), pa: '5', pb: '5' });
  assert.ok(stateLinks(one).some((l) => periodOf(l) === 'm5'), 'شهرٌ واحد لم يعد شهراً في المفتاح');
});

// ── نقرتان تصنعان مدىً: القاعدة كلُّها على الخادم، بلا سطرٍ من نصٍّ برمجي ──────────────────
// رابطُ كل رقاقةٍ يقول ما ستفعله نقرتُها: من فترةٍ مفردةٍ من جنسها ⇒ المدى بينهما، وإلا
// ⇒ الرقاقة وحدها. فالنقرة الأولى تختار، والثانية تمدّ، والثالثة تُعيد الاختيار إلى المنقور.
const chipHref = (h, label) => {
  const re = new RegExp(`<a [^>]*href="([^"]*)"[^>]*>${label}</a>`);
  const m = re.exec(h);
  assert.ok(m, `رقاقة «${label}» غائبة عن مُنتقي الفترة`);
  return m[1];
};
const chipTag = (h, label) => {
  const re = new RegExp(`<a [^>]*>${label}</a>`);
  const m = re.exec(h);
  assert.ok(m, `رقاقة «${label}» غائبة عن مُنتقي الفترة`);
  return m[0];
};

test('رقائق الأشهر: النقرة الأولى شهرٌ مفرد، والثانية مدىً، والثالثة تعود إلى المنقور', async () => {
  // من السنة: كل رقاقة شهرٍ تختار شهرها وحده
  const fromYear = await sectorPage(ADMIN, { year: String(YEAR), p: 'y', tab: 'com' });
  assert.ok(chipHref(fromYear, 'مايو').includes('p=m5'), 'رقاقة مايو من السنة لم تختر الشهر وحده');
  // من شهرٍ مفرد: رقاقةُ شهرٍ آخر تمدّ المدى، ورقاقةُ الشهر نفسه تبقى عليه
  const fromM5 = await sectorPage(ADMIN, { year: String(YEAR), p: 'm5', tab: 'com' });
  assert.ok(chipHref(fromM5, 'أغسطس').includes('p=m5-m8'), 'النقرة الثانية لم تصنع المدى');
  assert.ok(chipHref(fromM5, 'مارس').includes('p=m3-m5'), 'المدى لا يُبنى إلى الوراء');
  assert.ok(chipHref(fromM5, 'مايو').includes('p=m5'), 'رقاقة الشهر المختار غيّرت الفترة');
  // ومن المدى: كل رقاقةٍ تعود إلى شهرها وحده — لا مدىً فوق مدى
  const fromRange = await sectorPage(ADMIN, { year: String(YEAR), p: 'm5-m8', tab: 'com' });
  for (const [label, key] of [['مايو', 'p=m5'], ['يونيو', 'p=m6'], ['أغسطس', 'p=m8'], ['ديسمبر', 'p=m12']]) {
    assert.ok(chipHref(fromRange, label).includes(key), `رقاقة ${label} من المدى لم تعد إلى شهرها`);
  }
  // والربعُ جنسٌ آخر: لا يمدّ مدىً مع شهر
  const fromQ2 = await sectorPage(ADMIN, { year: String(YEAR), p: 'q2', tab: 'com' });
  assert.ok(chipHref(fromQ2, 'أغسطس').includes('p=m8'), 'رقاقة شهرٍ من ربعٍ مفرد صنعت مدىً مختلط الجنس');
});

test('رقائق الأرباع: القاعدة نفسها — مفردٌ ثم مدىً ثم عودة', async () => {
  const fromYear = await sectorPage(ADMIN, { year: String(YEAR), p: 'y', tab: 'com' });
  assert.ok(chipHref(fromYear, 'ر3').includes('p=q3'), 'رقاقة الربع الثالث من السنة لم تختر الربع وحده');
  const fromQ1 = await sectorPage(ADMIN, { year: String(YEAR), p: 'q1', tab: 'com' });
  assert.ok(chipHref(fromQ1, 'ر3').includes('p=q1-q3'), 'النقرة الثانية على ربعٍ لم تصنع مدى أرباع');
  assert.ok(chipHref(fromQ1, 'ر1').includes('p=q1'), 'رقاقة الربع المختار غيّرت الفترة');
  const fromQRange = await sectorPage(ADMIN, { year: String(YEAR), p: 'q1-q3', tab: 'com' });
  for (const [label, key] of [['ر1', 'p=q1'], ['ر2', 'p=q2'], ['ر3', 'p=q3'], ['ر4', 'p=q4']]) {
    assert.ok(chipHref(fromQRange, label).includes(key), `رقاقة ${label} من المدى لم تعد إلى ربعها`);
  }
  // ومن مدى أرباعٍ لا تُصنع أمداءُ أشهرٍ ضمناً: رقاقة الشهر تختار شهرها وحده
  assert.ok(chipHref(fromQRange, 'مايو').includes('p=m5'), 'رقاقة شهرٍ من مدى أرباعٍ لم تختر شهرها');
});

test('شريطُ المدى: طرفاه مختاران وما بينهما داخله — وعلى جنس المدى وحده', async () => {
  const mRange = await sectorPage(ADMIN, { year: String(YEAR), p: 'm5-m8', tab: 'com' });
  for (const end of ['مايو', 'أغسطس']) {
    const tag = chipTag(mRange, end);
    assert.match(tag, /class="[^"]*\bon\b/, `طرف المدى ${end} غير معلَّم مختاراً`);
    assert.match(tag, /aria-current="true"/, `طرف المدى ${end} بلا إعلان اختيار`);
  }
  for (const mid of ['يونيو', 'يوليو']) {
    const tag = chipTag(mRange, mid);
    assert.match(tag, /class="[^"]*\bin\b/, `الشهر ${mid} داخل المدى ولم يُعلَّم`);
    assert.match(tag, /aria-current="true"/, `الشهر ${mid} داخل المدى بلا إعلان`);
  }
  assert.ok(!/aria-current="true"/.test(chipTag(mRange, 'سبتمبر')), 'شهرٌ خارج المدى عُلِّم داخله');
  // مدى أشهرٍ لا يضيء رقائق الأرباع ولو طابقها
  const q2ish = await sectorPage(ADMIN, { year: String(YEAR), p: 'm4-m6', tab: 'com' });
  assert.ok(!/aria-current="true"/.test(chipTag(q2ish, 'ر2')), 'مدى أشهرٍ أضاء رقاقة ربع');
  // ومدى أرباعٍ يضيء الأرباع وحدها
  const qRange = await sectorPage(ADMIN, { year: String(YEAR), p: 'q1-q3', tab: 'com' });
  assert.match(chipTag(qRange, 'ر1'), /class="[^"]*\bon\b/, 'طرف مدى الأرباع غير معلَّم');
  assert.match(chipTag(qRange, 'ر2'), /class="[^"]*\bin\b/, 'الربع الأوسط لم يُعلَّم داخل المدى');
  assert.match(chipTag(qRange, 'ر3'), /class="[^"]*\bon\b/, 'الطرف الآخر غير معلَّم');
  assert.ok(!/aria-current="true"/.test(chipTag(qRange, 'ر4')), 'ربعٌ خارج المدى عُلِّم داخله');
  assert.ok(!/aria-current="true"/.test(chipTag(qRange, 'مايو')), 'مدى أرباعٍ أضاء رقاقة شهر');
  // وربعٌ مفرد يضيء رقاقته وحدها كما كان
  const q2 = await sectorPage(ADMIN, { year: String(YEAR), p: 'q2', tab: 'com' });
  assert.match(chipTag(q2, 'ر2'), /class="[^"]*\bon\b/, 'الربع المفرد غير معلَّم');
  assert.ok(!/\bin\b/.test(chipTag(q2, 'ر3')), 'ربعٌ آخر عُلِّم داخل مدىً لا وجود له');
});

test('أسماء الأشهر عربيةٌ في المُنتقي — لا Jan ولا Feb', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), p: 'y', tab: 'com' });
  const lens = h.slice(h.indexOf('class="psel"'), h.indexOf('class="psel"') + 6000);
  for (const bad of ['Jan', 'Feb', 'Mar', 'Dec']) {
    assert.ok(!lens.includes(`>${bad}<`), `اسمُ شهرٍ إنجليزي (${bad}) في مُنتقي الفترة`);
  }
  for (const nm of ['يناير', 'أغسطس', 'ديسمبر']) {
    assert.ok(lens.includes(`>${nm}</a>`), `اسم ${nm} العربي غائب عن المُنتقي`);
  }
  // وسطرُ القاعدة تحت الرقائق: النقرة الثانية تصنع مدىً
  assert.ok(h.includes('اختر فترةً، ثم ثانيةً لتحديد مدى بينهما'), 'تلميح قاعدة المدى غائب');
});

test('رقاقةُ المدى تقول بلسانها ما ستفعله نقرتُها', async () => {
  const fromQ1 = await sectorPage(ADMIN, { year: String(YEAR), p: 'q1', tab: 'com' });
  assert.match(chipTag(fromQ1, 'ر3'), /aria-label="الربع الثالث — يحدّد المدى من الربع الأول إلى الثالث"/,
    'رقاقة الربع لا تقول أن نقرتها تحدّد مدىً');
  const fromYear = await sectorPage(ADMIN, { year: String(YEAR), p: 'y', tab: 'com' });
  assert.match(chipTag(fromYear, 'ر3'), /aria-label="الربع الثالث"/, 'رقاقة الربع من السنة وعدت بمدى');
  const fromM5 = await sectorPage(ADMIN, { year: String(YEAR), p: 'm5', tab: 'com' });
  assert.match(chipTag(fromM5, 'أغسطس'), /aria-label="أغسطس — يحدّد المدى من مايو إلى أغسطس"/,
    'رقاقة الشهر لا تقول أن نقرتها تحدّد مدىً');
});

// ── «فترة قادمة» صفةُ الرقاقة لا صفةُ وجهتها ─────────────────────────────────────────────
// كانت الرقاقة تقرأ حالَ **المدى الذي ستصنعه نقرتُها**: من الربع الأول، رقاقةُ ر٤ وجهتُها
// `q1-q4` وهو مدىً يبدأ في يناير — فيُقرأ ماضياً وتفقد ر٤ وسمَ «لم يبدأ بعد» رغم أنها ربعٌ
// لم يأتِ. والوسمُ يصف الرقاقة (ربعَها هي)، والنصُّ وحده يصف الوجهة.
const monthNow = new Date().getUTCMonth() + 1;
test('رقاقةُ فترةٍ لم تبدأ تبقى موسومةً «قادمة» ولو كانت وجهتُها مدىً بدأ', async () => {
  if (monthNow <= 9) {
    const fromQ1 = await sectorPage(ADMIN, { year: String(YEAR), p: 'q1', tab: 'com' });
    const q4 = chipTag(fromQ1, 'ر4');
    assert.match(q4, /class="[^"]*\bfut\b/, 'ر4 فقدت وسم «فترة قادمة» لأن مدى q1-q4 بدأ');
    assert.match(q4, /aria-label="[^"]*فترة قادمة/, 'ر4 لا تقول لقارئ الشاشة إنها لم تبدأ');
  }
  if (monthNow <= 11) {
    const fromM5 = await sectorPage(ADMIN, { year: String(YEAR), p: 'm5', tab: 'com' });
    const dec = chipTag(fromM5, 'ديسمبر');
    assert.match(dec, /class="[^"]*\bfut\b/, 'ديسمبر فقد وسم «فترة قادمة» لأن مدى m5-m12 بدأ');
    assert.match(dec, /aria-label="[^"]*يحدّد المدى من مايو إلى ديسمبر/, 'نصُّ المدى سقط من الرقاقة');
  }
  // وسنةٌ منقضية لا رقاقةَ قادمةٍ فيها أصلاً — ولا سمةَ صنفٍ فارغة في أي رقاقة
  const past = await sectorPage(ADMIN, { year: String(YEAR - 1), p: 'y', tab: 'com' });
  // رقائقُ الأرباع والأشهر وحدها (مخرَج `pUnitChip`) — من أول مجموعة الأرباع إلى آخر الشريط
  const chips = past.slice(past.indexOf('aria-label="الأرباع"'), past.indexOf('class="phint"'));
  assert.ok(!/\bfut\b/.test(chips), 'رقاقةٌ في سنةٍ منقضية وُسمت «قادمة»');
  assert.ok(!chips.includes('class=""'), 'رقاقةٌ خرجت بسمة صنفٍ فارغة');
});

// ── الانتماء إلى المدى يُقال بلسانه لا بلونه ──────────────────────────────────────────────
test('رقائق المدى تقول «ضمن المدى المختار» — طرفاً كانت أو وسطاً', async () => {
  const mRange = await sectorPage(ADMIN, { year: String(YEAR), p: 'm3-m6', tab: 'com' });
  for (const nm of ['مارس', 'أبريل', 'مايو', 'يونيو']) {
    assert.match(chipTag(mRange, nm), new RegExp(`aria-label="${nm} — ضمن المدى المختار`),
      `رقاقة ${nm} داخل المدى لا تقول انتماءها`);
    assert.match(chipTag(mRange, nm), new RegExp(`title="${nm} — ضمن المدى المختار`),
      `تلميح ${nm} لا يقول انتماءها إلى المدى`);
  }
  assert.ok(!/ضمن المدى المختار/.test(chipTag(mRange, 'يوليو')), 'شهرٌ خارج المدى ادّعى انتماءه');
  const qRange = await sectorPage(ADMIN, { year: String(YEAR), p: 'q1-q3', tab: 'com' });
  for (const [label, nm] of [['ر1', 'الربع الأول'], ['ر2', 'الربع الثاني'], ['ر3', 'الربع الثالث']]) {
    assert.match(chipTag(qRange, label), new RegExp(`aria-label="${nm} — ضمن المدى المختار`),
      `رقاقة ${label} داخل مدى الأرباع لا تقول انتماءها`);
  }
  assert.ok(!/ضمن المدى المختار/.test(chipTag(qRange, 'ر4')), 'ربعٌ خارج المدى ادّعى انتماءه');
  // ورقاقةُ فترةٍ مفردةٍ مختارة ليست «ضمن مدى» — لا مدى أصلاً
  const m5 = await sectorPage(ADMIN, { year: String(YEAR), p: 'm5', tab: 'com' });
  assert.ok(!/ضمن المدى المختار/.test(chipTag(m5, 'مايو')), 'شهرٌ مفرد وُصف بأنه ضمن مدى');
});

test('مدى الأرباع: يُسمّى بالأرباع على الشاشة، ويعود في كل رابطٍ كما اختير', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), p: 'q1-q3', tab: 'com' });
  assert.ok(h.includes('من الربع الأول إلى الثالث'), 'اسم مدى الأرباع غائب عن الشاشة');
  assert.ok(!h.includes('من يناير إلى سبتمبر'), 'مدى الأرباع سُمّي بشهرَيه');
  const links = stateLinks(h);
  assert.ok(links.filter((l) => periodOf(l) === 'q1-q3').length >= 1, 'روابط الصفحة لم تحمل مدى الأرباع');
  assert.equal((h.match(/name="p" value="q1-q3"/g) || []).length, 2, 'نموذجا المُنتقيَين لم يحملا مدى الأرباع');
  assert.ok(!h.includes('undefined') && !h.includes('NaN'), 'قيمةٌ غير محسوبة تسرّبت إلى الشاشة');
});

test('«من بداية السنة» بلا نافذةٍ سابقة تُقارَن بها — ولا دلتا كاذبة', async () => {
  const ytd = await sectorPage(ADMIN, { year: String(YEAR), p: 'ytd' });
  assert.ok(!ytd.includes('عن النافذة السابقة المكافئة'), 'دلتا «عن النافذة السابقة» ظهرت لفترةٍ لا سابقَ لها');
  // ومدى مارس–أغسطس (ستة أشهر) لا سابقَ له داخل سنته أيضاً — ستةٌ قبل مارس تخرج من السنة
  const wide = await sectorPage(ADMIN, { year: String(YEAR), p: 'm3-m8' });
  assert.ok(!wide.includes('عن النافذة السابقة المكافئة'), 'مدى بلا سابقٍ داخل السنة أظهر دلتا');
  // ومدى الأرباع يرث القاعدة نفسها عبر أشهره بلا حسابٍ خاص به: q3-q4 سابقُه الكتلةُ
  // المساويةُ له (q1-q2)، وq1-q3 لا سابقَ له — تسعةٌ قبل يناير تخرج من السنة.
  const q34 = await sectorPage(ADMIN, { year: String(YEAR), p: 'q3-q4' });
  assert.ok(q34.includes('عن النافذة السابقة المكافئة'), 'مدى الربعين الأخيرين بلا مقارنةٍ بالكتلة التي قبله');
  const q13 = await sectorPage(ADMIN, { year: String(YEAR), p: 'q1-q3' });
  assert.ok(!q13.includes('عن النافذة السابقة المكافئة'), 'مدى أرباعٍ بلا سابقٍ داخل السنة أظهر دلتا');
});

// ── «من بداية السنة» في سنةٍ منقضية: اسمُها اسمُ السنة كاملةً ─────────────────────────────
// `periodBounds` توسِّع `ytd` في سنةٍ غير جارية إلى شهورها الاثني عشر — فالأرقام أرقامُ السنة
// كاملةً. وكان اللسان والرقاقةُ ورأسُ فصل «قائمة الدخل» تبقى تقول «من بداية السنة … حتى اليوم»،
// وهي جملةٌ تكذب على قارئها: لا «اليوم» في سنةٍ انقضت، ولا نقصَ في الفترة يُعتذَر عنه.
test('«من بداية السنة» في سنةٍ منقضية تُسمّى «السنة كاملة» ولا تُنسب إلى اليوم', async () => {
  const past = YEAR - 1;
  const h = await sectorPage(ADMIN, { year: String(past), p: 'ytd', tab: 'pl' });
  assert.ok(!h.includes(`من بداية ${past} حتى اليوم`), 'صدى الفترة نسب سنةً منقضية إلى «اليوم»');
  assert.ok(h.includes(`خلال ${past}`), 'صدى الفترة لسنةٍ منقضية ليس «خلال السنة»');
  // ورأسُ فصل «قائمة الدخل» وعمودُ خطة الفترة فيه يقرآن الاسم نفسه
  const pl = h.slice(h.indexOf('id="sec-panel-pl"'), h.indexOf('id="sec-panel-com"'));
  assert.ok(pl.includes('السنة كاملة'), 'رأس فصل قائمة الدخل لم يقل «السنة كاملة»');
  assert.ok(!pl.includes('من بداية السنة'), '«من بداية السنة» بقيت اسماً لفترةٍ تغطي السنة كلها');
  // وصدى شريط «المال في القطاع» يقرأ الاسم نفسه — لا «من بداية سنة … حتى اليوم» لسنةٍ منقضية
  assert.ok(!h.includes(`من بداية سنة ${past} حتى اليوم`), 'صدى شريط «المال في القطاع» بقي يقول «حتى اليوم» لسنةٍ منقضية');
  // والفترة الجارية تبقى كما هي: «من بداية السنة … حتى اليوم» ما دام في السنة شهرٌ لم يأتِ بعد
  if (new Date().getUTCMonth() + 1 < 12) {
    const cur = await sectorPage(ADMIN, { year: String(YEAR), p: 'ytd', tab: 'pl' });
    assert.ok(cur.includes(`من بداية ${YEAR} حتى اليوم`), 'صدى السنة الجارية فقد «حتى اليوم»');
    const curPl = cur.slice(cur.indexOf('id="sec-panel-pl"'), cur.indexOf('id="sec-panel-com"'));
    assert.ok(curPl.includes('من بداية السنة'), 'رأس الفصل في السنة الجارية فقد اسم الفترة');
  }
});

// ── مرحلةُ القمع تبقى في يد القارئ حين يفتح «قائمة الدخل» ─────────────────────────────────
test('فتحُ فصل «قائمة الدخل» لا يُسقط مرشِّح المرحلة التجارية', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), p: 'y', tab: 'com', stage: 'LEAD' });
  // الفصل يُصيَّر مع كل تحميل، فلا نموذجَ خفيّاً يفتحه — ورابطا الملفّ والورقة في لوحته
  // يحملان المرحلة من الشاشة التي صُيِّرت عليها.
  assert.ok(!h.includes('id="pl-tab-form"'), 'النموذج الخفيّ لفتح الفصل بقي في الصفحة');
  const bg = h.slice(h.indexOf('id="sec-panel-pl"'), h.indexOf('id="sec-panel-com"'));
  assert.match(bg, /href="\/app\/sector\/income-statement\?[^"]*stage=LEAD/, 'رابط الورقة فقد المرحلة');
  // ورابطا الملفّ والورقة داخل الفصل يحملانها أيضاً — الصورةُ واحدة
  const open = await sectorPage(ADMIN, { year: String(YEAR), p: 'y', tab: 'pl', stage: 'LEAD' });
  const pl = open.slice(open.indexOf('id="sec-panel-pl"'), open.indexOf('id="sec-panel-com"'));
  assert.match(pl, /href="\/app\/sector\/income-statement\?[^"]*stage=LEAD/, 'رابط الورقة فقد المرحلة');
});

test('الألسنة القديمة كما هي: y و q2 و m5 لم يتغيّر مفتاحها', async () => {
  for (const key of ['y', 'q2', 'm5']) {
    const h = await sectorPage(ADMIN, { year: String(YEAR), p: key, tab: 'com' });
    const links = stateLinks(h);
    assert.ok(links.length, `روابط الصفحة غائبة عند ${key}`);
    assert.ok(links.filter((l) => periodOf(l) === key).length >= 3, `المفتاح ${key} لم يُحفَظ في روابط الصفحة`);
  }
  const q2 = await sectorPage(ADMIN, { year: String(YEAR), p: 'q2' });
  assert.ok(q2.includes('الربع الثاني'), 'اسم الربع الثاني غاب');
  const m5 = await sectorPage(ADMIN, { year: String(YEAR), p: 'm5' });
  assert.ok(m5.includes('مايو'), 'اسم مايو غاب');
});
