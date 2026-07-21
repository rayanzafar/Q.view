// Single source of truth for the quality harness: demo roles, the page map, API probes and the
// per-role EXPECTED HTTP status for each — shared by tests/security/permissions-matrix.test.js
// and scripts/sweep.mjs so the two can never drift apart.
//
// Every cell below was verified empirically against the running app (2026-07-20) and cross-checked
// against src/core/rbac/matrix.js grants. The design deliberately returns 200-with-scoped-content
// (empty lists / zeroed aggregates) for list endpoints instead of 403 — the scope filter fails
// closed at the SQL level ('1=0'), so a 200 here is not a leak. Hard 403s appear where a service
// guards the whole resource (org roster/tree) or a row is out of the caller's scope (IDOR probes).
import { DEMO_PW } from '../seed.js';

export { DEMO_PW };

// The 10 demo personas seeded by scripts/seed.js (username → role + REAL scope/sector, so
// PAGE_ACCESS predicates evaluate against the same shape the server resolves at login).
export const ROLES = [
  { username: 'demo.admin', role: 'admin', scope: 'company', sector_id: null },
  { username: 'demo.ceo', role: 'ceo_office', scope: 'company', sector_id: null },
  { username: 'demo.sectorlead', role: 'sector_lead', scope: 'sector', sector_id: 'SOLUTIONS' },
  { username: 'demo.bd', role: 'bd_manager', scope: 'own', sector_id: 'SOLUTIONS' },
  { username: 'demo.pm', role: 'project_manager', scope: 'own', sector_id: 'SOLUTIONS' },
  { username: 'demo.finance', role: 'finance', scope: 'company', sector_id: null },
  { username: 'demo.hr', role: 'hr', scope: 'company', sector_id: null },
  { username: 'demo.consultant', role: 'consultant', scope: 'own', sector_id: 'SOLUTIONS' },
  { username: 'demo.employee', role: 'employee', scope: 'own', sector_id: 'SOLUTIONS' },
  { username: 'demo.viewer', role: 'viewer', scope: 'sector', sector_id: 'SOLUTIONS' },
];

// Current PAGES map in src/web/routes.js (hardcoded on purpose: the harness must notice when a
// page disappears or a new one is not covered).
export const PAGES = ['ceo', 'portfolio', 'sector', 'opportunities', 'my-opportunities', 'projects',
  'clients', 'tasks', 'timesheet', 'approvals', 'team', 'imports', 'users', 'audit', 'reports', 'org', 'finance', 'mail'];

// Roles whose service guards admit them to the people/org surfaces (read employee | create sector).
const ORG_READERS = new Set(['admin', 'ceo_office', 'sector_lead', 'hr']);

// ── page-level expectation ─────────────────────────────────────────────────────
// CURRENT behavior: every authenticated role gets 200 on every page EXCEPT team/org, whose page
// functions call service guards (staffingRoster/orgTree) that throw 403. There is NO page-level
// access map yet — that is the documented 'PENDING nav-guard' gap. Once src/web/nav.js exists and
// exports PAGE_ACCESS, loadPageAccess() returns it and expectations flip to strict 200/403.
export function pageExpected(role, page, pageAccess = null) {
  if (pageAccess) {
    const allowed = pageAllowed(role, page, pageAccess);
    if (allowed === null) return { status: 200, soft: true }; // unknown shape — stay soft
    return { status: allowed ? 200 : 403, soft: false };
  }
  if ((page === 'team' || page === 'org') && !ORG_READERS.has(role)) return { status: 403, soft: false };
  // 200-for-all-authed is asserted as CURRENT behavior; the authz distinction is PENDING nav-guard.
  return { status: 200, soft: false, pendingNavGuard: !['tasks', 'timesheet'].includes(page) };
}

function pageAllowed(role, page, pageAccess) {
  const rule = pageAccess?.[page];
  if (rule === undefined) return null;
  if (Array.isArray(rule)) return rule.includes(role) || rule.includes('*');
  if (typeof rule === 'function') {
    const p = ROLES.find((r) => r.role === role);
    try { return !!rule({ role_id: role, scope: p?.scope || 'own', sector_id: p?.sector_id ?? null }); } catch { return null; }
  }
  return null;
}

// Detect the future nav-guard. Returns PAGE_ACCESS or null (absent today).
export async function loadPageAccess() {
  try {
    const nav = await import(new URL('../../src/web/nav.js', import.meta.url));
    return nav.PAGE_ACCESS || null;
  } catch { return null; }
}

// ── API probes (staging-safe: no fixture ids) ──────────────────────────────────
// expect: either a number (same status for every role) or { default, [role]: status }.
export const API_PROBES = [
  { method: 'GET', path: '/auth/me', expect: 200 },
  { method: 'GET', path: '/api/opportunities', expect: 200 },              // scope-filtered list
  { method: 'GET', path: '/api/projects', expect: 200 },                   // scope-filtered list
  { method: 'GET', path: '/api/pipeline', expect: 200 },                   // scope-filtered aggregate
  { method: 'GET', path: '/api/org/roster', expect: rosterExpect() },      // hard service guard
  { method: 'GET', path: '/api/org/tree', expect: rosterExpect() },        // hard service guard
  { method: 'GET', path: '/api/finance/summary', expect: 200 },            // zeros when unscoped
  { method: 'GET', path: '/api/finance/by-pm', expect: 200 },
  { method: 'GET', path: '/api/finance/by-contract', expect: 200 },
  // QH-2 FIXED: metrics are leadership numbers — company scope only for /company; sector members
  // (any role whose sector_id matches) plus company scope for /sector/:id.
  { method: 'GET', path: '/api/metrics/company', expect: { default: 403, admin: 200, ceo_office: 200, finance: 200, hr: 200 } },
  { method: 'GET', path: '/api/metrics/sector/SOLUTIONS', expect: 200 },
  { method: 'GET', path: '/api/tasks/mine', expect: 200 },                 // own-scoped
  { method: 'GET', path: '/api/timesheets/mine', expect: 200 },            // own-scoped
  { method: 'GET', path: '/api/notifications', expect: 200 },              // own-scoped
  { method: 'GET', path: '/api/approvals/queue', expect: 200 },            // role/sector-matched
  // POST probes with an EMPTY body separate authorization from validation: a role WITH the create
  // grant reaches validation (400 عنوان/اسم مطلوب); a role WITHOUT is rejected first (403).
  { method: 'POST', path: '/api/opportunities', body: {}, expect: { default: 403, admin: 400, sector_lead: 400, bd_manager: 400 } },
  { method: 'POST', path: '/api/org/employees', body: {}, expect: { default: 403, admin: 400, sector_lead: 400, hr: 400 } },
  { method: 'POST', path: '/api/projects', body: {}, expect: { default: 403, admin: 400, sector_lead: 400, project_manager: 400 } },
  { method: 'POST', path: '/api/tasks/quick', body: {}, expect: 400 },     // every role may create own tasks
  { method: 'POST', path: '/api/timesheets', body: {}, expect: 400 },      // every role logs own time
  { method: 'POST', path: '/api/approvals', body: {}, expect: 400 },       // unknown workflow key → validation
];

function rosterExpect() {
  const e = { default: 403 };
  for (const r of ORG_READERS) e[r] = 200;
  return e;
}

// Fixture-dependent probes (ids from scripts/lib/seed-fixture.mjs) — used ONLY by the permissions
// matrix test against a locally seeded DB; never by the live sweep.
export const FIXTURE_PROBES = [
  // IDOR: a CONSULTING-sector opportunity must be invisible to SOLUTIONS-scoped and own-scoped roles.
  { method: 'GET', path: '/api/opportunities/FX-OPP-CONS', expect: { default: 403, admin: 200, ceo_office: 200, finance: 200 } },
  // Contract detail: company invoice/contract readers + the owning sector's lead only.
  { method: 'GET', path: '/api/finance/contracts/FX-CON-1', expect: { default: 403, admin: 200, ceo_office: 200, sector_lead: 200, finance: 200 } },
  // Row-level write probe on a real invoice: authorized roles fall through to amount validation.
  { method: 'POST', path: '/api/finance/collections', body: { invoiceId: 'FX-INV-2' }, expect: { default: 403, admin: 400, sector_lead: 400, finance: 400 } },
];

export function expectedStatus(expect, role) {
  return typeof expect === 'number' ? expect : (expect[role] ?? expect.default);
}
