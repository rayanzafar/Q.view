// ── حدود ربط المساعد الخارجي ──────────────────────────────────────────────────────────────
//
// أسئلةٌ خصمٌ يسألها، وهذه أجوبتها المنفَّذة لا الموعودة:
//   • هل تكفي كعكة الموظف لتشغيل أداة من موقعٍ آخر؟ لا — نقطة البروتوكول لا تقرأ الكعكة أصلاً.
//   • هل يستطيع عميلٌ استبدال رمز إذنٍ ليس له، أو تحويل العودة إلى عنوانه؟ لا.
//   • هل يعمل رمزٌ منتهٍ أو رمز عميلٍ أُوقف؟ لا.
//   • هل يفتح المساعد بأداةٍ ما ليس لصاحبه؟ لا — والدليل نفسه لا يصف له شاشةً خارج صلاحيته.
//   • هل تُكتب بيانات بحمولةٍ خام من نافذة المساعد؟ لا — الكتابة برمز معاينةٍ وحده.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mcp-sec-'));
process.env.SANAD_DB = join(dir, 't.db');
process.env.PLATFORM_URL = 'http://127.0.0.1:4998';
delete process.env.AI_ENGINE;
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, server, base;
const NOW = new Date().toISOString();
const REDIRECT = 'http://127.0.0.1:33419/callback';
const EVIL = 'https://evil.example/steal';
const verifier = () => randomBytes(32).toString('base64url');
const challengeOf = (v) => createHash('sha256').update(v).digest('base64url');
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined)).toString();

const req = async (path, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { connection: 'close', ...headers }, body, redirect: 'manual' });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* صفحة */ }
  return { status: r.status, json, text, location: r.headers.get('location'), headers: r.headers };
};
const rpc = (token, method, params, extraHeaders = {}) => req('/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});

async function registerClient(name = 'كلود', uris = [REDIRECT]) {
  const r = await req('/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: uris }),
  });
  return r.json.client_id;
}
/** يمشي حتى رمز الإذن ويعيده مع مفتاح تحققه — كي تُجرَّب عليه محاولات التبديل الفاسدة. */
async function codeFor(uid, clientId, { redirect = REDIRECT } = {}) {
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challengeOf(v), code_challenge_method: 'S256' });
  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: `sanad_sid=s_${uid}` } });
  const csrf = /sanad_csrf=([^;]+)/.exec(page.headers.get('set-cookie') || '')?.[1] || /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
  const decided = await req('/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sanad_sid=s_${uid}; sanad_csrf=${csrf}` },
    body: form({ decision: 'allow', client_id: clientId, redirect_uri: redirect, code_challenge: challengeOf(v), code_challenge_method: 'S256', _csrf: csrf }),
  });
  return { code: new URL(decided.location).searchParams.get('code'), verifier: v };
}
async function tokenFor(uid, clientId) {
  const { code, verifier: v } = await codeFor(uid, clientId);
  const r = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: v, redirect_uri: REDIRECT }),
  });
  return r.json.access_token;
}

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  const { createApp } = await import('../../src/server.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: NOW });
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: NOW });
  const mkUser = (uid, role, sector, scope) => db.insert('app_user', {
    id: uid, username: uid, name_ar: 'حساب ' + uid, role_id: role, sector_id: sector, scope, active: 1, created_at: NOW });
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_emp', 'employee', 'SOL', 'own');
  await mkUser('u_lead2', 'sector_lead', 'CONS', 'sector');
  await db.insert('department', { id: 'D_A', sector_id: 'SOL', name_ar: 'إدارة الابتكار', active: 1, created_at: NOW });
  await db.insert('employee', { id: 'e_emp', user_id: 'u_emp', name_ar: 'موظف تجربة', sector_id: 'SOL', department_id: 'D_A',
    job_title: 'استشاري', hire_date: '2025-01-01', salary_halalas: 1500000, active: 1, created_at: NOW });
  await db.update('app_user', 'u_emp', { employee_id: 'e_emp' });
  for (const uid of ['u_admin', 'u_emp', 'u_lead2']) {
    await db.insert('session', { id: 's_' + uid, user_id: uid, created_at: NOW, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  const app = await createApp();
  server = app.listen(4998, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:4998';
});

after(async () => { server?.close(); await db?.close?.(); rmSync(dir, { recursive: true, force: true }); });

test('كعكة الجلسة لا تفتح نقطة البروتوكول — الرمز في الترويسة وحده', async () => {
  const withCookie = await rpc(null, 'tools/list', {}, { cookie: 'sanad_sid=s_u_admin' });
  assert.equal(withCookie.status, 401, 'جلسة متصفح لا تكفي');
  // وبهذا لا ينفع موقعٌ في تبويبٍ آخر أن يقود متصفّح الموظف لتشغيل أدواته باسمه.
  const bogus = await rpc('sanad_a_' + randomBytes(24).toString('base64url'), 'tools/list', {});
  assert.equal(bogus.status, 401, 'رمز مختلَق لا يعمل');
});

test('عنوان العودة لا يُبدَّل: لا في طلب الإذن ولا عند تبديل الرمز', async () => {
  const clientId = await registerClient();
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: EVIL, code_challenge: challengeOf(v), code_challenge_method: 'S256' });
  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: 'sanad_sid=s_u_admin' } });
  assert.equal(page.status, 400, 'عنوان عودة غير مسجَّل يُرفض ولا يُعرض إذن');
  assert.doesNotMatch(page.text, /evil\.example/, 'ولا يُعاد التوجيه إليه');

  const { code, verifier: good } = await codeFor('u_admin', clientId);
  const swapped = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: good, redirect_uri: EVIL }),
  });
  assert.equal(swapped.status, 400, 'تبديل العنوان عند الاستبدال يُرفض');
});

test('رمز إذنٍ لعميلٍ لا يُستبدل بعميلٍ آخر', async () => {
  const a = await registerClient('مساعد أ');
  const b = await registerClient('مساعد ب');
  const { code, verifier: v } = await codeFor('u_admin', a);
  const stolen = await req('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: b, code_verifier: v, redirect_uri: REDIRECT }),
  });
  assert.equal(stolen.status, 400, 'عميل آخر لا يستبدل رمز إذنٍ ليس له');
});

test('رمز منتهٍ، وعميل أُوقف: كلاهما يُردّ ٤٠١ بلا تفريق', async () => {
  const clientId = await registerClient();
  const token = await tokenFor('u_admin', clientId);
  assert.equal((await rpc(token, 'tools/list', {})).status, 200, 'يعمل قبل التلاعب');

  const hash = createHash('sha256').update(token).digest('hex');
  await db.run('UPDATE mcp_token SET expires_at = ? WHERE token_hash = ?', ['2020-01-01T00:00:00.000Z', hash]);
  assert.equal((await rpc(token, 'tools/list', {})).status, 401, 'المنتهي لا يعمل');

  const live = await registerClient('عميل يُوقف');
  const t2 = await tokenFor('u_admin', live);
  await db.run('UPDATE mcp_client SET disabled_at = ? WHERE id = ?', [NOW, live]);
  assert.equal((await rpc(t2, 'tools/list', {})).status, 401, 'عميل موقوف لا يعمل ولو كان رمزه حياً');
});

test('الرمز نائبٌ عن صاحبه وحده: نطاق قطاعٍ آخر لا يُفتح به', async () => {
  const clientId = await registerClient();
  const lead = await tokenFor('u_lead2', clientId);      // قائد قطاع الاستشارات
  const res = await rpc(lead, 'tools/call', { name: 'sanad_whoami', arguments: {} });
  const who = res.json.result.structuredContent;
  assert.equal(who.account.sector_ar, 'قطاع الاستشارات', 'يعمل بقطاعه هو');
  assert.equal(who.scope_ar, 'قطاعك');

  const empToken = await tokenFor('u_emp', clientId);
  const emp = (await rpc(empToken, 'tools/call', { name: 'sanad_whoami', arguments: {} })).json.result.structuredContent;
  assert.equal(emp.scope_ar, 'عملك ومشاريعك', 'والموظف بنطاقه هو — الرمز لا يوسّع شيئاً');
});

test('الدليل لا يصف شاشةً خارج صلاحية صاحب الرمز', async () => {
  const clientId = await registerClient();
  const emp = await tokenFor('u_emp', clientId);
  const out = (await rpc(emp, 'tools/call', { name: 'sanad_platform_guide', arguments: { page: 'users' } })).json.result;
  assert.equal(out.isError, false);
  assert.equal(out.structuredContent.page, null, 'لا وصف لشاشة المستخدمين والصلاحيات');
  assert.match(out.structuredContent.note_ar, /خارج صلاحية/);

  const mine = (await rpc(emp, 'tools/call', { name: 'sanad_platform_guide', arguments: {} })).json.result;
  const keys = mine.structuredContent.pages.map((p) => p.key);
  assert.ok(!keys.includes('users') && !keys.includes('audit'), 'ولا تظهر في قائمة شاشاته');
});

test('الكتابة من نافذة المساعد برمز معاينةٍ وحده — لا حمولة خام', async () => {
  const clientId = await registerClient();
  const admin = await tokenFor('u_admin', clientId);
  const raw = (await rpc(admin, 'tools/call', {
    name: 'sanad_create_allocation_request',
    arguments: { change: { kind: 'new', employeeId: 'e_emp', target: { kind: 'bucket', id: 'pmo' }, from: '2026-01', pct: 50 } },
  })).json.result;
  assert.equal(raw.isError, true, 'حمولة خام تُرفض');
  assert.match(raw.content[0].text, /رمز المعاينة/, 'والرسالة تقول الطريق الصحيح');
});

test('وثيقة الاكتشاف تدلّ على هذا الخادم وحده، ونداءٌ لجمهورٍ آخر لا يُمنح إذناً', async () => {
  const doc = (await req('/.well-known/oauth-protected-resource')).json;
  assert.equal(doc.resource, `${base}/mcp`);
  const clientId = await registerClient();
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeOf(v),
    code_challenge_method: 'S256', resource: 'https://other.example/mcp' });
  const r = await req(`/oauth/authorize?${q}`, { headers: { cookie: 'sanad_sid=s_u_admin' } });
  assert.equal(r.status, 302);
  assert.match(r.location, /error=invalid_target/, 'إذنٌ مطلوب لخادم آخر لا يُمنح من هنا');
});

test('شاشة الإذن تسمح بالإرسال إلى أصل المساعد المسجَّل وحده — فلا ينكسر الربط يوم تُلزَم سياسة المحتوى', async () => {
  const clientId = await registerClient();
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeOf(v), code_challenge_method: 'S256' });
  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: 'sanad_sid=s_u_admin' } });
  const csp = page.headers.get('content-security-policy') || page.headers.get('content-security-policy-report-only') || '';
  assert.match(csp, /form-action 'self' http:\/\/127\.0\.0\.1:33419/, 'الأصل المسجَّل مسموح صراحةً');
  assert.doesNotMatch(csp, /evil\.example/);

  // وصفحةٌ عادية تبقى على `self` وحدها: الاستثناء على ردّ الإذن لا على المنصة.
  const ordinary = await req('/app/tasks', { headers: { cookie: 'sanad_sid=s_u_admin' } });
  const csp2 = ordinary.headers.get('content-security-policy') || ordinary.headers.get('content-security-policy-report-only') || '';
  assert.match(csp2, /form-action 'self'(;|$)/, 'لا اتساع يتسرّب إلى بقية الصفحات');
});
