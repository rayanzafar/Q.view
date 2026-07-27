// «دليلي» — دليل الاستخدام داخل المنصة. ما تحرسه هذه الاختبارات:
//   ١) الدليل كله يُبنى على الخادم: يُقرأ بلا جافاسكربت، وترتيب الشاشات كما تُرسله الخدمة تماماً
//      (ترتيب الرحلة معنى لا زينة — أول ما يفتحه الموظف أولاً).
//   ٢) كل بطاقة شاشة تحمل طريقيها: «افتح الشاشة» و«ابدأ الجولة» — ورابط الجولة يفتح الشاشة نفسها.
//   ٣) الحقول الاختيارية الفارغة لا تتسرّب إلى الشاشة كقيم خام، والحالات الفارغة مصمَّمة بخطوة تالية.
//   ٤) كل نص من الخدمة يُهرَّب قبل العرض (المحتوى يُدار خارج الشاشة، فلا يُوثق به كوسوم).
//   ٥) الصفحة مفتوحة للجميع، وزر «جولة إرشادية» + سكربتها موجودان في هيكل كل صفحة مع مفتاح الشاشة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-guide-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { guidePage, guideManual } = await import('../../src/web/views/guide.js');
const { PAGE_ACCESS, NAV_ITEMS, pageAllowed } = await import('../../src/web/nav.js');

after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const U = (id, role, sector, scope) =>
  ({ id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: sector, scope,
    projectIds: new Set(), teamIds: new Set() });

// حمولة على شكل العقد المتفق عليه مع خدمة الدليل (لا تُستنسخ منها بيانات — شكل فقط).
const PAYLOAD = {
  role: { id: 'bd_manager', name_ar: 'مطوّر أعمال' },
  intro_ar: 'مهمتك أن تفتح فرصاً جديدة وتنقلها مرحلة بعد مرحلة حتى التوقيع.',
  pages: [
    { key: 'my-opportunities', nav_ar: 'فرصي', purpose_ar: 'كل فرصة تحمل اسمك في مكان واحد.',
      first_steps_ar: ['افتح الفرص التي لم تتحرك هذا الأسبوع', 'اكتب الخطوة التالية لكل فرصة'],
      weekly_ar: ['حدّث احتمال الفوز وتاريخ الإغلاق المتوقع'],
      watch_out_ar: 'فرصة بلا خطوة تالية تعني عميلاً ينتظر ردك.' },
    { key: 'clients', nav_ar: 'العملاء', purpose_ar: 'سجل العلاقة مع كل جهة تتعامل معها.',
      first_steps_ar: [], weekly_ar: ['سجّل كل مكالمة أو زيارة يوم حدوثها'], watch_out_ar: null },
  ],
  glossary: [
    { term_ar: 'القيمة المرجّحة', meaning_ar: 'قيمة الفرصة مضروبة في احتمال الفوز بها.' },
    { term_ar: 'فرصة متوقفة', meaning_ar: 'فرصة بقيت في مرحلتها أطول من المعتاد.' },
  ],
  limits_ar: ['أرقام الشركة كاملة يراها مكتب الرئيس التنفيذي', 'رواتب الفريق خارج نطاق دورك'],
};

const NO_LEAK = [/undefined/, /\bNaN\b/, /\[object/, /\bID:/, /\bnull\b/];
const clean = (html, where) => {
  for (const rx of NO_LEAK) assert.ok(!rx.test(html), `${where}: تسرّب ${rx} إلى الصفحة`);
};

test('الدليل يُبنى كاملاً على الخادم: الدور ومقدمته وشاشاته بترتيب الرحلة', () => {
  const html = guideManual(PAYLOAD);
  clean(html, 'جسم الدليل');
  assert.match(html, /مطوّر أعمال/, 'اسم الدور كما ترسله الخدمة');
  assert.match(html, /مهمتك أن تفتح فرصاً جديدة/, 'مقدمة الدور');
  assert.ok(html.indexOf('فرصي') < html.indexOf('العملاء'), 'ترتيب الرحلة كما ورد لا مرتّباً من جديد');
  assert.match(html, /class="gd-num tnum">1</, 'ترقيم الشاشات في خانة الأرقام الموحّدة');
  assert.match(html, /كل فرصة تحمل اسمك في مكان واحد/, 'غرض الشاشة');
  assert.match(html, /أول خطواتك/, 'عنوان الخطوات الأولى');
  assert.match(html, /عادتك الأسبوعية/, 'عنوان العادة الأسبوعية');
  assert.match(html, /اكتب الخطوة التالية لكل فرصة/, 'بند من الخطوات الأولى');
  assert.match(html, /حدّث احتمال الفوز/, 'بند من العادة الأسبوعية');
  assert.match(html, /فرصة بلا خطوة تالية/, 'تحذير الشاشة');
  assert.match(html, /القيمة المرجّحة/, 'قسم المصطلحات');
  assert.match(html, /رواتب الفريق خارج نطاق دورك/, 'قسم خارج النطاق');
});

test('كل بطاقة شاشة تحمل طريقيها: فتح الشاشة، وبدء جولتها على الشاشة نفسها', () => {
  const html = guideManual(PAYLOAD);
  assert.match(html, /href="\/app\/my-opportunities">افتح الشاشة</, 'رابط فتح الشاشة');
  assert.match(html, /href="\/app\/my-opportunities\?tour=1">ابدأ الجولة</, 'رابط بدء الجولة');
  assert.match(html, /href="\/app\/clients\?tour=1"/, 'ولكل شاشة رابطها هي');
  assert.equal((html.match(/ابدأ الجولة/g) || []).length, 2, 'زر جولة لكل شاشة بلا زيادة');
  // فهرس القفز يظهر حين تطول القائمة فقط — لا زينة فوق بطاقتين
  assert.ok(!html.includes('اقفز إلى:'), 'بطاقتان: لا فهرس فوقهما');
  const many = guideManual({ ...PAYLOAD, pages: [...PAYLOAD.pages, { key: 'tasks', nav_ar: 'مهامي', purpose_ar: 'ما عليك اليوم.' }] });
  assert.match(many, /اقفز إلى:/, 'قائمة أطول: فهرس يختصر الطريق');
  assert.match(many, /href="#g-clients"/, 'ولكل شاشة موضعها في الفهرس');
  assert.match(many, /id="g-tasks"/, 'والبطاقة تحمل الموضع نفسه');
});

test('الحقول الاختيارية الفارغة: لا قيمة خام ولا صندوق فارغ', () => {
  const html = guideManual(PAYLOAD);
  clean(html, 'حمولة بحقول فارغة');
  const card = html.slice(html.indexOf('id="g-clients"'));
  assert.ok(!card.includes('أول خطواتك'), 'قائمة فارغة لا تُعرض كعنوان بلا بنود');
  assert.ok(!card.includes('انتبه'), 'بلا تحذير: لا صندوق تحذير فارغ');
  assert.match(card, /سجّل كل مكالمة أو زيارة/, 'وما هو موجود يظهر كاملاً');
  // شاشة بلا خطوات ولا عادة: سطر يشرح الفراغ بدل بياض
  const bare = guideManual({ role: { name_ar: 'مستشار' }, pages: [{ key: 'tasks', nav_ar: 'مهامي' }], glossary: [], limits_ar: [] });
  clean(bare, 'شاشة بلا خطوات');
  assert.match(bare, /لم تُسجَّل خطوات لهذه الشاشة بعد/, 'الفراغ مشروح لا مسكوت عنه');
});

test('حمولة بلا شاشات: حالة فارغة مصمَّمة فيها خطوة تالية', () => {
  const html = guideManual({ role: { name_ar: 'موظف' }, intro_ar: 'حسابك جديد.', pages: [], glossary: [], limits_ar: [] });
  clean(html, 'دليل بلا شاشات');
  assert.match(html, /class="empty-state"/, 'حالة فارغة مصمَّمة');
  assert.match(html, /لم تُفتح لك شاشات بعد/, 'نصّها يقول ما الحال');
  assert.match(html, /العودة إلى مهامي/, 'وفيها خطوة تالية');
  // حمولة بلا أي حقل: لا تنهار ولا تطبع قيمة خام
  clean(guideManual({}), 'حمولة فارغة تماماً');
});

test('كل نص من الخدمة يُهرَّب قبل العرض', () => {
  const html = guideManual({
    role: { name_ar: '<script>x</script>' },
    intro_ar: 'مقدمة "بعلامات" وسطور',
    pages: [{ key: 'tasks', nav_ar: '<img src=x onerror=y>', purpose_ar: 'غرض <b>مهم</b>',
      first_steps_ar: ['خطوة & أخرى'], weekly_ar: [], watch_out_ar: "علامة ' مفردة" }],
    glossary: [{ term_ar: '<i>مصطلح</i>', meaning_ar: 'شرح' }],
    limits_ar: ['<hr>'],
  });
  assert.ok(!/<script>x<\/script>/.test(html), 'لا وسم يُنفَّذ من اسم الدور');
  assert.ok(!/<img src=x/.test(html), 'لا وسم يُنفَّذ من اسم الشاشة');
  assert.ok(!/<hr>/.test(html), 'ولا من قائمة خارج النطاق');
  assert.match(html, /&lt;img src=x onerror=y&gt;/, 'يظهر كنص كما كُتب');
  // مفتاح شاشة غير صالح لا يتحول إلى رابط يقود إلى لا شيء
  const bad = guideManual({ pages: [{ key: '../../etc', nav_ar: 'شاشة', first_steps_ar: ['خطوة'] }] });
  assert.ok(!bad.includes('/app/../../etc'), 'مفتاح غير صالح لا يصير رابطاً');
  assert.ok(!bad.includes('افتح الشاشة'), 'ولا يُعرض له زر يفشل');
});

test('الصفحة كاملة عبر الخدمة: دليل مطوّر الأعمال يصف شاشاته هو لا شاشات غيره', async () => {
  const html = await guidePage(U('u1', 'bd_manager', 'SOLUTIONS', 'own'), {});
  clean(html, 'صفحة دليلي');
  assert.match(html, /dir="rtl"/, 'الصفحة عربية الاتجاه');
  assert.match(html, /<title>دليلي/, 'عنوان الصفحة');
  assert.match(html, /شاشاتك بالترتيب/, 'الدليل يُبنى من الخدمة');
  assert.ok(!/تعذّر فتح دليلك/.test(html), 'لا حالة عطل في المسار الطبيعي');
  assert.match(html, /href="\/app\/my-opportunities\?tour=1"/, 'شاشة يفتحها فعلاً ومعها جولتها');
  assert.ok(!html.includes('href="/app/users?tour=1"'), 'ولا أثر لشاشة خارج صلاحيته');
  // الحالة العُطلية تُعرض برسالة الخدمة العربية نفسها لا برسالة عامة
  const broken = await guidePage({ id: 'x', username: 'حساب بلا دور', role_id: '' }, {});
  clean(broken, 'حساب بلا دور');
  assert.match(broken, /تعذّر فتح دليلك الآن/, 'عنوان الحالة');
  assert.match(broken, /تعذّر تحديد دورك في المنصة/, 'وسببها كما تقوله الخدمة');
  assert.match(broken, /أعد المحاولة/, 'وفيها طريق للخروج');
});

test('الصفحة مفتوحة لكل من يدخل المنصة، ولها مدخل في القائمة', () => {
  assert.equal(typeof PAGE_ACCESS.guide, 'function', 'للصفحة قاعدة وصول معلنة');
  for (const role of ['admin', 'ceo_office', 'sector_lead', 'bd_manager', 'project_manager', 'finance', 'hr', 'consultant', 'employee', 'viewer']) {
    assert.ok(pageAllowed(U('u', role, 'SOLUTIONS', 'own'), 'guide'), `${role} يفتح دليله`);
  }
  const item = NAV_ITEMS.find((n) => n.key === 'guide');
  assert.ok(item, 'مدخل «دليلي» في القائمة');
  assert.equal(item.ar, 'دليلي');
  assert.equal(item.group, 'work', 'ضمن مجموعة العمل اليومي — أقرب مكان لكل مستخدم');
});

test('زر «جولة إرشادية» وسكربتها في هيكل كل صفحة، ومعهما مفتاح الشاشة الحالية', async () => {
  const html = await guidePage(U('u2', 'employee', 'SOLUTIONS', 'own'), {});
  assert.match(html, /data-action="tour-start"/, 'زر بدء الجولة في الترويسة');
  assert.match(html, /data-action="tour-start" data-page="guide"/, 'الزر يحمل مفتاح الشاشة الحالية');
  assert.match(html, /<body data-page="guide">/, 'ومفتاح الشاشة على الصفحة نفسها');
  assert.match(html, /aria-label="جولة إرشادية على هذه الشاشة"/, 'للزر تسمية يقرأها قارئ الشاشة');
  assert.match(html, /src="\/static\/pages\/guide-tour\.js"/, 'سكربت الجولة محمَّل');
  assert.ok(!/onclick="[^"]*tour/i.test(html), 'لا تفاعل مكتوب داخل الوسم');
  assert.match(html, /<a href="\/app\/guide[^"]*" class="nav-a on"/, 'الصفحة معلّمة في القائمة');
});
