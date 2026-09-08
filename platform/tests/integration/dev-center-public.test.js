// «مركز التطوير» — الباب العام تحت `/p`: النموذج الذي يفتحه من لا حساب له، وصفحةُ متابعته.
//
// ما يحرسه هذا الملف بترتيب أهميته:
//   ١) **الفخّ يبتلع الآلة صامتاً**: بلاغٌ فيه `company_website` يُردّ ٢٠٠ ولا يُكتب صفٌّ واحد
//      ولا يُصفّ بريد. والردُّ يشبه النجاح كي لا تتعلّم الآلة أنها كُشفت.
//   ٢) **الثلاثة صفحةٌ واحدة**: رابطٌ أُوقف، ورابطٌ انتهى أجله، ورابطٌ لا وجود له — الجسمُ
//      نفسه ورمزُ الحالة نفسه في الثلاث. أيُّ فرقٍ يدلّ من يجرّب الروابط على عميلٍ لنا.
//   ٣) **التعليق الداخلي لا يغادر القاعدة**: صفحةُ المتابعة لا تحمل حرفاً منه.
//   ٤) **جهةٌ داخلية تلزمها جلسة**: بلا جلسةٍ يُعاد الزائر إلى الدخول.
//   ٥) الهويةُ المطلوبة تُطلب فعلاً (٤٠٠ بلا اسمٍ وبريد)، والإيصالُ يُصفّ في طابور البريد،
//      والسادسُ في النافذة يُردّ ٤٢٩.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dcpublic-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, products, items, server, base;
const T = new Date().toISOString();
const ADMIN = {
  id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', sector_id: 'SOL',
  scope: 'company', projectIds: new Set(), teamIds: new Set(),
};
const CTX = (u) => ({ user: u, ip: '127.0.0.1' });

let PROD, TOKEN, TOKEN_REQ, TOKEN_OFF, TOKEN_OLD, TOKEN_INTERNAL;

const n = async (sql, p = []) => Number((await db.get(sql, p)).n);
const itemRows = () => n('SELECT COUNT(*) AS n FROM product_item');
const mailRows = () => n('SELECT COUNT(*) AS n FROM email_queue');

// عنوانٌ مختلفٌ لكل اختبار: الحدُّ على الإرسال بالعنوان، فلو تشارك الاختبارات عنواناً واحداً
// استنفد أوّلُها دلوَ آخرها. والخادم يثق بقفزةٍ واحدة (`trust proxy: 1`) فترويسةُ الوسيط هي
// عنوانُ الطلب — وهذا ما يجعل كلَّ اختبارٍ في نافذته.
async function req(path, { method = 'GET', body, cookie, ip = '10.0.0.1' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* صفحةٌ لا حمولة */ }
  return { status: r.status, headers: r.headers, text, json };
}

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  products = await import('../../src/modules/products/products.js');
  items = await import('../../src/modules/products/items.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: ADMIN.id, username: ADMIN.username, name_ar: ADMIN.name_ar,
    role_id: 'admin', sector_id: 'SOL', scope: 'company', active: 1, created_at: T });
  await db.insert('session', { id: 'sess_admin', user_id: ADMIN.id, created_at: T,
    expires_at: new Date(Date.now() + 86400000).toISOString() });

  PROD = await products.createProduct(CTX(ADMIN), {
    key: 'atlas', name_ar: 'منصة أطلس', name_en: 'Atlas', kind: 'external',
    item_prefix: 'ATL', brand_color: '#8A2BE2',
  });
  const client = await products.createTenant(CTX(ADMIN), PROD.id, { name: 'شركة النخبة' });
  const inside = await products.createTenant(CTX(ADMIN), PROD.id, { name: 'استخدام داخلي', internal: 1 });

  TOKEN = (await products.createLink(CTX(ADMIN), PROD.id, { tenant_id: client.id, identity_mode: 'optional' })).token;
  TOKEN_REQ = (await products.createLink(CTX(ADMIN), PROD.id, { tenant_id: client.id, identity_mode: 'required' })).token;
  const off = await products.createLink(CTX(ADMIN), PROD.id, { tenant_id: client.id, identity_mode: 'optional' });
  TOKEN_OFF = off.token;
  await products.updateLink(CTX(ADMIN), off.id, { enabled: 0 });
  const old = await products.createLink(CTX(ADMIN), PROD.id, { tenant_id: client.id, identity_mode: 'optional' });
  TOKEN_OLD = old.token;
  await products.updateLink(CTX(ADMIN), old.id, { expires_on: '2020-01-01' });
  TOKEN_INTERNAL = (await products.createLink(CTX(ADMIN), PROD.id, { tenant_id: inside.id, identity_mode: 'optional' })).token;

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── النموذج نفسه ─────────────────────────────────────────────────────────────
test('النموذج يُفتح لمن لا حساب له، بلونِ المنتج وشعارِ EVC وحقلٍ خفيٍّ ومبدِّلِ لغة', async () => {
  const r = await req(`/p/${TOKEN}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/html/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.text, /dir="rtl"/);
  assert.match(r.text, /company_website/, 'الحقل الخفيّ غائب — لا فخّ للآلات');
  assert.match(r.text, /#8a2be2/i, 'لون المنتج لم يصل الصفحة');
  assert.match(r.text, /\?lang=en/, 'لا مبدِّل لغة');
  assert.ok(!/sanad_sid|القائمة الجانبية|nav-a/.test(r.text), 'الصفحة العامة تسرّب شيئاً من إطار الموظفين');
  // لا قيمةَ مخزَّنةٌ خام ولا مصطلحٌ تقني في نصٍّ يقرؤه ضيف.
  const shown = r.text.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ');
  assert.ok(!/\b(NEW|TRIAGED|RESOLVED|APPROVED|DECLINED|bug|suggestion|Token|API|JSON)\b/.test(shown), `نصٌّ تقني ظاهر: ${shown.slice(0, 200)}`);
});

test('«lang=en» يقلب الصفحة إلى الإنجليزية واتجاهها — وكل نصّها من هذا الملف وحده', async () => {
  const r = await req(`/p/${TOKEN}?lang=en`);
  assert.equal(r.status, 200);
  assert.match(r.text, /dir="ltr"/);
  assert.match(r.text, /Tell us what you ran into/);
  assert.match(r.text, /\?lang=ar/);
});

test('الفخُّ يُخفى بالقصّ لا بالإزاحة — فلا تمريرَ أفقياً على الصفحة العربية', async () => {
  const r = await req(`/p/${TOKEN}`);
  assert.equal(r.status, 200);
  const css = (r.text.match(/<style[\s\S]*?<\/style>/) || [''])[0];
  assert.ok(!/-9999/.test(css), 'إزاحةُ العشرة آلاف بكسل ما زالت في الأنماط — تُفتح بها صفحةُ تمريرٍ أفقي في الاتجاه العربي');
  assert.match(css, /\.hp\{[^}]*clip-path:inset\(50%\)/, 'الفخّ لا يُقصّ');
  // ما زال في المستند (تراه الآلة)، وخارج ترتيب التنقّل وعن عين الإنسان.
  assert.match(r.text, /name="company_website"/);
  assert.match(r.text, /tabindex="-1"/);
  assert.match(r.text, /autocomplete="off"/);
  assert.match(r.text, /class="hp" aria-hidden="true"/);
});

// ── KI-121: الصفحة الإنجليزية إنجليزيةٌ كلها ─────────────────────────────────
test('«lang=en»: النوعُ والإلحاح واسمُ المنتج بالإنجليزية — ولا حرفَ عربيٍّ في خياراتها', async () => {
  const r = await req(`/p/${TOKEN}?lang=en`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Problem/);
  assert.match(r.text, /Suggestion/);
  assert.match(r.text, /Blocks my work/);
  assert.match(r.text, /Slows my work/);
  assert.match(r.text, /Improvement, not blocking/);
  assert.match(r.text, /Atlas/, 'اسمُ المنتج الإنجليزي لم يصل الصفحة');
  const shown = r.text.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ');
  assert.ok(!/عُطل|اقتراح|يعطّل عملي|يؤخّر عملي|تحسين لا يعطّل/.test(shown), `نصٌّ عربي في صفحةٍ إنجليزية: ${shown.slice(0, 200)}`);
});

test('العربية لم تتغيّر بحرف: «عُطل» و«يعطّل عملي» في مكانهما', async () => {
  const r = await req(`/p/${TOKEN}`);
  assert.match(r.text, /عُطل/);
  assert.match(r.text, /اقتراح/);
  assert.match(r.text, /يعطّل عملي/);
  assert.match(r.text, /يؤخّر عملي/);
  assert.match(r.text, /تحسين لا يعطّل/);
});

test('صفحةُ «لم يعد يستقبل» تُقال بالإنجليزية حين تُطلب بها', async () => {
  const r = await req('/p/no-such-token-at-all?lang=en');
  assert.equal(r.status, 404);
  assert.match(r.text, /dir="ltr"/);
  assert.match(r.text, /no longer accepting reports/);
  assert.ok(!/لم يعد يستقبل/.test(r.text), 'الصفحة الإنجليزية تحمل نصّاً عربياً');
});

test('فتحُ النموذج يُعدّ زيارة', async () => {
  const before = await n('SELECT visits AS n FROM product_link WHERE token = ?', [TOKEN]);
  await req(`/p/${TOKEN}`);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(await n('SELECT visits AS n FROM product_link WHERE token = ?', [TOKEN]) > before, 'الزيارة لم تُعدّ');
});

// ── ② الثلاثة صفحةٌ واحدة ────────────────────────────────────────────────────
test('الموقوف والمنتهي والمجهول: الجسمُ نفسه ورمزُ الحالة نفسه — لا فرقَ يدلّ على شيء', async () => {
  const off = await req(`/p/${TOKEN_OFF}`);
  const old = await req(`/p/${TOKEN_OLD}`);
  const bad = await req('/p/lا-يوجد-رمز-كهذا-اطلاقا');
  for (const r of [off, old, bad]) assert.equal(r.status, 404);
  assert.equal(off.text, bad.text, 'رابطٌ أُوقف يُرى مختلفاً عن رابطٍ لا وجود له');
  assert.equal(old.text, bad.text, 'رابطٌ انتهى أجله يُرى مختلفاً عن رابطٍ لا وجود له');
  assert.match(bad.text, /لم يعد يستقبل/);
  assert.ok(!/أطلس|Atlas|#8a2be2/i.test(bad.text), 'صفحةُ الإغلاق تسرّب اسم المنتج أو لونه');
});

// ── ④ الجهة الداخلية ─────────────────────────────────────────────────────────
test('رابطُ جهةٍ داخلية بلا جلسة يُعاد إلى صفحة الدخول، ومع جلسةٍ يُفتح', async () => {
  const anon = await req(`/p/${TOKEN_INTERNAL}`);
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location') || '', /^\/login/);

  const signed = await req(`/p/${TOKEN_INTERNAL}`, { cookie: 'sanad_sid=sess_admin' });
  assert.equal(signed.status, 200);
  assert.match(signed.text, /company_website/);
});

// ── ① الفخّ ──────────────────────────────────────────────────────────────────
test('بلاغٌ ملأ الحقل الخفيّ: ٢٠٠ يشبه النجاح، ولا صفَّ بلاغٍ ولا صفَّ بريدٍ يُكتب', async () => {
  const beforeItems = await itemRows();
  const beforeMail = await mailRows();
  const r = await req(`/p/${TOKEN}/submit`, {
    method: 'POST', ip: '10.0.1.1',
    body: {
      company_website: 'https://spam.example', type: 'bug', title: 'إغراق', description: 'إغراق',
      reporter_name: 'آلة', reporter_email: 'bot@example.com',
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true, 'الردّ لا يشبه النجاح — تتعلّم الآلة أنها كُشفت');
  assert.equal(await itemRows(), beforeItems, 'الفخّ كتب بلاغاً');
  assert.equal(await mailRows(), beforeMail, 'الفخّ صفَّ بريداً');
});

// ── ⑤ الهوية والإيصال ────────────────────────────────────────────────────────
test('رابطٌ يطلب التعريف بالنفس يُردّ ٤٠٠ بلا اسمٍ وبريد، ولا يكتب شيئاً', async () => {
  const before = await itemRows();
  const r = await req(`/p/${TOKEN_REQ}/submit`, {
    method: 'POST', ip: '10.0.1.2', body: { type: 'bug', title: 'بلا اسم', description: 'بلا اسم ولا بريد' },
  });
  assert.equal(r.status, 400);
  assert.match(String(r.json.error?.message || r.json.error || ''), /[؀-ۿ]/, 'رسالة الردّ ليست عربية');
  assert.equal(await itemRows(), before);
});

test('بلاغٌ مجهولٌ بالبريد: يُكتب، ويُصفّ إيصاله في طابور البريد، ويعود برقمه ورابط متابعته', async () => {
  const beforeMail = await mailRows();
  const r = await req(`/p/${TOKEN}/submit`, {
    method: 'POST', ip: '10.0.1.3',
    body: {
      type: 'bug', title: 'لا يفتح التقرير', description: 'ضغطتُ على التقرير فلم يفتح',
      where_text: 'شاشة التقارير', urgency: 'blocks', reporter_name: 'نورة', reporter_email: 'noura@example.com',
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.item_key, /^ATL-\d+$/);
  assert.match(r.json.tracking_url, /^\/p\/t\//);
  assert.ok(r.json.ticket, 'لا تذكرةَ صورٍ في الردّ');
  assert.equal(await mailRows(), beforeMail + 1, 'إيصالُ الاستلام لم يُصفّ');

  const q = await db.get('SELECT to_json, subject FROM email_queue ORDER BY created_at DESC LIMIT 1');
  assert.match(q.to_json, /noura@example\.com/, 'الإيصال صُفّ لعنوانٍ آخر');
  assert.match(q.subject, /[؀-ۿ]/);
});

// ── ③ صفحة المتابعة ──────────────────────────────────────────────────────────
test('صفحة المتابعة تُظهر ما يخصّ من أبلغ ولا تحمل حرفاً من تعليقٍ داخلي', async () => {
  const sub = await req(`/p/${TOKEN}/submit`, {
    method: 'POST', ip: '10.0.1.4',
    body: { type: 'bug', title: 'الحفظ بطيء', description: 'الحفظ يستغرق دقيقة', reporter_name: 'سالم', reporter_email: 'salem@example.com' },
  });
  const item = await db.get('SELECT * FROM product_item WHERE item_key = ?', [sub.json.item_key]);
  const SECRET = 'تكلفةُ الإصلاح ثلاثون ألفاً ولن نخبر العميل';
  await items.addComment(CTX(ADMIN), item.id, { body: SECRET, visibility: 'internal' });
  await items.addComment(CTX(ADMIN), item.id, { body: 'نعمل على المشكلة وسنوافيك', visibility: 'reporter' });

  const page = await req(sub.json.tracking_url);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes(SECRET), 'تعليقٌ داخلي وصل إلى صفحة من أبلغ');
  assert.ok(!page.text.includes('ثلاثون ألفاً'), 'جزءٌ من تعليقٍ داخلي وصل الصفحة');
  assert.match(page.text, /نعمل على المشكلة/);
  assert.match(page.text, new RegExp(sub.json.item_key));
  assert.match(page.text, /جديد/, 'المحطّات لا تُقال بالعربية');
  assert.ok(!/\bNEW\b|\bRESOLVED\b/.test(page.text.replace(/<script[\s\S]*?<\/script>/g, ' ')), 'قيمةٌ خام في صفحة المتابعة');
});

test('صفحةُ المتابعة بالإنجليزية: المحطّات والنوع والإلحاح بالإنجليزية لا بالعربية', async () => {
  const sub = await req(`/p/${TOKEN}/submit`, {
    method: 'POST', ip: '10.0.2.1',
    body: { type: 'bug', title: 'English tracking', description: 'Nothing loads', urgency: 'blocks', reporter_name: 'Sara' },
  });
  const page = await req(`${sub.json.tracking_url.split('?')[0]}?lang=en`);
  assert.equal(page.status, 200);
  assert.match(page.text, /dir="ltr"/);
  assert.match(page.text, /Under review/, 'المحطّات ما زالت عربية في صفحةٍ إنجليزية');
  assert.match(page.text, /In progress/);
  assert.match(page.text, /Problem/);
  assert.match(page.text, /Blocks my work/);
  const shown = page.text.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ');
  assert.ok(!/جديد|قيد الدراسة|قيد التنفيذ|عُطل|يعطّل عملي/.test(shown), `نصٌّ عربي في صفحة متابعةٍ إنجليزية: ${shown.slice(0, 200)}`);
  // ولا قيمةَ خامٌّ في الإنجليزية أيضاً.
  assert.ok(!/\bNEW\b|\bIN_PROGRESS\b|\bbug\b/.test(shown), 'قيمةٌ مخزَّنة خام في الصفحة الإنجليزية');
});

test('رقمُ متابعةٍ مجهول: نفس صفحة «لم نجد» دائماً', async () => {
  const a = await req('/p/t/no-such-tracking-token');
  const b = await req('/p/t/another-nonexistent');
  assert.equal(a.status, 404);
  assert.equal(a.text, b.text);
  assert.match(a.text, /لم نجد هذا البلاغ/);
});

test('ردُّ من أبلغ يُكتب حين يكون البلاغ «بحاجة لتوضيح»، ويُبتلع صامتاً في غير ذلك', async () => {
  const sub = await req(`/p/${TOKEN}/submit`, {
    method: 'POST', ip: '10.0.1.5', body: { type: 'bug', title: 'سؤالٌ من الفريق', description: 'الوصف', reporter_name: 'ريم' },
  });
  const item = await db.get('SELECT * FROM product_item WHERE item_key = ?', [sub.json.item_key]);
  const track = sub.json.tracking_url.split('?')[0];

  // قبل السؤال: الردّ يُقبل ولا يُكتب — لا رسالةَ خطأٍ تُعلّم من يجرّب.
  const early = await req(`${track}/reply`, { method: 'POST', ip: '10.0.1.5', body: { body: 'ردٌّ مبكّر' } });
  assert.equal(early.status, 200);
  assert.equal(await n('SELECT COUNT(*) AS n FROM product_item_comment WHERE item_id = ?', [item.id]), 0);

  await items.setStatus(CTX(ADMIN), item.id, 'NEEDS_INFO', { question: 'أي شاشة؟' });
  const late = await req(`${track}/reply`, { method: 'POST', ip: '10.0.1.5', body: { body: 'شاشة التقارير' } });
  assert.equal(late.status, 200);
  const c = await db.get("SELECT * FROM product_item_comment WHERE item_id = ? AND visibility = 'reporter' ORDER BY created_at DESC LIMIT 1", [item.id]);
  assert.match(c.body, /شاشة التقارير/);
  assert.equal(c.author_user_id, null, 'رُبط ردُّ مجهولٍ بحسابِ موظف');
  assert.equal(c.author_label, 'ريم');
});

// ── ⑤ الحدّ ──────────────────────────────────────────────────────────────────
// آخرَ اختبارٍ عمداً: الدلو يُستنفَد لهذا العنوان فلا يُفسد ما بعده.
test('السادس داخل النافذة يُردّ ٤٢٩ برسالةٍ عربية، ولا يُكتب بلاغه', async () => {
  const send = (i) => req(`/p/${TOKEN}/submit`, {
    method: 'POST', ip: '10.0.1.9', body: { type: 'bug', title: `بلاغ ${i}`, description: 'وصفٌ كافٍ' },
  });
  let last = null;
  for (let i = 0; i < 12; i++) { last = await send(i); if (last.status === 429) break; }
  assert.equal(last.status, 429, 'الدلو لم يُغلق بابه بعد بلاغاتٍ متتابعة كثيرة');
  assert.match(String(last.json?.error || ''), /[؀-ۿ]/, 'رسالة الحدّ ليست عربية');

  const before = await itemRows();
  await send('بعد الحد');
  assert.equal(await itemRows(), before, 'بلاغٌ كُتب بعد أن أُغلق الباب');
});


// ── ⑥ الشعار موجودٌ فعلاً على القرص ──────────────────────────────────────────
// الصفحةُ العامة هي أولُ ما يراه من لا حساب له — عميلٌ أو زائر — وكانت تطلب
// `/static/brand/logo.svg` وهو ملفٌّ لا وجود له في `src/web/public/brand`، فيظهر شعارٌ مكسور
// في ترويسة كل صفحةٍ عامة. صفحةُ الدخول تستعمل `logo-color.svg` وهو الموجود.
test('كل صورةِ علامةٍ تطلبها الصفحة العامة موجودةٌ في مجلد العلامة', async () => {
  const html = (await req(`/p/${TOKEN}`)).text;
  const refs = [...html.matchAll(/\/static\/brand\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2, 'الصفحة العامة بلا شعارٍ ولا أيقونة');
  assert.ok(refs.includes('logo-color.svg'), 'الصفحة العامة لا تستعمل شعار صفحة الدخول نفسه');
  assert.ok(!refs.includes('logo.svg'), 'ما زال الشعار المكسور «logo.svg» مطلوباً');
  for (const f of new Set(refs)) {
    assert.ok(existsSync(join(ROOT, 'src/web/public/brand', f)), `ملفُ علامةٍ مفقود: ${f}`);
  }
});
