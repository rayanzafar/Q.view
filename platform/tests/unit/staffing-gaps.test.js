// ── رياضيات الفجوات التاريخية (v5.26) — نقية بلا قاعدة ───────────────────────
//
// الفجوة = موظفٌ نشط في شهرٍ ماضٍ ومجموعُ شهره صفر. الوحدة موظف-شهر، والمقام أشهرُ
// نشاطه فعلاً، والشهر الحالي مستثنى (هو «غير مُسكَّن الآن» لا فجوة). الحساب على صفوف
// الكشف كما تعود — فالفحص هنا يثبّت التعريف نفسه قبل أي شاشة.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeInMonth, pastMonthsOf, gapsFor } from '../../src/modules/org/staffing-gaps.js';

const NOW = new Date('2026-08-12T10:00:00Z'); // أغسطس ⇒ الماضي = يناير..يوليو

test('أشهر الماضي: سنة خلت كاملة، والحالية حتى الشهر السابق، والقادمة لا ماضي لها', () => {
  assert.deepEqual(pastMonthsOf(2025, NOW), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(pastMonthsOf(2026, NOW), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pastMonthsOf(2027, NOW), []);
  // يناير: لا أشهر ماضية بعد — لا فجوات تُخترع في أول السنة
  assert.deepEqual(pastMonthsOf(2026, new Date('2026-01-15T00:00:00Z')), []);
});

test('النشاط في الشهر: التعيين يقصّ البداية والمغادرة تقصّ النهاية', () => {
  const e = { active: 1, hire_date: '2026-03-15', end_date: '2026-10-02' };
  assert.equal(activeInMonth(e, 2026, 2), false, 'قبل التعيين');
  assert.equal(activeInMonth(e, 2026, 3), true, 'شهر التعيين نفسه يُحسب');
  assert.equal(activeInMonth(e, 2026, 10), true, 'شهر المغادرة نفسه يُحسب');
  assert.equal(activeInMonth(e, 2026, 11), false, 'بعد المغادرة');
  // حافة: تعيين في آخر يوم من الشهر — الشهر يُحسب
  assert.equal(activeInMonth({ active: 1, hire_date: '2026-05-31' }, 2026, 5), true);
});

test('غير النشط لا يدخل الحساب إطلاقاً — قيد معلن لا يُخترع له تاريخ', () => {
  assert.equal(activeInMonth({ active: 0, hire_date: '2020-01-01' }, 2026, 3), false);
});

test('الفجوات: صفر ماضٍ لنشطٍ فجوة، وشهرٌ له نسبة ليس فجوة، والمقام أشهر النشاط', () => {
  const roster = [
    // نشط كل السنة: يناير-مارس صفر، أبريل-يوليو مشغول ⇒ 3 فجوات من 7 أشهر نشاط
    { id: 'e1', active: 1, hire_date: '2024-01-01', end_date: null,
      months: [0, 0, 0, 80, 80, 50, 50, 0, 0, 0, 0, 0] },
    // عُيّن في مايو: يناير-أبريل خارج المقام؛ مايو-يوليو صفر ⇒ 3 فجوات من 3 أشهر نشاط
    { id: 'e2', active: 1, hire_date: '2026-05-01', end_date: null,
      months: Array(12).fill(0) },
    // غير نشط: لا يدخل مقاماً ولا فجوات
    { id: 'e3', active: 0, hire_date: '2020-01-01', end_date: '2026-02-01',
      months: Array(12).fill(0) },
  ];
  const g = gapsFor(roster, 2026, NOW);
  assert.deepEqual(g.byEmp.e1, [1, 2, 3]);
  assert.deepEqual(g.byEmp.e2, [5, 6, 7]);
  assert.equal('e3' in g.byEmp, false);
  assert.equal(g.gapMonths, 6);
  assert.equal(g.activeMonths, 7 + 3, 'المقام = أشهر النشاط الفعلية وحدها');
  assert.equal(g.employeesWithGaps, 2);
});

test('الشهر الحالي ليس فجوة — لا عدّ مزدوج مع «غير مُسكَّن الآن»', () => {
  const roster = [{ id: 'e', active: 1, hire_date: '2024-01-01', end_date: null,
    months: [80, 80, 80, 80, 80, 80, 80, 0, 0, 0, 0, 0] }]; // أغسطس (الحالي) صفر
  const g = gapsFor(roster, 2026, NOW);
  assert.equal(g.gapMonths, 0, 'أغسطس الجاري لا يُحسب فجوة');
});

test('سنة قادمة: لا فجوات مهما كانت الأصفار', () => {
  const g = gapsFor([{ id: 'e', active: 1, months: Array(12).fill(0) }], 2027, NOW);
  assert.equal(g.gapMonths, 0);
  assert.equal(g.activeMonths, 0);
});
