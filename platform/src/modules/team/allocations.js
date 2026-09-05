// ── التخطيط وطلبات التسكين (S13 المصفوفة · S14 الإضافة · S15 معالجة التجاوز · S16 الطلبات) ──
//
// «الطلب المعلق لا يغيّر التسكين المؤكد» و«معاينةٌ قديمة لا تكفي لاعتماد حجزٍ جديد» — الموجّه
// §5/§6.5. القواعد الأربع التي يقوم عليها هذا الملف:
//   ① الأرقام كلها من نموذج الطاقة (capacity-model.js) عبر قارئه الواحد (capacity-read.js) —
//      المعاينة تضع التغيير طبقةً فوق بنود الشهر (`overrides`) وتقرأ الأرقام نفسها التي تقرؤها
//      المصفوفة، فلا معادلة ثانية في شاشة الطلب.
//   ② التعارض (المؤكد بعد التغيير > 100) يُعرض ولا يُمنع (T07)، وخارج فترة الارتباط يمنع
//      التأكيد المؤكد وحده (T11)، والمبدئي لا يُخصم من المتاح (T02).
//   ③ من يملك أمر المورد (planningRights.direct) يطبّق فوراً عبر كتّاب التسكين القائمين؛ ومن
//      يملك «طلب تسكين» يطلب فيُعتمد له من مدير المورد عبر محرّك الاعتماد الموجَّه (022) —
//      وبلا مديرٍ مسجَّل يبقى الطلب معلَّقاً **بملاحظةٍ تقول ذلك** ويقرّره من يملك أمر المورد.
//   ④ مفتاح عدم التكرار يعيد الطلب نفسه (T19)، وبصمة الخطة تُحفظ وقت المعاينة وتُعاد مقارنتها
//      عند الاعتماد داخل المعاملة (T20).
// لا مال في أي مخرج هنا: أسماء الأعمال ونسبها وفتراتها فقط (access.js ②).
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { effectiveScope } from '../../core/rbac/index.js';
import { departmentScope, departmentInSql } from '../../core/rbac/departments.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound, conflict } from '../../core/http/errors.js';
import { isDelivery } from '../../core/org/kind.js';
import { managerOfEmployee } from '../org/confirm.js';
import { isWorkBucket, resolveAllocationYear } from '../pmo/projects.js';
import { loadReadableProject } from '../pmo/project-access.js';
import { raiseDirectApproval, actOnApproval, ALLOCATION_WORKFLOW_KEY } from '../workflow/engine.js';
import { notify } from '../notifications/notify.js';
import { workBucketLabel } from '../../web/i18n/glossary.js';
import { canReadResources, resourceScopeSql, resourceInScope, planningRights, resourceTypeOf, RESOURCE_TYPE_AR, managesResource } from './access.js';
import { loadCapacityContext, figuresFromContext, allocationFingerprint } from './capacity-read.js';
import { monthsBetween, parseMonthKey, monthKey, monthStart, bandOf, BAND_AR } from './capacity-model.js';
import {
  REQUEST_STATUS_AR, REQUEST_KIND_AR, ALLOC_STATUS_AR, NO_MANAGER_NOTE_AR,
  parseMonthsJson, requestMonthsMap, targetLabelFor, monthLabelAr, monthsTextAr,
  changeOverride, effectRow, effectOf, revalidateRequest, applyRequest, finishRequest,
} from './allocation-settle.js';

export { REQUEST_STATUS_AR, REQUEST_KIND_AR, ALLOC_STATUS_AR };

const MAX_RESOURCES = 50;          // موارد الطلب الواحد
const MAX_MONTHS = 24;             // مدى المصفوفة
const PCT_MAX = 150;               // سقف الكاتب القائم (projects.js)
const LIST_LIMIT = 500;
const ph = (arr) => arr.map(() => '?').join(',');
const N = (v) => Number(v) || 0;

export const BASIS_AR = 'المتاح محسوب من الطاقة التعاقدية المسجلة بعد التسكين المؤكد؛ المبدئي والطلبات المعلَّقة طبقتان تُعرضان ولا تُخصمان';
export const LEGEND = Object.freeze([
  { key: 'free', label_ar: BAND_AR.free }, { key: 'low', label_ar: BAND_AR.low }, { key: 'ok', label_ar: BAND_AR.ok },
  { key: 'near', label_ar: BAND_AR.near }, { key: 'over', label_ar: BAND_AR.over }, { key: 'out', label_ar: BAND_AR.out },
  { key: 'tentative', label_ar: 'مبدئي — لا يُخصم من المتاح' }, { key: 'pending', label_ar: 'طلب بانتظار القرار — لا يُخصم' },
]);
const AUDIT_ACTION_AR = { create: 'أُنشئ', submit: 'أُرسل', apply: 'طُبِّق', return: 'أُعيد', reject: 'رُفض', withdraw: 'سُحب', update: 'عُدِّل' };

// ═══ S13 — مصفوفة التسكين ═════════════════════════════════════════════════════════════
const addMonths = ({ year, month }, n) => { const t = year * 12 + (month - 1) + n; return { year: Math.floor(t / 12), month: (t % 12) + 1 }; };
function resolvePeriod(from, to) {
  const now = new Date();
  let f = parseMonthKey(from); let t = parseMonthKey(to);
  if (from && !f) throw badRequest('بداية المدى بصيغة السنة-الشهر مثل 2026-09');
  if (to && !t) throw badRequest('نهاية المدى بصيغة السنة-الشهر مثل 2026-12');
  // الافتراضي: اثنا عشر شهراً تبدأ بالشهر الجاري — أفق التخطيط لا سنةَ التقويم.
  if (!f && !t) { f = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }; t = addMonths(f, 11); }
  else if (f && !t) t = addMonths(f, 11);
  else if (!f && t) f = addMonths(t, -11);
  const months = monthsBetween(monthKey(f.year, f.month), monthKey(t.year, t.month));
  if (!months.length) throw badRequest('نهاية المدى قبل بدايته — صحّح الشهرين');
  if (months.length > MAX_MONTHS) throw badRequest(`المدى ${MAX_MONTHS} شهراً كحد أقصى — قسّمه على مدَيين`);
  return { from: months[0].key, to: months[months.length - 1].key, months };
}
const monthRef = (m) => ({ key: m.key, label_ar: monthLabelAr(m.year, m.month) });

function cellOf(m, showTentative) {
  const band = bandOf(m.confirmedPct);
  const out = m.state === 'out';
  return {
    key: m.key, state: m.state, band, band_ar: BAND_AR[band],
    confirmedPct: m.confirmedPct, tentativePct: out ? null : (showTentative ? m.tentativePct : 0), pendingPct: m.pendingPct,
    availablePct: m.availablePct, overPct: m.overPct, billablePct: m.billablePct,
    potentialPct: m.potentialPct, potentialOver: m.potentialOver, capacityUnits: m.units.capacity,
    items: (m.items || []).filter((it) => showTentative || it.status !== 'tentative').map((it) => ({
      label: it.label, pct: it.pct, status: it.status, status_ar: ALLOC_STATUS_AR[it.status] || it.status,
      billable: !!it.billable, kind: it.kind, targetId: it.targetId || null,
      allocationId: it.allocationId || null, requestId: it.requestId || null,
    })),
  };
}
function periodOf(p) {
  const band = bandOf(p.utilizationPct);
  return { state: p.state, utilizationPct: p.utilizationPct, billablePct: p.billablePct, availablePct: p.availablePct,
    overPct: p.overPct, maxOverPct: p.maxOverPct, overMonths: p.overMonths, engagedMonths: p.engagedMonths, outMonths: p.outMonths,
    band, band_ar: BAND_AR[band] };
}

/**
 * مصفوفة مورد × شهر لمن يقرأ الفريق، بنطاقه (resourceScopeSql) — والفلاتر تضيّق داخله ولا توسّعه.
 */
export async function planningMatrix(user, { from, to, sector, department, q, showTentative = true } = {}) {
  if (!canReadResources(user)) throw forbidden('مصفوفة التسكين لمن يقرأ الفريق — اطلب صلاحية عرض الفريق');
  const period = resolvePeriod(from, to);
  const scope = resourceScopeSql(user, 'e', sector || null);
  const where = [scope.clause]; const params = [...scope.params];
  // مرشِّح الإدارة يضيّق داخل النطاق المحلول فقط (نمط staffingRoster): ما سواه يُتجاهل مغلقاً.
  let effectiveDept = null;
  const wantDept = String(department || '').trim();
  if (wantDept && scope.clause !== '1=0') {
    if (scope.departments?.length) { if (scope.departments.includes(wantDept)) effectiveDept = wantDept; }
    else {
      const d = await get('SELECT id, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [wantDept]);
      if (d && (!scope.sector || d.sector_id === scope.sector)) effectiveDept = wantDept;
    }
    if (effectiveDept) { where.push('e.department_id = ?'); params.push(effectiveDept); }
  }
  // النشط، ومن انتهى ارتباطه في المدى أو بعده (يُقرأ «خارج الارتباط» لا يختفي) — لا أرشيف الأعوام.
  where.push('(e.active = 1 OR (e.end_date IS NOT NULL AND e.end_date >= ?))');
  params.push(monthStart(period.months[0].year, period.months[0].month));
  const qq = String(q || '').trim();
  if (qq) { where.push('(e.name_ar LIKE ? OR e.name_en LIKE ? OR e.job_title LIKE ?)'); params.push(`%${qq}%`, `%${qq}%`, `%${qq}%`); }
  const emps = scope.clause === '1=0' ? [] : await all(
    `SELECT e.id, e.name_ar, e.job_title, e.resource_type, e.employment_type, e.capacity_pct, e.department_id, e.sector_id,
            e.user_id, e.hire_date, e.end_date, d.name_ar department_name, s.name_ar sector_name
       FROM employee e LEFT JOIN department d ON d.id = e.department_id LEFT JOIN sector s ON s.id = e.sector_id
      WHERE ${where.join(' AND ')} ORDER BY e.name_ar, e.id`, params);
  const ctx = await loadCapacityContext(emps.map((e) => e.id), period.from, period.to);
  const figures = figuresFromContext(ctx, { includePending: true });
  const show = showTentative !== false && showTentative !== 0 && showTentative !== '0' && showTentative !== 'false';
  const rows = emps.map((e) => {
    const f = figures.get(e.id);
    const type = resourceTypeOf(e);
    return {
      resource: { id: e.id, name: e.name_ar, job_title: e.job_title || null, resourceType: type, resourceType_ar: RESOURCE_TYPE_AR[type],
        capacityPct: e.capacity_pct == null ? 100 : Math.round(N(e.capacity_pct)), department_id: e.department_id || null,
        department_name: e.department_name || null, sector_id: e.sector_id || null, sector_name: e.sector_name || null,
        userId: e.user_id || null, hire_date: e.hire_date || null, end_date: e.end_date || null },
      cells: f ? f.months.map((m) => cellOf(m, show)) : [],
      period: f ? periodOf(f.period) : null,
    };
  });
  return {
    period: { from: period.from, to: period.to }, months: period.months.map(monthRef), rows,
    legend: LEGEND, basis_ar: BASIS_AR, total: rows.length, showTentative: show,
    filters: { sector: scope.sector || sector || null, department: effectiveDept, q: qq || null },
  };
}

// ═══ تطبيع التغيير (S14/S15) ══════════════════════════════════════════════════════════
function pctOf(v, what = 'النسبة') {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) throw badRequest(`أدخل ${what} رقماً بين 0 و${PCT_MAX}`);
  if (n < 0 || n > PCT_MAX) throw badRequest(`${what} بين 0 و${PCT_MAX} — أدخلتَ ${n}`);
  return Math.round(n);
}
const hasMonthsMap = (m) => m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length > 0;
const yearHint = (raw) => {
  if (raw.year != null && raw.year !== '') return Number(raw.year);
  if (hasMonthsMap(raw.months)) return parseMonthKey(Object.keys(raw.months)[0])?.year ?? null;
  return parseMonthKey(raw.from)?.year ?? null;
};

// أشهر التغيير بنسبها: خريطة `YYYY-MM ⇒ pct`، أو مدى `from..to` بنسبةٍ واحدة — وسنةٌ واحدة للطلب
// (التسكين مخزَّن بالسنة؛ سنتان = طلبان). «حتى نهاية السنة» (S15) = الشهر المسمّى إلى ديسمبر.
function resolveMonths(raw, kind, alloc) {
  if (kind === 'remove') {
    const mj = parseMonthsJson(alloc.monthly_json);
    const months = Object.keys(mj).map(Number).filter((m) => m >= 1 && m <= 12 && N(mj[m]) > 0)
      .sort((a, b) => a - b).map((m) => ({ month: m, pct: 0 }));
    return { year: Number(alloc.year), months, scope: 'month' };
  }
  const scope = kind === 'adjust' && String(raw.scope || '').toLowerCase() === 'onward' ? 'onward' : 'month';
  let year = null; const map = new Map();
  const put = (y, m, pct) => {
    if (year == null) year = y;
    else if (year !== y) throw badRequest('الطلب الواحد يغطي سنة واحدة — لتخطيط سنتين أرسل طلباً لكل سنة');
    map.set(m, pct);
  };
  if (hasMonthsMap(raw.months)) {
    if (scope === 'onward') throw badRequest('التعديل حتى نهاية السنة يحتاج شهر البداية والنسبة، لا خريطة أشهر');
    for (const [k, v] of Object.entries(raw.months)) {
      const mk = parseMonthKey(k);
      if (!mk) throw badRequest(`مفتاح الشهر «${k}» بصيغة السنة-الشهر مثل 2026-10`);
      put(mk.year, mk.month, pctOf(v, `نسبة ${monthLabelAr(mk.year, mk.month)}`));
    }
  } else {
    const f = parseMonthKey(raw.from);
    if (!f) throw badRequest('حدّد شهر البداية بصيغة السنة-الشهر مثل 2026-10');
    const t = scope === 'onward' ? { year: f.year, month: 12 } : (raw.to ? parseMonthKey(raw.to) : f);
    if (!t) throw badRequest('حدّد شهر النهاية بصيغة السنة-الشهر مثل 2026-12');
    if (t.year !== f.year) throw badRequest('الطلب الواحد يغطي سنة واحدة — لتخطيط سنتين أرسل طلباً لكل سنة');
    if (t.month < f.month) throw badRequest('شهر النهاية قبل شهر البداية — صحّح المدى');
    const pct = pctOf(raw.pct, 'نسبة التسكين');
    for (let m = f.month; m <= t.month; m++) put(f.year, m, pct);
  }
  year = resolveAllocationYear(year);
  if (alloc && Number(alloc.year) !== year) {
    throw badRequest(`الأشهر خارج سنة التسكين المحدَّد (${alloc.year}) — لسنة أخرى أضف تسكيناً جديداً`);
  }
  let months = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([month, pct]) => ({ month, pct }));
  if (kind === 'new') {
    months = months.filter((x) => x.pct > 0);
    if (!months.length) throw badRequest('حدّد شهراً واحداً على الأقل بنسبة أكبر من صفر');
  }
  if (!months.length) throw badRequest('حدّد شهراً واحداً على الأقل');
  return { year, months, scope };
}

function billableOfInput(v) {
  if (v == null || v === '') return null;
  return (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;
}

/** يطبّع التغيير كما يصل من الشاشة إلى شكلٍ واحد صارم، ويحلّ الوجهة والتسكين المعدَّل. */
async function normalizeChange(user, raw = {}) {
  const kind = String(raw?.kind || '').toLowerCase();
  if (!['new', 'adjust', 'remove'].includes(kind)) throw badRequest('حدّد نوع التغيير: تسكين جديد أو تعديل أو إزالة');
  let employeeIds = Array.isArray(raw.employeeIds) ? raw.employeeIds : (raw.employeeId ? [raw.employeeId] : []);
  employeeIds = [...new Set(employeeIds.map((x) => String(x || '').trim()).filter(Boolean))];
  let alloc = null; let target = null;
  if (kind === 'new') {
    const tk = String(raw.target?.kind || '').toLowerCase(); const tid = String(raw.target?.id || '').trim();
    if (tk === 'project') {
      if (!tid) throw badRequest('اختر المشروع المطلوب التسكين عليه');
      const project = await loadReadableProject(user, tid, 'read', 'هذا المشروع خارج نطاقك — يُطلب التسكين على مشروع تراه');
      target = { kind: 'project', id: tid, label: project.name_ar, project };
    } else if (tk === 'bucket') {
      if (!isWorkBucket(tid)) throw badRequest('اختر بند العمل الداخلي من القائمة');
      target = { kind: 'bucket', id: tid, label: workBucketLabel(tid) };
    } else throw badRequest('حدّد جهة العمل: مشروع أو بند عمل داخلي');
  } else {
    if (raw.allocationId) {
      alloc = await get('SELECT * FROM allocation WHERE id = ? AND deleted_at IS NULL', [raw.allocationId]);
      if (!alloc) throw notFound('التسكين المطلوب تعديله غير موجود — قد يكون أُزيل');
      if (employeeIds.length && !employeeIds.includes(alloc.employee_id)) throw badRequest('التسكين المحدَّد لا يخص هذا المورد');
    } else {
      // بلا معرّف تسكين: المورد + الوجهة + السنة تكفي لتعيينه (خلية المصفوفة/S15).
      if (employeeIds.length !== 1) throw badRequest('التعديل والإزالة على مورد واحد وتسكين واحد — حدّد التسكين');
      const tk = String(raw.target?.kind || '').toLowerCase(); const tid = String(raw.target?.id || '').trim();
      const y = yearHint(raw);
      if (!tid || !['project', 'bucket'].includes(tk) || !y) throw badRequest('حدّد التسكين المطلوب تعديله: الوجهة والسنة');
      alloc = await get(`SELECT * FROM allocation WHERE employee_id = ? AND year = ? AND deleted_at IS NULL
                          AND ${tk === 'project' ? 'project_id = ?' : 'work_bucket = ?'}`, [employeeIds[0], y, tid]);
      if (!alloc) throw notFound('لا تسكين قائم لهذا المورد على هذه الجهة في السنة المحددة');
    }
    employeeIds = [alloc.employee_id];
    if (alloc.project_id) {
      const p = await get('SELECT id, name_ar, kind, sector_id, department_id FROM project WHERE id = ?', [alloc.project_id]);
      target = { kind: 'project', id: alloc.project_id, label: p?.name_ar || alloc.project_name || 'مشروع', project: p || null };
    } else target = { kind: 'bucket', id: alloc.work_bucket, label: workBucketLabel(alloc.work_bucket) };
  }
  if (!employeeIds.length) throw badRequest('حدّد المورد أو الموارد المطلوب تسكينها');
  if (employeeIds.length > MAX_RESOURCES) throw badRequest(`حدّد ${MAX_RESOURCES} مورداً كحد أقصى في الطلب الواحد`);
  const { year, months, scope } = resolveMonths(raw, kind, alloc);
  const rawStatus = raw.allocStatus != null && raw.allocStatus !== '' ? String(raw.allocStatus).toLowerCase() : null;
  const allocStatus = rawStatus || (alloc ? (String(alloc.status || '').toLowerCase() === 'tentative' ? 'tentative' : 'confirmed') : 'confirmed');
  if (!['confirmed', 'tentative'].includes(allocStatus)) throw badRequest('نوع التسكين المطلوب: مؤكد أو مبدئي');
  return { kind, employeeIds, target, alloc, year, months, scope, allocStatus, billable: billableOfInput(raw.billable) };
}

// ── من يطلب على هذا المورد ──────────────────────────────────────────────────────────────
// من يقرأ المورد في نطاقه ويملك التخطيط (planningRights). ومن يملك «طلب تسكين» بلا قراءة
// الموظفين (مدير المشروع: منحه بنطاق «مشروع» لا يبلغ الموظف) يطلب داخل قطاعه لا أبعد.
async function requestGate(user, emp) {
  const rights = await planningRights(user, emp);
  if (!rights.request) return { ...rights, allowed: false };
  if (resourceInScope(user, emp)) return { ...rights, allowed: true };
  // سياج القطاع لمن منحُه بنطاق «مشروع» أو «ذاتي» (مدير مشروع/تطوير أعمال يطلب على زملاء قطاعه)؛
  // أما صاحب نطاق «إدارة» فحدّه قراءةُ المورد — لا يعاين ولا يطلب على موظفٍ خارج إدارته
  // (موظف القطاع بلا إدارة كان يمرّ من `can()` لأن الهدف بلا مفتاح إدارة).
  if (user.scope === 'department' || user.scope === 'team') return { ...rights, allowed: false };
  const sameSector = user.scope === 'company' || !emp.sector_id || emp.sector_id === user.sector_id;
  return { ...rights, allowed: sameSector };
}

const publicChange = (c) => ({
  kind: c.kind, kind_ar: REQUEST_KIND_AR[c.kind], target: { kind: c.target.kind, id: c.target.id, label: c.target.label },
  allocationId: c.alloc?.id || null, year: c.year,
  months: Object.fromEntries(c.months.map((x) => [monthKey(c.year, x.month), x.pct])),
  allocStatus: c.allocStatus, allocStatus_ar: ALLOC_STATUS_AR[c.allocStatus], billable: c.billable == null ? null : c.billable === 1, scope: c.scope,
});
const monthsJsonOf = (months) => JSON.stringify(Object.fromEntries(months.map((x) => [x.month, x.pct])));

/**
 * التحليل المشترك للمعاينة والإرسال: الصلاحية على كل مورد، الأرقام قبل/بعد، التحذيرات
 * والموانع بالعربية، المعتمِدون، والبصمات.
 */
async function analyzeChange(user, rawChange) {
  const change = await normalizeChange(user, rawChange);
  const emps = await all(`SELECT e.*, d.name_ar department_name FROM employee e LEFT JOIN department d ON d.id = e.department_id
      WHERE e.id IN (${ph(change.employeeIds)}) AND e.deleted_at IS NULL`, change.employeeIds);
  const byId = new Map(emps.map((e) => [e.id, e]));
  const rights = new Map();
  for (const eid of change.employeeIds) {
    const emp = byId.get(eid);
    if (!emp) throw notFound('المورد غير موجود — قد يكون سجله حُذف');
    const g = await requestGate(user, emp);
    if (!g.allowed) throw forbidden(`طلب تسكين «${emp.name_ar}» خارج صلاحيتك — يطلبه من يملك «طلب تسكين» في نطاق المورد أو من يدير إدارته`);
    rights.set(eid, g);
  }
  const monthNums = change.months.map((x) => x.month);
  const from = monthKey(change.year, Math.min(...monthNums)); const to = monthKey(change.year, Math.max(...monthNums));
  const ctx = await loadCapacityContext(change.employeeIds, from, to);
  if (change.target.kind === 'project' && change.target.project) ctx.projects.set(change.target.id, change.target.project);
  const billable = change.billable == null
    ? (change.kind === 'new' ? (change.target.kind === 'project' ? String(change.target.project?.kind || 'external') !== 'internal' : false) : null)
    : change.billable === 1;
  const overrides = new Map(change.employeeIds.map((eid) => [eid, changeOverride({
    kind: change.kind, allocationId: change.alloc?.id || null, target: change.target, year: change.year, months: change.months,
    allocStatus: change.allocStatus, billable, label: change.target.label })]));
  const before = figuresFromContext(ctx, { includePending: true });
  const after = figuresFromContext(ctx, { includePending: true, overrides });
  const touched = new Set(monthNums);
  const layer = change.allocStatus === 'tentative' ? 'tentativePct' : 'confirmedPct';
  const sectors = new Map();
  const sectorRow = async (sid) => { if (!sectors.has(sid)) sectors.set(sid, await get('SELECT id, name_ar, kind FROM sector WHERE id = ?', [sid])); return sectors.get(sid); };
  const reviewers = new Map();
  const perResource = [];
  for (const eid of change.employeeIds) {
    const emp = byId.get(eid);
    const b = before.get(eid); const a = after.get(eid);
    const months = b.months.map((bm, i) => effectRow(bm, a.months[i], { touched: touched.has(bm.month), layer }));
    const warnings_ar = []; const blockers_ar = [];
    const over = months.filter((m) => m.touched && m.conflict);
    if (over.length) warnings_ar.push(`تجاوز الطاقة في ${over.map((m) => `${m.label_ar} (${m.after}%)`).join('، ')} — يُعرض ولا يُمنع`);
    const out = months.filter((m) => m.outOfEngagement);
    if (out.length && change.kind !== 'remove') {
      const msg = `${out.map((m) => m.label_ar).join('، ')} خارج فترة ارتباط «${emp.name_ar}»`;
      if (change.allocStatus === 'confirmed') blockers_ar.push(`${msg} — لا يُؤكَّد تسكين خارج الارتباط؛ اجعله مبدئياً أو عدّل الأشهر`);
      else warnings_ar.push(`${msg} — يبقى مبدئياً ولا يُخصم`);
    }
    if (change.kind === 'new') {
      const dup = (ctx.allocs.get(eid) || []).find((x) => Number(x.year) === change.year
        && (change.target.kind === 'project' ? x.project_id === change.target.id : x.work_bucket === change.target.id));
      if (dup) blockers_ar.push(`«${emp.name_ar}» مُسكَّن على «${change.target.label}» في سنة ${change.year} — عدّل التسكين القائم بدل إضافة جديد`);
      if (change.target.kind === 'project' && emp.sector_id && change.target.project?.sector_id && emp.sector_id !== change.target.project.sector_id) {
        if (isDelivery(await sectorRow(emp.sector_id))) blockers_ar.push(`لا يمكن تسكين «${emp.name_ar}» من قطاع آخر على هذا المشروع`);
      }
      const pend = (ctx.pending.get(eid) || []).filter((r) => r.target_kind === change.target.kind && r.target_id === change.target.id && Number(r.year) === change.year);
      if (pend.length) warnings_ar.push(`يوجد طلب معلَّق لـ«${emp.name_ar}» على «${change.target.label}» في السنة نفسها`);
    }
    const g = rights.get(eid);
    let reviewerUserId = null;
    if (!g.direct) {
      const mgr = await managerOfEmployee(eid);
      if (mgr) {
        if (!reviewers.has(mgr)) {
          const u = await get('SELECT id, name_ar, username FROM app_user WHERE id = ?', [mgr]);
          reviewers.set(mgr, { userId: mgr, name: u?.name_ar || u?.username || mgr,
            why_ar: `مدير إدارة «${emp.department_name || '—'}» — يؤكّد تسكين أهلها`, resources: [] });
        }
        reviewers.get(mgr).resources.push(emp.name_ar);
        reviewerUserId = mgr;
      } else warnings_ar.push(`لا مدير مسجَّل لإدارة «${emp.name_ar}» — سيبقى الطلب معلَّقاً حتى يقرّره من يملك أمر المورد`);
    }
    const fingerprint = await allocationFingerprint(eid, change.year);
    perResource.push({ employeeId: eid, name: emp.name_ar, emp, direct: g.direct, reviewerUserId, months, warnings_ar, blockers_ar, fingerprint });
  }
  return {
    change, perResource, reviewers: [...reviewers.values()],
    directApply: perResource.every((r) => r.direct),
    fingerprints: Object.fromEntries(perResource.map((r) => [r.employeeId, r.fingerprint])),
  };
}

/** S14/S15 — معاينة التغيير قبل حفظه: أثره شهراً شهراً، من يعتمده، وبصماته. لا كتابة. */
export async function previewChange(user, change) {
  const a = await analyzeChange(user, change);
  return {
    previewId: id('prv'),
    change: publicChange(a.change),
    perResource: a.perResource.map((r) => ({ employeeId: r.employeeId, name: r.name, direct: r.direct, reviewerUserId: r.reviewerUserId,
      months: r.months, warnings_ar: r.warnings_ar, blockers_ar: r.blockers_ar })),
    reviewers: a.reviewers.map(({ userId, name, why_ar, resources }) => ({ userId, name, why_ar, resources })),
    directApply: a.directApply,
    canSubmit: a.perResource.every((r) => !r.blockers_ar.length),
    fingerprints: a.fingerprints,
    basis_ar: BASIS_AR,
  };
}

// ═══ الإرسال (T18/T19) ════════════════════════════════════════════════════════════════
/**
 * لكل مورد صفُّ طلب. من يملك أمر المورد يُطبَّق له فوراً داخل المعاملة (status='applied')،
 * وإلا 'pending' موجَّهاً إلى مدير المورد عبر المحرّك — وبلا مديرٍ يبقى معلَّقاً بملاحظةٍ تقول ذلك.
 * المفتاح المكرر يعيد الطلب نفسه، والبصمة القديمة تُرَدّ قبل أن تحجز شيئاً.
 */
export async function submitRequest(ctx, rawChange, { idempotencyKey, expectedFingerprints, draft = false, needId } = {}) {
  const user = ctx.user;
  // الاحتياج المرفق ليس حقلاً حراً: يُقرأ بصلاحية الطالب ويُطابَق مع وجهة الطلب — وإلا صار لأيٍّ
  // كان أن يعلّق طلبه على احتياج قطاعٍ آخر فيقلب حالته «مغطى» (استيرادٌ كسول لكسر حلقة الاستيراد).
  if (needId) {
    const { assertNeedForRequest } = await import('./needs.js');
    await assertNeedForRequest(user, needId, rawChange);
  }
  const a = await analyzeChange(user, rawChange);
  const { change } = a;
  const key = String(idempotencyKey || '').trim() || null;
  const results = [];
  await tx(async () => {
    for (const r of a.perResource) {
      const emp = r.emp;
      const derivedKey = key ? `${key}:${emp.id}` : null;
      if (derivedKey) {
        const existing = await get('SELECT id FROM allocation_request WHERE idempotency_key = ? AND deleted_at IS NULL', [derivedKey]);
        if (existing) { results.push({ id: existing.id, reused: true }); continue; }
      }
      if (!draft && r.blockers_ar.length) throw badRequest(r.blockers_ar[0]);
      const expected = expectedFingerprints && expectedFingerprints[emp.id] ? String(expectedFingerprints[emp.id]) : null;
      if (expected && expected !== r.fingerprint) throw conflict(`تغيّرت الخطة منذ المعاينة لـ«${emp.name_ar}» — أعد المعاينة ثم أرسل الطلب من جديد`);
      const reqId = id('areq'); const now = nowIso();
      const row = {
        id: reqId, kind: change.kind, employee_id: emp.id, target_kind: change.target.kind, target_id: change.target.id,
        allocation_id: change.alloc?.id || null, year: change.year, months_json: monthsJsonOf(change.months),
        alloc_status: change.allocStatus, billable: change.billable, status: draft ? 'draft' : 'pending',
        reason: null, note: null, expected_fingerprint: r.fingerprint, idempotency_key: derivedKey, need_id: needId || null,
        sector_id: emp.sector_id || null, department_id: emp.department_id || null, requested_by: user.id,
        reviewer_user_id: null, approval_request_id: null, decided_by: null, decided_at: null, decision_note: null,
        applied_allocation_id: null, created_at: now, updated_at: now,
      };
      const detail = { kind: change.kind, employee: emp.id, target: { kind: change.target.kind, id: change.target.id, label: change.target.label },
        year: change.year, months: JSON.parse(row.months_json), alloc_status: change.allocStatus, billable: change.billable, need_id: needId || null };
      if (draft) {
        await insert('allocation_request', row);
        await audit(ctx, { action: 'create', resource: 'allocation_request', resourceId: reqId, sectorId: row.sector_id, detail: { ...detail, status: 'draft' } });
      } else if (r.direct) {
        await insert('allocation_request', row);
        await audit(ctx, { action: 'create', resource: 'allocation_request', resourceId: reqId, sectorId: row.sector_id, detail: { ...detail, status: 'pending', direct: true } });
        const allocationId = await applyRequest(ctx, row);
        await finishRequest(ctx, row, { status: 'applied', applied_allocation_id: allocationId }, { direct: true, effect: r.months });
      } else {
        const approver = r.reviewerUserId;
        if (!approver) row.note = NO_MANAGER_NOTE_AR;
        await insert('allocation_request', row);
        await audit(ctx, { action: 'create', resource: 'allocation_request', resourceId: reqId, sectorId: row.sector_id,
          detail: { ...detail, status: 'pending', reviewer: approver, note_ar: approver ? undefined : NO_MANAGER_NOTE_AR } });
        if (approver) {
          const apr = await raiseDirectApproval(ctx, { workflowKey: ALLOCATION_WORKFLOW_KEY, resource: 'allocation_request', resourceId: reqId,
            assigneeUserId: approver, sectorId: emp.sector_id || null, detail });
          await update('allocation_request', reqId, { approval_request_id: apr.id, reviewer_user_id: approver, updated_at: nowIso() });
          await notify(approver, { kind: 'approval', title: 'طلب تسكين بانتظارك',
            body: `${emp.name_ar} على «${change.target.label}» — ${REQUEST_KIND_AR[change.kind]}: ${monthsTextAr(change.year, change.months) || 'إزالة'}`,
            ref_resource: 'approval_request', ref_id: apr.id });
        }
      }
      results.push({ id: reqId, reused: false });
    }
  });
  const requests = [];
  for (const x of results) requests.push(await getRequest(user, x.id));
  const count = (s) => requests.filter((q) => q.status === s).length;
  return {
    requests, directApply: a.directApply,
    summary: { total: requests.length, applied: count('applied'), pending: count('pending'), draft: count('draft'),
      returned: count('returned'), reused: results.filter((x) => x.reused).length },
  };
}

// ═══ القراءة (S16) ═══════════════════════════════════════════════════════════════════
const REQUEST_SELECT = `SELECT r.*, e.name_ar employee_name, e.user_id employee_user_id, e.sector_id emp_sector_id, e.department_id emp_department_id,
         d.name_ar department_name, p.name_ar project_name,
         ru.name_ar requester_name, ru.username requester_username, rv.name_ar reviewer_name, rv.username reviewer_username,
         du.name_ar decider_name, du.username decider_username
    FROM allocation_request r
    JOIN employee e ON e.id = r.employee_id
    LEFT JOIN department d ON d.id = e.department_id
    LEFT JOIN project p ON p.id = r.target_id AND r.target_kind = 'project'
    LEFT JOIN app_user ru ON ru.id = r.requested_by
    LEFT JOIN app_user rv ON rv.id = r.reviewer_user_id
    LEFT JOIN app_user du ON du.id = r.decided_by`;

// من يرى الطلب: صاحبه، ومن وُجِّه إليه، ومن يقرأ «طلب تسكين» في نطاق موارده — ومن نطاقه «مشروع»
// (مدير المشروع) يرى طلبات مشاريعه. والموظف بلا منحٍ يرى ما رفعه هو فقط.
function visibilitySql(user) {
  if (user.role_id === 'admin') return { clause: '1=1', params: [] };
  const parts = ['r.requested_by = ?', 'r.reviewer_user_id = ?']; const params = [user.id, user.id];
  const readScope = effectiveScope(user, 'read', 'allocation_request');
  if (readScope && canReadResources(user)) {
    const s = resourceScopeSql(user, 'e');
    if (s.clause !== '1=0') { parts.push(`(${s.clause})`); params.push(...s.params); }
  }
  const pids = [...(user.projectIds || [])];
  if (readScope === 'project' && pids.length) { parts.push(`(r.target_kind = 'project' AND r.target_id IN (${ph(pids)}))`); params.push(...pids); }
  return { clause: parts.join(' OR '), params };
}
// «يملك أمره» بصيغة SQL لفلتر «بانتظار قراري» — نظير ownsEmployee على الصفوف (بلا تكرار الاستعلام لكل صف).
function ownedEmployeeSql(user, e = 'e') {
  if (user.role_id === 'admin' || user.scope === 'company') return { clause: '1=1', params: [] };
  const parts = [`${e}.user_id = ?`]; const params = [user.id];
  if (user.scope === 'sector' && user.sector_id) { parts.push(`${e}.sector_id = ?`); params.push(user.sector_id); }
  const deps = departmentScope(user);
  if (deps.length) { const d = departmentInSql(`${e}.department_id`, deps); parts.push(d.clause); params.push(...d.params); }
  return { clause: `(${parts.join(' OR ')})`, params };
}
// إشارةٌ للشاشة لا حكمٌ: القرار الفعلي يمرّ بـ decideRequest وفحوصه.
function ownsHint(user, r) {
  if (user.role_id === 'admin' || user.scope === 'company') return true;
  if (r.employee_user_id && r.employee_user_id === user.id) return true;
  if (user.scope === 'sector' && user.sector_id && user.sector_id === r.emp_sector_id) return true;
  return !!(r.emp_department_id && departmentScope(user).includes(r.emp_department_id));
}

function shapeRequest(r, user) {
  const status = r.status;
  const canDecide = status === 'pending' && r.requested_by !== user.id
    && (r.reviewer_user_id === user.id || user.role_id === 'admin' || (!r.reviewer_user_id && ownsHint(user, r)));
  return {
    id: r.id, kind: r.kind, kind_ar: REQUEST_KIND_AR[r.kind] || r.kind, status, status_ar: REQUEST_STATUS_AR[status] || status,
    employee: { id: r.employee_id, name: r.employee_name, department_id: r.emp_department_id || null, department_name: r.department_name || null, sector_id: r.emp_sector_id || null },
    target: { kind: r.target_kind, id: r.target_id, label: targetLabelFor(r) },
    allocationId: r.allocation_id || null, year: Number(r.year), months: requestMonthsMap(r),
    allocStatus: r.alloc_status || 'confirmed', allocStatus_ar: ALLOC_STATUS_AR[r.alloc_status || 'confirmed'],
    billable: r.billable == null ? null : Number(r.billable) === 1,
    reason: r.reason || null, note: r.note || null, decision_note: r.decision_note || null,
    requestedBy: { id: r.requested_by, name: r.requester_name || r.requester_username || null },
    reviewer: r.reviewer_user_id ? { id: r.reviewer_user_id, name: r.reviewer_name || r.reviewer_username || null } : null,
    decidedBy: r.decided_by ? { id: r.decided_by, name: r.decider_name || r.decider_username || null } : null,
    approvalRequestId: r.approval_request_id || null, appliedAllocationId: r.applied_allocation_id || null, needId: r.need_id || null,
    created_at: r.created_at, updated_at: r.updated_at || null, decided_at: r.decided_at || null,
    canWithdraw: r.requested_by === user.id && ['draft', 'pending'].includes(status),
    canDecide,
  };
}

export async function listRequests(user, { filter = 'all', q, from, to, status } = {}) {
  const vis = visibilitySql(user);
  const where = ['r.deleted_at IS NULL', `(${vis.clause})`]; const params = [...vis.params];
  const f = String(filter || 'all');
  if (f === 'mine') { where.push('r.requested_by = ?'); params.push(user.id); }
  else if (f === 'pending_my_decision') {
    const own = ownedEmployeeSql(user, 'e');
    where.push(`r.status = 'pending'`, 'r.requested_by <> ?', `(r.reviewer_user_id = ? OR (r.reviewer_user_id IS NULL AND ${own.clause}))`);
    params.push(user.id, user.id, ...own.params);
  } else if (f !== 'all') throw badRequest('الفلتر: الكل، أو طلباتي، أو بانتظار قراري');
  if (status) { where.push('r.status = ?'); params.push(String(status)); }
  const qq = String(q || '').trim();
  if (qq) { where.push('(e.name_ar LIKE ? OR p.name_ar LIKE ?)'); params.push(`%${qq}%`, `%${qq}%`); }
  const fk = parseMonthKey(from); const tk = parseMonthKey(to);
  if (from && !fk) throw badRequest('بداية المدى بصيغة السنة-الشهر مثل 2026-09');
  if (to && !tk) throw badRequest('نهاية المدى بصيغة السنة-الشهر مثل 2026-12');
  if (fk) { where.push('r.year >= ?'); params.push(fk.year); }
  if (tk) { where.push('r.year <= ?'); params.push(tk.year); }
  let rows = await all(`${REQUEST_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC, r.id LIMIT ${LIST_LIMIT}`, params);
  // تقاطع الأشهر (الأشهر داخل JSON — تُقصّ هنا بعد قصّ السنة في الاستعلام).
  if (fk || tk) {
    const lo = fk ? monthKey(fk.year, fk.month) : null; const hi = tk ? monthKey(tk.year, tk.month) : null;
    rows = rows.filter((r) => Object.keys(requestMonthsMap(r)).some((k) => (!lo || k >= lo) && (!hi || k <= hi)));
  }
  const shaped = rows.map((r) => shapeRequest(r, user));
  return { rows: shaped, total: shaped.length, filter: f };
}

async function canSeeRequest(user, r) {
  if (user.role_id === 'admin') return true;
  if (r.requested_by === user.id || r.reviewer_user_id === user.id) return true;
  const readScope = effectiveScope(user, 'read', 'allocation_request');
  if (!readScope) return false;
  if (canReadResources(user)) {
    const emp = await get('SELECT * FROM employee WHERE id = ?', [r.employee_id]);
    if (emp && resourceInScope(user, emp)) return true;
  }
  return readScope === 'project' && r.target_kind === 'project' && !!user.projectIds?.has(r.target_id);
}

async function loadRequestRow(requestId) {
  const r = await get('SELECT * FROM allocation_request WHERE id = ? AND deleted_at IS NULL', [requestId]);
  if (!r) throw notFound('طلب التسكين غير موجود — قد يكون حُذف');
  return r;
}

/** طلبٌ واحد مع أثره (قبل/بعد شهراً شهراً) ومسار اعتماده وسجلّ ما جرى عليه. */
export async function getRequest(user, requestId) {
  const r = await get(`${REQUEST_SELECT} WHERE r.id = ? AND r.deleted_at IS NULL`, [requestId]);
  if (!r) throw notFound('طلب التسكين غير موجود — قد يكون حُذف');
  if (!(await canSeeRequest(user, r))) throw forbidden('هذا الطلب خارج نطاقك — يراه صاحبه ومدير المورد ومن يقرأ طلبات التسكين في نطاقه');
  const shaped = shapeRequest(r, user);
  let effect = null;
  if (r.status === 'applied') {
    const aud = await get(`SELECT detail_json FROM audit_log WHERE resource = 'allocation_request' AND resource_id = ? AND action = 'apply' ORDER BY at DESC LIMIT 1`, [r.id]);
    try { effect = aud?.detail_json ? (JSON.parse(aud.detail_json).effect || null) : null; } catch { effect = null; }
  } else if (['pending', 'draft', 'returned'].includes(r.status)) {
    effect = await effectOf(r);
  }
  let approval = null;
  if (r.approval_request_id) {
    const apr = await get('SELECT ar.*, au.name_ar assignee_name, au.username assignee_username FROM approval_request ar LEFT JOIN app_user au ON au.id = ar.assignee_user_id WHERE ar.id = ?', [r.approval_request_id]);
    if (apr) {
      const actions = await all(`SELECT a.action, a.comment, a.acted_at, u.name_ar actor_name, u.username actor_username
          FROM approval_action a LEFT JOIN app_user u ON u.id = a.actor_user_id WHERE a.request_id = ? ORDER BY a.acted_at, a.id`, [apr.id]);
      approval = { id: apr.id, status: apr.status, assignee: apr.assignee_user_id ? { id: apr.assignee_user_id, name: apr.assignee_name || apr.assignee_username || null } : null,
        created_at: apr.created_at, closed_at: apr.closed_at || null,
        actions: actions.map((x) => ({ action: x.action, comment: x.comment || null, acted_at: x.acted_at, actor: x.actor_name || x.actor_username || null })) };
    }
  }
  const history = (await all(`SELECT at, action, username, detail_json FROM audit_log WHERE resource = 'allocation_request' AND resource_id = ? ORDER BY at, id`, [r.id]))
    .map((h) => { let d = null; try { d = h.detail_json ? JSON.parse(h.detail_json) : null; } catch { d = null; }
      return { at: h.at, action: h.action, action_ar: AUDIT_ACTION_AR[h.action] || h.action, actor: h.username || null, reason: d?.reason || null }; });
  return { ...shaped, effect, approval, history };
}

// ═══ القرار والسحب (T20/T21) ═════════════════════════════════════════════════════════
/**
 * اعتماد/إعادة/رفض. الطلب الموجَّه يمرّ بمحرّك الاعتماد (المعتمِد هو الموجَّه إليه، ولا يعتمد
 * أحدٌ ما رفعه)، والطلب بلا معتمِد يقرّره من يملك أمر المورد. الإعادة والرفض بسببٍ يُحفظ.
 * وعند الاعتماد تُعاد مقارنة البصمة داخل المعاملة: اختلفت ⇒ يُعاد الطلب لا يُطبَّق.
 */
export async function decideRequest(ctx, requestId, action, note) {
  const user = ctx.user;
  const act = String(action || '').toLowerCase();
  if (!['approve', 'return', 'reject'].includes(act)) throw badRequest('حدّد القرار: اعتماد أو إعادة أو رفض');
  const text = String(note || '').trim();
  if (act !== 'approve' && !text) {
    throw badRequest(act === 'return' ? 'اذكر سبب الإعادة ليصحّح صاحب الطلب ما يلزم' : 'اذكر سبب الرفض ليعرف صاحب الطلب لماذا رُفض');
  }
  const req = await loadRequestRow(requestId);
  if (req.status === 'draft') throw badRequest('الطلب مسودة لم تُرسل بعد — لا قرار عليها');
  if (req.status !== 'pending') throw badRequest(`الطلب ${REQUEST_STATUS_AR[req.status] || req.status} — لا يُقرَّر مرتين`);
  if (req.requested_by === user.id) throw forbidden('لا تقرّر طلباً رفعتَه بنفسك — القرار لمدير المورد');
  const apr = req.approval_request_id ? await get('SELECT * FROM approval_request WHERE id = ?', [req.approval_request_id]) : null;
  const viaEngine = !!(apr && apr.status === 'PENDING');
  if (viaEngine) {
    if (apr.assignee_user_id !== user.id && user.role_id !== 'admin') throw forbidden('هذا الطلب موجَّه إلى مدير المورد ليقرّره، لا إليك');
  } else {
    // بلا معتمِدٍ مسجَّل يقرّره من **يدير** المورد فعلاً (قيادة الإدارة أو نطاق القطاع مع منح
    // كتابة التسكين) — لا كل «مالك» بحكم الانتماء إلى الإدارة نفسها أو النافذة الشركية.
    const emp = await get('SELECT id, sector_id, department_id, user_id FROM employee WHERE id = ?', [req.employee_id]);
    if (!emp || !(await managesResource(user, emp))) throw forbidden('قرار هذا الطلب لمن يملك أمر المورد — مدير إدارته أو قائد قطاعه أو مدير النظام');
  }
  const tell = (title, body) => notify(req.requested_by, { kind: 'approval', title, body: body || '', ref_resource: 'allocation_request', ref_id: req.id });
  await tx(async () => {
    if (act === 'approve') {
      const check = await revalidateRequest(req);
      if (!check.ok) {
        await finishRequest(ctx, req, { status: 'returned', reason: check.reason_ar, decision_note: text || null }, { decision: 'approve', code: check.code });
        if (viaEngine) await actOnApproval(ctx, apr.id, 'reject', check.reason_ar);
        else await tell('أُعيد طلب التسكين', check.reason_ar);
        return;
      }
      if (viaEngine) { await actOnApproval(ctx, apr.id, 'approve', text || null); return; }   // المُسوّي ينفّذ داخل معاملة المحرّك
      const effect = await effectOf(req);
      let allocationId;
      try { allocationId = await applyRequest(ctx, req); } catch (e) {
        if (!(e && e.status && e.status < 500)) throw e;
        const reason = `تعذّر تنفيذ الطلب بصلاحية المعتمِد: ${e.message}`;
        await finishRequest(ctx, req, { status: 'returned', reason, decision_note: text || null }, { decision: 'approve', code: 'writer_refused' });
        await tell('أُعيد طلب التسكين', reason);
        return;
      }
      await finishRequest(ctx, req, { status: 'applied', applied_allocation_id: allocationId, decision_note: text || null }, { effect });
      await tell('اعتُمد طلب التسكين', text);
      return;
    }
    const status = act === 'return' ? 'returned' : 'rejected';
    await finishRequest(ctx, req, { status, reason: text, decision_note: text }, { decision: act });
    if (viaEngine) await actOnApproval(ctx, apr.id, 'reject', text);
    else await tell(status === 'returned' ? 'أُعيد طلب التسكين' : 'رُفض طلب التسكين', text);
  });
  return await getRequest(user, requestId);
}

/** يسحب الطلبَ صاحبُه قبل القرار — ويُغلق طلبُ الاعتماد الموجَّه كي لا يبقى في صندوق المدير. */
export async function withdrawRequest(ctx, requestId) {
  const user = ctx.user;
  const req = await loadRequestRow(requestId);
  if (req.requested_by !== user.id && user.role_id !== 'admin') throw forbidden('يسحب الطلبَ صاحبُه وحده');
  if (!['draft', 'pending'].includes(req.status)) throw badRequest(`الطلب ${REQUEST_STATUS_AR[req.status] || req.status} — لا يُسحب بعد القرار`);
  await tx(async () => {
    await finishRequest(ctx, req, { status: 'withdrawn' });
    if (req.approval_request_id) {
      const apr = await get('SELECT id, status, assignee_user_id FROM approval_request WHERE id = ?', [req.approval_request_id]);
      if (apr && apr.status === 'PENDING') {
        await update('approval_request', apr.id, { status: 'CANCELLED', closed_at: nowIso() });
        await audit(ctx, { action: 'cancel', resource: 'approval', resourceId: apr.id, sectorId: req.sector_id || null,
          detail: { reason_ar: 'سُحب طلب التسكين', allocation_request: req.id } });
        if (apr.assignee_user_id) {
          await notify(apr.assignee_user_id, { kind: 'approval', title: 'سُحب طلب تسكين كان بانتظارك', body: '',
            ref_resource: 'allocation_request', ref_id: req.id });
        }
      }
    }
  });
  return await getRequest(user, requestId);
}
