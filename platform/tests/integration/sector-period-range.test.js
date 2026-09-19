// ── عدسة الفترة الموسَّعة: «من بداية السنة» ومدى الأشهر ────────────────────────────────────
// القاعدة التي يحرسها هذا الفحص: **الفترة المختارة تعود في كل رابط كما اختيرت**. كان مفتاح
// الرابط يُركَّب من (النوع + الرقم)، وهي تركيبةٌ لا تصلح لـ«من بداية السنة» ولا للمدى أصلاً
// (لا رقمَ ترتيبٍ لهما) — فكانت أي رقاقةٍ أو مُنتقٍ يُعيد القارئ إلى السنة كاملةً صامتاً.
// ويحرس أيضاً: مدى الأشهر يصل من مُنتقيَين اثنين بلا نصٍّ برمجي، وألسنة الفترة القديمة
// (y | q2 | m5) لم يتغيّر شيءٌ من سلوكها.
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
  await insert('client', { id: 'CL_A', name_ar: 'جهة ألف', created_at: T });
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
  assert.ok(carry.length >= 3, 'روابط الصفحة لم تحمل المدى معها');
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

test('المُنتقيان (من شهر / إلى شهر) نموذجٌ عادي يعمل بلا نصٍّ برمجي، ويركّبان الفترة', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), p: 'y', tab: 'com' });
  assert.ok(/<form class="prange" method="get" action="\/app\/sector"/.test(h), 'نموذج مدى الأشهر غائب');
  assert.ok(h.includes('name="pa"') && h.includes('name="pb"'), 'مُنتقيا المدى غائبان');
  assert.ok(h.includes('من شهر') && h.includes('إلى شهر'), 'تسميتا المُنتقيَين غائبتان');
  assert.ok(/<input type="hidden" name="tab" value="com">/.test(h), 'النموذج لا يحفظ الفصل المفتوح');
  // والحقلان يصلان الصفحة فتُركّب منهما فترةٌ واحدة تطابق المفتاح القانوني
  const viaSelects = await sectorPage(ADMIN, { year: String(YEAR), pa: '3', pb: '8', tab: 'com' });
  assert.ok(viaSelects.includes('من مارس إلى أغسطس'), 'المُنتقيان لم يُركِّبا المدى');
  assert.ok(stateLinks(viaSelects).some((l) => periodOf(l) === 'm3-m8'), 'المدى المركَّب لم يصر مفتاحاً في الروابط');
  // مُنتقيان معكوسان يُقلبان، وشهران متطابقان يعودان شهراً واحداً
  const rev = await sectorPage(ADMIN, { year: String(YEAR), pa: '8', pb: '3' });
  assert.ok(rev.includes('من مارس إلى أغسطس'), 'المدى المعكوس لم يُقلب');
  const one = await sectorPage(ADMIN, { year: String(YEAR), pa: '5', pb: '5' });
  assert.ok(stateLinks(one).some((l) => periodOf(l) === 'm5'), 'شهرٌ واحد لم يعد شهراً في المفتاح');
});

test('«من بداية السنة» بلا نافذةٍ سابقة تُقارَن بها — ولا دلتا كاذبة', async () => {
  const ytd = await sectorPage(ADMIN, { year: String(YEAR), p: 'ytd' });
  assert.ok(!ytd.includes('عن النافذة السابقة المكافئة'), 'دلتا «عن النافذة السابقة» ظهرت لفترةٍ لا سابقَ لها');
  // ومدى مارس–أغسطس (ستة أشهر) لا سابقَ له داخل سنته أيضاً — ستةٌ قبل مارس تخرج من السنة
  const wide = await sectorPage(ADMIN, { year: String(YEAR), p: 'm3-m8' });
  assert.ok(!wide.includes('عن النافذة السابقة المكافئة'), 'مدى بلا سابقٍ داخل السنة أظهر دلتا');
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
  const form = h.slice(h.indexOf('id="pl-tab-form"'), h.indexOf('</form>', h.indexOf('id="pl-tab-form"')));
  assert.ok(form, 'نموذج فتح فصل قائمة الدخل غائب');
  assert.match(form, /name="stage" value="LEAD"/, 'النموذج لا يحمل المرحلة المختارة');
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
