// جرد الترحيلات على بيئةٍ حيّة من نسختها الاحتياطية المنطقية (KI-111): ما طُبّق فعلاً (جدول
// `schema_migration` داخل النسخة) مقابل ما في المستودع، وأي ترحيلة **معلَّقة** تحمل تعديل بيانات
// (INSERT/UPDATE/DELETE) فتستحق مراجعة سجلاً سجلاً قبل الإصدار — لا تطبيقاً أعمى عند الإقلاع.
//
// الاستعمال: node scripts/migration-inventory.mjs <dump.ndjson> [--migrations <dir>]
// ويستدعيه خطّ النشر بعد النسخة الاحتياطية ليطبع الجرد قبل الرفع.
import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';

/** أسطر تعديل البيانات في ملف SQL خارج التعليقات (فحص نصّي — إشارة للمراجعة لا حكماً). */
export function dmlSignals(sqlText) {
  const out = [];
  let inBlock = false;
  for (const raw of String(sqlText || '').split('\n')) {
    let line = raw;
    if (inBlock) { const e = line.indexOf('*/'); if (e < 0) continue; line = line.slice(e + 2); inBlock = false; }
    const b = line.indexOf('/*');
    if (b >= 0) { const rest = line.slice(b + 2); const e = rest.indexOf('*/'); line = line.slice(0, b) + (e >= 0 ? rest.slice(e + 2) : ''); inBlock = e < 0; }
    const c = line.indexOf('--'); if (c >= 0) line = line.slice(0, c);
    const t = line.trim();
    if (/^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i.test(t)) out.push(t.slice(0, 120));
  }
  return out;
}

/** يقرأ صفوف schema_migration من النسخة بلا تحميل بقية الجداول. */
export async function appliedVersionsFromDump(file) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  const applied = new Set(); let header = null; let inTable = false;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) { header = JSON.parse(line); if (header._meta !== 'sanad-backup') throw new Error('الملف ليس نسخة احتياطية من سند'); continue; }
    if (line.startsWith('{"_table":')) { inTable = JSON.parse(line)._table === 'schema_migration'; continue; }
    if (!inTable) continue;
    const o = JSON.parse(line);
    if (o.t === 'schema_migration' && o.r?.version) applied.add(String(o.r.version));
  }
  return { at: header?.at || null, driver: header?.driver || null, applied };
}

/** الجرد: المطبَّق والمعلَّق والأختام، مع إشارات تعديل البيانات في المعلَّق. */
export async function inventoryFromDump(file, migrationsDir) {
  const { at, driver, applied } = await appliedVersionsFromDump(file);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));
  const stamps = [...applied].filter((v) => !files.includes(v)).sort();
  const dml = {};
  for (const f of pending) {
    const sig = dmlSignals(readFileSync(join(migrationsDir, f), 'utf8'));
    if (sig.length) dml[f] = sig;
  }
  return { at, driver, appliedCount: files.length - pending.length, total: files.length, pending, stamps, dml };
}

export function formatInventory(inv) {
  const lines = [`ℹ جرد الترحيلات من نسخة ${inv.at || '?'} (${inv.driver || '?'}): مطبَّق ${inv.appliedCount}/${inv.total}`];
  lines.push(inv.pending.length ? `  معلَّق على البيئة: ${inv.pending.join('، ')}` : '  لا ترحيلات معلَّقة');
  for (const [f, sig] of Object.entries(inv.dml)) {
    lines.push(`  ⚠ ${f} يحمل تعديل بيانات (${sig.length} أمراً) — راجعه سجلاً سجلاً قبل الإصدار:`);
    for (const s of sig.slice(0, 5)) lines.push(`      ${s}`);
  }
  if (inv.stamps.length) lines.push(`  أختام عمليات على البيئة: ${inv.stamps.length}`);
  return lines.join('\n');
}

const isMain = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMain) {
  const file = process.argv[2];
  if (!file) { console.error('الاستعمال: node scripts/migration-inventory.mjs <dump.ndjson> [--migrations <dir>]'); process.exit(2); }
  const mi = process.argv.indexOf('--migrations');
  const dir = mi > 0 ? resolve(process.argv[mi + 1]) : resolve(new URL('../migrations', import.meta.url).pathname);
  try { console.log(formatInventory(await inventoryFromDump(resolve(file), dir))); }
  catch (e) { console.error('✗ ' + (e?.message || e)); process.exit(1); }
}
