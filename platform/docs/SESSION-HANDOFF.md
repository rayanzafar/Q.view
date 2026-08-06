# Session Handoff — Security/Reliability Audit & Remediation (2026-08-05)

> Continuation brief for picking up this work in a **new Claude Code / engineering session on another machine**.
> Read this end-to-end, then read `platform/CLAUDE.md` (root) and `platform/platform/CLAUDE.md`… i.e. `/CLAUDE.md` + `/platform/CLAUDE.md` for the engineering conventions. Everything below is current as of the last commit on branch `claude/tool-issues-audit-qtq4a6`.

---

## 0. TL;DR — where things stand

- A full security/correctness/reliability **audit** of the Sanad platform was done, and the **top issues were fixed** across 5 commits on branch **`claude/tool-issues-audit-qtq4a6`** → **PR #3** (https://github.com/rayanzafar/Q.view/pull/3).
- **Tests:** full suite **green — 1430 pass / 0 fail** (was 1410 baseline + 20 new regression tests).
- **Independent security review** of the diff: **clean** (no new vulnerabilities/regressions).
- **Deployed to Railway staging** and **verified live** (deploy SUCCESS, healthcheck passed, 0 runtime errors; functional sweep of the 7 loginable demo roles = 0 leaks / 0 jargon / 0 authz deviations, P95 263ms).
- **Nothing is broken.** Remaining items are either owner-only (a guard-hook-blocked `.env.example` edit) or deliberately deferred (see §7). Ready for PR review / merge whenever the owner decides.

**How to resume:** `git fetch && git checkout claude/tool-issues-audit-qtq4a6`, then `cd platform && npm install && node --experimental-sqlite --test "tests/**/*.test.js"` to confirm green, then continue from §7 (open items).

---

## 1. What Sanad (سند) is

Sanad is **EVC's internal Arabic-first "business operating system"** (نظام تشغيل الأعمال) for the consulting firm رؤية الخبراء الاستشارية (EVC). One platform to run the whole operation: **sales pipeline → won opportunities → projects → delivery → revenue → people/capacity**, with executive dashboards on top. Core product bet: **revenue follows delivery** (recognized from delivered work), so sales/project/finance numbers reconcile to one truth.

Capability areas (~21 pages / 26 APIs, 16 roles):
- **CRM/Sales** — opportunities pipeline (stages, solicitation types RFI/RFP/RFQ/direct/tender), weighted pipeline, opportunity teams & documents.
- **PMO/Projects** — portfolio, kanban, tasks, milestones, deliverables, progress, per-project money view.
- **People/Org** — org tree (company→sector→department→unit→team→employee), staffing/capacity, utilization, timesheets, employee lifecycle.
- **Clients** — client-360, relationship status, merge/unmerge.
- **Executive** — CEO dashboard (company + per-sector), portfolio health, sector command centers.
- **Finance data** — contracts, invoices, progress claims (مستخلصات), collections, revenue, VAT split. **The finance _page_ is intentionally disabled** (`src/core/policy/pages.js` → `finance: () => false`); data still flows and feeds every screen.
- **Reports & Mail** — weekly/monthly/quarterly reports + scheduled email; mail center (preview/queue/log).
- **Governance** — approval-workflow engine (multi-step, role + amount thresholds); full audit log on every write.
- **Identity & Access** — 16 roles, field-level redaction of sensitive fields (salary/cost/margin/IP), invitations, OTP-by-email login (+ password fallback).
- **Data & AI** — import/export with preview + undo; AI assistant (heuristic by default; optional Claude/OpenAI; only redacted context; governed + audited).

Stack: **Node 22 + Express 5, SSR (template-literal HTML), zero build step**, dual DB (**embedded SQLite in dev/tests, Postgres in staging/prod**), money as **integer halalas** (never floats), soft-delete everywhere, `audit()` on every mutation, Arabic-only UI enforced by a glossary + jargon gate.

---

## 2. Repo / branch / PR state

- **Repo:** `rayanzafar/Q.view` (the product is in `platform/`; the repo name is incidental — unrelated to "Q-View smart glasses").
- **Working branch:** `claude/tool-issues-audit-qtq4a6` (base: `main`). **Do all continuation work on this branch** (branch-discipline rule from the task setup).
- **PR:** **#3** — future pushes to the branch update it automatically. Do **not** open a new PR for follow-ups on this branch.
- **Commits on the branch** (on top of base `4685c20`):
  - `d0f8b08` — Batch A: template XSS/injection escaping (title/subtitle/color/id).
  - `77e9be7` — Batch B: write-response & scope leaks (salary redact, password_hash strip, change-password hardening, scoped revenue, trust-proxy, tx() wrapping, NaN money, IDOR guards, login enumeration, risk deleted_at).
  - `9f31d1b` — Batch C: deploy hardening (boot.sh fatal migrate, dockerignore/railwayignore secrets, npm ci, /ready leak, backfill log, pretest, GO-LIVE doc).
  - `bf5367a` — Batch D: UX (dead finance links, notification badge, provider-name leak, audit-detail keys, login CSS vars + a11y labels).
  - `a800d86` — defense-in-depth: escape last 2 `sector=` href sinks.
- **Stale PR #2** (`claude/resend-domain-verification-7cy98a`) is fully superseded (contained in the main dev branch) — should be closed.

**Two dev branches exist** (`claude/evc-platform-analysis-r5nsri` is the prior main dev branch; `claude/tool-issues-audit-qtq4a6` is ours). Root `CLAUDE.md` mentions a different branch for its own workflow — **for THIS work, use `claude/tool-issues-audit-qtq4a6`.**

---

## 3. What was done this session (the 4 fix batches)

Every fix has a regression test. New test files: `tests/security/xss-and-injection.test.js`, `tests/security/write-response-and-scope.test.js`, `tests/security/deploy-hygiene.test.js`, plus an update to `tests/security/login-lock-temporary.test.js`.

### Batch A — XSS & injection (commit d0f8b08)
- **`layout()` now escapes `title`/`subtitle` at the sink** (`src/web/layout.js`), and the ~13 callers that wrapped those fields in `esc()` had it removed to avoid double-escaping. Fixes stored XSS via person display name (`pmo.js` personPage) and others.
- **Sector `color`/`id` validated on write** (`src/modules/org/org.js` `createSector`/`updateSector`: hex regex `^#[0-9a-fA-F]{3,8}$`, id regex `^[A-Za-z0-9_-]{1,40}$`, + `normTargetHalalas`) **and escaped at render** across `exec.js`, `sector.js`, `crm.js`, `pmo.js`, `layout.js` hbars.
- **`?sector=` reflected XSS** fixed (`people.js` — added `.replace(/</g,'\\u003c')` in the JSON-in-`<script>` blocks).
- **`?year=abc` NaN** fixed (`crm.js` → `Number(opts.year) || fiscalYear`).
- **Mail preview iframe sandboxed** (`mail.js` `sandbox=""` + `routes.js` CSP `sandbox` header on `/app/mail/preview/:file`).

### Batch B — Backend data exposure & integrity (commit 77e9be7)
- **Salary redacted on employee write responses** — `org.js` create/move/update employee return `redact(ctx.user,'employee',row)`.
- **`password_hash`/`failed_attempts`/`locked_until` stripped** from `GET /api/identity/users` (`identity.js` `listUsers`; added `is_locked` boolean as a safe signal).
- **`change-password` hardened** (`core/auth/service.js` + `auth.routes.js`): requires + verifies current password, `audit()`, revokes other sessions (keeps current).
- **`scopedRevenue` scope fixed** (`finance/finance.js`): uses `effectiveScope` — company→all, sector/department→sector, project/team/own→`1=0` (no more whole-sector leak to PMs).
- **`trust proxy: 1`** (`server.js`) — real client IP (confirmed live in Railway http logs), restores rate-limit + honest audit IPs.
- **`tx()` wrapping** for multi-write ops: `createProgressClaim`/`recordCollection` (finance), `actOnApproval` (workflow), `addEntry`/`submitPeriod` (timesheets), `setOpportunityDepartments` delete+reinsert (opportunities). Audit moved inside the tx; `notify()` calls awaited (best-effort `.catch` in `oppteam.js`).
- **Money input validated** — `valueHalalasFrom` (opportunities) + `normTargetHalalas` (org) reject non-numeric (NaN) with Arabic errors.
- **IDOR guards** — `/projects/:id/kpis` and both `/removal-check` routes now call `getProject`/`getOpportunity` first (`api.routes.js`); `unmergeClient` scope-checked via `getVisibleClient(merged_into,'update')` (clients scoped by footprint/created_by, NOT sector — see note below).
- **`risk` reads** add `deleted_at IS NULL` (`reports/engine.js`, `reports/metrics.js`, `ai/assistant.js`).
- **Login enumeration** fixed (`core/auth/service.js`): lock checked before password verify (avoids re-lock), `inactive`/`locked` reasons revealed only after a correct password; failed-attempt counter made explicit (`count:false` during lock). The `login-lock-temporary.test.js` reason assertions were updated to match this improved behavior (the test's core guarantee — a lock never renews/moves the counter — is preserved).

> **Note for future work:** `client` table has **no `sector_id`** — clients are scoped by `created_by` + opportunity/project/contract footprint via `clientScopeClause`/`getVisibleClient` in `clients.js`. Don't use `can(user,…,'client',row)` sector-style checks on clients.

### Batch C — Deploy & reliability (commit 9f31d1b)
- **`scripts/boot.sh`** — migration failure is now **fatal** (`migrate.js || { echo …; exit 1; }`); other seed steps stay guarded. Comment corrected to name `SANAD_ADMIN_EMAIL` as the required admin var.
- **`.dockerignore`** now excludes `.env`, `seed/*.snapshot.json`, `seed/*.backfill.json`, `data/migration-reconciliation.json` (keeps `seed/*.demo.json` — needed for the `railway up` staging seed).
- **`.railwayignore`** switched to globs (`seed/*.snapshot.json`) + added `seed/*.backfill.json`.
- **`npm ci || npm install` fallback removed** in `Dockerfile`, `.github/workflows/ci.yml`, `deploy/deploy-staging.sh` (+ deploy-staging now runs migrations).
- **`/ready`** no longer leaks `e.message` (`server.js` — logs server-side, returns generic body).
- **`backfill-legacy-activity.js`** — missing snapshot now logs at **info + exit 0** (was error+exit 1 → boot-log noise).
- **`scripts/check-deps.mjs` + `pretest`** npm hook — fails fast with a clear message if `express` isn't installed (so a missing `npm install` isn't reported as ~178 fake business failures).
- **`docs/guides/GO-LIVE.md`** — corrected the admin env-var table (`SANAD_ADMIN_EMAIL` is required = login identity; PASS/USER optional) and the post-boot verification steps.

### Batch D — UX/correctness (commit bf5367a)
- **Dead finance links removed/de-linked** — `sector.js` (المالية والعقود button + contract row link), `pmo.js` (أصدِر المستخلص → in-page `#sec-money` = "افتح صورة المال"), `clients.js` (contract rows). (Finance page is disabled → those all 403'd.)
- **Notification badge fixed** (`app.js` + `layout.js`) — was hidden by inline `display:none` while code toggled a `.hidden` class it never had; now shows the count, un-hides via inline style, adds `aria-label`.
- **AI provider name leak** (`app.js`) — dropped `anthropic`/`openai` from the Arabic label.
- **Audit-detail rendering** (`govern.js`) — Arabic key map, skips null/empty, drops unknown English keys (no literal `null`, no jargon).
- **Login screen** (`auth.js`) — defines `--fs-*` CSS vars locally (were undefined → wrong font sizes), associates `<label for>`/`<input id>`, adds `role="alert"` to error/note, removes stale "والمالية" copy.

---

## 4. Deploy state + how to deploy

- **Deployed to Railway staging on 2026-08-05** by the owner via `railway up` from their Mac. Deploy `0c546865-…` = **SUCCESS**, healthcheck passed, server running (`✓ سند running at http://:::8080 env=production`). 0 runtime errors; live sweep clean for 7 roles.
- **This sandbox CANNOT deploy**: org egress policy blocks `backboard.railway.com:443` (403 on CONNECT — do not route around). The Railway CLI + a valid token don't help from here. **`railway up` must run from a networked machine.** The Railway **MCP** (list-deployments / get-status / get-logs) *does* work from here for **read-only verification**.

**Railway coordinates:**
- Project `sanad-staging` = `892124c7-a66e-4ac7-bd7d-e4827b3e5f40`
- Service `sanad-staging` = `6981eaef-29c1-40b1-8aca-8c606dfd44e3`
- Environment `production` = `d654abc4-b261-476b-a11a-b1df477a55b9`
- Postgres service = `46db5bda-3de4-4189-8677-cb973769c241` (image `postgres-ssl:18`, has a volume)
- Domains: service `sanad-staging-production.up.railway.app` (port 8080) + custom `staging.os.evcsol.com`
- **Old production `honest-spirit`** (`fcd0a4b8-…`) is **READ-ONLY** — never deploy/mutate it.

**Deploy runbook (from a networked machine, e.g. macOS Apple Silicon):**
```bash
brew install node git && npm install -g @railway/cli   # or: brew install railway
git clone -b claude/tool-issues-audit-qtq4a6 https://github.com/rayanzafar/Q.view.git && cd Q.view/platform
export RAILWAY_TOKEN=<sanad-staging project token>       # project token auto-scopes the CLI
railway up --service sanad-staging                       # wait for "Healthcheck succeeded" (~2 min slow boot)
curl -s https://staging.os.evcsol.com/ready              # {"ready":true}
node scripts/sweep.mjs https://staging.os.evcsol.com     # role-by-role sweep (pure Node, no npm install)
```
No pg-backup needed for the current diff (no schema migration). If a future change adds a `migrations/*.sql`, run `scripts/pg-backup.sh` first per CLAUDE.md.

**Live-sweep caveat:** on staging `SANAD_SEED_DEMO=0`, so **9 of 16 demo accounts can't log in** (`demo.admin/ceo/sectorlead/bd/pm/hr/consultant/employee/viewer` → 302 `/login?e=1`). This is a **pre-existing account-availability gap, NOT a code regression** (the 7 seeded role accounts logged in fine through the same code; the diff has no migration and demo-seeding was off, so account state was unchanged). Those 9 roles' authz is still covered by `tests/security/permissions-matrix.test.js`. To live-sweep all 16 you'd need those accounts loginable (e.g. a throwaway `SANAD_SEED_DEMO=1` deploy — but that pollutes the production-like staging with demo data; generally not worth it).

---

## 5. Environment / config facts

Service env-var **names** present on `sanad-staging` (values NOT reproduced here — set in Railway): `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV`, `PORT`, `STAGING`, `SANAD_SEED_DEMO` (=0 on staging), `SANAD_ADMIN_EMAIL`, `SANAD_ADMIN_USER`, `SANAD_ADMIN_FORCE`, `SANAD_ADMIN_PASS`, `SANAD_AUTH_PASSWORD`, `SANAD_BACKUP_TOKEN`, `SANAD_MAIL_ALLOWLIST`, `SANAD_MAIL_UNRESTRICTED`, `MAIL_FROM`, `MAIL_TRANSPORT`, `SMTP_HOST/PORT/USER/PASS`.

Config logic worth knowing (`src/core/config.js`): prod binds `::` (IPv6, for Railway healthcheck) unless `HOST` overrides; `MAIL_FROM` has **no code default** (assertProdSecrets requires it — `evc.com.sa` is a live third-party domain, an OTP-leak hazard); DB switches to Postgres when `DATABASE_URL` set, else SQLite (`STAGING=1` can force SQLite-in-prod → data-loss risk without a volume).

Demo login (already public in repo): usernames `demo.<role>`, password `Sanad@2026`.

---

## 6. Conventions to respect (from CLAUDE.md — don't violate)

- **Money = integer halalas** via `toHalalas`/`toSar`/`fmtSar` (never floats/strings). IDs via `id('prefix')`; time via `nowIso()`.
- **Soft delete**: set `deleted_at = nowIso()`; every read filters `deleted_at IS NULL`.
- **DB access only via `src/core/db/index.js`** (`all/get/run/exec/tx/insert/update`), always `?` placeholders (auto-rewritten to `$n` on PG). Portable SQL subset (no `strftime`/`date('now')`, strict GROUP BY, booleans as 0/1, `CAST(? AS TEXT)` for bare `? IS NULL`, sub-SELECT in FROM needs an alias).
- **Migrations** in `migrations/*.sql` are **immutable once deployed** (001–027 exist). New schema = new numbered file. A `pre-guard` hook blocks editing 00N migrations.
- **RBAC**: `can(user,action,resource,row?)` from `core/rbac/index.js`; sensitive fields via `redact`/`canSeeSensitive` (salary/cost/margin/ip) — check server-side. Every write calls `audit(ctx,…)`. Wrap multi-write ops in `tx()`.
- **Errors**: `badRequest('عربي واضح')`/`forbidden()`/`notFound()` from `core/http/errors.js`.
- **UI is Arabic-only, no jargon** (`src/web/i18n/glossary.js`); banned in user-visible strings: API/Schema/Entity/Adapter/Queue/Worker/Transaction/JSON/DB/null/undefined/NaN/"ID:". Escape all dynamic text with `esc()`; numbers use `.tnum`. `app.js` is frozen except bug fixes; new interactivity via `data-action` delegation.
- **A `pre-guard` hook** (`scripts/hooks/pre-guard.mjs`) blocks editing/committing secret files (`.env*`, `seed/*.{snapshot,demo}.json`, `data/backups/`) and deployed migrations, and blocks `git add`/`commit` commands whose text contains a bare ` .env ` token — reword commit messages to avoid it. **Never work around the hook.**
- **Never touch old prod `honest-spirit`.** Staging deploys via `railway up` from `platform/`.
- Quality gates: `npm run quality` (syntax + glossary + tests + e2e); `scripts/sweep.mjs <url>` post-deploy. Repo review agents: `/review-security`, `/review-arabic`, `/review-accessibility`, `/test-permissions`, `/test-rtl`.

---

## 7. Open items / next steps (nothing blocks the PR)

**Owner-only (I was blocked by the guard hook):**
- `platform/.env.example` — (1) remove the `MAIL_FROM=Sanad Platform <no-reply@evc.com.sa>` default (live third-party domain, OTP-leak hazard); (2) drop or comment out `HOST=0.0.0.0` (overrides the prod `::` bind → breaks Railway IPv6 healthcheck if copied). The **code** already guards MAIL_FROM (no default + assertProdSecrets); this is just the template devs copy.

**Deferred (documented, larger or product decisions — see the full findings in §8 / the plan file):**
- CSP flip to enforcing + remove the 38 inline `on*` handlers (blocked by one inline `onclick` at `app.js:376`).
- `must_change_pw` enforcement middleware (currently stored but never enforced; `seed-admin.js` writes 0).
- CSRF token on all JSON mutations (today only urlencoded is covered; SameSite=Lax is the residual defense).
- Durable/scheduled/offsite **Postgres backups** (`pg-backup.sh` writes to ephemeral container storage). Needs an owner decision on destination.
- **Boot time ~2m** (sequential seed steps) creeping toward the 5-min healthcheck window — trim if adding boot steps.
- The **9 demo accounts** not loginable on staging (see §4) — decide whether to reactivate for full live sweeps.
- Multi-replica-safe scheduler + rate limiter (only matters if scaling >1 replica); repo bloat (128MB evidence screenshots in git history); close stale **PR #2**.
- Product decisions in `docs/OPEN-DECISIONS.md` (D15 department-scope-fails-open, D16 no effective-dating, D17 unused `line_manager_id`) — surface to owner, don't unilaterally change.

---

## 8. Full ranked findings reference (FIXED vs DEFERRED)

Source of truth for the complete list (with file:line and rationale) is the audit. Summary by area:

**Backend HIGH — all FIXED:** salary redact on writes · password_hash strip · money-write tx() · trust-proxy · change-password hardening · scopedRevenue scope.
**Backend MEDIUM:** FIXED — IDOR routes (kpis/removal-check) · toHalalas NaN · multi-write tx() (approval/timesheets/opp-depts) · un-awaited notify() · risk deleted_at · unmergeClient scope · login enumeration. DEFERRED — CSP enforce (#15); PG-portability `FROM (subquery)` alias (#7, latent — PG18 live so not a crash today, low priority).
**Frontend CRITICAL/HIGH — all FIXED:** layout title/subtitle escape (C1/C4/C5) · sector color/id validate+escape (C2) · `?sector=` reflected (C3) · `?year` NaN (J1) · dead finance links (N1) · login `--fs` vars (R1) · failed-toast undefined (J2) · login label association (A1).
**Frontend MEDIUM:** FIXED — badge (B1) · provider-name (J3) · audit keys (J4) · mail iframe sandbox (C9). DEFERRED — CSRF-on-JSON (F1) · inline handlers (H1) · `noticeCard`/`pill`/`statMini` unescaped-by-default (C6/C7/C8, latent) · a11y (A3–A6, B3/B4) · mail bidi (R2).
**Infra CRITICAL/HIGH — all FIXED:** boot.sh fatal migrate · GO-LIVE admin env-var doc · dockerignore/railwayignore secrets · npm ci fallback · /ready leak · test dep preflight · boot error-noise. DEFERRED — durable backups · must_change_pw enforcement · deploy-staging.service crash-loop (bare-metal path, unused vs Railway).
**Infra MEDIUM/LOW:** mostly DEFERRED/documented — migrate.js non-atomic-on-SQLite · PGSSL rejectUnauthorized:false · no railway.json volume · single-process scheduler/limiter · body-size mismatch (1mb/15mb/12m) · `src/modules/search/*` zero coverage · CHANGELOG open defects (:45 portfolio scope, :305 seed-roles crash under demo-seed) · unhandledRejection continues · keep-alive sockets on shutdown · repo bloat.
**Confirmed solid (don't "fix"):** parameterized-query discipline (no SQLi found) · tx() nesting · expenses.js/governance.js as reference guard→validate→tx · grants model · io preview/undo · report-lens guards · drill-down template pattern · pages/*.js api() r.ok discipline.

---

## 9. Quick verification checklist for the next session

```bash
git fetch && git checkout claude/tool-issues-audit-qtq4a6
cd platform && npm install
node --experimental-sqlite --test "tests/**/*.test.js"   # expect 1430 pass / 0 fail
node scripts/check-glossary.mjs                            # expect clean
# deploy verification (read-only) via Railway MCP: list-deployments / get-status / get-logs on the IDs in §4
# full deploy + sweep: see §4 runbook (needs a networked machine + RAILWAY_TOKEN)
```

_Handoff authored at the end of the 2026-08-05 session. Branch `claude/tool-issues-audit-qtq4a6`, PR #3._
