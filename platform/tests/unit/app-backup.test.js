// النسخة المنطقية المستخرَجة من خطّ النشر (scripts/lib/app-backup.mjs):
//   • المطابقة على مستويين: المعلَن في الملف = ما وصل، وعدادات الخادم = ما في الملف
//     (سجل التدقيق يُلحَق فقط فيُقبل نموّه بأربعة أسطر لا أكثر).
//   • اسم الملف يبقى كما كان بلا وسم، ويحمل الوسم حين يُمرَّر.
//   • الصيغة نفسها التي تقرؤها scripts/restore-dump.mjs — وإلا فالنسخة غير قابلة للاستعادة.
//   • المدخل المستقل يرفض بلا SANAD_RELEASE=1 قبل أي طلب شبكة.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyBackup, backupFileName } from '../../scripts/lib/app-backup.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const T = '2026-09-14T00:00:00.000Z';
// نسخة مصطنعة بصيغة src/core/backup/dump.js حرفاً: ترويسة، ثم لكل جدول سطر عدّاد ثم صفوفه.
const dumpOf = (tables) => [
  JSON.stringify({ _meta: 'sanad-backup', version: 1, at: T, driver: 'sqlite', tables: Object.keys(tables) }),
  ...Object.entries(tables).flatMap(([t, rows]) => [
    JSON.stringify({ _table: t, _rows: rows.length }),
    ...rows.map((r) => JSON.stringify({ t, r })),
  ]),
].join('\n') + '\n';

const GOOD = Buffer.from(dumpOf({
  client: [{ id: 'c1', name_ar: 'جهة «الاختبار»' }, { id: 'c2', name_ar: 'جهة أخرى' }],
  project: [{ id: 'p1', name_ar: 'مشروع', contract_value_halalas: 123456789 }],
  audit_log: [{ id: 'a1' }, { id: 'a2' }],
}));

test('المطابقة تقبل نسخةً كاملةً وتعدّ جداولها وصفوفها', () => {
  const v = verifyBackup(GOOD, { client: 2, project: 1, audit_log: 2 });
  assert.equal(v.ok, true);
  assert.equal(v.problem, null);
  assert.equal(v.tables, 3);
  assert.equal(v.rows, 5);
  assert.equal(v.lines, 9);   // ترويسة + ٣ عدّادات + ٥ صفوف
});

test('سجل التدقيق يُلحَق فقط: نموٌّ بأربعة أسطر يُقبل وخامسٌ يُرفض', () => {
  assert.equal(verifyBackup(GOOD, { audit_log: 0 }).ok, true, 'صفران قبل التنزيل + سطرا الطلبين');
  const bad = verifyBackup(GOOD, { audit_log: 7 });
  assert.equal(bad.ok, false);
  assert.match(bad.problem, /عدادات النسخة لا تطابق الخادم/);
  assert.match(bad.problem, /audit_log/);
});

test('بثٌّ مقطوع: صفوف أقل من المعلَن تُرصد باسم الجدول', () => {
  const cut = Buffer.from(GOOD.toString('utf8').split('\n').filter((l) => !l.includes('"c2"')).join('\n'));
  const v = verifyBackup(cut, { client: 2 });
  assert.equal(v.ok, false);
  assert.match(v.problem, /النسخة ناقصة/);
  assert.match(v.problem, /client/);
});

test('نقصٌ مقابل الخادم يُرصد ولو كان الملف متّسقاً مع نفسه', () => {
  const v = verifyBackup(GOOD, { client: 2, project: 4 });
  assert.equal(v.ok, false);
  assert.match(v.problem, /project/);
});

test('ملفٌّ بلا ترويسة سند يُرفض قبل أي عدّ', () => {
  const v = verifyBackup(Buffer.from('{"hello":1}\n'));
  assert.equal(v.ok, false);
  assert.equal(v.problem, 'النسخة بلا ترويسة سند');
  assert.equal(v.tables, 0);
});

test('اسم الملف: كما كان بلا وسم، وبالوسم حين يُمرَّر (والوسم يُنقّى)', () => {
  const at = new Date('2026-09-14T09:05:03.000Z');
  assert.equal(backupFileName({ tag: 'abc123def456', at }), 'app-abc123def456-20260914090503.ndjson');
  assert.equal(backupFileName({ label: 'pre-workbook', tag: 'abc123def456', at }), 'app-pre-workbook-abc123def456-20260914090503.ndjson');
  assert.equal(backupFileName({ label: 'قبل/الدفتر', tag: 'x', at }), 'app-x-20260914090503.ndjson');
});

test('الصيغة نفسها التي تستهلكها scripts/restore-dump.mjs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sanad-appbk-'));
  try {
    const f = join(dir, 'dump.ndjson');
    writeFileSync(f, GOOD);
    const { readDump } = await import('../../scripts/restore-dump.mjs');
    const d = await readDump(f);
    assert.equal(d.header._meta, 'sanad-backup');
    assert.deepEqual(d.counts, { client: 2, project: 1, audit_log: 2 });
    assert.equal(d.rows.get('project')[0].contract_value_halalas, 123456789);
    const v = verifyBackup(GOOD);
    assert.equal(v.rows, [...d.rows.values()].reduce((a, b) => a + b.length, 0));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('المدخل المستقل يرفض بلا SANAD_RELEASE=1 ولا يمسّ الشبكة', () => {
  const env = { ...process.env };
  delete env.SANAD_RELEASE;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/lib/app-backup.mjs'), '--out=data/backups', '--label=pre-workbook'],
    { encoding: 'utf8', env });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /SANAD_RELEASE=1 مطلوب/);
  assert.match(r.stderr, /staging\.os\.evcsol\.com/);
});
