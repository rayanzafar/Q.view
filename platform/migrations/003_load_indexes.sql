-- Hot-path indexes for production load. Derived from the actual query patterns in the CRM/PMO/
-- Finance/reporting modules — scope filters (sector/owner), the FK joins those reads perform, and
-- the collection→invoice join hit by every AR / collected-amount sum. Fills the gaps left by the
-- base schema (which already indexes sector_id / stage_id / status / project_id and a few others).
--
-- Partial `WHERE deleted_at IS NULL` on the soft-delete list tables so each index covers only live
-- rows: smaller, and it matches how every list/scope query filters. `CREATE INDEX IF NOT EXISTS`
-- and partial-index predicates are valid in BOTH PostgreSQL and SQLite, so this stays dual-driver.
-- Pure FK join keys are indexed in full (the joined side may not carry the deleted_at predicate).

-- Opportunity — own-scope "my pipeline" + report client joins (sector_id / stage_id already indexed)
CREATE INDEX IF NOT EXISTS ix_opp_owner   ON opportunity(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_opp_client  ON opportunity(client_id);

-- Project — PM/own scope, finance contract-value lookups, client joins (sector_id / status indexed)
CREATE INDEX IF NOT EXISTS ix_project_owner  ON project(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_project_client ON project(client_id);

-- Deliverable — sector-wide status/amount rollups (project_id already indexed)
CREATE INDEX IF NOT EXISTS ix_deliverable_sector ON deliverable(sector_id) WHERE deleted_at IS NULL;

-- Invoice — finance scope filter + project joins (status / owner_user_id / contract_id already indexed)
CREATE INDEX IF NOT EXISTS ix_invoice_sector  ON invoice(sector_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_invoice_project ON invoice(project_id);

-- Contract — had no indexes; scope + both join keys (by-contract / by-client finance views)
CREATE INDEX IF NOT EXISTS ix_contract_sector  ON contract(sector_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_contract_project ON contract(project_id);
CREATE INDEX IF NOT EXISTS ix_contract_client  ON contract(client_id);

-- Collection — every AR / collected sum joins collection → invoice on invoice_id
CREATE INDEX IF NOT EXISTS ix_collection_invoice ON collection(invoice_id);

-- Cost lines — per-project and per-sector/year financial rollups (had no indexes)
CREATE INDEX IF NOT EXISTS ix_costline_project     ON cost_line(project_id);
CREATE INDEX IF NOT EXISTS ix_costline_sector_year ON cost_line(sector_id, year);

-- Revenue lines — per-project joins (sector_id, year already indexed)
CREATE INDEX IF NOT EXISTS ix_revline_project ON revenue_line(project_id);

-- Allocations (staffing views) — had no indexes; project + employee + implicit sector via project
CREATE INDEX IF NOT EXISTS ix_alloc_project  ON allocation(project_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_alloc_employee ON allocation(employee_id) WHERE deleted_at IS NULL;
