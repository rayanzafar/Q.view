// ── تطبيع العربية للبحث والمطابقة — مصدرٌ واحد ─────────────────────────────────────────────────
//
// كانت في المنصة عشرُ نسخٍ من «التطبيع» متفرّقة (سجل الجهات، الهوية، الهيكل، الاحتياجات، الدليل،
// ومنتقيات المتصفّح) يختلف بعضها عن بعض في حرفٍ أو حرفين — فتُوجد الجهة من شاشةٍ ولا تُوجد من
// أخرى بالاسم نفسه. والتدقيق المستقل (12 سبتمبر 2026، M-1) سجّل أن البحث من المحادثة يخفق على
// الفوارق التي لا يراها القارئ العربي أصلاً: همزةٌ فوق الألف أو تحتها، تاءٌ مربوطة أو هاء، ألفٌ
// مقصورة أو ياء، تشكيلٌ ومدّة، ورقمٌ هندي أو عربي.
//
// القاعدة هنا **للمطابقة لا للعرض**: النصّ يُعرض كما كُتب دائماً، ويُطبَّع في الذاكرة لحظة المقارنة
// فقط. ولا يُخزَّن مطبَّعاً في القاعدة — فالمخزَّن حقيقةٌ مصدرية، والتطبيع رأيٌ في التشابه.
//
// وحدودُ التسامح مقصودة: توحيدُ الأشكال التي لا تفرّق معنىً في أسماء الناس والجهات (أ/إ/آ/ا،
// ة/ه، ى/ي، ؤ/و، ئ/ي)، وحذفُ ما لا يُكتب باطّراد (التشكيل والتطويل)، وخطأٌ واحد في الكلمة الطويلة
// (خمسة أحرف فأكثر) — لا أكثر، كي لا يُطابَق «سالم» على «سلام» بثقةٍ لا يملكها أحد.
const TASHKEEL = /[ً-ٰٟـ]/g;      // الحركات والشدّة والسكون والألف الخنجرية والتطويل
const ALEF = /[أإآٱ]/g;           // أ إ آ ٱ ⟵ ا
const INDIC = /[٠-٩]/g;                     // ٠..٩ ⟵ 0..9
const EXT_INDIC = /[۰-۹]/g;                 // ۰..۹ (الفارسية) ⟵ 0..9
const PUNCT = /[،؛؟٪-٭.,;:!?'"«»()\[\]{}/\\|_\-–—*+~^%$#@&<>=]+/g;

export function normalizeArabic(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(TASHKEEL, '')
    .replace(ALEF, 'ا')
    .replace(/ة/g, 'ه')          // ة ⟵ ه
    .replace(/ى/g, 'ي')          // ى ⟵ ي
    .replace(/ؤ/g, 'و')          // ؤ ⟵ و
    .replace(/ئ/g, 'ي')          // ئ ⟵ ي
    .replace(INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXT_INDIC, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// «ال» التعريف تُحذف من أول الكلمة إن بقي بعدها ثلاثة أحرف فأكثر: «الحوكمة» و«حوكمة» كلمةٌ
// واحدة في نيّة الباحث — وتُطبَّق على كلمات النصّ والاستعلام معاً كي تُقارَن المطابقة التامة
// والبادئة على الشكل نفسه.
const stripAl = (w) => (w.length >= 5 && w.startsWith('ال') ? w.slice(2) : w);

// كلمات الاستعلام بعد التطبيع ونزع «ال».
export function searchTokens(q) {
  return normalizeArabic(q).split(' ').filter(Boolean).map(stripAl);
}

// مسافةُ تحريرٍ محدودة بواحد (إدراج/حذف/إبدال/تبديل حرفين متجاورين): تُجيب «نعم/لا» بلا جدول كامل.
export function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i += 1;
  if (i === la || i === lb) return true;                       // إدراج/حذف في الآخر
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;         // إبدال حرف
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);  // تبديل متجاورين
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);        // إدراج/حذف في الوسط
}

// درجة المطابقة: 0 لا شيء · 1 تقريبية (خطأ واحد في كلمة طويلة) · 2 كل الكلمات موجودة · 3 يبدأ بها · 4 مطابقة تامة.
export function matchScore(text, q) {
  const t = normalizeArabic(text);
  // طولُ الكلمة يُحكم عليه كما كُتبت («الحوكه» طويلة وإن صارت «حوكه» بعد نزع «ال») — فالتقريب
  // للكلمة الطويلة وحدها، و«سلام» لا تُقارَب على «سالم».
  const tokens = normalizeArabic(q).split(' ').filter(Boolean).map((w) => ({ t: stripAl(w), long: w.length >= 5 }));
  if (!t || !tokens.length) return 0;
  const stripped = t.split(' ').map(stripAl);       // كلمات النصّ بلا «ال» — الشكل الذي قُورن به الاستعلام
  const ts = stripped.join(' ');
  const qn = tokens.map((x) => x.t).join(' ');
  if (ts === qn) return 4;
  if (ts.startsWith(qn)) return 3;
  let fuzzy = false;
  for (const { t: tok, long } of tokens) {
    // الاحتواء يُفحص على الشكلين: كلمةٌ قصيرة في الاستعلام («الع») قد تكون بادئةَ كلمةٍ نُزعت «ال» منها
    if (t.includes(tok) || ts.includes(tok)) continue;
    const hit = long && stripped.some((w) => w.length >= 4 && withinOneEdit(w, tok));
    if (!hit) return 0;
    fuzzy = true;
  }
  return fuzzy ? 1 : 2;
}

export const matchesQuery = (text, q) => matchScore(text, q) > 0;

// أفضل درجة بين عدة حقول (اسم، مسمّى، مهارة…) — للترتيب.
export function bestScore(fields, q) {
  let best = 0;
  for (const f of fields) { const s = matchScore(f, q); if (s > best) best = s; }
  return best;
}
