// استعادة نسخة احتياطية منطقية — ملف NDJSON كما يُنتجه `/api/backup/dump` (src/core/backup/dump.js) —
// فوق قاعدة **مُرحَّلة** (scripts/migrate.js). هذه وسيلة الاستعادة المقابلة لنسخة «مسار التطبيق»
// التي يأخذها خطّ النشر حين يتعذّر pg_dump (منفذ القاعدة غير مبلوغ من بيئة التطوير).
//
// ما تفعله: تفرغ كل جدولٍ وارد في النسخة ثم تعيد صفوفه كما هي، داخل معاملة واحدة، ثم تتحقق من
// تطابق العدادات مع ترويسة النسخة. جدول `schema_migration` استثناء: لا يُفرَّغ ولا تُستبدل صفوفه —
// المخطط مخطط الهدف، ولو أعدنا قائمة ترحيلات أقدم لأعاد الإقلاع تطبيق ترحيلاتٍ مطبَّقة ثم توقّف.
// أختامُ العمليات (`op:…`) تُضاف إن غابت فقط.
//
// الاستعمال:
//   SANAD_DB=<هدف.db> node --experimental-sqlite scripts/restore-dump.mjs <dump.ndjson> [--verify-only]
//   DATABASE_URL=<هدف postgres> node --experimental-sqlite scripts/restore-dump.mjs <dump.ndjson>
// `--verify-only` يقرأ النسخة ويطابق جداولها وأعمدتها مع الهدف بلا كتابة.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { all, get, run, exec, tx, close } from '../src/core/db/index.js';
import { config } from '../src/core/config.js';

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SKIP_TRUNCATE = new Set(['schema_migration']);

/** يقرأ النسخة سطراً سطراً: الترويسة، وعدادات الجداول، والصفوف مجمَّعةً بجدولها. */
export async function readDump(file) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header = null; const counts = {}; const rows = new Map();
  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (!header) {
      if (o._meta !== 'sanad-backup') throw new Error('الملف ليس نسخة احتياطية من سند (الترويسة مفقودة)');
      header = o; continue;
    }
    if (o._table) { counts[o._table] = Number(o._rows) || 0; if (!rows.has(o._table)) rows.set(o._table, []); continue; }
    if (o.t && o.r) { if (!rows.has(o.t)) rows.set(o.t, []); rows.get(o.t).push(o.r); }
  }
  if (!header) throw new Error('النسخة فارغة');
  return { header, counts, rows };
}

async function targetTables() {
  if (config.databaseUrl) {
    return (await all("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'")).map((r) => r.name);
  }
  return (await all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name);
}
async function targetColumns(table) {
  if (config.databaseUrl) {
    return (await all('SELECT column_name AS name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?', ['public', table])).map((r) => r.name);
  }
  return (await all(`PRAGMA table_info(${table})`)).map((r) => r.name);
}

/** ترتيب الإدراج على PostgreSQL: الآباء قبل الأبناء بحسب المفاتيح الأجنبية (Kahn)؛ الدورات تُلحق آخراً. */
async function insertionOrder(tables) {
  if (!config.databaseUrl) return tables;
  const edges = await all(`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
      FROM pg_constraint c WHERE c.contype = 'f'`);
  const set = new Set(tables); const indeg = new Map(tables.map((t) => [t, 0])); const out = new Map(tables.map((t) => [t, []]));
  for (const e of edges) {
    const child = e.child.replace(/^public\./, '').replace(/"/g, ''); const parent = e.parent.replace(/^public\./, '').replace(/"/g, '');
    if (!set.has(child) || !set.has(parent) || child === parent) continue;
    out.get(parent).push(child); indeg.set(child, indeg.get(child) + 1);
  }
  const ready = tables.filter((t) => indeg.get(t) === 0).sort(); const ordered = [];
  while (ready.length) {
    const t = ready.shift(); ordered.push(t);
    for (const c of out.get(t)) { indeg.set(c, indeg.get(c) - 1); if (indeg.get(c) === 0) ready.push(c); }
  }
  for (const t of tables) if (!ordered.includes(t)) ordered.push(t);   // دورة مرجعية — تُلحق كما هي
  return ordered;
}

/**
 * يطابق النسخة مع الهدف بلا كتابة: جداول غائبة، أعمدة غائبة، وعدادات الترويسة مقابل الصفوف المقروءة.
 * يعيد { ok, problems[], tables[] } — الجداول التي ستُستعاد.
 */
export async function verifyDump(dump) {
  const problems = [];
  const have = new Set(await targetTables());
  const tables = [];
  for (const [t, list] of dump.rows) {
    if (!SAFE_IDENT.test(t)) { problems.push(`اسم جدول غير صالح في النسخة: ${t}`); continue; }
    if ((dump.counts[t] ?? 0) !== list.length) problems.push(`${t}: الترويسة تقول ${dump.counts[t]} صفاً والملف يحوي ${list.length}`);
    if (!have.has(t)) { problems.push(`${t}: غير موجود في الهدف — الجدول يُتخطّى (المخطط مخطط الهدف)`); continue; }
    if (list.length) {
      const cols = new Set(await targetColumns(t));
      const missing = [...new Set(list.flatMap((r) => Object.keys(r)))].filter((c) => !cols.has(c));
      if (missing.length) problems.push(`${t}: أعمدة في النسخة لا يعرفها الهدف: ${missing.join('، ')}`);
    }
    tables.push(t);
  }
  return { ok: !problems.some((p) => !p.includes('يُتخطّى')), problems, tables };
}

/** الاستعادة نفسها — معاملة واحدة، ثم مطابقة العدادات. يعيد { restored: {table: n}, skipped[] }. */
export async function restoreDump(dump, { log = () => {} } = {}) {
  const v = await verifyDump(dump);
  if (!v.ok) throw new Error('النسخة لا تطابق الهدف:\n' + v.problems.join('\n'));
  const order = await insertionOrder(v.tables);
  const skipped = v.problems.filter((p) => p.includes('يُتخطّى'));
  if (!config.databaseUrl) await exec('PRAGMA foreign_keys = OFF');
  const restored = {};
  await tx(async () => {
    for (const t of [...order].reverse()) if (!SKIP_TRUNCATE.has(t)) await run(`DELETE FROM ${t}`);
    for (const t of order) {
      const list = dump.rows.get(t) || [];
      const stamps = t === 'schema_migration';
      let n = 0;
      for (const r of list) {
        const keys = Object.keys(r).filter((k) => SAFE_IDENT.test(k));
        if (stamps) {
          if (!String(r.version || '').startsWith('op:')) continue;   // الترحيلات نفسها من الهدف لا من النسخة
          const exists = await get('SELECT version FROM schema_migration WHERE version = ?', [r.version]);
          if (exists) continue;
        }
        await run(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => r[k]));
        n++;
      }
      restored[t] = n;
      log(`${t}: ${n}`);
    }
  });
  if (!config.databaseUrl) await exec('PRAGMA foreign_keys = ON');
  // المطابقة بعد الكتابة: كل جدول مستعاد يحمل عدد صفوف النسخة بالضبط
  const mismatches = [];
  for (const t of order) {
    if (SKIP_TRUNCATE.has(t)) continue;
    const n = Number((await get(`SELECT COUNT(*) AS n FROM ${t}`)).n) || 0;
    if (n !== (dump.counts[t] || 0)) mismatches.push(`${t}: ${n} ≠ ${dump.counts[t] || 0}`);
  }
  if (mismatches.length) throw new Error('العدادات بعد الاستعادة لا تطابق النسخة:\n' + mismatches.join('\n'));
  if (config.databaseUrl) {
    // تسلسلات PostgreSQL (إن وُجدت أعمدة تسلسلية) تُضبط بعد الإدراج الصريح للمفاتيح
    const seqs = await all(`SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col FROM pg_class s
        JOIN pg_depend d ON d.objid = s.oid JOIN pg_class t ON d.refobjid = t.oid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE s.relkind = 'S'`);
    for (const s of seqs) {
      if (![s.seq, s.tbl, s.col].every((x) => SAFE_IDENT.test(x))) continue;
      await run(`SELECT setval('${s.seq}', COALESCE((SELECT MAX(${s.col}) FROM ${s.tbl}), 0) + 1, false)`);
    }
  }
  return { restored, skipped };
}

const isMain = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMain) {
  const file = process.argv[2];
  if (!file) { console.error('الاستعمال: node --experimental-sqlite scripts/restore-dump.mjs <dump.ndjson> [--verify-only]'); process.exit(2); }
  const verifyOnly = process.argv.includes('--verify-only');
  try {
    const dump = await readDump(resolve(file));
    console.log(`ℹ نسخة ${dump.header.at} (${dump.header.driver}) — ${Object.keys(dump.counts).length} جدولاً، ${Object.values(dump.counts).reduce((a, b) => a + b, 0)} صفاً`);
    console.log(`ℹ الهدف: ${config.databaseUrl ? 'postgres' : config.dbFile}`);
    const v = await verifyDump(dump);
    for (const p of v.problems) console.log('  ⚠ ' + p);
    if (!v.ok) { console.error('✗ النسخة لا تطابق الهدف — لا استعادة'); process.exit(1); }
    if (verifyOnly) { console.log('✓ المطابقة سليمة (بلا كتابة)'); await close(); process.exit(0); }
    const r = await restoreDump(dump);
    const total = Object.values(r.restored).reduce((a, b) => a + b, 0);
    console.log(`✓ restore: ${Object.keys(r.restored).length} جدولاً، ${total} صفاً${r.skipped.length ? ` — تُخطّي: ${r.skipped.length}` : ''}`);
    await close();
  } catch (e) { console.error('✗ ' + (e?.message || e)); process.exit(1); }
}
