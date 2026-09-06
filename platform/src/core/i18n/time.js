// النموذج الزمني الواحد للمنصة كلها — كل شريط أشهر/أرباع في أي صفحة أو تقرير أو ملف
// يستمد أسماءه واتجاهه من هنا حصراً. القاعدة (من مالك المنتج):
//   • أسماء عربية كاملة حيث تتسع المساحة — الاختصارات العربية («ينا/فبر») محظورة نهائياً.
//   • الضيّق جداً (رؤوس شبكات على الجوال) يسقط إلى Jan–Dec الإنجليزية، لا إلى اختصار عربي.
//   • الاتجاه: الزمن يُقرأ كما يُقرأ النص — يناير في أقصى اليمين وديسمبر في أقصى اليسار
//     (فئة .mtrack في layout.js: grid بـdirection:rtl). لا شريط زمني LTR بعد اليوم.
//     • استثناءٌ واحدٌ معلن (2026-08-24، نموذج المالك المرجعي المفصَّل — ADR-0011 تعديل ثانٍ):
//       **شاشة مركز القطاع وحدها** تقرأ محاور الزمن يساراً عبر خيار `axisDir:'ltr'` في
//       figLine/figCombo وخيار `ltr` في figHeat. الافتراض في الأوليات يبقى يمينياً، فلا
//       تتبدّل صفحةٌ أخرى ما لم تمرّر الخيار صراحةً. والأسماء عربية كاملة كما هي.
//   • مؤشر «نحن هنا» موحّد: النقطة الذهبية nowDot() لا غير.
// ── ساعة الرياض: مصدرٌ واحد للتحية ونافذة البريد وكل ما يسأل «كم الساعة عندنا» ──
// السعودية على +٣ ثابتة بلا توقيتٍ صيفي، فالإزاحة رقمٌ لا جدولُ مناطق.
export const RIYADH_OFFSET_HOURS = 3;
export function riyadhHour(date = new Date()) {
  return (date.getUTCHours() + RIYADH_OFFSET_HOURS) % 24;
}
// يومُ الرياض YYYY-MM-DD — يتقدّم على يوم UTC بعد التاسعة مساءً، وهذا هو المقصود:
// «مرة باليوم» بيوم الناس هنا لا بيوم غرينتش.
export function riyadhDate(date = new Date()) {
  return new Date(date.getTime() + RIYADH_OFFSET_HOURS * 3600000).toISOString().slice(0, 10);
}

export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const MONTHS_EN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// أيام الأسبوع من الأحد (getDay صفري) — لا من الاثنين: أسبوع العمل في السعودية يبدأ الأحد
// وينتهي الخميس، وأي شبكة تقويم تبدأ بالاثنين تضع عطلة الجمعة والسبت في منتصف الصفّ.
export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
// حرفٌ واحد لرؤوس شبكة التقويم حيث لا تتسع الأسماء — عربيةٌ دائماً، لا اختصار لاتيني.
export const WEEKDAYS_AR_1 = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
export const QUARTERS_AR = ['الربع الأول', 'الربع الثاني', 'الربع الثالث', 'الربع الرابع'];
// صيغة قصيرة للأرباع حيث لا يتسع الاسم الكامل (أزرار تبديل مثلاً)
export const QUARTERS_SHORT = ['الأول', 'الثاني', 'الثالث', 'الرابع'];

// i صفرية (0=يناير). density: 'full' افتراضياً، 'tight' للرؤوس الضيقة (إنجليزية).
export const monthLabel = (i, density = 'full') => (density === 'tight' ? MONTHS_EN3[i] : MONTHS_AR[i]);

// عنوان مزدوج يختار الـCSS منه حسب عرض الشاشة: كامل عربي على الواسع، Jan على الضيق.
// (فئتا .m-full/.m-tight معرّفتان في layout.js)
export const monthLabelDual = (i) =>
  `<span class="m-full">${MONTHS_AR[i]}</span><span class="m-tight">${MONTHS_EN3[i]}</span>`;

// q صفرية (0=الربع الأول)
export const quarterLabel = (q) => QUARTERS_AR[q] || '';

// فهرس الشهر الحالي (صفري) إن كانت السنة المعروضة هي الجارية، وإلا -1 (لا مؤشر «الآن» على سنة أخرى)
export const currentMonthIndex = (year) => {
  const d = new Date();
  return Number(year) === d.getUTCFullYear() ? d.getUTCMonth() : -1;
};

// مؤشر «نحن هنا» الموحد — نقطة ذهبية بحلقة (فئة .now-dot في layout.js)
export const nowDot = (title = 'الشهر الحالي') => `<span class="now-dot" title="${title}"></span>`;

// «انقضى N% من السنة» — تُستخدم مع مقاييس الإيقاع وشرائط الأشهر
export const yearElapsedPct = (today = new Date(), year = today.getUTCFullYear()) => {
  const y = Number(year);
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  const t = today.getTime();
  if (t <= start) return 0;
  if (t >= end) return 100;
  return Math.round(((t - start) / (end - start)) * 100);
};
