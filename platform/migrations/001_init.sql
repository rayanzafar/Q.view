-- سند Enterprise — schema v1 (SQLite dev; Postgres-portable).
-- Money = INTEGER halalas. Times = ISO-8601 UTC TEXT. Soft-delete via deleted_at.

-- ─────────────────────────── IAM & RBAC ───────────────────────────
CREATE TABLE IF NOT EXISTS role (
  id            TEXT PRIMARY KEY,          -- e.g. 'admin','sector_lead'
  name_ar       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  is_system     INTEGER NOT NULL DEFAULT 0, -- system roles cannot be deleted
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

-- Configurable permission grants: role × resource × action × scope.
CREATE TABLE IF NOT EXISTS role_permission (
  role_id   TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  resource  TEXT NOT NULL,   -- 'opportunity','project','salary_field',...
  action    TEXT NOT NULL,   -- read|create|update|delete|approve|export|admin
  scope     TEXT NOT NULL,   -- company|sector|department|project|team|own
  PRIMARY KEY (role_id, resource, action, scope)
);

CREATE TABLE IF NOT EXISTS app_user (
  id                 TEXT PRIMARY KEY,
  username           TEXT UNIQUE,
  email              TEXT UNIQUE,
  name_ar            TEXT,
  name_en            TEXT,
  role_id            TEXT REFERENCES role(id),
  employee_id        TEXT,                -- FK to employee (nullable: not every user is staff)
  sector_id          TEXT,                -- primary scope
  scope              TEXT NOT NULL DEFAULT 'own', -- highest data scope: company|sector|...
  password_hash      TEXT,                -- scrypt$... ; null = no login (directory-only)
  active             INTEGER NOT NULL DEFAULT 1,
  must_change_pw     INTEGER NOT NULL DEFAULT 0,
  failed_attempts    INTEGER NOT NULL DEFAULT 0,
  locked_until       TEXT,
  last_login_at      TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT,
  updated_at         TEXT,
  updated_by         TEXT,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS ix_user_sector ON app_user(sector_id);

CREATE TABLE IF NOT EXISTS login_history (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user(id),
  at          TEXT NOT NULL,
  ip          TEXT,          -- sensitive: admin-only via redactor
  user_agent  TEXT,
  ok          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id          TEXT PRIMARY KEY,           -- opaque random token
  user_id     TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_session_user ON session(user_id);

-- ─────────────────────────── Organization ───────────────────────────
CREATE TABLE IF NOT EXISTS sector (
  id                     TEXT PRIMARY KEY,
  name_ar                TEXT NOT NULL,
  name_en                TEXT,
  color                  TEXT,
  lead_user_id           TEXT REFERENCES app_user(id),
  target_sales_halalas   INTEGER DEFAULT 0,
  target_revenue_halalas INTEGER DEFAULT 0,
  target_margin_pct      REAL DEFAULT 0,
  active                 INTEGER NOT NULL DEFAULT 1,
  is_placeholder         INTEGER NOT NULL DEFAULT 0,
  sort_order             INTEGER DEFAULT 0,
  created_at             TEXT NOT NULL,
  created_by             TEXT,
  updated_at             TEXT,
  updated_by             TEXT,
  deleted_at             TEXT
);

CREATE TABLE IF NOT EXISTS department (
  id           TEXT PRIMARY KEY,
  sector_id    TEXT NOT NULL REFERENCES sector(id),
  name_ar      TEXT NOT NULL,
  name_en      TEXT,
  manager_user_id TEXT REFERENCES app_user(id),
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  updated_at   TEXT,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_dept_sector ON department(sector_id);

CREATE TABLE IF NOT EXISTS org_unit (
  id            TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES department(id),
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  manager_user_id TEXT REFERENCES app_user(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS ix_unit_dept ON org_unit(department_id);

CREATE TABLE IF NOT EXISTS team (
  id            TEXT PRIMARY KEY,
  sector_id     TEXT REFERENCES sector(id),
  department_id TEXT REFERENCES department(id),
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  lead_user_id  TEXT REFERENCES app_user(id),
  kind          TEXT NOT NULL DEFAULT 'org', -- org|project|opportunity|program|committee
  ref_id        TEXT,                        -- project/opportunity/program id when kind != org
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS position (
  id         TEXT PRIMARY KEY,
  title_ar   TEXT NOT NULL,
  title_en   TEXT,
  grade      TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS employee (
  id                TEXT PRIMARY KEY,
  user_id           TEXT REFERENCES app_user(id),
  name_ar           TEXT NOT NULL,
  name_en           TEXT,
  sector_id         TEXT REFERENCES sector(id),
  department_id     TEXT REFERENCES department(id),
  unit_id           TEXT REFERENCES org_unit(id),
  position_id       TEXT REFERENCES position(id),
  line_manager_id   TEXT REFERENCES employee(id),
  job_title         TEXT,                -- free-text role (legacy team.role)
  dept_label        TEXT,                -- legacy team.dept
  salary_halalas    INTEGER DEFAULT 0,   -- SENSITIVE (field-level redaction)
  employment_type   TEXT DEFAULT 'أساسي', -- أساسي|موسمي|متعاقد
  seasonal          INTEGER NOT NULL DEFAULT 0,
  status            TEXT DEFAULT 'نشط',
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_at        TEXT,
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS ix_emp_sector ON employee(sector_id);

-- Employee ↔ team/project membership (M:N with role in that group)
CREATE TABLE IF NOT EXISTS membership (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employee(id),
  group_kind  TEXT NOT NULL,   -- team|project|opportunity|program|committee|department
  group_id    TEXT NOT NULL,
  role_in_group TEXT,          -- member|lead|pm|reviewer|approver
  allocation_pct REAL,         -- optional planned allocation on this group
  start_date  TEXT,
  end_date    TEXT,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_membership_group ON membership(group_kind, group_id);
CREATE INDEX IF NOT EXISTS ix_membership_emp ON membership(employee_id);

-- ─────────────────────────── CRM ───────────────────────────
CREATE TABLE IF NOT EXISTS client (
  id         TEXT PRIMARY KEY,
  code       TEXT,
  name_ar    TEXT NOT NULL,
  name_en    TEXT,
  type       TEXT,             -- حكومي|خاص|داخلي|شبه حكومي
  sector_market TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS contact (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES client(id),
  name       TEXT NOT NULL,
  title      TEXT,
  email      TEXT,
  phone      TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS stage (
  id             TEXT PRIMARY KEY,
  name_ar        TEXT NOT NULL,
  name_en        TEXT,
  default_win_pct REAL,
  sort_order     INTEGER,
  color          TEXT,
  is_won         INTEGER NOT NULL DEFAULT 0,
  is_lost        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS opportunity (
  id             TEXT PRIMARY KEY,
  code           TEXT,
  title_ar       TEXT NOT NULL,
  client_id      TEXT REFERENCES client(id),
  sector_id      TEXT REFERENCES sector(id),
  owner_user_id  TEXT REFERENCES app_user(id),
  stage_id       TEXT REFERENCES stage(id),
  win_pct        REAL,
  value_halalas  INTEGER DEFAULT 0,
  priority       TEXT,          -- P0..P3
  year           INTEGER,
  source         TEXT,
  next_action    TEXT,
  notes          TEXT,
  exclude_from_sales INTEGER NOT NULL DEFAULT 0,
  stage_changed_at TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_at     TEXT,
  updated_by     TEXT,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_opp_sector ON opportunity(sector_id);
CREATE INDEX IF NOT EXISTS ix_opp_stage ON opportunity(stage_id);

-- opportunity ↔ sector (M:N for cross-sector opportunities)
CREATE TABLE IF NOT EXISTS opportunity_sector (
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  sector_id      TEXT NOT NULL REFERENCES sector(id),
  PRIMARY KEY (opportunity_id, sector_id)
);

CREATE TABLE IF NOT EXISTS opportunity_stage_history (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  from_stage_id  TEXT,
  to_stage_id    TEXT,
  changed_by     TEXT,
  changed_at     TEXT NOT NULL,
  note           TEXT
);

CREATE TABLE IF NOT EXISTS proposal (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  version        INTEGER NOT NULL DEFAULT 1,
  kind           TEXT,            -- technical|financial|combined
  value_halalas  INTEGER DEFAULT 0,
  margin_pct     REAL,            -- SENSITIVE
  status         TEXT DEFAULT 'draft', -- draft|internal_review|approved|submitted
  submitted_at   TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  deleted_at     TEXT
);

CREATE TABLE IF NOT EXISTS pricing_line (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT NOT NULL REFERENCES proposal(id) ON DELETE CASCADE,
  label        TEXT,
  qty          REAL DEFAULT 1,
  unit_cost_halalas  INTEGER DEFAULT 0,  -- SENSITIVE
  unit_price_halalas INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL
);

-- ─────────────────────────── PMO ───────────────────────────
CREATE TABLE IF NOT EXISTS portfolio (
  id         TEXT PRIMARY KEY,
  name_ar    TEXT NOT NULL,
  name_en    TEXT,
  owner_user_id TEXT REFERENCES app_user(id),
  sector_id  TEXT REFERENCES sector(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS program (
  id            TEXT PRIMARY KEY,
  portfolio_id  TEXT REFERENCES portfolio(id),
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  manager_user_id TEXT REFERENCES app_user(id),
  sector_id     TEXT REFERENCES sector(id),
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS project (
  id                 TEXT PRIMARY KEY,
  code               TEXT,
  financial_code     TEXT,
  name_ar            TEXT NOT NULL,
  name_en            TEXT,
  program_id         TEXT REFERENCES program(id),
  portfolio_id       TEXT REFERENCES portfolio(id),
  client_id          TEXT REFERENCES client(id),
  sector_id          TEXT REFERENCES sector(id),
  owner_user_id      TEXT REFERENCES app_user(id),
  pm_name            TEXT,
  source_opp_id      TEXT REFERENCES opportunity(id),
  status             TEXT DEFAULT 'IN_PROGRESS', -- NOT_STARTED|IN_PROGRESS|ON_HOLD|COMPLETED|CANCELLED
  rag                TEXT DEFAULT 'GREEN',       -- GREEN|AMBER|RED
  kind               TEXT DEFAULT 'external',    -- external|internal|product
  is_sector_project  INTEGER NOT NULL DEFAULT 1,
  budget_halalas     INTEGER DEFAULT 0,
  actual_spend_halalas INTEGER DEFAULT 0,        -- SENSITIVE
  revenue_halalas    INTEGER DEFAULT 0,
  contract_value_halalas INTEGER DEFAULT 0,
  po_value_halalas   INTEGER DEFAULT 0,
  margin_pct         REAL,                       -- SENSITIVE
  progress_pct       REAL DEFAULT 0,
  start_date         TEXT,
  end_date           TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT,
  updated_at         TEXT,
  updated_by         TEXT,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS ix_project_sector ON project(sector_id);
CREATE INDEX IF NOT EXISTS ix_project_status ON project(status);

CREATE TABLE IF NOT EXISTS workstream (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name_ar    TEXT NOT NULL,
  lead_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS milestone (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name_ar    TEXT NOT NULL,
  due_date   TEXT,
  status     TEXT DEFAULT 'PENDING',  -- PENDING|MET|MISSED
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS deliverable (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  milestone_id   TEXT REFERENCES milestone(id),
  name_ar        TEXT NOT NULL,
  amount_halalas INTEGER DEFAULT 0,
  month          INTEGER,
  year           INTEGER,
  phase          INTEGER,
  phase_name_ar  TEXT,
  status         TEXT DEFAULT 'PENDING', -- PENDING|DELIVERED|ACCEPTED|INVOICED|PAID|REJECTED
  delivered_at   TEXT,
  accepted_at    TEXT,
  notes          TEXT,
  sector_id      TEXT REFERENCES sector(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_deliverable_project ON deliverable(project_id);

CREATE TABLE IF NOT EXISTS task (
  id             TEXT PRIMARY KEY,
  parent_task_id TEXT REFERENCES task(id),   -- subtask if set
  project_id     TEXT REFERENCES project(id),
  opportunity_id TEXT REFERENCES opportunity(id),
  sector_id      TEXT REFERENCES sector(id),
  deliverable_id TEXT REFERENCES deliverable(id),
  work_kind      TEXT DEFAULT 'project',  -- project|opportunity|internal|product|proposal
  title          TEXT NOT NULL,
  description    TEXT,
  assignee_user_id TEXT REFERENCES app_user(id),
  priority       TEXT DEFAULT 'P2',
  status         TEXT DEFAULT 'TODO',     -- TODO|IN_PROGRESS|BLOCKED|IN_REVIEW|DONE|CANCELLED
  start_date     TEXT,
  due_date       TEXT,
  estimate_hours REAL,
  actual_hours   REAL DEFAULT 0,          -- rolled up from time_entry
  progress_pct   REAL DEFAULT 0,
  blocked_reason TEXT,
  recurring      TEXT,                     -- null|daily|weekly|monthly (rule)
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_at     TEXT,
  updated_by     TEXT,
  completed_at   TEXT,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_task_assignee ON task(assignee_user_id, status);
CREATE INDEX IF NOT EXISTS ix_task_project ON task(project_id);

CREATE TABLE IF NOT EXISTS dependency (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES task(id),
  type         TEXT DEFAULT 'FS',  -- finish-to-start etc.
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES project(id),
  sector_id   TEXT REFERENCES sector(id),
  title       TEXT NOT NULL,
  probability TEXT,   -- low|medium|high
  impact      TEXT,   -- low|medium|high
  exposure    TEXT,   -- derived
  mitigation  TEXT,
  owner_user_id TEXT REFERENCES app_user(id),
  status      TEXT DEFAULT 'OPEN', -- OPEN|MITIGATING|CLOSED
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS issue (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES project(id),
  title       TEXT NOT NULL,
  severity    TEXT,
  status      TEXT DEFAULT 'OPEN',
  owner_user_id TEXT REFERENCES app_user(id),
  opened_at   TEXT NOT NULL,
  closed_at   TEXT,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS decision (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES project(id),
  title       TEXT NOT NULL,
  detail      TEXT,
  decided_by  TEXT,
  decided_at  TEXT,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS change_request (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES project(id),
  title       TEXT NOT NULL,
  impact      TEXT,
  status      TEXT DEFAULT 'REQUESTED', -- REQUESTED|APPROVED|REJECTED
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS action_item (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES project(id),
  title       TEXT NOT NULL,
  assignee_user_id TEXT REFERENCES app_user(id),
  due_date    TEXT,
  status      TEXT DEFAULT 'OPEN',
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS lesson_learned (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES project(id),
  title       TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

-- ─────────────────────────── Timesheets ───────────────────────────
CREATE TABLE IF NOT EXISTS timesheet_period (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_user(id),
  period_start TEXT NOT NULL,   -- ISO week/month start
  period_end   TEXT NOT NULL,
  status     TEXT DEFAULT 'OPEN', -- OPEN|SUBMITTED|APPROVED|REJECTED
  submitted_at TEXT,
  approved_by  TEXT,
  approved_at  TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tsperiod_user ON timesheet_period(user_id, period_start);

CREATE TABLE IF NOT EXISTS time_entry (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user(id),
  period_id   TEXT REFERENCES timesheet_period(id),
  task_id     TEXT REFERENCES task(id),
  project_id  TEXT REFERENCES project(id),
  opportunity_id TEXT REFERENCES opportunity(id),
  work_kind   TEXT NOT NULL DEFAULT 'project', -- project|opportunity|proposal|product|internal|leave|training|bd
  entry_date  TEXT NOT NULL,
  hours       REAL NOT NULL,
  billable    INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  timer_started_at TEXT,        -- when running via live timer
  created_at  TEXT NOT NULL,
  updated_at  TEXT,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_time_user_date ON time_entry(user_id, entry_date);

-- ─────────────────────────── Workflow / Approvals ───────────────────────────
CREATE TABLE IF NOT EXISTS workflow_definition (
  id           TEXT PRIMARY KEY,
  key          TEXT UNIQUE NOT NULL,  -- 'opportunity_go_nogo','proposal_approval','expense_approval','timesheet_approval','deliverable_acceptance'
  name_ar      TEXT NOT NULL,
  target_resource TEXT NOT NULL,      -- which entity it governs
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_step (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL REFERENCES workflow_definition(id) ON DELETE CASCADE,
  step_order    INTEGER NOT NULL,
  approver_role TEXT,                 -- role_id expected to approve
  approver_scope TEXT DEFAULT 'sector',
  min_amount_halalas INTEGER DEFAULT 0, -- threshold gating (financial approvals)
  name_ar       TEXT
);

CREATE TABLE IF NOT EXISTS approval_request (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL REFERENCES workflow_definition(id),
  resource      TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  requested_by  TEXT NOT NULL,
  amount_halalas INTEGER DEFAULT 0,
  sector_id     TEXT,
  current_step  INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|APPROVED|REJECTED|CANCELLED
  created_at    TEXT NOT NULL,
  closed_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_appr_status ON approval_request(status);

CREATE TABLE IF NOT EXISTS approval_action (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES approval_request(id) ON DELETE CASCADE,
  step_order   INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL,
  action       TEXT NOT NULL,   -- approve|reject|return
  comment      TEXT,
  acted_at     TEXT NOT NULL
);

-- ─────────────────────────── Finance ───────────────────────────
CREATE TABLE IF NOT EXISTS supplier (
  id           TEXT PRIMARY KEY,
  name_ar      TEXT NOT NULL,
  name_en      TEXT,
  org          TEXT,
  contact_person TEXT,
  phone        TEXT,
  email        TEXT,
  status       TEXT DEFAULT 'active',
  notes        TEXT,
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE TABLE IF NOT EXISTS service (
  id           TEXT PRIMARY KEY,
  name_ar      TEXT NOT NULL,
  name_en      TEXT,
  category     TEXT,
  sector_id    TEXT REFERENCES sector(id),
  owner_user_id TEXT REFERENCES app_user(id),
  status       TEXT DEFAULT 'active',
  summary      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT,
  deleted_at   TEXT
);

CREATE TABLE IF NOT EXISTS service_package (
  id           TEXT PRIMARY KEY,
  service_id   TEXT NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  name_ar      TEXT NOT NULL,
  price_halalas INTEGER DEFAULT 0,
  cost_halalas  INTEGER DEFAULT 0,  -- SENSITIVE
  supplier_id  TEXT REFERENCES supplier(id),
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS contract (
  id             TEXT PRIMARY KEY,
  code           TEXT,
  client_id      TEXT REFERENCES client(id),
  project_id     TEXT REFERENCES project(id),
  sector_id      TEXT REFERENCES sector(id),
  value_halalas  INTEGER DEFAULT 0,
  start_date     TEXT,
  end_date       TEXT,
  status         TEXT DEFAULT 'DRAFT', -- DRAFT|ACTIVE|COMPLETED|TERMINATED
  signed_at      TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  deleted_at     TEXT
);

CREATE TABLE IF NOT EXISTS contract_payment (
  id             TEXT PRIMARY KEY,
  contract_id    TEXT NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  label          TEXT,
  amount_halalas INTEGER DEFAULT 0,
  due_date       TEXT,
  milestone_id   TEXT REFERENCES milestone(id),
  status         TEXT DEFAULT 'SCHEDULED', -- SCHEDULED|INVOICED|PAID
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice (
  id             TEXT PRIMARY KEY,
  code           TEXT,
  contract_id    TEXT REFERENCES contract(id),
  project_id     TEXT REFERENCES project(id),
  client_id      TEXT REFERENCES client(id),
  deliverable_id TEXT REFERENCES deliverable(id),
  sector_id      TEXT REFERENCES sector(id),
  amount_halalas INTEGER DEFAULT 0,
  issue_date     TEXT,
  due_date       TEXT,
  status         TEXT DEFAULT 'DRAFT', -- DRAFT|ISSUED|PARTIALLY_PAID|PAID|OVERDUE|CANCELLED
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_invoice_status ON invoice(status);

CREATE TABLE IF NOT EXISTS collection (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  amount_halalas INTEGER DEFAULT 0,
  collected_at   TEXT,
  method         TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense (
  id             TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES project(id),
  sector_id      TEXT REFERENCES sector(id),
  type           TEXT,
  amount_halalas INTEGER DEFAULT 0,   -- SENSITIVE
  incurred_month INTEGER,
  incurred_year  INTEGER,
  requested_by   TEXT,
  status         TEXT DEFAULT 'DRAFT', -- DRAFT|SUBMITTED|APPROVED|REJECTED|PAID
  created_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE IF NOT EXISTS cost_line (
  id             TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES project(id),
  sector_id      TEXT REFERENCES sector(id),
  type           TEXT,   -- رواتب|تعاقد باطني|أخرى
  amount_halalas INTEGER DEFAULT 0,  -- SENSITIVE
  month          INTEGER,
  year           INTEGER,
  source         TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revenue_line (
  id             TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES project(id),
  sector_id      TEXT REFERENCES sector(id),
  deliverable_id TEXT REFERENCES deliverable(id),
  amount_halalas INTEGER DEFAULT 0,
  month          INTEGER,
  year           INTEGER,
  label          TEXT,
  auto           INTEGER NOT NULL DEFAULT 0,
  rule_id        TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_revline_sector ON revenue_line(sector_id, year);

CREATE TABLE IF NOT EXISTS purchase_order (
  id             TEXT PRIMARY KEY,
  code           TEXT,
  supplier_id    TEXT REFERENCES supplier(id),
  project_id     TEXT REFERENCES project(id),
  sector_id      TEXT REFERENCES sector(id),
  amount_halalas INTEGER DEFAULT 0,
  status         TEXT DEFAULT 'DRAFT', -- DRAFT|APPROVED|ISSUED|RECEIVED|PAID
  created_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE IF NOT EXISTS budget (
  id             TEXT PRIMARY KEY,
  fiscal_year    INTEGER NOT NULL,
  sector_id      TEXT REFERENCES sector(id),   -- null = company
  target_revenue_halalas INTEGER DEFAULT 0,
  target_sales_halalas   INTEGER DEFAULT 0,
  target_margin_pct      REAL DEFAULT 0,
  cost_assumptions_json  TEXT,
  monthly_json           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS allocation (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT REFERENCES employee(id),
  person_name_ar TEXT,
  project_id    TEXT REFERENCES project(id),
  project_name  TEXT,
  sector_id     TEXT REFERENCES sector(id),
  type          TEXT,
  monthly_json  TEXT,          -- {"2":1,"3":0.5}
  month_start   INTEGER,
  month_end     INTEGER,
  year          INTEGER,
  source        TEXT,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

-- ─────────────────────────── Reporting & Email ───────────────────────────
CREATE TABLE IF NOT EXISTS report_definition (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL,   -- 'weekly_exec_brief','sector_weekly_status',...
  name_ar      TEXT NOT NULL,
  level        TEXT,            -- company|sector|program|project|team|employee
  detail_level TEXT DEFAULT 'summary',
  locale       TEXT DEFAULT 'ar',
  template_key TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  created_by   TEXT
);

CREATE TABLE IF NOT EXISTS recipient_group (
  id         TEXT PRIMARY KEY,
  name_ar    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipient (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES recipient_group(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES app_user(id),
  email       TEXT,
  kind        TEXT DEFAULT 'to'  -- to|cc
);

CREATE TABLE IF NOT EXISTS report_schedule (
  id             TEXT PRIMARY KEY,
  report_id      TEXT NOT NULL REFERENCES report_definition(id) ON DELETE CASCADE,
  recipient_group_id TEXT REFERENCES recipient_group(id),
  sector_id      TEXT,
  project_id     TEXT,
  frequency      TEXT NOT NULL,   -- daily|weekly|biweekly|monthly|quarterly|yearly|custom
  day_of_week    INTEGER,         -- 0-6 for weekly
  day_of_month   INTEGER,
  send_time      TEXT,            -- 'HH:MM'
  active         INTEGER NOT NULL DEFAULT 1,
  last_run_at    TEXT,
  next_run_at    TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_template (
  id           TEXT PRIMARY KEY,
  key          TEXT UNIQUE NOT NULL,
  name_ar      TEXT NOT NULL,
  subject_tpl  TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_queue (
  id           TEXT PRIMARY KEY,
  schedule_id  TEXT REFERENCES report_schedule(id),
  to_json      TEXT NOT NULL,     -- recipients resolved at enqueue time
  cc_json      TEXT,
  subject      TEXT,
  html         TEXT,
  status       TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED|SENDING|SENT|FAILED
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TEXT NOT NULL,
  sent_at      TEXT
);
CREATE INDEX IF NOT EXISTS ix_emailq_status ON email_queue(status);

CREATE TABLE IF NOT EXISTS email_log (
  id           TEXT PRIMARY KEY,
  queue_id     TEXT REFERENCES email_queue(id),
  event        TEXT,     -- enqueued|sent|failed|retried
  detail       TEXT,
  at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_snapshot (
  id           TEXT PRIMARY KEY,
  report_id    TEXT REFERENCES report_definition(id),
  scope_ref    TEXT,
  period_label TEXT,
  html         TEXT,
  data_json    TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT
);

CREATE TABLE IF NOT EXISTS kpi_definition (
  id           TEXT PRIMARY KEY,
  key          TEXT UNIQUE NOT NULL,
  name_ar      TEXT NOT NULL,
  name_en      TEXT,
  level        TEXT,
  unit         TEXT,
  direction    TEXT,     -- higher_better|lower_better
  rag_amber    REAL,
  rag_red      REAL,
  active       INTEGER NOT NULL DEFAULT 1
);

-- ─────────────────────────── Governance ───────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT,
  username    TEXT,
  role_id     TEXT,
  action      TEXT NOT NULL,   -- create|update|delete|approve|login|export|...
  resource    TEXT,
  resource_id TEXT,
  sector_id   TEXT,
  detail_json TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS ix_audit_resource ON audit_log(resource, resource_id);

CREATE TABLE IF NOT EXISTS ai_activity_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT,
  prompt      TEXT,
  intent      TEXT,            -- summarize|draft_email|suggest|apply_change
  applied     INTEGER NOT NULL DEFAULT 0,
  preview_json TEXT,
  approved_by TEXT
);

CREATE TABLE IF NOT EXISTS notification (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user(id),
  kind        TEXT,
  title       TEXT,
  body        TEXT,
  ref_resource TEXT,
  ref_id      TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notification(user_id, read_at);

-- schema version marker
CREATE TABLE IF NOT EXISTS schema_migration (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
