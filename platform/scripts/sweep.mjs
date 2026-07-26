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
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ROLES, PAGES, DEMO_PW, API_PROBES, pageExpected, expectedStatus, loadPageAccess } from './lib/expectations.mjs';
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
    const res = await fetch(base + path, {
      method, body, redirect: 'manual',
      headers: { cookie: cookieHeader(jar), connection: 'close', ...headers },
      signal: AbortSignal.timeout(30000),
    });
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

async function loginWeb(username) {
  const seed = await hit('/login'); // issues the CSRF cookie pair like a real browser visit
  const jar = jarFrom(seed.res);
  const form = new URLSearchParams({ username, password: DEMO_PW, _csrf: jar.sanad_csrf || '' });
  const { res } = await hit('/auth/login-web', {
    method: 'POST', jar, body: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  jarFrom(res, jar);
  if (res.status !== 302 || !jar.sanad_sid) throw new Error(`login-web failed for ${username}: status ${res.status} → ${res.headers.get('location') || 'no redirect'}`);
  return jar;
}

// ── sweep ─────────────────────────────────────────────────────────────────────
// PAGE_ACCESS predicates call can(), which needs the RBAC grant cache. The sweep is a standalone
// process (may target a remote base), so hydrate the cache from a throwaway local DB — the grant
// matrix is seeded identically in every environment.
{
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  if (!process.env.SANAD_DB) process.env.SANAD_DB = join(mkdtempSync(join(tmpdir(), 'sweep-rbac-')), 'rbac.db');
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

for (const { username, role } of roles) {
  const R = (perRole[username] = { pagesOk: 0, pagesN: 0, apisOk: 0, apisN: 0, leaks: 0, jargon: 0, ms: [] });
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
}

// ── output ────────────────────────────────────────────────────────────────────
const p = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };
const pad = (s, n) => String(s).padEnd(n);
console.log('\n' + pad('role', 18) + pad('pages', 9) + pad('apis', 9) + pad('leaks', 7) + pad('jargon', 8) + 'p95(ms)');
for (const [u, R] of Object.entries(perRole)) {
  console.log(pad(u, 18) + pad(`${R.pagesOk}/${R.pagesN}`, 9) + pad(`${R.apisOk}/${R.apisN}`, 9) + pad(R.leaks, 7) + pad(R.jargon, 8) + p(R.ms, 0.95));
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
