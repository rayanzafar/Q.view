# Feature registry — سند (Sanad)

Single place to see every feature, its status, entry points, and tests. Derived from the code on branch `claude/evc-platform-analysis-r5nsri` (migrations 001–029, 1489 tests green). Code is authoritative — specs 01–06 and README are known-stale. Paths are relative to `platform/`. Update this file in the same commit that adds a page, router, migration, or module.

## Pages

One row per key in the `PAGES` map (`src/web/routes.js`). Gate = `PAGE_ACCESS` (`src/core/policy/pages.js`); menu visibility and the 403 guard share `pageAllowed()` (`src/web/nav.js`), so they can never diverge. Every page additionally loads the global scripts wired in `src/web/layout.js`: `src/web/public/app.js` (frozen base), `global-search.js`, `pages/guide-tour.js`, `pages/ai.js`. "page JS" below = the page-specific `scripts:[]` entry (under `src/web/public/`).

| key | Arabic name | what it does | access gate | view file | page JS | status |
|---|---|---|---|---|---|---|
| `home` | صفحتي | Personal my-day: greeting, today's tasks/milestones/deliverables, SSR month calendar (`myDay` in `src/modules/home/home.js`), pending-approvals card with inline approve/reject (directed approvals only — self-scoped; deliberately no role gate, the KI-035 structural fix) | everyone (`() => true`; every query behind it is scoped to the user) | src/web/views/home.js | pages/home.js, pages/approvals.js (shared listener) | live |
| `ceo` | لوحة القيادة | Company KPI dashboard with drill-downs (revenue/sales/pipeline/win-rate/backlog/margin), sector chips, year selector | `seesCompanyPerformance(u)` (company-wide report/kpi grant AND `user.scope==='company'`) | src/web/views/exec.js | — | live |
| `portfolio` | محفظة المشاريع | Portfolio health view across all projects | `seesCompanyPerformance(u)` | src/web/views/exec.js | — | live |
| `sector` | مركز القطاع | Sector command center: period lens, what-changed feed, attention, pipeline funnel/aging, project health, capacity, approvals | `can(u,'read','project') \|\| can(u,'read','opportunity')` | src/web/views/sector.js | — | live |
| `opportunities` | الفرص | Pipeline kanban + table, saved views, rot/stalled flags, weighted pipeline drill-downs. Visibility (v5.2 flip, owner 2026-08): bd_manager = own rows; department managers (role or `department.manager_user_id`) = their departments' rows (primary + partner, read-only beyond own); sector_lead = sector; bd_head = company | `can(u,'read','opportunity')` | src/web/views/crm.js | pages/opps.js | live |
| `my-opportunities` | فرصي | Personal priority queue (stalled → no-next-step → on-track) | `can(u,'read','opportunity')` | src/web/views/crm.js | pages/opps.js | live |
| `projects` | المشاريع | Project portfolio: comparison table + kanban, live filters, saved views, staffing drawer | `can(u,'read','project')` | src/web/views/pmo.js | pages/projects.js | live |
| `tasks` | مهامي | Task workcenter: list/board/calendar, lenses me/team/notes, quick-add (with category presets + free text), reopen-done, delete-own, bulk edit; provenance on each task (row chip «أسندها فلان» + read-only «أسندها/اعتمدها» block in the editor drawer, migration 030); `?who=notes` renders `notesPage` | everyone | src/web/views/pmo.js (notes lens: src/web/views/notes.js) | pages/tasks.js (notes lens: pages/notes.js) | live |
| `timesheet` | سجل الوقت | Time-entry page (data still feeds capacity/utilization reads) | `() => false` | src/web/views/people.js (`timesheetPage`) | — | off by owner decision |
| `approvals` | الاعتمادات | Approval inbox: role-threshold queue + person-addressed staffing confirmations and task approvals (request-shaped rows, reject-reason modal, no-manager notice for org admins) | role in admin, sector_lead, department_manager, line_manager, approver, ceo_office | src/web/views/govern.js | pages/approvals.js | live |
| `team` | الفريق | Employee CRUD (hire/end dates; salary field only for salary-readers) | `can(u,'read','employee')` | src/web/views/people.js | pages/team-manage.js | live |
| `staffing` | التسكين | Staffing span board, month stepper, bench/over/under drill-downs, internal work buckets | `can(u,'read','employee')` | src/web/views/people.js | pages/staffing.js | live |
| `users` | المستخدمون والصلاحيات | User invites (OTP), role/scope edits, deactivate, login history, department grants | `u.role_id === 'admin'` | src/web/views/govern.js | pages/identity.js | live |
| `audit` | سجل التدقيق | Audit log browser (Arabic-rendered detail keys) | `u.role_id === 'admin'` | src/web/views/govern.js | — | live |
| `reports` | التقارير والبريد | Period reports (week/month/quarter, 6 lenses) with snapshots/compare/issue/print + email schedule CRUD + test-send | `can(u,'read','report')` | src/web/views/govern.js (`reportsPage`) | pages/reports-period.js | live |
| `org` | الهيكل التنظيمي | Org tree (sector→department→unit→employee), org-health card, unassigned-work panel, bulk assign/move sub-screens | admin OR `can(u,'create','sector')` OR `can(u,'read','employee')` | src/web/views/org.js | pages/org-tree.js | live |
| `finance` | المالية والعقود | Company finance screen (bridge, contracts, invoices) — data still flows to every other screen | `() => false` | src/web/views/finance.js (`financePage`) | — | off by owner decision |
| `mail` | مركز البريد | Mail center: outbox preview, queue, delivery log | role in admin, ceo_office | src/web/views/mail.js | pages/mail.js | live |
| `clients` | العملاء | Relationship list (نشطة/فاترة/خاملة), aggregates, revenue-concentration drill-down | `can(u,'read','client') \|\| seesCompanyPerformance(u)` | src/web/views/clients.js | pages/clients.js | live |
| `imports` | البيانات | Import/export center: export, upload→map→preview→apply→undo wizard, run history | admin OR any read/create/update on client/employee/opportunity/project/allocation/revenue_line | src/web/views/imports.js | pages/imports.js | live |
| `guide` | دليلي | SSR user manual + guided-tour deep links, content filtered by the same `PAGE_ACCESS` gates | everyone | src/web/views/guide.js | — (guide-tour.js is global) | live |

## API surfaces

All `/api/*` routers hang off `apiRouter` (`src/modules/api.routes.js`, behind `requireAuth()`), except `/api/ai` (own router) and `/auth` (JSON auth), both mounted in `src/server.js`. Authorization lives in services, not routers.

| mount/area | routes summary | service file(s) | notes |
|---|---|---|---|
| /api opportunities + pipeline (inline in api.routes.js) | GET/POST `/opportunities`, GET `/:id`, GET `/:id/detail`, PATCH `/:id`, POST `/:id/stage`, POST `/:id/sector`, GET `/:id/removal-check` (returns blockers + cascade preview), DELETE `/:id` (creator may delete own; sector_lead/admin in scope; time_entry blocks; cascades doc/team/task/partner-dept) | src/modules/crm/opportunities.js, src/core/lifecycle/remove.js | Stage move mirrors won→project (src/modules/crm/opp-project-sync.js); removal-check calls `getOpportunity` first (IDOR guard); UI «سحب الفرصة» in pages/opps.js (v5.1). v5.2: lists narrowed per the visibility flip (`deptCol` fail-closed + partner/managed-department reach in scope.js); row reads go through src/modules/crm/opp-access.js so partner-department managers open what their list shows; list and pipeline aggregate share identical scope opts (ADR-0005) |
| /api projects (inline) | GET/POST `/projects`, GET/PATCH `/:id`, `/:id/staffing`, POST `/:id/staff`, PATCH/DELETE `/projects/staff/:allocId`, POST `/staffing/internal`, `/:id/candidates`, `/:id/team-load`, `/:id/progress`, `/:id/kpis`, `/:id/documents` (GET/POST + DELETE `/projects/documents/:docId`), `/:id/updates`, `/:id/tasks`, `/:id/removal-check`, DELETE `/:id` | src/modules/pmo/projects.js, src/modules/pmo/capacity.js, src/modules/pmo/progress.js, src/core/reports/metrics.js, src/core/lifecycle/remove.js | `/staffing/internal` = work-bucket allocation with no project (migration 027) |
| /api intake (inline) | POST `/intake/parse`, POST `/intake/create`, POST `/projects/:id/deliverables/parse`, POST `/projects/:id/deliverables/bulk` | src/modules/intake/intake.js | AI extraction with regex fallback; create is one tx (project+contract+deliverables+client) |
| /api tasks (inline) | GET `/tasks/mine`, POST `/tasks/quick`, GET `/tasks/team`, PATCH `/tasks/bulk`, PATCH `/tasks/:id`, DELETE `/tasks/:id` (creator/personal-owner soft delete, cancels pending approval) | src/modules/pmo/tasks.js | Personal tasks never cross accounts (`notPersonalSql`); pending-approval tasks hidden from others (`approvedTaskSql`) |
| /api timesheets (inline) | GET `/timesheets/mine`, POST `/timesheets`, POST `/timesheets/submit`, POST `/timesheets/:id/approve` | src/modules/timesheets/timesheets.js | Page is off; API + utilization math still live |
| /api approvals (inline) | GET `/approvals/queue`, POST `/approvals`, POST `/approvals/:id/act` | src/modules/workflow/engine.js | One box for role-threshold workflows + direct (assignee) approvals: staffing confirmations and task approvals |
| /api notifications (inline) | GET `/notifications?unread=1`, POST `/notifications/:id/read` | src/modules/notifications/notify.js | Feeds the header badge (links to /app/tasks; no notifications page) |
| /api org (inline) | GET `/org/tree`, POST/PATCH `/org/sectors`, POST/PATCH/DELETE `/org/departments`, POST `/org/units`, GET `/org/roster`, POST/PATCH `/org/employees(:id)`, PATCH `/:id/move`, POST `/org/employees/move` | src/modules/org/org.js | Sector kind delivery\|support; delete/convert blocked while carrying work |
| /api finance (inline) | GET `/finance/summary`, `/finance/by-pm`, `/finance/by-contract`, `/finance/contracts/:id`, POST `/finance/progress-claim`, POST `/finance/collections` | src/modules/finance/finance.js | Bridge bookings→revenue→invoiced→collected→AR; progress claims (مستخلصات) and collections write invoices |
| /api metrics (inline) | GET `/metrics/company`, GET `/metrics/sector/:id` | src/core/reports/metrics.js | Company gated by `seesCompanyPerformance`; sector gated to own sector unless company scope |
| oppteamRouter | GET `/opportunities/:id/team`, GET `/:id/team/roster`, POST `/:id/team`, DELETE `/opportunities/team/:membershipId` | src/modules/crm/oppteam.js (src/modules/crm/oppteam.routes.js) | Cross-department roster (name-only); may raise a staffing confirmation |
| oppdocsRouter | GET/POST `/opportunities/:id/documents`, DELETE `/opportunities/documents/:docId` | src/modules/crm/oppdocs.js (oppdocs.routes.js) | Link-only metadata in shared `document` table |
| viewsRouter | GET/POST `/views`, DELETE `/views/:id`, POST `/views/:id/default` | src/modules/views/views.js (views.routes.js) | Saved views, max 20 per page per user |
| clientsRouter | GET/POST `/clients`, GET `/clients/:id/360`, PATCH `/:id`, GET `/clients/duplicates`, GET `/clients/name-review`, POST `/:id/confirm-name`, POST `/clients/merge`, POST `/:id/unmerge`, contacts CRUD (`/clients/:id/contacts`, PATCH/DELETE `/contacts/:id`), POST `/clients/:id/documents`, GET/POST `/activities` | src/modules/clients/clients.js (clients.routes.js) | 360 payload frozen by docs/specs/07-contracts-delivery2.md §6; clients scoped by footprint + created_by, not sector_id |
| governanceRouter | GET `/projects/:id/governance`, GET/POST `/projects/:id/{risks,issues,decisions,changes,milestones,deliverables,phases}`, PATCH/DELETE `/pmo/{kind}/:id` | src/modules/pmo/governance.js (governance.routes.js) | Deliverable writes trigger revenue recognition (`syncDeliverableRevenue`) in the same tx |
| notesRouter | GET/POST `/notes`, PATCH/DELETE `/notes/:id` | src/modules/pmo/notes.js (notes.routes.js) | Personal notebook, ownership-only guard (migration 023) |
| ioRouter | GET `/io/types`, GET `/io/export/:type`, POST `/io/import/:type/upload` (raw 15mb, `x-file-name`), `/preview`, `/apply`, GET `/io/runs(/:id)`, POST `/io/runs/:id/undo` | src/modules/io/engine.js + src/modules/io/adapters/*.js (io.routes.js) | 6 adapters (clients/employees/opportunities/projects/staffing/revenues); 7-day undo; replace mode admin-only |
| employeesRouter | POST `/employees`, PATCH `/employees/:id`, DELETE `/employees/:id` | src/modules/org/org.js (employees.routes.js) | Alias surface for employee CRUD; delete = soft, HR/admin |
| orgRouter | GET `/org/identity-links`, GET `/org/health`, POST/DELETE `/employees/:id/link` (+ `/org/employees/:id/link` aliases) | src/modules/org/org.js, src/modules/org/org-quality.js (org.routes.js) | user↔employee link writes both columns in one tx |
| attributionRouter | GET `/org/rollup`, GET `/org/unassigned`, PATCH `/org/attribution`, PATCH `/org/attribution/bulk` | src/modules/org/attribution.js (attribution.routes.js) | Department attribution of project/opportunity/allocation rows |
| backupRouter | GET `/api/backup/counts`, GET `/api/backup/dump` | src/core/backup/dump.js (src/modules/backup.routes.js) | Gated by `x-backup-token` = `SANAD_BACKUP_TOKEN`; NDJSON logical row dump, not a pg_dump replacement |
| guideRouter | GET `/guide`, GET `/guide/tour/:page` | src/modules/guide/guide.js (guide.routes.js) | Content filtered by `PAGE_ACCESS` |
| searchRouter | GET `/search?q=` | src/modules/search/search.js (search.routes.js) | Reuses scoped list services; categories dropped when the page is denied; 6 results/category |
| reportsRouter | GET `/reports/period{,/options,/compare,/snapshots,/snapshot/:id,/print}`, POST `/reports/period/issue` | src/core/reports/periods.js (src/modules/reports.routes.js) | Lens guards check grant width; snapshots re-check permissions at read time; Arabic HTML error pages (browser-opened) |
| moneyRouter | GET `/projects/:id/money`, GET/POST `/projects/:id/expenses`, PATCH/DELETE `/finance/expenses/:id` | src/modules/finance/finance.js (`projectMoney`), src/modules/finance/expenses.js (money.routes.js) | "Absence is not zero": gated/unrecorded amounts return null, never 0 |
| identityRouter | GET/POST `/identity/users`, GET `/:id/logins`, PATCH `/:id`, POST `/:id/resend`, `/:id/active`, `/:id/revoke-sessions`, GET `/:id/removal-check`, DELETE `/:id`; grants: GET `/identity/grants/options`, GET `/identity/grants/:userId`, POST `/identity/grants`, DELETE `/identity/grants/:id` | src/modules/identity/identity.js, src/modules/identity/grants.js (identity.routes.js) | Admin-only; passwordless OTP invites; per-person department grants (migration 025) |
| /api/ai (aiRouter, mounted in server.js) | GET `/status`, POST `/chat`, GET `/options/:kind`, POST `/preview`, POST `/apply`, GET `/activity` | src/core/ai/assistant.js, src/core/ai/store.js, src/modules/ai/apply.js (src/modules/ai.routes.js) | Chat never returns an apply token; writes only via preview→apply (15-min TTL, atomic single-use claim) |
| /auth (authRouter) | POST `/auth/login`, POST `/auth/logout`, GET `/auth/me`, POST `/auth/change-password` | src/core/auth/service.js (src/modules/auth.routes.js) | JSON auth API; change-password re-authenticates + revokes other sessions |
| web auth (webRouter) | GET `/login`, POST `/auth/otp/request-web`, POST `/auth/otp/verify-web`, POST `/auth/login-web`, POST `/auth/logout-web` | src/core/auth/otp.js, src/core/auth/service.js (src/web/routes.js) | OTP request returns a uniform redirect regardless of account existence (anti-enumeration, frozen contract); pending email in `sanad_otp_to` cookie; password login auto-off when mail transport is smtp |
| web reports (webRouter) | GET `/app/reports/preview/:key`, POST `/app/reports/test-send/:key`, POST `/app/reports/schedule`, POST `/app/reports/schedule/:id/active`, DELETE `/app/reports/schedule/:id` | src/core/reports/engine.js (src/web/routes.js) | Schedule control: admin/sector_lead/ceo_office, sector-scoped |
| web mail preview (webRouter) | GET `/app/mail/preview/:file` | src/web/views/mail.js (`outboxFileHtml`) | Same gate as mail page; served with CSP `sandbox` header + nosniff |

## Migrations

One row per file in `migrations/` (applied in order by `scripts/migrate.js`, recorded in `schema_migration`; immutable once deployed). From 007 on, files carry extensive Arabic rationale comments — the de-facto ADR log.

| NNN | file | what it adds | feature it serves |
|---|---|---|---|
| 001 | 001_init.sql | Base schema (~50 tables): IAM/RBAC, org, CRM, PMO, timesheets, approvals, finance, reporting, governance | everything |
| 002 | 002_progress_claims.sql | Invoice progress-claim fields (kind, claim_no, period_label, progress_pct, retention) + `invoice_line` | progress claims (مستخلصات) |
| 003 | 003_load_indexes.sql | Hot-path indexes, partial `WHERE deleted_at IS NULL` on scope columns | list-query performance |
| 004 | 004_sector_order.sql | Sector `sort_order` fixed to SOLUTIONS > CONSULTING > STRATEGIC > SAP | sector display order (owner directive) |
| 005 | 005_delivery2.sql | `crm_activity`, `import_run`, `import_row`, `saved_view`, `document` (frozen DDL, contracts §4) | activity log, import center, saved views, document links |
| 006 | 006_employee_hire_date.sql | `employee.hire_date` | team page employee lifecycle |
| 007 | 007_org_attribution.sql | `department_id` on project/opportunity/allocation (single owning dept, no guessed backfill) | department attribution |
| 008 | 008_employee_end_date.sql | `employee.end_date` | employee departure tracking |
| 009 | 009_support_units.sql | `sector.kind` delivery\|support (existing rows backfilled 'delivery') | company support units |
| 010 | 010_task_attribution.sql | `task.department_id` + `task.next_step` | task attribution + pipeline discipline |
| 011 | 011_client_merge.sql | `client.merged_into_client_id` | reversible client merge/unmerge |
| 012 | 012_client_name_confirmed.sql | `client.name_confirmed_at/by` | silencing rejected name-review suggestions |
| 013 | 013_ai_preview_lifecycle.sql | `ai_activity_log` + expires_at/applied_at/sector_id/outcome | durable AI preview lifecycle (atomic confirm) |
| 014 | 014_auth_identity.sql | `login_code` table (hashed OTP, signin\|invite), `ux_app_user_email_ci`, `last_login_method` | OTP login + invitations |
| 015 | 015_demo_registry.sql | `demo_record` registry of seeded rows | structurally safe demo purge |
| 016 | 016_user_deactivated_at.sql | `app_user.deactivated_at` stamp | "pending invite" vs "deliberately disabled" |
| 017 | 017_delivery_money_phases.sql | `project_phase` entity, deliverable four-facts split (invoiced_at/collected_at beside status) + weight/owner/due_date, `employee.capacity_pct` | delivery vs money separation, phases, capacity |
| 018 | 018_retire_finance_role.sql | Data-only: deletes role `finance`, reroutes approval steps to ceo_office, demotes holders to viewer | RBAC (owner decision — never re-add the role) |
| 019 | 019_vat_split.sql | `net_amount_halalas` + `vat_halalas` beside gross on 7 money tables (backfill gross×100/115) | VAT dual-face rule |
| 020 | 020_revenue_on_delivery.sql | Backfills `revenue_line` from delivered deliverables (derived ids `rl_dlv_*`, idempotent) | revenue recognition on delivery |
| 021 | 021_opportunity_commercial.sql | `opportunity.engagement_type` (PROJECT\|FRAMEWORK) + `solicitation_type` (RFI/RFP/RFQ/DIRECT_AWARD/TENDER) | opportunity commercial attributes |
| 022 | 022_staffing_confirmation.sql | `membership.status` (PENDING/ACTIVE) + `approval_request.assignee_user_id` | manager-confirmed staffing |
| 023 | 023_personal_notes.sql | `personal_note` table (owner-only, deliberately no sector column) | personal notebook (ملاحظاتي) |
| 024 | 024_opportunity_delivery_location.sql | `opportunity.delivery_location` (free text ≤160) | delivery location on opportunities |
| 025 | 025_user_department_grants.sql | `user_department_grant` (additive per-person read grants, soft-deleted) | personal department grants |
| 026 | 026_opportunity_departments.sql | `opportunity_department` M:N (partner departments; `department_id` stays the single accountable dept) | multi-department opportunities |
| 027 | 027_allocation_work_bucket.sql | `allocation.work_bucket` (internal work: bd/product/pmo with NULL project) | internal-work staffing |
| 028 | 028_task_approval.sql | `task.approval_state` (NULL = added; PENDING = awaiting manager) + index | task approvals |
| 029 | 029_task_category.sql | `task.category` (activity type: preset keys or free text) + data-fix reclassifying parentless `work_kind='project'` rows to `internal` | task types (v5.1) + internal-storage bugfix |
| 030 | 030_task_provenance.sql | `task.approved_by`/`approved_at` written by `settleTask` at decision time + backfill of already-approved tasks from `approval_action` | task provenance (who assigned / who approved) |
| 031 | 031_approval_mail_state.sql | `approval_mail_state` per-recipient send state (cooldown + daily-reminder claims; the row is the replica-safe send lock) | batched approval-notification email |

## Modules

One row per directory in `src/modules/`. Root-level files in `src/modules/` are routers, not modules: `api.routes.js` (aggregator), `ai.routes.js`, `auth.routes.js`, `backup.routes.js`, `reports.routes.js`.

| dir | purpose | key services | tests that cover it |
|---|---|---|---|
| src/modules/ai | Apply a confirmed AI preview through real services (one tx, audited `via:'ai'`) | apply.js | tests/security/ai-write-gates.test.js, tests/security/ai-engine-local.test.js, tests/integration/ai-routes.test.js, tests/integration/ai-contract.test.js |
| src/modules/clients | Clients: list aggregates, 360, merge/unmerge, dedupe/name review, contacts, documents, CRM activities | clients.js, clients.routes.js | tests/integration/clients.test.js, clients-list.test.js, client-merge.test.js, invoice-client-attribution.test.js |
| src/modules/crm | Opportunity pipeline: CRUD, stage/sector moves, won↔project mirror, opp team, opp documents, partner-aware row access | opportunities.js, opp-project-sync.js, oppteam.js, oppdocs.js, opp-access.js | tests/integration/opp-to-project.test.js, project-opportunity-mirror.test.js, opp-team*.test.js, opportunity-*.test.js, tests/unit/opp-rot.test.js, tests/security/opportunity-visibility.test.js |
| src/modules/finance | Finance bridge, AR aging/DSO, progress claims, collections, revenue recognition, VAT rule, project money view, expenses | finance.js, recognition.js, vat.js, expenses.js, money.routes.js | tests/unit/finance-aging.test.js, vat.test.js, finance-scope-consistency.test.js; tests/integration/project-money*.test.js, progress-claim-scope.test.js, revenue-on-delivery.test.js, vat-basis.test.js |
| src/modules/guide | User guide + guided tours, filtered by `PAGE_ACCESS` | guide.js, guide.routes.js (+ content in src/core/guide/content.js) | tests/integration/guide-page.test.js, guide-service.test.js |
| src/modules/home | My-day service for صفحتي (greeting, due items, month calendar) | home.js | tests/integration/home-my-day.test.js, home-greeting-calendar.test.js; tests/security/home-page-scope.test.js |
| src/modules/identity | Admin user management (invite/deactivate/remove, login history) + personal department grants | identity.js, grants.js, identity.routes.js | tests/security/identity-admin.test.js, personal-department-grants.test.js, user-removal.test.js; tests/integration/identity-duplicates.test.js |
| src/modules/intake | Contract/deliverable extraction (AI + regex fallback) and one-tx project intake | intake.js | tests/integration/opp-to-project.test.js, project-opportunity-mirror.test.js; tests/governance.test.js |
| src/modules/io | Import/export engine: upload→map→preview→apply→undo, xlsx/csv, 6 declarative adapters | engine.js, parse.js, xlsx.js, adapters/*.js | tests/integration/imports.test.js, imports-staffing-undo.test.js; tests/unit/import-engine.test.js, xlsx.test.js |
| src/modules/notifications | Minimal in-app notifications (insert, list, mark-read) | notify.js | no dedicated suite — exercised via tests/governance.test.js and tests/security/write-gates.test.js |
| src/modules/org | Org tree, sector/department/unit CRUD, employee lifecycle + moves, identity links, staffing confirmation/settle, attribution, org quality, people pickers | org.js, confirm.js, staffing-settle.js, attribution.js, org-quality.js, people.js | tests/integration/org-*.test.js, employee-*.test.js, staffing-confirmation.test.js; tests/security/employee-move.test.js, org-page-gate.test.js, department-leadership.test.js |
| src/modules/pmo | Projects, tasks (+ task approvals), governance registers, progress/money truth, capacity, personal notes | projects.js, tasks.js, task-approval.js, governance.js, progress.js, capacity.js, notes.js | tests/integration/projects-portfolio.test.js, tasks*.test.js, task-approval.test.js, governance-pmo.test.js, personal-tasks-and-notes.test.js; tests/security/pending-tasks-hidden.test.js; tests/unit/project-progress.test.js |
| src/modules/search | Global search over opportunities/projects/clients/employees, reusing scoped list services | search.js, search.routes.js | no dedicated suite — touched by tests/security/exec-surfaces.test.js (known thin coverage, SESSION-HANDOFF §8) |
| src/modules/timesheets | Time entries (≤16h/day), period submit/approve, utilization math | timesheets.js | tests/integration/utilization-may2026.test.js, task-approval.test.js; tests/security/write-gates.test.js, rbac-scope-bypass.test.js |
| src/modules/views | Saved views per page (max 20/user/page, default flag) | views.js, views.routes.js | tests/integration/saved-views.test.js |
| src/modules/workflow | Approval engine: threshold steps, act/advance, queues, direct (assignee) approvals for staffing + tasks; shared pending-inbox (`pendingApprovalsFor`/`decorateApprovals`); batched approval-mail decision + sweep (30-min/4-h cooldowns, 8–18 Riyadh window, 8AM reminder) | engine.js, inbox.js, approval-notify.js | tests/governance.test.js; tests/integration/staffing-confirmation.test.js, task-approval.test.js, activation-defects.test.js, home-approvals.test.js; tests/unit/approval-notify.test.js, approval-mail-templates.test.js |

`src/core/` areas (infrastructure, not features — see subsystem docs for depth):

| area | purpose |
|---|---|
| src/core/db | Dual-driver (SQLite/PG) data access: `all/get/run/exec/tx/insert/update`, `?`→`$n` rewrite, nested-tx join — do not edit casually |
| src/core/rbac | `can()`, `effectiveScope`, `scopeFilter` SQL scoping, sensitive-field redaction, 16-role matrix (matrix.js) |
| src/core/auth | Password login + lockout (service.js), OTP codes/invites (otp.js), scrypt hashing (password.js) |
| src/core/http | Request context/user resolution, Arabic error types + handler, CSRF (double-submit), security headers/rate limits |
| src/core/policy | `PAGE_ACCESS` + `seesCompanyPerformance` — page-open policy shared by nav, guard, guide, search |
| src/core/ai | AI assistant: intents, options, preview store (assistant.js, provider.js, store.js); local engine default, provider only with `AI_ENGINE=provider` + key |
| src/core/reports | Report engine/templates/schedules (engine.js), KPI math single source (metrics.js), period reports (periods.js), attention/changes/project-cash |
| src/core/mail | Transport preview\|smtp with fail-closed recipient allowlist, templates, SMTP, OTP mail, approval-notification mail (approval-mail.js, transactional shell) |
| src/core/jobs | 60s in-process scheduler: due report schedules, approval-mail sweep, email queue, hourly OTP purge |
| src/core/audit | `audit(ctx,…)` → `audit_log`, called by every write |
| src/core/lifecycle | Guarded soft-delete engine (project/opportunity/user): money blocks, cascades, Arabic refusals |
| src/core/backup | In-app NDJSON logical dump (serves /api/backup/*) |
| src/core/demo | `demo_record` registry — purge reads it, never pattern-matches |
| src/core/org | Sector kind (delivery/support) single source, Saudi entity-name registry |
| src/core/guide | Guide/tour content |
| src/core/i18n | Shared vocabulary helpers (plural, stages, thresholds, time) |
| src/core/util | `id(prefix)`, `nowIso()`, halalas money helpers |
| src/core/config.js | Env config + `assertProdSecrets` boot gate |

## Detail routes & cross-cutting features

- **/app/project/:id** — `projectDetailPage` (src/web/views/pmo.js): governance tabs (milestones/risks/issues/decisions/changes/deliverables/phases), money boards (`projectMoneySection`), expenses. Gate `DETAIL_ACCESS.project = PAGE_ACCESS.projects` (src/web/nav.js). Page JS: pages/project-governance.js + pages/project-money.js.
- **/app/opportunity/:id** — `opportunityDetailPage` (src/web/views/opportunity-detail.js): stage history, team, partner departments, commercial attributes. Gate = opportunities page.
- **/app/client/:id** — `clientDetailPage` (src/web/views/clients.js): the 360 view. Gate = clients page.
- **/app/person/:id** — `personPage` (src/web/views/pmo.js): person dossier + action hub (staff, assign task **with a project/opportunity link** — reader-scoped «الجهة المرتبطة» picker, approval-aware hint, v5.11 — grants). **Deliberately no route guard** — `personDossier` (src/modules/pmo/tasks.js) authorizes per row; own page always opens. Page JS: pages/person.js.
- **/app/contract/:id** — `contractDetailPage` (src/web/views/finance.js). Gate `DETAIL_ACCESS.contract = PAGE_ACCESS.finance = () => false` → unreachable for every role (see Dead code).
- **Global search** — Ctrl/Cmd+K palette (src/web/public/global-search.js) → GET /api/search (src/modules/search/search.js); inherits list-service scopes, drops denied categories.
- **Saved views** — /api/views (src/modules/views/views.js), used by opportunities and projects pages.
- **Notifications** — badge in the header (src/web/layout.js) polls GET /api/notifications?unread=1; workflow engine notifies approvers/requesters (src/modules/workflow/engine.js → src/modules/notifications/notify.js). No dedicated page.
- **Guide & tours** — guide page + per-page tour overlay (src/web/public/pages/guide-tour.js, GET /api/guide/tour/:page); content pre-filtered by `PAGE_ACCESS`.
- **AI assistant** — FAB + panel on every page (src/web/public/pages/ai.js); local deterministic engine by default, 8 intents; writes only via preview→apply (src/core/ai/*, src/modules/ai/apply.js). Provider (Anthropic preferred, then OpenAI) only with `AI_ENGINE=provider` + key.
- **Import/export** — imports page + /api/io/* (src/modules/io/); preview/apply/undo ledger in `import_run`/`import_row`; per-row permission checks, no silent skips.
- **Mail center** — /app/mail (admin, ceo_office): outbox preview (`data/outbox`), queue, log; sandboxed preview route /app/mail/preview/:file.
- **Scheduled reports** — 6 email templates (src/core/reports/engine.js), schedules fired by the 60s scheduler (src/core/jobs/scheduler.js); each recipient's report built under that recipient's permissions.
- **Approvals** — one inbox (`approval_request`) with three flows: (1) role+amount-threshold workflows (opportunity_go_nogo, proposal_approval, expense_approval, timesheet_approval, deliverable_acceptance — `workflow_definition`); (2) staffing confirmations (`STAFFING_WORKFLOW_KEY='staffing_confirmation'`, assignee = department manager, settles membership via src/modules/org/staffing-settle.js); (3) task approvals (`TASK_WORKFLOW_KEY='task_approval'`, migration 028 — project/opportunity-linked tasks by employees with sub-sector create scope wait as `approval_state='PENDING'`, hidden from everyone but their author via `approvedTaskSql`/`ownOrApprovedTaskSql` in src/modules/pmo/task-approval.js; no manager registered ⇒ task added immediately).
- **Personal notes** — ملاحظاتي lens of the tasks page (`/app/tasks?who=notes` → src/web/views/notes.js) over /api/notes (src/modules/pmo/notes.js); owner-only, structurally outside all aggregates.

## Dead / dormant code

Knowingly dead or dormant — do not "discover" these as bugs, and do not build on them:

- **`orgPage`** (src/web/views/people.js:477) — legacy org page export; routes.js wires `orgTreePage` (src/web/views/org.js) instead. Dead export.
- **`timesheetPage`** (src/web/views/people.js:17) — registered in PAGES but `PAGE_ACCESS.timesheet = () => false` (owner decision). Kept because time data feeds capacity/utilization reads.
- **`financePage` + `contractDetailPage`** (src/web/views/finance.js) — `PAGE_ACCESS.finance = () => false` and `DETAIL_ACCESS.contract = PAGE_ACCESS.finance`, so /app/finance and /app/contract/:id are 403 for every role including admin. Project money lives in `projectMoneySection` instead. Reinstating is a one-line policy change.
- **`allocation.month_start` / `month_end`** (migrations/001_init.sql:729-730) — legacy columns from import; the live model is `monthly_json` fractions. Nothing reads or writes them.
- **`deliverable.phase` / `phase_name_ar`** (migrations/001_init.sql) — legacy phase columns superseded by `phase_id` → `project_phase` (migration 017 backfilled but never drops columns).
- **`project.kind`, `project.progress_pct`, project stored revenue** — stale migration data with no product write path; always derived at read time via `projectKind`/`effectiveProgress`/`projectRevenue` (src/modules/pmo/projects.js, src/modules/pmo/progress.js).
- **Legacy `prompt()` actions in app.js** (src/web/public/app.js:81,87) — progress-claim/collection prompts are unreachable while the finance page is closed; the approve-reject reason prompt (line 50) is the one live exception to the no-browser-prompts rule.
