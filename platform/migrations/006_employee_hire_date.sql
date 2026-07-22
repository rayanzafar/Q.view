-- 006: Employee hire date — start-of-employment date managed from the team page («الفريق»).
-- Portable subset (SQLite + Postgres via migrate.js pgify). ISO-8601 date TEXT (yyyy-mm-dd),
-- nullable because legacy/imported staff rows may not carry a known hire date.
ALTER TABLE employee ADD COLUMN hire_date TEXT;
