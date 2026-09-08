// «مركز التطوير» — ما تحرسه هذه الاختبارات على طبقة العرض وحدها:
//   ١) الشاشتان تُرسمان لعضو الفريق: قائمة المنتجات، وشاشة المنتج بتبويباتها وجدول عناصرها.
//   ٢) من ليس عضواً في أي منتج لا يرى العنصر في القائمة ولا تُفتح له الصفحة (البوابة نفسها).
//   ٣) لا قيمةَ مخزَّنةٍ خام ولا مصطلحٍ تقني ولا معرّفٍ داخلي في الوسوم المرسومة.
//   ٤) زرُّ الترويسة صار زرَّ نموذجٍ داخل المنصة (`data-action="report-open"`)، والنموذج
//      الخارجي لم يعد له أثرٌ في الشيفرة كلها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-devcenter-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { get, all, insert, close } = db;
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const ids = await import('../../src/core/util/ids.js');
const products = await import('../../src/modules/products/products.js');
const items = await import('../../src/modules/products/items.js');
const P = await import('../../src/web/pages.js');
const { PAGE_ACCESS, NAV_ITEMS, pageAllowed } = await import('../../src/web/nav.js');
const { layout } = await import('../../src/web/layout.js');

after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const now = ids.nowIso();
const mkUser = async (uid, name, role) => {
  await insert('app_user', {
    id: uid, username: uid, name_ar: name, email: `${uid}@evc.sa`,
    role_id: role, scope: 'company', active: 1, created_at: now,
  });
  return { id: uid, username: uid, name_ar: name, role_id: role, scope: 'company', productMemberships: new Set() };
};

let admin, member, stranger, product, item, extProduct;

before(async () => {
  admin = await mkUser('u_dc_admin', 'مدير النظام', 'admin');
  member = await mkUser('u_dc_dev', 'عضو الفريق', 'bd_manager');
  stranger = await mkUser('u_dc_out', 'زميل خارج الفريق', 'bd_manager');

  const ctx = { user: admin, ip: '127.0.0.1' };
  product = await products.createProduct(ctx, {
    key: 'sanad', name_ar: 'سند', kind: 'internal', item_prefix: 'SND',
    description: 'منصة الأعمال الداخلية — أعطالها واقتراحاتها تُستقبل هنا.',
  });
  await products.addMember(ctx, product.id, { user_id: member.id, role: 'manager' });
  member.productMemberships = new Set([product.id]);

  // منتجٌ للعملاء إلى جانب الداخلي: الجهات وروابط الاستقبال لا تُرسم إلا له.
  extProduct = await products.createProduct(ctx, {
    key: 'atlas', name_ar: 'أطلس', kind: 'external', item_prefix: 'ATL',
    description: 'منتجٌ يُستقبل من عملائه.',
  });
  await products.addMember(ctx, extProduct.id, { user_id: member.id, role: 'manager' });
  member.productMemberships = new Set([product.id, extProduct.id]);
  const tenant = await products.createTenant(ctx, extProduct.id, { name: 'جهة تجريبية' });
  await products.createLink(ctx, extProduct.id, { tenant_id: tenant.id });
  await products.createVersion(ctx, extProduct.id, { label: '٥٫٨٤' });

  item = await items.insertItem(ctx, product, {
    type: 'bug', title: 'زرّ الحفظ لا يستجيب في شاشة الفرص',
    description: 'ضغطت الحفظ ثلاث مرات ولم يحدث شيء.',
    where_text: 'شاشة الفرص', urgency: 'blocks', source: 'sanad',
    reporter_user_id: stranger.id, reporter_name: stranger.name_ar,
  });
});

// ── ١) الرسم لعضو الفريق ────────────────────────────────────────────────────
test('قائمة مركز التطوير تُرسم لعضو الفريق وتحمل بطاقة منتجه', async () => {
  const html = await P.devCenterPage(member);
  assert.match(html, /مركز التطوير/);
  assert.match(html, /سند/);
  assert.match(html, /بانتظار اعتمادك/);
  assert.match(html, /\/app\/dev-center\//);
});

test('شاشة المنتج تُرسم بتبويباتها وبصفّ العنصر ومفتاحه', async () => {
  const html = await P.devCenterProductPage(member, product.id, {});
  assert.match(html, /العناصر/);
  assert.match(html, /التقارير/);
  assert.match(html, /الإعدادات/);
  assert.match(html, /SND-001/);
  assert.match(html, /زرّ الحفظ لا يستجيب/);
  // الحالة والإلحاح بكلماتهما العربية لا برموزهما
  assert.match(html, /جديد/);
  assert.match(html, /يعطّل عملي/);
  // المنتج الداخلي بلا جهاتٍ ولا روابط استقبال — القسم لا يُرسم أصلاً
  assert.doesNotMatch(html, /روابط الاستقبال/);
});

test('صفحة التقرير المطبوعة تحمل الملخّص وبطاقة العنصر ومرشِّحاتها', async () => {
  const html = await P.devCenterReportPage(member, product.id, { status: 'NEW' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /SND-001/);
  assert.match(html, /المرشِّحات/);
  assert.match(html, /@media print/);
});

// «أبلغ» بابٌ واحد: زرُّ الترويسة. ولا يُكرَّر داخل شاشة منتجٍ فيُفهم أنه يسجّل فيه.
test('شاشة المنتج لا تكرّر زرَّ «أبلغ» ولا تربطه بمنتجٍ — وبابُها «سجّل عن غيرك»', async () => {
  const html = await P.devCenterProductPage(member, product.id, {});
  const opens = html.match(/data-action="report-open"/g) || [];
  assert.equal(opens.length, 1, 'زرُّ الترويسة وحده لا غير');
  assert.doesNotMatch(html, /report-open[^>]*data-product/);
  assert.doesNotMatch(html, /data-product="[^"]*"[^>]*report-open/);
  assert.match(html, /data-action="dc-manual-add"/);
});

// التسجيل نيابةً: القطاعُ يُختار من قائمة، ومن أبلغ يُختار من حسابات المنصة إن كان له حساب.
test('شاشة المنتج تُسلّم قائمتَي القطاعات والأشخاص لنموذج «سجّل عن غيرك»', async () => {
  const html = await P.devCenterProductPage(member, product.id, {});
  assert.match(html, /id="dc-sectors"/);
  assert.match(html, /id="dc-users"/);
  assert.match(html, /زميل خارج الفريق/);   // اسمٌ من حسابات المنصة في قائمة الاختيار
});

// ── ٢) البوابة: من ليس عضواً ────────────────────────────────────────────────
test('من ليس عضواً في أي منتج: لا عنصر في القائمة ولا صفحة تُفتح', async () => {
  assert.equal(pageAllowed(stranger, 'dev-center'), false);
  assert.equal(PAGE_ACCESS['dev-center'](stranger), false);
  const nav = NAV_ITEMS.filter((n) => pageAllowed(stranger, n.key)).map((n) => n.key);
  assert.ok(!nav.includes('dev-center'), 'لا يظهر «مركز التطوير» لمن ليس عضواً');
  // ولو بلغ الصفحة بالعنوان مباشرة فالخدمة ترمي «غير موجود» لا «ممنوع» — فلا يُستدلّ بالرفض
  await assert.rejects(() => P.devCenterProductPage(stranger, product.id, {}), /غير موجود/);
});

test('العضو والمدير كلاهما يفتح الصفحة، والقائمة تحمل العنصر', async () => {
  assert.equal(pageAllowed(member, 'dev-center'), true);
  assert.equal(pageAllowed(admin, 'dev-center'), true);
  const nav = NAV_ITEMS.filter((n) => pageAllowed(member, n.key)).map((n) => n.key);
  assert.ok(nav.includes('dev-center'));
});

// ── ٣) لا تسريب رموز ولا مصطلحات ────────────────────────────────────────────
const RAW = [/\bNEW\b/, /\bTRIAGED\b/, /AWAITING_APPROVAL/, /\bDECLINED\b/, /\bRESOLVED\b/,
  /NEEDS_INFO/, /\bDUPLICATE\b/, /\bcritical\b/, /\bblocks\b/];
const JARGON = [/\bundefined\b/, /\bnull\b/, /\bNaN\b/, /\[object/, /\bAPI\b/, /\bJSON\b/,
  /\bToken\b/i, /\bSchema\b/i, /\bEndpoint\b/i];

// النصُّ الظاهر وحده: قيمُ السمات (data-*) قيمٌ تُرسَل للخادم لا كلامٌ يُقرأ، وكذلك محتوى
// وسم النصوص المرسَل للمتصفّح — الفحص عليهما يقيس الآلة لا الإنسان.
const visible = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]*>/g, ' ');

test('لا قيمة مخزَّنة خام ولا مصطلح تقني في النص الذي يقرؤه المستخدم', async () => {
  const pages = [
    await P.devCenterPage(member),
    await P.devCenterProductPage(member, product.id, {}),
    await P.devCenterProductPage(member, product.id, { tab: 'settings' }),
    await P.devCenterReportPage(member, product.id, {}),
  ];
  for (const html of pages) {
    const text = visible(html);
    for (const re of RAW) assert.doesNotMatch(text, re, `قيمة مخزَّنة خام: ${re}`);
    for (const re of JARGON) assert.doesNotMatch(text, re, `مصطلح تقني: ${re}`);
    // المعرّفات الداخلية (prd_/pit_/u_) لا تُطبع نصاً — تبقى في الروابط والسمات وحدها
    assert.doesNotMatch(text, /\bprd_[a-z0-9]/i);
    assert.doesNotMatch(text, /\bpit_[a-z0-9]/i);
  }
});

// ── ٤) زرّ الترويسة والنموذج الخارجي ────────────────────────────────────────
test('زرّ الترويسة صار زرَّ نموذجٍ داخل المنصة لا رابطاً خارجياً', async () => {
  const html = await layout({ user: member, active: 'tasks', title: 'مهامي', body: '<div></div>' });
  assert.match(html, /<button[^>]+data-action="report-open"/);
  assert.match(html, /data-page-title="مهامي"/);
  assert.match(html, /\/static\/pages\/report\.js/);
  assert.doesNotMatch(html, /forms\.cloud\.microsoft/);
});

test('لا أثر للنموذج الخارجي في شيفرة المصدر كلها', () => {
  const bad = [];
  const walk = (rel) => {
    for (const f of readdirSync(join(ROOT, rel))) {
      const p = join(rel, f);
      if (statSync(join(ROOT, p)).isDirectory()) { walk(p); continue; }
      if (!/\.(js|mjs)$/.test(f)) continue;
      const src = readFileSync(join(ROOT, p), 'utf8');
      if (src.includes('forms.cloud.microsoft') || src.includes('FEEDBACK_FORM_URL')) bad.push(p);
    }
  };
  walk('src');
  assert.deepEqual(bad, [], 'بقي أثرٌ للنموذج الخارجي');
});

// ── ٥) الكلمات العربية للقيم المخزَّنة تصل إلى **الشاشتين** (KI-119) ─────────
// نموذج «منتج جديد» يعيش في صفحة القائمة ويبني خياراته من `dc-labels` — وكان المقطع يُكتب في
// شاشة المنتج وحدها، فيرتدّ النموذج إلى القيمة المخزَّنة الخام في وجه المستخدم.
test('صفحة قائمة المنتجات تحمل خريطة الكلمات — فنموذج «منتج جديد» لا يعرض قيمةً خاماً', async () => {
  const html = await P.devCenterPage(admin);
  assert.match(html, /id="dc-labels"/);
  const map = JSON.parse(html.split('id="dc-labels">')[1].split('</script>')[0]);
  assert.equal(map.kind.external, 'منتج للعملاء');
  assert.equal(map.kind.internal, 'منتج داخلي');
  // ولا قيمةَ خام في النصّ الذي يقرؤه المستخدم
  assert.doesNotMatch(visible(html), /\bexternal\b/);
  assert.doesNotMatch(visible(html), /\binternal\b/);
});

test('القائمة الفارغة تحمل الخريطة كذلك — النموذج يُفتح منها أيضاً', async () => {
  const html = await P.devCenterPage(stranger).catch(() => '');
  // «غريب» ليس عضواً في منتج: قائمته فارغة، والزرّ لا يظهر له — لكن الخريطة تُكتب دائماً
  assert.match(html, /id="dc-labels"/);
});

// ── ٦) تبويب التقارير: المرشِّحات نفسها، والطباعة تحمل ما على الشاشة (KI-122) ─
test('تبويب التقارير يرسم المرشِّحات، ورابط الطباعة والتحميل يحملان المسافة الاستعلامية', async () => {
  const html = await P.devCenterProductPage(member, product.id, {
    tab: 'reports', status: 'RESOLVED', from: '2026-09-01', to: '2026-09-30', q: 'حفظ',
  });
  assert.match(html, /id="dc-from"/);
  assert.match(html, /id="dc-to"/);
  assert.match(html, /id="dc-q"/);
  assert.match(html, /name="tab" value="reports"/);
  assert.match(html, /class="chip/);
  // زرّ الطباعة يحمل الاختيار كاملاً لا عنواناً مجرَّداً
  const print = html.match(/href="([^"]*\/report\?[^"]*)"/);
  assert.ok(print, 'رابط الطباعة بلا مسافة استعلامية');
  assert.match(print[1], /status=RESOLVED/);
  assert.match(print[1], /from=2026-09-01/);
  assert.match(print[1], /to=2026-09-30/);
  assert.match(html, /export\.xlsx\?[^"]*status=RESOLVED/);
});

test('نقرةُ التبويب لا تُسقط المرشِّحات — رابط «التقارير» يحملها معه', async () => {
  const html = await P.devCenterProductPage(member, product.id, { status: 'RESOLVED', q: 'حفظ' });
  const tab = html.match(/href="([^"]*tab=reports[^"]*)"/);
  assert.ok(tab, 'لا رابط لتبويب التقارير');
  assert.match(tab[1], /status=RESOLVED/);
  assert.match(tab[1], /q=/);
});

// ── ٧) تبويب الإعدادات: نماذجٌ حقيقية بدل السؤال الحرّ (KI-124) ──────────────
test('إعدادات المنتج للعملاء تحمل نموذجَي الجهة والرابط بخيارات التعريف واللغة', async () => {
  const html = await P.devCenterProductPage(member, extProduct.id, { tab: 'settings' });
  assert.match(html, /id="dc-tpl-tenant"/);
  assert.match(html, /id="dc-tpl-link"/);
  // وضعُ التعريف: الخيارات الثلاثة بكلماتها العربية
  assert.match(html, /id="dc-lk-mode"/);
  assert.match(html, /بلا تعريف بالنفس/);
  assert.match(html, /التعريف بالنفس اختياري/);
  assert.match(html, /الاسم والبريد مطلوبان/);
  // اللغة والتمهيد وتاريخ الانتهاء
  assert.match(html, /id="dc-lk-lang"/);
  assert.match(html, /id="dc-lk-intro-ar"/);
  assert.match(html, /id="dc-lk-intro-en"/);
  assert.match(html, /id="dc-lk-expires"/);
  // الجهة: عميلٌ ومشروعٌ واستخدامٌ داخلي
  assert.match(html, /id="dc-tn-client"/);
  assert.match(html, /id="dc-tn-project"/);
  assert.match(html, /id="dc-tn-internal"/);
  // أزرارُ صفّ الرابط
  assert.match(html, /data-action="dc-link-toggle"/);
  assert.match(html, /data-action="dc-link-rotate"/);
  assert.match(html, /data-action="dc-copy-link"/);
  // وبيانات المنتج نفسها
  assert.match(html, /id="dc-pr-name-en"/);
  assert.match(html, /id="dc-pr-desc"/);
});

test('المطوِّر الذي يبلغ تبويب الإعدادات يقرأ سببَ منعه لا ارتداداً صامتاً', async () => {
  const ctx = { user: admin, ip: '127.0.0.1' };
  const dev = await mkUser('u_dc_dev2', 'مطوِّر الفريق', 'employee');
  await products.addMember(ctx, extProduct.id, { user_id: dev.id, role: 'developer' });
  dev.productMemberships = new Set([extProduct.id]);
  const html = await P.devCenterProductPage(dev, extProduct.id, { tab: 'settings' });
  assert.match(html, /الإعدادات لمديري المنتج/);
  assert.doesNotMatch(html, /id="dc-tpl-link"/);
});

// ── ٨) دورُ مدير النظام يُقرأ باسمه ─────────────────────────────────────────
test('مدير النظام يقرأ «مدير النظام» لا «غير محدد» في دوره على المنتج', async () => {
  const html = await P.devCenterProductPage(admin, product.id, {});
  assert.match(html, /مدير النظام/);
});

// ── ٩) الدرج: أفعالُ دورة الحياة كلها موجودة في شيفرة الشاشة (KI-118/KI-125) ─
test('شيفرة الدرج تحمل أفعال دورة الحياة الناقصة وكتلة نتيجة القرار', () => {
  const src = readFileSync(join(ROOT, 'src/web/public/pages/dev-center.js'), 'utf8');
  for (const key of ['dc-needs-info', 'dc-resolve', 'dc-duplicate', 'dc-tenant-save',
    'dc-link-save', 'dc-link-toggle', 'dc-link-rotate', 'dc-version-save', 'dc-product-save']) {
    assert.ok(src.includes(`'${key}'`), `فعلٌ مفقود: ${key}`);
  }
  // «اطلب توضيحاً» تُرسل سؤالاً — وكانت تُرسل بلا سؤالٍ فتُردّ في كل مرة
  assert.match(src, /to: 'NEEDS_INFO', question:/);
  // «تم الحل» بوسم إصدار، و«مكرر» بأصلٍ من المنتج نفسه
  assert.match(src, /to: 'RESOLVED', version_id:/);
  assert.match(src, /to: 'DUPLICATE', duplicate_of_id:/);
  // رفعُ «قبل/بعد» على مسار الصور بنوعها ترويسةً
  assert.match(src, /'x-image-kind': kind/);
  assert.match(src, /data-drop=/);
  // نتيجةُ القرار تُقرأ في الدرج: المُسنَد إليه ومهمتُه ووسمُ الإصدار وسببُ الرفض
  assert.match(src, /أُسند إلى/);
  assert.match(src, /\/app\/tasks\?who=team/);
  assert.match(src, /it\.decline_reason/);
  assert.match(src, /it\.version/);
  // وجملةٌ لكل نوع حدث مهمة لا جملةٌ واحدة
  assert.match(src, /taskSentence/);
  assert.doesNotMatch(src, /task: 'ربطه بمهمة'/);
});

test('نافذة «أبلغ» لا تبتلع سقوط الصورة، ونصُّ نجاحها يقول ما يقع فعلاً', () => {
  const src = readFileSync(join(ROOT, 'src/web/public/pages/report.js'), 'utf8');
  assert.match(src, /وصل بلاغك لكن الصورة لم تُرفع/);
  assert.match(src, /يصلك بريد حين يُدرَس بلاغك أو يُحلّ أو يُرفض/);
  assert.doesNotMatch(src, /يصلك بريد عند كل خطوة\./);
  assert.match(src, /تابع بلاغك من هنا/);
});

// ── ١٠) الورقة المطبوعة تقرأ **كل** مرشِّحات الشاشة لا ستّةً منها ────────────
// تبويبُ التقارير صار يرسل الأولويةَ والمصدرَ والجهةَ والقطاعَ والإصدار مع بقية المرشِّحات،
// وكانت الورقة تُسقطها صامتةً فتطبع أوسع مما على الشاشة — وهو أسوأ من ألّا تُطبع: قارئُها
// يظنّها الاختيار الذي رآه صاحبُها.
test('الورقة المطبوعة ترشِّح بالأولوية والمصدر، وتُعلنهما شارتين عربيتين', async () => {
  const ctx = { user: admin, ip: '127.0.0.1' };
  const hit = await items.insertItem(ctx, product, {
    type: 'bug', title: 'انقطاعٌ وصل من رابط الاستقبال', where_text: 'شاشة المشاريع',
    urgency: 'delays', source: 'link',
  });
  await items.triageItem(ctx, hit.id, { priority: 'high' });
  const miss = await items.insertItem(ctx, product, {
    type: 'suggestion', title: 'اقتراحٌ وصل من داخل المنصة', where_text: 'شاشة المهام',
    urgency: 'improve', source: 'sanad',
  });
  await items.triageItem(ctx, miss.id, { priority: 'low' });

  const html = await P.devCenterReportPage(member, product.id, { priority: 'high', source: 'link' });
  // البند المطابق وحده — لا الأقلُّ أولويةً ولا الذي وصل من داخل المنصة
  assert.match(html, /انقطاعٌ وصل من رابط الاستقبال/);
  assert.doesNotMatch(html, /اقتراحٌ وصل من داخل المنصة/);
  assert.doesNotMatch(html, /زرّ الحفظ لا يستجيب/);
  // والملخّص يُحسب على المرشَّح نفسه لا على كل ما وصل
  assert.match(html, /<b class="tnum">1<\/b><span>الإجمالي<\/span>/);
  // والشارات: كلماتٌ عربية لا قيمٌ مخزَّنة ولا مقاطعُ من العنوان
  assert.match(html, /class="fchip"/);
  assert.match(html, /الأولوية: عالية/);
  assert.match(html, /من رابط الاستقبال/);
  assert.doesNotMatch(visible(html), /\bhigh\b/);
  assert.doesNotMatch(visible(html), /\blink\b/);
  assert.doesNotMatch(visible(html), /priority=/);
});

test('الورقة ترشِّح بالجهة، وتردّ معرِّفاً ليس من قوائم هذا المنتج بدل أن تمرّره', async () => {
  const ctx = { user: admin, ip: '127.0.0.1' };
  const [tenant] = await products.listTenants(admin, extProduct.id);
  await items.insertItem(ctx, extProduct, {
    type: 'bug', title: 'عطلٌ باسم جهةٍ خارجية', where_text: 'شاشة العقود',
    urgency: 'blocks', source: 'link', tenant_id: tenant.id,
  });
  await items.insertItem(ctx, extProduct, {
    type: 'bug', title: 'عطلٌ بلا جهةٍ مسمّاة', where_text: 'شاشة العقود',
    urgency: 'blocks', source: 'link',
  });
  const html = await P.devCenterReportPage(member, extProduct.id, { tenant_id: tenant.id });
  assert.match(html, /عطلٌ باسم جهةٍ خارجية/);
  assert.doesNotMatch(html, /عطلٌ بلا جهةٍ مسمّاة/);
  assert.match(html, /الجهة: جهة تجريبية/);

  // معرِّفٌ يُحرَّر في العنوان لا يبلغ الخدمة ولا يُطبع في شارة
  const bogus = await P.devCenterReportPage(member, extProduct.id, {
    tenant_id: 'ptn_not_real', version_id: 'pvr_not_real', sector_id: 'sec_not_real',
  });
  assert.match(bogus, /بلا مرشِّحات/);
  assert.doesNotMatch(bogus, /not_real/);
  assert.match(bogus, /عطلٌ بلا جهةٍ مسمّاة/);
});

// ── ١١) الدرج يُمرَّر: ترويسةٌ ثابتة وجسمٌ يُمرَّر كبقية أدراج المنصة ────────
// كان `drawerHtml` يعيد كتلةً واحدة (`<div class="dcd">`) بلا `.drawer-body`، و`.drawer` عمودٌ
// مرن لا يُمرَّر بذاته — فما تجاوز ارتفاعَ الشاشة سقط تحت حافّتها: قياسٌ على ١٤٤٠×٩٠٠ أظهر
// محتوىً ارتفاعُه ٢١٩٣ في نافذةٍ ٩٠٠، و«احفظ الدراسة» و«أرسل» خارج المنال بالفأرة والمفتاح معاً.
test('الدرجُ ترويسةٌ ثابتة وجسمٌ يُمرَّر وذيلٌ ثابت — لا كتلةٌ واحدة تسقط تحت الشاشة', () => {
  const src = readFileSync(join(ROOT, 'src/web/public/pages/dev-center.js'), 'utf8');
  assert.match(src, /class="drawer-head/, 'لا ترويسةَ درجٍ ثابتة');
  assert.match(src, /class="drawer-body dcd"/, 'جسمُ الدرج ليس منطقةَ التمرير المعتادة');
  assert.match(src, /class="drawer-foot"/, 'لا ذيلَ درجٍ ثابت');
  // الترتيب: الترويسة قبل الجسم قبل الذيل — وإلا لم يكن أيٌّ منها في موضعه
  const head = src.indexOf('class="drawer-head');
  const body = src.indexOf('class="drawer-body dcd"');
  const foot = src.indexOf('class="drawer-foot"');
  assert.ok(head > 0 && head < body && body < foot, 'ترتيب أجزاء الدرج مقلوب');
  // «احفظ الدراسة» وصندوقُ التعليق يسكنان `dev` و`talk` — والقسمان داخل الجسم المُمرَّر
  assert.match(src, /'<div class="drawer-body dcd">'\s*\n\s*\+ reporter \+ outcome \+ dev \+ decide \+ evidence \+ talk \+ tl/,
    'أقسامُ الدرج ليست كلُّها داخل منطقة التمرير');
  // ولا بقيّةَ للبنية القديمة
  assert.doesNotMatch(src, /'<div class="dcd"><div class="dcd-h">/, 'بنيةُ الدرج القديمة ما زالت قائمة');
  // ولا ارتفاعَ ثابتاً يعيد الكسر من باب آخر
  assert.doesNotMatch(src, /\.drawer-body\{[^}]*overflow\s*:\s*hidden/);
});
