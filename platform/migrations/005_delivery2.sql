-- 005: Delivery-2 tables — CRM activity stream, import center runs, saved views, documents.
-- Portable subset (SQLite + Postgres via migrate.js pgify). Money INTEGER halalas, time ISO TEXT,
-- soft-delete deleted_at. crm_activity.legacy_id makes the legacy backfill idempotent (INSERT-only).

CREATE TABLE IF NOT EXISTS crm_activity (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- call|meeting|email|note|visit|proposal|update|other
  at TEXT NOT NULL,
  actor_user_id TEXT REFERENCES app_user(id),
  actor_name TEXT,
  client_id TEXT REFERENCES client(id),
  opportunity_id TEXT REFERENCES opportunity(id),
  project_id TEXT REFERENCES project(id),
  sector_id TEXT REFERENCES sector(id),
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL DEFAULT 'app',    -- legacy|app|import
  legacy_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_act_client ON crm_activity(client_id, at);
CREATE INDEX IF NOT EXISTS ix_act_opp ON crm_activity(opportunity_id, at);
CREATE INDEX IF NOT EXISTS ix_act_project ON crm_activity(project_id, at);
CREATE INDEX IF NOT EXISTS ix_act_sector ON crm_activity(sector_id, at);

CREATE TABLE IF NOT EXISTS import_run (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                -- opportunities|projects|clients|employees|staffing|revenues|legacy
  mode TEXT NOT NULL,                -- add|upsert|replace
  status TEXT NOT NULL,              -- uploaded|previewed|applied|undone|failed|discarded
  file_name TEXT,
  file_hash TEXT,
  payload_json TEXT,                 -- normalized {headers, rows} snapshot (raw file is not kept)
  mapping_json TEXT,
  counts_json TEXT,
  error TEXT,
  by_user_id TEXT NOT NULL REFERENCES app_user(id),
  sector_id TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  undone_at TEXT,
  undo_expires_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_import_run_type ON import_run(type, created_at);

CREATE TABLE IF NOT EXISTS import_row (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES import_run(id),
  row_no INTEGER NOT NULL,
  action TEXT NOT NULL,              -- create|update|skip|error
  resource TEXT,
  resource_id TEXT,
  before_json TEXT,
  after_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS ix_import_row_run ON import_row(run_id);
CREATE INDEX IF NOT EXISTS ix_import_row_res ON import_row(resource, resource_id);

CREATE TABLE IF NOT EXISTS saved_view (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  page TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  params_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_saved_view_user ON saved_view(user_id, page);

CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES client(id),
  project_id TEXT REFERENCES project(id),
  opportunity_id TEXT REFERENCES opportunity(id),
  name TEXT NOT NULL,
  kind TEXT,                          -- contract|proposal|report|letter|other
  url TEXT,
  note TEXT,
  size_bytes INTEGER,
  uploaded_by TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_document_client ON document(client_id);
