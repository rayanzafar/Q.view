# platform/ — سند (Sanad) engineering conventions

Node 22 (`--experimental-sqlite`), Express 5, ES modules, **zero build step**. SSR pages are template-literal HTML. Dual database driver: Postgres when `DATABASE_URL` is set (staging/prod), embedded SQLite otherwise (dev/tests). Runtime deps are intentionally minimal (express, cookie-parser, pg) — vendor libraries into `vendor/` instead of adding npm deps unless there is no sane alternative; devDependencies (playwright, axe-core) never ship (Docker uses `--omit=dev`).

## Data layer — the only way to touch the DB
`src/core/db/index.js`: `all/get/run/exec/tx/insert/update` — always `?` placeholders (auto-rewritten to `$n` on PG). Never import a driver directly, never string-interpolate values.
- IDs: `id('prefix')` from `src/core/util/ids.js` (e.g. `id('act')`). Time: `nowIso()`. Money: **INTEGER halalas** via `toHalalas(sar)` / `toSar` / `fmtSar` — never floats, never strings.
- Soft delete: set `deleted_at = nowIso()`; every read filters `deleted_at IS NULL`.
- Transactions: wrap multi-write operations in `tx(async () => { … })` — nested helper calls automatically join the tx (AsyncLocalStorage on PG).
- **Portable SQL subset** (must run on BOTH drivers): no `strftime`/`date('now')` (compute dates in JS and bind them; use `substr(col,1,10)` for date parts); strict GROUP BY (list every non-aggregated column); bare `? IS NULL` params need `CAST(? AS TEXT)`; booleans are integers 0/1; `INSERT … ON CONFLICT` is OK. Aggregates on PG return numbers (type parsers installed) — don't re-parse.
- Migrations in `migrations/*.sql` are **immutable once deployed** (001–005). New schema = new numbered file. `scripts/migrate.js` auto-rewrites INTEGER→BIGINT etc. for PG.

## Services, RBAC, audit
- Business logic lives in `src/modules/<area>/<area>.js`; routers in `<area>.routes.js` mounted with one line in `src/modules/api.routes.js`. Pages never query the DB directly for writes — they call services.
- Permission checks: `can(user, action, resource, row?)` from `src/core/rbac/index.js`; list scoping via `scope.js` helpers; sensitive fields (salary/margin/cost/ip) via `canSeeSensitive`/`redact` — check them server-side in the service, not in the view.
- **Every write calls `audit(ctx, { action, resource, resourceId, sectorId, detail })`.** `ctx = { user, ip }` comes from the route (`req.ctx`).
- Errors: throw `badRequest('رسالة عربية واضحة')` / `forbidden()` / `notFound()` from `src/core/http/errors.js` — Arabic, specific, actionable.

## SSR pages
- Every page: `export async function xPage(user, opts = {})` in `src/web/views/<area>.js`, re-exported by the `src/web/pages.js` barrel, registered in the `PAGES` map + `PAGE_ACCESS` (in `src/web/nav.js`) in `src/web/routes.js`.
- Render through `layout({ user, active, title, subtitle, body, year, scripts })`. Escape ALL dynamic text with `esc()`. Numbers use `.tnum` (bidi-isolated). Drill-downs: server-rendered inert `<template id="dd-…">` + `Sanad.openDD('…')`.
- Page-specific client JS goes in `src/web/public/pages/<feature>.js` (passed via `scripts: ['/static/pages/<feature>.js']`) — `app.js` is frozen except bug fixes. New interactive elements use `data-action` delegation, not inline `onclick`.
- Empty/loading/error/success states are designed, not accidental — use the design-system state classes in layout.js.
- UI copy: Arabic-first from `src/web/i18n/glossary.js` (`G.…`). Banned in any user-visible string: API, Schema, Entity, Adapter, Queue, Worker, Transaction, JSON, DB, null, undefined, NaN, ID:. Buttons ≤ 3 words. Errors say what happened + what to do.

## Quality bar
- Tests: `node --experimental-sqlite --test "tests/**/*.test.js"` (unit/integration/security). New behavior ⇒ new test; every fixed defect ⇒ regression test. E2E/screenshots: `scripts/e2e.mjs`, `scripts/evidence.mjs` (Playwright, chromium at `/opt/pw-browsers`).
- `scripts/sweep.mjs <base-url>` logs in as every demo role and checks every page/API for status + `undefined|NaN|null` leaks + banned jargon. Run it after every deploy.
- Deploy protocol: **ONE command only — `SANAD_RELEASE=1 npm run deploy`** (`scripts/deploy.mjs`: gates → backup ALWAYS → `up` pinned to the app-service UUID → `/ready` → boot-log check → sweep). Direct `railway up`/`down`/`redeploy` are hook-blocked even in release sessions (post-incident 2026-08-11 — the CLI link state can point at the DATABASE; see `docs/guides/DEPLOY-PIPELINE.md`). Then evidence screenshots → CHANGELOG deployed marker.
- Never disable/skip a failing check to get green. Root-cause it.

## Documentation contract
The standing dev baseline lives in `docs/` — `ARCHITECTURE.md` (system map), `FEATURES.md` (feature registry), `KNOWN-ISSUES.md` (open defects & deferred items), `CHANGELOG.md` (per-change narrative). `docs/README.md` maps every doc and when it must change. Rules:
- A commit that adds/changes a **page, route, module, or migration** updates the matching `FEATURES.md` row(s) **in the same commit** — `scripts/check-docs.mjs` (runs inside `npm run quality`) fails on drift.
- Discovering a defect ⇒ add a `KNOWN-ISSUES.md` row immediately; the fixing commit **removes the row** and adds a regression test + CHANGELOG entry.
- CHANGELOG versions are monotonic (one per notable change) with an explicit deployed/not-deployed marker.
- Structural or irreversible decisions get a new ADR in `docs/adr/`; `docs/specs/01–06` are frozen history — on divergence, code + ADRs win. Significant architecture changes update `ARCHITECTURE.md` in the same commit.

## Files you must not edit casually
- `migrations/001–00N` once deployed (immutable), `seed/*` (data snapshots), `src/core/db/index.js` (driver core), `.railwayignore`/`.gitignore` exclusion lists for secrets.
