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

let admin, member, stranger, product, item;

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
