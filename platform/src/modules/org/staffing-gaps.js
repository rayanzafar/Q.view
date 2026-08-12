// ── الفجوات التاريخية في التسكين (v5.26) ─────────────────────────────────────
//
// «إذا كان الموظف نشطاً خلال شهرٍ سابق ولم يكن له أي تسكين لذلك الشهر: يدخل في حساب
// القطاع صفراً ويظهر فجوةً» — حزمة المالك. الوحدة موظف-شهر، والمقام أشهرُ نشاطه فعلاً.
//
// حسابٌ نقي بلا قاعدة: يعمل على صفوف `staffingRoster` كما تعود (months[12] بالنِّسب،
// hire_date/end_date/active) — فيُختبر وحده بلا بذرة، ولا يمسّ عقد الroster المثبَّت.
//
// حدود الصدق (decision-log ق٢/ق٣):
// • الشهر الحالي ليس فجوة — هو «غير مُسكَّن الآن» (بلاطة قائمة)؛ عدُّه هنا عدٌّ مزدوج.
// • «صفر صريح» لا يوجد في التخزين (صفر الخلية يمسح مفتاحها — projects.js) فكل صفرٍ
//   ماضٍ لنشطٍ فجوةٌ حقاً، لا التباس بين «لا سجل» و«سجل بصفر».
// • لا تأريخ هيكلي في النظام: الفجوة تُنسب لقطاع/إدارة الموظف الحالية، ومن عُطّل حسابه
//   اليوم لا تُرى فجواته الماضية — قيدان معلنان لا يُخترع لهما تاريخ.

const pad2 = (m) => String(m).padStart(2, '0');
// آخر يوم الشهر بطول ثابت — شباط 28/29 لا يهم: المقارنة نصية ISO و«31» يغطي كل نهاية شهر
// لأن تاريخ التعيين الحقيقي لا يتجاوز أيام شهره.
const monthStart = (year, m) => `${year}-${pad2(m)}-01`;
const monthEnd = (year, m) => `${year}-${pad2(m)}-31`;

// نشِطٌ في الشهر: علم النشاط قائم، وتعيينه لا يلي نهاية الشهر، ونهايته (إن سُجّلت) لا تسبق
// أوله. التواريخ ISO (yyyy-mm-dd) فتكفي المقارنة النصية على المحرّكين.
export function activeInMonth(emp, year, m) {
  if (!emp || Number(emp.active) === 0) return false;
  const hire = (emp.hire_date || '').slice(0, 10);
  const end = (emp.end_date || '').slice(0, 10);
  if (hire && hire > monthEnd(year, m)) return false;
  if (end && end < monthStart(year, m)) return false;
  return true;
}

// أشهر «الماضي» للسنة المعروضة: سنةٌ خلت = كلها، السنة الحالية = حتى الشهر السابق
// (الحالي مستثنى)، وسنةٌ قادمة لا ماضي لها.
export function pastMonthsOf(year, now = new Date()) {
  const nowY = now.getUTCFullYear();
  if (year < nowY) return Array.from({ length: 12 }, (_, i) => i + 1);
  if (year > nowY) return [];
  const prev = now.getUTCMonth(); // 0-11 ⇒ عدد الأشهر المكتملة قبل الحالي
  return Array.from({ length: prev }, (_, i) => i + 1);
}

// الفجوات على كشفٍ محمَّل: لكل موظفٍ أشهرُ نشاطه الماضية التي مجموعها صفر.
// months[] كما يعيدها الكشف: نسبٌ صحيحة لكل شهر (الفهرس 0 = يناير).
export function gapsFor(roster, year, now = new Date()) {
  const past = pastMonthsOf(year, now);
  const byEmp = {};
  let gapMonths = 0;
  let activeMonths = 0;
  for (const e of roster || []) {
    const months = Array.isArray(e.months) ? e.months : [];
    const mine = [];
    for (const m of past) {
      if (!activeInMonth(e, year, m)) continue;
      activeMonths++;
      if (Number(months[m - 1] || 0) === 0) mine.push(m);
    }
    if (mine.length) { byEmp[e.id] = mine; gapMonths += mine.length; }
  }
  return { byEmp, gapMonths, activeMonths, employeesWithGaps: Object.keys(byEmp).length };
}
