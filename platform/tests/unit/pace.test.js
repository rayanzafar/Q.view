// وحدة: رياضيات «الإيقاع مقابل الخطة» — دوال نقية بتواريخ مثبّتة (بلا ساعة حائط ولا قاعدة بيانات).
// المبدأ محل الحراسة: مقياس الشريط = المستهدف السنوي فقط؛ الانحراف بالنقاط = تحقّق% − منقضي%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearElapsedPct, targetToDate, paceDelta, requiredRunRate } from '../../src/core/reports/metrics.js';

const MID = new Date('2026-07-02T12:00:00Z'); // منتصف 2026 تقريباً (اليوم 182.5 من 365)

test('yearElapsedPct: بداية السنة 0، منتصفها ~50، نهايتها 100، وخارج حدودها مثبّت', () => {
  assert.equal(yearElapsedPct(new Date('2026-01-01T00:00:00Z'), 2026), 0);
  assert.equal(yearElapsedPct(MID, 2026), 50);
  assert.equal(yearElapsedPct(new Date('2027-01-01T00:00:00Z'), 2026), 100);
  // عرض سنة ماضية اليوم = انقضت كلها؛ وسنة قادمة لم تبدأ
  assert.equal(yearElapsedPct(new Date('2026-07-21T00:00:00Z'), 2025), 100);
  assert.equal(yearElapsedPct(new Date('2026-07-21T00:00:00Z'), 2027), 0);
});

test('targetToDate: المستهدف حتى اليوم = السنوي × المنقضي', () => {
  assert.equal(targetToDate(600_000_000, MID, 2026), 300_000_000);
  assert.equal(targetToDate(0, MID, 2026), 0);
  assert.equal(targetToDate(null, MID, 2026), 0);
});

test('paceDelta: موجب متقدم، سالب متأخر، null بلا مستهدف', () => {
  // تحقّق 25% في منتصف السنة → متأخر 25 نقطة
  assert.equal(paceDelta(150_000_000, 600_000_000, MID, 2026), -25);
  // تحقّق 75% في منتصف السنة → متقدم 25 نقطة
  assert.equal(paceDelta(450_000_000, 600_000_000, MID, 2026), 25);
  // على الخطة تماماً
  assert.equal(paceDelta(300_000_000, 600_000_000, MID, 2026), 0);
  assert.equal(paceDelta(100, 0, MID, 2026), null);
  assert.equal(paceDelta(100, null, MID, 2026), null);
});

test('requiredRunRate: (المتبقي ÷ الأشهر المتبقية) مع شمول الشهر الجاري', () => {
  // يوليو 2026: تبقّى 6 أشهر (يوليو..ديسمبر)
  const july = new Date('2026-07-15T00:00:00Z');
  assert.equal(requiredRunRate(300_000_000, 600_000_000, july, 2026), 50_000_000);
  // بلغنا الهدف → 0 (لا قسمة سالبة)
  assert.equal(requiredRunRate(700_000_000, 600_000_000, july, 2026), 0);
  // سنة منتهية → null؛ سنة قادمة → على 12 شهراً
  assert.equal(requiredRunRate(0, 600_000_000, july, 2025), null);
  assert.equal(requiredRunRate(0, 600_000_000, july, 2027), 50_000_000);
  assert.equal(requiredRunRate(0, 0, july, 2026), null);
});
