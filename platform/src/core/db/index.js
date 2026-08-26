// Database access layer — ASYNC, dual-driver.
//   • PostgreSQL (via `pg` Pool) when DATABASE_URL is set — production / staging / load.
//   • SQLite (node:sqlite, sync driver wrapped as async) otherwise — local dev + tests.
// Everything in the app MUST go through these helpers; never touch a driver directly.
// Transactions are connection-safe on Postgres via AsyncLocalStorage: inside tx(), the global
// helpers automatically route to the transaction's dedicated client.
import { config } from '../config.js';
// المُسجِّل وحده — لا يستورد قاعدة بيانات ولا إعداداً، فلا دورة استيراد.
import { logError, logInfo } from '../obs/log.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const USE_PG = !!config.databaseUrl;
// القرار الأخطر في زمن التشغيل كان صامتاً تماماً: أيّ محرّكٍ اختارته المنصة. سطرٌ واحد
// يجعل الحادثة التالية من هذا النوع تُشخَّص من السجل في عشر ثوانٍ بدل تخمين.
logInfo('db_driver', USE_PG ? { driver: 'postgres' } : { driver: 'sqlite', file: config.dbFile });
const txStore = new AsyncLocalStorage();

// undefined → null (drivers can't bind undefined); boolean → 0/1 (schema uses integer flags).
function norm(params) {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

// ── Postgres backend ──
let _pgPool = null;
async function pgPool() {
  if (_pgPool) return _pgPool;
  const pg = (await import('pg')).default;
  // Return BIGINT (int8, oid 20) as a JS number — halalas fit within Number.MAX_SAFE_INTEGER.
  pg.types.setTypeParser(20, (v) => (v == null ? null : parseInt(v, 10)));
  // NUMERIC (oid 1700) is the result type of SUM()/AVG() over BIGINT columns. node-postgres
  // returns it as a STRING to preserve arbitrary precision; parse to a JS number so financial
  // math (halalas sums) adds instead of string-concatenates and matches the SQLite driver.
  // Safe here: the schema stores no fixed-point NUMERIC columns — money is integer halalas,
  // percentages are DOUBLE PRECISION — so numeric only ever carries aggregate results.
  pg.types.setTypeParser(1700, (v) => (v == null ? null : parseFloat(v)));
  _pgPool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ...(process.env.PGSSL === 'require' ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  // An idle client killed by the SERVER (Postgres restart, Railway maintenance, an idle-session
  // timeout) makes node-postgres emit 'error' on the Pool. Unhandled, that is a throw on an
  // EventEmitter → uncaughtException → process.exit(1) → Railway restart, and Railway stops
  // restarting after `restartPolicyMaxRetries`. So a routine database restart could take the
  // platform down for good. Swallowing it here is correct: the pool discards the dead client by
  // itself and the next acquire reconnects; in-flight queries still reject through their own
  // call path and surface as a normal error. We log so the event is never silent.
  _pgPool.on('error', (err) => {
    logError('db_pool_error', {
      err_code: err?.code || null,
      err_msg: String(err?.message || err).slice(0, 200),
      total: _pgPool?.totalCount ?? null, idle: _pgPool?.idleCount ?? null, waiting: _pgPool?.waitingCount ?? null,
    });
  });
  return _pgPool;
}
// `?` placeholders → `$1,$2,…` (this app uses ? for bound values only — never inside SQL literals).
function toPg(sql) { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); }
async function pgQuery(sql, params) {
  const client = txStore.getStore();          // dedicated tx client if inside tx(), else the pool
  const runner = client || (await pgPool());
  return runner.query(toPg(sql), norm(params));
}

// ── SQLite backend (synchronous driver, wrapped to satisfy the async API) ──
let _sqlite = null;
async function sqliteDb() {
  if (_sqlite) return _sqlite;
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(config.dbFile), { recursive: true });
  _sqlite = new DatabaseSync(config.dbFile);
  _sqlite.exec('PRAGMA journal_mode = WAL;');
  _sqlite.exec('PRAGMA foreign_keys = ON;');
  _sqlite.exec('PRAGMA busy_timeout = 5000;');
  return _sqlite;
}

// ── Unified async query API ──
export async function all(sql, params = []) {
  if (USE_PG) return (await pgQuery(sql, params)).rows;
  return (await sqliteDb()).prepare(sql).all(...norm(params));
}
export async function get(sql, params = []) {
  if (USE_PG) return (await pgQuery(sql, params)).rows[0];
  return (await sqliteDb()).prepare(sql).get(...norm(params));
}
export async function run(sql, params = []) {
  if (USE_PG) { const r = await pgQuery(sql, params); return { changes: r.rowCount, rows: r.rows }; }
  const r = (await sqliteDb()).prepare(sql).run(...norm(params));
  return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
}
export async function exec(sql) {
  if (USE_PG) { await pgQuery(sql, []); return; }
  return (await sqliteDb()).exec(sql);
}

// Transaction. On Postgres, binds a dedicated pooled client for the duration via AsyncLocalStorage
// so every global helper call inside `fn` runs on the same connection (BEGIN…COMMIT/ROLLBACK).
//
// ── والمعاملة المتداخلة تنضمّ إلى أمّها، ولا تفتح ثانيةً ──────────────────────
// خدمةٌ تُغلِّف كتابتها بمعاملة، ثم تُنادى من خدمةٍ أخرى تُغلِّف كتابتها بمعاملة — وهذا يقع
// كلّما ركّبنا عملاً من أعمال (فوزُ فرصةٍ يُولِّد مشروعاً، وإضافةُ مخرجاتٍ دفعةً تنادي كاتب
// المخرَج الواحد). وكان لكلّ محرّك جوابه الخاطئ:
//   • سكويلايت يرمي «cannot start a transaction within a transaction» — عطلٌ صريح يُوقف العمل.
//   • وبوستجريس **أسوأ**: يطلب اتصالاً ثانياً من المجمّع فتُنفَّذ الكتابة الداخلية خارج معاملة
//     أمّها وتُثبَّت وحدها — فلو فشلت الأمّ بعدها وتراجعت، بقي نصفُ العمل مكتوباً بلا أن يرمي
//     شيءٌ خطأً. عطلٌ صامت يُنتج بياناتٍ نصفَ صحيحة، وهو أخطر ما في هذا الملف.
// وسلوك «تنضمّ إلى أمّها» هو ما يَعِد به رأس هذا الملف أصلاً، فصار مُنفَّذاً لا موصوفاً:
// المعاملة الخارجية وحدها تفتح وتُثبِّت وتتراجع، والداخلية تُنفَّذ في سياقها كما هي.
let sqliteTxDepth = 0;
export function inTransaction() { return USE_PG ? !!txStore.getStore() : sqliteTxDepth > 0; }
export async function tx(fn) {
  if (USE_PG) {
    if (txStore.getStore()) return await fn();   // منضمّة إلى معاملة قائمة على اتصالها نفسه
    const pool = await pgPool();
    const client = await pool.connect();
    return txStore.run(client, async () => {
      try { await client.query('BEGIN'); const r = await fn(); await client.query('COMMIT'); return r; }
      catch (e) { try { await client.query('ROLLBACK'); } catch { /* ignore */ } throw e; }
      finally { client.release(); }
    });
  }
  const d = await sqliteDb();
  if (sqliteTxDepth > 0) return await fn();      // اتصالٌ واحد، فالعمق يكفي للتمييز
  d.exec('BEGIN');
  sqliteTxDepth++;
  try { const r = await fn(); d.exec('COMMIT'); return r; }
  catch (e) { try { d.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
  finally { sqliteTxDepth--; }
}

export async function close() {
  if (USE_PG) { if (_pgPool) { await _pgPool.end(); _pgPool = null; } return; }
  if (_sqlite) { _sqlite.close(); _sqlite = null; }
}

// Readiness probe used by /ready — driver-agnostic.
export async function ping() { await get('SELECT 1 AS ok'); return true; }

// ── Object helpers (build parameterized SQL from an allowed-keys object) ──
export async function insert(table, obj) {
  const keys = Object.keys(obj);
  const cols = keys.join(', ');
  const ph = keys.map(() => '?').join(', ');
  return run(`INSERT INTO ${table} (${cols}) VALUES (${ph})`, keys.map((k) => obj[k]));
}
export async function update(table, id, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  return run(`UPDATE ${table} SET ${setClause} WHERE id = ?`, [...keys.map((k) => obj[k]), id]);
}
