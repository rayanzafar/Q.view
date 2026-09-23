// ── نموذج الطاقة الصرف — حالات القبول T01–T13 من حزمة الفريق والموارد ──────────────────
//
// «لا تصلح 300% بمجرد قصها إلى 100% أو قسمة الرقم على ثلاثة. افهم بسط المؤشر ومقامه ونطاقه
//  أولاً» — الموجّه §6.4. كل حالةٍ هنا تُثبِّت بسطاً ومقاماً ووحدةً باسمها.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capacityForMonth, monthFigures, periodFigures, groupFigures, engagedDays, monthsBetween, parseMonthKey, bandOf,
} from '../../src/modules/team/capacity-model.js';

const FULLTIME = { id: 'A', capacity_pct: 100, active: 1, hire_date: '2025-01-01', end_date: null };
const HALF = { id: 'K', capacity_pct: 50, active: 1, hire_date: '2026-07-01', end_date: '2026-11-30' };
const fig = (emp, month, items, extra = {}) => monthFigures({ emp, year: 2026, month, items, ...extra });

test('T01: 60% مشروع + 20% منتج لمورد 1 FTE ⇒ مؤكد 80%، متاح 20%، قابل للفوترة 60%', () => {
  const f = fig(FULLTIME, 9, [
    { key: 'p1', pct: 60, billable: true }, { key: 'b1', pct: 20, billable: false },
  ]);
  assert.equal(f.confirmedPct, 80);
  assert.equal(f.availablePct, 20);
  assert.equal(f.billablePct, 60);
  assert.equal(f.nominalFte, 0.8, 'ما يعادله التسكين اسمياً 0.8 FTE');
});

test('T02: طلب مبدئي 20% فوق T01 ⇒ المؤكد 80% والمتاح 20% يبقيان، والمبدئي منفصل', () => {
  const f = fig(FULLTIME, 9, [
    { key: 'p1', pct: 60, billable: true }, { key: 'b1', pct: 20 }, { key: 'o1', pct: 20, status: 'tentative' },
  ]);
  assert.equal(f.confirmedPct, 80);
  assert.equal(f.availablePct, 20);
  assert.equal(f.tentativePct, 20);
  assert.equal(f.potentialPct, 100);
  assert.equal(f.potentialOver, false);
});

test('T03: مستشار 0.5 FTE مسكَّن بكامل طاقته ⇒ 100% من طاقته، يعادل 0.5 FTE، متاح 0%', () => {
  const f = fig(HALF, 9, [{ key: 'p1', pct: 100, billable: true }]);
  assert.equal(f.confirmedPct, 100);
  assert.equal(f.availablePct, 0);
  assert.equal(f.capacity.units, 50, 'طاقة الشهر بوحدات الدوام الكامل نصفٌ');
  assert.equal(f.units.confirmed, 50);
  assert.equal(f.nominalFte, 0.5);
  assert.equal(f.state, 'full');
});

test('T05: ثلاثة موارد 1 FTE كلٌّ 100% ⇒ 3 FTE مسكَّنة واستغلال المجموعة 100%', () => {
  const rows = ['A', 'B', 'C'].map((id) => fig({ ...FULLTIME, id }, 9, [{ key: 'p', pct: 100 }]));
  const g = groupFigures(rows);
  assert.equal(g.confirmedFte, 3);
  assert.equal(g.capacityFte, 3);
  assert.equal(g.utilizationPct, 100);
});

test('T06: مورد 100% في ثلاثة أشهر ⇒ متوسط الفترة 100% لا 300%', () => {
  const months = [7, 8, 9].map((m) => fig(FULLTIME, m, [{ key: 'p', pct: 100 }]));
  const p = periodFigures(months);
  assert.equal(p.utilizationPct, 100);
  assert.equal(p.sumOfMonthPct, 300, 'مجموع نسب الأشهر يبقى باسمه لا نسبةَ استغلال');
});

test('T07: ثلاث التزامات متزامنة 100% ⇒ مؤكد 300% وتجاوز 200% — لا قصّ ولا حذف', () => {
  const f = fig(FULLTIME, 9, [{ key: 'a', pct: 100 }, { key: 'b', pct: 100 }, { key: 'c', pct: 100 }]);
  assert.equal(f.confirmedPct, 300);
  assert.equal(f.overPct, 200);
  assert.equal(f.availablePct, 0);
  assert.equal(f.state, 'over');
  assert.equal(bandOf(f.confirmedPct), 'over');
});

test('T09: تجاوز في شهرٍ ومتوسطٌ منخفض ⇒ المتوسط صحيح والتجاوز ظاهر بشهره', () => {
  const months = [fig(FULLTIME, 9, [{ key: 'a', pct: 120 }]), fig(FULLTIME, 10, [{ key: 'a', pct: 50 }])];
  const p = periodFigures(months);
  assert.equal(p.utilizationPct, 85);
  assert.equal(p.maxOverPct, 20);
  assert.deepEqual(p.overMonths, ['2026-09']);
  assert.equal(p.overPct, 10, 'التجاوز يُجمع منفصلاً: 20 من 200 وحدة = 10%');
});

test('T10: مورد 1 FTE ومورد 0.5 FTE بكامل الطاقة ⇒ 1.5/1.5 = 100% للمجموعة', () => {
  const g = groupFigures([fig(FULLTIME, 9, [{ key: 'p', pct: 100 }]), fig(HALF, 9, [{ key: 'p', pct: 100 }])]);
  assert.equal(g.capacityFte, 1.5);
  assert.equal(g.confirmedFte, 1.5);
  assert.equal(g.utilizationPct, 100);
});

test('T11: نهاية عقد 30 نوفمبر ⇒ ديسمبر خارج الارتباط بلا نسبٍ مضلِّلة', () => {
  const f = fig(HALF, 12, [{ key: 'p', pct: 100 }]);
  assert.equal(f.state, 'out');
  assert.equal(f.confirmedPct, null);
  assert.equal(f.availablePct, null);
  assert.equal(f.capacity.units, 0);
  assert.equal(engagedDays(HALF, 2026, 12), 0);
});

test('T12: عقد يبدأ منتصف الشهر ⇒ طاقة الشهر موزونة بالأيام، ولا طاقة قبل البداية', () => {
  const mid = { ...FULLTIME, hire_date: '2026-09-16' };
  const c = capacityForMonth(mid, 2026, 9);
  assert.equal(c.engagedDays, 15);
  assert.equal(c.units, 50);
  assert.equal(c.state, 'partial');
  assert.equal(capacityForMonth(mid, 2026, 8).state, 'out', 'الشهر السابق للتعيين بلا طاقة');
  // والتسكين نسبةٌ من أيام الارتباط: 100% على نصف شهر = 50 وحدة، لا تجاوز مصطنع.
  const f = fig(mid, 9, [{ key: 'p', pct: 100 }]);
  assert.equal(f.units.confirmed, 50);
  assert.equal(f.overPct, 0);
});

test('T12ب: تغيّر الطاقة وسط الشهر يُوزَن بالأيام ويُعلَّم', () => {
  const emp = { ...FULLTIME, capacity_pct: 50 };
  const versions = [{ effective_from: '2026-01-01', capacity_pct: 100 }, { effective_from: '2026-09-16', capacity_pct: 50 }];
  const c = capacityForMonth(emp, 2026, 9, versions);
  assert.equal(c.changedWithin, true);
  assert.equal(c.units, 75);
  assert.equal(capacityForMonth(emp, 2026, 10, versions).units, 50);
});

test('T13: لا طاقة في الفترة ⇒ حالة صريحة بلا قسمة على صفر', () => {
  const gone = { id: 'G', capacity_pct: 100, active: 0, hire_date: '2024-01-01', end_date: null };
  const f = fig(gone, 9, [{ key: 'p', pct: 100 }]);
  assert.equal(f.state, 'out');
  const p = periodFigures([f]);
  assert.equal(p.state, 'out');
  assert.equal(p.utilizationPct, null);
  assert.equal(groupFigures([f]).utilizationPct, null);
});

test('T17: مورد مؤرشف بتاريخ مغادرة يحفظ تاريخه — الأشهر قبل المغادرة طاقتها قائمة', () => {
  const left = { id: 'L', capacity_pct: 100, active: 0, hire_date: '2025-01-01', end_date: '2026-08-31' };
  assert.equal(capacityForMonth(left, 2026, 8).state, 'full');
  assert.equal(capacityForMonth(left, 2026, 9).state, 'out');
});

test('T15: الأشهر تُقرأ من نصّ ISO — لا انزلاق شهر بتحويل التوقيت', () => {
  assert.deepEqual(parseMonthKey('2026-12'), { year: 2026, month: 12 });
  assert.equal(parseMonthKey('2026-13'), null);
  assert.deepEqual(monthsBetween('2026-11', '2027-01').map((m) => m.key), ['2026-11', '2026-12', '2027-01']);
});
