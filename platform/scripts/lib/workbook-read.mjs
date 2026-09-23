// قراءة دفتر التعبئة ومطابقة ما فيه — دوالُّ خالصة بلا قاعدة بيانات ولا خدمة.
//
// هذا الملف نصفُ العملية الأول: يحوِّل ملف إكسل الذي عبّأه الفريق إلى صفوفٍ نظيفةٍ مفهومة،
// ويقيس قربَ كل اسمٍ فيه من أسماء المنصة. ولا يكتب شيئاً ولا يقرأ قاعدةً — فيصحّ تشغيله
// وحده، ويصحّ اختباره وحده، ويستحيل أن يُحدث أثراً بالخطأ. الطرفُ الذي يكتب (‏apply) يستورد
// منه ولا يستورد هو منه شيئاً.
//
// لماذا لا يُستورد `src/modules/team/resources.js` ولا `src/modules/io/adapters/projects.js`
// رغم أن الخرائط فيهما: كلاهما يستورد طبقةَ القاعدة في أول سطوره، فاستيرادُه هنا يفتح اتصالاً
// بقاعدةٍ لا يحتاجها أحد ويكسر شرطَ «لا قاعدة». فالخرائط **مرآةٌ** لما فيهما، ولها اختبارُ
// تزامنٍ في `tests/unit/workbook-reconcile.test.js` يقرأ نصّ الملفين ويرفض أي افتراق.
//   • أدوار التسكين  — مرآة ROLE_AR في src/modules/team/resources.js:46
//   • حالة المشروع والمؤشر — مرآة STATUS/RAG في src/modules/io/adapters/projects.js:10-23
// وأما `DELIVERABLE_STATUS_AR` فمن المعجم مباشرةً (‏src/web/i18n/glossary.js) لأنه لا يستورد
// قاعدةً أصلاً.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as XLSX from '../../vendor/xlsx/xlsx.mjs';
import {
  ALL_SHEETS, SHEETS, EXAMPLE_PREFIX, isHelper, isCalc, setWithCosts, sheetKey,
} from '../make-sap-intake-workbook.mjs';
import { normalizeDigits } from '../../src/modules/io/xlsx.js';
import { parseDate, CellError } from '../../src/modules/io/parse.js';
import { grossOfNet } from '../../src/modules/finance/vat.js';
import { DELIVERABLE_STATUS_AR } from '../../src/web/i18n/glossary.js';

// ─────────────────────────────────────────────────────────────────────────────
// §1 تطبيع النص العربي
// ─────────────────────────────────────────────────────────────────────────────

// محارف التشكيل والتطويل وعلامات الاتجاه غير المرئية — تُحذف قبل أي مقارنة.
const RE_TASHKEEL = /[ً-ْٓ-ٰٕـ]/g;
const RE_INVISIBLE = /[​-‏‪-‮⁦-⁩؜﻿]/g;

/**
 * تطبيع اسمٍ عربي للمقارنة: يُسقط ما لا يغيّر المعنى ويوحّد ما يُكتب بأكثر من شكل.
 * تشكيل وتطويل وعلامات اتجاه تُحذف · أرقام هندية وفارسية تصير لاتينية · أإآٱ→ا · ى→ي ·
 * ة→ه · حروف فارسية (ک ی) تصير عربية · ؤ→و · ئ→ي · لاتينية تُخفَّض · الفراغات تُضغط.
 * @param {*} s النص الخام
 * @returns {string} النص المطبَّع
 */
export function normArabic(s) {
  if (s == null) return '';
  return String(s)
    .replace(RE_INVISIBLE, '')
    .replace(RE_TASHKEEL, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ک/g, 'ك')   // ک الفارسية
    .replace(/ی/g, 'ي')   // ی الفارسية
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ھ/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * مجموعة كلمات الاسم بعد تطبيعه — ما ليس حرفاً ولا رقماً فاصلٌ بين الكلمات.
 * @param {string|Set<string>} s
 * @returns {Set<string>}
 */
export function tokenSet(s) {
  if (s instanceof Set) return s;
  return new Set(normArabic(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/**
 * معامل جاكار بين مجموعتَي كلمات (أو نصَّين): المشترك ÷ المجموع.
 * @param {string|Set<string>} a
 * @param {string|Set<string>} b
 * @returns {number} بين 0 و1
 */
export function jaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 مطابقة اسمٍ واحد على مرشحين
// ─────────────────────────────────────────────────────────────────────────────

const nameOfCandidate = (c, field) => (typeof c === 'string' ? c : (c ? c[field] : ''));
const NO_MATCH = Object.freeze({ hit: null, score: 0, rule: null, ambiguous: false, runnerUp: null });

/**
 * مطابقة اسمٍ مكتوبٍ يدوياً على قائمة مرشحين، بسُلَّمٍ ينزل من اليقين إلى الترجيح:
 *   1. تطابقٌ حرفي بعد التطبيع → 1.0 (‎rule: 'exact')
 *   2. احتواءٌ من طرف (أحدهما جزء من الآخر) ووحدَه → 0.9 (‎rule: 'contains')؛
 *      ومرشحان يحتويان → التباسٌ لا اختيار.
 *   3. وإلا أفضلُ تشابه كلماتٍ ≥ العتبة وبفارقٍ ≥ الفجوة عن التالي → (‎rule: 'jaccard')؛
 *      وإن قَرُبَ التالي → التباس؛ وإن لم يبلغ العتبة → لا مطابقة.
 * @param {string} name الاسم كما كُتب في الدفتر
 * @param {Array<object|string>} candidates أسماء المنصة (أو كائناتها)
 * @param {{threshold?: number, gap?: number, field?: string}} [opts]
 * @returns {{hit: object|string|null, score: number, rule: ('exact'|'contains'|'jaccard'|null), ambiguous: boolean, runnerUp: object|string|null}}
 */
export function matchOne(name, candidates, { threshold = 0.7, gap = 0.15, field = 'name_ar' } = {}) {
  const q = normArabic(name);
  if (!q || !Array.isArray(candidates) || !candidates.length) return { ...NO_MATCH };
  const list = candidates
    .map((c) => ({ c, n: normArabic(nameOfCandidate(c, field)) }))
    .filter((x) => x.n);
  if (!list.length) return { ...NO_MATCH };

  const exact = list.filter((x) => x.n === q);
  if (exact.length) {
    return { hit: exact[0].c, score: 1, rule: 'exact', ambiguous: false, runnerUp: exact[1]?.c ?? null };
  }

  const contains = list.filter((x) => x.n.includes(q) || q.includes(x.n));
  if (contains.length === 1) {
    return { hit: contains[0].c, score: 0.9, rule: 'contains', ambiguous: false, runnerUp: null };
  }
  if (contains.length > 1) {
    // اثنان يحتويان الاسم: لا نرجّح بينهما — يُرفع التباساً ليقرّره إنسان.
    const ranked = contains
      .map((x) => ({ c: x.c, s: jaccard(q, x.n) }))
      .sort((a, b) => b.s - a.s);
    return { hit: null, score: 0.9, rule: 'contains', ambiguous: true, runnerUp: ranked[1].c };
  }

  const ranked = list.map((x) => ({ c: x.c, s: jaccard(q, x.n) })).sort((a, b) => b.s - a.s);
  const best = ranked[0];
  const second = ranked[1] || { c: null, s: 0 };
  if (best.s < threshold) {
    return { hit: null, score: best.s, rule: null, ambiguous: false, runnerUp: null };
  }
  if (best.s - second.s < gap) {
    return { hit: null, score: best.s, rule: 'jaccard', ambiguous: true, runnerUp: second.c };
  }
  return { hit: best.c, score: best.s, rule: 'jaccard', ambiguous: false, runnerUp: second.c };
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 أرقام وتواريخ ومال
// ─────────────────────────────────────────────────────────────────────────────

/**
 * رقمٌ من خانةٍ قد تصل عدداً أو نصاً منسَّقاً («1,282,343.04» أو «١٬٢٨٢٬٣٤٣٫٠٤»).
 * @param {*} v
 * @returns {number|null} العدد، أو لا شيء إن لم تكن الخانة رقماً
 */
export function numberOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = normalizeDigits(String(v))
    .replace(/ر\.?\s*س\.?|ريال(?:\s*سعودي)?|sar/gi, '')
    .replace(/[\s ,٬]/g, '')
    .replace(/[%٪]/g, '')
    .trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validDate = (y, m, d) => {
  try { return parseDate(iso(y, m, d)); } catch (e) {
    if (e instanceof CellError) return null;
    throw e;
  }
};

// رقم إكسل التسلسلي → تاريخ. أصلُ إكسل 1899-12-30 (‏25569 يوماً قبل 1970-01-01).
const EXCEL_EPOCH_OFFSET = 25569;
function serialToIso(n) {
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  const ms = Math.round((Math.floor(n) - EXCEL_EPOCH_OFFSET) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * قراءة تاريخٍ من خانةٍ خام، وإعلانُ الغموض بدل تخمينه.
 * • «2026-01-20» تُقبل كما هي.
 * • «31/12/2026» — اليوم أكبر من 12 فلا لبس: يوم/شهر/سنة.
 * • «2/12/2026» — الطرفان ≤ 12 فالقراءتان ممكنتان: يُعاد `ambiguous` بالقراءتين و`date` فارغ.
 * • رقمٌ تسلسلي من إكسل يُحوَّل.
 * @param {*} raw
 * @returns {{date: string|null, ambiguous: {dmy: string, mdy: string}|null, reason: string|null}}
 */
export function parseDateCell(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { date: null, ambiguous: null, reason: 'خانة فارغة' };
  }
  if (typeof raw === 'number') {
    const d = serialToIso(raw);
    return d
      ? { date: d, ambiguous: null, reason: null }
      : { date: null, ambiguous: null, reason: 'رقمٌ لا يصلح تاريخاً' };
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { date: iso(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()), ambiguous: null, reason: null };
  }
  const s = normalizeDigits(String(raw)).replace(RE_INVISIBLE, '').trim();

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const d = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return d
      ? { date: d, ambiguous: null, reason: null }
      : { date: null, ambiguous: null, reason: 'تاريخ غير موجود في التقويم' };
  }

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    const dmy = validDate(y, b, a);   // a يوم و b شهر
    const mdy = validDate(y, a, b);   // a شهر و b يوم
    if (a > 12 && dmy) return { date: dmy, ambiguous: null, reason: null };
    if (b > 12 && mdy) return { date: mdy, ambiguous: null, reason: null };
    if (dmy && mdy) {
      return {
        date: null,
        ambiguous: { dmy, mdy },
        reason: `تاريخٌ يحتمل قراءتين: ${dmy} إن كان يوم/شهر، و${mdy} إن كان شهر/يوم — اكتبه بصيغة 2026-12-31`,
      };
    }
    const only = dmy || mdy;
    return only
      ? { date: only, ambiguous: null, reason: null }
      : { date: null, ambiguous: null, reason: 'تاريخ غير موجود في التقويم' };
  }

  const n = numberOf(s);
  if (n != null) {
    const d = serialToIso(n);
    if (d) return { date: d, ambiguous: null, reason: null };
  }
  return { date: null, ambiguous: null, reason: 'صيغة تاريخ غير معروفة — اكتب 2026-12-31 أو 31/12/2026' };
}

/**
 * مبلغٌ صافٍ بالريال كما كتبه الفريق → المبلغ المخزَّن في المنصة: **هللاتٌ إجمالية** بالضريبة.
 * (‏`grossOfNet` تأخذ هللاتٍ وتعيد هللات — انظر src/modules/finance/vat.js.)
 * @param {number|string} netSar المبلغ بالريال بدون ضريبة
 * @returns {number} هللات إجمالية
 */
export function netToStoredHalalas(netSar) {
  const n = numberOf(netSar);
  if (n == null) return 0;
  return grossOfNet(Math.round(n * 100));
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 الخرائط: كلمةٌ عربية في الدفتر → القيمة المخزَّنة
// ─────────────────────────────────────────────────────────────────────────────

/** مرآة STATUS في src/modules/io/adapters/projects.js:10 (لا تُستورد: الملف يستورد قاعدة). */
export const PROJECT_STATUS_LABELS = Object.freeze({
  NOT_STARTED: ['لم يبدأ'],
  PLANNED: ['مُخطَّط', 'مخطط'],
  IN_PROGRESS: ['قيد التنفيذ', 'جارٍ', 'جاري'],
  ON_HOLD: ['متوقّف مؤقتًا', 'متوقف مؤقتا', 'متوقف'],
  COMPLETED: ['مكتمل', 'منجز'],
  CANCELLED: ['ملغى', 'ملغي'],
});
/** مرآة RAG في src/modules/io/adapters/projects.js:19. */
export const RAG_LABELS = Object.freeze({
  GREEN: ['أخضر'],
  AMBER: ['أصفر', 'كهرماني'],
  RED: ['أحمر'],
});
/** مرآة ROLE_AR في src/modules/team/resources.js:46 (لا تُستورد: الملف يستورد قاعدة). */
export const ROLE_LABELS = Object.freeze({
  member: 'عضو فريق',
  lead: 'قائد الفريق',
  pm: 'مدير المشروع',
  reviewer: 'مراجع',
  approver: 'معتمِد',
  owner: 'مالك',
});
// ألفاظُ الأدوار في قائمة الدفتر («الدور») ليست ألفاظَ المنصة، فتُردّ إليها صراحةً:
// «قائد المشروع» قائدُ فريقٍ لا مديرُ مشروع — ومديرُ المشروع له لفظُه وحده.
const ROLE_EXTRA = Object.freeze({
  'قائد المشروع': 'lead',
  'استشاري رئيسي': 'member',
  استشاري: 'member',
  'محلل أعمال': 'member',
  'دعم فني': 'member',
  'ضبط جودة': 'member',
  عضو: 'member',
  قائد: 'lead',
});

const keyFromLabels = (labels, label) => {
  const q = normArabic(label);
  if (!q) return null;
  for (const [k, v] of Object.entries(labels)) {
    if (normArabic(k) === q) return k;
    const list = Array.isArray(v) ? v : [v];
    if (list.some((l) => normArabic(l) === q)) return k;
  }
  return null;
};

/** «قيد التنفيذ» → حالة المشروع المخزَّنة، أو لا شيء إن لم تُعرف الكلمة. @param {*} label */
export const projectStatusKey = (label) => keyFromLabels(PROJECT_STATUS_LABELS, label);
/** «أخضر» → مؤشر صحة المشروع المخزَّن. @param {*} label */
export const ragKey = (label) => keyFromLabels(RAG_LABELS, label);
/** «تم الاعتماد» → حالة المخرج المخزَّنة (المعجم: DELIVERABLE_STATUS_AR). @param {*} label */
export const deliverableStatusKey = (label) => keyFromLabels(DELIVERABLE_STATUS_AR, label);
/** «مدير المشروع» → نوع التسكين المخزَّن. @param {*} label */
export function allocationTypeKey(label) {
  const direct = keyFromLabels(ROLE_LABELS, label);
  if (direct) return direct;
  const q = normArabic(label);
  for (const [l, k] of Object.entries(ROLE_EXTRA)) if (normArabic(l) === q) return k;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 بقايا صف المثال
// ─────────────────────────────────────────────────────────────────────────────

/**
 * هل هذه الخانة بقيّةٌ من صف المثال؟ الفريق يكتب فوق أوائل خانات صف المثال ويترك بقيّتها،
 * فتصير قيمُ المثال بياناتٍ بالخطأ. القاعدة: الصف الأول من البيانات وحده (سطر 2 في الورقة)،
 * والقيمة مطابِقةٌ لخانة المثال في المواصفة.
 * @param {object} spec مواصفة الورقة من ALL_SHEETS
 * @param {number} rowIndexInSheet ترتيب الصف بين صفوف البيانات كما هو في الورقة (0 = سطر 2)
 * @param {string} header ترويسة العمود
 * @param {*} value القيمة المقروءة
 * @returns {boolean}
 */
export function suspectExampleResidue(spec, rowIndexInSheet, header, value) {
  if (rowIndexInSheet !== 0 || !spec) return false;
  const i = (spec.columns || []).findIndex((c) => c.header === header);
  if (i < 0) return false;
  const ex = (spec.example || [])[i];
  if (ex == null || ex === '') return false;
  if (value == null || value === '') return false;
  if (typeof ex === 'number') {
    const n = numberOf(value);
    return n != null && Math.abs(n - ex) < 1e-6;
  }
  return normArabic(value) === normArabic(ex);
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 فروق الصف عن المخزَّن
// ─────────────────────────────────────────────────────────────────────────────

// حقولٌ لا يكتبها الاستيراد أبداً: الاسم يبقى كما أثبتته المنصة (الدفتر يحمل أخطاءً إملائية)،
// وتاريخا الفوترة والتحصيل حقيقتان ماليتان لا تُستنبطان من جدول.
const NEVER_PATCH = new Set(['name_ar', 'name_en', 'name', 'invoiced_at', 'collected_at']);

/**
 * ما الذي يضيفه صفُّ الدفتر إلى الصف المخزَّن — ولا شيء غيره.
 * تُتجاهل الخانة إن كانت فارغة، أو بقيّةَ مثال، أو تعذّر فهمها، أو تاريخاً غامضاً؛ ويُقارَن
 * المال بالهللات بسماحٍ صغير كي لا يُعاد كتابةُ رقمٍ يفرق هللةً عن قسمة الضريبة.
 * @param {object} live الصف المخزَّن
 * @param {{cells: object, residue: string[]}} sheetRow صفُّ الدفتر من readWorkbook
 * @param {Object<string, {header: string, kind?: string, map?: Function|object}|string>} fieldMap حقلُ المنصة ← عمودُ الدفتر
 * @param {{moneyTolHalalas?: number}} [opts]
 * @returns {object} رقعةٌ بالحقول المتغيّرة وحدها (فارغةٌ إن لم يضف الدفتر شيئاً)
 */
export function diffOf(live, sheetRow, fieldMap, { moneyTolHalalas = 2 } = {}) {
  const patch = {};
  const residue = new Set(sheetRow?.residue || []);
  const cells = sheetRow?.cells || {};
  for (const [field, defRaw] of Object.entries(fieldMap || {})) {
    if (NEVER_PATCH.has(field)) continue;
    const def = typeof defRaw === 'string' ? { header: defRaw } : (defRaw || {});
    const header = def.header;
    if (!header || residue.has(header)) continue;
    const raw = cells[header];
    if (raw == null || raw === '') continue;
    const kind = def.kind || 'text';
    const cur = live ? live[field] : undefined;

    if (kind === 'money') {
      const n = numberOf(raw);
      if (n == null) continue;
      const next = netToStoredHalalas(n);
      if (Math.abs(next - Number(cur || 0)) <= moneyTolHalalas) continue;
      patch[field] = next;
      continue;
    }
    if (kind === 'date') {
      const d = parseDateCell(raw);
      if (!d.date) continue;                       // الغامض قضيةٌ تُرفع، لا قيمةٌ تُكتب
      if (String(cur ?? '').slice(0, 10) !== d.date) patch[field] = d.date;
      continue;
    }
    if (kind === 'int' || kind === 'pct') {
      const n = numberOf(raw);
      if (n == null) continue;
      const next = Math.round(n);
      if (Number(cur ?? NaN) !== next) patch[field] = next;
      continue;
    }
    if (kind === 'enum') {
      const next = typeof def.map === 'function'
        ? def.map(raw)
        : (def.map ? keyFromLabels(def.map, raw) : null);
      if (!next) continue;
      if (String(cur ?? '') !== String(next)) patch[field] = next;
      continue;
    }
    const next = String(raw).trim();
    if (String(cur ?? '').trim() !== next) patch[field] = next;
  }
  return patch;
}

// ─────────────────────────────────────────────────────────────────────────────
// §7 قراءة الدفتر
// ─────────────────────────────────────────────────────────────────────────────

const LISTS_SHEET = 'قوائم';
const IDENTITY_HEADER = 'بيان الدفتر';
const IDENTITY_KEYS = { sector: 'القطاع', departments: 'الإدارات', reviewer: 'المراجِع' };
const EXAMPLE_MARK = EXAMPLE_PREFIX.trim();

const aoaOf = (ws, raw) => XLSX.utils.sheet_to_json(ws, {
  header: 1, raw, blankrows: true, defval: raw ? null : '',
});

// نصُّ خانةٍ بلا محارف اتجاهٍ ولا فراغٍ طرفي.
const textOf = (v) => (v == null ? '' : String(v).replace(RE_INVISIBLE, '').trim());

// قيمةُ الخانة: الرقم من المرور الخام، والنص من المرور المنسَّق. العمود الرقمي يُفضّل رقمه
// دائماً؛ وغيرُه لا يأخذ الرقم إلا إن جاء نصُّه فارغاً (خانة تاريخٍ خزّنها إكسل رقماً).
function cellValue(col, rawV, txtV) {
  const txt = textOf(txtV);
  const numericKind = col.kind === 'money' || col.kind === 'int';
  if (typeof rawV === 'number' && Number.isFinite(rawV) && (numericKind || txt === '')) return rawV;
  if (rawV instanceof Date && txt === '') return iso(rawV.getUTCFullYear(), rawV.getUTCMonth() + 1, rawV.getUTCDate());
  if (txt === '') return null;
  if (numericKind) {
    const n = numberOf(txt);
    if (n != null) return n;
  }
  return txt;
}

/** هويةُ الدفتر من عمود «بيان الدفتر» المخفي في ورقة «قوائم» — كما يكتبها المولِّد. */
function readIdentityFrom(wb) {
  const out = { sectorName: null, departments: [], reviewer: null };
  const ws = wb.Sheets[LISTS_SHEET];
  if (!ws) return out;
  const aoa = aoaOf(ws, false);
  const headers = (aoa[0] || []).map(textOf);
  const col = headers.findIndex((h) => normArabic(h) === normArabic(IDENTITY_HEADER));
  if (col < 0) return out;
  const facts = new Map();
  for (let r = 1; r < aoa.length; r += 1) {
    const line = textOf((aoa[r] || [])[col]);
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    facts.set(normArabic(line.slice(0, eq)), line.slice(eq + 1).trim());
  }
  out.sectorName = facts.get(normArabic(IDENTITY_KEYS.sector)) || null;
  out.reviewer = facts.get(normArabic(IDENTITY_KEYS.reviewer)) || null;
  const deps = facts.get(normArabic(IDENTITY_KEYS.departments)) || '';
  out.departments = deps.split(/[,،]/).map((d) => d.trim()).filter(Boolean);
  return out;
}

/**
 * قراءة دفتر التعبئة كاملاً: صفوفٌ نظيفةٌ بأسماء أعمدتها، وهويةُ الدفتر، وقضايا القراءة.
 *
 * القواعد التي تحكم القراءة:
 *  • الأعمدة **بالاسم لا بالموضع** — فعمودٌ غريب أقحمه إكسل («y») لا يُزحزح قيمةً واحدة.
 *  • الأرقام من مرورٍ خام والنصوص من مرورٍ منسَّق، والمروران بصفوفٍ فارغةٍ محفوظة فتتقابل الفهارس.
 *  • تُسقَط: ترويسةُ الورقة، وصفُّ المثال (خانته الأولى تبدأ بـ«مثال:»)، وكلُّ صفٍّ لا محتوى
 *    فيه إلا في الأعمدة المساعدة المخفية — وإسقاطُ هذين يقطع سَحبَ الأصل أيضاً.
 *  • الأعمدة المحسوبة («مع الضريبة»، «مدة المشروع») لا تُقرأ أصلاً: تُشتقّ عند الحاجة.
 *  • سَحبُ الأصل: خانةُ الأصل الفارغة تأخذ آخر أصلٍ غيرِ فارغٍ فوقها؛ وإن لم يوجد رُفعت قضيةُ
 *    «بلا أصل» وبقي الصف بأصلٍ فارغ ليراه من يراجع.
 * @param {string} path مسار الملف (‏XLSX.readFile يتعثّر بالمسار العربي هنا، فتُقرأ البايتات)
 * @param {{withCosts?: boolean}} [opts] هل تُقرأ ورقة «التكاليف» السرّية
 * @returns {{path: string, sha256: string, identity: {sectorName: string|null, departments: string[], reviewer: string|null},
 *   sheets: Object<string, {name: string, headers: string[], fileHeaders: string[], rows: Array<{rowNo: number, cells: object, parent: string|null, residue: string[]}>}>,
 *   issues: Array<{sheet: string, rowNo: number, header: string, value: *, reason: string}>}}
 */
export function readWorkbook(path, { withCosts = true } = {}) {
  const buf = readFileSync(path);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const wb = XLSX.read(buf, { type: 'buffer' });
  setWithCosts(!!withCosts);

  const identity = readIdentityFrom(wb);
  const sheets = {};
  const issues = [];

  for (const spec of SHEETS) {
    const ws = wb.Sheets[spec.name];
    if (!ws) continue;
    const rawAoa = aoaOf(ws, true);
    const txtAoa = aoaOf(ws, false);
    const fileHeaders = (txtAoa[0] || []).map(textOf);
    const idxOf = new Map();
    fileHeaders.forEach((h, i) => { if (h && !idxOf.has(h)) idxOf.set(h, i); });

    const dataCols = spec.columns.filter((c) => !isHelper(c) && !isCalc(c) && idxOf.has(c.header));
    const headers = dataCols.map((c) => c.header);
    const rows = [];
    let carry = null;

    for (let r = 1; r < Math.max(rawAoa.length, txtAoa.length); r += 1) {
      const rowNo = r + 1;
      const rawRow = rawAoa[r] || [];
      const txtRow = txtAoa[r] || [];
      const cells = {};
      let anyValue = false;
      for (const c of dataCols) {
        const i = idxOf.get(c.header);
        const v = cellValue(c, rawRow[i], txtRow[i]);
        cells[c.header] = v;
        if (v != null && v !== '') anyValue = true;
      }

      const first = dataCols.length ? cells[dataCols[0].header] : null;
      const isExample = typeof first === 'string' && first.startsWith(EXAMPLE_MARK);
      if (!anyValue || isExample) { carry = null; continue; }  // فارغٌ أو مساعدٌ وحده أو مثال

      const residue = [];
      for (const c of dataCols) {
        if (suspectExampleResidue(spec, rowNo - 2, c.header, cells[c.header])) {
          residue.push(c.header);
          cells[c.header] = null;
        }
      }

      let parent = null;
      if (spec.carryDown) {
        const own = cells[spec.carryDown];
        const ownText = own == null ? '' : String(own).trim();
        if (ownText) { carry = ownText; parent = ownText; } else if (carry) { parent = carry; } else {
          issues.push({
            sheet: spec.name,
            rowNo,
            header: spec.carryDown,
            value: null,
            reason: `بلا أصل — خانة «${spec.carryDown}» فارغة ولا سطر قبلها يحملها`,
          });
        }
      }
      rows.push({ rowNo, cells, parent, residue });
    }

    sheets[sheetKey(spec)] = { name: spec.name, headers, fileHeaders, rows };
  }

  return { path, sha256, identity, sheets, issues };
}

/** مواصفةُ ورقةٍ بمفتاح محوِّلها («projects»، «deliverables»…) — من ALL_SHEETS. @param {string} key */
export const specOf = (key) => ALL_SHEETS.find((s) => sheetKey(s) === key) || null;
