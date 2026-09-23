// ── نموذج الطاقة والتسكين — حسابٌ صرف بلا قاعدة (وحدة الفريق والموارد) ──────────────────
//
// «عرّف وحدة داخلية معيارية للطاقة… عرّف لكل مورد ويوم C(r,d) وp(a,d)، A = C × Σp،
//  نسبة التسكين للفترة = ΣA/ΣC، الطاقة الحرة = max(C−A,0) والتجاوز = max(A−C,0)؛ اجمعهما
//  منفصلين. لا تدع الطاقة الحرة في آخر الشهر تخفي تجاوزاً في بدايته» — الموجّه §6.3.
//
// ── الوحدة المعيارية: «شهر دوام كامل» ────────────────────────────────────────────────
// نموذج التسكين القائم شهري (`allocation.monthly_json`)، ولا تقويم عطلٍ ولا إجازات في
// المنصة (قيد معلن — EXECUTION-LOG §5). فالوحدة هنا **شهرُ دوامٍ كامل = 100**، والطاقة داخل
// الشهر تُوزَن بالأيام وحدها: يومٌ قبل بداية الارتباط أو بعد نهايته طاقته صفر، ويومٌ
// تتغيّر فيه الطاقة المتعاقدة يأخذ إصدارها الساري. هذا هو `C(r,d)` بالضبط كما عرّفه
// الموجّه، مُجمَّعاً على الشهر لأن `p(a,d)` ثابتٌ داخل الشهر في نموذجنا.
//
// ── وحدتان لا تُخلطان ───────────────────────────────────────────────────────────────
// • **نسبة من طاقة المورد** (resource units): ما يكتبه المستخدم في التسكين — 100 = كل
//   طاقة هذا المورد في الشهر أياً كانت (المستشار نصف الدوام المسكَّن بكامله = 100).
// • **وحدات الدوام الكامل** (FTE units): للمقارنة بين الموارد والتجميع — الطاقة الشهرية
//   `capacityUnits` = الطاقة المتعاقدة × نسبة أيام الارتباط، والمسكَّن `A = p × C / 100`.
// «لا تخلط نسبة من مورد نصف دوام بنسبة من دوام كامل» (§6.2) — فكل رقمٍ يخرج من هنا يحمل
// اسم وحدته، والتجميع بين الموارد يقع على وحدات الدوام الكامل وحدها (T05/T10).
//
// ── والمقام صفرٌ حالةٌ لا رقم ────────────────────────────────────────────────────────
// شهرٌ خارج الارتباط أو بلا طاقة يعيد `state: 'out'` ونسباً فارغة — لا NaN ولا 0% مضلِّل
// (T11/T13). والمبدئي والمعلَّق طبقتان مستقلتان لا تُخصمان من المتاح المؤكد (T02).
import { UTIL_BANDS } from '../pmo/capacity.js';

export const FULL = 100;                       // شهر دوام كامل بالوحدتين
export const DEFAULT_CAPACITY_PCT = 100;

const pad2 = (n) => String(n).padStart(2, '0');
const N = (v) => Number(v) || 0;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthStart = (y, m) => `${y}-${pad2(m)}-01`;
export const monthEnd = (y, m) => `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
export const monthKey = (y, m) => `${y}-${pad2(m)}`;
// «الشهر» في الواجهة يُقرأ من نصّ ISO لا من كائن تاريخ — فلا ينزلق يومٌ بتحويل UTC (T15).
export const parseMonthKey = (key) => {
  const mm = /^(\d{4})-(\d{2})$/.exec(String(key || '').trim());
  if (!mm) return null;
  const y = Number(mm[1]); const m = Number(mm[2]);
  return m >= 1 && m <= 12 ? { year: y, month: m } : null;
};
// قائمة الأشهر بين مفتاحين شاملةً الطرفين، بترتيبٍ زمني.
export function monthsBetween(fromKey, toKey) {
  const a = parseMonthKey(fromKey); const b = parseMonthKey(toKey);
  if (!a || !b) return [];
  const out = [];
  let y = a.year, m = a.month;
  while (y < b.year || (y === b.year && m <= b.month)) {
    out.push({ year: y, month: m, key: monthKey(y, m) });
    m += 1; if (m > 12) { m = 1; y += 1; }
    if (out.length > 60) break;                // خمس سنوات سقفٌ صريح لا حلقة بلا نهاية
  }
  return out;
}

// فهرس اليوم في التقويم لعمليات الطرح (نصّ ISO ⇐ عدد أيام منذ الحقبة).
const dayIndex = (iso) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000);
const isoAddDays = (iso, n) => new Date((dayIndex(iso) + n) * 86400000).toISOString().slice(0, 10);

// ── أيام الارتباط داخل الشهر ──────────────────────────────────────────────────────────
// من تاريخ التعيين إلى المغادرة (ISO نصية). المورد المؤرشف بلا تاريخ مغادرة يُقرأ منتهياً
// (لا يُخترع له تاريخ)، أما من له تاريخُ مغادرة فتاريخُه هو الحكم ولو عُطّل حسابه — «تعطيل
// الحساب لا ينهي العقد، وإنهاء العقد لا يمحو السجلات السابقة» (S08/T17).
export function engagedDays(emp, year, month) {
  if (!emp) return 0;
  const end = String(emp.end_date || '').slice(0, 10);
  if (Number(emp.active) === 0 && !end) return 0;
  const hire = String(emp.hire_date || '').slice(0, 10);
  const s = monthStart(year, month); const e = monthEnd(year, month);
  const from = hire && hire > s ? hire : s;
  const to = end && end < e ? end : e;
  if (from > to) return 0;
  return dayIndex(to) - dayIndex(from) + 1;
}
export const engagedFraction = (emp, year, month) => engagedDays(emp, year, month) / daysInMonth(year, month);

// الطاقة المتعاقدة في يومٍ بعينه: آخر إصدارٍ سرى قبله أو فيه؛ وقبل أول إصدارٍ مسجَّل تُقرأ
// قيمة أول إصدار (استمراريةٌ معلنة لا تخمين)؛ وبلا إصدارات تُقرأ طاقة الصف (`capacity_pct`).
export function capacityOnDay(emp, iso, versions = []) {
  const vs = (versions || []).filter((v) => v && v.effective_from).slice()
    .sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)));
  if (!vs.length) {
    const c = Number(emp?.capacity_pct);
    return Number.isFinite(c) && c > 0 ? c : DEFAULT_CAPACITY_PCT;
  }
  let cur = vs[0];
  for (const v of vs) { if (String(v.effective_from).slice(0, 10) <= iso) cur = v; else break; }
  const c = Number(cur.capacity_pct);
  return Number.isFinite(c) && c > 0 ? c : DEFAULT_CAPACITY_PCT;
}

/**
 * طاقة الشهر بوحدات الدوام الكامل: متوسط طاقة الأيام المرتبطة × نسبة الأيام المرتبطة.
 * `units` = 100 لدوامٍ كامل طوال الشهر، 50 لنصف دوام أو لنصف شهر، صفر خارج الارتباط.
 */
export function capacityForMonth(emp, year, month, versions = []) {
  const days = daysInMonth(year, month);
  const engaged = engagedDays(emp, year, month);
  if (!engaged) return { units: 0, days, engagedDays: 0, nominalPct: 0, state: 'out', changedWithin: false };
  const end = String(emp.end_date || '').slice(0, 10);
  const hire = String(emp.hire_date || '').slice(0, 10);
  const s = monthStart(year, month); const e = monthEnd(year, month);
  const from = hire && hire > s ? hire : s;
  const to = end && end < e ? end : e;
  let sum = 0; let first = null; let changed = false;
  for (let d = from; d <= to; d = isoAddDays(d, 1)) {
    const c = capacityOnDay(emp, d, versions);
    if (first == null) first = c; else if (c !== first) changed = true;
    sum += c;
  }
  const avgNominal = sum / engaged;                    // متوسط الطاقة المتعاقدة على أيام الارتباط
  const units = Math.round((avgNominal * (engaged / days)) * 100) / 100;
  return {
    units, days, engagedDays: engaged,
    nominalPct: Math.round(avgNominal * 100) / 100,
    state: engaged === days ? 'full' : 'partial',
    changedWithin: changed,
  };
}

// نسبة الشهر من `monthly_json` (كسور 0–1.5) ⇐ نسبة صحيحة من طاقة المورد.
export function monthPctOf(monthlyJson, month) {
  let mj = monthlyJson;
  if (typeof mj === 'string') { try { mj = JSON.parse(mj || '{}'); } catch { mj = {}; } }
  if (!mj || typeof mj !== 'object') return 0;
  return Math.round(N(mj[month]) * 100);
}
export const isTentative = (row) => String(row?.status || '').toLowerCase() === 'tentative';

/**
 * أرقام شهرٍ واحد لموردٍ واحد.
 * @param items [{ key, label, kind, pct, status: 'confirmed'|'tentative'|'pending', billable }] —
 *   `pct` نسبةٌ من طاقة المورد. `pending` = طلبٌ لم يُعتمد (طبقة عرضٍ لا خصم).
 */
export function monthFigures({ emp, year, month, versions = [], items = [] } = {}) {
  const cap = capacityForMonth(emp, year, month, versions);
  const sum = (pred) => items.filter(pred).reduce((a, it) => a + N(it.pct), 0);
  const confirmedPct = sum((it) => !it.status || it.status === 'confirmed');
  const tentativePct = sum((it) => it.status === 'tentative');
  const pendingPct = sum((it) => it.status === 'pending');
  const billablePct = sum((it) => (!it.status || it.status === 'confirmed') && !!it.billable);
  const out = cap.state === 'out';
  // في وحدات الدوام الكامل: A = p × C/100 — فالمسكَّن بكامله على نصف دوام يعادل 50 لا 100.
  const toUnits = (p) => Math.round((p * cap.units) / 100 * 100) / 100;
  return {
    year, month, key: monthKey(year, month),
    capacity: cap,
    state: out ? 'out' : confirmedPct > FULL ? 'over' : cap.state,
    confirmedPct: out ? null : confirmedPct,
    tentativePct: out ? null : tentativePct,
    pendingPct: out ? null : pendingPct,
    billablePct: out ? null : billablePct,
    availablePct: out ? null : Math.max(FULL - confirmedPct, 0),
    overPct: out ? null : Math.max(confirmedPct - FULL, 0),
    // التعارض المحتمل: المؤكد + المبدئي + المعلَّق معاً فوق الطاقة (S21/T26) — ولا يُخصم من المتاح.
    potentialPct: out ? null : confirmedPct + tentativePct + pendingPct,
    potentialOver: out ? false : (confirmedPct + tentativePct + pendingPct) > FULL,
    units: {
      capacity: cap.units,
      confirmed: out ? 0 : toUnits(confirmedPct),
      billable: out ? 0 : toUnits(billablePct),
      tentative: out ? 0 : toUnits(tentativePct),
      available: out ? 0 : toUnits(Math.max(FULL - confirmedPct, 0)),
      over: out ? 0 : toUnits(Math.max(confirmedPct - FULL, 0)),
    },
    // ما يعادله التسكين اسمياً بوحدة FTE (§6.3): الطاقة المتعاقدة × نسبة التسكين.
    nominalFte: out ? 0 : Math.round(cap.nominalPct * confirmedPct / 100) / 100,
    items: items.map((it) => ({ ...it, pct: N(it.pct), status: it.status || 'confirmed', billable: !!it.billable })),
  };
}

/**
 * فترةٌ لموردٍ واحد: متوسطٌ موزون بطاقة كل شهر (ΣA/ΣC) — لا مجموع نسب الأشهر (T06)، مع أقصى
 * تجاوزٍ شهري وأشهره كي لا يُخفي المتوسطُ تجاوزاً (§6.3/T09).
 */
export function periodFigures(months = []) {
  const live = months.filter((m) => m && m.state !== 'out');
  const capU = live.reduce((a, m) => a + m.units.capacity, 0);
  const confU = live.reduce((a, m) => a + m.units.confirmed, 0);
  const billU = live.reduce((a, m) => a + m.units.billable, 0);
  const availU = live.reduce((a, m) => a + m.units.available, 0);
  const overU = live.reduce((a, m) => a + m.units.over, 0);
  const pct = (u) => (capU > 0 ? Math.round((u / capU) * 100) : null);
  const overMonths = live.filter((m) => (m.overPct || 0) > 0).map((m) => m.key);
  return {
    months: months.length, engagedMonths: live.length, outMonths: months.length - live.length,
    state: capU > 0 ? 'ok' : 'out',
    utilizationPct: pct(confU), billablePct: pct(billU), availablePct: pct(availU),
    // التجاوز والحرّ يُجمعان منفصلين — ولا يُطرح أحدهما من الآخر.
    overPct: pct(overU),
    maxOverPct: live.reduce((a, m) => Math.max(a, m.overPct || 0), 0),
    overMonths,
    units: { capacity: r2(capU), confirmed: r2(confU), billable: r2(billU), available: r2(availU), over: r2(overU) },
    // مجموع نسب الأشهر يُسمّى باسمه إن احتاجه تحليلٌ آخر — ولا يُسوَّق نسبة استغلال (§6.4).
    sumOfMonthPct: live.reduce((a, m) => a + (m.confirmedPct || 0), 0),
  };
}
const r2 = (v) => Math.round(v * 100) / 100;

/** مجموعةُ موارد: وحدات الدوام الكامل تُجمع، والنسبة ΣA/ΣC — 1.5/1.5 = 100% (T05/T10). */
export function groupFigures(perResource = []) {
  const capU = perResource.reduce((a, r) => a + N(r?.units?.capacity), 0);
  const confU = perResource.reduce((a, r) => a + N(r?.units?.confirmed), 0);
  const billU = perResource.reduce((a, r) => a + N(r?.units?.billable), 0);
  return {
    resources: perResource.length,
    capacityFte: r2(capU / FULL), confirmedFte: r2(confU / FULL), billableFte: r2(billU / FULL),
    utilizationPct: capU > 0 ? Math.round((confU / capU) * 100) : null,
    billablePct: capU > 0 ? Math.round((billU / capU) * 100) : null,
    state: capU > 0 ? 'ok' : 'out',
  };
}

// حزام الحالة من الثابت الواحد للمنصة (decision-log ق٦) — لا عتبات ثانية هنا.
export function bandOf(pct) {
  if (pct == null) return 'out';
  if (pct > UTIL_BANDS.OVER_ABOVE) return 'over';
  if (pct >= UTIL_BANDS.NEAR_FROM) return 'near';
  if (pct >= UTIL_BANDS.FREE_BELOW) return 'ok';
  if (pct > 0) return 'low';
  return 'free';
}
export const BAND_AR = Object.freeze({
  out: 'خارج فترة الارتباط', over: 'تجاوز', near: 'قرب الحد', ok: 'ضمن الطاقة', low: 'سعة متاحة', free: 'متاح بالكامل',
});
