// Backup the SQLite DB to a timestamped file and verify integrity.
// Prod (Postgres) uses pg_dump — see docs/guides/DEPLOYMENT.md. This is the dev/staging backup.
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, ROOT } from '../src/core/config.js';
import { DatabaseSync } from 'node:sqlite';

export function backup(stamp) {
  if (!existsSync(config.dbFile)) throw new Error('DB file not found: ' + config.dbFile);
  const dir = resolve(ROOT, 'data/backups');
  mkdirSync(dir, { recursive: true });
  const ts = stamp || new Date().toISOString().replace(/[:.]/g, '-');
  const dest = resolve(dir, `sanad-${ts}.db`);
  copyFileSync(config.dbFile, dest);
  // verify: open the copy and run integrity_check
  const d = new DatabaseSync(dest);
  const r = d.prepare('PRAGMA integrity_check').get();
  d.close();
  const ok = r && (r.integrity_check === 'ok' || Object.values(r)[0] === 'ok');
  console.log(`✓ backup → ${dest} (${statSync(dest).size} bytes) · integrity=${ok ? 'ok' : 'FAILED'}`);
  if (!ok) throw new Error('backup integrity check failed');
  return dest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // stamp must be passed in (Date.now unavailable in workflow ctx, but fine here)
  backup(process.argv[2]);
}
