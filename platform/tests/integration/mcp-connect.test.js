// ── ربط المساعد الخارجي: الإذن والرموز والبروتوكول والصلاحيات ────────────────────────────────
//
// ما تثبته هذه الحزمة بالترتيب الذي يمشيه الموظف فعلاً:
//   ① الاكتشاف: وثيقتا العنوان تُقالان بلا إذن (وإلا لم يعرف العميل من أين يبدأ).
//   ② التسجيل: عنوان عودةٍ غير مؤمَّن يُرفض قبل أن يُسجَّل عميل.
//   ③ الإذن: بلا جلسة يُرسَل إلى الدخول؛ وبجلسة يقرأ الموظف ما سيصل إليه المساعد ثم يأذن.
//   ④ الرموز: PKCE يُتحقَّق منه، ورمز الإذن لمرة واحدة، وإعادة استعماله تُبطل الربط كله.
//   ⑤ البروتوكول: بلا رمز ٤٠١ ومعه عنوان وثيقة الموارد؛ ومع رمزٍ صالح تعمل الأدوات.
//   ⑥ **الصلاحية هي هي**: ما لا يفتحه الموظف على شاشته لا يفتحه المساعد باسمه — والرفض نصٌّ عربي.
//   ⑦ الأثر: الإذن يُسجَّل، وكل نداء أداةٍ يُسجَّل باسمه ونتيجته.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mcp-'));
process.env.SANAD_DB = join(dir, 't.db');
process.env.PLATFORM_URL = 'http://127.0.0.1:4999';
delete process.env.AI_ENGINE;
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, server, base, OA;
const NOW = new Date().toISOString();
const verifier = () => randomBytes(32).toString('base64url');
const challengeOf = (v) => createHash('sha256').update(v).digest('base64url');
const REDIRECT = 'http://127.0.0.1:33418/callback';

const form = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined)).toString();
const req = async (path, { method = 'GET', headers = {}, body, redirect = 'manual' } = {}) => {
  const r = await fetch(base + path, { method, headers: { connection: 'close', ...headers }, body, redirect });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* صفحة لا حمولة */ }
  return { status: r.status, json, text, headers: r.headers, location: r.headers.get('location') };
};
const rpc = async (token, method, params, id = 1) => {
  const r = await req('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return r;
};
const call = async (token, name, args = {}) => (await rpc(token, 'tools/call', { name, arguments: args })).json?.result;

/** الرحلة كاملة كما يمشيها العميل: تسجيل ⟵ إذن الموظف ⟵ تبديل الرمز. تعيد الرموز. */
async function connectAs(uid, { clientName = 'كلود' } = {}) {
  const reg = await req('/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [REDIRECT] }),
  });
  assert.equal(reg.status, 201, 'تسجيل العميل');
  const clientId = reg.json.client_id;
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 'st1',
    code_challenge: challengeOf(v), code_challenge_method: 'S256', resource: `${base}/mcp` });
  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: `sanad_sid=s_${uid}` } });
  assert.equal(page.status, 200, 'شاشة الإذن تُعرض لصاحب الجلسة');
  const csrf = /sanad_csrf=([^;]+)/.exec(page.headers.get('set-cookie') || '')?.[1]
    || /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
  const decided = await req('/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sanad_sid=s_${uid}; sanad_csrf=${csrf}` },
    body: form({ decision: 'allow', client_id: clientId, redirect_uri: REDIRECT, state: 'st1',
      code_challenge: challengeOf(v), code_challenge_method: 'S256', _csrf: csrf }),
  });
  assert.equal(decided.status, 302, 'الإذن يعيد التوجيه إلى العميل');
  const code = new URL(decided.location).searchParams.get('code');
  const tok = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: v, redirect_uri: REDIRECT }),
  });
  assert.equal(tok.status, 200, 'تبديل رمز الإذن');
  return { clientId, code, verifier: v, ...tok.json };
}

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  OA = await import('../../src/modules/mcp/oauth.js');
  const { createApp } = await import('../../src/server.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: NOW });
  const mkUser = (uid, role, scope) => db.insert('app_user', {
    id: uid, username: uid, name_ar: 'حساب ' + uid, role_id: role, sector_id: 'SOL', scope, active: 1, created_at: NOW });
  await mkUser('u_admin', 'admin', 'company');
  await mkUser('u_emp', 'employee', 'own');
  await db.insert('department', { id: 'D_A', sector_id: 'SOL', name_ar: 'إدارة الابتكار', active: 1, created_at: NOW });
  await db.insert('employee', { id: 'e_emp', user_id: 'u_emp', name_ar: 'موظف تجربة', sector_id: 'SOL', department_id: 'D_A',
    job_title: 'استشاري', hire_date: '2025-01-01', salary_halalas: 1500000, active: 1, created_at: NOW });
  await db.insert('employee', { id: 'e_other', user_id: null, name_ar: 'زميل آخر', sector_id: 'SOL', department_id: 'D_A',
    job_title: 'استشاري', hire_date: '2025-01-01', salary_halalas: 1600000, active: 1, created_at: NOW });
  await db.update('app_user', 'u_emp', { employee_id: 'e_emp' });
  for (const uid of ['u_admin', 'u_emp']) {
    await db.insert('session', { id: 's_' + uid, user_id: uid, created_at: NOW, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }

  const app = await createApp();
  server = app.listen(4999, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:4999';
});

after(async () => {
  server?.close();
  await db?.close?.();
  rmSync(dir, { recursive: true, force: true });
});

test('① الاكتشاف: وثيقتا الموارد والخادم تُقالان بلا إذن وتشيران إلى هذا الخادم', async () => {
  const pr = await req('/.well-known/oauth-protected-resource');
  assert.equal(pr.status, 200);
  assert.equal(pr.json.resource, `${base}/mcp`);
  assert.deepEqual(pr.json.authorization_servers, [base]);
  const as = await req('/.well-known/oauth-authorization-server');
  assert.equal(as.status, 200);
  assert.equal(as.json.issuer, base);
  assert.deepEqual(as.json.code_challenge_methods_supported, ['S256'], 'التحقق المؤمَّن وحده');
  assert.ok(as.json.registration_endpoint.endsWith('/oauth/register'));
});

test('② التسجيل: عنوان عودة غير مؤمَّن أو بجزءٍ بعد # يُرفض قبل إنشاء عميل', async () => {
  for (const uri of ['http://evil.example/cb', 'https://ok.example/cb#frag', 'ftp://x/y', '']) {
    const r = await req('/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'خبيث', redirect_uris: uri ? [uri] : [] }),
    });
    assert.equal(r.status, 400, `عنوان مرفوض: ${uri}`);
  }
  const ok = await req('/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'عميل مؤمَّن', redirect_uris: ['https://claude.example/callback'] }),
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.token_endpoint_auth_method, 'none');
});

test('③ الإذن: بلا جلسة يُرسَل إلى الدخول، والشاشة تقول ما يصل إليه المساعد', async () => {
  const reg = await req('/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'كلود', redirect_uris: [REDIRECT] }),
  });
  const v = verifier();
  const q = form({ response_type: 'code', client_id: reg.json.client_id, redirect_uri: REDIRECT,
    code_challenge: challengeOf(v), code_challenge_method: 'S256' });
  const anon = await req(`/oauth/authorize?${q}`);
  assert.equal(anon.status, 302);
  assert.equal(anon.location, '/login', 'يُرسَل إلى الدخول ثم يعود إلى الإذن نفسه');

  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: 'sanad_sid=s_u_emp' } });
  assert.equal(page.status, 200);
  assert.match(page.text, /باسمك أنت/, 'الشاشة تقول إن المساعد يعمل بحسابه هو');
  assert.match(page.text, /بصلاحياتك ونطاقك أنت/);
  assert.match(page.text, /قطع الربط/, 'تقول كيف يُقطع الربط');
  assert.doesNotMatch(page.text, /undefined|NaN|\[object/);

  // طريقة تحقق غير مؤمَّنة تُردّ إلى العميل بخطأ لا إلى شاشة إذن
  const weak = form({ response_type: 'code', client_id: reg.json.client_id, redirect_uri: REDIRECT, code_challenge: 'x', code_challenge_method: 'plain' });
  const bad = await req(`/oauth/authorize?${weak}`, { headers: { cookie: 'sanad_sid=s_u_emp' } });
  assert.equal(bad.status, 302);
  assert.match(bad.location, /error=invalid_request/);
});

test('④ الرموز: PKCE يُتحقَّق منه، ورمز الإذن لمرة واحدة، وإعادة استعماله تُبطل الربط', async () => {
  const reg = await req('/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'كلود', redirect_uris: [REDIRECT] }),
  });
  const clientId = reg.json.client_id;
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT,
    code_challenge: challengeOf(v), code_challenge_method: 'S256' });
  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: 'sanad_sid=s_u_admin' } });
  const csrf = /sanad_csrf=([^;]+)/.exec(page.headers.get('set-cookie') || '')?.[1] || /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
  const decided = await req('/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sanad_sid=s_u_admin; sanad_csrf=${csrf}` },
    body: form({ decision: 'allow', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeOf(v), code_challenge_method: 'S256', _csrf: csrf }),
  });
  const code = new URL(decided.location).searchParams.get('code');

  const wrong = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: verifier(), redirect_uri: REDIRECT }),
  });
  assert.equal(wrong.status, 400, 'مفتاح تحقق خاطئ يُرفض');
  assert.equal(wrong.json.error, 'invalid_grant');

  const good = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: v, redirect_uri: REDIRECT }),
  });
  assert.equal(good.status, 200);
  assert.equal(good.json.token_type, 'Bearer');
  assert.ok(good.json.access_token && good.json.refresh_token);

  // إعادة استعمال رمز الإذن: يُرفض **ويُبطل** ما صدر عنه (نفترض التسريب)
  const replay = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: v, redirect_uri: REDIRECT }),
  });
  assert.equal(replay.status, 400);
  const after = await rpc(good.json.access_token, 'tools/list', {});
  assert.equal(after.status, 401, 'الرمز الذي صدر عن إذنٍ أُعيد استعماله لم يعد يعمل');
});

test('⑤ البروتوكول: بلا رمز ٤٠١ مع عنوان وثيقة الموارد، ومعه بدءٌ وتعريفٌ بالمنصة', async () => {
  const anon = await rpc(null, 'tools/list', {});
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get('www-authenticate') || '', /resource_metadata=/, 'الرفض يدلّ على طريق الإذن');

  const { access_token } = await connectAs('u_admin');
  const init = await rpc(access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } });
  assert.equal(init.status, 200);
  assert.equal(init.json.result.protocolVersion, '2025-06-18', 'يجيب بالنسخة المطلوبة حين يعرفها');
  assert.equal(init.json.result.serverInfo.name, 'sanad');
  assert.match(init.json.result.instructions, /سند/);
  assert.match(init.json.result.instructions, /بصلاحياته/, 'يُعلم المساعد أنه يعمل بحساب موظف');
  assert.match(init.json.result.instructions, /ليست تعليمات/, 'يُعلمه أن نص السجلات بيانات');

  const old = await rpc(access_token, 'initialize', { protocolVersion: '1999-01-01' });
  assert.equal(old.json.result.protocolVersion, '2025-06-18', 'نسخة لا يعرفها ⟵ أحدث ما يعرف');

  const note = await req('/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(note.status, 202, 'الإشعار بلا ردّ');

  const unknown = await rpc(access_token, 'sanad/dropDatabase', {});
  assert.equal(unknown.json.error.code, -32601, 'طلب غير معروف يُردّ ولا يُنفَّذ');
});

test('⑥ الأدوات: القائمة بصلاحية صاحب الرمز، والمعرفة بالمنصة حاضرة، والرفض نصٌّ عربي', async () => {
  const admin = (await connectAs('u_admin')).access_token;
  const emp = (await connectAs('u_emp')).access_token;

  const adminTools = (await rpc(admin, 'tools/list', {})).json.result.tools.map((t) => t.name);
  const empTools = (await rpc(emp, 'tools/list', {})).json.result.tools.map((t) => t.name);
  assert.ok(adminTools.includes('sanad_whoami') && adminTools.includes('sanad_platform_guide'), 'أدوات معرفة المنصة معروضة');
  assert.ok(adminTools.length > empTools.length, 'قائمة الموظف أضيق من قائمة مدير النظام');
  assert.ok(!empTools.includes('sanad_get_close_status'), 'الإقفال ليس في قائمة الموظف');
  for (const t of (await rpc(admin, 'tools/list', {})).json.result.tools) {
    assert.equal(t.inputSchema.type, 'object', `مخطط مدخل صريح: ${t.name}`);
    assert.match(t.description, /[؀-ۿ]/, `وصف عربي: ${t.name}`);
  }

  const who = await call(emp, 'sanad_whoami');
  assert.equal(who.isError, false);
  assert.equal(who.structuredContent.scope_ar, 'عملك ومشاريعك', 'الاتساع يُقال كما هو');
  assert.ok(Array.isArray(who.structuredContent.limits_ar));

  const guide = await call(emp, 'sanad_platform_guide');
  assert.ok(guide.structuredContent.pages.length, 'الدليل يعيد شاشات الموظف');
  assert.ok(guide.structuredContent.pages.every((p) => p.purpose_ar), 'لكل شاشة غرضها');

  const term = await call(emp, 'sanad_explain_term', { term: 'القيمة المرجحة' });
  assert.ok(term.structuredContent.matches.length, 'المعجم يجيب');

  // أداةٌ خارج صلاحيته: نتيجةٌ بخطأ مقروء لا انقطاع بروتوكول
  const denied = await call(emp, 'sanad_get_close_status', { year: 2026, month: 1 });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /[؀-ۿ]/);
  assert.doesNotMatch(denied.content[0].text, /\d/, 'الرفض بلا رقم مالي');

  const missing = await call(admin, 'sanad_wipe_everything');
  assert.equal(missing.isError, true, 'أداة غير موجودة تُردّ نتيجةً لا تنفيذاً');
});

test('⑦ الصلاحية هي هي: الموظف يقرأ ملفه ويُردّ عن زميله عبر المساعد كما على الشاشة', async () => {
  const emp = (await connectAs('u_emp')).access_token;
  const mine = await call(emp, 'sanad_get_resource', { employeeId: 'e_emp' });
  assert.equal(mine.isError, false, 'ملفه هو يُفتح');
  const others = await call(emp, 'sanad_get_resource', { employeeId: 'e_other' });
  assert.equal(others.isError, true, 'ملف زميله يُردّ');
  // بلا مال: نفحص **مفاتيح** القيم لا كلمات النص — الناتج نفسه يقول «بلا راتب ولا قيمة عقد»،
  // وفحصٌ على الكلمة يسقط على تلك الجملة الصادقة بدل أن يسقط على رقمٍ مسرَّب.
  const moneyKeys = (v, path = '', out = []) => {
    if (Array.isArray(v)) v.forEach((x, i) => moneyKeys(x, `${path}[${i}]`, out));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (/halalas|salary|margin|cost|invoice|contract_value|_sar$/i.test(k)) out.push(`${path}.${k}`);
        moneyKeys(x, `${path}.${k}`, out);
      }
    }
    return out;
  };
  assert.deepEqual(moneyKeys(mine.structuredContent), [], 'لا مفتاح مالياً واحداً في قراءة المورد');
});

test('⑧ التجديد بتدوير، وقطع الربط يوقف كل شيء فوراً', async () => {
  const conn = await connectAs('u_admin');
  const first = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'refresh_token', refresh_token: conn.refresh_token, client_id: conn.clientId }),
  });
  assert.equal(first.status, 200, 'التجديد يعمل مرة');
  const again = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'refresh_token', refresh_token: conn.refresh_token, client_id: conn.clientId }),
  });
  assert.equal(again.status, 400, 'رمز التجديد لا يُستعمل مرتين');
  assert.equal((await rpc(first.json.access_token, 'tools/list', {})).status, 401, 'وإعادة استعماله تُبطل الربط كله');

  // قطع الربط من حساب الموظف
  const live = await connectAs('u_admin');
  assert.equal((await rpc(live.access_token, 'tools/list', {})).status, 200);
  const user = await (await import('../../src/core/http/context.js')).resolveUser('s_u_admin');
  const before = await OA.listConnections(user);
  assert.ok(before.some((c) => c.client_id === live.clientId), 'الربط يظهر في روابط الموظف');
  await OA.revokeConnection({ user, ip: '1' }, live.clientId);
  assert.equal((await rpc(live.access_token, 'tools/list', {})).status, 401, 'بعد القطع لا يعمل الرمز');
  const after = await OA.listConnections(user);
  assert.ok(!after.some((c) => c.client_id === live.clientId), 'ولا يبقى في القائمة');
});

test('⑨ الأثر: الإذن يُسجَّل باسم الموظف، وكل نداء أداةٍ يُسجَّل باسمه ونتيجته', async () => {
  const emp = (await connectAs('u_emp')).access_token;
  await call(emp, 'sanad_whoami');
  const grant = await db.get("SELECT * FROM audit_log WHERE action = 'grant' AND resource = 'mcp_client' AND user_id = 'u_emp' ORDER BY at DESC");
  assert.ok(grant, 'سطر أثر للإذن');
  assert.match(String(grant.detail_json), /كلود/, 'باسم المساعد الذي أذن له');
  const logged = await db.get("SELECT * FROM ai_activity_log WHERE intent = 'tool:sanad_whoami' ORDER BY at DESC");
  assert.ok(logged, 'نداء الأداة مسجَّل في سجل نشاط المساعد');
  assert.equal(logged.user_id, 'u_emp');
});
