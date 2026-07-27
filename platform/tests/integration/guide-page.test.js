// «دليلي» — دليل الاستخدام داخل المنصة. ما تحرسه هذه الاختبارات:
//   ١) الدليل كله يُبنى على الخادم: يُقرأ بلا جافاسكربت، وترتيب الشاشات كما تُرسله الخدمة تماماً
//      (ترتيب الرحلة معنى لا زينة — أول ما يفتحه الموظف أولاً).
//   ٢) كل بطاقة شاشة تحمل طريقيها: «افتح الشاشة» و«ابدأ الجولة» — ورابط الجولة يفتح الشاشة نفسها.
//   ٣) الحقول الاختيارية الفارغة لا تتسرّب إلى الشاشة كقيم خام، والحالات الفارغة مصمَّمة بخطوة تالية.
//   ٤) كل نص من الخدمة يُهرَّب قبل العرض (المحتوى يُدار خارج الشاشة، فلا يُوثق به كوسوم).
//   ٥) الصفحة مفتوحة للجميع، وزر «جولة إرشادية» + سكربتها موجودان في هيكل كل صفحة مع مفتاح الشاشة.
//   ٦) **محدِّدات الجولات حيّة**: كل محدِّد تشير إليه خطوة موجود فعلاً في وسوم شاشته المرسومة.
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

// بيانات عرض ثابتة فوق المخطط: بدونها تُرسم الشاشات بحالاتها الفارغة، فتغيب صفوف الجداول
// وبطاقاتها ولا يبقى في الوسوم ما يُقاس عليه وجود محدِّدات الجولة أصلاً.
const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};
const db = await import('../../src/core/db/index.js');
const seedMod = await import('../../scripts/seed.js');
const { seedFixture } = await import('../../scripts/lib/seed-fixture.mjs');
await quiet(async () => { await seedMod.seed(); await seedFixture(); await seedMod.seedDemoOrg(); });

const { close } = db;
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { guidePage, guideManual } = await import('../../src/web/views/guide.js');
const { PAGE_ACCESS, NAV_ITEMS, pageAllowed } = await import('../../src/web/nav.js');
const { resolveUser } = await import('../../src/core/http/context.js');
const P = await import('../../src/web/pages.js');
const guideSvc = await import('../../src/modules/guide/guide.js');
const content = await import('../../src/core/guide/content.js');

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

// ═══════════════════════════════════════════════════════════════════════════════
// محدِّدات الجولات مقابل الوسوم المرسومة فعلاً
//
// العطل الذي أوجب هذا الفحص: خطوة جولة «مهامي» كانت معلَّقة على `.statgrid` — طبقة أُزيلت حين
// أُعيد بناء الشاشة، فصار محدِّدها لا يطابق شيئاً في المنتج كله. و`guide-tour.js` يتجاوز العنصر
// المفقود **بصمت** (وهو تصرّف صحيح: الجولة يجب ألا تنكسر مع تغيّر الشاشة)، فبقيت الجولة ثلاث
// خطوات مكان أربع بلا اختبار واحد يلاحظ. ومثلها تماماً `#prj-kanban` في جولة «المشاريع»: عنصرٌ
// لا يُرسم إلا بعد اختيار عرض الكانبان، والجولة تبدأ على العرض الافتراضي.
//
// ما يُثبَت هنا بندان، وكلاهما يُقاس على الوسوم التي يستلمها المتصفح فعلاً:
//   (١) **لا محدِّد ميت**: كل محدِّد في كل جولة يطابق عنصراً في الرسم الافتراضي لشاشته عند قارئ
//       واحد على الأقل. المحدِّد الذي لا يطابق أحداً هو المحدِّد المنسيّ، وهو ما يُمسَك هنا.
//       والرسم الافتراضي بالذات (بلا معاملات) لأن الجولة تبدأ من رابط الدليل: `/app/x?tour=1`.
//   (٢) **لا قارئ أمام جولة فارغة**: كل من تعود له جولةٌ تُطابِق خطوةً واحدة منها على الأقل،
//       وإلا رأى «تغيّرت هذه الشاشة» مكان الشرح.
// وخطوة تعتمد على وجود صفوف (كزرّ إنجاز المهمة) تمرّ بالبند الأول لا الثاني — وهذا مقصود:
// تخطّيها عند من لا صفوف عنده سلوك مصمَّم، أما ألا تُطابق أحداً فهو عطل.
//
// المطابقة نصّية مقصودة: المحدِّدات المستعملة بسيطة (مُعرّف · صنف · main · main table · رابط
// القائمة)، والتحليل الكامل للوسوم يعني اعتماداً جديداً لأجل فحص واحد. وأي شكل محدِّد خارج
// الأشكال الخمسة يُسقط الاختبار صراحةً بدل أن يمرّ بلا فحص.
const PAGE_FN = {
  ceo: P.ceoPage, portfolio: P.portfolioPage, sector: P.sectorPage, opportunities: P.opportunitiesPage,
  'my-opportunities': P.myOpportunitiesPage, projects: P.projectsPage, tasks: P.tasksPage,
  timesheet: P.timesheetPage, approvals: P.approvalsPage, team: P.teamPage, staffing: P.staffingPage,
  users: P.usersPage, audit: P.auditPage, reports: P.reportsPage, org: P.orgTreePage,
  finance: P.financePage, mail: P.mailPage, clients: P.clientsPage, imports: P.importsPage,
  guide: P.guidePage,
};

const rx = {
  id: /^#([A-Za-z0-9_-]+)$/,
  cls: /^\.([A-Za-z0-9_-]+)$/,
  nav: /^\.nav-a\[href\^="(\/app\/[a-z-]+)"\]$/,
};
// هل يطابق المحدِّد عنصراً في هذه الوسوم؟ يعيد null لشكل محدِّد لا يعرفه — والاختبار يرفضه.
function anchorPresent(html, sel) {
  let m;
  if ((m = rx.id.exec(sel))) return new RegExp(`id="${m[1]}"`).test(html);
  if ((m = rx.cls.exec(sel))) return new RegExp(`class="[^"]*\\b${m[1]}\\b`).test(html);
  if ((m = rx.nav.exec(sel))) return new RegExp(`<a href="${m[1].replace(/\//g, '\\/')}[^"]*" class="nav-a`).test(html);
  if (sel === 'main') return /<main[\s>]/.test(html);
  if (sel === 'main table') return /<main[\s>][\s\S]*<table[\s>]/.test(html);
  return null;
}

// جلسة حقيقية ثم resolveUser: المستخدم كما يبنيه الخادم (بمعرّف إدارته ومجموعة مشاريعه)،
// لا شكلاً مخترعاً في الاختبار قد يرسم شاشةً لا يراها أحد في التشغيل.
async function asUser(username) {
  const u = await db.get('SELECT id FROM app_user WHERE username = ?', [username]);
  assert.ok(u, `حساب العرض ${username} مزروع`);
  const sid = 'sess_anchors_' + username;
  if (!(await db.get('SELECT id FROM session WHERE id = ?', [sid]))) {
    await db.insert('session', { id: sid, user_id: u.id, created_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z' });
  }
  const resolved = await resolveUser(sid);
  assert.ok(resolved, `جلسة ${username} تُحلّ إلى مستخدم`);
  return resolved;
}

test('كل جولة معلَّقة على عنصر موجود فعلاً في شاشته — لا محدِّد ميت ولا قارئ أمام جولة فارغة', async () => {
  for (const key of Object.keys(content.TOURS)) {
    assert.ok(typeof PAGE_FN[key] === 'function',
      `جولة «${key}» لشاشة لا يعرف هذا الفحص كيف يرسمها — أضِفها إلى الخريطة وإلا بقيت جولتها بلا حارس`);
  }

  const seenAnywhere = new Map();   // «شاشة :: محدِّد» ⟵ هل طابق عند أحد؟
  const emptyForReader = [];
  let rendered = 0;

  for (const account of seedMod.DEMO_USERS) {
    const u = await asUser(account.u);
    for (const key of Object.keys(content.TOURS)) {
      const tour = guideSvc.tourFor(u, key);
      if (!tour) continue;                     // شاشة خارج صلاحيته — لا جولة ولا رسم
      const html = await PAGE_FN[key](u, {});
      rendered++;
      let matched = 0;
      for (const step of tour.steps) {
        const ok = anchorPresent(html, step.anchor);
        assert.notEqual(ok, null,
          `محدِّد «${step.anchor}» في جولة «${key}» بشكل لا يفحصه هذا الاختبار — بسّطه أو وسّع الفحص`);
        const k = `${key} :: ${step.anchor}`;
        seenAnywhere.set(k, (seenAnywhere.get(k) || false) || ok);
        if (ok) matched++;
      }
      if (!matched) emptyForReader.push(`${account.u} ⟵ ${key}`);
    }
  }

  assert.ok(rendered > 40, `الفحص لم يرسم إلا ${rendered} شاشة — بيانات العرض ناقصة والنتيجة الخضراء بلا معنى`);
  const dead = [...seenAnywhere.entries()].filter(([, ok]) => !ok).map(([k]) => k);
  assert.deepEqual(dead, [],
    'محدِّدات لا تطابق أي عنصر في شاشتها عند أي قارئ — خطوات تسقط بصمت من الجولة');
  assert.deepEqual(emptyForReader, [],
    'قرّاء تعود لهم جولة لا تُطابق خطوة واحدة منها — سيرون «تغيّرت هذه الشاشة» مكان الشرح');
});

test('الفحص نفسه يمسك المحدِّد الميت: محدِّد مخترع يُسقطه، ومحدِّد «مهامي» القديم منه', async () => {
  const u = await asUser('demo.employee');
  const html = await PAGE_FN.tasks(u, {});
  // `.statgrid` هو المحدِّد الذي كانت الجولة معلَّقة عليه، وقد أُزيل من المنتج كله.
  assert.equal(anchorPresent(html, '.statgrid'), false, 'المحدِّد القديم يجب أن يُقرأ مفقوداً');
  assert.equal(anchorPresent(html, '.wc-stats'), true, 'والمحدِّد الحالي موجوداً');
  assert.equal(anchorPresent(html, '#لا-وجود-له'), null, 'وشكل محدِّد غير مفحوص يُرفض لا يمرّ');
});
