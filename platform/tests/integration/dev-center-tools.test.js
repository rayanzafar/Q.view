// ── أدوات «مركز التطوير» على سطح المساعد: العرض والمنع والتنفيذ والنسبة ──────────────────────
//
// ما يثبته هذا الملف — عبر التطبيق الحقيقي لا باستيراد وحدةٍ منعزلة، لأن التسجيل أثرٌ جانبي
// يقع عند تركيب `ai.routes.js` ويغذّي المسارين معاً (`/api/ai/tools` و`/mcp`):
//   ① القائمة عضوية: عضو فريق المنتج يرى أدوات المركز، ومن ليس عضواً لا يراها أصلاً.
//   ② الاعتماد لمدير المنتج وحده: مطوِّرٌ في المنتج نفسه يُردّ **قبل أي كتابة**.
//   ③ معاينة ثم تأكيد: الزوج يغيّر البلاغ فعلاً، ويكتب سطراً في سجل البلاغ، وسطر أثرٍ يقول
//      إن مصدره المساعد ويحمل اسم العميل المربوط («كلود · عبر …»).
//   ④ جسم غير صالح على `/mcp` يعود خطأ بروتوكول عربياً — لا أثر داخلي ولا انقطاع.
//   ⑤ `tools/list` عبر الربط الحقيقي: القراءات تظهر للمطوِّر، ونداء الاعتماد يُردّ برسالته.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dc-tools-'));
process.env.SANAD_DB = join(dir, 't.db');
process.env.PLATFORM_URL = 'http://127.0.0.1:4996';
delete process.env.AI_ENGINE;
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, server, base;
const NOW = new Date().toISOString();
const PRODUCT = 'prd_sanad';
const REDIRECT = 'http://127.0.0.1:33418/callback';
const verifier = () => randomBytes(32).toString('base64url');
const challengeOf = (v) => createHash('sha256').update(v).digest('base64url');
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined)).toString();

const req = async (path, { method = 'GET', headers = {}, body, redirect = 'manual' } = {}) => {
  const r = await fetch(base + path, { method, headers: { connection: 'close', ...headers }, body, redirect });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* صفحة لا حمولة */ }
  return { status: r.status, json, text, headers: r.headers, location: r.headers.get('location') };
};
const api = (uid, path, { method = 'GET', body } = {}) => req(path, {
  method, headers: { cookie: `sanad_sid=s_${uid}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const rpc = (token, method, params, id = 1) => req('/mcp', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
});
const callTool = async (token, name, args = {}) => (await rpc(token, 'tools/call', { name, arguments: args })).json?.result;

/** الرحلة كاملة كما يمشيها العميل الخارجي: تسجيل ⟵ إذن الموظف ⟵ تبديل الرمز. */
async function connectAs(uid, clientName) {
  const reg = await req('/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [REDIRECT] }),
  });
  assert.equal(reg.status, 201, 'تسجيل العميل');
  const clientId = reg.json.client_id;
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 'st',
    code_challenge: challengeOf(v), code_challenge_method: 'S256', resource: `${base}/mcp` });
  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: `sanad_sid=s_${uid}` } });
  assert.equal(page.status, 200, 'شاشة الإذن');
  const csrf = /sanad_csrf=([^;]+)/.exec(page.headers.get('set-cookie') || '')?.[1]
    || /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
  const decided = await req('/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sanad_sid=s_${uid}; sanad_csrf=${csrf}` },
    body: form({ decision: 'allow', client_id: clientId, redirect_uri: REDIRECT, state: 'st',
      code_challenge: challengeOf(v), code_challenge_method: 'S256', _csrf: csrf }),
  });
  assert.equal(decided.status, 302, 'الإذن يعيد التوجيه');
  const code = new URL(decided.location).searchParams.get('code');
  const tok = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: v, redirect_uri: REDIRECT }),
  });
  assert.equal(tok.status, 200, 'تبديل الرمز');
  return tok.json.access_token;
}

let itemId = null;
let mgrToken = null;
let devToken = null;

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: NOW });
  // مدير المنتج قائد قطاع: الاعتماد يفتح عملاً مسنَداً، وإنشاء العمل وإسناده منحُ سندٍ قائم
  // لا منحُ «مركز التطوير» — فالحساب الذي لا يُنشئ مهمة لا يعتمد بلاغاً أصلاً.
  const ROLE = { u_mgr: ['sector_lead', 'sector'], u_dev: ['employee', 'own'], u_out: ['employee', 'own'] };
  const mkUser = (uid) => db.insert('app_user', {
    id: uid, username: uid, name_ar: 'حساب ' + uid, role_id: ROLE[uid][0], sector_id: 'SOL', scope: ROLE[uid][1], active: 1, created_at: NOW });
  for (const uid of ['u_mgr', 'u_dev', 'u_out']) {
    await mkUser(uid);
    await db.insert('session', { id: 's_' + uid, user_id: uid, created_at: NOW, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }

  // بيانات المركز: منتجٌ داخلي، مديرٌ ومطوِّرٌ في فريقه، وبلاغٌ ينتظر الاعتماد.
  await db.insert('product', { id: PRODUCT, key: 'sanad', name_ar: 'سند', kind: 'internal',
    item_prefix: 'SND', item_seq: 1, created_at: NOW, created_by: 'u_mgr' });
  await db.insert('product_member', { id: 'pm_mgr', product_id: PRODUCT, user_id: 'u_mgr', role: 'manager', active: 1, created_at: NOW });
  await db.insert('product_member', { id: 'pm_dev', product_id: PRODUCT, user_id: 'u_dev', role: 'developer', active: 1, created_at: NOW });
  itemId = 'pit_test1';
  await db.insert('product_item', { id: itemId, product_id: PRODUCT, item_no: 1, item_key: 'SND-001',
    source: 'manual', lang: 'ar', type: 'bug', title: 'زر «حفظ» لا يستجيب', description: 'الزر لا يعمل في شاشة المهام',
    where_text: 'شاشة المهام', urgency: 'blocks', status: 'AWAITING_APPROVAL', priority: 'high', size: 'S', est_hours: 4,
    reporter_user_id: 'u_out', reporter_name: 'حساب u_out', sector_id: 'SOL', created_at: NOW, created_by: 'u_dev' });

  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(4996, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:4996';
});

after(async () => {
  server?.close();
  await db?.close?.();
  rmSync(dir, { recursive: true, force: true });
});

test('① القائمة عضوية: عضو الفريق يرى أدوات المركز ومن ليس عضواً لا يراها', async () => {
  const mine = await api('u_dev', '/api/ai/tools');
  assert.equal(mine.status, 200);
  const names = (mine.json.tools || []).map((t) => t.name);
  for (const n of ['sanad_dc_list_products', 'sanad_dc_list_items', 'sanad_dc_get_item', 'sanad_dc_list_comments']) {
    assert.ok(names.includes(n), `أداة القراءة تظهر لعضو الفريق: ${n}`);
  }
  const out = await api('u_out', '/api/ai/tools');
  assert.equal(out.status, 200);
  const outNames = (out.json.tools || []).map((t) => t.name);
  assert.equal(outNames.filter((n) => n.startsWith('sanad_dc_')).length, 0, 'من ليس عضواً لا يرى أدوات المركز أصلاً');
});

test('② الاعتماد لمدير المنتج وحده: المطوِّر يُردّ قبل أي كتابة، والمدير يُعاين', async () => {
  const before = await db.get('SELECT status FROM product_item WHERE id = ?', [itemId]);
  const denied = await api('u_dev', '/api/ai/tools/sanad_dc_preview_approve', {
    method: 'POST', body: { itemId, assigneeUserId: 'u_dev' } });
  assert.equal(denied.status, 403, 'المطوِّر لا يعتمد في منتجه');
  assert.ok(!/[A-Za-z]{4}/.test(String(denied.json?.error?.message || '')), 'الرفض بجملة عربية');
  const after = await db.get('SELECT status FROM product_item WHERE id = ?', [itemId]);
  assert.equal(after.status, before.status, 'الرفض لم يكتب شيئاً');

  const ok = await api('u_mgr', '/api/ai/tools/sanad_dc_preview_approve', {
    method: 'POST', body: { itemId, assigneeUserId: 'u_dev' } });
  assert.equal(ok.status, 200, 'مدير المنتج يعاين الاعتماد');
  assert.ok(ok.json.previewToken, 'المعاينة تعطي رمزاً');
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [itemId])).status, before.status, 'المعاينة لا تكتب');
});

test('③ معاينة ثم تأكيد عبر الربط: البلاغ يتغيّر، وسجلّه يمتلئ، والأثر يحمل اسم العميل', async () => {
  mgrToken = await connectAs('u_mgr', 'كلود');
  const pv = await callTool(mgrToken, 'sanad_dc_preview_approve', { itemId, assigneeUserId: 'u_dev' });
  assert.notEqual(pv?.isError, true, `المعاينة نجحت: ${pv?.content?.[0]?.text || ''}`);
  const token = pv?.structuredContent?.previewToken;
  assert.ok(token, 'المعاينة عبر الربط تعطي رمزاً');

  const applied = await callTool(mgrToken, 'sanad_dc_apply_approve', { previewToken: token });
  assert.equal(applied?.isError, false, `التنفيذ نجح: ${applied?.content?.[0]?.text || ''}`);
  const row = await db.get('SELECT status FROM product_item WHERE id = ?', [itemId]);
  assert.equal(row.status, 'APPROVED', 'البلاغ صار معتمداً فعلاً');

  const events = await db.all('SELECT * FROM product_item_event WHERE item_id = ?', [itemId]);
  assert.ok(events.length >= 1, 'سطر في سجل البلاغ');

  const audits = await db.all("SELECT * FROM audit_log WHERE resource = 'product_item' AND resource_id = ?", [itemId]);
  const details = audits.map((a) => JSON.parse(a.detail_json || '{}'));
  const via = details.filter((d) => d.via === 'ai');
  assert.ok(via.length >= 1, 'سطر أثرٍ يقول إن مصدره المساعد');
  assert.ok(via.some((d) => d.client_id), 'الأثر يحمل العميل المربوط الذي جاء منه النداء');
  assert.ok(details.some((d) => d.tool === 'sanad_dc_apply_approve' && d.preview), 'الأثر يسمّي الأداة ورمز المعاينة');
  const evLabels = events.map((e) => e.actor_label || '');
  assert.ok(evLabels.some((l) => l.includes('كلود') && l.includes('عبر')), 'سجل البلاغ ينسب العمل «<المساعد> · عبر <صاحبه>»');

  const stale = await callTool(mgrToken, 'sanad_dc_apply_approve', { previewToken: token });
  assert.equal(stale?.isError, true, 'الرمز لمرة واحدة');
});

test('④ جسم غير صالح على نقطة الربط يعود خطأ بروتوكول عربياً لا أثراً داخلياً', async () => {
  const token = mgrToken || await connectAs('u_mgr', 'كلود');
  mgrToken = token;
  const bad = await req('/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ hello: 'there' }),
  });
  assert.equal(bad.status, 200, 'خطأ البروتوكول يعود في الحمولة لا بانقطاع');
  assert.equal(bad.json?.error?.code, -32600, 'رمز «طلب غير صالح»');
  assert.ok(!/\bat \w+ \(|node:internal|Error:/.test(bad.text), 'لا أثر تنفيذ داخلي في الرد');
});

test('⑤ قائمة الأدوات عبر الربط: القراءات تظهر للمطوِّر، ونداء الاعتماد يُردّ برسالته', async () => {
  devToken = await connectAs('u_dev', 'كلود');
  const listed = await rpc(devToken, 'tools/list', {});
  const names = (listed.json?.result?.tools || []).map((t) => t.name);
  for (const n of ['sanad_dc_list_items', 'sanad_dc_get_item']) assert.ok(names.includes(n), `القراءة تظهر: ${n}`);

  // الاعتماد دورٌ لكل منتج على حدة، والقائمة لكل حساب: فالمنع يقع عند النداء لا عند العرض.
  const denied = await callTool(devToken, 'sanad_dc_preview_approve', { itemId, assigneeUserId: 'u_dev' });
  assert.equal(denied?.isError, true, 'المطوِّر لا يعتمد عبر الربط أيضاً');
  assert.ok(!/[A-Za-z]{4}/.test(String(denied?.content?.[0]?.text || '')), 'الرفض بجملة عربية');

  const out = await connectAs('u_out', 'كلود');
  const outList = await rpc(out, 'tools/list', {});
  const outNames = (outList.json?.result?.tools || []).map((t) => t.name);
  assert.equal(outNames.filter((n) => n.startsWith('sanad_dc_')).length, 0, 'من ليس عضواً لا يرى أدوات المركز عبر الربط');
});
