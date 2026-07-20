// Render-parity harness — byte-level gate for pure-move refactors of the SSR pages.
//
// Render mode:   node --experimental-sqlite scripts/render-parity.mjs <outDir>
//   Builds (once) a scratch SQLite DB, renders EVERY exported page function for real DB users,
//   and writes one HTML file per page+role into <outDir> (e.g. ceo.admin.html).
// Compare mode:  node scripts/render-parity.mjs compare <dirA> <dirB>
//   Byte-compares every file across the two dirs; prints per-file OK/DIFF (with the first
//   differing byte offset + 80 chars of context) and exits non-zero on any difference.
//
// The scratch DB path is process.env.PARITY_DB (default <tmpdir>/sanad-render-parity/sanad.db).
// It is created ONCE — migrate → seed-rbac → migrate-legacy (demo snapshot) → derive-finance →
// seed — by spawning the real scripts with SANAD_DB pointed at the scratch path, then REUSED on
// subsequent runs: seeds generate random ids and timestamps, so before/after renders must read
// the very same DB bytes for the comparison to be meaningful. Delete the file to force a rebuild.
// Renders are read-only; page render order is fixed (layout's SVG gradient counter is stateful).

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLATFORM = resolve(__dirname, '..');

// ── compare mode (no DB, no app imports) ─────────────────────────────────────
if (process.argv[2] === 'compare') {
  const [dirA, dirB] = [process.argv[3], process.argv[4]];
  if (!dirA || !dirB) { console.error('usage: render-parity.mjs compare <dirA> <dirB>'); process.exit(2); }
  const names = [...new Set([...readdirSync(dirA), ...readdirSync(dirB)])].filter((n) => n.endsWith('.html')).sort();
  if (!names.length) { console.error('no .html files found to compare'); process.exit(2); }
  const ctx = (buf, at) => JSON.stringify(buf.slice(Math.max(0, at - 40), at + 40).toString('utf8'));
  let diffs = 0;
  for (const n of names) {
    const pa = join(dirA, n), pb = join(dirB, n);
    if (!existsSync(pa) || !existsSync(pb)) { diffs++; console.log(`DIFF ${n} — missing in ${existsSync(pa) ? dirB : dirA}`); continue; }
    const a = readFileSync(pa), b = readFileSync(pb);
    if (a.equals(b)) { console.log(`OK   ${n} (${a.length} bytes)`); continue; }
    diffs++;
    const max = Math.max(a.length, b.length);
    let i = 0; while (i < max && a[i] === b[i]) i++;
    console.log(`DIFF ${n} — first differing byte at offset ${i} (sizes ${a.length} vs ${b.length})`);
    console.log(`  A: ${ctx(a, i)}`);
    console.log(`  B: ${ctx(b, i)}`);
  }
  console.log(diffs ? `\n✗ ${diffs}/${names.length} file(s) differ` : `\n✓ ${names.length} files byte-identical`);
  process.exit(diffs ? 1 : 0);
}

// ── render mode ──────────────────────────────────────────────────────────────
const outDir = process.argv[2];
if (!outDir) { console.error('usage: render-parity.mjs <outDir> | compare <dirA> <dirB>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

// Point the app at the scratch DB BEFORE any app module is imported (config caches env on import).
const dbPath = process.env.PARITY_DB || join(tmpdir(), 'sanad-render-parity', 'sanad.db');
mkdirSync(dirname(dbPath), { recursive: true });
process.env.SANAD_DB = dbPath;

if (!existsSync(dbPath)) {
  console.log(`building scratch DB at ${dbPath}`);
  // Same order as scripts/reset.js. migrate-legacy/derive-finance populate the demo business data
  // (sectors/projects/contracts) that gives the parity render real branches to exercise; if their
  // inputs are absent we warn and continue — the DB is still valid, pages render empty states.
  const steps = [
    ['scripts/migrate.js', true], ['scripts/seed-rbac.js', true],
    ['scripts/migrate-legacy.js', false], ['scripts/derive-finance.js', false],
    ['scripts/seed.js', true],
  ];
  for (const [script, required] of steps) {
    const r = spawnSync(process.execPath, ['--experimental-sqlite', script], {
      cwd: PLATFORM, env: { ...process.env, SANAD_DB: dbPath }, encoding: 'utf8',
    });
    const ok = r.status === 0;
    console.log(`  ${ok ? '✓' : '✗'} ${script}`);
    if (!ok) {
      console.error((r.stderr || r.stdout || '').split('\n').slice(-12).join('\n'));
      if (required) process.exit(1);
      console.error(`  (optional step failed — continuing)`);
    }
  }
} else {
  console.log(`reusing scratch DB at ${dbPath} (delete it to force a rebuild)`);
}

const P = await import(new URL('../src/web/pages.js', import.meta.url));
const { all, get, close } = await import(new URL('../src/core/db/index.js', import.meta.url));
const { initRbac } = await import(new URL('../src/core/rbac/index.js', import.meta.url));
await initRbac(); // load the synchronous RBAC decision cache, same as server boot

// Enrich a raw app_user row exactly like src/core/http/context.js resolveUser() does (that helper
// needs a session row, so we mirror its scope enrichment here instead of writing to the DB).
async function enrich(u) {
  if (!u) return null;
  const projectIds = new Set((await all('SELECT id FROM project WHERE owner_user_id = ?', [u.id])).map((r) => r.id));
  if (u.employee_id) {
    for (const m of await all(
      "SELECT group_id FROM membership WHERE employee_id = ? AND group_kind = 'project' AND deleted_at IS NULL",
      [u.employee_id]
    )) projectIds.add(m.group_id);
  }
  return {
    id: u.id, username: u.username, role_id: u.role_id, sector_id: u.sector_id,
    department_id: u.department_id || null, scope: u.scope, employee_id: u.employee_id,
    name_ar: u.name_ar, name_en: u.name_en, projectIds, teamIds: new Set(),
  };
}
const byUsername = (username) =>
  get('SELECT * FROM app_user WHERE username = ? AND active = 1 AND deleted_at IS NULL', [username]);
const byRole = (roleId) =>
  get('SELECT * FROM app_user WHERE role_id = ? AND active = 1 AND deleted_at IS NULL ORDER BY username, id LIMIT 1', [roleId]);

const admin = await enrich(await byUsername('admin') || await byRole('admin'));
const ceo = await enrich(await byUsername('demo.ceo') || await byRole('ceo_office'));
const lead = await enrich(await byUsername('demo.sectorlead') || await byRole('sector_lead'));
if (!admin || !lead) { console.error('missing required users (admin / sector lead) — reseed the scratch DB'); process.exit(1); }
console.log(`users: admin=${admin.username} ceo=${ceo?.username || '—'} lead=${lead.username}`);

const contractId = (await get('SELECT id FROM contract WHERE deleted_at IS NULL ORDER BY id LIMIT 1'))?.id || 'PARITY-NO-CONTRACT';
const projectId = (await get('SELECT id FROM project WHERE deleted_at IS NULL ORDER BY id LIMIT 1'))?.id || 'PARITY-NO-PROJECT';
console.log(`ids: contract=${contractId} project=${projectId}`);

const Y = { year: 2026 };
// Fixed render order — one entry per output file: [fileBase, fn, ...args]
const plan = [
  ['login.anon', P.loginPage, ''],
  ['ceo.admin', P.ceoPage, admin, Y],
  ['portfolio.admin', P.portfolioPage, admin, Y],
  ['sector.admin', P.sectorPage, admin, Y],
  ['opportunities.admin', P.opportunitiesPage, admin, Y],
  ['my-opportunities.admin', P.myOpportunitiesPage, admin, Y],
  ['projects.admin', P.projectsPage, admin, Y],
  ['tasks.admin', P.tasksPage, admin, Y],
  ['timesheet.admin', P.timesheetPage, admin, Y],
  ['approvals.admin', P.approvalsPage, admin, Y],
  ['team.admin', P.teamPage, admin, Y],
  ['users.admin', P.usersPage, admin, Y],
  ['audit.admin', P.auditPage, admin, Y],
  ['reports.admin', P.reportsPage, admin, Y],
  ['org.admin', P.orgPage, admin, Y],
  ['finance.admin', P.financePage, admin, Y],
  ['contract-detail.admin', P.contractDetailPage, admin, contractId],
  ['project-detail.admin', P.projectDetailPage, admin, projectId],
  // sector-scoped lens (locked-to-own-sector + scoped roster branches)
  ['sector.sectorlead', P.sectorPage, lead, Y],
  ['team.sectorlead', P.teamPage, lead, Y],
  // ceo-office lens (company scope without admin role)
  ...(ceo ? [
    ['ceo.ceo', P.ceoPage, ceo, Y],
    ['portfolio.ceo', P.portfolioPage, ceo, Y],
    ['finance.ceo', P.financePage, ceo, Y],
  ] : []),
];

const threw = [];
for (const [name, fn, ...args] of plan) {
  let html;
  try {
    html = await fn(...args);
  } catch (e) {
    threw.push({ name, e });
    // Only name+message go into the artifact: stack frames carry file paths that legitimately
    // change in a pure-move refactor, and the gate is "throws IDENTICALLY", not "same stack".
    html = `__RENDER_THREW__ ${e.name}: ${e.message}`;
  }
  writeFileSync(join(outDir, `${name}.html`), html);
}
await close();

console.log(`\nrendered ${plan.length} page files → ${outDir}`);
if (threw.length) {
  console.error(`✗ ${threw.length} page(s) THREW while rendering:`);
  for (const t of threw) { console.error(`--- ${t.name}`); console.error(t.e.stack || t.e); }
  process.exit(3);
}
console.log('✓ all pages rendered without throwing');
