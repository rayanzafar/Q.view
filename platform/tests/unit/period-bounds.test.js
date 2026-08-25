// وحدة: periodBounds — فترةٌ تقويمية محدَّدة (شهرٌ/ربعٌ/سنة) بدل النافذة المتدحرجة.
// الفرق الذي تعالجه: «الشهر» المتدحرج آخر ثلاثين يوماً، فكان «الربع» يعرض أربعة أشهر متقاطعة.
// وحالة الفترة (ماضية/جارية/قادمة) تعود مع الحدّين لأن الشاشة تمنع خلط المحقق بالمتوقع.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodBounds, parsePeriod } from '../../src/core/reports/changes.js';

const NOW = new Date('2026-08-24T13:00:00Z');   // منتصف أغسطس 2026

test('parsePeriod: يقبل السنة والأرباع والأشهر، والمجهول يسقط إلى السنة', () => {
  assert.deepEqual(parsePeriod('y'), { kind: 'y', index: 0 });
  assert.deepEqual(parsePeriod('q3'), { kind: 'q', index: 3 });
  assert.deepEqual(parsePeriod('m12'), { kind: 'm', index: 12 });
  assert.deepEqual(parsePeriod('m1'), { kind: 'm', index: 1 });
  for (const bad of ['', null, 'q5', 'm0', 'm13', 'أغسطس', '../etc']) {
    assert.deepEqual(parsePeriod(bad), { kind: 'y', index: 0 }, `مدخل ${bad}`);
  }
});

test('حدود الشهر تقويمية بالضبط — لا ثلاثون يوماً متدحرجة', () => {
  const aug = periodBounds('m8', 2026, NOW);
  assert.equal(aug.sinceIso, '2026-08-01');
  assert.equal(aug.untilIso, '2026-09-01');
  assert.deepEqual(aug.months, [8]);
  assert.equal(aug.isCurrent, true, 'أغسطس هو الشهر الجاري');
  assert.equal(aug.isPast, false);
  assert.equal(aug.isFuture, false);
});

test('الربع ثلاثة أشهر لا أربعة — العيب الذي رُصد في التدقيق', () => {
  const q3 = periodBounds('q3', 2026, NOW);
  assert.equal(q3.sinceIso, '2026-07-01');
  assert.equal(q3.untilIso, '2026-10-01');
  assert.deepEqual(q3.months, [7, 8, 9]);
  const q4 = periodBounds('q4', 2026, NOW);
  assert.equal(q4.sinceIso, '2026-10-01');
  assert.equal(q4.untilIso, '2027-01-01', 'الربع الرابع ينتهي بأول العام التالي');
  assert.deepEqual(q4.months, [10, 11, 12]);
});

test('السنة كاملةٌ من أولها إلى أول التالية', () => {
  const y = periodBounds('y', 2026, NOW);
  assert.equal(y.sinceIso, '2026-01-01');
  assert.equal(y.untilIso, '2027-01-01');
  assert.equal(y.months.length, 12);
  assert.equal(y.isCurrent, true);
});

test('ماضٍ وجارٍ وقادم — الحالة التي تمنع خلط المحقق بالمتوقع', () => {
  assert.equal(periodBounds('m3', 2026, NOW).isPast, true, 'مارس انقضى');
  assert.equal(periodBounds('m3', 2026, NOW).isFuture, false);
  assert.equal(periodBounds('m8', 2026, NOW).isCurrent, true, 'أغسطس جارٍ');
  const nov = periodBounds('m11', 2026, NOW);
  assert.equal(nov.isFuture, true, 'نوفمبر لم يبدأ بعد');
  assert.equal(nov.isPast, false);
  assert.equal(nov.isCurrent, false);
  // وسنةٌ ماضية: كل فتراتها ماضية
  assert.equal(periodBounds('q4', 2025, NOW).isPast, true);
  assert.equal(periodBounds('y', 2025, NOW).isPast, true);
  // وسنةٌ قادمة: كل فتراتها قادمة
  assert.equal(periodBounds('m1', 2027, NOW).isFuture, true);
});

test('حدود ديسمبر تعبر إلى العام التالي بلا خطأ', () => {
  const dec = periodBounds('m12', 2026, NOW);
  assert.equal(dec.sinceIso, '2026-12-01');
  assert.equal(dec.untilIso, '2027-01-01');
  assert.equal(dec.isFuture, true);
});
