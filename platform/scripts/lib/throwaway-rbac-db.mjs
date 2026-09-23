// Import side-effect: default SANAD_DB to a throwaway path BEFORE any app module loads.
// Standalone scripts that only need the RBAC grant cache (e.g. scripts/sweep.mjs) import app
// modules whose config snapshots `dbFile` from process.env.SANAD_DB at evaluation time. ES imports
// are hoisted, so a guard placed in code runs too late — config would have already snapshotted
// data/sanad.db (the team's dev DB) and the script's migrate/seed would churn it. Importing THIS
// module first (before any app import) sets the default early, so config snapshots the throwaway.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.SANAD_DB) {
  process.env.SANAD_DB = join(mkdtempSync(join(tmpdir(), 'sanad-rbac-')), 'rbac.db');
}
