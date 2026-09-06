// وحدة: windowBounds — النافذة داخل سنتها دائماً: السنة الجارية تطابق sinceForWindow حرفاً،
// والسنة الماضية ترسو على آخرها (لا انقلاب since>until الذي صفّر الرقائق صمتاً)، والقادمة فارغة.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowBounds, sinceForWindow } from '../../src/core/reports/changes.js';

const NOW = new Date('2026-08-24T13:45:00Z'); // منتصف السنة الجارية 2026

test('السنة الجارية: until = الغد (حصري = اليوم داخل)، والبداية تطابق sinceForWindow', () => {
  for (const win of ['day', 'week', 'month', 'quarter']) {
    const { sinceIso, untilIso } = windowBounds(win, 2026, NOW);
    assert.equal(untilIso, '2026-08-25', win);
    assert.equal(sinceIso, sinceForWindow(win, NOW), win); // تكافؤ بايت-ببايت مع السلوك القائم
  }
  assert.deepEqual(windowBounds('year', 2026, NOW), { sinceIso: '2026-01-01', untilIso: '2026-08-25' });
});

test('سنة ماضية: النوافذ ترسو على آخر السنة — شهر على 2025 = ديسمبر، ولا انقلاب أبداً', () => {
  assert.deepEqual(windowBounds('month', 2025, NOW), { sinceIso: '2025-12-01', untilIso: '2026-01-01' });
  assert.deepEqual(windowBounds('day', 2025, NOW), { sinceIso: '2025-12-30', untilIso: '2026-01-01' });
  assert.deepEqual(windowBounds('year', 2025, NOW), { sinceIso: '2025-01-01', untilIso: '2026-01-01' });
  for (const win of ['day', 'week', 'month', 'quarter', 'year']) {
    const { sinceIso, untilIso } = windowBounds(win, 2025, NOW);
    assert.ok(sinceIso <= untilIso, `انقلاب في ${win}`);
  }
});

test('سنة قادمة: نافذة فارغة معلنة (since === until) لا سالبة', () => {
  for (const win of ['day', 'week', 'month', 'quarter', 'year']) {
    const { sinceIso, untilIso } = windowBounds(win, 2027, NOW);
    assert.equal(sinceIso, '2027-01-01', win);
    assert.equal(untilIso, '2027-01-01', win);
  }
});

test('أرضية أول السنة: ربعٌ في فبراير لا يعبر إلى السنة السابقة', () => {
  const feb = new Date('2026-02-10T08:00:00Z');
  const { sinceIso, untilIso } = windowBounds('quarter', 2026, feb);
  assert.equal(sinceIso, '2026-01-01'); // مقصوص على أول السنة لا 2025-11-…
  assert.equal(untilIso, '2026-02-11');
});

test('اليوم = أمس واليوم بالضبط (until حصري)', () => {
  const { sinceIso, untilIso } = windowBounds('day', 2026, NOW);
  assert.equal(sinceIso, '2026-08-23');
  assert.equal(untilIso, '2026-08-25');
});

test('نافذة غير معروفة تسقط إلى أسبوع', () => {
  assert.deepEqual(windowBounds('غير معروف', 2026, NOW), windowBounds('week', 2026, NOW));
});
