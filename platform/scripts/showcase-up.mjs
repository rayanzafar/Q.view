#!/usr/bin/env node
// showcase-up — نسخة سند قابلة للرمي، مبذورة ببيانات عرض غنية ومُختلَقة بالكامل، تُلتقط منها
// صور الشاشات لصفحة العرض. أختها الصغرى scripts/qa-up.mjs (نسخة الاستكشاف)، وتشترك معها في
// نفس عوازل الأمان: قاعدة SQLite مؤقتة (لا DATABASE_URL أبداً)، عنوان محلي، بلا بريد شبكي.
//
//   node --experimental-sqlite scripts/showcase-up.mjs [--port N]   # إقلاع + زرع
//   node scripts/showcase-up.mjs --down                             # إيقاف النسخة المسجَّلة
//
// الفرق عن qa-up: لا تُبذر بيانات العرض الثابتة (المعرّفات FX-) إطلاقاً — كل صفٍّ يظهر في
// الصور يُنشأ من خدمات المنصة نفسها في scripts/lib/seed-showcase.mjs. ويُكتب في ملف الحالة
// مفتاح `showcase` بمعرّفات البنود التي تفتحها سكربتات الالتقاط بأسمائها.
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildDb, freePort, waitReady, PLATFORM } from './lib/qa-instance.mjs';

const DEV_DB = resolve(PLATFORM, 'data', 'sanad.db');
const STATE_DIR = process.env.CLAUDE_SCRATCHPAD
  || join(tmpdir(), 'sanad-qa');
const STATE_FILE = join(STATE_DIR, 'showcase-instance.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const flagVal = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

async function down() {
  const st = readState();
  if (!st) { console.log('لا نسخة عرض مسجَّلة — لا شيء لإيقافه.'); return; }
  if (st.pid) {
    try { process.kill(st.pid, 'SIGTERM'); console.log(`أُوقفت النسخة (PID ${st.pid}).`); }
    catch (e) { if (e.code === 'ESRCH') console.log(`العملية ${st.pid} متوقفة أصلاً.`); else throw e; }
  }
  if (st.work && existsSync(st.work) && /sanad-showcase-/.test(st.work)) rmSync(st.work, { recursive: true, force: true });
  try { rmSync(STATE_FILE, { force: true }); } catch { /* ignore */ }
  console.log('نُظِّفت نسخة العرض القابلة للرمي.');
}

async function up() {
  // never let a showcase boot point at anything but a throwaway SQLite file
  if (process.env.DATABASE_URL) {
    console.error('ممنوع: DATABASE_URL مضبوط — نسخة العرض تعمل على SQLite رمي فقط، لا على قاعدة خارجية.');
    process.exit(2);
  }
  const work = mkdtempSync(join(tmpdir(), 'sanad-showcase-'));
  const dbPath = join(work, 'sanad.db');
  if (resolve(dbPath) === DEV_DB) { console.error('ممنوع: الوجهة قاعدة التطوير المعتادة.'); process.exit(2); }

  console.log(`بناء قاعدة عرض قابلة للرمي (بلا بيانات ثابتة) → ${dbPath}`);
  try { buildDb(dbPath, { fixture: false }); }
  catch (e) { console.error(`✗ ${e.message}`); rmSync(work, { recursive: true, force: true }); process.exit(1); }

  const port = Number(flagVal('--port')) || await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--experimental-sqlite', 'src/server.js'], {
    cwd: PLATFORM, detached: true, stdio: ['ignore', 'ignore', 'ignore'],
    // نفس العزل المعلَن في qa-up: قاعدة مؤقتة، عنوان محلي، وضع تطوير. بلا DATABASE_URL.
    env: { ...process.env, SANAD_DB: dbPath, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development', DATABASE_URL: '' },
  });
  child.unref();
  const die = (msg) => {
    console.error(`✗ ${msg}`);
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* ignore */ }
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  };
  try { await waitReady(base, child); } catch (e) { die(e.message); }

  // الزرع يقرأ الجداول مباشرةً لعدّها ولتأريخ ما لا خدمة له — فالوجهة تُعلَن قبل أي استيراد
  // يلتقط الإعدادات (config يقرأ SANAD_DB مرة واحدة عند تحميله).
  process.env.SANAD_DB = dbPath;
  console.log('زرع بيانات العرض عبر خدمات المنصة…');
  let out;
  try {
    const { seedShowcase } = await import('./lib/seed-showcase.mjs');
    out = await seedShowcase(base);
  } catch (e) { die(`تعذّر زرع بيانات العرض: ${e?.message || e}\n${e?.stack || ''}`); }

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({
    base, port, pid: child.pid, work, dbPath, fixture: false,
    startedAt: new Date().toISOString(),
    showcase: { base, ...out.showcase },
    counts: out.counts,
  }, null, 2));

  console.log(`\n✓ نسخة العرض جاهزة  (الزرع استغرق ${(out.ms / 1000).toFixed(1)} ثانية · ${out.calls} نداءً)`);
  console.log(`  العنوان : ${base}`);
  console.log(`  القاعدة : ${dbPath}`);
  console.log(`  PID     : ${child.pid}`);
  console.log(`  الحسابات: demo.<role> — كلمة المرور في scripts/seed.js`);
  console.log(`  الحالة  : ${STATE_FILE}`);

  console.log('\n  الصفوف:');
  const rows = Object.entries(out.counts);
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);

  console.log('\n  معرّفات اللقطات:');
  for (const [k, v] of Object.entries(out.showcase)) console.log(`    ${k.padEnd(20)} ${v}`);

  console.log(`\n  المسح السريع : node scripts/sweep.mjs ${base}`);
  console.log(`  الإيقاف      : node scripts/showcase-up.mjs --down`);
}

if (has('--down')) await down();
else await up();
