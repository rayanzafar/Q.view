// اختبارات غلاف Excel/CSV: ذهاب-إياب كامل، ترميز BOM للعربية، وحارس حقن المعادلات.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkbook, buildExport, normalizeDigits } from '../../src/modules/io/xlsx.js';

const COLS = [
  { key: 'name', labelAr: 'الاسم' },
  { key: 'amount', labelAr: 'المبلغ (ريال)' },
  { key: 'note', labelAr: 'ملاحظة' },
];
const ROWS = [
  { name: 'وزارة النقل', amount: 250000, note: 'دفعة أولى' },
  { name: 'شركة البحر الأحمر', amount: 1234.5, note: '' },
];

test('xlsx: buffer → parse → build → parse round-trips headers and values', () => {
  const out1 = buildExport({ columns: COLS, rows: ROWS, format: 'xlsx' });
  const p1 = parseWorkbook(out1.buffer, 'x.xlsx');
  assert.deepEqual(p1.headers, COLS.map((c) => c.labelAr));
  assert.equal(p1.rows.length, 2);
  assert.equal(p1.rows[0][0], 'وزارة النقل');
  assert.equal(p1.rows[0][1], '250000');
  // إعادة البناء من الناتج المقروء ثم القراءة مجدداً = تطابق تام
  const rows2 = p1.rows.map((r) => ({ name: r[0], amount: r[1], note: r[2] }));
  const out2 = buildExport({ columns: COLS, rows: rows2, format: 'xlsx' });
  const p2 = parseWorkbook(out2.buffer, 'x.xlsx');
  assert.deepEqual(p2.headers, p1.headers);
  assert.deepEqual(p2.rows, p1.rows);
});

test('csv: UTF-8 BOM present so Arabic opens correctly in Excel, and parses back', () => {
  const out = buildExport({ columns: COLS, rows: ROWS, format: 'csv' });
  assert.equal(out.buffer[0], 0xef);
  assert.equal(out.buffer[1], 0xbb);
  assert.equal(out.buffer[2], 0xbf);
  assert.equal(out.ext, 'csv');
  const p = parseWorkbook(out.buffer, 'ملف.csv');
  assert.deepEqual(p.headers, COLS.map((c) => c.labelAr));
  assert.equal(p.rows[0][0], 'وزارة النقل');
  assert.equal(p.rows[1][1], '1234.5');
});

test('csv: quotes and commas survive the round trip', () => {
  const rows = [{ name: 'جهة "خاصة"، فرع الرياض', amount: 10, note: 'سطر,بفاصلة' }];
  const out = buildExport({ columns: COLS, rows, format: 'csv' });
  const p = parseWorkbook(out.buffer, 'x.csv');
  assert.equal(p.rows[0][0], 'جهة "خاصة"، فرع الرياض');
  assert.equal(p.rows[0][2], 'سطر,بفاصلة');
});

test('formula-injection guard: cells starting with = + - @ are neutralized on export', () => {
  for (const evil of ['=SUM(A1:A9)', '+HYPERLINK("x")', '-2+3+cmd', '@evil()']) {
    const out = buildExport({ columns: [{ key: 'v', labelAr: 'قيمة' }], rows: [{ v: evil }], format: 'csv' });
    const p = parseWorkbook(out.buffer, 'x.csv');
    assert.ok(p.rows[0][0].startsWith("'"), `يجب أن تُسبق «${evil}» بفاصلة عليا`);
    assert.equal(p.rows[0][0], `'${evil}`);
  }
});

test('normalizeDigits: Arabic-Indic and Persian digits + Arabic separators', () => {
  assert.equal(normalizeDigits('١٢٣٤٥٦٧٨٩٠'), '1234567890');
  assert.equal(normalizeDigits('۱۲۳'), '123');
  assert.equal(normalizeDigits('١٬٢٣٤٫٥'), '1,234.5');
  assert.equal(normalizeDigits('٥،٠٠٠'), '5,000');
});
