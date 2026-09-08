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
// كل حالة تدخل بنفسها: جلسةٌ جديدة لكل مسار إذن. حالةٌ تُنهي جلسات حسابٍ (وهذا عملها) كانت
// تُسقط الحالات التي بعدها لو تشاركت معها جلسةً واحدة — والاعتماد على أثر حالةٍ أخرى عيبٌ في
// الاختبار لا في المنتج.
let sessionSeq = 0;
async function loginAs(uid) {
  const sid = `s_${uid}_${++sessionSeq}`;
  await db.insert('session', { id: sid, user_id: uid, created_at: nowIsoTest(), expires_at: new Date(Date.now() + 864e5).toISOString() });
  return sid;
}
const nowIsoTest = () => new Date().toISOString();

/** يمشي حتى رمز الإذن ويعيده مع مفتاح تحققه — كي تُجرَّب عليه محاولات التبديل الفاسدة. */
async function codeFor(uid, clientId, { redirect = REDIRECT } = {}) {
  const sid = await loginAs(uid);
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challengeOf(v), code_challenge_method: 'S256' });
  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: `sanad_sid=${sid}` } });
  if (page.status !== 200) throw new Error(`شاشة الإذن لم تُعرض لـ${uid}: ${page.status} → ${page.location || ''}`);
  const csrf = /sanad_csrf=([^;]+)/.exec(page.headers.get('set-cookie') || '')?.[1] || /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
  const decided = await req('/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sanad_sid=${sid}; sanad_csrf=${csrf}` },
    body: form({ decision: 'allow', client_id: clientId, redirect_uri: redirect, code_challenge: challengeOf(v), code_challenge_method: 'S256', _csrf: csrf }),
  });
  if (decided.status !== 302 || !decided.location) {
    throw new Error(`الإذن لم يُعِد التوجيه: ${decided.status} ${String(decided.text || '').slice(0, 120)}`);
  }
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

// ── ما كشفته المراجعة الأمنية للسطح نفسه (v5.81) — كل بند بإصلاحه وحارسه ────────────────────

test('الدفعة الواحدة لها سقف — فلا يصير الطلب الواحد آلة تضخيم', async () => {
  const clientId = await registerClient();
  const token = await tokenFor('u_admin', clientId);
  const batch = Array.from({ length: 64 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'sanad_whoami', arguments: {} } }));
  const r = await req('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(batch) });
  assert.equal(r.status, 200);
  assert.ok(r.json.error, 'الدفعة الكبيرة تُردّ بخطأ واحد لا تُنفَّذ');
  assert.match(r.json.error.message, /دفعات/);

  const ok32 = Array.from({ length: 32 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }));
  const r2 = await req('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(ok32) });
  assert.equal(r2.json.length, 32, 'وما دون السقف يمرّ كاملاً');
});

test('إنهاء الجلسات وتغيير كلمة المرور يقطعان روابط المساعد — إجراء الجهاز الضائع يقطع أوسع الأبواب', async () => {
  const clientId = await registerClient();
  const token = await tokenFor('u_emp', clientId);
  assert.equal((await rpc(token, 'tools/list', {})).status, 200);

  const identity = await import('../../src/modules/identity/identity.js');
  const admin = await (await import('../../src/core/http/context.js')).resolveUser('s_u_admin');
  const out = await identity.revokeSessions({ user: admin, ip: '1' }, 'u_emp');
  assert.ok(out.assistantLinksRevoked >= 1, 'الإجراء يعلن كم رابطاً قطع');
  assert.equal((await rpc(token, 'tools/list', {})).status, 401, 'ولا يعمل الرمز بعده');

  // الإجراء أنهى جلسة المتصفح أيضاً (وهذا المقصود منه) — والموظف يدخل من جديد قبل أن يأذن ثانيةً.
  const t2 = await tokenFor('u_emp', clientId);
  assert.equal((await rpc(t2, 'tools/list', {})).status, 200);
  const auth = await import('../../src/core/auth/service.js');
  await auth.changePassword({ user: { id: 'u_emp' }, ip: '1' }, 'u_emp', null, 'Sanad@2026!new', null);
  assert.equal((await rpc(t2, 'tools/list', {})).status, 401, 'وتغيير كلمة المرور كذلك');
});

test('كل إصدار وإبطال يترك أثراً باسم صاحبه — وإعادة الاستعمال تُكتب ولا تمرّ صامتة', async () => {
  const clientId = await registerClient();
  const { code, verifier: v } = await codeFor('u_admin', clientId);
  const body = form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: v, redirect_uri: REDIRECT });
  await req('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const issued = await db.get("SELECT * FROM audit_log WHERE action = 'issue' AND resource = 'mcp_token' ORDER BY at DESC");
  assert.ok(issued && issued.user_id === 'u_admin', 'الإصدار مسجَّل باسم صاحب الرمز');

  await req('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });  // إعادة استعمال
  const reuse = await db.get("SELECT * FROM audit_log WHERE action = 'revoke' AND resource = 'mcp_token' ORDER BY at DESC");
  assert.ok(reuse, 'كشف إعادة الاستعمال يترك أثراً');
  assert.match(String(reuse.detail_json), /reuse_detected/);
});

test('ردّ المنح لا يُخزَّن، وعنوان عودة ضخم يُرفض قبل أن يُكتب صفّ', async () => {
  const clientId = await registerClient();
  const { code, verifier: v } = await codeFor('u_admin', clientId);
  const r = await req('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: v, redirect_uri: REDIRECT }) });
  assert.equal(r.headers.get('cache-control'), 'no-store');

  const before = Number((await db.get('SELECT COUNT(*) n FROM mcp_client')).n);
  const huge = await req('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ضخم', redirect_uris: ['https://a.example/' + 'A'.repeat(120000)] }) });
  assert.equal(huge.status, 400, 'عنوان أطول من المسموح يُرفض');
  assert.equal(Number((await db.get('SELECT COUNT(*) n FROM mcp_client')).n), before, 'ولا يُكتب صفّ');
});

test('المعجم يحترم حدود القراءة: التكلفة والهامش لا يُشرحان لمن لا يقرؤهما', async () => {
  const clientId = await registerClient();
  const emp = await tokenFor('u_emp', clientId);
  const out = (await rpc(emp, 'tools/call', { name: 'sanad_explain_term', arguments: { term: 'الهامش' } })).json.result;
  assert.equal(out.structuredContent.matches.length, 0, 'الموظف لا يجد شرح الهامش');
  const admin = await tokenFor('u_admin', clientId);
  const forAdmin = (await rpc(admin, 'tools/call', { name: 'sanad_explain_term', arguments: { term: 'الهامش' } })).json.result;
  assert.ok(forAdmin.structuredContent.matches.length >= 1, 'ومدير النظام يجده');
});

test('شاشة الإذن تعرض وجهة القراءات وتنسب الاسم إلى قائله', async () => {
  const clientId = await registerClient('سند — أكمل تفعيل حسابك');   // اسمٌ ينتحل المنصة عمداً
  const v = verifier();
  const q = form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeOf(v), code_challenge_method: 'S256' });
  const sid = await loginAs('u_emp');
  const page = await req(`/oauth/authorize?${q}`, { headers: { cookie: `sanad_sid=${sid}` } });
  assert.match(page.text, /127\.0\.0\.1:33419/, 'الوجهة معروضة للموظف');
  assert.match(page.text, /كتبه البرنامج عن نفسه ولم تتحقق منه سند/, 'والاسم منسوب إلى قائله');
});

test('الكنس يزيل ما انتهى ولا يمسّ ربطاً قائماً ولا سطر تدقيق', async () => {
  const OA = await import('../../src/modules/mcp/oauth.js');
  const live = await registerClient('ربط قائم');
  const token = await tokenFor('u_admin', live);
  const stale = await registerClient('عميل لم يُكمل');
  await db.run('UPDATE mcp_client SET created_at = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', stale]);
  await db.run("UPDATE mcp_auth_code SET expires_at = '2020-01-01T00:00:00.000Z'");
  const auditBefore = Number((await db.get('SELECT COUNT(*) n FROM audit_log')).n);

  const out = await OA.purgeExpiredMcp();
  assert.ok(out.codes >= 1, 'رموز الإذن المنتهية تُكنس');
  assert.ok(out.clients >= 1, 'وعميلٌ سجّل ولم يربط قط');
  assert.equal((await rpc(token, 'tools/list', {})).status, 200, 'والربط القائم يبقى يعمل');
  assert.ok(await db.get('SELECT id FROM mcp_client WHERE id = ?', [live]), 'وعميله باقٍ');
  assert.equal(Number((await db.get('SELECT COUNT(*) n FROM audit_log')).n), auditBefore, 'ولا يُمسّ سطر تدقيق');
});

// يبقى هذا الفحص آخر الملف عمداً: يستهلك حصّة العنوان بالكامل، فتشغيله قبل غيره يُسقط ما بعده
// على ٤٢٩ فيبدو عطلاً وهو الحدّ يعمل.
test('حدّ المعدل لا يُتجاوز برمزٍ مزوَّر: العنوان يبقى في مفتاح الدلو', async () => {
  // كان المفتاح يُشتق من الترويسة وحدها، فكل رمز مختلَق يصنع دلواً جديداً — أي لا حدّ على من
  // لا يملك حساباً، ونموّ بلا سقف في خريطة الدلاء.
  let refused = 0;
  for (let i = 0; i < 340; i++) {
    const r = await rpc('sanad_a_' + randomBytes(24).toString('base64url'), 'tools/list', {});
    if (r.status === 429) refused++;
  }
  assert.ok(refused > 0, 'رموز مزوَّرة متتالية من عنوان واحد تصطدم بالحدّ');
});
