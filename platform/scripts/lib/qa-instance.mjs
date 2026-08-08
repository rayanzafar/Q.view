// Shared disposable-instance primitives: build a freshly seeded temp SQLite DB, find a free
// loopback port, and wait for /ready. Used by scripts/e2e.mjs (spec runner) and scripts/qa-up.mjs
// (named QA instance for agent-driven exploratory testing). Kept driver-agnostic of callers so the
// two entry points can never drift on how an instance comes up.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The seed pipeline for a throwaway instance. seed.js writes the 16 demo personas; seed-fixture
// adds deterministic business data (fixed FX- ids) so pages render non-empty. Optional scenario
// data (story-shaped, purge-registered) is appended when `scenarios` is true.
export function buildDb(dbPath, { scenarios = false } = {}) {
  const steps = ['scripts/migrate.js', 'scripts/seed-rbac.js', 'scripts/seed.js', 'scripts/lib/seed-fixture.mjs'];
  if (scenarios) steps.push('scripts/seed-scenarios.mjs');
  for (const s of steps) {
    const r = spawnSync(process.execPath, ['--experimental-sqlite', s], {
      cwd: PLATFORM, env: { ...process.env, SANAD_DB: dbPath }, encoding: 'utf8',
    });
    if (r.status !== 0) {
      const tail = (r.stderr || r.stdout || '').split('\n').slice(-12).join('\n');
      throw new Error(`seed step failed: ${s}\n${tail}`);
    }
  }
}

export const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

export async function waitReady(base, child, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (child && child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})`);
    try {
      const r = await fetch(base + '/ready', { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not become ready in time');
}
