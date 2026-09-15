// النسخة الاحتياطية المنطقية ووسيلة استعادتها (خطّ النشر يأخذها حين يتعذّر pg_dump):
//   • dump.js يُنتج ترويسةً وعداداتٍ وصفوفاً؛ restore-dump.mjs يعيدها فوق قاعدة مُرحَّلة فتتطابق العدادات
//     والصفوف حرفاً.
//   • schema_migration لا تُستبدل (المخطط مخطط الهدف)، وأختام العمليات تُضاف إن غابت.
//   • --verify-only لا يكتب شيئاً، ونسخةٌ بعمود لا يعرفه الهدف تُرفض قبل أي حذف.
//   • جرد الترحيلات يقرأ المطبَّق من النسخة ويسمّي المعلَّق ويعلّم تعديل البيانات فيه (KI-111).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-restore-'));
const SRC = join(dir, 'src.db'); const DST = join(dir, 'dst.db');
process.env.SANAD_DB = SRC;
const ROOT = new URL('../..', import.meta.url).pathname;
const nodeRun = (script, args, env) => execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });

let db, dumpFile;
const T = new Date().toISOString();

before(async () => {
  for (const f of [SRC, DST]) nodeRun('scripts/migrate.js', [], { SANAD_DB: f });
  nodeRun('scripts/seed-rbac.js', [], { SANAD_DB: SRC });
  db = await import('../../src/core/db/index.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('client', { id: 'c1', name_ar: 'جهة «الاختبار» — تحوي "علامات"', created_at: T });
  await db.insert('project', { id: 'p1', name_ar: 'مشروع الاستعادة', sector_id: 'SOL', client_id: 'c1', status: 'IN_PROGRESS', contract_value_halalas: 123456789, created_at: T });
  await db.run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', ['op:test-stamp', T]);
  const { dumpLines } = await import('../../src/core/backup/dump.js');
  const lines = []; for await (const l of dumpLines()) lines.push(l);
  dumpFile = join(dir, 'dump.ndjson');
  writeFileSync(dumpFile, lines.join('\n') + '\n');
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('الاستعادة فوق قاعدة مُرحَّلة فارغة تعيد العدادات والصفوف حرفاً، وتُبقي ترحيلات الهدف وتضيف الأختام', async () => {
  const out = nodeRun('scripts/restore-dump.mjs', [dumpFile], { SANAD_DB: DST });
  assert.match(out, /✓ restore:/);
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(DST);
  const c = (sql) => Number(d.prepare(sql).get().n);
  assert.equal(c('SELECT COUNT(*) n FROM project'), 1);
  assert.equal(c('SELECT COUNT(*) n FROM client'), 1);
  const p = d.prepare('SELECT name_ar, contract_value_halalas, client_id FROM project WHERE id = ?').get('p1');
  assert.equal(p.name_ar, 'مشروع الاستعادة'); assert.equal(Number(p.contract_value_halalas), 123456789); assert.equal(p.client_id, 'c1');
  assert.equal(d.prepare('SELECT name_ar FROM client WHERE id = ?').get('c1').name_ar, 'جهة «الاختبار» — تحوي "علامات"');
  // المنح (seed-rbac) استُعيدت بعددها في المصدر
  const srcDb = new DatabaseSync(SRC);
  assert.equal(c('SELECT COUNT(*) n FROM role_permission'), Number(srcDb.prepare('SELECT COUNT(*) n FROM role_permission').get().n));
  // schema_migration: كل ترحيلات الهدف باقية (لا نقص) + ختم العملية أُضيف
  const migCount = Number(srcDb.prepare("SELECT COUNT(*) n FROM schema_migration WHERE version NOT LIKE 'op:%'").get().n);
  assert.equal(c("SELECT COUNT(*) n FROM schema_migration WHERE version NOT LIKE 'op:%'"), migCount);
  assert.equal(c("SELECT COUNT(*) n FROM schema_migration WHERE version = 'op:test-stamp'"), 1);
  srcDb.close(); d.close();
});

test('--verify-only لا يكتب، ونسخة بعمود مجهول تُرفض قبل أي حذف', async () => {
  const DST2 = join(dir, 'dst2.db');
  nodeRun('scripts/migrate.js', [], { SANAD_DB: DST2 });
  const out = nodeRun('scripts/restore-dump.mjs', [dumpFile, '--verify-only'], { SANAD_DB: DST2 });
  assert.match(out, /المطابقة سليمة/);
  const { DatabaseSync } = await import('node:sqlite');
  let d = new DatabaseSync(DST2);
  assert.equal(Number(d.prepare('SELECT COUNT(*) n FROM project').get().n), 0, 'التحقق لا يكتب');
  d.close();
  // نسخة معطوبة: عمود لا يعرفه الهدف — تُرفض ولا تفرغ الجداول الموجودة
  nodeRun('scripts/restore-dump.mjs', [dumpFile], { SANAD_DB: DST2 });
  const bad = join(dir, 'bad.ndjson');
  writeFileSync(bad, [JSON.stringify({ _meta: 'sanad-backup', version: 1, at: T, driver: 'sqlite', tables: ['project'] }),
    JSON.stringify({ _table: 'project', _rows: 1 }), JSON.stringify({ t: 'project', r: { id: 'x', name_ar: 'y', ghost_column: 1 } })].join('\n') + '\n');
  assert.throws(() => nodeRun('scripts/restore-dump.mjs', [bad], { SANAD_DB: DST2 }), /ghost_column|لا تطابق/);
  d = new DatabaseSync(DST2);
  assert.equal(Number(d.prepare('SELECT COUNT(*) n FROM project').get().n), 1, 'الرفض لا يمسّ الصفوف القائمة');
  d.close();
});

test('جرد الترحيلات من النسخة: المطبَّق والمعلَّق وأختام العمليات وإشارات تعديل البيانات (KI-111)', async () => {
  const { inventoryFromDump, dmlSignals, formatInventory } = await import('../../scripts/migration-inventory.mjs');
  const inv = await inventoryFromDump(dumpFile, join(ROOT, 'migrations'));
  assert.equal(inv.pending.length, 0, 'المصدر مُرحَّل بالكامل');
  assert.ok(inv.stamps.includes('op:test-stamp'));
  // دليل ترحيلات مصطنع: واحدة معلَّقة تحمل تعديل بيانات
  const mig = join(dir, 'migrations'); mkdirSync(mig);
  writeFileSync(join(mig, '001_init.sql'), 'CREATE TABLE x (id TEXT);');
  writeFileSync(join(mig, '999_fix.sql'), "-- تعليق: UPDATE لا يُحتسب\n/* DELETE FROM x; */\nALTER TABLE x ADD COLUMN y TEXT;\nUPDATE x SET y = 'a';\n");
  const inv2 = await inventoryFromDump(dumpFile, mig);
  assert.deepEqual(inv2.pending, ['999_fix.sql']);
  assert.deepEqual(Object.keys(inv2.dml), ['999_fix.sql']);
  assert.equal(inv2.dml['999_fix.sql'].length, 1);
  assert.match(formatInventory(inv2), /يحمل تعديل بيانات/);
  assert.deepEqual(dmlSignals('INSERT INTO a VALUES (1); -- DELETE\nSELECT 1;'), ['INSERT INTO a VALUES (1);']);
});
