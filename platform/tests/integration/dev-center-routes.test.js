// «مركز التطوير» — الباب المصادَق عليه عبر الشبكة (`/api/products/…`).
//
// ما يحرسه هذا الملف بترتيب أهميته:
//   ١) **غيرُ العضو يرى «غير موجود»**: على المنتج، وعلى بلاغٍ فيه، وعلى قائمة بلاغاته، وعلى
//      ملفّ تصديره — ٤٠٤ لا ٤٠٣ في كلٍّ منها، فلا تُعدّ منتجات الشركة ولا بلاغاتها بالتجربة.
//   ٢) **المطوِّر ليس مديراً**: «اعتمد» و«ارفض» ٤٠٣ له، والمدير ينجح فيهما. وهذا هو الفرق
//      الوحيد المقصود بين عضوين — والخلط فيه يعني اعتماد ميزانيةِ عملٍ بلا قرار مديرها.
//   ٣) **معرّفُ البند لا معرّف المنتج هو الباب**: بلاغٌ من منتجٍ لست فيه لا يُقرأ ولو كنت
//      عضواً في منتجٍ آخر — لأن الموجّه يقرأ `product_id` من صفّ البند نفسه.
//   ٤) **الملفّ يُقرأ فعلاً**: بايتاته توقيعُ ملفِّ Excel، وترويسات التنزيل تصل باسمين.
//   ٥) **التصفية تضيّق**: بالحال، وبكلمة بحث، وبمدىً أحدُ طرفيه فارغ.
// التطبيق يُبنى حقيقياً بلا تطعيم — تركيبُ المسارات نفسه جزءٌ ممّا يُختبَر.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dcroutes-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, products, items, intake, server, base;
const T = new Date().toISOString();
const user = (uid, role, extra = {}) => ({
  id: uid, username: uid.replace(/^u_/, ''), role_id: role, sector_id: 'SOL', scope: 'own',
  projectIds: new Set(), teamIds: new Set(), ...extra,
});
const ADMIN = user('u_admin', 'admin', { name_ar: 'مدير النظام', scope: 'company' });
// مديرُ المنتج قائدُ قطاعٍ في الشركة أيضاً: اعتمادُ البلاغ يُنشئ مهمةً، وإنشاء المهام يقع تحت
// صلاحية الشركة لا تحت عضوية المنتج — فبلا نطاقٍ يسمح بالمهمة يتعثّر الاعتماد لسببٍ آخر.
const MGR = user('u_mgr', 'sector_lead', { name_ar: 'مدير المنتج', scope: 'sector' });
const DEV = user('u_dev', 'employee', { name_ar: 'المطوِّر' });
const OUT = user('u_out', 'sector_lead', { name_ar: 'قائد قطاعٍ ليس في الفريق', scope: 'sector' });
const CTX = (u) => ({ user: u, ip: '127.0.0.1' });

let PROD, OTHER, ITEM, OTHER_ITEM;

// نداءٌ عبر الشبكة بكعكة جلسةِ من نُريد — كما في بقية اختبارات التكامل.
async function http(path, { as = 'mgr', method = 'GET', body } = {}) {
  const headers = as ? { cookie: `sanad_sid=sess_${as}; sanad_csrf=t` } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* بايتاتٌ لا حمولة */ }
  return { status: r.status, headers: r.headers, buf, json };
}

// أصغرُ صورةٍ صحيحة: بكسلٌ واحدٌ بصيغة PNG — توقيعُها في أول ثمانِ بايتات.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
// رفعُ صورةٍ بايتاتٍ خاماً — النوع في ترويسةٍ لا في المسار، كما يرفعها المتصفّح.
async function postImage(path, { as, kind = 'report' }) {
  const r = await fetch(base + path, {
    method: 'POST', redirect: 'manual', body: PNG,
    headers: { cookie: `sanad_sid=sess_${as}; sanad_csrf=t`, 'content-type': 'image/png', 'x-image-kind': kind },
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* لا حمولة */ }
  return { status: r.status, json, text };
}
const errorOf = (r) => String(r.json?.error?.message || r.json?.message || '');
const reportImages = async (itemId) => Number((await db.get(
  "SELECT COUNT(*) AS n FROM product_item_image WHERE item_id = ? AND kind = 'report'", [itemId])).n);

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  products = await import('../../src/modules/products/products.js');
  items = await import('../../src/modules/products/items.js');
  intake = await import('../../src/modules/products/intake.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  for (const u of [ADMIN, MGR, DEV, OUT]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
    await db.insert('session', { id: 'sess_' + u.username, user_id: u.id, created_at: T,
      expires_at: new Date(Date.now() + 86400000).toISOString() });
  }

  PROD = await products.createProduct(CTX(ADMIN), { key: 'atlas', name_ar: 'منصة أطلس', kind: 'external', item_prefix: 'ATL', manager_user_id: MGR.id });
  await products.addMember(CTX(MGR), PROD.id, { user_id: DEV.id, role: 'developer' });
  // منتجٌ ثانٍ لا علاقة لأحدٍ من الفريق الأول به — منه يُقاس أن الباب معرّفُ البند لا المنتج.
  OTHER = await products.createProduct(CTX(ADMIN), { key: 'orion', name_ar: 'منصة أوريون', kind: 'external', item_prefix: 'ORI' });

  ITEM = await intake.createManual(CTX(MGR), PROD.id, {
    type: 'bug', title: 'الشاشة تتوقف عند الحفظ', description: 'حاولت الحفظ فلم يحدث شيء',
    where_text: 'شاشة الحفظ', urgency: 'blocks', sector_id: 'SOL', reporter_name: 'عميلٌ من أطلس',
  });
  await intake.createManual(CTX(MGR), PROD.id, {
    type: 'suggestion', title: 'زرٌّ للطباعة في التقرير', description: 'لو كان هناك زرُّ طباعة',
    where_text: 'شاشة التقارير', urgency: 'improve', sector_id: 'SOL', reporter_name: 'زميل',
  });
  OTHER_ITEM = await intake.createManual(CTX(ADMIN), OTHER.id, {
    type: 'bug', title: 'بلاغُ منتجٍ آخر', description: 'لا يخصّ فريق أطلس',
    where_text: 'شاشة أوريون', urgency: 'delays', sector_id: 'SOL', reporter_name: 'غريب',
  });

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

// ── ١) غيرُ العضو ─────────────────────────────────────────────────────────────
test('غير العضو يُردّ بـ«غير موجود» على المنتج وقائمة بلاغاته وبندٍ فيه وملفّ تصديره', async () => {
  for (const p of [`/api/products/${PROD.id}`, `/api/products/${PROD.id}/items`,
    `/api/products/${PROD.id}/stats`, `/api/products/${PROD.id}/items/export.xlsx`,
    `/api/products/items/${ITEM.id}`, `/api/products/items/${ITEM.id}/comments`]) {
    const r = await http(p, { as: 'out' });
    assert.equal(r.status, 404, `${p} أعطى ${r.status} لا ٤٠٤ — والفرق بين ٤٠٣ و٤٠٤ يعدّ المنتجات`);
  }
});

test('غير العضو لا يكتب: تعليقٌ ونقلُ حالٍ على بندٍ ليس من منتجه يُردّان بـ«غير موجود»', async () => {
  const c = await http(`/api/products/items/${ITEM.id}/comments`, { as: 'out', method: 'POST', body: { body: 'مرحباً' } });
  assert.equal(c.status, 404);
  const s = await http(`/api/products/items/${ITEM.id}/status`, { as: 'out', method: 'POST', body: { to: 'TRIAGED' } });
  assert.equal(s.status, 404);
  const n = await db.get('SELECT COUNT(*) AS n FROM product_item_comment WHERE item_id = ?', [ITEM.id]);
  assert.equal(Number(n.n), 0, 'كُتب تعليقٌ رغم أن صاحبه ليس في الفريق');
});

// ── ٣) الباب معرّفُ البند لا معرّف المنتج ────────────────────────────────────
test('عضوُ منتجٍ لا يقرأ بلاغَ منتجٍ آخر ولو ناداه بمعرّفه مباشرةً', async () => {
  const r = await http(`/api/products/items/${OTHER_ITEM.id}`, { as: 'mgr' });
  assert.equal(r.status, 404, 'مديرُ أطلس قرأ بلاغَ أوريون — الباب يُقرأ من جسم الطلب لا من صفّ البند');
});

test('العضو يقرأ بلاغ منتجه — ومعه الأسماءُ التي يعرضها الدرج مجهَّزةً من الخادم', async () => {
  const r = await http(`/api/products/items/${ITEM.id}`, { as: 'dev' });
  assert.equal(r.status, 200);
  assert.equal(r.json.item_key, ITEM.item_key);
  assert.equal(r.json.product.id, PROD.id);
  // الدرج يقرأ الاسمَ ولا يُركّبه: من أبلغ، وقطاعُه، وجهتُه — وبلا هذه الحقول كانت الحقول
  // الثلاثة تظهر فارغةً في الشاشة على بلاغٍ بياناته كاملة.
  assert.equal(r.json.reporter_display, 'عميلٌ من أطلس');
  assert.equal(r.json.sector_name, 'قطاع الحلول');
  assert.equal(r.json.tenant_name, null, 'بلا جهةٍ يُقال «لا شيء» صراحةً لا مفتاحٌ غائب');
});

// ── ٢) المطوِّر ليس مديراً ────────────────────────────────────────────────────
test('المطوِّر يُردّ بـ٤٠٣ على «اعتمد» و«ارفض»، والمدير ينجح', async () => {
  await items.triageItem(CTX(DEV), ITEM.id, { size: 'S', priority: 'high', est_hours: 3 });
  await items.setStatus(CTX(DEV), ITEM.id, 'AWAITING_APPROVAL');

  const dev = await http(`/api/products/items/${ITEM.id}/approve`, { as: 'dev', method: 'POST', body: { assignee_user_id: DEV.id } });
  assert.equal(dev.status, 403, 'المطوِّر اعتمد بلاغاً — قرارُ الاعتماد لمديري المنتج وحدهم');
  const devNo = await http(`/api/products/items/${ITEM.id}/decline`, { as: 'dev', method: 'POST', body: { reason: 'لا' } });
  assert.equal(devNo.status, 403);
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [ITEM.id])).status, 'AWAITING_APPROVAL');

  const mgr = await http(`/api/products/items/${ITEM.id}/approve`, { as: 'mgr', method: 'POST', body: { assignee_user_id: DEV.id } });
  assert.equal(mgr.status, 200, JSON.stringify(mgr.json));
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [ITEM.id])).status, 'APPROVED');
});

// ── ٥) التصفية ────────────────────────────────────────────────────────────────
test('التصفية تضيّق القائمة: بالحال، وبكلمة بحث، وبنوع', async () => {
  const all = await http(`/api/products/${PROD.id}/items`, { as: 'mgr' });
  assert.equal(all.status, 200);
  assert.equal(all.json.length, 2);

  const approved = await http(`/api/products/${PROD.id}/items?status=APPROVED`, { as: 'mgr' });
  assert.equal(approved.json.length, 1);
  assert.equal(approved.json[0].id, ITEM.id);

  const q = await http(`/api/products/${PROD.id}/items?q=${encodeURIComponent('طباعة')}`, { as: 'mgr' });
  assert.equal(q.json.length, 1);
  assert.match(q.json[0].title, /طباعة/);

  const sugg = await http(`/api/products/${PROD.id}/items?type=suggestion`, { as: 'mgr' });
  assert.equal(sugg.json.length, 1);
});

test('مدى التاريخ يعمل وأحدُ طرفيه فارغ — ومن غدٍ فصاعداً لا يعود شيء', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const fromOnly = await http(`/api/products/${PROD.id}/items?from=${today}&to=`, { as: 'mgr' });
  assert.equal(fromOnly.json.length, 2, 'الطرف الفارغ أسقط الصفوف بدل أن يسقط شرطَه');
  const toOnly = await http(`/api/products/${PROD.id}/items?from=&to=${today}`, { as: 'mgr' });
  assert.equal(toOnly.json.length, 2);
  const future = await http(`/api/products/${PROD.id}/items?from=${tomorrow}`, { as: 'mgr' });
  assert.equal(future.json.length, 0);
});

// ── ٤) الملفّ ─────────────────────────────────────────────────────────────────
test('التصدير يعود ملفَّ Excel حقيقياً بترويسات تنزيله، ويحترم التصفية', async () => {
  const r = await http(`/api/products/${PROD.id}/items/export.xlsx`, { as: 'mgr' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(r.headers.get('content-disposition') || '', /attachment/);
  assert.match(r.headers.get('content-disposition') || '', /filename\*=UTF-8''/);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  // توقيعُ ملفِّ Excel: مضغوطٌ يبدأ بـ PK.
  assert.equal(r.buf[0], 0x50);
  assert.equal(r.buf[1], 0x4b);

  const { parseWorkbook } = await import('../../src/modules/io/xlsx.js');
  const sheet = parseWorkbook(r.buf, 'x.xlsx');
  const { EXPORT_HEADERS } = await import('../../src/modules/products/export.js');
  assert.deepEqual(sheet.headers, [...EXPORT_HEADERS], 'رؤوس الملف أو ترتيبها تغيّر');
  assert.equal(sheet.rows.length, 2);
  // لا قيمةَ مخزَّنة خام في خليةٍ يقرؤها إنسان.
  const flat = sheet.rows.flat().map(String).join(' | ');
  assert.ok(!/\b(APPROVED|RESOLVED|NEW|bug|suggestion|blocks|improve)\b/.test(flat), `قيمةٌ خام في الملف: ${flat}`);
  assert.match(flat, /معتمد/);

  const filtered = await http(`/api/products/${PROD.id}/items/export.xlsx?type=suggestion`, { as: 'mgr' });
  assert.equal(parseWorkbook(filtered.buf, 'x.xlsx').rows.length, 1, 'التصدير تجاهل التصفية');
});

test('كلُّ تصديرٍ ناجحٍ يترك صفّاً في سجل الأثر، والمردودُ لا يترك شيئاً', async () => {
  const n = async () => Number((await db.get(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'export' AND resource = 'product_item'")).n);
  const before = await n();
  await http(`/api/products/${PROD.id}/items/export.xlsx`, { as: 'dev' });
  assert.equal(await n(), before + 1);
  await http(`/api/products/${PROD.id}/items/export.xlsx`, { as: 'out' });
  assert.equal(await n(), before + 1, 'تصديرٌ مردودٌ كتب أثراً');
});

// ── تعريف نموذج «أبلغ» ───────────────────────────────────────────────────────
test('تعريف نموذج الإبلاغ يصف نفسه بالعربية بلا قيمةٍ خام في نصٍّ معروض', async () => {
  const r = await http('/api/products/feedback/form', { as: 'dev' });
  assert.equal(r.status, 200);
  const f = r.json;
  assert.ok(f.title && f.fields?.title?.label && f.urgency?.options?.length);
  assert.equal(f.images.limit, 5);
  assert.deepEqual(f.types.map((t) => t.value), ['bug', 'suggestion']);
  for (const label of [...f.types.map((t) => t.label), ...f.urgency.options.map((o) => o.label)]) {
    assert.match(label, /[؀-ۿ]/, `عنوانٌ غير عربي في النموذج: ${label}`);
  }
});


// ── الرايات الداخلية لا تُرفع من جسم الطلب ───────────────────────────────────────────────
// `setStatus` تعرف بابين داخليين: إغلاقٌ بلا وسم إصدار، وإغلاقٌ بلا مزامنة مهمته. وكان
// الموجّه يمرّر جسم الطلب إلى `opts` كما وصل — فيرفعهما كلُّ متصفّح بنفسه: بلاغٌ يُغلَق بلا
// وسمٍ فيبقى «متى وصلني الحل» بلا جواب، وبلاغٌ يُغلَق ومهمتُه تبقى في قائمة مطوِّرٍ إلى الأبد.
test('راياتُ الخيارات الداخلية لا تُرفع من جسم الطلب — والمزامنة تقع رغمها', async () => {
  const fresh = await intake.createManual(CTX(MGR), PROD.id, {
    type: 'bug', title: 'بلاغُ الرايات', description: 'تفصيل', where_text: 'شاشة الرايات', urgency: 'delays',
    sector_id: 'SOL', reporter_name: 'عميل',
  });
  await items.setStatus(CTX(MGR), fresh.id, 'TRIAGED');
  await items.setStatus(CTX(MGR), fresh.id, 'AWAITING_APPROVAL');
  const ap = await http(`/api/products/items/${fresh.id}/approve`, { as: 'mgr', method: 'POST', body: { assignee_user_id: DEV.id } });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const task = (await db.get('SELECT task_id FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [fresh.id])).task_id;

  const noVersion = await http(`/api/products/items/${fresh.id}/status`, { as: 'mgr', method: 'POST', body: { to: 'RESOLVED', allowNoVersion: true } });
  assert.equal(noVersion.status, 400, 'أُغلق بلاغٌ بلا وسم إصدارٍ برايةٍ من جسم الطلب');
  assert.match(String(noVersion.json?.error?.message || noVersion.json?.message || ''), /الإصدار/);
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [fresh.id])).status, 'APPROVED');

  const declined = await http(`/api/products/items/${fresh.id}/status`, { as: 'mgr', method: 'POST', body: { to: 'DECLINED', reason: 'سلوكٌ مقصود لا عُطل', silent: true } });
  assert.equal(declined.status, 200, JSON.stringify(declined.json));
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [fresh.id])).status, 'DECLINED');
  assert.equal((await db.get('SELECT status FROM task WHERE id = ?', [task])).status, 'CANCELLED',
    'رايةُ «بلا مزامنة» من جسم الطلب تركت مهمةً مفتوحةً لبلاغٍ مرفوض');
});


// ── KI-117: صورةُ من أبلغ تصل ولو لم يكن في فريق المنتج ──────────────────────
// جمهورُ زرّ «أبلغ» كلُّه من خارج فريق سند، والنافذة تَعِد «حتى خمس صور» ثم ترفعها على هذا
// المسار — وكان `assertMember` يردّها بـ٤٠٤ فيبتلعها المتصفّح ويُعلن النجاح كاملاً. البابُ
// الآن لصاحب البلاغ نفسه وحده، على صور «البلاغ» وحدها، وما دام البند «جديداً» وفي يومه.
test('صاحبُ البلاغ يرفع صورَه وهو خارج الفريق — وعلى بلاغِ غيره «غير موجود»', async () => {
  const own = await intake.createManual(CTX(MGR), PROD.id, {
    type: 'bug', title: 'بلاغُ من ليس في الفريق', description: 'وصفٌ كافٍ', where_text: 'شاشة الفرص',
    urgency: 'delays', sector_id: 'SOL', reporter_user_id: OUT.id,
  });
  const up = await postImage(`/api/products/items/${own.id}/images`, { as: 'out' });
  assert.equal(up.status, 200, `صورةُ صاحب البلاغ رُدّت بـ${up.status}: ${up.text}`);
  assert.equal(up.json.mime, 'image/png');
  assert.equal(await reportImages(own.id), 1, 'رُدَّ ٢٠٠ ولم يُكتب صفُّ صورة');

  // ولا يفتح البابُ شيئاً آخر: البند نفسه يبقى «غير موجود» لمن ليس في الفريق.
  const read = await http(`/api/products/items/${own.id}`, { as: 'out' });
  assert.equal(read.status, 404, 'بابُ الصورة فتح قراءةَ البند لغير العضو');

  // بلاغُ غيره: «غير موجود» لا «ممنوع» — والفرقُ بين الردَّين يعدّ بلاغات الشركة.
  const before = await reportImages(ITEM.id);
  const foreign = await postImage(`/api/products/items/${ITEM.id}/images`, { as: 'out' });
  assert.equal(foreign.status, 404, 'رفع صورةً على بلاغٍ ليس بلاغَه');
  assert.equal(await reportImages(ITEM.id), before, 'كُتب صفُّ صورةٍ على بلاغِ غيره');
});

test('«قبل» و«بعد» وثيقةُ فريقٍ: صاحبُ البلاغ يُردّ عنهما بجملةٍ عربية', async () => {
  const own = await intake.createManual(CTX(MGR), PROD.id, {
    type: 'bug', title: 'بلاغُ صورِ العمل', description: 'وصفٌ كافٍ', where_text: 'شاشة المهام',
    urgency: 'delays', sector_id: 'SOL', reporter_user_id: OUT.id,
  });
  const r = await postImage(`/api/products/items/${own.id}/images`, { as: 'out', kind: 'before' });
  assert.equal(r.status, 403, 'صاحبُ البلاغ أضاف صورةَ «قبل» — وهي وثيقةُ من نفّذ');
  assert.match(errorOf(r), /[؀-ۿ]/, 'الرفض بجملة عربية');
  assert.ok(!/[A-Za-z]{4}/.test(errorOf(r)), `مصطلحٌ تقنيّ في رسالة الرفض: ${errorOf(r)}`);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM product_item_image WHERE item_id = ?', [own.id])).n), 0);
});

test('سقفُ الخمس يبقى على صاحب البلاغ، والسادسة تُردّ', async () => {
  const own = await intake.createManual(CTX(MGR), PROD.id, {
    type: 'bug', title: 'بلاغُ السقف من خارج الفريق', description: 'وصفٌ كافٍ', where_text: 'شاشة السقف',
    urgency: 'delays', sector_id: 'SOL', reporter_user_id: OUT.id,
  });
  for (let i = 0; i < 5; i++) {
    const r = await postImage(`/api/products/items/${own.id}/images`, { as: 'out' });
    assert.equal(r.status, 200, `الصورة ${i + 1} رُدّت وهي دون السقف: ${r.text}`);
  }
  const sixth = await postImage(`/api/products/items/${own.id}/images`, { as: 'out' });
  assert.equal(sixth.status, 400, 'قُبلت صورةٌ سادسة');
  assert.equal(await reportImages(own.id), 5);
  // والأثرُ يُكتب كما يُكتب لعضو الفريق: سطرٌ في مهلة البند لكل صورة.
  const events = await db.all("SELECT * FROM product_item_event WHERE item_id = ? AND kind = 'image'", [own.id]);
  assert.equal(events.length, 5, 'صورةٌ وصلت بلا سطرٍ في مهلة البند');
  assert.ok(events.every((e) => e.actor_user_id === OUT.id));
});

test('البابُ يُغلق حين يبدأ الفريق: بلاغٌ غادر «جديد» لا يقبل صورةً من صاحبه', async () => {
  const own = await intake.createManual(CTX(MGR), PROD.id, {
    type: 'bug', title: 'بلاغٌ بدأ فيه الفريق', description: 'وصفٌ كافٍ', where_text: 'شاشة الحفظ',
    urgency: 'delays', sector_id: 'SOL', reporter_user_id: OUT.id,
  });
  await items.setStatus(CTX(MGR), own.id, 'TRIAGED');
  const r = await postImage(`/api/products/items/${own.id}/images`, { as: 'out' });
  assert.equal(r.status, 403);
  assert.match(errorOf(r), /[؀-ۿ]/);
  assert.equal(await reportImages(own.id), 0);
});

// ── KI-126: بلاغُ المنصة يُتابَع كما يُتابَع بلاغُ الرابط العام ─────────────────
test('«أبلغ» يعيد رمزَ متابعةٍ ورابطه، والصفحةُ تفتح به، والبريدُ يحمله', async () => {
  await products.createProduct(CTX(ADMIN), {
    key: 'sanad', name_ar: 'سند', kind: 'internal', item_prefix: 'SND', manager_user_id: ADMIN.id });
  await db.update('app_user', OUT.id, { email: 'out@example.com' });

  const sent = await http('/api/products/feedback', { as: 'out', method: 'POST', body: {
    type: 'bug', title: 'الحفظ لا يستجيب', description: 'ضغطت الحفظ فلم يحدث شيء', where_text: 'شاشة المهام', urgency: 'delays' } });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  const token = sent.json.tracking_token;
  assert.ok(token, 'بلاغُ المنصة خرج بلا رمز متابعة');
  assert.ok(String(sent.json.tracking_url || '').endsWith(`/p/t/${token}`), `الرابط: ${sent.json.tracking_url}`);
  assert.equal((await db.get('SELECT tracking_token FROM product_item WHERE id = ?', [sent.json.id])).tracking_token, token);

  // والصفحةُ العامة تُفتح بالرمز وحده — بلا حساب، وبلا تغييرٍ في مسارها.
  const page = await http(`/p/t/${token}`, { as: null });
  assert.equal(page.status, 200, 'صفحةُ المتابعة لم تفتح لبلاغ المنصة');
  assert.match(page.buf.toString('utf8'), /الحفظ لا يستجيب/);

  const mailsWith = async (tag) => (await db.all(
    'SELECT q.html AS html FROM email_queue q JOIN email_log l ON l.queue_id = q.id WHERE l.detail = ?', [tag]))
    .map((m) => String(m.html || ''));

  await items.setStatus(CTX(ADMIN), sent.json.id, 'NEEDS_INFO', { question: 'في أي شاشة حدث هذا؟' });
  assert.ok((await mailsWith('product_item_needs_info')).some((h) => h.includes(`/p/t/${token}`)),
    'بريدُ «نحتاج توضيحاً» وصل بلا رابط متابعة');

  await items.setStatus(CTX(ADMIN), sent.json.id, 'DECLINED', { reason: 'سلوكٌ مقصود لا عُطل' });
  assert.ok((await mailsWith('product_item_declined')).some((h) => h.includes(`/p/t/${token}`)),
    'بريدُ الاعتذار وصل بلا رابط متابعة');
});

// ── «أين حدث» في التسجيل بالنيابة ────────────────────────────────────────────
test('التسجيلُ بالنيابة بلا «أين حدث» يُردّ بجملةٍ عربية تطلبه', async () => {
  const r = await http(`/api/products/${PROD.id}/items`, { as: 'mgr', method: 'POST', body: {
    type: 'bug', title: 'بلاغٌ بلا موضع', description: 'وصفٌ كافٍ', urgency: 'delays',
    sector_id: 'SOL', reporter_name: 'موظف' } });
  assert.equal(r.status, 400);
  assert.match(errorOf(r), /أين حدث/);
});
