#!/usr/bin/env node
// qa-up — bring up (or tear down) a disposable, fully-seeded local Sanad instance for agent-driven
// exploratory QA. It is air-gapped by construction: temp SQLite (never DATABASE_URL), loopback host,
// mail 'preview' (writes files, no network), AI local engine. It never touches the team's dev DB
// (data/sanad.db) or any live environment.
//
//   node scripts/qa-up.mjs [--scenarios] [--port N]   # boot; prints base URL, DB path, PID
//   node scripts/qa-up.mjs --down                      # stop the instance recorded in the state file
//
// State (base URL, PID, temp dir, DB path) is written to the session scratchpad so a follow-up
// --down — or an agent reading it — can find the running instance. Demo personas: demo.<role>
// (16 roles), password from scripts/seed.js (do not hardcode). Business data: seed-fixture, plus
// story-shaped scenario data with --scenarios.
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildDb, freePort, waitReady, PLATFORM } from './lib/qa-instance.mjs';

const DEV_DB = resolve(PLATFORM, 'data', 'sanad.db');
const STATE_DIR = process.env.CLAUDE_SCRATCHPAD
  || join(tmpdir(), 'sanad-qa');
const STATE_FILE = join(STATE_DIR, 'qa-instance.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const flagVal = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

async function down() {
  const st = readState();
  if (!st) { console.log('لا نسخة QA مسجَّلة — لا شيء لإيقافه.'); return; }
  if (st.pid) {
    try { process.kill(st.pid, 'SIGTERM'); console.log(`أُوقفت النسخة (PID ${st.pid}).`); }
    catch (e) { if (e.code === 'ESRCH') console.log(`العملية ${st.pid} متوقفة أصلاً.`); else throw e; }
  }
  if (st.work && existsSync(st.work) && /sanad-qa-/.test(st.work)) rmSync(st.work, { recursive: true, force: true });
  try { rmSync(STATE_FILE, { force: true }); } catch { /* ignore */ }
  console.log('نُظِّفت النسخة القابلة للرمي.');
}

async function up() {
  // never let a QA boot point at anything but a throwaway SQLite file
  if (process.env.DATABASE_URL) {
    console.error('ممنوع: DATABASE_URL مضبوط — نسخة QA تعمل على SQLite رمي فقط، لا على قاعدة خارجية.');
    process.exit(2);
  }
  const scenarios = has('--scenarios');
  const work = mkdtempSync(join(tmpdir(), 'sanad-qa-'));
  const dbPath = join(work, 'sanad.db');
  if (resolve(dbPath) === DEV_DB) { console.error('ممنوع: الوجهة قاعدة التطوير المعتادة.'); process.exit(2); }

  console.log(`بناء قاعدة مبذورة قابلة للرمي → ${dbPath}${scenarios ? ' (+سيناريوهات)' : ''}`);
  try { buildDb(dbPath, { scenarios }); } catch (e) { console.error(`✗ ${e.message}`); rmSync(work, { recursive: true, force: true }); process.exit(1); }

  const port = Number(flagVal('--port')) || await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--experimental-sqlite', 'src/server.js'], {
    cwd: PLATFORM, detached: true, stdio: ['ignore', 'ignore', 'ignore'],
    // explicit air-gap: SQLite temp DB, loopback, dev mode. No DATABASE_URL / AI_ENGINE / MAIL_TRANSPORT.
    env: { ...process.env, SANAD_DB: dbPath, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development', DATABASE_URL: '' },
  });
  child.unref();
  try { await waitReady(base, child); }
  catch (e) { console.error(`✗ ${e.message}`); try { process.kill(child.pid, 'SIGTERM'); } catch { /* ignore */ } rmSync(work, { recursive: true, force: true }); process.exit(1); }

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ base, port, pid: child.pid, work, dbPath, scenarios, startedAt: new Date().toISOString() }, null, 2));

  console.log(`\n✓ نسخة QA جاهزة`);
  console.log(`  العنوان : ${base}`);
  console.log(`  القاعدة : ${dbPath}`);
  console.log(`  PID     : ${child.pid}`);
  console.log(`  الحسابات: demo.<role> (16 دوراً) — كلمة المرور في scripts/seed.js`);
  console.log(`  الحالة  : ${STATE_FILE}`);
  console.log(`\n  المسح السريع : node scripts/sweep.mjs ${base}`);
  console.log(`  الإيقاف      : node scripts/qa-up.mjs --down`);
}

if (has('--down')) await down();
else await up();
