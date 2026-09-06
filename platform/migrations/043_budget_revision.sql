-- Annual targets already live in budget. Preserve all historical rows and values.
-- Optimistic concurrency prevents a stale editor from overwriting another revision.
ALTER TABLE budget ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_budget_sector_year ON budget(sector_id, fiscal_year);
