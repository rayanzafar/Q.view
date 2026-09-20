// وحدة: periodBounds — فترةٌ تقويمية محدَّدة (شهرٌ/ربعٌ/سنة) بدل النافذة المتدحرجة.
// الفرق الذي تعالجه: «الشهر» المتدحرج آخر ثلاثين يوماً، فكان «الربع» يعرض أربعة أشهر متقاطعة.
// وحالة الفترة (ماضية/جارية/قادمة) تعود مع الحدّين لأن الشاشة تمنع خلط المحقق بالمتوقع.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodBounds, parsePeriod } from '../../src/core/reports/changes.js';

const NOW = new Date('2026-08-24T13:00:00Z');   // منتصف أغسطس 2026

const YEAR_P = { kind: 'y', index: 0, key: 'y', from: 1, to: 12 };

test('parsePeriod: يقبل السنة والأرباع والأشهر، والمجهول يسقط إلى السنة', () => {
  assert.deepEqual(parsePeriod('y'), YEAR_P);
  assert.deepEqual(parsePeriod('q3'), { kind: 'q', index: 3, key: 'q3', from: 7, to: 9 });
  assert.deepEqual(parsePeriod('m12'), { kind: 'm', index: 12, key: 'm12', from: 12, to: 12 });
  assert.deepEqual(parsePeriod('m1'), { kind: 'm', index: 1, key: 'm1', from: 1, to: 1 });
  for (const bad of ['', null, 'q5', 'm0', 'm13', 'أغسطس', '../etc']) {
    assert.deepEqual(parsePeriod(bad), YEAR_P, `مدخل ${bad}`);
  }
});

test('parsePeriod: «حتى تاريخه» لسانٌ قائم بذاته، وحدّه الأعلى يُحسم مع اللحظة لا هنا', () => {
  assert.deepEqual(parsePeriod('ytd'), { kind: 'ytd', index: 0, key: 'ytd', from: 1, to: null });
  assert.deepEqual(parsePeriod('  YTD '), { kind: 'ytd', index: 0, key: 'ytd', from: 1, to: null });
});

test('parsePeriod: مدى الأشهر — يُقلب المعكوس، ويُقصّ الخارج، والواحد يعود شهراً', () => {
  assert.deepEqual(parsePeriod('m3-m8'), { kind: 'range', unit: 'm', index: 0, key: 'm3-m8', from: 3, to: 8 });
  assert.deepEqual(parsePeriod('m8-m3'), { kind: 'range', unit: 'm', index: 0, key: 'm3-m8', from: 3, to: 8 },
    'معكوسٌ ⇒ يُقلب لا يُرفض');
  assert.deepEqual(parsePeriod('m0-m20'), { kind: 'range', unit: 'm', index: 0, key: 'm1-m12', from: 1, to: 12 },
    'خارج 1–12 ⇒ يُقصّ على الحدّين');
  assert.deepEqual(parsePeriod('m5-m5'), { kind: 'm', index: 5, key: 'm5', from: 5, to: 5 },
    'مدىً بشهرٍ واحد ⇒ شهرٌ بعينه');
  assert.deepEqual(parsePeriod('m13-m20'), { kind: 'm', index: 12, key: 'm12', from: 12, to: 12 });
  // وما ليس مدىً صحيحاً يسقط إلى السنة كسائر المجهول
  for (const bad of ['m3-', '-m8', 'm3-m', 'ma-mb', 'm3-m8-m9', 'm3_m8', 'm123-m4']) {
    assert.deepEqual(parsePeriod(bad), YEAR_P, `مدخل ${bad}`);
  }
});

// ── مدى الأرباع: «من الربع الأول إلى الثالث» بنقرتين، بالقواعد نفسها التي لمدى الأشهر ────
// وحدةُ المدى (`unit`) جزءٌ من الحالة: مُنتقي الفترة يضيء رقائق جنس المدى وحده، ولا سبيل
// إلى تمييز q1-q3 من m1-m9 بالحدّين الشهريَّين وحدهما — فهما متطابقان.
test('parsePeriod: مدى الأرباع — حدوده شهرية، ووحدتُه وحدّاه بالأرباع معه', () => {
  assert.deepEqual(parsePeriod('q1-q3'),
    { kind: 'range', unit: 'q', index: 0, key: 'q1-q3', from: 1, to: 9, qFrom: 1, qTo: 3 });
  assert.deepEqual(parsePeriod('q2-q4'),
    { kind: 'range', unit: 'q', index: 0, key: 'q2-q4', from: 4, to: 12, qFrom: 2, qTo: 4 });
  assert.deepEqual(parsePeriod('q3-q1'), parsePeriod('q1-q3'), 'معكوسٌ ⇒ يُقلب لا يُرفض');
  assert.deepEqual(parsePeriod('q0-q9'), parsePeriod('q1-q4'), 'خارج 1–4 ⇒ يُقصّ على الحدّين');
  assert.deepEqual(parsePeriod('q2-q2'), { kind: 'q', index: 2, key: 'q2', from: 4, to: 6 },
    'مدىً بربعٍ واحد ⇒ ربعٌ بعينه — الشكل نفسه حرفاً');
  // ومدى الأرباع الكامل يبقى مدىً: القارئ اختار مدىً فلا يُحوَّل اختياره إلى «السنة» صامتاً
  const full = parsePeriod('q1-q4');
  assert.equal(full.kind, 'range');
  assert.equal(full.key, 'q1-q4');
  assert.deepEqual([full.from, full.to], [1, 12]);
  // وما ليس مدى أرباعٍ صحيحاً يسقط إلى السنة كسائر المجهول
  for (const bad of ['q1-', '-q3', 'q1-m3', 'm1-q3', 'qa-qb', 'q1-q2-q3', 'q123-q4']) {
    assert.deepEqual(parsePeriod(bad), YEAR_P, `مدخل ${bad}`);
  }
});

test('مدى الأرباع لا يحتاج حساباً جديداً: حدوده حدود أشهره', () => {
  const r = periodBounds('q1-q3', 2026, NOW);
  assert.equal(r.kind, 'range');
  assert.equal(r.unit, 'q');
  assert.equal(r.qFrom, 1);
  assert.equal(r.qTo, 3);
  assert.equal(r.sinceIso, '2026-01-01');
  assert.equal(r.untilIso, '2026-10-01');
  assert.deepEqual(r.months, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(r.isCurrent, true);
  const q34 = periodBounds('q3-q4', 2026, NOW);
  assert.equal(q34.sinceIso, '2026-07-01');
  assert.equal(q34.untilIso, '2027-01-01', 'مدىً ينتهي بالربع الرابع يعبر إلى العام التالي');
  assert.deepEqual(q34.months, [7, 8, 9, 10, 11, 12]);
  // وحدودُه حدودُ مدى أشهره حرفاً — والوحدةُ وحدها تفرّق بينهما
  const asMonths = periodBounds('m1-m9', 2026, NOW);
  assert.equal(r.sinceIso, asMonths.sinceIso);
  assert.equal(r.untilIso, asMonths.untilIso);
  assert.equal(asMonths.unit, 'm');
  assert.equal(asMonths.qFrom, undefined, 'مدى أشهرٍ لا حدَّي أرباعٍ له');
});

test('مدىً بربعٍ واحد هو الربع نفسه حرفاً', () => {
  assert.deepEqual(periodBounds('q2-q2', 2026, NOW), periodBounds('q2', 2026, NOW));
  assert.equal(periodBounds('q2-q2', 2026, NOW).unit, undefined, 'ربعٌ بعينه بلا وحدة مدى');
});

test('كل فترةٍ تحمل مفتاح رابطها معها — لا يُركَّب من kind+index لدى المستدعي', () => {
  for (const k of ['y', 'q2', 'm5', 'ytd', 'm3-m8', 'q1-q3', 'q1-q4']) {
    assert.equal(periodBounds(k, 2026, NOW).key, k, `مفتاح ${k}`);
  }
  assert.equal(periodBounds('m8-m3', 2026, NOW).key, 'm3-m8', 'المفتاح قانونيٌّ لا حرفيّ');
  assert.equal(periodBounds('q3-q1', 2026, NOW).key, 'q1-q3', 'ومدى الأرباع المعكوس كذلك');
  assert.equal(periodBounds('أغسطس', 2026, NOW).key, 'y');
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

// ── «منذ أول السنة حتى تاريخه» ──────────────────────────────────────────────────────
test('حتى تاريخه في السنة الجارية: من أول يناير إلى نهاية الشهر الجاري', () => {
  const ytd = periodBounds('ytd', 2026, NOW);
  assert.equal(ytd.kind, 'ytd');
  assert.equal(ytd.sinceIso, '2026-01-01');
  assert.equal(ytd.untilIso, '2026-09-01', 'الشهر الجاري كاملاً — اصطلاح الحدّ الأعلى نفسه للشهر');
  assert.deepEqual(ytd.months, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(ytd.isCurrent, true);
  assert.equal(ytd.isPast, false);
  assert.equal(ytd.isFuture, false);
});

test('حتى تاريخه في يناير: شهرٌ واحد لا سنة', () => {
  const jan = periodBounds('ytd', 2026, new Date('2026-01-07T09:00:00Z'));
  assert.equal(jan.sinceIso, '2026-01-01');
  assert.equal(jan.untilIso, '2026-02-01');
  assert.deepEqual(jan.months, [1]);
  assert.equal(jan.isCurrent, true);
});

test('حتى تاريخه في سنةٍ ماضية: السنة كاملةً وقد انقضت', () => {
  const past = periodBounds('ytd', 2025, NOW);
  assert.equal(past.sinceIso, '2025-01-01');
  assert.equal(past.untilIso, '2026-01-01');
  assert.equal(past.months.length, 12);
  assert.equal(past.isPast, true);
  assert.equal(past.isCurrent, false);
});

test('حتى تاريخه في سنةٍ قادمة: قادمةٌ معلنة كسائر الفترات القادمة', () => {
  const next = periodBounds('ytd', 2027, NOW);
  assert.equal(next.sinceIso, '2027-01-01');
  assert.equal(next.untilIso, '2028-01-01');
  assert.equal(next.isFuture, true);
  assert.equal(next.isPast, false);
  assert.equal(next.isCurrent, false);
  assert.equal(next.isFuture, periodBounds('m1', 2027, NOW).isFuture, 'نفس حالة الفترة القادمة');
});

// ── مدى أشهرٍ متصل ──────────────────────────────────────────────────────────────────
test('مدى الأشهر: من أول الشهر الأول إلى أول الشهر التالي لآخره', () => {
  const r = periodBounds('m3-m8', 2026, NOW);
  assert.equal(r.kind, 'range');
  assert.equal(r.index, 0);
  assert.equal(r.sinceIso, '2026-03-01');
  assert.equal(r.untilIso, '2026-09-01');
  assert.deepEqual(r.months, [3, 4, 5, 6, 7, 8]);
  assert.equal(r.isCurrent, true, 'أغسطس داخل المدى واليوم فيه');
});

test('مدى معكوسٌ يساوي المستقيم، ومدى 1–12 يساوي السنة في حدوده', () => {
  assert.deepEqual(periodBounds('m8-m3', 2026, NOW), periodBounds('m3-m8', 2026, NOW));
  const full = periodBounds('m0-m20', 2026, NOW);
  assert.equal(full.sinceIso, '2026-01-01');
  assert.equal(full.untilIso, '2027-01-01');
  assert.equal(full.months.length, 12);
  assert.equal(full.kind, 'range', 'المدى يبقى مدىً وإن غطّى السنة — والمفتاح يقولها');
  assert.equal(full.key, 'm1-m12');
});

test('مدى بشهرٍ واحد هو الشهر نفسه حرفاً', () => {
  assert.deepEqual(periodBounds('m5-m5', 2026, NOW), periodBounds('m5', 2026, NOW));
});

test('حالة المدى: منقضٍ، وجارٍ، وقادم', () => {
  assert.equal(periodBounds('m1-m2', 2026, NOW).isPast, true, 'يناير–فبراير انقضيا');
  assert.equal(periodBounds('m6-m9', 2026, NOW).isCurrent, true);
  const q4ish = periodBounds('m10-m12', 2026, NOW);
  assert.equal(q4ish.isFuture, true);
  assert.equal(q4ish.untilIso, '2027-01-01', 'مدىً ينتهي بديسمبر يعبر إلى العام التالي');
});
