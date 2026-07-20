// محلّلات الخلايا المطبوعة لمحرك الاستيراد — كل قيمة خام من الملف تمر من هنا قبل أي حفظ.
// القواعد: أرقام هندية/فواصل عربية مقبولة (normalizeDigits)، المال يُخزَّن هللات صحيحة،
// التواريخ تُطبَّع إلى YYYY-MM-DD، والأخطاء عربية واضحة تشرح ما حدث وكيف يُصحَّح.
import { normalizeDigits } from './xlsx.js';

// خطأ خلية: رسالة عربية تُغلَّف لاحقاً بعنوان الصف/العمود في المحرك.
export class CellError extends Error {}
const cellErr = (msg) => new CellError(msg);

// تطبيع نص للمطابقة (ترويسات الأعمدة + قيم lookup): إزالة التشكيل والتطويل،
// توحيد الهمزات والياء/الهاء المتطرفة، خفض الحالة، وضغط الفراغات.
export function normalizeText(s) {
  return String(s == null ? '' : s)
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[‎‏‪-‮]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// نص: قصّ الفراغات + إزالة محارف التحكم الاتجاهية غير المرئية.
export function parseText(raw) {
  const s = String(raw == null ? '' : raw).replace(/[‎‏‪-‮]/g, '').trim();
  return s === '' ? null : s;
}

// مبلغ مالي: ريال (يقبل ١٥٠٬٠٠٠ و 150,000.50 و "150000 ريال") → هللات صحيحة.
export function parseMoney(raw, { min, max } = {}) {
  let s = normalizeDigits(String(raw)).trim()
    .replace(/ر\.?\s*س\.?|ريال(?:\s*سعودي)?|sar/gi, '')
    .replace(/[\s ]/g, '');
  if (!/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    throw cellErr('قيمة مالية غير صالحة — اكتب رقماً مثل 150000 أو ١٥٠٬٠٠٠');
  }
  const val = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(val)) throw cellErr('قيمة مالية غير صالحة — اكتب رقماً مثل 150000');
  if (min != null && val < min) throw cellErr(`المبلغ أقل من الحد الأدنى (${min})`);
  if (max != null && val > max) throw cellErr(`المبلغ أكبر من الحد الأعلى (${max})`);
  return Math.round(val * 100); // هللات
}

// عدد صحيح (يقبل الأرقام الهندية).
export function parseIntCell(raw, { min, max } = {}) {
  const s = normalizeDigits(String(raw)).trim().replace(/,/g, '');
  if (!/^-?\d+$/.test(s)) throw cellErr('يجب أن تكون القيمة عدداً صحيحاً مثل 2026');
  const n = Number(s);
  if (min != null && n < min) throw cellErr(`العدد أقل من الحد الأدنى (${min})`);
  if (max != null && n > max) throw cellErr(`العدد أكبر من الحد الأعلى (${max})`);
  return n;
}

// نسبة مئوية 0–100 (أو حد أعلى مخصص، يقبل "85%" و ٨٥).
export function parsePct(raw, { min = 0, max = 100 } = {}) {
  const s = normalizeDigits(String(raw)).trim().replace(/[%٪]/g, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw cellErr('نسبة غير صالحة — اكتب رقماً بين 0 و100 مثل 85');
  const n = Number(s);
  if (n < min || n > max) throw cellErr(`النسبة يجب أن تكون بين ${min} و${max}`);
  return n;
}

// تاريخ: يوم/شهر/سنة (31/12/2026) أو سنة-شهر-يوم (2026-12-31) → نص YYYY-MM-DD.
export function parseDate(raw) {
  const s = normalizeDigits(String(raw)).trim();
  let y, m, d;
  let mt = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (mt) { [, y, m, d] = mt.map(Number); }
  else {
    mt = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (mt) { d = Number(mt[1]); m = Number(mt[2]); y = Number(mt[3]); }
  }
  if (y == null) throw cellErr('صيغة تاريخ غير معروفة — استخدم يوم/شهر/سنة (31/12/2026) أو 2026-12-31');
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || d < 1 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2200) {
    throw cellErr('تاريخ غير موجود في التقويم — تحقق من اليوم والشهر');
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// قيمة من قائمة محددة. options = [{v: القيمة المخزنة, labels: [الصيغ المقبولة]}].
// التصدير يكتب labels[0]؛ الاستيراد يقبل أي صيغة (أو القيمة المخزنة نفسها).
export function parseEnum(raw, options) {
  const q = normalizeText(raw);
  for (const o of options) {
    if (normalizeText(o.v) === q) return o.v;
    if ((o.labels || []).some((l) => normalizeText(l) === q)) return o.v;
  }
  const allowed = options.map((o) => (o.labels || [])[0] || o.v).join('، ');
  throw cellErr(`قيمة غير معروفة — الخيارات المتاحة: ${allowed}`);
}
export const enumLabel = (options, v) =>
  (options.find((o) => o.v === v)?.labels || [v])[0] ?? '';

/**
 * باني مُحلّ lookup: يطابق القيمة الخام على المعرّف أو الكود أو الاسم العربي المطبَّع.
 * عند التعذر يرمي خطأ عربياً يسرد أقرب المرشحين حتى يعرف المستخدم ماذا يكتب.
 * @param {Array<object>} rows صفوف المصدر
 * @param {object} opts { label, codeKeys=['code'], nameKeys=['name_ar','name_en'] }
 */
export function makeLookup(rows, { label, codeKeys = ['code'], nameKeys = ['name_ar', 'name_en'] } = {}) {
  const byId = new Map();
  const byCode = new Map();
  const byName = new Map();
  for (const r of rows) {
    byId.set(String(r.id), r);
    for (const k of codeKeys) if (r[k]) byCode.set(String(r[k]).trim().toLowerCase(), r);
    for (const k of nameKeys) if (r[k]) { const n = normalizeText(r[k]); if (n && !byName.has(n)) byName.set(n, r); }
  }
  const resolve = (raw) => {
    const s = String(raw).trim();
    const hit = byId.get(s) || byCode.get(s.toLowerCase()) || byName.get(normalizeText(s));
    if (hit) return hit;
    // مرشحون قريبون: تطابق جزئي على الاسم المطبَّع
    const q = normalizeText(s);
    const cands = [];
    for (const [n, r] of byName) {
      if (q && (n.includes(q) || q.includes(n))) { cands.push(r[nameKeys[0]] || r.id); if (cands.length >= 3) break; }
    }
    const hint = cands.length ? ` — أقرب المتاح: ${cands.join('، ')}` : '';
    throw cellErr(`«${s}» غير موجود في ${label}${hint}`);
  };
  resolve.rows = rows;
  return resolve;
}

/**
 * محلّل الخلية الموحّد. col = {key, labelAr, parse, required, min, max, enum, lookup}.
 * الفارغ: خطأ إن كان العمود مطلوباً، وإلا null. lookups = { اسمlookup: دالة محلّ }.
 */
export function parseCell(col, raw, lookups = {}) {
  const s = raw == null ? '' : String(raw).trim();
  if (s === '') {
    if (col.required) throw cellErr('القيمة مطلوبة — هذه الخانة لا يمكن أن تبقى فارغة');
    return null;
  }
  switch (col.parse || 'text') {
    case 'money': return parseMoney(s, col);
    case 'int': return parseIntCell(s, col);
    case 'pct': return parsePct(s, col);
    case 'date': return parseDate(s);
    case 'enum': return parseEnum(s, col.enum);
    case 'lookup': {
      const fn = lookups[col.lookup];
      if (!fn) throw cellErr('تعذّر التحقق من هذه الخانة — أعد المحاولة');
      return fn(s).id;
    }
    default: return parseText(s);
  }
}
