# Sanad (سند) — Architecture Baseline

Current-state map of the platform as built. **Code is authoritative**; `docs/specs/01–06` and `README.md` are known-stale (see `docs/specs/README.md`). The frozen delivery contract is `docs/specs/07-contracts-delivery2.md`; the ADRs (`docs/adr/`) record standing decisions. Paths below are relative to `platform/`.

Verified against the working tree containing migrations 001–028 (task approvals): **1447 tests pass / 0 fail** (`node --experimental-sqlite --test "tests/**/*.test.js"`).

## 1. Stack & runtime shape

- **Node 22** (`--experimental-sqlite`), **Express 5**, ES modules, **zero build step**. Runtime deps: express, cookie-parser, pg, nodemailer only (`package.json`); devDeps (playwright, axe-core) never ship (`Dockerfile` uses `npm ci --omit=dev`).
- **SSR**: pages are template-literal HTML — `src/web/views/*.js` render through `layout()` in `src/web/layout.js`. No client framework; page JS is plain modules in `src/web/public/pages/`.
- **Dual DB driver** (`src/core/db/index.js`): Postgres when `DATABASE_URL` is set (staging), embedded `node:sqlite` otherwise (dev/tests). One API (`all/get/run/exec/tx/insert/update`), `?` placeholders auto-rewritten to `$n` on PG; PG type parsers return numbers for BIGINT/NUMERIC so halalas sums match SQLite. `scripts/migrate.js` rewrites `INTEGER→BIGINT`, `REAL→DOUBLE PRECISION` for PG.
- **Single process, in-process jobs**: `src/core/jobs/scheduler.js` — one 60s `setInterval` tick runs `fireDueSchedules()` (report schedules) then `processQueue(30)` (email queue), each in its own try/catch; hourly `purgeExpiredCodes(24)` (OTP). Rate limiting is also in-memory (`src/core/http/security.js`). Both assume **one replica**.
- **App assembly** (`src/server.js`): security headers → `express.json({limit:'1mb'})`/urlencoded → cookies → CSRF (double-submit, urlencoded forms) → `attachContext()` → path rate-limiters → `/health` (static) and `/ready` (DB ping) → `/static` → `/auth` (`src/modules/auth.routes.js`) → `/api` (`src/modules/api.routes.js`) → `/api/ai` (`src/modules/ai.routes.js`) → `/` (`src/web/routes.js`) → `errorHandler()`. `trust proxy` is `1`; prod binds host `::` (Railway IPv6 healthcheck, `src/core/config.js`).

## 2. Layer map

### Schema — `migrations/`

- `001–028.sql`, immutable once deployed; portable SQL authored for SQLite, pgified for PG; applied once, tracked in `schema_migration` (`scripts/migrate.js`).
- From `007` on, files carry extensive Arabic rationale comments recording owner decisions and rejected alternatives — the de-facto ADR log. Read them before proposing schema changes.
- Recent waves: `017` deliverable four-facts + project_phase, `018` finance-role retirement, `019` VAT split, `020` revenue-on-delivery backfill, `022` staffing confirmation, `025` department grants, `026` opportunity partner departments, `027` internal work buckets, `028` task approvals.

### Core — `src/core/`

| Dir | Contents |
|---|---|
| `db/` | Dual-driver DB API, `?`→`$n` rewrite, tx with nested-join semantics. Do not edit casually. |
| `rbac/` | `matrix.js` (ROLE_GRANTS, SENSITIVE_FIELDS, SCOPE_RANK), `index.js` (`can`/`effectiveScope`/`redact`, SECTOR_WIDE_LISTS), `scope.js` (`scopeFilter` list SQL), `departments.js` (own ∪ managed department set). |
| `auth/` | `service.js` password login + non-renewing lockout, `otp.js` hashed one-time codes (10 min TTL, atomic consume, invite activation), `password.js` scrypt. |
| `http/` | `context.js` (`attachContext`/`resolveUser`/`requireAuth`), `errors.js` (Arabic HttpError + HTML/JSON handler), `csrf.js`, `security.js` (headers, CSP report-only, in-memory limiter). |
| `policy/` | `pages.js` — PAGE_ACCESS predicates + `seesCompanyPerformance()`; lives in core so non-web consumers import it without layer inversion. |
| `jobs/` | `scheduler.js` 60s tick (§1). |
| `mail/` | `transport.js` preview/smtp channels, fail-closed recipient allowlist; `accounts.js` self-updating account allowlist (60s TTL); `templates.js`, `smtp.js`, `auth-mail.js`. |
| `audit/` | `audit(ctx, {action, resource, resourceId, sectorId, detail})` → `audit_log`. Called by every write. |
| `lifecycle/` | `remove.js` — guarded soft delete for project/opportunity/user: money rows block, dependents cascade in one tx, Arabic refusals name blockers. |
| `backup/` | `dump.js` in-app NDJSON logical dump (raw PG port unreachable from dev); HTTP surface in `src/modules/backup.routes.js` gated by `SANAD_BACKUP_TOKEN`. |
| `ai/` | `assistant.js` (local rule engine, 8 intents), `provider.js` (sole AI-key reader; external LLM needs `AI_ENGINE=provider` AND a key), `store.js` (preview lifecycle, 15-min TTL, atomic claim). |
| `reports/` | `engine.js` (schedules, per-recipient-permission emails, queue), `metrics.js` (single source of KPI math), `periods.js` (period reports, 6 lenses), `changes.js`/`attention.js`/`project-cash.js`. |
| `org/`, `demo/`, `guide/`, `i18n/`, `util/` | `kind.js` delivery-vs-support sectors + `entity-registry.js`; `registry.js` demo_record purge ledger; guide/tour content; shared label/threshold vocab; `ids.js` (`id('prefix')`, `nowIso`, halalas helpers). |
| `config.js` | Env config + `assertProdSecrets()` boot gate. |

### Modules — `src/modules/` (services + thin routers)

Business logic in `<area>/<area>.js` (authz + validation + tx + audit **inside the service**, because APIs are callable directly); routers stay thin and are mounted in `api.routes.js` — 17 sub-routers behind one `requireAuth()` plus inline routes (opportunities, pipeline, projects, tasks, timesheets, approvals, notifications, finance, intake, metrics).

| Area | Key files |
|---|---|
| Sales | `crm/opportunities.js` (pipeline, stage ladder, VAT-gross values), `crm/opp-project-sync.js` (won↔project mirror), `crm/oppteam.js`, `crm/oppdocs.js`, `clients/clients.js` (footprint-scoped 360, merge/unmerge), `intake/intake.js` (AI/heuristic contract extraction). |
| Events | `events/events.js` — «الفعاليات» exhibition contact capture, **isolated by owner ruling (2026-08-26)**: own four tables (migration `038`), no FK to the CRM or to `app_user`/`sector`, never writes opportunity/project/client/contact/document; `capture_key` idempotency, in-event duplicate hints, immutable `raw_text`, manual outcomes; `events/card-parser.js` (local card-text parser, no network). |
| Delivery | `pmo/projects.js`, `pmo/tasks.js`, `pmo/task-approval.js`, `pmo/progress.js` (single source of progress truth), `pmo/governance.js` (risk/issue/decision/change/milestone/deliverable/phase registers), `pmo/capacity.js`, `pmo/notes.js`. |
| People | `org/org.js` (org tree, employee lifecycle, staffing roster), `org/confirm.js` (`ownsEmployee`/`managerOfEmployee`), `org/staffing-settle.js`, `org/attribution.js`, `timesheets/timesheets.js`. |
| Finance | `finance/finance.js` (bridge, claims, collections, projectMoney), `finance/vat.js` (the one VAT rule), `finance/recognition.js` (revenue on delivery), `finance/expenses.js`. |
| Governance | `workflow/engine.js` (threshold approvals + person-addressed direct approvals), `identity/identity.js` (admin-only user management), `identity/grants.js`, `notifications/notify.js`. |
| Team & resources (ADR-0016) | `team/capacity-model.js` (pure: month = full-time unit 100, engagement-day proration, two units — % of the resource's capacity vs. full-time units — never a sum of month percentages), `team/capacity-read.js` (one reader for allocations + capacity versions + pending requests → `monthFigures`/`periodFigures`), `team/access.js` (`resourceScopeSql`, `planningRights`, `managesResource`, `canReadClose`), `team/resources.js` (directory/preview/profile/capabilities/engagement/audit, wraps `org.createEmployee/updateEmployee`), `team/allocations.js` + `team/allocation-settle.js` (preview → `allocation_request` → direct apply for whoever manages the resource, else a person-addressed approval settled by `settleAllocationRequest` with fingerprint re-validation and idempotency keys), `team/needs.js`, `team/analysis.js` (review signals + `analysis_case` follow-ups as real tasks), `team/commitments.js`, `team/cost-close.js` (cost-distribution periods in basis points, compare-and-set lock, locked snapshot, corrections as new versions, CSV export). Five routers `team/team-*.routes.js` under `/api/team`. |
| Data & AI | `io/engine.js` + `io/adapters/*` (6 import/export adapters, preview/apply/undo), `ai/apply.js` (confirmed AI previews → real services), `search/search.js`, `views/views.js` (saved views), `guide/`, `home/`. |

### Web — `src/web/`

- `layout.js` — `layout({user, active, title, subtitle, body, year, scripts})`; design-system CSS, nav, global chrome (cmd-K palette, AI panel, notification badge), chart helpers. Escapes title/subtitle at the sink.
- `nav.js` — NAV_ITEMS, DETAIL_ACCESS, `pageAllowed()`; re-exports PAGE_ACCESS. `routes.js` — `/login` + OTP web flow, `landingFor()`, `/app/:page` dispatcher against the PAGES map, detail routes (`/app/{project,opportunity,client,event,person,contract}/:id`), sandboxed mail preview.
- `views/*.js` — one exported page function per area, re-exported by the `pages.js` barrel. All dynamic text through `esc()` (`views/_shared.js`); drill-downs are SSR `<template id="dd-…">` + `Sanad.openDD` (no client fetch, page RBAC covers them).
- `public/app.js` — frozen `window.Sanad` base layer; new interactivity goes in `public/pages/<feature>.js` with `data-action` delegation. `i18n/glossary.js` — Arabic vocabulary + jargon gate. `assets.js` — `?v=<mtime>` cache-busting stamped at boot.
- `public/vendor/<lib>-<version>/` — browser-served vendored libraries (first: `tesseract-5.1.1/`, the in-browser card reader — ADR-0014), each with a `VENDORED.md` (source URLs, SHA-256, upgrade steps). The version lives in the directory name, so `/static` serves everything under `public/vendor/` with `Cache-Control: public, max-age=31536000, immutable` in every env (`src/server.js`); upgrading = new directory + new paths, never an in-place overwrite. Runtime fetches by such engines (worker, core, language models) bypass `asset()` fingerprinting, which is why the immutable header — not `?v=` — carries their cache contract. CSP carries `'wasm-unsafe-eval'` + `worker-src 'self'` for them (`src/core/http/security.js`); guarded by `tests/security/ocr-engine-vendored.test.js`.

### Ops — `scripts/`

- Boot & seeds: `boot.sh` (§7), `migrate.js`, `seed-rbac.js`, `seed-staging.js`, `seed-admin.js`, `seed-roles.js`, one-shot owner-directive scripts (`apply-owner-*.js`, `backfill-*.js`).
- Gates: `sweep.mjs` (live 16-role × 21-page sweep: status/leak/jargon/P95), `e2e.mjs` + `evidence.mjs` (pinned Chromium at `/opt/pw-browsers`), `check-glossary.mjs` (static jargon scanner), `check-deps.mjs` (pretest guard), `render-parity.mjs` (byte-parity for refactors), `lib/expectations.mjs` — the **single expectation table** shared by sweep and `tests/security/permissions-matrix.test.js` so they can never drift.
- Backups: `pg-backup.sh` (mandatory before any live migration/backfill) / `pg-restore.sh`; `backup.js` (dev SQLite). Guard hooks: `hooks/pre-guard.mjs` blocks secret-file edits, deployed-migration edits (any existing `migrations/NNN_*.sql`), any `railway` command or staging-URL access outside a release session (`SANAD_RELEASE=1`), and mutation of legacy Railway project `honest-spirit`.
- QA lane: `qa-up.mjs` (boot/tear down a disposable, air-gapped local instance — temp SQLite, loopback, all 16 personas) sharing `lib/qa-instance.mjs` with `e2e.mjs`. Agent-driven via `/qa-explore` + the `qa-explore` skill + `qa-explorer` agent (report-only, never touches the live deployment). See `docs/qa/README.md`.

### Tests — `tests/`

`unit/`, `integration/`, `security/`, `e2e/` + root suites, run on SQLite. New behavior ⇒ new test; every fixed defect ⇒ regression test. Named guards worth knowing: `security/permissions-matrix.test.js`, `security/finance-role-retired.test.js`, `security/ai-engine-local.test.js`.

## 3. Request lifecycle

1. **Session**: `sanad_sid` httpOnly cookie → `attachContext()` (`src/core/http/context.js`) resolves session → `resolveUser()` builds the user once per request:
   - `sector_id`, `scope` (data-window width — distinct from grant scope; conflating them once let procurement open the CEO dashboard),
   - `projectIds` (owned ∪ project membership ∪ allocations),
   - `departmentIds` (own department ∪ departments managed via `department.manager_user_id`, `src/core/rbac/departments.js`),
   - `departmentGrants` (loaded per-request from `src/modules/identity/grants.js` — takes effect without restart),
   - `opportunityIds` (staffed opportunities; PENDING memberships excluded), `teamIds` (always empty — team scope fails closed).
2. **Route guard**: web pages go through `/app/:page` in `src/web/routes.js`, gated by `pageAllowed()` (`src/web/nav.js`) over `PAGE_ACCESS` (`src/core/policy/pages.js`) — **the same predicate renders the menu and returns the 403**, so they cannot diverge. API routes get only `requireAuth()`; authorization lives in services.
3. **Service** (`src/modules/<area>/<area>.js`): per-row `can(user, action, resource, row)` (`src/core/rbac/index.js`) — a call **without** a target row passes vacuously on any grant, so services always pass the row or `{sector_id, department_id, user_id}`; list scoping via `scopeFilter()` SQL (`src/core/rbac/scope.js`); sensitive fields via `redact`/`canSeeSensitive` (salary/margin/cost/ip); multi-write ops in `tx()` (nested calls join); **every write calls `audit(ctx, …)`**.
4. **Response**: SSR page via `layout()` with all dynamic text through `esc()`, or JSON. Errors are Arabic `badRequest/forbidden/notFound` (`src/core/http/errors.js`) rendered by `errorHandler()` as an RTL page or JSON envelope — no internals leak.

## 4. Revenue follows delivery — end-to-end data flow

The product bet: sales, delivery and finance numbers reconcile because revenue is recognized from **delivered work**, not invoices.

1. **Opportunity** (`src/modules/crm/opportunities.js`): created in a delivery sector only (support units rejected via `assertDeliverySector`); `value_halalas` stored VAT-**gross** (net input converted at write via `grossOfNet`). Stage moves write `opportunity_stage_history` and reset `win_pct` to the stage default.
2. **Won → mirrored project** (`src/modules/crm/opp-project-sync.js`): moving to an `is_won` stage calls `ensureProjectForWonOpportunity` in the same tx — a NOT_STARTED seed project with `source_opp_id` and the opportunity's value as contract value. The mirror is bidirectional (`ensureOpportunityForProject` gives every project a won opportunity; `syncMirrorFromProject` keeps project-mirrors in sync). Won-reversal requires a written reason and is blocked unless `projectIsUntouched`; an untouched seed is folded in the same tx.
3. **Delivery — deliverable four facts** (migration `017`, `src/modules/pmo/governance.js`): `status` carries only the human workflow (`DRAFT|IN_PROGRESS|DELIVERED|ACCEPTED|REJECTED`); `invoiced_at`/`collected_at` are finance-only stamps written beside it, never into it. Invoiced/collected deliverables can change status but never be deleted.
4. **Recognition** (`src/modules/finance/recognition.js`): every deliverable write triggers `syncDeliverableRevenue` in the same tx — upserts a `revenue_line` with derived id `rl_dlv_<deliverableId>` when status ∈ `DELIVERED|ACCEPTED` and amount > 0; reverting the status deletes the line. Recognized revenue reads as **NET**; everything cash-side is gross.
5. **Progress claims (مستخلصات)** (`src/modules/finance/finance.js` `createProgressClaim`): generates an ISSUED invoice (`kind='progress_claim'`, code `<contract>-C<n>`, due +30d) from DELIVERED/ACCEPTED deliverables of the contract's own project; writes `invoice_line` rows and stamps `invoiced_at`. Bad explicit selections are rejected wholesale with named reasons — never silently dropped.
6. **Collections** (`recordCollection`): gross amount validated against outstanding (amount − retention − collected), split net/vat via `splitGross`, invoice flips PAID/PARTIALLY_PAID, `collected_at` stamped on deliverables when the invoice fully settles.
7. **Readouts**: `financeSummary` bridge per year (bookings → recognized revenue → invoiced → collected → AR, + aging/DSO); `projectMoney` per-project view ("absence is not zero" — unrecorded data returns null + `recorded:false`, never 0); executive screens read `effectiveProgress`/`projectRevenue`/`projectKind` (§5), all derived at read time.

### Task-approvals flow (migration `028`)

A task linked to a project or opportunity, created by a user below sector create-scope whose department has a registered manager, is written with `approval_state='PENDING'` in the same tx as `raiseDirectApproval` (workflow key `task_approval`) addressed to `managerOfEmployee`, plus a notification (`src/modules/pmo/tasks.js`, `src/modules/pmo/task-approval.js`):

- A pending task **is not yet work**: `approvedTaskSql()` hides it from every cross-person read and counter; `ownOrApprovedTaskSql()` keeps it visible to its creator only, labeled "بانتظار اعتماد مديرك".
- `task.status` stays `TODO` — pending is a separate existence column, deliberately not a sixth status value (rationale in `migrations/028_task_approval.sql`).
- Approve → `approval_state` cleared to NULL; reject → soft delete (`settleTask`, dispatched via `DIRECT_SETTLERS` in `src/modules/workflow/engine.js`).
- No manager registered ⇒ the task is added immediately — never a request with no addressee. Internal/personal tasks and admin/sector-and-wider creators skip approval entirely.

### Staffing-confirmation flow (migration `022`)

Adding someone to an opportunity team (`src/modules/crm/oppteam.js`) when the actor does not own the employee (`ownsEmployee`, `src/modules/org/confirm.js`) writes `membership.status='PENDING'` plus a direct approval to the employee's `department.manager_user_id`. `settleStaffing` (`src/modules/org/staffing-settle.js`) flips it ACTIVE or soft-deletes on rejection; PENDING memberships are excluded from load math and dossier counts.

### Allocation-request flow (migration `042`)

A planning change (`src/modules/team/allocations.js`) is previewed first (per resource/month: current, added, after, available, conflict, out-of-engagement) and carries a fingerprint of the resource's current allocation rows. `submitRequest` writes one `allocation_request` row per resource with an idempotency key; whoever manages the resource (`managesResource`) applies it at once through the existing staffing writers (`assignEmployee`/`assignInternalWork`/`setAllocationMonths`), everyone else gets `status='pending'` plus a direct approval (workflow key `allocation_request`) addressed to `managerOfEmployee`. Pending requests never touch `allocation`; they appear as a separate layer in the matrix. Settlement (`settleAllocationRequest`, dispatched via `DIRECT_SETTLERS`) re-validates the fingerprint and the engagement inside the transaction: a changed plan returns the request («تغيّرت الخطة منذ المعاينة») and the settler's `{ outcome }` closes the approval as rejected instead of «اعتُمد طلبك».

Both direct flows reuse the standard `approval_request` inbox via `assignee_user_id` — only the assignee (or admin) may act, deliberately **without** an approve-grant check (a manager confirms his own people). Role/amount-threshold approvals (`submitForApproval`/`actOnApproval`, same file) share the same tables: step chosen by `min_amount_halalas`, sector/amount derived from the fetched row never the request body, requester can never act on their own request, sub-threshold requests auto-approve with an audited reason.

## 5. Core invariants

| Invariant | Rule | Anchor |
|---|---|---|
| Money | INTEGER halalas everywhere; `toHalalas/toSar/fmtSar`; never floats/strings | `src/core/util/ids.js` |
| VAT split | Stored amounts are GROSS; `net = trunc(gross*100/115)`, `vat = gross − net` (sum-closure); NULL net = "not computed", 0 = exempt; expense table excluded from the 15% assumption | `src/modules/finance/vat.js`, migration `019` |
| Soft delete | `deleted_at = nowIso()`; every read filters `deleted_at IS NULL`; money rows (invoice/collection/contract/revenue_line) block deletion entirely | `src/core/lifecycle/remove.js` |
| Portable SQL | Runs on SQLite AND PG: no `strftime`/`date('now')` (bind JS dates, `substr()` for parts), strict GROUP BY, booleans 0/1, `CAST(? AS TEXT)` for bare IS-NULL params | `CLAUDE.md`, `src/core/db/index.js` |
| Immutable migrations | Deployed `migrations/*.sql` are never edited; new schema = new numbered file; **no Latin `?` anywhere in a migration, comments included** — the PG placeholder rewriter processes the whole file (use Arabic `؟`) | `scripts/migrate.js`, `scripts/hooks/pre-guard.mjs` |
| Derived IDs | `revenue_line.id = 'rl_dlv_' + deliverable_id`; `project_phase.id = project_id + ':ph' + N` — load-bearing for idempotency, must never drift | `src/modules/finance/recognition.js`, migrations `017`/`020` |
| Derived, not stored | `project.kind`, `project.progress_pct` and project revenue columns are stale migration data — always read `projectKind()` / `effectiveProgress()` / `projectRevenue()` | `src/modules/pmo/projects.js`, `src/modules/pmo/progress.js` |
| Personal-task isolation | `work_kind='personal'` rows carry NULL sector/department at write AND every cross-account query includes `notPersonalSql()`; access errors are `notFound`, never `forbidden` (which would confirm existence) | `src/modules/pmo/tasks.js` |
| Events isolation | وحدة الفعاليات لا تشير إلى شيء خارجها: لا مفتاح إلى الفرص أو العملاء أو المشاريع — الجسر إلى الفرصة إنسانٌ بعد الفعالية. `src/modules/events` never imports `modules/clients`/`modules/crm` and never reads or writes opportunity/project/client/contact/document; its four tables (migration `038`) carry no FK to the CRM nor to `app_user`/`sector` (capturer names denormalised); owner ruling 2026-08-26 | `src/modules/events/events.js`, `migrations/038_events.sql`, isolation scenario + structural scan in `tests/integration/events.test.js` |
| Sealed salary gate | No role has a `salary` grant — only admin's wildcard opens it (owner decision, until Odoo); the retired `finance` role must never return (migration `018`) | `src/core/rbac/matrix.js`, `tests/security/finance-role-retired.test.js` |
| tx-join semantics | Nested `tx()` calls **join** the parent transaction (AsyncLocalStorage-bound client on PG, depth counter on SQLite) — never assume nested isolation; exists to prevent silent half-commits | `src/core/db/index.js` |
| Pending ≠ existing | `membership.status='PENDING'` and `task.approval_state='PENDING'` rows are excluded from all aggregates until settled | `src/modules/org/staffing-settle.js`, `src/modules/pmo/task-approval.js` |
| Audit everything | Every write calls `audit(ctx, …)`; audit detail doubles as the user-facing project-updates feed, so detail strings are de-facto Arabic UI copy | `src/core/audit/index.js` |
| Arabic-only UI | All user-visible strings from the glossary; jargon banned (API/JSON/null/…); enforced by a static gate and the live sweep | `src/web/i18n/glossary.js`, `scripts/check-glossary.mjs` |

## 6. RBAC model

- **18 roles** in `ROLE_GRANTS` (`src/core/rbac/matrix.js`): admin (wildcard), ceo_office, sector_lead, department_manager, line_manager, project_manager, bd_manager, bd_head, procurement, hr, operations, consultant, employee, approver, viewer, external, and the two CEO-office **unit** roles office_coordinator/office_member (v5.61 — a scoped assistant team, distinct from the company-wide `ceo_office` oversight role; see ADR-0015). Grants are `{resource, action, scope}`, seeded into `role_permission` and cached in memory at startup (`initRbac()`).
- **Scope ladder** (`SCOPE_RANK`): company 5 › sector 4 › department 3 › project/team 2 › own 1. Row checks (`scopeReaches()`): sector compares `sector_id`; department checks the user's department **set** (own ∪ managed); project checks `projectIds`; team fails closed; own matches owner/assignee/creator columns.
- **List scoping** (`src/core/rbac/scope.js` `scopeFilter`): SQL WHERE per scope — company `1=1`, sector `sector_id=?`, project `IN(projectIds)` else `1=0`, own `ownerCol=?`, no grant `1=0`. Lists fail closed to 200-with-empty rather than 403 (design convention baked into `scripts/lib/expectations.mjs`).
- **Department-scope deferred narrowing (D15)**: department scope in lists deliberately **falls open to the whole sector** unless the query passes `opts.deptCol` — narrowing before rows are department-attributed would replace a known leak with an outage (`docs/OPEN-DECISIONS.md` D15). Row-level checks were tightened separately, creating a list-vs-row asymmetry.
- **`SECTOR_WIDE_LISTS = {'opportunity'}`** (`src/core/rbac/index.js`): patches that asymmetry for opportunities — a department-scoped user may *read* (never write) any opportunity in their own sector, so rows shown by the sector-wide list can actually be opened.
- **Additive personal grants**: `user_department_grant` (migration `025`, `src/modules/identity/grants.js`) — closed `GRANTABLE` list (currently only opportunity/read); granter needs ≥department effective scope, reach over the department, and `ownsEmployee` on the target; self-grant forbidden even for admin; loaded per-request.
- **Events grants (migration `038`)**: `event`/`event_contact`/`event_partner` are granted at **company** scope to every role except external (line_manager at department, per its standing rule) and deliberately kept out of `OPERATIONAL` so they never inherit sector/department narrowing — the exhibition is the whole company's. viewer is read-only; event create/update for sector_lead, bd_head, ceo_office (delete only sector_lead and ceo_office — bd_head never holds a delete grant); card/partner ownership (capturer or the review roles) is enforced in the service, not the matrix.
- **Sensitive fields**: `SENSITIVE_FIELDS` maps columns to gates salary/margin/cost/ip; `redact()`/`canSeeSensitive()` applied server-side in services, never in views.
- **Page policy = menu = 403**: `PAGE_ACCESS` (`src/core/policy/pages.js`) consumed by `pageAllowed()` (`src/web/nav.js`) for both menu rendering and the route guard. `seesCompanyPerformance()` requires **both** company-wide grant width (`effectiveScope` on report|kpi) **and** `user.scope === 'company'`. The finance and timesheet pages are hard-off (`() => false`) by owner decision — the views exist as dead code, but the finance data flows feed every other screen.

## 7. Deploy & runtime topology

- **Staging on Railway** — the service UUIDs below are AUTHORITATIVE and mirrored in `scripts/deploy.mjs` (guarded by `tests/security/deploy-hygiene.test.js` so they cannot drift): project `sanad-staging` `892124c7-a66e-4ac7-bd7d-e4827b3e5f40`, **app service** `sanad-staging` `6981eaef-29c1-40b1-8aca-8c606dfd44e3`, environment `production` `d654abc4-b261-476b-a11a-b1df477a55b9`, **Postgres service (never deploy to it)** `46db5bda-3de4-4189-8677-cb973769c241` (postgres-ssl:18, volume). Domains: `sanad-staging-production.up.railway.app` (port 8080) and `staging.os.evcsol.com`. **The CLI link state (`~/.railway/config.json`) is NEVER trusted** — the project name equals the app service name, so name checks lie; deploys go ONLY through `npm run deploy` (`docs/guides/DEPLOY-PIPELINE.md`, post-incident `docs/reference/INCIDENT-2026-08-11-railway-down.md`).
- **Old production `os.evcsol.com`** (Railway project `honest-spirit`) is **READ-ONLY** — the customer's live backup; never deploy to or mutate it (also enforced by `scripts/hooks/pre-guard.mjs`).
- **Image**: `Dockerfile` — node:22-slim, `npm ci --omit=dev` (no npm-install fallback: lockfile drift fails the build), non-root user, HEALTHCHECK on `/ready`. `railway.json`: DOCKERFILE builder, `startCommand: sh scripts/boot.sh`, healthcheck `/ready` timeout 300s, restart ON_FAILURE ×3.
- **Boot pipeline** (`scripts/boot.sh` — single path for staging AND prod, switched by `SANAD_SEED_DEMO`):
  1. `migrate.js` — **the only fatal step**; a failed migration aborts boot so the server never runs on a stale schema.
  2. `seed-rbac.js` → `seed-staging.js` (self-skips when `SANAD_SEED_DEMO=0`) → `seed-admin.js` (prod bootstrap admin from mandatory `SANAD_ADMIN_EMAIL`) → `seed-roles.js --apply`.
  3. One-shot data operations stamped in `schema_migration`: `reset-stage-clock.js`, `apply-owner-people.js`, `apply-owner-grants.js`, `apply-utilization-may2026.js`, `backfill-project-opportunities.js`, `backfill-legacy-activity.js`. All guarded `|| true` idempotent — boot.sh doubles as the data-operations ledger because the staging DB port is unreachable from dev.
  4. `exec node src/server.js` (PID 1 for signals). Boot takes ~2 min against the 5-min healthcheck window — trim before adding steps.
- **Prod switches** (`src/core/config.js`): `SANAD_SEED_DEMO=0` = no demo data/accounts; `assertProdSecrets()` halts boot in production on missing `SESSION_SECRET` / `DATABASE_URL` (**no escape hatch since v5.54** — the old `STAGING=1` waiver let a blank `DATABASE_URL` boot green on ephemeral SQLite; `assertProdDatabase()` now also runs at the top of `scripts/migrate.js`, before the first write) / SMTP vars / `MAIL_FROM` (no code default — the old default pointed at a domain EVC does not own) / mail allowlist. Mail fails closed: SMTP sends only to active platform accounts ∪ env allowlist (`src/core/mail/transport.js`).
- **Deploy protocol** (`CLAUDE.md`): quality green → `scripts/pg-backup.sh` if the change carries a migration/backfill → `railway up` from `platform/` → `/ready` → `scripts/sweep.mjs https://staging.os.evcsol.com` (all demo roles × pages: status vs expectations, leak scan, jargon, P95) → evidence screenshots → CHANGELOG entry. Production go-live is a separate owner-triggered runbook (`docs/guides/GO-LIVE.md`).
