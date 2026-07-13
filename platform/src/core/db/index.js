// Database access layer. Wraps node:sqlite (dev) behind a small, Postgres-portable API.
// The rest of the app must go through db.* — never touch the driver directly.
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let _db = null;

export function db() {
  if (_db) return _db;
  mkdirSync(dirname(config.dbFile), { recursive: true });
  _db = new DatabaseSync(config.dbFile);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA foreign_keys = ON;');
  _db.exec('PRAGMA busy_timeout = 5000;');
  return _db;
}

// node:sqlite cannot bind `undefined` — coerce to null. Also normalize booleans to 0/1.
function norm(params) {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

// Query helpers — parameterized only (no string interpolation of values anywhere).
export function all(sql, params = []) {
  return db().prepare(sql).all(...norm(params));
}
export function get(sql, params = []) {
  return db().prepare(sql).get(...norm(params));
}
export function run(sql, params = []) {
  return db().prepare(sql).run(...norm(params));
}
export function exec(sql) {
  return db().exec(sql);
}

// Transaction helper. node:sqlite has no built-in tx wrapper; we manage BEGIN/COMMIT.
export function tx(fn) {
  const d = db();
  d.exec('BEGIN');
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export function close() {
  if (_db) { _db.close(); _db = null; }
}

// Column list helper for safe INSERTs from an object of allowed keys.
export function insert(table, obj) {
  const keys = Object.keys(obj);
  const cols = keys.join(', ');
  const ph = keys.map(() => '?').join(', ');
  const vals = keys.map((k) => obj[k]);
  return run(`INSERT INTO ${table} (${cols}) VALUES (${ph})`, vals); // run() normalizes params
}

export function update(table, id, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const vals = keys.map((k) => obj[k]);
  return run(`UPDATE ${table} SET ${setClause} WHERE id = ?`, [...vals, id]);
}
