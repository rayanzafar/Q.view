// «مركز التطوير» — حرّاس الصور، عبر الشبكة الحقيقية.
//
// الصورة هي أخطر ما يصل هذه الميزة: بايتاتٌ يرسلها مجهولٌ من الإنترنت، وتُخزَّن، ثم تُعاد
// بترويسةِ نوعٍ إلى متصفّح موظف. فأربعة حرّاس تُفحص هنا واحداً واحداً:
//   ① **التوقيع لا الترويسة**: بايتاتٌ ليست صورةً وصلت بترويسة «صورة» تُردّ — النوع يُقرأ من
//      أوائل البايتات، فمن يرسل نصّاً برمجياً مسمّى صورةً لا يُخزَّن له شيء.
//   ② **الحجم يُحدّ قبل القراءة**: ما تجاوز ثمانية ميغابايت يُقطع، ولا يُفكّ ضغطُ جسمٍ مضغوط
//      في الذاكرة قبل أن يُحدّ (`inflate:false`).
//   ③ **السادسة تُردّ**: خمسُ صورٍ للبلاغ سقفاً — من داخل المنصة ومن الرابط العام معاً.
//   ④ **صورةُ منتجٍ لا تُقرأ من منتجٍ آخر**: غيرُ العضو ٤٠٤، وعضوُ منتجٍ آخر ٤٠٤ — ولا
//      يُقرأ معرّفُ صورةٍ إلا مقروناً ببندها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dcimg-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

// أصغرُ صورةٍ صحيحة: بكسلٌ واحدٌ بصيغة PNG — توقيعُها في أول ثمانِ بايتات.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
// بايتاتٌ ليست صورةً بحال — نصٌّ برمجيّ. تصل بترويسة «صورة»، فالترويسة لا تُصدَّق.
const NOT_IMAGE = Buffer.from('<script>alert(1)</script>' + 'x'.repeat(400), 'utf8');

let db, products, intake, server, base;
const T = new Date().toISOString();
const user = (uid, role, extra = {}) => ({
  id: uid, username: uid.replace(/^u_/, ''), role_id: role, sector_id: 'SOL', scope: 'own',
  projectIds: new Set(), teamIds: new Set(), ...extra,
});
const ADMIN = user('u_admin', 'admin', { name_ar: 'مدير النظام', scope: 'company' });
const MGR = user('u_mgr', 'sector_lead', { name_ar: 'مدير المنتج', scope: 'sector' });
const OTHERMGR = user('u_other', 'sector_lead', { name_ar: 'مدير منتجٍ آخر', scope: 'sector' });
const CTX = (u) => ({ user: u, ip: '127.0.0.1' });

let PROD, OTHER, ITEM, OTHER_ITEM, TOKEN;

async function http(path, { as = 'mgr', method = 'GET', body, headers = {}, ip = '10.0.2.1' } = {}) {
  const h = { 'x-forwarded-for': ip, ...headers };
  if (as) h.cookie = `sanad_sid=sess_${as}; sanad_csrf=t`;
  const r = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* بايتاتٌ لا حمولة */ }
  return { status: r.status, headers: r.headers, buf, json };
}
const postImage = (path, bytes, opts = {}) => http(path, {
  method: 'POST', body: bytes,
  headers: { 'content-type': 'image/png', 'x-image-kind': 'report', ...(opts.headers || {}) },
  ...opts,
});
const imageCount = async (itemId) => Number((await db.get(
  'SELECT COUNT(*) AS n FROM product_item_image WHERE item_id = ?', [itemId])).n);

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  products = await import('../../src/modules/products/products.js');
  intake = await import('../../src/modules/products/intake.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  for (const u of [ADMIN, MGR, OTHERMGR]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
    await db.insert('session', { id: 'sess_' + u.username, user_id: u.id, created_at: T,
      expires_at: new Date(Date.now() + 86400000).toISOString() });
  }

  PROD = await products.createProduct(CTX(ADMIN), { key: 'atlas', name_ar: 'منصة أطلس', kind: 'external', item_prefix: 'ATL', manager_user_id: MGR.id });
  OTHER = await products.createProduct(CTX(ADMIN), { key: 'orion', name_ar: 'منصة أوريون', kind: 'external', item_prefix: 'ORI', manager_user_id: OTHERMGR.id });
  const tenant = await products.createTenant(CTX(MGR), PROD.id, { name: 'شركة النخبة' });
  TOKEN = (await products.createLink(CTX(MGR), PROD.id, { tenant_id: tenant.id, identity_mode: 'optional' })).token;

  ITEM = await intake.createManual(CTX(MGR), PROD.id, {
    type: 'bug', title: 'بلاغٌ بصور', description: 'وصفٌ كافٍ', urgency: 'delays',
    sector_id: 'SOL', reporter_name: 'مبلِّغ',
  });
  OTHER_ITEM = await intake.createManual(CTX(OTHERMGR), OTHER.id, {
    type: 'bug', title: 'بلاغُ منتجٍ آخر', description: 'وصفٌ كافٍ', urgency: 'delays',
    sector_id: 'SOL', reporter_name: 'غريب',
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

// ── ① التوقيع لا الترويسة ────────────────────────────────────────────────────
test('بايتاتٌ ليست صورةً وصلت بترويسة «صورة»: تُردّ ولا يُكتب صفٌّ', async () => {
  const before = await imageCount(ITEM.id);
  const r = await postImage(`/api/products/items/${ITEM.id}/images`, NOT_IMAGE);
  assert.equal(r.status, 400, 'قُبلت بايتاتٌ ليست صورةً لأن ترويستها قالت إنها صورة');
  assert.match(String(r.json?.error?.message || ''), /[؀-ۿ]/);
  assert.equal(await imageCount(ITEM.id), before, 'كُتب صفُّ صورةٍ لبايتاتٍ مردودة');
});

test('صورةٌ صحيحة تُقبل، وتعود ببايتاتها ونوعها من الصفّ لا من التخمين', async () => {
  const up = await postImage(`/api/products/items/${ITEM.id}/images`, PNG);
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal(up.json.mime, 'image/png');

  const list = await http(`/api/products/items/${ITEM.id}/images`);
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 1);
  assert.ok(!('content' in list.json[0]), 'القائمة تحمل البايتات — والجدول لا يُقرأ بنجمة');

  const bytes = await http(`/api/products/items/${ITEM.id}/images/${up.json.id}`);
  assert.equal(bytes.status, 200);
  assert.equal(bytes.headers.get('content-type'), 'image/png');
  assert.equal(bytes.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(bytes.buf.equals(PNG), 'البايتات العائدة ليست هي المرفوعة');
});

// ── ② الحجم ──────────────────────────────────────────────────────────────────
test('ما تجاوز ثمانية ميغابايت يُقطع ولا يُخزَّن', async () => {
  const before = await imageCount(ITEM.id);
  const big = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024, 0x41)]);
  const r = await postImage(`/api/products/items/${ITEM.id}/images`, big);
  assert.ok(r.status >= 400, `جسمٌ من تسعة ميغابايت مرّ بـ${r.status}`);
  assert.equal(await imageCount(ITEM.id), before);
});

// ── ③ السقف ──────────────────────────────────────────────────────────────────
test('السادسة تُردّ: خمسُ صورٍ للبلاغ سقفاً', async () => {
  const item = await intake.createManual(CTX(MGR), PROD.id, {
    type: 'bug', title: 'بلاغُ السقف', description: 'وصفٌ كافٍ', urgency: 'delays',
    sector_id: 'SOL', reporter_name: 'مبلِّغ',
  });
  for (let i = 0; i < 5; i++) {
    const r = await postImage(`/api/products/items/${item.id}/images`, PNG);
    assert.equal(r.status, 200, `الصورة ${i + 1} رُدّت وهي دون السقف`);
  }
  const sixth = await postImage(`/api/products/items/${item.id}/images`, PNG);
  assert.equal(sixth.status, 400, 'السادسة قُبلت');
  assert.match(String(sixth.json?.error?.message || ''), /خمس/);
  assert.equal(await imageCount(item.id), 5);
});

test('السقف نفسه على الباب العام: السادسة من رابط الاستقبال تُردّ', async () => {
  const sub = await fetch(`${base}/p/${TOKEN}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.2.7' },
    body: JSON.stringify({ type: 'bug', title: 'بلاغٌ بصور', description: 'وصفٌ كافٍ' }),
  }).then((r) => r.json());
  assert.ok(sub.ticket, 'لا تذكرةَ صورٍ في ردّ الإرسال');

  const send = (bytes) => fetch(`${base}/p/${TOKEN}/image/${sub.ticket}`, {
    method: 'POST', headers: { 'content-type': 'image/png', 'x-forwarded-for': '10.0.2.7' }, body: bytes,
  });
  for (let i = 0; i < 5; i++) assert.equal((await send(PNG)).status, 200, `الصورة ${i + 1} من الرابط العام رُدّت`);
  assert.equal((await send(PNG)).status, 400, 'السادسة من الرابط العام قُبلت');

  const item = await db.get('SELECT id FROM product_item WHERE item_key = ?', [sub.item_key]);
  assert.equal(await imageCount(item.id), 5);
});

test('بايتاتٌ ليست صورةً من الباب العام تُردّ أيضاً — الحارس واحدٌ على البابين', async () => {
  const sub = await fetch(`${base}/p/${TOKEN}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.2.8' },
    body: JSON.stringify({ type: 'bug', title: 'بلاغٌ آخر', description: 'وصفٌ كافٍ' }),
  }).then((r) => r.json());
  const r = await fetch(`${base}/p/${TOKEN}/image/${sub.ticket}`, {
    method: 'POST', headers: { 'content-type': 'image/png', 'x-forwarded-for': '10.0.2.8' }, body: NOT_IMAGE,
  });
  assert.equal(r.status, 400);
  const item = await db.get('SELECT id FROM product_item WHERE item_key = ?', [sub.item_key]);
  assert.equal(await imageCount(item.id), 0);
});

test('تذكرةٌ مجهولة أو منتهية لا تُرفق شيئاً', async () => {
  const r = await fetch(`${base}/p/${TOKEN}/image/no-such-ticket-at-all`, {
    method: 'POST', headers: { 'content-type': 'image/png', 'x-forwarded-for': '10.0.2.6' }, body: PNG,
  });
  assert.equal(r.status, 404);
});

// ── ④ صورةُ منتجٍ لا تُقرأ من منتجٍ آخر ──────────────────────────────────────
test('عضوُ منتجٍ آخر لا يقرأ صورةَ بلاغٍ ليس من منتجه — ولا بمعرّفها مباشرةً', async () => {
  const up = await postImage(`/api/products/items/${ITEM.id}/images`, PNG);
  assert.equal(up.status, 200);

  // بمعرّف بندٍ من منتجه هو، ومعرّف صورةٍ من منتجنا: القِران يفشل قبل أن تُرسل بايتة.
  const crossed = await http(`/api/products/items/${OTHER_ITEM.id}/images/${up.json.id}`, { as: 'other' });
  assert.equal(crossed.status, 404, 'صورةُ منتجٍ قُرئت من داخل بندِ منتجٍ آخر');

  // وبمعرّف البند الصحيح لكن بحسابٍ ليس في فريقه: «غير موجود» لا «ممنوع».
  const outsider = await http(`/api/products/items/${ITEM.id}/images/${up.json.id}`, { as: 'other' });
  assert.equal(outsider.status, 404);

  // ولمن لا جلسة له أصلاً: الباب المصادَق عليه لا يُفتح.
  const anon = await http(`/api/products/items/${ITEM.id}/images/${up.json.id}`, { as: null });
  assert.equal(anon.status, 401);
});

test('غيرُ العضو لا يرفع صورةً، ولا يحذف صورةَ غيره', async () => {
  const up = await postImage(`/api/products/items/${ITEM.id}/images`, PNG);
  const before = await imageCount(ITEM.id);

  const push = await postImage(`/api/products/items/${ITEM.id}/images`, PNG, { as: 'other' });
  assert.equal(push.status, 404);
  const kill = await http(`/api/products/items/${ITEM.id}/images/${up.json.id}`, { method: 'DELETE', as: 'other' });
  assert.equal(kill.status, 404);
  assert.equal(await imageCount(ITEM.id), before, 'حُذفت أو أُضيفت صورةٌ لغير عضو');
});
