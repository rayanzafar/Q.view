// مولِّد دفتر سطور قائمة الدخل: البنية التي يعتمد عليها الاستيراد — أسماء الأوراق وترتيبها،
// والترويسات مطابقةً لعناوين المحوّل حرفاً (فيطابقها المحرك تلقائياً بلا مطابقة يدوية)،
// وسطور كل ورقة، والفحص الذاتي `--verify` من سطر الأوامر.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const gen = await import('../../scripts/make-finance-pl-workbook.mjs');
const adapter = (await import('../../src/modules/io/adapters/finance-pl.js')).default;
const XLSX = await import('../../vendor/xlsx/xlsx.mjs');

const SCRIPT = resolve(process.cwd(), 'scripts/make-finance-pl-workbook.mjs');
const SECTOR = 'قطاع الاختبار';
const YEAR = 2026;

const sheetRows = (buffer, name) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
};

test('الدفتر: أربع أوراق بترتيبها، و«تعليمات» أولاً (المحرك يقرأ الورقة الأولى من كل ملف)', () => {
  const buf = gen.buildWorkbookBuffer({ sector: SECTOR, year: YEAR });
  const wb = XLSX.read(buf, { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['تعليمات', 'الفعلي', 'الخطة', 'قوائم']);
});

test('الترويسات مطابقة لعناوين المحوّل حرفاً في الورقتين', () => {
  const buf = gen.buildWorkbookBuffer({ sector: SECTOR, year: YEAR });
  const expected = adapter.columns.map((c) => c.labelAr);
  for (const name of ['الفعلي', 'الخطة']) {
    const head = sheetRows(buf, name)[0].map((h) => String(h).trim());
    assert.deepEqual(head, expected, `ترويسات ورقة ${name}`);
  }
});

test('الفعلي: بنود الكلفة الستة × 12 شهراً بلا سطر إيراد — والخطة سبعة بنود × 12', () => {
  const buf = gen.buildWorkbookBuffer({ sector: SECTOR, year: YEAR });
  const idx = Object.fromEntries(adapter.columns.map((c, i) => [c.key, i]));
  const actual = sheetRows(buf, 'الفعلي').slice(1);
  const plan = sheetRows(buf, 'الخطة').slice(1);
  assert.equal(actual.length, gen.ACTUAL_KEYS.length * 12);
  assert.equal(actual.length, 72);
  assert.equal(plan.length, gen.PLAN_KEYS.length * 12);
  assert.equal(plan.length, 84);
  assert.ok(actual.every((r) => r[idx.line] !== 'الإيراد'), 'الإيراد المحقق لا يُكتب يدوياً');
  assert.ok(actual.every((r) => r[idx.kind] === 'فعلي' && r[idx.sector] === SECTOR && String(r[idx.year]) === String(YEAR)));
  assert.ok(plan.some((r) => r[idx.line] === 'الإيراد'), 'الخطة تشمل سطر الإيراد');
  assert.ok(plan.every((r) => r[idx.kind] === 'خطة'));
  assert.ok(actual.every((r) => String(r[idx.amount] ?? '') === ''), 'الدفتر الفارغ بلا مبالغ');
});

test('النسخة التجريبية تمرّ من الفحص الذاتي، والفارغة كذلك (المبلغ وحده متروك)', () => {
  const demo = gen.verifyWorkbook(gen.buildWorkbookBuffer({ sector: SECTOR, year: YEAR, demo: true }));
  assert.equal(demo.ok, true, JSON.stringify(demo.errors));
  assert.equal(demo.sheets['الفعلي'].filled, 72);
  const empty = gen.verifyWorkbook(gen.buildWorkbookBuffer({ sector: SECTOR, year: YEAR }));
  assert.equal(empty.ok, true, JSON.stringify(empty.errors));
  assert.equal(empty.sheets['الخطة'].filled, 0);
});

test('الفحص يكشف ترويسةً مبدَّلة — ولا يمرّ ملفاً لا يقبله الاستيراد', () => {
  const buf = gen.buildWorkbookBuffer({ sector: SECTOR, year: YEAR, demo: true });
  const wb = XLSX.read(buf, { type: 'buffer' });
  wb.Sheets['الفعلي'].A1 = { t: 's', v: 'الجهة' };   // عنوانٌ لا يعرفه المحوّل
  const broken = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const res = gen.verifyWorkbook(broken);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /الترويسات لا تطابق/.test(e)), JSON.stringify(res.errors));
});

test('التفكيك: ورقةٌ واحدة لكل ملف استيراد، بصفوفها المعبأة وترويساتها كما هي', () => {
  const buf = gen.buildWorkbookBuffer({ sector: SECTOR, year: YEAR, demo: true });
  const parts = gen.splitWorkbook(buf);
  assert.deepEqual(parts.map((p) => p.name), ['الفعلي', 'الخطة']);
  assert.deepEqual(parts.map((p) => p.rows.length), [72, 84]);
  const head = sheetRows(parts[0].buffer, XLSX.read(parts[0].buffer, { type: 'buffer' }).SheetNames[0])[0];
  assert.deepEqual(head.map((h) => String(h).trim()), adapter.columns.map((c) => c.labelAr));
});

test('سطر الأوامر: ‏--demo يبني الملف و--verify يقبله', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sanad-pl-'));
  const out = join(dir, 'دفتر.xlsx');
  try {
    execFileSync(process.execPath, [SCRIPT, '--sector', SECTOR, '--year', String(YEAR), '--demo', '--out', out], { stdio: 'pipe' });
    assert.ok(existsSync(out), 'الملف كُتب');
    const log = execFileSync(process.execPath, [SCRIPT, '--verify', out], { stdio: 'pipe' }).toString();
    assert.match(log, /الدفتر سليم/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
