#!/usr/bin/env node
// E2E runner — boots its own server on a free port with a freshly seeded temp DB, launches the
// preinstalled Chromium, then runs every spec in tests/e2e/*.spec.mjs sequentially with a shared
// browser. Each spec is a plain default-exported async function `(ctx) => {}` that reports through
// ctx.t.pass/fail (✓/✗ lines). The runner exits non-zero when any check fails.
//
//   node scripts/e2e.mjs             # all specs
//   node scripts/e2e.mjs rtl kanban  # only specs whose filename starts with these prefixes
//
// Browser resolution (sandbox has no downloads): /opt/pw-browsers/chromium-1194 first, then any
// chromium-*/chrome-linux/chrome under PLAYWRIGHT_BROWSERS_PATH (or /opt/pw-browsers).
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDb, freePort, waitReady } from './lib/qa-instance.mjs';

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// ── chromium executable ───────────────────────────────────────────────────────
export function chromiumPath() {
  const pinned = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (existsSync(pinned)) return pinned;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort()) {
      const p = join(root, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  } catch { /* fall through */ }
  return null; // let Playwright resolve its own bundled browser (CI path after `playwright install`)
}

// seeded temp DB + free port + /ready polling live in scripts/lib/qa-instance.mjs (shared with
// scripts/qa-up.mjs) so the two entry points build an instance identically.

// ── mini reporter ─────────────────────────────────────────────────────────────
function reporter() {
  let passed = 0, failed = 0;
  return {
    pass(name) { passed++; console.log(`  ✓ ${name}`); },
    fail(name, detail) { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); },
    get failed() { return failed; }, get passed() { return passed; },
  };
}

const isMain = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMain) {
  const work = mkdtempSync(join(tmpdir(), 'sanad-e2e-'));
  const dbPath = join(work, 'sanad.db');
  console.log(`building seeded DB → ${dbPath}`);
  try { buildDb(dbPath); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--experimental-sqlite', 'src/server.js'], {
    cwd: PLATFORM, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SANAD_DB: dbPath, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development' },
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });
  await waitReady(base, child);
  console.log(`server ready at ${base}`);

  const { chromium } = await import('playwright');
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  console.log(`chromium: ${exe || '(playwright-managed)'}\n`);

  const specDir = resolve(PLATFORM, 'tests/e2e');
  const specs = readdirSync(specDir).filter((f) => f.endsWith('.spec.mjs')).sort()
    .filter((f) => !only.length || only.some((o) => f.startsWith(o)));
  if (!specs.length) { console.error('no specs matched'); process.exit(2); }

  const t = reporter();
  let crashed = false;
  for (const f of specs) {
    console.log(`── ${basename(f, '.spec.mjs')} ──`);
    try {
      const mod = await import(join(specDir, f));
      await mod.default({ browser, base, t, platformRoot: PLATFORM });
    } catch (e) {
      crashed = true;
      t.fail(`${f} crashed`, e.message);
      console.error(e.stack);
    }
  }

  await browser.close();
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));
  rmSync(work, { recursive: true, force: true });

  console.log(`\n${t.failed || crashed ? '✗' : '✓'} e2e: ${t.passed} passed, ${t.failed} failed (${specs.length} specs)`);
  if (t.failed || crashed) {
    if (serverLog.match(/\[error\]/)) console.error('\nserver errors during run:\n' + serverLog.split('\n').filter((l) => l.includes('[error]')).join('\n'));
    process.exit(1);
  }
}
