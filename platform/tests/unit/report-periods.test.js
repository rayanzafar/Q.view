// النموذج الزمني لتقرير الفترة — الحدود والأسماء.
// ما يحرسه هذا الملف:
//   ١) حدود الأسبوع والشهر والربع صحيحة، بما فيها حافّة السنة (أسبوع يعبر ديسمبر/يناير،
//      وربع رابع يسبقه ربع أول من السنة التالية) وفبراير الكبيسة.
//   ٢) الأسماء عربية كاملة دائماً — لا اختصار عربي («ينا/فبر») ولا إنجليزي (Jan/Dec).
//      القاعدة موثّقة في core/i18n/time.js وهذا الملف يمنع أول انحراف عنها.
//   ٣) الفترة الجارية تُميَّز عن المكتملة، فلا يُقرأ أسبوع نصفه لم يأتِ بعد وكأنه أسبوع كامل.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// الوحدة تستورد طبقة الوصول للبيانات، فنمنحها ملفاً مؤقتاً — ولا استعلام واحد في هذا الملف.
process.env.SANAD_DB = join(mkdtempSync(join(tmpdir(), 'sanad-periods-unit-')), 't.db');

const { resolvePeriod, previousPeriod, periodChoices, PERIOD_KINDS, WEEK_START_DOW } =
  await import('../../src/core/reports/periods.js');

const MONTHS_SHORT_AR = ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

test('الأسبوع: يبدأ الأحد وينتهي السبت، والاسم يحمل يومي الطرف والشهر كاملاً', () => {
  assert.equal(WEEK_START_DOW, 0, 'أسبوع العمل السعودي يبدأ الأحد');
  const p = resolvePeriod('week', '2026-07-22', '2026-07-27');
  assert.equal(p.from, '2026-07-19');
  assert.equal(p.to, '2026-07-25');
  assert.equal(new Date(p.from + 'T00:00:00Z').getUTCDay(), 0);
  assert.equal(new Date(p.to + 'T00:00:00Z').getUTCDay(), 6);
  assert.equal(p.label_ar, 'أسبوع 19–25 يوليو 2026');
});

test('الأسبوع: أي يوم داخله يعطي الحدود نفسها (المرساة ليست بداية الأسبوع)', () => {
  const days = ['2026-07-19', '2026-07-20', '2026-07-23', '2026-07-25'];
  const set = new Set(days.map((d) => `${resolvePeriod('week', d, '2026-07-27').from}|${resolvePeriod('week', d, '2026-07-27').to}`));
  assert.equal(set.size, 1, 'كل أيام الأسبوع تنتمي لفترة واحدة');
});

test('حافّة السنة: أسبوع يعبر ديسمبر/يناير يحمل السنتين واسمي الشهرين كاملين', () => {
  const p = resolvePeriod('week', '2026-12-31', '2026-07-27');
  assert.equal(p.from, '2026-12-27');
  assert.equal(p.to, '2027-01-02');
  assert.equal(p.label_ar, 'أسبوع 27 ديسمبر 2026 – 2 يناير 2027');
  assert.equal(p.months.length, 2);
  assert.deepEqual(p.months, [{ year: 2026, month: 12 }, { year: 2027, month: 1 }]);
});

test('الأسبوع العابر لشهرين داخل السنة نفسها يذكر الشهرين مرة والسنة مرة', () => {
  const p = resolvePeriod('week', '2026-07-28', '2026-07-27');
  assert.equal(p.from, '2026-07-26');
  assert.equal(p.to, '2026-08-01');
  assert.equal(p.label_ar, 'أسبوع 26 يوليو – 1 أغسطس 2026');
});

test('الشهر: من أوله إلى آخره، والاسم «الشهر السنة»', () => {
  const p = resolvePeriod('month', '2026-02-15', '2026-07-27');
  assert.equal(p.from, '2026-02-01');
  assert.equal(p.to, '2026-02-28');
  assert.equal(p.label_ar, 'فبراير 2026');
  assert.equal(p.index, 2);
});

test('الشهر: فبراير في سنة كبيسة ينتهي في التاسع والعشرين', () => {
  assert.equal(resolvePeriod('month', '2028-02-10', '2026-07-27').to, '2028-02-29');
  assert.equal(resolvePeriod('month', '2026-12-05', '2026-07-27').to, '2026-12-31');
});

test('الربع: ثلاثة أشهر كاملة، والاسم من مفردات الأرباع العربية', () => {
  const q3 = resolvePeriod('quarter', '2026-07-22', '2026-07-27');
  assert.equal(q3.from, '2026-07-01');
  assert.equal(q3.to, '2026-09-30');
  assert.equal(q3.label_ar, 'الربع الثالث 2026');
  assert.equal(q3.months.length, 3);
  const q1 = resolvePeriod('quarter', '2026-01-01', '2026-07-27');
  assert.equal(q1.label_ar, 'الربع الأول 2026');
  assert.equal(q1.from, '2026-01-01');
  assert.equal(q1.to, '2026-03-31');
});

test('حافّة السنة: الربع الرابع ينتهي بنهاية ديسمبر، والسابق للربع الأول 2027 هو الرابع 2026', () => {
  const q4 = resolvePeriod('quarter', '2026-12-31', '2026-07-27');
  assert.equal(q4.from, '2026-10-01');
  assert.equal(q4.to, '2026-12-31');
  assert.equal(q4.label_ar, 'الربع الرابع 2026');
  const q1next = resolvePeriod('quarter', '2027-02-11', '2026-07-27');
  const prev = previousPeriod(q1next, '2026-07-27');
  assert.equal(prev.label_ar, 'الربع الرابع 2026');
  assert.equal(prev.from, '2026-10-01');
  assert.equal(prev.to, '2026-12-31');
});

test('السابق لشهر يناير هو ديسمبر السنة الماضية، ولأسبوع أول السنة أسبوعٌ في ديسمبر', () => {
  const jan = resolvePeriod('month', '2027-01-14', '2026-07-27');
  assert.equal(previousPeriod(jan, '2026-07-27').label_ar, 'ديسمبر 2026');
  const w = resolvePeriod('week', '2027-01-06', '2026-07-27');
  assert.equal(w.from, '2027-01-03');
  const wprev = previousPeriod(w, '2026-07-27');
  assert.equal(wprev.from, '2026-12-27');
  assert.equal(wprev.to, '2027-01-02');
  assert.equal(wprev.label_ar, 'أسبوع 27 ديسمبر 2026 – 2 يناير 2027');
});

test('لا اختصار عربي ولا إنجليزي في أي اسم فترة', () => {
  const labels = [];
  for (const kind of PERIOD_KINDS) {
    for (const d of ['2026-01-05', '2026-02-20', '2026-06-30', '2026-08-14', '2026-11-02', '2026-12-29']) {
      labels.push(resolvePeriod(kind, d, '2026-07-27').label_ar);
    }
  }
  for (const l of labels) {
    for (const abbr of MONTHS_SHORT_AR) {
      assert.ok(!new RegExp(abbr + '(?![ا-ي])').test(l), `اختصار عربي ممنوع في «${l}»`);
    }
    for (const en of MONTHS_EN) assert.ok(!l.includes(en), `اسم شهر إنجليزي ممنوع في «${l}»`);
  }
});

test('الفترة الجارية تُميَّز عن المكتملة وعن التي لم تبدأ', () => {
  const running = resolvePeriod('month', '2026-07-15', '2026-07-27');
  assert.equal(running.partial, true);
  assert.equal(running.complete, false);
  assert.equal(running.as_of, '2026-07-27');
  const done = resolvePeriod('month', '2026-05-15', '2026-07-27');
  assert.equal(done.complete, true);
  assert.equal(done.partial, false);
  const notYet = resolvePeriod('month', '2026-09-15', '2026-07-27');
  assert.equal(notYet.future, true);
  assert.equal(notYet.partial, false);
});

test('قائمة الفترات: الأحدث أولاً، بلا تكرار، وأولها الفترة الحالية', () => {
  const ch = periodChoices('quarter', '2026-07-27', 6);
  assert.equal(ch.length, 6);
  assert.equal(ch[0].current, true);
  assert.equal(ch[0].label_ar, 'الربع الثالث 2026');
  assert.equal(ch[1].label_ar, 'الربع الثاني 2026');
  assert.equal(ch[4].label_ar, 'الربع الثالث 2025');
  assert.equal(new Set(ch.map((c) => c.anchor)).size, 6);
});

test('مدخل غير صالح يردّ برسالة عربية لا بانهيار', () => {
  assert.throws(() => resolvePeriod('yearly', '2026-07-27'), (e) => e.status === 400 && /أسبوع/.test(e.message));
  assert.throws(() => resolvePeriod('week', 'الأسبوع الماضي'), (e) => e.status === 400 && /الفترة/.test(e.message));
});
