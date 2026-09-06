# Verification brief — reference document vs. implementation

This file is the task brief (and the prompt to paste into a fresh Claude Code session) for verifying that **every claim in `docs/reference/sanad-reference-ar.pdf`** is correctly implemented in the Sanad platform. The PDF is the Arabic "الوثيقة المرجعية" — a 34-page reference describing the platform's screens, sectors, 16 roles, permissions, workflow, money rules, architecture, and data model.

Paste the prompt below into a new session **from the repo root (`/home/zunix/Q.view`)**.

---

## PROMPT (copy from here)

You are auditing the **Sanad (سند)** platform — EVC's Arabic-first business operating system — against its own reference document. Your job: **prove, claim by claim, whether the reference document matches the actual implementation**, and produce a rigorous confidence report. The owner wants to be 100% certain the document describes reality. Be exhaustive and adversarial; correctness matters more than speed.

The user has **explicitly authorized a large multi-agent effort** — use the **Workflow** tool and as many verification agents as the document's breadth requires (one per document section is a good baseline), plus adversarial verification for security-relevant claims and a synthesis pass. Do not cut corners to save tokens.

### 0. Orient first (read, in this order)
- `/home/zunix/Q.view/CLAUDE.md` and `/home/zunix/Q.view/platform/CLAUDE.md` — rules and conventions. **Non-negotiables: read-only against live; never mutate staging/prod; branch is `claude/evc-platform-analysis-r5nsri`.**
- `platform/docs/ARCHITECTURE.md`, `platform/docs/FEATURES.md`, `platform/docs/KNOWN-ISSUES.md`, `platform/docs/CHANGELOG.md` (recent v5.x entries), `platform/docs/adr/ADR-0005-opportunity-visibility.md`. These are the current, code-verified baseline — use them to tell **doc-drift** from **real defect**.
- The reference document: `platform/docs/reference/sanad-reference-ar.pdf`. Read it **in full** with the Read tool (it's 34 pages; read pages 1–20, then 21–34). It is Arabic and has two registers: the main text (business language) and boxed **«بلغة التقنية»** sections that state exact technical claims (function names, numbers, table counts) — those boxes are your most checkable claims.

### 1. What "verify" means
For **every checkable claim** in the document, assign one verdict with **file:line evidence** (or a live read-only query result):
- **implemented** — the code does exactly what the doc says. ✅
- **drifted** — the doc is stale vs. the current code; not a bug, but the doc (or code) has moved. State the delta and which side should change.
- **mismatch** — the doc and code genuinely disagree in a way that matters (a real bug, or a doc claim about security-relevant behavior that the code doesn't enforce). This is the highest-value output.
- **unverifiable** — couldn't confirm; say why.

Code is the source of truth for "implemented correctly." The document is the *spec-as-described*. Where they conflict, decide explicitly: **is the code wrong (fix needed, owner sign-off) or is the doc wrong (update the doc)?**

### 2. Document structure → where to look in the code
The PDF has 16 sections. Map each to code and verify:

| § | PDF pages | Claims to verify | Primary code |
|---|---|---|---|
| 01 what is Sanad | 3 | 4 principles (person-first, permission is explicit & server-side, single source per number, every write audited); stack (Node 22 + Express 5, SSR, no build step, PostgreSQL prod / SQLite dev, one codebase toggled by env) | `src/server.js`, `src/core/config.js`, `src/core/db/index.js`, `package.json` |
| 02 map (20 screens, 5 groups) | 4–5 | The exact screen list + which group each is in | `src/web/routes.js` (PAGES map), `src/web/nav.js` (NAV_ITEMS groups) |
| 03 org structure | 6–7 | **4 delivery sectors** (الحلول/SOLUTIONS, الاستشارات/CONSULTING, الاستراتيجية/STRATEGIC, SAP) + support units; delivery vs support distinction drives comparisons; layers company→sector→department→project→person | `src/core/org/kind.js` (DELIVERY_SECTOR_SQL), migration 009, `sector` table (live) |
| 04 work cycle (10 steps) | 8–9 | opportunity→proposal→won→project (no re-entry)→contract→phases/deliverables (weights)→tasks→deliver+accept→progress-claim→collection→revenue **recognized at acceptance not signing** | `src/modules/crm/opp-project-sync.js`, `src/modules/pmo/*`, `src/modules/finance/recognition.js` |
| 05 **the 16 roles** | 10–14 | Every role's نطاق (scope) and its «ما يملكه / حدوده» (what it holds / its limits) — this is the richest section. Also: the **retired «finance» role** (migration 018) with a guarding test | `src/core/rbac/matrix.js` (ROLE_GRANTS), `tests/security/finance-role-retired.test.js` |
| 06 permission model | 15–16 | 7 actions (read/create/update/delete/approve/export/admin); 6 scopes with **ranks** (company 5, sector 4, department 3, project 2, team 2, own 1); `can(user,action,resource,row)` decided **server-side, per request**, grants loaded at boot; **sensitive fields** (salary → admin only until Odoo; margin; cost; login-IP) blocked at field level | `src/core/rbac/index.js` (can, effectiveScope, SCOPE_RANK, SENSITIVE_FIELDS, redact, canSeeSensitive) |
| 07 **screen × role matrix** | 17–18 | The doc claims **every cell is computed from the platform's own open-condition**. **Regenerate the matrix from code** (same mechanism as `scripts/lib/expectations.mjs` + `PAGE_ACCESS`) for all 16 roles × the screen list, and **diff it against the PDF's tables on pages 17–18**. Report every differing cell. | `src/core/policy/pages.js` (PAGE_ACCESS), `src/web/nav.js` (pageAllowed), `scripts/lib/expectations.mjs`, `tests/security/permissions-matrix.test.js` |
| 08 accounts & login | 20–21 | one account per person carrying role+scope+sector+department; **OTP 6-digit / 10-min / single-use / 5 attempts**; **password lockout 6 wrong → 15 min**; **session 12h**; every login logged; every write in the audit log with before/after | `src/core/config.js`, `src/core/auth/service.js`, `src/core/auth/otp.js`, `src/core/audit/index.js` |
| 09 governance / approvals | 22–23 | Which resources are approved and by whom (opportunity go/nogo, proposal/price, deliverable acceptance, expense, invoice above a threshold, timesheet); amount **thresholds** pick the step; request appears only for the decider; auto-approve if below all thresholds | `src/modules/workflow/engine.js`, `src/modules/workflow/targets.js`, workflow definitions seeded in `scripts/seed.js` |
| 10 money | 24–25 | integer **halalas** everywhere; **net = trunc(gross×100÷115), vat = gross − net** (never round both sides); revenue recognized on **DELIVERED/ACCEPTED** at acceptance | `src/modules/finance/vat.js` (VAT_RATE_PCT), `src/modules/finance/recognition.js`, `src/core/util/ids.js` (toHalalas/fmtSar) |
| 11 staffing / tasks | 26–27 | allocation monthly %; utilization derived from allocation (not entered); tasks belong to project/opportunity/internal/personal; personal tasks never cross accounts | `src/modules/pmo/tasks.js`, `src/modules/org/*` (staffing), `src/modules/pmo/capacity.js` |
| 12 reports & mail | 28 | **6 report templates**; each report built **per recipient under that recipient's permissions**; mail center logs every message | `src/core/reports/engine.js` (TEMPLATES), `src/core/mail/*` |
| 13 architecture | 29–31 | 4 layers (web → modules → core → db); **import direction is one-way: core imports from nobody**; single decision point for permissions; dual DB one codebase; per-request flow (session → page gate → service scope → row check → field redaction) | `src/web`, `src/modules`, `src/core` import graph |
| 14 data model | 32 | **~76 tables in 8 families**; each table owned by one module; halalas rationale; import/export = 6 adapters with preview→diff→apply→undo | `migrations/*.sql`, `src/modules/io/adapters/*` |
| 15 quality/security/ops | 33 | test count, migration count, table count, roles auto-checked; the guard layers (permissions sweep, retired-decision tests, glossary/RTL, security tests, backup-before-migration); environments | `scripts/` gates, `tests/`, `scripts/hooks/pre-guard.mjs` |
| 16 glossary | 34 | Each term's single meaning matches how the code/UI uses it | `src/web/i18n/glossary.js` |

### 3. Live read-only data (for data-shaped claims only)
Some claims are about live data (e.g., "4 delivery sectors", "16 roles seeded", table/row counts). Read staging **read-only** — never mutate. Live access is a deliberate release action, so prefix commands with `SANAD_RELEASE=1` (the pre-guard hook blocks `railway`/staging otherwise). Recipe (run from `platform/`):
```
export RAILWAY_TOKEN=$(grep -E '^RAILWAY_TOKEN=' /home/zunix/Q.view/.env | cut -d= -f2- | tr -d '"')
export DBURL=$(SANAD_RELEASE=1 railway variables --service Postgres --environment production --json | python3 -c "import json,sys;print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])")
# then connect read-only with the pg client (require from platform/node_modules), ssl:{rejectUnauthorized:false}, SELECT only.
```
Prefer the CODE as the authority for behavior; use live only to confirm seeded data shapes. **Never** run any mutating query, `railway up/run` that writes, or anything touching the legacy `honest-spirit` project.

### 4. Known pointers — VERIFY these, do not assume
These are things a prior session suspected. Treat each as a hypothesis to confirm with evidence, not a conclusion:
- **Counts drift**: doc says «20 migrations», «76 tables», «122 test files». Actual today: **29 migration files**, **170 test/spec files** (≈1525 test *cases* — don't conflate files vs cases), table count TBD. Confirm each; classify as drift and recommend doc updates.
- **Finance screen (highest priority)**: code has `PAGE_ACCESS.finance = () => false` and `timesheet = () => false` (`src/core/policy/pages.js:57,75`), yet the PDF lists **المالية والعقود** as a live screen (p4), shows a **screenshot** of it (p25), and includes it in the screen×role matrix (p18). Determine the truth precisely: is the finance page actually reachable by anyone today, or is the doc presenting a disabled screen as live? (Note timesheet/سجل الوقت is *not* in the doc's screen list — consistent with it being off.) This is the #1 discrepancy to resolve.
- **Opportunity visibility (v5.2/v5.5) & delete (v5.6)**: bd_manager opportunity read/update narrowed to `own`, create `sector`; department managers see their department + partner + orphan (unattributed) opportunities in their sector; opportunity **delete** grants are department_manager(department)/sector_lead(sector)/bd_manager(own) + row creator + admin. Check whether the doc's role descriptions (p12) and matrix reflect this or an earlier state.
- **Layering claim**: the doc says «the core imports from nobody» (p30). A prior review found real violations — `src/core/ai/*` imports from `src/modules/pmo`, and `src/core/reports/*` imports from `src/modules/{workflow,crm}`. Confirm and flag as a doc inaccuracy (aspirational).
- **Support sectors**: doc names 2 support units (تطوير الأعمال/BIZDEV, الخدمات المشتركة/SHARED); live shows a 3rd support sector (FINANCE, tied to the retired finance role). Confirm.
- **Approvals coverage**: doc lists the approval targets on p22. The platform also has **task approvals** (migration 028, v5.0) and **staffing confirmations** — check whether the doc mentions them (likely omitted → drift).
- **Salary sealed**: verify no role holds a `salary` grant (admin wildcard only).

### 5. Method (use the Workflow tool)
Run a verification workflow, e.g.:
- **Phase Verify** — one agent per document section (or per table row above), each: reads the relevant PDF pages + the relevant code (+ live read-only if data-shaped), returns a structured list of `{claim, verdict, evidence(file:line or query), note}` and a section summary. Give each agent the exact claims to check (transcribe the specific numbers/names from the PDF pages it owns).
- **Adversarial verify** — for security-relevant claims (the screen×role matrix, sensitive-field blocking, delete/approve grants, "server-side only" decisions), a second agent independently tries to **refute** the "implemented" verdict (find a role/scope/route where the doc's promise doesn't hold). A claim only stays "implemented" if the skeptic can't break it.
- **Completeness critic** — an agent that re-reads the PDF and lists any claim no verifier covered.
- **Synthesis** — merge into the report.

Prefer `pipeline()` so each section verifies as soon as its read completes. Return raw structured data from agents (use schemas), not prose.

### 6. Output
Write `platform/docs/reference/VERIFICATION-REPORT-2026-08-09.md` (use today's date) containing:
1. **Overall confidence** — one line + a short paragraph.
2. **Section scorecard** — a table: § | area | claims checked | implemented | drifted | mismatch | notes.
3. **Confirmed correct** — the load-bearing claims proven implemented (with evidence), grouped by section.
4. **Drift** — doc-stale items, each with the exact delta and the recommended fix (update the PDF, or the code) — e.g., migration/table/test counts, omitted approval flows, support-sector count.
5. **Mismatches (ranked)** — genuine disagreements, each: what the doc claims, what the code does, file:line, whether it's a **code bug** or a **doc error**, severity, and recommended action. The finance-screen question goes here with a definitive answer.
6. For any genuine **code bug**, add a `KI-###` row to `platform/docs/KNOWN-ISSUES.md` (the triage queue; per the docs contract the fixing commit later removes it + adds a regression test).

Then report to the user: the overall confidence verdict, the mismatch list, and the top drift items — concisely.

### 7. Guardrails
- **Read-only verification.** Do NOT change product code to "fix" things during this audit. Report first; behavior changes need owner sign-off, and many "mismatches" will just be doc updates.
- Live DB: SELECT only, `SANAD_RELEASE=1` for the read recipe, never mutate, never touch `honest-spirit`.
- Stay on branch `claude/evc-platform-analysis-r5nsri`. Commit only the report + any KNOWN-ISSUES rows if the user asks; otherwise leave the working tree for their review.
- The PDF screenshots use demo data (names/numbers not real) — verify *behavior and structure*, not the specific demo values.

## END PROMPT
