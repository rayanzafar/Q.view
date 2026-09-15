// ── واجهةُ التأكيد داخل المحادثة (MCP Apps) على نقطة الربط الحقيقية ─────────────────────────
// ما تحرسه، عبر `/mcp` كما يناديه مضيفُ المساعد لا باستيراد وحدةٍ منعزلة:
//   ١) البدء يعلن دعم واجهات المحادثة ونوعَ موردها.
//   ٢) قائمة الأدوات: كل أداة تنفيذٍ محروسة تشير إلى مورد بطاقة التأكيد وتحمل تنبيه «لا تكتب
//      مباشرةً»؛ وأداتا البطاقة معلَنتان للواجهة وحدها؛ والقراءات بلا واجهة.
//   ٣) الموردُ يُقرأ: HTML كامل بالنوع الصحيح، عربيٌّ من اليمين، يصافح المضيف ولا يفتح شبكة.
//   ٤) موردٌ مجهول يُردّ بخطأ بروتوكول لا بانقطاع.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mcp-apps-'));
process.env.SANAD_DB = join(dir, 't.db');
process.env.PLATFORM_URL = 'http://127.0.0.1:4995';
delete process.env.AI_ENGINE;
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, server, base, token;
const NOW = new Date().toISOString();
const REDIRECT = 'http://127.0.0.1:33419/callback';
const verifier = () => randomBytes(32).toString('base64url');
const challengeOf = (v) => createHash('sha256').update(v).digest('base64url');
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined)).toString();

const req = async (path, { method = 'GET', headers = {}, body, redirect = 'manual' } = {}) => {
  const r = await fetch(base + path, { method, headers: { connection: 'close', ...headers }, body, redirect });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* صفحة لا حمولة */ }
  return { status: r.status, json, text, headers: r.headers, location: r.headers.get('location') };
};
const rpc = (method, params, id = 1) => req('/mcp', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
});

async function connectAs(uid) {
  const reg = await req('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'كلود', redirect_uris: [REDIRECT] }) });
  const clientId = reg.json.client_id;
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 'st',
    code_challenge: challengeOf(v), code_challenge_method: 'S256', resource: `${base}/mcp` });
  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: `sanad_sid=s_${uid}` } });
  const csrf = /sanad_csrf=([^;]+)/.exec(page.headers.get('set-cookie') || '')?.[1] || /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
  const decided = await req('/oauth/authorize', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sanad_sid=s_${uid}; sanad_csrf=${csrf}` },
    body: form({ decision: 'allow', client_id: clientId, redirect_uri: REDIRECT, state: 'st', code_challenge: challengeOf(v), code_challenge_method: 'S256', _csrf: csrf }) });
  const code = new URL(decided.location).searchParams.get('code');
  const tok = await req('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: v, redirect_uri: REDIRECT }) });
  return tok.json.access_token;
}

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: NOW });
  await db.insert('app_user', { id: 'u_lead', username: 'u_lead', name_ar: 'قائد', role_id: 'sector_lead', sector_id: 'SOL', scope: 'sector', active: 1, created_at: NOW });
  await db.insert('session', { id: 's_u_lead', user_id: 'u_lead', created_at: NOW, expires_at: new Date(Date.now() + 864e5).toISOString() });
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  server = app.listen(4995, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:4995';
  token = await connectAs('u_lead');
});
after(async () => { server?.close(); await db?.close?.(); rmSync(dir, { recursive: true, force: true }); });

test('① البدء يعلن دعم واجهات المحادثة ونوع موردها', async () => {
  const r = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } })).json.result;
  assert.deepEqual(r.capabilities.extensions['io.modelcontextprotocol/ui'], { mimeTypes: ['text/html;profile=mcp-app'] });
  assert.ok(r.capabilities.resources, 'وموارد معلَنة');
  assert.match(r.instructions, /بطاقةُ تأكيدٍ داخل المحادثة/, 'والتعليمات تقول أين يقع القرار');
});

test('② قائمة الأدوات: المحروسة تشير إلى البطاقة، وأداتا البطاقة للواجهة وحدها، والقراءات بلا واجهة', async () => {
  const tools = (await rpc('tools/list', {})).json.result.tools;
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  const gated = tools.filter((t) => (t.inputSchema?.required || []).includes('previewToken'));
  assert.ok(gated.length >= 5);
  for (const t of gated) {
    assert.equal(t._meta?.ui?.resourceUri, 'ui://sanad/confirm-change', t.name);
    assert.deepEqual(t._meta.ui.visibility, ['model', 'app']);
    assert.match(t.description, /لا يكتب مباشرةً/, `${t.name}: التنبيه في الوصف`);
    assert.equal(t.annotations.destructiveHint, true);
  }
  assert.deepEqual(by.sanad_confirm_change._meta, { ui: { visibility: ['app'] } });
  assert.deepEqual(by.sanad_reject_change._meta, { ui: { visibility: ['app'] } });
  assert.equal(by.sanad_list_my_changes._meta, undefined, 'قراءةٌ بلا واجهة');
  assert.equal(by.sanad_search._meta, undefined);
});

test('③ المورد يُقرأ: HTML كامل بالنوع الصحيح، من اليمين، يصافح المضيف ولا يفتح شبكة', async () => {
  const list = (await rpc('resources/list', {})).json.result.resources;
  const card = list.find((r) => r.uri === 'ui://sanad/confirm-change');
  assert.ok(card); assert.equal(card.mimeType, 'text/html;profile=mcp-app');
  const read = (await rpc('resources/read', { uri: 'ui://sanad/confirm-change' })).json.result;
  const c = read.contents[0];
  assert.equal(c.mimeType, 'text/html;profile=mcp-app');
  assert.match(c.text, /^<!DOCTYPE html>/);
  assert.match(c.text, /<html lang="ar" dir="rtl">/);
  for (const m of ['ui/initialize', 'ui/notifications/initialized', 'ui/notifications/tool-result', 'tools/call', 'ui/message', 'ui/notifications/size-changed']) {
    assert.ok(c.text.includes(m), `البطاقة تتكلّم ${m}`);
  }
  assert.ok(c.text.includes('sanad_confirm_change') && c.text.includes('sanad_reject_change'), 'وزرّاها يناديان أداتي البطاقة');
  assert.ok(!/fetch\(|XMLHttpRequest|<script src=|<link /.test(c.text), 'لا شبكة ولا مصادر خارجية');
  const staticText = c.text.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.ok(!/undefined|NaN|\[object/.test(staticText), 'لا تسرّب في النص الثابت');
  assert.equal(c._meta.ui.prefersBorder, true);
});

test('④ مورد مجهول يُردّ بخطأ بروتوكول لا بانقطاع', async () => {
  const r = (await rpc('resources/read', { uri: 'ui://sanad/لا-وجود' })).json;
  assert.equal(r.error.code, -32002);
  assert.match(r.error.message, /لا مورد/);
});
