// Apply SQL migrations in order; idempotent (tracked in schema_migration).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, exec, get, run } from '../src/core/db/index.js';
import { ROOT } from '../src/core/config.js';
import { nowIso } from '../src/core/util/ids.js';

export function migrate() {
  db();
  exec(`CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const dir = resolve(ROOT, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    const done = get('SELECT version FROM schema_migration WHERE version = ?', [f]);
    if (done) continue;
    exec(readFileSync(resolve(dir, f), 'utf8'));
    run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', [f, nowIso()]);
    applied++;
    console.log('applied migration', f);
  }
  console.log(applied ? `✓ ${applied} migration(s) applied` : '✓ schema up to date');
}

if (import.meta.url === `file://${process.argv[1]}`) migrate();
