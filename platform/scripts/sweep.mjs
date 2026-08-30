#!/usr/bin/env node
// Live quality sweep — logs in as EVERY demo persona and walks every page + key API, classifying:
//   • HTTP status vs the shared expectation table (scripts/lib/expectations.mjs)
//   • leak scan (undefined / NaN / [object / bare null) on the VISIBLE text of HTML pages
//   • banned-jargon scan (BANNED_UI_TERMS from src/web/i18n/glossary.js) on visible text
//   • request timing (per-role and overall P95)
// Exits non-zero on any deviation. Prints a compact per-role table + every deviation in detail.
//
// Usage:
//   node scripts/sweep.mjs http://127.0.0.1:4000
//   node scripts/sweep.mjs http://127.0.0.1:4000 --roles=demo.bd,demo.hr --json data/sweep.json
//   node scripts/sweep.mjs https://staging.os.evcsol.com --json data/sweep-staging.json
//
// Against staging from a proxied sandbox, export first:
//   NODE_USE_ENV_PROXY=1                      (Node fetch honors HTTPS_PROXY)
//   NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt   (agent-proxy CA)
// Optional: --budget <ms> fails the sweep when overall P95 exceeds the budget.
import './lib/throwaway-rbac-db.mjs'; // MUST be first: defaults SANAD_DB before any app module snapshots config
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ROLES, PAGES, DEMO_PW, API_PROBES, AI_CHAT_PROBES, pageExpected, expectedStatus, loadPageAccess } from './lib/expectations.mjs';
import { BANNED_UI_TERMS } from '../src/web/i18n/glossary.js';

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name) => { // supports --name=value and --name value
  const eq = argv.find((x) => x.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const optValues = new Set(['roles', 'json', 'budget'].map((n) => opt(n)).filter(Boolean));
const base = (argv.find((a) => !a.startsWith('--') && !optValues.has(a)) || '').replace(/\/+$/, '');
if (!base) { console.error('usage: sweep.mjs BASE_URL [--roles=a,b] [--json out.json] [--budget ms]'); process.exit(2); }
const roleFilter = opt('roles')?.split(',').map((r) => (r.startsWith('demo.') ? r : 'demo.' + r));
const jsonOut = opt('json');
const budget = Number(opt('budget')) || null;
const roles = ROLES.filter((r) => !roleFilter || roleFilter.includes(r.username));
if (!roles.length) { console.error('no roles matched --roles filter'); process.exit(2); }

// ── المساعد: قراءةٌ دائماً، ومحادثةٌ بإذن ──────────────────────────────────────
// «الحالة» قراءة صرفة فتُفحص في كل بيئة. أما «المحادثة» فتكتب سطراً في سجل نشاط المساعد —
// وهي كتابة حقيقية في قاعدة حيّة. لذلك تُشغَّل تلقائياً على قاعدة محلية وحدها، وعلى قاعدة
// بعيدة لا تعمل إلا بعلَم صريح، ويُطبع سبب إطفائها كي لا يبدو المسح أشمل مما هو.
const LOCAL_BASE = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(base);
const aiChat = argv.includes('--ai-chat') || (LOCAL_BASE && !argv.includes('--no-ai-chat'));

// ── scanners ──────────────────────────────────────────────────────────────────
// Visible text of an HTML document: drop script/style bodies (client code + JSON payloads are not
// UI copy), then tags, then collapse entities we match against.
function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, (m) => m.replace(/<[^>]+>/g, ' ')) // template text IS rendered later
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ');
}
const LEAK_RX = /(?<![A-Za-z])undefined(?![A-Za-z])|(?<![A-Za-z])NaN(?![A-Za-z])|\[object |(?<![A-Za-z])null(?![A-Za-z])/g;
const LEAK_TOKENS = new Set(['null', 'undefined', 'NaN', '[object']); // covered by LEAK_RX — don't double-report
const ALLOW_NEAR = /Excel|CSV|xlsx|EVC|Consulting|SST|IBM Plex|PDF|SAR/; // allowed product names (mirrors check-glossary)
const JARGON = BANNED_UI_TERMS.filter((t) => !LEAK_TOKENS.has(t)).map((term) => {
  if (/^[؀-ۿ]/.test(term)) return { term, test: (txt) => (txt.includes(term) ? term : null) };
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ $/, '(?= )');
  const rx = new RegExp(`(?<![A-Za-z])${esc}(?![A-Za-z])`);
  return { term, test: (txt) => { const m = txt.match(rx); if (!m) return null; const near = txt.slice(Math.max(0, m.index - 20), m.index + term.length + 20); return ALLOW_NEAR.test(near) ? null : term; } };
});
const ctx40 = (txt, needle) => { const i = txt.search(needle); return i < 0 ? '' : txt.slice(Math.max(0, i - 30), i + 50).replace(/\s+/g, ' ').trim(); };

// ── HTTP helpers (cookie jar + 429-aware retry) ───────────────────────────────
function jarFrom(res, jar = {}) {
  for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); jar[k.trim()] = v.join('='); }
  return jar;
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function hit(path, { method = 'GET', jar = {}, headers = {}, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(base + path, {
        method, body, redirect: 'manual',
        headers: { cookie: cookieHeader(jar), connection: 'close', ...headers },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      // انقطاعٌ عابر من صندوق الفحص (كل طلبٍ هنا اتصالٌ جديد، وضياعُ تحيةِ اتصالٍ واحدة يعني
      // مهلةَ undici) كان يُسقط المسح كله في منتصفه — والمسح تحقّقٌ بعد النشر، فسقوطُه يترك
      // النشرة بلا تحقّق لا المنتجَ بلا عيب. يُعاد الطلب نفسه حتى ثلاث مرات ثم يُرفع الخطأ.
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw e;
    }
    const ms = performance.now() - t0;
    if (res.status === 429 && attempt < 2) { // login/api limiter — honor Retry-After and retry
      const wait = (Number(res.headers.get('retry-after')) || 6) * 1000 + 500;
      await res.text();
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return { res, ms, text: await res.text() };
  }
}

// حدّ الدخول دلوٌ سعته عشرة لكل عنوان يقطر واحداً كل ست ثوانٍ — والمسح يسجّل دخول سبعة عشر
// دوراً من العنوان نفسه بلا توقّف. فكانت الأدوار السبعة الأخيرة تُردّ بـ«محاولات كثيرة» **ولا
// تُمسَح إطلاقاً**، بينما يقول السجل إن المسح غطّى سبعة عشر دوراً. عيبٌ في أداة الفحص لا في
// المنتج، لكنه يترك سبع بوابات صلاحيات بلا فحص. العلاج انتظارٌ يحترم الحدّ — لا رفعُ الحدّ،
// فالحدّ حاجزٌ حقيقي أمام التخمين المتسلسل ولا يُضعَّف كي يمرّ فحصنا.
const RATE_LIMITED = /\/login\?e=2/;
async function loginWeb(username, attempt = 0) {
  const seed = await hit('/login'); // issues the CSRF cookie pair like a real browser visit
  // بيئة لا وصول: الوكيل يردّ 403 على كل طلب قبل أن يصل الخادم أصلاً. بلا هذا التمييز يظهر الفشل
  // عشر مرات كأنه عطل في تسجيل الدخول، فيُطارَد عيبٌ في المنتج لا وجود له. الرسالة تقول الحل.
  if (seed.res.status === 403 && /not in allowlist|egress/i.test(seed.text || ''))
    throw new Error(`الوكيل حجب ${base} — أعد التشغيل بـ NODE_USE_ENV_PROXY=1 (وNODE_EXTRA_CA_CERTS للشهادة). ليست مشكلة في المنصة.`);
  const jar = jarFrom(seed.res);
  const form = new URLSearchParams({ username, password: DEMO_PW, _csrf: jar.sanad_csrf || '' });
  const { res } = await hit('/auth/login-web', {
    method: 'POST', jar, body: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  jarFrom(res, jar);
  const to = res.headers.get('location') || '';
  // ردَّ الحدُّ لا الخادم: ننتظر قطرةً من الدلو ثم نعيد. ست محاولات تكفي للأدوار السبعة الباقية.
  if (RATE_LIMITED.test(to) && attempt < 6) {
    process.stdout.write(`  … ${username}: بلغ حدّ المحاولات، انتظار 7ث ثم إعادة (${attempt + 1}/6)\n`);
    await new Promise((r) => setTimeout(r, 7000));
    return loginWeb(username, attempt + 1);
  }
  if (res.status !== 302 || !jar.sanad_sid) throw new Error(`login-web failed for ${username}: status ${res.status} → ${to || 'no redirect'}`);
  return jar;
}

// ── sweep ─────────────────────────────────────────────────────────────────────
// PAGE_ACCESS predicates call can(), which needs the RBAC grant cache. The sweep is a standalone
// process (may target a remote base), so hydrate the cache from a throwaway local DB — the grant
// matrix is seeded identically in every environment.
{
  // SANAD_DB is already defaulted to a throwaway by ./lib/throwaway-rbac-db.mjs (first import),
  // so this hydration never touches the team's dev DB even when the sweep targets a remote base.
  const { migrate } = await import('./migrate.js');
  const { seedRbac } = await import('./seed-rbac.js');
  await migrate();
  await seedRbac();
  const { initRbac } = await import('../src/core/rbac/index.js');
  await initRbac();
}
const pageAccess = await loadPageAccess();
const report = { base, at: new Date().toISOString(), mode: pageAccess ? 'strict-nav-guard' : 'pending-nav-guard', requests: [], deviations: [], warnings: [] };
const timings = [];
const perRole = {};

console.log(`سند sweep → ${base}  (${roles.length} roles, ${PAGES.length} pages, ${API_PROBES.length} API probes; page-authz: ${report.mode})`);
console.log(aiChat
  ? `المساعد: مسبار المحادثة يعمل (${AI_CHAT_PROBES.length} طلبات لكل دور).`
  : 'المساعد: مسبار المحادثة مطفأ — كل محادثة تكتب سطراً في سجل نشاط المساعد، والقاعدة هنا ليست محلية. شغّله بـ‎--ai-chat إن أردته.');

for (const { username, role } of roles) {
  const R = (perRole[username] = { pagesOk: 0, pagesN: 0, apisOk: 0, apisN: 0, aiOk: 0, aiN: 0, leaks: 0, jargon: 0, ms: [] });
  let jar;
  try { jar = await loginWeb(username); } catch (e) {
    report.deviations.push({ role: username, path: '/auth/login-web', kind: 'login', detail: e.message });
    console.error(`✗ ${username}: ${e.message}`);
    continue;
  }

  for (const page of PAGES) {
    const path = `/app/${page}`;
    const want = pageExpected(role, page, pageAccess).status;
    const { res, ms, text } = await hit(path, { jar });
    R.pagesN++; R.ms.push(ms); timings.push(ms);
    const row = { role: username, path, status: res.status, want, ms: Math.round(ms) };
    report.requests.push(row);
    if (res.status !== want) {
      report.deviations.push({ role: username, path, kind: 'status', detail: `expected ${want}, got ${res.status}` });
      continue;
    }
    R.pagesOk++;
    if (res.status === 200 && (res.headers.get('content-type') || '').includes('text/html')) {
      const txt = visibleText(text);
      for (const m of txt.match(LEAK_RX) || []) {
        R.leaks++;
        report.deviations.push({ role: username, path, kind: 'leak', detail: `"${m}" visible — «${ctx40(txt, m.replace(/[[\]]/g, '\\$&'))}»` });
      }
      for (const j of JARGON) {
        const found = j.test(txt);
        if (found) { R.jargon++; report.deviations.push({ role: username, path, kind: 'jargon', detail: `"${found}" visible — «${ctx40(txt, j.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}»` }); }
      }
    }
  }

  for (const probe of API_PROBES) {
    const want = expectedStatus(probe.expect, role);
    const { res, ms, text } = await hit(probe.path, {
      jar, method: probe.method,
      body: probe.body === undefined ? undefined : JSON.stringify(probe.body),
      headers: probe.body === undefined ? {} : { 'content-type': 'application/json' },
    });
    R.apisN++; R.ms.push(ms); timings.push(ms);
    report.requests.push({ role: username, path: `${probe.method} ${probe.path}`, status: res.status, want, ms: Math.round(ms) });
    if (res.status !== want) {
      report.deviations.push({ role: username, path: `${probe.method} ${probe.path}`, kind: 'status', detail: `expected ${want}, got ${res.status}` });
      continue;
    }
    R.apisOk++;
    // KNOWN-GAP QH-1 (warning, not a failure — tracked): roster serializes salary_halalas without
    // redaction, so employee-readers WITHOUT the salary grant currently receive raw values.
    // sector_lead deliberately holds the salary grant (scope: sector) since v2.9 — excluded here too.
    if (probe.path === '/api/org/roster' && res.status === 200 && !['admin', 'hr', 'sector_lead'].includes(role) && /"salary_halalas":\s*[1-9]/.test(text)) {
      report.warnings.push({ role: username, path: probe.path, kind: 'known-gap', detail: 'QH-1: raw salary_halalas served to a role without the salary grant' });
    }
  }

  // ── AI lane: the assistant has no page, so its copy is scanned where it actually lives —
  // in the JSON reply the panel renders verbatim. Same leak + jargon scanners as the pages.
  {
    const { res, ms, text } = await hit('/api/ai/status', { jar });
    R.aiN++; R.ms.push(ms); timings.push(ms);
    report.requests.push({ role: username, path: 'GET /api/ai/status', status: res.status, want: 200, ms: Math.round(ms) });
    if (res.status !== 200) {
      report.deviations.push({ role: username, path: '/api/ai/status', kind: 'status', detail: `expected 200, got ${res.status}` });
    } else {
      R.aiOk++;
      let st = null; try { st = JSON.parse(text); } catch { /* checked below */ }
      // القرار المعلن: المحرّك محلي. مزوّد خارجي على بيئة منشورة انحرافٌ لا تحسين.
      if (st?.mode !== 'local') {
        report.deviations.push({ role: username, path: '/api/ai/status', kind: 'ai-engine',
          detail: `assistant engine is "${st?.mode}" — the owner decision is a local engine (no data leaves the platform)` });
      }
      scanAiText(username, '/api/ai/status', [st?.note, ...(st?.suggestions || []).map((s) => s.label_ar)].join(' · '), R);
    }
  }
  if (aiChat) {
    for (const probe of AI_CHAT_PROBES) {
      const want = expectedStatus(probe.expect, role);
      const { res, ms, text } = await hit('/api/ai/chat', {
        jar, method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: probe.message }),
      });
      R.aiN++; R.ms.push(ms); timings.push(ms);
      const path = `POST /api/ai/chat «${probe.message}»`;
      report.requests.push({ role: username, path, status: res.status, want, ms: Math.round(ms) });
      if (res.status !== want) {
        report.deviations.push({ role: username, path, kind: 'status', detail: `expected ${want}, got ${res.status}` });
        continue;
      }
      R.aiOk++;
      let j = null; try { j = JSON.parse(text); } catch { /* checked below */ }
      // ثابت السلامة: لا رمز تأكيد من الدردشة إطلاقاً — الكتابة تبدأ من المعاينة وحدها.
      if (j && ('applyToken' in j || 'previewId' in j)) {
        report.deviations.push({ role: username, path, kind: 'ai-write',
          detail: 'chat handed back an apply token — a write must originate from POST /api/ai/preview only' });
      }
      const formLabels = (j?.form?.fields || []).map((f) => `${f.label_ar} ${f.help_ar || ''}`).join(' ');
      scanAiText(username, path, [j?.reply, formLabels, (j?.choices || []).map((c) => c.label_ar).join(' ')].join(' '), R);
    }
  }
}

// نصّ المساعد ليس HTML — يُفحص كما هو بنفس ماسحَي القيم المكسورة والمصطلحات التقنية.
function scanAiText(username, path, txt, R) {
  if (!txt || !txt.trim()) return;
  for (const m of txt.match(LEAK_RX) || []) {
    R.leaks++;
    report.deviations.push({ role: username, path, kind: 'leak', detail: `"${m}" في ردّ المساعد — «${ctx40(txt, m.replace(/[[\]]/g, '\\$&'))}»` });
  }
  for (const j of JARGON) {
    const found = j.test(txt);
    if (found) { R.jargon++; report.deviations.push({ role: username, path, kind: 'jargon', detail: `"${found}" في ردّ المساعد — «${ctx40(txt, j.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}»` }); }
  }
}

// ── output ────────────────────────────────────────────────────────────────────
const p = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };
const pad = (s, n) => String(s).padEnd(n);
console.log('\n' + pad('role', 18) + pad('pages', 9) + pad('apis', 9) + pad('ai', 8) + pad('leaks', 7) + pad('jargon', 8) + 'p95(ms)');
for (const [u, R] of Object.entries(perRole)) {
  console.log(pad(u, 18) + pad(`${R.pagesOk}/${R.pagesN}`, 9) + pad(`${R.apisOk}/${R.apisN}`, 9)
    + pad(`${R.aiOk}/${R.aiN}`, 8) + pad(R.leaks, 7) + pad(R.jargon, 8) + p(R.ms, 0.95));
}
report.summary = {
  requests: report.requests.length, deviations: report.deviations.length, warnings: report.warnings.length,
  p50_ms: p(timings, 0.5), p95_ms: p(timings, 0.95), max_ms: p(timings, 1),
};
console.log(`\noverall: ${report.summary.requests} requests · P50 ${report.summary.p50_ms}ms · P95 ${report.summary.p95_ms}ms · max ${report.summary.max_ms}ms`);

for (const w of report.warnings) console.log(`⚠ known-gap ${w.role} ${w.path} — ${w.detail}`);
if (budget && report.summary.p95_ms > budget) {
  report.deviations.push({ role: '*', path: '*', kind: 'timing', detail: `P95 ${report.summary.p95_ms}ms exceeds budget ${budget}ms` });
}
if (report.deviations.length) {
  console.error(`\n✗ ${report.deviations.length} deviation(s):`);
  for (const d of report.deviations) console.error(`  [${d.kind}] ${d.role} ${d.path} — ${d.detail}`);
} else {
  console.log(`✓ sweep clean — every status matched, no leaks, no banned jargon`);
}
if (jsonOut) { mkdirSync(dirname(jsonOut) || '.', { recursive: true }); writeFileSync(jsonOut, JSON.stringify(report, null, 2)); console.log(`report → ${jsonOut}`); }
process.exit(report.deviations.length ? 1 : 0);
