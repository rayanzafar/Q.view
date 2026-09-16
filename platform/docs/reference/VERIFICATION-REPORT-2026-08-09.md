# Verification Report — `sanad-reference-ar.pdf` vs. the implementation

**Date:** 2026-08-09 · **Branch:** `claude/evc-platform-analysis-r5nsri` · **Method:** read-only audit (no product code changed). Document = spec-as-described; **code is the source of truth for behavior.** Live staging Postgres was read **SELECT-only** for data-shaped claims. 202 checkable claims were verified by a multi-agent pass (17 section verifiers + adversarial refuters on every security-relevant claim + 2 completeness critics + gap-fill), then the load-bearing and highest-risk findings were re-verified by hand. Paths are relative to `platform/`.

---

## 1. Overall confidence

**The document is a largely faithful, high-fidelity description of the platform's *model* — but it is not 100% accurate about the platform *as it runs today*, so the owner should not treat every claim as current reality without the corrections below.**

Where the document describes the **security and data model**, it is strikingly accurate: the four principles, the 16 roles, the 7-action × 6-scope grant model with numeric ranks (`company 5 … own 1`), the four sensitive fields sealed at field level, the halalas/VAT math, the OTP/lockout/session parameters, revenue-on-acceptance, and "every decision is made server-side per request" are all implemented as written, with file-level evidence. That is the hard part and it holds.

The inaccuracies cluster in five places: (1) the document **presents a screen that is switched off (المالية والعقود) as if it were live** — this is the single most important discrepancy, and the answer is definitive below; (2) its **self-reported counts** (122 test files, 20 migrations, 76 tables) are stale; (3) its **role descriptions predate the v5.2–v5.6 opportunity-visibility and delete changes**; (4) its **architecture claim "the core imports from nobody" is aspirational** — there are 13 real violations; and (5) several **governance/audit/reporting promises overstate what the code enforces** (the amount-threshold approval workflow is dormant scaffolding for 5 of 6 resources, the audit log records the change but not "value before and after", proposals cannot actually be built). Separately, one **live-data defect** was found: the retired `finance` role still exists on staging with 40 privileged grants.

Tally: **142 implemented · 36 drifted · 23 mismatch · 1 unverifiable** (of 202 claims). Of the 23 mismatches, most are **doc over-claims** (the doc is stricter/more absolute than the code); **two are genuine code/ops defects** (finance-role live drift; the approval-queue sector filter) and are filed as `KI-031`…`KI-033`.

---

## 2. Section scorecard

| § | Area | Claims | Implemented | Drifted | Mismatch | Notes |
|---|------|:---:|:---:|:---:|:---:|-------|
| 01 | What is Sanad (principles, stack) | 13 | 12 | 1 | 0 | Only drift: "20 screens" (finance is off → 19 open) |
| 02 | Map (20 screens / 5 groups) | 6 | 4 | 2 | 0 | `finance` listed as live but gated off for everyone |
| 03 | Org structure (4 sectors + support) | 7 | 6 | 1 | 0 | Doc omits the 3rd support sector **FINANCE** (live) |
| 04 | Work cycle (10 steps) | 12 | 6 | 5 | 1 | Proposal step not buildable (mismatch); claim/collection lost their screen (drift) |
| 05a | Roles 1–8 | 39 | 30 | 8 | 1 | Opportunity read/delete text stale (v5.2–5.6); finance-role revival (mismatch) |
| 05b | Roles 9–16 + retired finance | 21 | 17 | 1 | 3 | Finance-role live drift; procurement opens sector page; HR delete narrower than doc |
| 06 | Permission model | 9 | 6 | 2 | 1 | Model exact; "admin edits grants without redeploy" not implemented; finance-grant leak |
| 07 | Screen × role matrix | 7 | 4 | 3 | 0 | **7 differing cells** (4 finance-column + 3 bd_manager widening) |
| 08 | Accounts & login | 9 | 6 | 1 | 2 | OTP/lockout/session exact; "before/after" and "every failed login" over-claimed |
| 09 | Governance / approvals | 10 | 3 | 2 | 5 | Approver table wrong vs seeded chains; threshold workflow dormant |
| 10 | Money (halalas / VAT / recognition) | 7 | 4 | 3 | 0 | Math exact; revenue line created on DELIVERED (not only ACCEPTED); VAT formula copied |
| 11 | Staffing / tasks | 8 | 7 | 1 | 0 | Utilization derived correctly; task auto-count now gated by approval |
| 12 | Reports & mail | 6 | 1 | 3 | 2 | 6 templates exact; per-recipient build real; no send-time recheck; two stale template cells |
| 13 | Architecture (4 layers) | 7 | 2 | 0 | 5 | "Core imports from nobody" false (13 violations); web reads DB directly |
| 14 | Data model (~76 tables) | 4 | 3 | 1 | 0 | 78 live tables (doc 76); io = exactly 6 adapters ✓ |
| 15 | Quality/security/ops | 9 | 7 | 1 | 1 | Counts stale (161 files / 29 migrations / 78 tables); finance-role guard has a blind spot |
| 16 | Glossary | 20 | 17 | 0 | 2 | Terms accurate; مرحلة-weight and مستخلص-precondition mis-stated |
| — | Gap-fill (critic-found) | 8 | 7 | 1 | 0 | Screenshot structures, occupancy thresholds, audit screen — all implemented |
| | **Total** | **202** | **142** | **36** | **23** | +1 unverifiable (screenshots' provenance) |

---

## 3. Confirmed correct (load-bearing claims, with evidence)

**§01 Principles & stack.** Node 22 + Express 5, SSR, no build step (`package.json:7-9,28`; `src/server.js`; no build script). One codebase, dual driver switched by `DATABASE_URL` (`src/core/db/index.js:1-10`, `USE_PG = !!config.databaseUrl`) — live staging confirmed on Postgres. «الشخص أولاً»: every user lands on `home` (`src/web/routes.js:117-125`; `pages.js:43 home: () => true`) which aggregates the user's own tasks/opportunities/projects (`src/modules/home/home.js:131-226`). «الصلاحية قرار صريح»: `can()` is "the ONLY place authorization is decided, server-side, always" (`src/core/rbac/index.js:1,89-113`). «كل تغيير له أثر»: `audit()` on writes across ~30 module files (`src/core/audit/index.js:5-19`). Arabic-only UI with a banned-jargon gate (`src/web/i18n/glossary.js`; `scripts/check-glossary.mjs`) and Latin digits (`src/core/util/ids.js:17` `ar-SA-u-nu-latn`).

**§03 Org.** 4 delivery sectors + support units, `DELIVERY_SECTOR_SQL` (`src/core/org/kind.js:20-31`); live has exactly SOLUTIONS/CONSULTING/STRATEGIC/SAP as `kind='delivery'`.

**§05 The 16 roles.** `ROLE_GRANTS` has exactly 16 role keys with the documented English identifiers (admin, ceo_office, sector_lead, department_manager, line_manager, project_manager, bd_manager, bd_head, procurement, hr, operations, consultant, employee, approver, viewer, external) — `src/core/rbac/matrix.js:28-341`. The retired `finance` role is correctly absent from the matrix (`matrix.js:266` comment), and the migration that retired it moves holders→viewer and reroutes its approval steps→ceo_office (`migrations/018_retire_finance_role.sql:29,38,50-51`). Salary is sealed platform-wide — **no role holds a `salary` grant** (`matrix.js:279` note; live `role_permission` has 0 salary grants).

**§06 Permission model.** 7 actions and 6 scopes with the exact numeric ranks the doc states: `SCOPE_RANK = { company: 5, sector: 4, department: 3, project: 2, team: 2, own: 1 }` (`src/core/rbac/matrix.js:366`). Four sensitive fields blocked at field level — salary, margin, cost, login-IP — via `SENSITIVE_FIELDS` + `canSeeSensitive`/`redact` (`matrix.js:8-17`; `rbac/index.js:207-225`), with the exact viewer tiers the doc lists (ceo_office/bd_head at company; sector_lead/department_manager at sector). Grants load once at boot (`initRbac`) and are re-read by `reloadGrants()` after edits (`rbac/index.js:10,34`).

**§08 Accounts & login.** OTP is 6 digits, 10-minute validity, single-use, 5-attempt cap on the code (`src/core/auth/otp.js:22-24,102-108`). Password lockout is **6 failed attempts → 15 minutes** exactly as the doc states (`src/core/config.js:26-27`). Session is 12h server-side with a secure cookie (`config.js:20-22`; `src/core/http/context.js:14`). Deactivated accounts persist in the record and are blocked from login (`migrations/016_user_deactivated_at.sql`).

**§10 Money.** Integer halalas everywhere (`src/core/util/ids.js` `toHalalas/fmtSar`; money columns `*_halalas INTEGER`). VAT is `net = trunc(gross×100÷115)`, `vat = gross − net` — computed once, truncating (not rounding both sides), so `net+vat=gross` per row: `src/modules/finance/vat.js:24-30` (`VAT_RATE_PCT=15`, `SCALE=115`, `netOfGross = Math.trunc(gross*100/SCALE)`). Revenue is recognized on delivery/acceptance, not signing: `src/modules/finance/recognition.js:30` `RECOGNIZING_STATUSES = ['DELIVERED','ACCEPTED']`, stamped at `accepted_at||delivered_at` (`recognition.js:43`).

**§11 Staffing.** Monthly-% allocation model; utilization is **derived** from allocations/time, not entered (`src/core/reports/metrics.js:179-198`); occupancy-health thresholds >110%/<70% exactly (`src/modules/org/org.js:678`). Personal tasks never cross accounts (`notPersonalSql`; `migrations/029_task_category.sql`).

**§12 Reports.** Exactly **6 templates** (`src/core/mail/templates.js:204`; keys weekly_exec_brief, sector_weekly_status, monthly_sector_performance, project_status_report, workforce_utilization, opportunity_pipeline) — matches live `report_definitions` (6 rows). Each report is **built per recipient under that recipient's own resolved permissions** at build time (`src/core/reports/engine.js:118-135` `enqueueReport` → `resolveUser(sessionlessUser(uid))` → `buildReport`). Mail center logs every outbound message (`email_queue`/`email_log`).

**§16 Glossary.** 16 of 18 terms match code/UI usage exactly, including deliverable states DRAFT/IN_PROGRESS/DELIVERED/ACCEPTED/REJECTED ↔ مسودة/جارٍ العمل/تم التسليم/تم الاعتماد/مُعاد للتعديل (`src/modules/pmo/governance.js:36,42`).

---

## 4. Drift (doc stale vs. current code — recommended fix side noted)

| # | Claim | Delta | Fix side |
|---|-------|-------|----------|
| D1 | §15 counts: 122 test files · 20 migrations · 76 tables | Actual: **161** `*.test.js` files (~1528 test *cases* per CHANGELOG v5.6), **29** numbered migrations (001–029), **78** live tables. Only "16 roles auto-checked" is still exact. | **Doc** — update the four tiles (p33) and the §14 "76" (p32). Distinguish files vs cases. |
| D2 | §01/§02 "20 screens cover the full cycle" | 20 items exist in `NAV_ITEMS` (`nav.js`) but `المالية والعقود` is gated off for everyone (`pages.js:75 finance: () => false`), so **19 screens actually open**. | **Doc** — say 19, or footnote finance as removed. |
| D3 | §03 "two support units" (تطوير الأعمال, الخدمات المشتركة) | Live and code carry a **3rd support sector FINANCE** (`kind='support'`), tied to the retired finance role. | **Doc** — add FINANCE, or owner retires the org unit like the role. |
| D4 | §05a/§07 bd_manager & department_manager opportunity text | Predates **v5.2/v5.5/v5.6** (ADR-0005): bd_manager reads/updates **own** (creates at sector) and can **delete own**; department_manager reads **his departments + partner + sector-orphans**, not the whole sector, and can **delete his department's** opportunities. Doc says "reads the sector's opportunities / no delete". | **Doc** — rewrite the two role cards + matrix cells to v5.6 reality. |
| D5 | §05a sector_lead "the only one who deletes standing work (with admin)" | Since v5.6, opportunity delete is also held by department_manager (dept), bd_manager (own), and the row creator (`matrix.js`; `guarded-removal.test.js`). Still true for projects. | **Doc** — scope the exclusivity claim to projects. |
| D6 | §07 matrix — bd_manager row | bd_manager now opens الفريق/التسكين/الهيكل التنظيمي (gained employee-read@sector, 2026-08-03; `matrix.js:228`, `pages.js:76,77,87`). Doc shows them closed. | **Doc** — the code is *wider* than the doc here (no exposure; documented decision). |
| D7 | §04 steps 08/09 (مستخلص / تحصيل) & their p9 screenshots | Issuing a progress-claim and recording a collection lost their **screen** when the owner closed المالية; the services + APIs remain. Screenshots predate the shutdown. | **Doc** — refresh screenshots; note the actions are API-only now. |
| D8 | §06 "admin edits to grants apply without redeploy" | No grant-editing UI and no runtime re-read exists; grants come from the code matrix at boot. | **Doc** — drop the "admin edits apply live" sentence (or build the feature). |
| D9 | §06 scope table lists "team" (فريق, rank 2) as a working scope | `team` scope is defined but effectively unused (fail-closed hardening); no role is scoped to it operationally. | **Doc** — mark team as reserved. |
| D10 | §08 "one account carries role+scope+sector+department, nothing else" | Since migration 025 there are additive **per-user department grants** (`user_department_grant`) layered on top. | **Doc** — mention the additive grant. |
| D11 | §09 approvals — omits task approvals + staffing confirmations | These two (migrations 022/028) are the **only** approval flows actually generating live traffic (auto-raised in service flows); the doc's table omits them. | **Doc** — add both rows. |
| D12 | §10 VAT "one place, no second copy" | The write path is single-source (`vat.js`), but the `×100/115` divisor is duplicated as read-time fallbacks in `core/reports/metrics.js:24,49,276`, `project-cash.js:24`, `periods.js:526`, and client `public/pages/opps.js:50`. | **Doc** — soften "no second copy", or centralize the fallback. |
| D13 | §12 template contents & scheduling prose | Two content cells stale (حالة القطاع الأسبوعية / إشغال القوى العاملة render fewer fields than listed); in-app notifications are written synchronously by services, not by the scheduler. | **Doc** — reconcile the two cells and the "notifications on a schedule" line. |
| D14 | §14 "Time family = 3 tables (قيد/كشف/فترة)" | Only `time_entry` + `timesheet_period` exist (no separate "الكشف"). Net live table count is 78, not 76. | **Doc** — correct the family breakdown and total. |

*(Full 36-item drift list is in the audit working set; the table above is the load-bearing subset. Every §04/§07 screenshot that shows the finance screen or the مستخلص button is stale for the same reason as D2/D7.)*

---

## 5. Mismatches (ranked — doc claim vs. code reality)

### M1 — The finance screen (المالية والعقود): **the doc presents a disabled screen as live.** *(Doc error — highest priority)*
- **Doc:** lists المالية والعقود as one of the 20 live screens (p4), shows a full screenshot of it (p25), and marks it "open" for 4 roles in the screen×role matrix (p18: مدير النظام، مكتب الرئيس التنفيذي، قائد قطاع، رئيس تطوير الأعمال).
- **Code:** `src/core/policy/pages.js:75` — `finance: () => false`. The page is **denied to every role, both in the sidebar and on direct URL** (the gate is enforced on the route, `src/web/routes.js:179-184`, not just hidden in nav). Removed by explicit owner decision («موضوع الفواتير والمالية خلاص ألغِه»), documented in the pages.js comment and `FEATURES.md:27` ("off by owner decision").
- **Verdict:** **Doc error, not a code bug — and the code is *stricter* than the doc, so there is no exposure.** The p25 screenshot is a genuine capture of an **older build**: until ~2026-08-01 the screen opened for CEO-office and sector-scoped finance readers under the pre-removal gate; the screenshot is not a special route. `سجل الوقت`/timesheet is likewise off (`pages.js:57`) and, consistently, is *absent* from the doc's screen list.
- **Action:** **Doc** — remove المالية والعقود from the live-screen list and matrix (drop the column), or footnote it as retained-data / screen-removed; refresh or caption the p25 screenshot. Underlying finance data still flows to every other screen — that part of the doc is true.

### M2 — The retired `finance` role is **alive on live staging** with 40 privileged grants. *(Code/ops defect → `KI-031`)*
- **Doc:** p14 «دورٌ أُلغي ولا يُعاد» — the finance role was deleted by migration and "a test guards that it never returns"; p10 says "sixteen roles".
- **Code (working tree):** correct — `finance` is not in `ROLE_GRANTS`, migration 018 deletes it, and `tests/security/finance-role-retired.test.js` proves a fresh migrate+seed produces no finance role.
- **Live DB (read-only snapshot, 2026-08-09):** the `role` table has **17 rows including `finance`** (created 2026-08-01, `deleted_at=NULL`, `is_system=1`), and `role_permission` holds **40 company-scope finance grants** — including `invoice`/`expense` **approve**, and `margin`/`cost` **read** — held by **0 users**.
- **Why:** `scripts/seed-rbac.js:7-19` seeds/zeroes grants for roles *in the matrix* but **never prunes a role that has left the matrix**. Migration 018 was a one-time cleanup; it does not recur. The role was re-created on 2026-08-01 (most plausibly a build whose matrix still carried finance booting after 018 was already in the ledger), and nothing since removes it. The guard test builds its **own clean DB**, so it cannot see this live drift — the exact "role lingering with its old grants" hazard migration 018's own preamble warns is "more dangerous than leaving it declared."
- **Severity:** **medium.** No holder today, but the role is assignable from the users screen and carries unredacted margin/cost + invoice/expense approve if assigned.
- **Action (owner/dev):** delete the orphaned live `finance` role + grants (read-only audit did **not** mutate it); make `seed-rbac` prune matrix-absent system roles; extend the guard test to assert against an existing/seeded DB, not only a fresh one. Filed as **KI-031**.

### M3 — The amount-threshold approval workflow is **dormant scaffolding**; large-amount escalation is not enforced on the path users use. *(Doc over-claim + latent gap → `KI-033`)*
- **Doc:** p22 describes approvals as a **path** where "the system picks the first step whose amount threshold applies … the large ones rise" (e.g. an invoice above a limit rises to the CEO office), and "the request appears only for whoever can decide it."
- **Code:** the workflow **engine is correct** — `stepFor` applies `min_amount_halalas` (`src/modules/workflow/engine.js:106-108`) and `actOnApproval:149` enforces the step role. **But `submitForApproval` (which runs that engine) has exactly one caller — the raw `POST /api/approvals` route — and no UI submits to it** (`api.routes.js:133`; no caller in `src/web`). The only approval flows actually wired are **task approvals and staffing confirmations**, via a *separate* direct-settler rail (`engine.js:234 DIRECT_SETTLERS`). Expenses are approved by a **direct status flip** gated only by `can(user,'approve','expense')` with **no threshold** (`src/modules/finance/expenses.js:222-226`). Invoices/proposals/opportunities/deliverables likewise have no wired threshold escalation.
- **Verdict:** primarily a **doc over-claim** — p22 presents a threshold-escalation mechanism that exists in the engine but is not reachable for 5 of the 6 documented resources. The residual code gap (thresholds seeded but never applied to expense/invoice approval) is **medium**.
- **Action:** **Doc** — describe the real mechanism (direct role-based approval for expense/etc.; task + staffing confirmations are the live flows; threshold workflow reserved). **Dev (optional)** — wire the submit path or drop the seeded thresholds. Filed as **KI-033**.

### M4 — §09 approver table is wrong vs. both the seeded chains and enforcement. *(Doc error)*
- **Doc p22 table:** opportunity=sector_lead+approver; proposal=sector_lead; deliverable=PM+sector_lead+ceo_office; expense=dept_manager+sector_lead+ceo_office; **invoice=ceo_office (above threshold)**; timesheet=line_manager+dept_manager+sector_lead.
- **Code/live:** the opportunity chain is **sector_lead only** (seed.js; live `approval_step`); expense escalates sector_lead→ceo_office (**no dept_manager step**); timesheet has only a **line_manager** step; **there is no invoice workflow at all** (0 rows). The `approver` role and `department_manager`/PM approve *grants* exist in the matrix, but the seeded *chains* don't match the table.
- **Verdict:** doc error (med). **Action: Doc** — align the table with the seeded chains, and delete the invoice-workflow row (no such mechanism exists).

### M5 — Architecture: "the core imports from nobody" is **false**. *(Doc error — aspirational)*
- **Doc p30:** «والنواة لا تستورد من أحد» (the core imports from no one); one-way `web → modules → core`.
- **Code:** **13 core→modules imports across 9 files**: `src/core/reports/attention.js:6,8`, `src/core/reports/periods.js:30-36`, `src/core/reports/engine.js:4,7`, `src/core/reports/metrics.js:13`, `src/core/ai/assistant.js:19,25`, `src/core/http/context.js:7`, `src/core/i18n/stages.js:5`. Also one **module→web** import (`src/modules/pmo/projects.js:13` → `web/i18n/glossary.js`). Additionally, **web views query the DB directly** for reads (`src/web/views/{org,people,clients,crm,sector,govern,mail,exec,pmo,opportunity-detail}.js` import `all/get` from `core/db`), contradicting p29's "web never queries the DB directly" — though every *write* still goes through module services.
- **Verdict:** doc error (med). The single-source-policy half ("permission decision in one place") **is** real and working (`src/core/policy/pages.js` read by web + search + guide). The absolute import-direction sentence is aspirational.
- **Action: Doc** — state the direction as a goal with known exceptions, or (dev) invert the reports/ai dependencies. This matches a prior review's hypothesis and the standing `KI` layering theme.

### M6 — §08 audit "value before and after" over-claims; "every failed login recorded" is not literal. *(Doc error)*
- **Doc p21:** the audit log records "who, what, which row, when, and **the value before and after**"; p20 "every login — success or failure — is recorded."
- **Code:** `audit_log` has `action/resource/resource_id/user/at/ip/detail_json` and **no before/after columns** (`migrations/001_init.sql:838-849`; `src/core/audit/index.js:5-18`). Services pass `detail: patch` — the **change/after only**, not a before snapshot. Failed logins for an **unknown identifier** cannot be attributed to a user row, so "every failed login" is not literal.
- **Verdict:** doc over-claim (med for before/after, low for logins). **Action: Doc** — say the log records the change (the new values), and that failed logins for known accounts are recorded.

### M7 — §04/§16 the proposal/pricing step (العرض والتسعير) **cannot be built in the product.** *(Doc error)*
- **Doc:** step 02 of the cycle and the glossary describe building a priced proposal on an opportunity and raising it for approval.
- **Code:** `proposal`, `pricing_line` tables and RBAC grants and a `proposal_approval` workflow all exist, but there is **no create/update route or UI for proposals** (`api.routes.js` has no proposal endpoint; views only read). The documented cycle step has schema and grants but no implementation.
- **Verdict:** doc over-claim (med) — a described cycle stage is not operable. **Action: Doc** — mark العرض/التسعير as not-yet-built, or dev builds the create path.

### M8 — §16 مستخلص precondition is stricter in the doc than in code. *(Doc error)*
- **Doc:** a progress-claim (مستخلص) is issued on a deliverable that was "delivered **and** accepted (سُلِّم واعتُمد)".
- **Code:** `src/modules/finance/finance.js:332` — `CLAIMABLE_STATUSES = ['DELIVERED','ACCEPTED']` (delivered **or** accepted). A claim can be issued on a merely-DELIVERED (not yet client-accepted) deliverable. Correspondingly, §10 step 03's "revenue line created at acceptance, not before" is slightly off: the revenue line is created on **DELIVERED** already (`recognition.js:30`).
- **Verdict:** doc error (med). **Action: Doc** — say "delivered or accepted", or (owner) tighten the code to require acceptance.

### M9 — §05b HR delete is narrower than the doc; procurement opens the sector screen. *(Doc error + minor prose gap)*
- **HR:** doc says HR creates/updates/**deletes** employees, positions, departments, units, teams. Code grants **delete only on `employee`** (offboarding); the other four are create/update/read only (`matrix.js:277-280`). Doc error (low).
- **Procurement:** doc p13 says its wide company window "opens **no** leadership screens", but مركز القطاع is gated by `can(read,'project') || can(read,'opportunity')` (`pages.js:46`) and procurement has project-read, so it **opens the sector center** (margin/cost are still redacted there). The screen×role matrix itself agrees code=doc for this cell, so this is a prose-vs-behavior nuance (low), not a matrix deviation.

### M10 — §12 reports: no permission **re-check at send time**; schedule creation is not recipient-scoped. *(Doc over-claim, low)*
- **Doc p28:** permission is "measured at build time **and** send time."
- **Code:** binding is enforced at **build** (`engine.js:118-135`, each recipient's report built under their own resolved scope) but **not re-checked before the queued message is sent**. `createSchedule` gates only on `assertCanSchedule` (admin/ceo) and does not bind the recipient group to the scheduler's scope — however, because each recipient's report is rebuilt under *their* permissions, **no data leaks** to a recipient; the residual is a stale-permission window between build and send (tiny, since build happens at fire time). Low.

### Screen × role matrix — the 7 differing cells (§07)
The matrix was regenerated from `PAGE_ACCESS` for all 16 roles × 20 screens and diffed against the PDF. **7 cells differ, all explained by two post-doc owner decisions:**

| Role | Screen | Doc | Code | Cause |
|------|--------|-----|------|-------|
| admin | المالية والعقود | open | **closed** | finance screen removed 2026-08-01 (`pages.js:75`) |
| ceo_office | المالية والعقود | open | **closed** | same |
| sector_lead | المالية والعقود | open | **closed** | same |
| bd_head | المالية والعقود | open | **closed** | same |
| bd_manager | الفريق | closed | **open** | gained employee-read@sector 2026-08-03 (`matrix.js:228`) |
| bd_manager | التسكين | closed | **open** | same |
| bd_manager | الهيكل التنظيمي | closed | **open** | same |

The finance-column cells are the doc being **stale** (code is stricter — no exposure); the bd_manager cells are the code being **wider** than the doc (documented decision). All other 313 cells match.

---

## 6. Genuine code/ops defects filed to `KNOWN-ISSUES.md`

Three rows were added (`KI-031`…`KI-033`). Two are genuine defects surfaced by this audit; the third records the dormant-workflow gap. Doc-only inaccuracies (M1, M4–M10, all drift) are **not** filed — they are documentation fixes for the owner, not code defects.

- **KI-031** (rbac/ops, med) — retired `finance` role live on staging with 40 privileged grants; `seed-rbac` never prunes matrix-absent roles; guard test blind to live drift. *(M2)*
- **KI-032** (workflow, med-latent) — `myApprovalQueue` filters `ar.sector_id = user.sector_id` (`engine.js:201-202`), so a company-scope approver seeded with a `sector_id` (e.g. ceo_office) never sees an escalation step routed to it from another sector. Latent today because the role-based workflows are unwired.
- **KI-033** (workflow/governance, med) — the five role-based approval workflows (opportunity/proposal/expense/deliverable/timesheet) are dormant: `submitForApproval` has no UI caller, so amount-threshold escalation never runs on the used path; expense approval bypasses thresholds (`expenses.js:222-226`). *(M3)*

---

## 7. Unverifiable (1)

- **§16 footer** — "screenshots are from the platform on demo data with non-real names/numbers." Consistent supporting machinery exists (demo seed, `demo_record` table), but the audit cannot prove from the repo that the specific PDF images were captured from the platform. Not material to structure/behavior.

---

## 8. Bottom line for the owner

The document is **trustworthy on the model** — permissions, scopes, sensitive-field sealing, money math, auth, recognition, and server-side enforcement are implemented as written and survived adversarial refutation. It is **not trustworthy as a current screenshot of the running system**: it shows a removed screen (finance) as live, its counts are stale, its role and matrix text predate the v5.2–v5.6 changes, its "core imports from nobody" claim is aspirational, and a few governance/audit/reporting sentences promise more than the code enforces. Fix the ~14 drift items and the doc-error mismatches (§5) in the PDF, act on the three `KI` rows in the code/live DB, and the document will describe reality. **No product code was changed by this audit; the live `finance` role was read but not deleted — it awaits your go-ahead.**
