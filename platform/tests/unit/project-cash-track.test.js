// وحدة: حسابات شريط الأشهر خلف «صورة المال على المشروع» — بلا قاعدة بيانات.
// هذه الدوال هي ما يحوّل صفوفاً مُجمَّعة إلى شريط اثني عشر شهراً، وفيها بالضبط الموضع الذي
// يسهل أن ينقلب فيه «لم يُسجَّل» إلى «صفر»، وأن يُحشر مبلغٌ بلا تاريخ في شهر لم يقع فيه.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SANAD_DB = join(mkdtempSync(join(tmpdir(), 'sanad-cash-unit-')), 't.db'); // لا يُفتح: لا استعلام هنا
const { ym, monthAxis, summarizeKeyed, yearTrack, monthlyFractions } =
  await import('../../src/core/reports/project-cash.js');

test('مفتاح الشهر ومحوره: اثنا عشر شهراً بأسماء عربية كاملة', () => {
  assert.equal(ym(2026, 3), '2026-03');
  assert.equal(ym(2026, 11), '2026-11');
  const axis = monthAxis(2026);
  assert.equal(axis.length, 12);
  assert.deepEqual(axis[0], { month: 1, key: '2026-01', label: 'يناير' });
  assert.equal(axis[11].label, 'ديسمبر');
});

test('التلخيص: المجموع والعدد والسنوات، وما لا تاريخ له يُعزل ولا يُحذف', () => {
  const s = summarizeKeyed([
    { key: '2026-02', amount_halalas: 1000, count: 1 },
    { key: '2026-02', amount_halalas: 500, count: 2 },
    { key: '2025-09', amount_halalas: 700, count: 1 },
    { key: null, amount_halalas: 300, count: 1 },
  ]);
  assert.equal(s.any, true);
  assert.equal(s.total_halalas, 2500, 'ما لا تاريخ له داخل المجموع الكلي');
  assert.equal(s.count, 5);
  assert.deepEqual(s.undated, { amount_halalas: 300, count: 1 });
  assert.deepEqual(s.years, [2025, 2026]);
  // خانة الشهر تحمل الصافي كذلك منذ فصل الضريبة (ترحيلة ٠١٩) — وهي صفرٌ هنا لأن هذه الصفوف
  // لا تحمل صافياً أصلاً، ويُقال ذلك صراحةً في `net_recorded` لا يُقرأ من الصفر.
  assert.deepEqual(s.byKey['2026-02'], { amount_halalas: 1500, count: 3, net_halalas: 0 },
    'الشهر الواحد يُجمع مرة واحدة');
  assert.equal(s.net_recorded, false, 'لا صافيَ على هذه الصفوف — والغياب ليس صفراً');
  assert.equal(s.net_total_halalas, null, 'فيخرج فارغاً لتقول الشاشة «غير مُسجَّل»');
});

test('التلخيص يجمع الصافي مع الإجمالي في مرور واحد حين يحمله الصف', () => {
  // المبالغ التي تحمل ضريبة تمرّ بصافيها في القناة نفسها، فلا يفترق مجموعٌ عن مجموع لاختلاف
  // شرطٍ بين استعلامين. والمبلغ الثاني لا يقبل القسمة على ١١٥ عمداً.
  const s = summarizeKeyed([
    { key: '2026-02', amount_halalas: 41262000, net_halalas: 35880000, count: 1 },
    { key: '2026-03', amount_halalas: 10000, net_halalas: 8695, count: 1 },
  ]);
  assert.equal(s.net_recorded, true);
  assert.equal(s.total_halalas, 41272000);
  assert.equal(s.net_total_halalas, 35888695);
  assert.equal(s.net_total_halalas + s.vat_total_halalas, s.total_halalas, 'الجمع مغلق على المجموع');
});

test('لا صفوف = لا تسجيل: `any` كاذبة كي تقول الشاشة «لم يُسجَّل» لا «صفر»', () => {
  const s = summarizeKeyed([]);
  assert.equal(s.any, false);
  assert.equal(s.total_halalas, 0, 'المجموع الحسابي صفر — لكن قرار العرض يقرأ any لا هذا الرقم');
  assert.equal(s.count, 0);
  assert.deepEqual(s.years, []);
});

test('الشريط السنوي: أصفار الأشهر الخالية قياس، وما خارج السنة لا يتسلل إليها', () => {
  const s = summarizeKeyed([
    { key: '2026-02', amount_halalas: 1500, count: 1 },
    { key: '2025-12', amount_halalas: 900, count: 1 },
    { key: null, amount_halalas: 100, count: 1 },
  ]);
  const t = yearTrack(s, 2026);
  assert.equal(t.months.length, 12);
  assert.equal(t.total_halalas, 1500, 'سنة أخرى وما بلا تاريخ خارج مجموع السنة');
  assert.equal(t.count, 1);
  assert.equal(t.months[1].amount_halalas, 1500);
  assert.equal(t.months[0].amount_halalas, 0);
  assert.equal(t.months[1].key, '2026-02');
  assert.equal(t.months[1].label, 'فبراير');
  assert.equal(yearTrack(s, 2025).total_halalas, 900, 'كل سنة تُقرأ من مفاتيحها هي');
});

test('نِسَب التسكين تُقرأ كما خُزِّنت: كسرٌ لكل شهر، وما شذّ يُتجاهل بلا انهيار', () => {
  assert.deepEqual(monthlyFractions('{"2":1,"3":0.5}'),
    [0, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(monthlyFractions('{"1":1.5}')[0], 1.5, 'التحميل الزائد المسجَّل يُعرض كما هو لا يُقصّ');
  assert.deepEqual(monthlyFractions('{"0":1,"13":1}'), Array(12).fill(0), 'شهر خارج 1..12 يُتجاهل');
  assert.deepEqual(monthlyFractions('نصّ تالف'), Array(12).fill(0), 'خريطة تالفة تُقرأ فراغاً لا خطأً');
  assert.deepEqual(monthlyFractions(null), Array(12).fill(0));
  assert.deepEqual(monthlyFractions('{"4":"0.25"}')[3], 0.25, 'الكسر النصّي يُقرأ رقماً');
});
