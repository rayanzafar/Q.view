// ── حمولة «مركز القطاع» كما تُزرع في الصفحة ─────────────────────────────────────────────
//
// الشاشة تُرسم في المتصفّح من ثلاث حزمٍ جامدة يزرعها الخادم في الوسم، بلا أي جلبٍ عند الفتح:
//   `cc-data`   — الحمولة المرشَّحة بالصلاحية (`buildCommandCenterDataset`) كما هي بلا لمس،
//   `cc-view`   — حالةُ العرض الأولى محلولةً من الرابط (الأشهر، المرشِّحات، اللوحة المفتوحة)،
//   `cc-labels` — الأسماء العربية الثابتة التي يحتاجها النصّ البرمجي (الأشهر، الأرباع، الحالات…).
//
// ثلاث قواعد تحكم هذا الملفّ:
// ① **لا قرار أمني هنا.** الحجب كلُّه وقع في `command-center.js` بالغياب لا بالفراغ؛ وهذا
//    الملفّ لا يقرأ صلاحيةً ولا يعيد كتابة بوابة — ينسخ ما وصله ويسلسله.
// ② **الرابط لا يوسِّع نطاقاً.** ما يُطلب من قطاعٍ يمرّ بـ`resolveCommandCenterSector` وحده،
//    وكلُّ معرّفٍ في الرابط (مشروعاً أو عميلاً أو إدارة) يُطابَق بما في الحمولة نفسها: ما ليس
//    فيها يسقط صامتاً، فلا يُستدلّ بقبول معرّفٍ على وجوده.
// ③ **ما يخرج في `<script>` مُهرَّب.** `<` و`>` وفاصلا الأسطر اليونيكوديان تُستبدل بترميزها،
//    فلا يُغلق وسمُ النصّ البرمجي من داخل بيانٍ ولا يُكسر السطر في محرّكٍ قديم.
import { resolveCommandCenterSector, buildCommandCenterDataset, monthsFromQuery } from '../../modules/finance/command-center.js';
import { targetYear } from '../../modules/org/sector-targets.js';
import { config } from '../../core/config.js';
import { MONTHS_AR, QUARTERS_AR } from '../../core/i18n/time.js';
import { HEALTH_LABELS, HEALTH_UNKNOWN, PL_RECON_LEGEND } from '../../core/i18n/thresholds.js';
import { CLOSED_SOURCE_AR } from '../../modules/finance/pl-lines.js';
import { G } from '../i18n/glossary.js';

/**
 * ألسنة الشاشة القديمة (v6.01) صارت لوحاتِ تفاصيل: الرابط المحفوظ عند قارئٍ قديم يفتح اللوحة
 * المقابلة بدل أن يسقط صامتاً إلى الشاشة الأولى. وما لا مقابل له (الإيقاع، التجاري، العملاء)
 * يفتح الشاشة كما هي — فالشاشة كلُّها صارت تقول ما كانت تلك الألسنة تقوله.
 */
export const TAB_TO_DRAWER = Object.freeze({ pl: 'pl', ops: 'projects', hr: 'team', next: 'pace' });

/** وحدات العرض المقبولة من الرابط — و«تلقائية» هي الافتراض (الرقم يختار وحدته بحجمه). */
const UNITS = ['auto', 'sar', 'k', 'm'];

/**
 * الأسماء الثابتة التي يقرؤها النصّ البرمجي من `cc-labels` — لا أكثر ولا أقل.
 * (أسماء المراحل تأتي مع الحمولة نفسها في `stages`، فلا تُنسخ هنا.)
 */
export const CC_LABELS = Object.freeze({
  MONTHS_AR,
  QUARTERS_AR,
  HEALTH_LABELS,
  // التقييم الغائب اسمُه من عتبات الحالة نفسها التي يقرأ منها البريد والتقارير.
  healthUnknown: HEALTH_UNKNOWN.label,
  // مصدرُ الإقفال بالعربية: الشاشة وملفُّ المركز يقرآن الخريطة نفسها، فلا يظهر مفتاحٌ داخليٌّ خاماً.
  closedSource: CLOSED_SOURCE_AR,
  // قاعدةُ «مطابق سند» من مصدر العتبات — فلا تُكتب النسبةُ والمبلغُ باليد في الشاشة.
  plReconLegend: PL_RECON_LEGEND,
  // قاعدةُ حالة المشروع بجملةٍ واحدة تُقال في اللوحتين.
  ragOwnerNote: G.ragOwnerNote,
  notEnteredYet: G.notEnteredYet,
  downloadExcel: G.downloadExcel,
});

/**
 * تسلسلٌ آمنٌ داخل `<script type="application/json">`.
 * `<` و`>` تُرمَّزان فلا يُغلق الوسم من داخل اسمٍ مسجَّل، والفاصلان U+2028/U+2029 يُرمَّزان
 * فلا يكسران السطر عند قارئٍ قديم. والناتج يبقى JSON صحيحاً يُقرأ بـ`JSON.parse` كما هو.
 */
export function ccJson(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
}

/** قائمةُ معرّفاتٍ من الرابط («أ,ب,ج») مُطابَقةً بما في الحمولة — وما ليس فيها يسقط. */
function idsFromQuery(raw, known) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const id = part.trim();
    if (!id || seen.has(id) || !known.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * أشهرُ الفترة من الرابط — بالقاعدة الواحدة (`monthsFromQuery` مع حمولة المركز): `months=`
 * (ولو متقطّعاً) يعلو على `p=q1-q3 | m3-m8 | q2 | m5 | y | ytd`، وغيابُهما = السنة كاملة.
 * ويبقى بابٌ ثالثٌ لمن حفظ رابطاً بمُنتقيَي «من/إلى» القديمين (`pa`/`pb`): يُترجَم إلى مدىً
 * قبل أن يُقرأ، فلا قاعدةَ ثانية للفترة في المنصة.
 */
export function viewMonths(query = {}, year, now = new Date()) {
  const monthNo = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null; };
  const a = monthNo(query.pa), b = monthNo(query.pb);
  const q = (!String(query.months ?? '').trim() && !query.p && a && b) ? { p: `m${a}-m${b}` } : query;
  return monthsFromQuery(q, year, now);
}

/** حالةُ العرض الأولى: ما يُسلَّم للمتصفّح في `cc-view`. */
export function ccView(query = {}, dataset = {}, year, now = new Date()) {
  const known = (list) => new Set((list || []).map((x) => x.id));
  const tab = String(query.tab || '').trim();
  const unit = UNITS.includes(String(query.unit || '')) ? String(query.unit) : 'auto';
  const open = TAB_TO_DRAWER[tab] ? { k: TAB_TO_DRAWER[tab] } : null;
  return {
    months: viewMonths(query, year, now),
    depts: idsFromQuery(query.dept, known(dataset.depts)),
    clients: idsFromQuery(query.client, known(dataset.clients)),
    projects: idsFromQuery(query.project, known(dataset.projects)),
    unit,
    open,
  };
}

/**
 * القطاع والسنة والحمولة وحالةُ العرض والأسماء — كلُّ ما تحتاجه الصفحة في نداءٍ واحد.
 *
 * @param {object} user
 * @param {object} query — معاملات الرابط كما وصلت (`?year=&sector=&p=&months=&project=&tab=`)
 * @returns {Promise<{sector: object, year: number, dataset: object, view: object, labels: object}>}
 */
export async function ccPayload(user, query = {}) {
  const sector = await resolveCommandCenterSector(user, query);
  const year = targetYear(Number(query.year) || config.fiscalYear);
  const dataset = await buildCommandCenterDataset(user, sector.id, { year });
  const now = new Date();
  return { sector, year, dataset, view: ccView(query, dataset, year, now), labels: CC_LABELS };
}
