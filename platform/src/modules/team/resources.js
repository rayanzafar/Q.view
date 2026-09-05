// ── سجل الموارد وملف المورد — S02/S03/S04/S05/S07/S08/S09/S10/S11 ─────────────────────────────
//
// «من لدينا؟ ما قدراتهم؟ على ماذا يعملون؟ ما الالتزام المخطط؟» — أول أسئلة الموجّه، وهذا الملف
// يجيبها لموردٍ واحد أو لسجلٍّ كامل. ثلاث قواعد تحكم كل سطرٍ فيه:
//   ① **الباب واحد**: `access.js` يقرّر من يرى المورد ومن يعدّله ومن يخطّط عليه — لا فحص دورٍ هنا
//      ولا في الموجّه؛ الصفوف والحقول والعدادات تحت الحدّ نفسه (§10: إخفاء زرٍّ لا يكفي).
//   ② **لا مال**: أسماء الأعمال وفتراتها ونسبها تخرج لمن يرى المورد (قاعدة access.js ②)؛ لا راتب
//      ولا قيمة عقدٍ ولا فاتورة ولا ميزانية ولا هامش مهما كان القارئ — فالموارد البشرية تقرأ
//      التسكين شركةً ولا تفتح شاشة مالٍ من هذا الباب. أسماء الأعمال تُقرأ هنا من نطاق قراءة
//      **المورد** لا من نطاق قراءة المشروع (EXECUTION-LOG §2).
//   ③ **لا معادلة ثانية**: كل رقم طاقةٍ أو متاحٍ من `capacity-model.js` عبر `capacity-read.js`.
//
// والمورد هو `employee` نفسه (لا جدول ثانٍ): موظفٌ بلا حساب دخول موردٌ كامل يُخطَّط عليه (T16)،
// وتعطيل حسابه لا يمسّ ارتباطه، وأرشفته بتاريخٍ تحفظ التاريخ (T17).
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { inDepartmentScope } from '../../core/rbac/departments.js';
import { riyadhDate, MONTHS_AR } from '../../core/i18n/time.js';
import { taskStatusLabel, taskPriorityLabel } from '../../core/i18n/task-vocab.js';
import { workBucketLabel, auditActionLabel } from '../../web/i18n/glossary.js';
import { createEmployee, updateEmployee, orgTree, normName } from '../org/org.js';
import { namesByIds } from '../org/people.js';
import { WORK_BUCKETS } from '../pmo/projects.js';
import { taskLoadFor, openLoadSql, TASK_LOAD_BASIS_AR } from '../pmo/task-load.js';
import { personDossier, teamTasksAccess } from '../pmo/tasks.js';
import { isPendingTask } from '../pmo/task-approval.js';
import {
  canReadResources, resourceScopeSql, resourceInScope, loadReadableResource, isSelf, canEditResource, canCreateResource,
  planningRights, resourceTypeOf, RESOURCE_TYPES, RESOURCE_TYPE_AR, leadsResource } from './access.js';
import { figuresFor, billableOf } from './capacity-read.js';
import { monthKey, parseMonthKey, monthPctOf, capacityOnDay, bandOf, BAND_AR, DEFAULT_CAPACITY_PCT } from './capacity-model.js';

const N = (v) => Number(v) || 0;
const ph = (arr) => arr.map(() => '?').join(',');

// ── المفردات: مفاتيح إنجليزية داخلية وكلمتها العربية بجوارها (قاعدة مشتركة ٧) ───────────────
export const ENGAGEMENT_STATUS_AR = Object.freeze({
  active: 'على رأس العمل', ending: 'ينتهي قريباً', ended: 'منتهي الارتباط', upcoming: 'يبدأ لاحقاً',
});
// «ينتهي قريباً» = تاريخ نهايةٍ خلال هذا العدد من الأيام — أفقٌ واحد معلن لا عتبةٌ في كل شاشة.
export const ENDING_HORIZON_DAYS = 90;
export const ALLOC_STATUS_AR = Object.freeze({ confirmed: 'مؤكد', tentative: 'مبدئي', pending: 'بانتظار الاعتماد', mixed: 'مؤكد ومبدئي' });
export const ROLE_AR = Object.freeze({ member: 'عضو فريق', lead: 'قائد الفريق', pm: 'مدير المشروع', reviewer: 'مراجع', approver: 'معتمِد', owner: 'مالك' });
const roleLabel = (r) => ROLE_AR[String(r || 'member').toLowerCase()] || 'عضو فريق';
export const PROJECT_STATUS_AR = Object.freeze({
  IN_PROGRESS: 'قيد التنفيذ', COMPLETED: 'مكتمل', PLANNED: 'مُخطَّط', ON_HOLD: 'متوقّف مؤقتًا', CANCELLED: 'ملغى', NOT_STARTED: 'لم يبدأ',
});
const projectStatusLabel = (s) => PROJECT_STATUS_AR[String(s || '').toUpperCase()] || 'حالة غير محدَّدة';
export const CAPABILITY_KINDS = ['skill', 'experience', 'goal'];
export const CAPABILITY_KIND_AR = Object.freeze({ skill: 'مهارة', experience: 'خبرة', goal: 'هدف تطوير' });
export const SKILL_LEVELS = ['beginner', 'practitioner', 'advanced', 'expert'];
export const SKILL_LEVEL_AR = Object.freeze({ beginner: 'مبتدئ', practitioner: 'ممارس', advanced: 'متقدم', expert: 'خبير' });
export const GOAL_STATUSES = ['planned', 'in_progress', 'done'];
export const GOAL_STATUS_AR = Object.freeze({ planned: 'مخطَّط', in_progress: 'قيد التنفيذ', done: 'تحقّق' });
export const EVIDENCE_KINDS = ['project', 'bucket', 'document', 'note'];
export const EVIDENCE_KIND_AR = Object.freeze({ project: 'مشروع', bucket: 'بند داخلي', document: 'مستند', note: 'ملاحظة' });
export const SOURCE_AR = Object.freeze({ self: 'تقييم ذاتي', manager: 'مراجَع' });
export const TASK_LEVEL_AR = Object.freeze({ low: 'منخفض', medium: 'متوسط', high: 'مرتفع', unmeasured: 'غير مقاس' });
export const AUDIT_KIND_AR = Object.freeze({ profile: 'بيانات المورد', capacity: 'الطاقة التعاقدية', allocation: 'التسكين', request: 'طلب تسكين', capability: 'القدرات' });
export const BASIS_AR = 'المتاح محسوب من الطاقة التعاقدية المسجلة بعد التسكين المؤكد';
export const NO_MONEY_AR = 'أسماء الأعمال وفتراتها ونسبها فقط — بلا قيم مالية';
const NO_ACCOUNT_AR = 'لا حساب دخول مرتبط بهذا المورد — المهام تُسند إلى حسابات الدخول، فاربط حسابه من نموذج المورد إن كان له حساب';

// ── التواريخ: نصوص ISO تُقارن نصياً، و«اليوم» يوم الرياض (T15) ───────────────────────────────
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (iso) => String(iso || '').slice(0, 10);
const dayIndex = (iso) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000);
const addDays = (iso, n) => new Date((dayIndex(iso) + n) * 86400000).toISOString().slice(0, 10);
const keyOf = (iso) => String(iso).slice(0, 7);
function addMonths(key, n) {
  const { year, month } = parseMonthKey(key);
  const idx = year * 12 + (month - 1) + n;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}
const monthLabelAr = (key) => { const p = parseMonthKey(key); return p ? `${MONTHS_AR[p.month - 1]} ${p.year}` : key; };

function normIsoDate(v, label, { required = false } = {}) {
  if (v == null || String(v).trim() === '') {
    if (required) throw badRequest(`${label} مطلوب — أدخله بصيغة سنة-شهر-يوم مثل ${riyadhDate()}`);
    return null;
  }
  const s = String(v).trim().slice(0, 10);
  if (!ISO_DAY.test(s) || Number.isNaN(Date.parse(s))) throw badRequest(`${label} غير صحيح — أدخله بصيغة سنة-شهر-يوم مثل ${riyadhDate()}`);
  return s;
}
const normText = (v, max = 200) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, max) : null; };
function normCapacityPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 100)
    throw badRequest('الطاقة التعاقدية نسبة صحيحة بين ١ و١٠٠ — ١٠٠ تعني دواماً كاملاً و٥٠ نصف دوام');
  return n;
}
function normResourceType(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase();
  if (!t) return 'internal';
  if (!RESOURCE_TYPES.includes(t)) throw badRequest('نوع المورد غير معروف — اختر «داخلي» أو «خارجي» أو «شريك»');
  return t;
}
const capacityPctOf = (emp) => { const c = Number(emp?.capacity_pct); return Number.isFinite(c) && c > 0 ? c : DEFAULT_CAPACITY_PCT; };

// ── المدى الزمني: مفاتيح `YYYY-MM`، الافتراضي الشهر الجاري وشهران بعده ─────────────────────
const MAX_RANGE_MONTHS = 24;
function periodOf(opts = {}) {
  const nowKey = keyOf(riyadhDate());
  const fromRaw = String(opts.from || '').trim(); const toRaw = String(opts.to || '').trim();
  if (fromRaw && !parseMonthKey(fromRaw)) throw badRequest(`بداية الفترة بصيغة سنة-شهر مثل ${nowKey}`);
  if (toRaw && !parseMonthKey(toRaw)) throw badRequest(`نهاية الفترة بصيغة سنة-شهر مثل ${nowKey}`);
  let from = fromRaw || nowKey;
  let to = toRaw || addMonths(from, 2);
  if (to < from) [from, to] = [to, from];
  const a = parseMonthKey(from); const b = parseMonthKey(to);
  if ((b.year * 12 + b.month) - (a.year * 12 + a.month) >= MAX_RANGE_MONTHS) throw badRequest(`المدى حتى ${MAX_RANGE_MONTHS} شهراً — ضيّق الفترة`);
  return { from, to, nowKey };
}
function monthOf(opts = {}) {
  const today = riyadhDate();
  const y = opts.year == null || opts.year === '' ? Number(today.slice(0, 4)) : Number(opts.year);
  const m = opts.month == null || opts.month === '' ? Number(today.slice(5, 7)) : Number(opts.month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) throw badRequest('اختر شهراً صحيحاً (١–١٢) وسنةً صحيحة');
  return { year: y, month: m, key: monthKey(y, m) };
}

// ── حالة الارتباط: من طرفَي الخدمة وعلامة «نشط» — بالترتيب نفسه في JS وفي SQL ─────────────
// المؤرشف بلا تاريخ مغادرة منتهٍ (لا يُخترع له تاريخ)، ومن له تاريخٌ فتاريخُه الحكم ولو عُطّل
// حسابه — وهي قاعدة `engagedDays` في نموذج الطاقة حرفاً، فلا يقول السجل «على رأس العمل» لمن
// لا طاقة له في الحساب.
export function engagementStatus(emp, today = riyadhDate(), horizonDays = ENDING_HORIZON_DAYS) {
  const hire = day(emp?.hire_date); const end = day(emp?.end_date);
  if ((end && end < today) || (Number(emp?.active) === 0 && !end)) return 'ended';
  if (hire && hire > today) return 'upcoming';
  if (end && end <= addDays(today, horizonDays)) return 'ending';
  return 'active';
}
function engagementOf(emp, today = riyadhDate()) {
  const status = engagementStatus(emp, today);
  const end = day(emp.end_date);
  return {
    status, status_ar: ENGAGEMENT_STATUS_AR[status],
    hire_date: day(emp.hire_date) || null, end_date: end || null,
    daysLeft: status === 'ending' ? dayIndex(end) - dayIndex(today) : null,
  };
}
// الشرط نفسه في SQL — بالأسبقية نفسها (منتهٍ ثم لاحق ثم ينتهي ثم على رأس العمل)، وكل فرعٍ
// محروسٌ بـ`IS NOT NULL` قبل المقارنة كي لا تبتلع NULL صفّاً في `NOT (...)`.
function engagementClause(status, alias, today, horizon) {
  const ended = `((${alias}.end_date IS NOT NULL AND ${alias}.end_date < ?) OR (${alias}.active = 0 AND ${alias}.end_date IS NULL))`;
  const upcoming = `(${alias}.hire_date IS NOT NULL AND ${alias}.hire_date > ?)`;
  const ending = `(${alias}.end_date IS NOT NULL AND ${alias}.end_date >= ? AND ${alias}.end_date <= ?)`;
  switch (status) {
    case 'ended': return { clause: ended, params: [today] };
    case 'upcoming': return { clause: `(NOT ${ended} AND ${upcoming})`, params: [today, today] };
    case 'ending': return { clause: `(NOT ${ended} AND NOT ${upcoming} AND ${ending})`, params: [today, today, today, horizon] };
    case 'active': return { clause: `(NOT ${ended} AND NOT ${upcoming} AND NOT ${ending})`, params: [today, today, today, horizon] };
    default: throw badRequest('حالة الارتباط غير معروفة — اختر: على رأس العمل، ينتهي قريباً، منتهٍ، أو يبدأ لاحقاً');
  }
}
// نوع المورد في SQL: العمود الجديد، والفراغ يُشتق من نوع التوظيف القائم كما في `resourceTypeOf`.
function resourceTypeClause(type, alias) {
  const t = String(type || '').trim().toLowerCase();
  if (!RESOURCE_TYPES.includes(t)) throw badRequest('نوع المورد غير معروف — اختر «داخلي» أو «خارجي» أو «شريك»');
  if (t === 'partner') return { clause: `${alias}.resource_type = 'partner'`, params: [] };
  if (t === 'external') return { clause: `(${alias}.resource_type = 'external' OR (${alias}.resource_type IS NULL AND ${alias}.employment_type = 'متعاقد'))`, params: [] };
  return { clause: `(${alias}.resource_type = 'internal' OR (${alias}.resource_type IS NULL AND COALESCE(${alias}.employment_type,'') <> 'متعاقد'))`, params: [] };
}

// ── حساب الدخول المرتبط: يُقرأ من الجهتين لأن المنتج يكتب العمودين (org.linkUserToEmployee) ──
async function accountOf(emp) {
  if (!emp) return null;
  const uid = emp.user_id || '';
  return (await get(
    `SELECT id, username, name_ar, active FROM app_user
      WHERE deleted_at IS NULL AND (id = ? OR employee_id = ?)
      ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id LIMIT 1`, [uid, emp.id, uid])) || null;
}
const USER_ID_SQL = (alias) => `(SELECT MIN(au.id) FROM app_user au WHERE au.deleted_at IS NULL AND (au.employee_id = ${alias}.id OR au.id = ${alias}.user_id))`;

async function orgNamesOf(emp) {
  const r = await get(
    `SELECT s.name_ar sector_name, d.name_ar department_name, d.manager_user_id manager_user_id,
            ou.name_ar unit_name, pos.title_ar position_title
       FROM employee e
       LEFT JOIN sector s ON s.id = e.sector_id
       LEFT JOIN department d ON d.id = e.department_id AND d.deleted_at IS NULL
       LEFT JOIN org_unit ou ON ou.id = e.unit_id
       LEFT JOIN position pos ON pos.id = e.position_id
      WHERE e.id = ?`, [emp.id]);
  return r || {};
}

// ── شكل المورد كما يخرج من كل قراءة: قائمةُ سماحٍ لا حظر — فلا يتسرّب عمودٌ جديد (ولا الراتب) ──
function shapeResource(emp, names = {}, account = null, today = riyadhDate()) {
  const type = resourceTypeOf(emp);
  return {
    id: emp.id, name_ar: emp.name_ar, name_en: emp.name_en || null, job_title: emp.job_title || null,
    employment_type: emp.employment_type || null,
    resourceType: type, resourceType_ar: RESOURCE_TYPE_AR[type],
    vendor_name: emp.vendor_name || null, engagement_ref: emp.engagement_ref || null,
    sector_id: emp.sector_id || null, sector_name: names.sector_name || null,
    department_id: emp.department_id || null, department_name: names.department_name || null,
    unit_id: emp.unit_id || null, unit_name: names.unit_name || null, position_title: names.position_title || null,
    hire_date: day(emp.hire_date) || null, end_date: day(emp.end_date) || null,
    active: Number(emp.active) === 1, status: emp.status || null,
    engagement: engagementOf(emp, today),
    capacityPct: capacityPctOf(emp),
    userId: account?.id || null,
    created_at: emp.created_at || null, updated_at: emp.updated_at || null,
  };
}
function shapeMonth(m) {
  return {
    key: m.key, label_ar: monthLabelAr(m.key), state: m.state, state_ar: m.state === 'out' ? BAND_AR.out : (BAND_AR[bandOf(m.confirmedPct)] || ''),
    confirmedPct: m.confirmedPct, tentativePct: m.tentativePct, pendingPct: m.pendingPct, billablePct: m.billablePct,
    availablePct: m.availablePct, overPct: m.overPct, potentialPct: m.potentialPct, potentialOver: m.potentialOver,
    band: bandOf(m.confirmedPct), band_ar: BAND_AR[bandOf(m.confirmedPct)], nominalFte: m.nominalFte,
    capacity: { units: m.capacity.units, days: m.capacity.days, engagedDays: m.capacity.engagedDays, nominalPct: m.capacity.nominalPct,
      state: m.capacity.state, changedWithin: m.capacity.changedWithin },
    units: m.units,
  };
}
const shapeItem = (it) => ({
  key: it.key, kind: it.kind, targetId: it.targetId, label: it.label, pct: it.pct,
  status: it.status, status_ar: ALLOC_STATUS_AR[it.status] || it.status, billable: !!it.billable,
  role: it.role || null, role_ar: it.role ? roleLabel(it.role) : null,
  allocationId: it.allocationId || null, requestId: it.requestId || null, targetStatus: it.targetStatus || null,
});
// نسبة الفترة للطبقة المبدئية على نمط `periodFigures` نفسه (Σ وحدات ÷ Σ الطاقة) — قراءةٌ من
// وحدات النموذج لا معادلةٌ ثانية.
function tentativePctOf(months = []) {
  const live = months.filter((m) => m.state !== 'out');
  const cap = live.reduce((a, m) => a + m.units.capacity, 0);
  const ten = live.reduce((a, m) => a + m.units.tentative, 0);
  return cap > 0 ? Math.round((ten / cap) * 100) : null;
}

// ── حِمل المهام: من `task-load.js` وحده، والقاعدة تُقال في `basis_ar` ─────────────────────────
async function taskLoadOf(userId) {
  if (!userId) return { level: 'unmeasured', level_ar: TASK_LEVEL_AR.unmeasured, pct: 0, unsized: 0, open: 0, linked: false, basis_ar: NO_ACCOUNT_AR };
  const r = (await taskLoadFor([userId])).get(userId) || { pct: 0, unsized: 0, open: 0 };
  const level = r.open > 0 && r.pct === 0 && r.unsized > 0 ? 'unmeasured' : r.pct < 40 ? 'low' : r.pct <= 100 ? 'medium' : 'high';
  return { level, level_ar: TASK_LEVEL_AR[level], pct: r.pct, unsized: r.unsized, open: r.open, linked: true,
    basis_ar: `${TASK_LOAD_BASIS_AR} أقل من ٤٠٪ منخفض، حتى ١٠٠٪ متوسط، وفوقها مرتفع؛ ومهامٌ بلا نسبٍ مقدَّرة وحدها = غير مقاس.` };
}

// ── القادم: مهام الحساب المرتبط (الجارية بتعريف الحِمل الواحد) + معالم المشاريع المسكَّن عليها ──
// شرط «الجارية» من `openLoadSql` (task-load.js) وهو يضمّ حاجزَي قراءة المهام كليهما:
// `approvedTaskSql` (لا مهمة تنتظر اعتماداً) و`notPersonalSql` (لا مهمة شخصية تخرج من حساب
// صاحبها) — فلا يُعرض هنا عملٌ لم يوافق عليه أحد ولا دفترُ أحد.
async function upcomingFor(emp, userId, { days = null, limit = 5, today = riyadhDate() } = {}) {
  const horizon = days ? addDays(today, days) : null;
  const out = [];
  if (userId) {
    const tw = [openLoadSql('t.'), 't.assignee_user_id = ?', 't.due_date IS NOT NULL', 'substr(t.due_date,1,10) >= ?'];
    const tp = [userId, today];
    if (horizon) { tw.push('substr(t.due_date,1,10) <= ?'); tp.push(horizon); }
    for (const t of await all(`SELECT t.id, t.title, t.due_date, t.status, t.priority, t.project_id, t.opportunity_id,
          p.name_ar project_name, o.title_ar opportunity_name
        FROM task t
        LEFT JOIN project p ON p.id = t.project_id AND p.deleted_at IS NULL
        LEFT JOIN opportunity o ON o.id = t.opportunity_id AND o.deleted_at IS NULL
       WHERE ${tw.join(' AND ')} ORDER BY t.due_date, t.id LIMIT ?`, [...tp, limit])) {
      out.push({ id: t.id, kind: 'task', kind_ar: 'مهمة', title: t.title, due: day(t.due_date), status: t.status, status_ar: taskStatusLabel(t.status),
        priority: t.priority || null, priority_ar: t.priority ? taskPriorityLabel(t.priority) : null,
        work: t.project_name ? { kind: 'project', id: t.project_id, label: t.project_name } : t.opportunity_name ? { kind: 'opportunity', id: t.opportunity_id, label: t.opportunity_name } : null });
    }
  }
  const mw = ["ms.deleted_at IS NULL", "ms.status = 'PENDING'", 'ms.due_date IS NOT NULL', 'substr(ms.due_date,1,10) >= ?',
    `ms.project_id IN (SELECT a.project_id FROM allocation a WHERE a.employee_id = ? AND a.deleted_at IS NULL AND a.project_id IS NOT NULL AND a.year >= ?)`];
  const mp = [today, emp.id, Number(today.slice(0, 4))];
  if (horizon) { mw.push('substr(ms.due_date,1,10) <= ?'); mp.push(horizon); }
  for (const m of await all(`SELECT ms.id, ms.name_ar, ms.due_date, ms.status, ms.project_id, p.name_ar project_name
       FROM milestone ms JOIN project p ON p.id = ms.project_id AND p.deleted_at IS NULL
      WHERE ${mw.join(' AND ')} ORDER BY ms.due_date, ms.id LIMIT ?`, [...mp, limit])) {
    out.push({ id: m.id, kind: 'milestone', kind_ar: 'معلم', title: m.name_ar, due: day(m.due_date), status: m.status, status_ar: 'قادم',
      priority: null, priority_ar: null, work: { kind: 'project', id: m.project_id, label: m.project_name } });
  }
  out.sort((a, b) => String(a.due).localeCompare(String(b.due)) || a.kind.localeCompare(b.kind));
  return out.slice(0, limit);
}

// هل يفتح القارئ صفحة الشخص القائمة (`/app/person/:id`)? بوابة `personDossier` نفسها مختصرةً —
// كي لا يُعرض رابطٌ يُرَدّ عند الضغط.
function canOpenDossierFor(user, emp, userId) {
  if (!userId) return false;
  if (user.id === userId) return true;
  const { scope } = teamTasksAccess(user);
  if (!scope) return false;
  if (scope === 'company') return true;
  if (scope === 'department') return inDepartmentScope(user, emp.department_id);
  return !!emp.sector_id && emp.sector_id === user.sector_id;
}

// ═══ S02 — سجل الموارد ══════════════════════════════════════════════════════════════════════════
export async function listResources(user, opts = {}) {
  if (!canReadResources(user)) throw forbidden('عرض سجل الموارد يتطلب صلاحية قراءة الفريق — اطلب تفعيلها من مدير النظام');
  const today = riyadhDate();
  const { from, to, nowKey } = periodOf(opts);
  const scope = resourceScopeSql(user, 'e', opts.sector || null);
  const where = [scope.clause];
  const params = [...scope.params];
  // الفلاتر كلها خادمية وتضيّق داخل النطاق ولا توسّعه: إدارةٌ خارج نطاق القارئ تعود بلا صفوف.
  const dept = String(opts.department || '').trim();
  if (dept) { where.push('e.department_id = ?'); params.push(dept); }
  if (String(opts.type || '').trim()) { const c = resourceTypeClause(opts.type, 'e'); where.push(c.clause); params.push(...c.params); }
  if (String(opts.status || '').trim()) {
    const c = engagementClause(String(opts.status).trim().toLowerCase(), 'e', today, addDays(today, ENDING_HORIZON_DAYS));
    where.push(c.clause); params.push(...c.params);
  }
  // البحث: الاسم أو المسمّى أو مهارةٌ مسجَّلة (resource_capability kind=skill) — لا تصفية بعد القراءة.
  const term = String(opts.q || '').trim().replace(/[%_]/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  if (term) {
    const like = `%${term}%`;
    where.push(`(LOWER(e.name_ar) LIKE ? OR LOWER(COALESCE(e.name_en,'')) LIKE ? OR LOWER(COALESCE(e.job_title,'')) LIKE ?
      OR EXISTS (SELECT 1 FROM resource_capability rc WHERE rc.employee_id = e.id AND rc.deleted_at IS NULL AND rc.kind = 'skill' AND LOWER(rc.name_ar) LIKE ?))`);
    params.push(like, like, like, like);
  }
  const whereSql = where.join(' AND ');
  // العدّاد بنفس الشرط حرفاً — فالترقيم «1–6 من 6» من العدّ الفعلي لا من الصورة (C5).
  const total = N((await get(`SELECT COUNT(*) n FROM employee e WHERE ${whereSql}`, params))?.n);
  const pageSize = Math.min(Math.max(Number.parseInt(opts.pageSize, 10) || 25, 1), 200);
  const page = Math.max(Number.parseInt(opts.page, 10) || 1, 1);
  const rows = await all(`SELECT e.id, e.name_ar, e.name_en, e.job_title, e.employment_type, e.resource_type, e.vendor_name, e.engagement_ref,
         e.sector_id, e.department_id, e.hire_date, e.end_date, e.active, e.status, e.capacity_pct, e.user_id,
         s.name_ar sector_name, d.name_ar department_name, ${USER_ID_SQL('e')} linked_user_id
       FROM employee e
       LEFT JOIN sector s ON s.id = e.sector_id
       LEFT JOIN department d ON d.id = e.department_id
      WHERE ${whereSql}
      ORDER BY e.name_ar, e.id LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  const { figures } = await figuresFor(rows.map((r) => r.id), from, to);
  const out = rows.map((e) => {
    const f = figures.get(e.id);
    const p = f?.period;
    const util = p ? p.utilizationPct : null;
    const band = p && p.state !== 'out' ? bandOf(util) : 'out';
    return {
      id: e.id, name_ar: e.name_ar, name_en: e.name_en || null, job_title: e.job_title || null,
      resourceType: resourceTypeOf(e), resourceType_ar: RESOURCE_TYPE_AR[resourceTypeOf(e)], vendor_name: e.vendor_name || null,
      department_id: e.department_id || null, department_name: e.department_name || null,
      sector_id: e.sector_id || null, sector_name: e.sector_name || null,
      engagement: engagementOf(e, today),
      capacityPct: capacityPctOf(e),
      period: { from, to },
      availablePct: p ? p.availablePct : null,
      availability_ar: p && p.availablePct != null ? `${p.availablePct}٪ متاح` : BAND_AR.out,
      utilizationPct: util, band, band_ar: BAND_AR[band],
      overMonths: p ? p.overMonths : [],
      userId: e.linked_user_id || null,
    };
  });
  return { rows: out, total, page, pageSize, period: { from, to, nowKey }, basis_ar: BASIS_AR,
    filters: { q: term || null, sector: scope.sector || null, department: dept || null, type: opts.type || null, status: opts.status || null } };
}

// ═══ S03 — المعاينة الجانبية ═══════════════════════════════════════════════════════════════════
export async function resourcePreview(user, employeeId, opts = {}) {
  const emp = await loadReadableResource(user, employeeId);
  const today = riyadhDate();
  const { from, to, nowKey } = periodOf(opts);
  const [{ figures }, names, account] = await Promise.all([figuresFor([emp.id], from, to), orgNamesOf(emp), accountOf(emp)]);
  const f = figures.get(emp.id);
  const months = f?.months || [];
  const focus = months.find((m) => m.key === nowKey) || months[0] || null;
  const userId = account?.id || null;
  const [taskLoad, upcoming, planning, opps] = await Promise.all([
    taskLoadOf(userId), upcomingFor(emp, userId, { limit: 5, today }), planningRights(user, emp), openOpportunitiesOf(emp.id, today),
  ]);
  const working = (focus ? focus.items.map(shapeItem) : []).concat(opps.map((o) => ({
    key: 'mem:' + o.membership_id, kind: 'opportunity', targetId: o.id, label: o.title_ar, pct: Math.round(N(o.allocation_pct)),
    status: o.status === 'PENDING' ? 'pending' : 'confirmed', status_ar: o.status === 'PENDING' ? 'بانتظار تأكيد مديره' : 'مشاركة في فرصة',
    billable: false, role: o.role_in_group || 'member', role_ar: roleLabel(o.role_in_group), allocationId: null, requestId: null, targetStatus: o.stage_name || null,
  })));
  const period = f?.period || null;
  return {
    resource: shapeResource(emp, names, account, today),
    period: { from, to, nowKey, focus: focus?.key || null },
    figures: period ? {
      confirmedPct: period.utilizationPct, availablePct: period.availablePct, tentativePct: tentativePctOf(months),
      billablePct: period.billablePct, state: period.state,
      band: period.state === 'out' ? 'out' : bandOf(period.utilizationPct), band_ar: BAND_AR[period.state === 'out' ? 'out' : bandOf(period.utilizationPct)],
      maxOverPct: period.maxOverPct, overMonths: period.overMonths, engagedMonths: period.engagedMonths, outMonths: period.outMonths,
      month: focus ? shapeMonth(focus) : null,
    } : null,
    taskLoad, working, upcoming, userId, canOpenDossier: canOpenDossierFor(user, emp, userId), planning,
    rights: { edit: canEditResource(user, emp), self: isSelf(user, emp) },
    basis_ar: BASIS_AR, noMoney_ar: NO_MONEY_AR,
  };
}
// مشاركات الفرص المفتوحة (عضوية لا تسكيناً): بلا نسبةٍ لا تحجز طاقة (T05)، والمعلَّقة تُعرض
// معلَّمةً ولا تُحتسب. عنوان الفرصة يخرج لمن يرى المورد — بلا قيمتها (قاعدة ②).
async function openOpportunitiesOf(employeeId, today) {
  return await all(`SELECT m.id membership_id, m.role_in_group, m.allocation_pct, COALESCE(m.status,'ACTIVE') status, m.start_date, m.end_date,
        o.id, o.title_ar, o.code, st.name_ar stage_name
      FROM membership m JOIN opportunity o ON o.id = m.group_id AND o.deleted_at IS NULL
      LEFT JOIN stage st ON st.id = o.stage_id
     WHERE m.group_kind = 'opportunity' AND m.employee_id = ? AND m.deleted_at IS NULL
       AND COALESCE(st.is_won,0) = 0 AND COALESCE(st.is_lost,0) = 0
       AND (m.end_date IS NULL OR substr(m.end_date,1,10) >= ?)
     ORDER BY o.title_ar`, [employeeId, today]);
}

// ═══ S04 — ملف المورد: نظرة عامة ═══════════════════════════════════════════════════════════════
export async function resourceProfile(user, employeeId, opts = {}) {
  const emp = await loadReadableResource(user, employeeId);
  const today = riyadhDate();
  const { year, month, key } = monthOf(opts);
  const [{ figures }, names, account] = await Promise.all([figuresFor([emp.id], key, key), orgNamesOf(emp), accountOf(emp)]);
  const m = figures.get(emp.id)?.months?.[0] || null;
  const userId = account?.id || null;
  const [taskLoad, upcoming30, planning, capCounts, work, lastAudit] = await Promise.all([
    taskLoadOf(userId), upcomingFor(emp, userId, { days: 30, limit: 20, today }), planningRights(user, emp),
    all('SELECT kind, COUNT(*) n FROM resource_capability WHERE employee_id = ? AND deleted_at IS NULL GROUP BY kind', [emp.id]),
    linkedWorkOf(emp, 'current', today),
    get(`SELECT at, user_id, username FROM audit_log WHERE resource = 'employee' AND resource_id = ? ORDER BY at DESC LIMIT 1`, [emp.id]),
  ]);
  const counts = Object.fromEntries(capCounts.map((r) => [r.kind, N(r.n)]));
  const actorName = lastAudit?.user_id ? (await namesByIds([lastAudit.user_id])).get(lastAudit.user_id) || lastAudit.username || null : null;
  const canDossier = canOpenDossierFor(user, emp, userId);
  const tabs = {
    overview: { label_ar: 'نظرة عامة', enabled: true },
    work: { label_ar: 'العمل المرتبط', enabled: true, count: work.rows.length },
    tasks: { label_ar: 'المهام', enabled: !!userId, linked: !!userId, dossier: canDossier, href: userId ? `/app/person/${userId}` : null,
      note_ar: userId ? null : NO_ACCOUNT_AR },
    skills: { label_ar: 'القدرات والتطور', enabled: true, count: (counts.skill || 0) + (counts.experience || 0) + (counts.goal || 0) },
    engagement: { label_ar: 'الارتباط والطاقة', enabled: true },
    audit: { label_ar: 'سجل التغييرات', enabled: true },
  };
  const out = {
    resource: shapeResource(emp, names, account, today),
    month: { key, year, month, label_ar: monthLabelAr(key), isCurrent: key === keyOf(today) },
    figures: m ? shapeMonth(m) : null,
    distribution: m ? m.items.map(shapeItem) : [],
    upcoming30, taskLoad,
    meta: {
      lastUpdatedAt: [emp.updated_at, lastAudit?.at].filter(Boolean).sort().pop() || emp.created_at || null,
      lastUpdatedBy: actorName,
    },
    tabs,
    rights: { edit: canEditResource(user, emp), planning, self: isSelf(user, emp) },
    basis_ar: BASIS_AR, noMoney_ar: NO_MONEY_AR,
  };
  // تبويب المهام يُقرأ من ملف الشخص القائم (`personDossier`) لا من نسخةٍ ثانية — عند طلبه فقط.
  if (String(opts.tab || '') === 'tasks') out.tasks = await resourceTasks(user, emp.id, { emp, account });
  return out;
}

// ═══ S06 — المهام: ملف الشخص القائم لمن له حساب (لا استنساخ لمنطق المهام) ════════════════════
export async function resourceTasks(user, employeeId, { emp = null, account = undefined } = {}) {
  const e = emp || await loadReadableResource(user, employeeId);
  const acc = account === undefined ? await accountOf(e) : account;
  const userId = acc?.id || null;
  const taskLoad = await taskLoadOf(userId);
  const limits_ar = ['لا مشاركون متعددون على المهمة — مسؤولٌ واحد', 'لا قائمة تحقق ولا جهد تقديري على المهمة'];
  if (!userId) return { linked: false, available: false, userId: null, note_ar: NO_ACCOUNT_AR, tasks: [], stats: null, taskLoad, limits_ar };
  try {
    const d = await personDossier(user, userId);
    return {
      linked: true, available: true, userId, href: `/app/person/${userId}`,
      tasks: (d.tasks || []).map((t) => ({
        id: t.id, title: t.title, status: t.status, status_ar: taskStatusLabel(t.status), priority: t.priority || null,
        priority_ar: t.priority ? taskPriorityLabel(t.priority) : null, due_date: day(t.due_date) || null, next_step: t.next_step || null,
        blocked_reason: t.blocked_reason || null, progress_pct: t.progress_pct == null ? null : Math.round(N(t.progress_pct)),
        pending: isPendingTask(t), department_name: t.department_name || null,
        work: t.project_id ? { kind: 'project', id: t.project_id, label: t.project_name } : t.opportunity_id ? { kind: 'opportunity', id: t.opportunity_id, label: t.opportunity_name } : null,
      })),
      stats: d.stats || null, today: d.today, taskLoad, basis_ar: TASK_LOAD_BASIS_AR, limits_ar,
    };
  } catch (err) {
    // ملف الشخص له بوابته (قراءة مهام إدارة/قطاع): من يرى المورد ولا يقرأ مهامه يُقال له ذلك
    // صراحةً — لا قائمة فارغة توهم بأن لا مهام.
    if (err?.status === 403) return { linked: true, available: false, userId, note_ar: err.message, tasks: [], stats: null, taskLoad, limits_ar };
    throw err;
  }
}

// ═══ S05 — العمل المرتبط ═══════════════════════════════════════════════════════════════════════
export async function linkedWork(user, employeeId, opts = {}) {
  const emp = await loadReadableResource(user, employeeId);
  const window = String(opts.window || 'current').toLowerCase();
  if (!['current', 'past', 'all'].includes(window)) throw badRequest('نافذة العمل: «الحالي» أو «السابق» أو «الكل»');
  return await linkedWorkOf(emp, window, riyadhDate());
}
const parseMj = (s) => { try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
// كل عملٍ مرةً واحدة: التسكينات (مشروع/بند) على كل السنوات تُدمج بوجهتها، وعضويات المشاريع
// والفرص تُضاف بلا نسبةٍ إن لم يكن لها تسكين. الأسماء والحالات والفترات — بلا مال.
async function linkedWorkOf(emp, window, today) {
  const nowKey = keyOf(today);
  const [allocs, mems] = await Promise.all([
    all(`SELECT id, project_id, project_name, work_bucket, type, monthly_json, year, status, billable FROM allocation
          WHERE employee_id = ? AND deleted_at IS NULL ORDER BY year, id`, [emp.id]),
    all(`SELECT id, group_kind, group_id, role_in_group, allocation_pct, start_date, end_date, COALESCE(status,'ACTIVE') status FROM membership
          WHERE employee_id = ? AND deleted_at IS NULL AND group_kind IN ('project','opportunity') ORDER BY created_at, id`, [emp.id]),
  ]);
  const pids = [...new Set(allocs.map((a) => a.project_id).concat(mems.filter((m) => m.group_kind === 'project').map((m) => m.group_id)).filter(Boolean))];
  const oids = [...new Set(mems.filter((m) => m.group_kind === 'opportunity').map((m) => m.group_id))];
  const projects = new Map(); const opps = new Map();
  if (pids.length) {
    for (const p of await all(`SELECT p.id, p.name_ar, p.code, p.status, p.kind, p.start_date, p.end_date, p.department_id, p.sector_id,
          d.name_ar department_name, c.name_ar client_name
        FROM project p LEFT JOIN department d ON d.id = p.department_id LEFT JOIN client c ON c.id = p.client_id
       WHERE p.deleted_at IS NULL AND p.id IN (${ph(pids)})`, pids)) projects.set(p.id, p);
  }
  if (oids.length) {
    for (const o of await all(`SELECT o.id, o.title_ar, o.code, o.department_id, o.sector_id, st.name_ar stage_name,
          COALESCE(st.is_won,0) is_won, COALESCE(st.is_lost,0) is_lost, c.name_ar client_name
        FROM opportunity o LEFT JOIN stage st ON st.id = o.stage_id LEFT JOIN client c ON c.id = o.client_id
       WHERE o.deleted_at IS NULL AND o.id IN (${ph(oids)})`, oids)) opps.set(o.id, o);
  }
  const entries = new Map();
  const entryFor = (key, init) => { if (!entries.has(key)) entries.set(key, init()); return entries.get(key); };
  const projectEntry = (p) => ({
    kind: 'project', id: p.id, label: p.name_ar, code: p.code || null,
    work: { status: p.status || null, status_ar: projectStatusLabel(p.status), department_name: p.department_name || null,
      client_name: p.client_name || null, start_date: day(p.start_date) || null, end_date: day(p.end_date) || null },
    role: null, monthMap: new Map(), allocationIds: [], statuses: new Set(), billable: null, membership: null,
  });
  for (const a of allocs) {
    let e;
    if (a.project_id) { const p = projects.get(a.project_id); if (!p) continue; e = entryFor('project:' + p.id, () => projectEntry(p)); }
    else if (a.work_bucket) {
      e = entryFor('bucket:' + a.work_bucket, () => ({ kind: 'bucket', id: a.work_bucket, label: workBucketLabel(a.work_bucket) || a.project_name || 'بند داخلي', code: null,
        work: { status: null, status_ar: 'بند داخلي مستمر', department_name: null, client_name: null, start_date: null, end_date: null },
        role: null, monthMap: new Map(), allocationIds: [], statuses: new Set(), billable: false, membership: null }));
    } else continue;
    const st = String(a.status || '').toLowerCase() === 'tentative' ? 'tentative' : 'confirmed';
    e.role = e.role || a.type || 'member';
    e.allocationIds.push(a.id); e.statuses.add(st);
    if (e.billable == null) e.billable = billableOf(a, projects);
    const mj = parseMj(a.monthly_json);
    for (let m = 1; m <= 12; m++) {
      const pct = monthPctOf(mj, m); if (!pct) continue;
      const k = monthKey(Number(a.year), m);
      const cur = e.monthMap.get(k) || { key: k, pct: 0, statuses: new Set() };
      cur.pct += pct; cur.statuses.add(st); e.monthMap.set(k, cur);
    }
  }
  for (const m of mems) {
    if (m.group_kind === 'project') {
      const p = projects.get(m.group_id); if (!p) continue;
      const e = entryFor('project:' + p.id, () => projectEntry(p));
      e.role = e.role || m.role_in_group || 'member';
      e.membership = { id: m.id, role: m.role_in_group || 'member', role_ar: roleLabel(m.role_in_group), pct: Math.round(N(m.allocation_pct)),
        status: m.status === 'PENDING' ? 'pending' : 'active', status_ar: m.status === 'PENDING' ? 'بانتظار تأكيد مديره' : 'عضوية مؤكدة',
        start_date: day(m.start_date) || null, end_date: day(m.end_date) || null };
    } else {
      const o = opps.get(m.group_id); if (!o) continue;
      const e = entryFor('opportunity:' + o.id, () => ({ kind: 'opportunity', id: o.id, label: o.title_ar, code: o.code || null,
        work: { status: Number(o.is_won) ? 'won' : Number(o.is_lost) ? 'lost' : 'open', status_ar: o.stage_name || (Number(o.is_won) ? 'مكسوبة' : Number(o.is_lost) ? 'خاسرة' : 'مفتوحة'),
          department_name: null, client_name: o.client_name || null, start_date: null, end_date: null, open: !Number(o.is_won) && !Number(o.is_lost) },
        role: m.role_in_group || 'member', monthMap: new Map(), allocationIds: [], statuses: new Set(), billable: null, membership: null }));
      e.membership = { id: m.id, role: m.role_in_group || 'member', role_ar: roleLabel(m.role_in_group), pct: Math.round(N(m.allocation_pct)),
        status: m.status === 'PENDING' ? 'pending' : 'active', status_ar: m.status === 'PENDING' ? 'بانتظار تأكيد مديره' : 'مشاركة مؤكدة',
        start_date: day(m.start_date) || null, end_date: day(m.end_date) || null };
    }
  }
  const rows = [];
  for (const e of entries.values()) {
    const months = [...e.monthMap.values()].sort((a, b) => a.key.localeCompare(b.key))
      .map((x) => ({ key: x.key, pct: x.pct, status: x.statuses.size > 1 ? 'mixed' : [...x.statuses][0] }));
    const hasAlloc = months.length > 0;
    const allocCurrent = months.some((x) => x.key >= nowKey);
    let current;
    if (e.kind === 'opportunity') current = e.work.open && (!e.membership?.end_date || e.membership.end_date >= today);
    else if (hasAlloc) current = allocCurrent;
    else current = !['COMPLETED', 'CANCELLED'].includes(String(e.work.status || '').toUpperCase()) && (!e.membership?.end_date || e.membership.end_date >= today);
    if (window === 'current' && !current) continue;
    if (window === 'past' && current) continue;
    const status = e.statuses.size > 1 ? 'mixed' : ([...e.statuses][0] || null);
    const nowMonth = months.find((x) => x.key === nowKey);
    rows.push({
      key: `${e.kind}:${e.id}`, kind: e.kind, kind_ar: e.kind === 'project' ? 'مشروع' : e.kind === 'bucket' ? 'بند داخلي' : 'فرصة',
      id: e.id, label: e.label, code: e.code, role: e.role || 'member', role_ar: roleLabel(e.role),
      work: e.work,
      period: hasAlloc ? { from: months[0].key, to: months[months.length - 1].key }
        : { from: e.membership?.start_date ? keyOf(e.membership.start_date) : null, to: e.membership?.end_date ? keyOf(e.membership.end_date) : null },
      current, currentPct: nowMonth ? nowMonth.pct : 0, peakPct: months.reduce((a, x) => Math.max(a, x.pct), 0),
      allocation: hasAlloc ? { ids: e.allocationIds, status, status_ar: ALLOC_STATUS_AR[status] || status, billable: !!e.billable, months } : null,
      membership: e.membership,
    });
  }
  rows.sort((a, b) => (b.currentPct - a.currentPct) || String(b.period.to || '').localeCompare(String(a.period.to || '')) || String(a.label).localeCompare(String(b.label), 'ar'));
  return { window, asOf: nowKey, rows, count: rows.length, basis_ar: NO_MONEY_AR };
}

// ═══ S07 — القدرات والخبرات وأهداف التطوير ═════════════════════════════════════════════════════
function shapeCapability(row, names) {
  const kind = row.kind;
  return {
    id: row.id, kind, kind_ar: CAPABILITY_KIND_AR[kind] || kind, name_ar: row.name_ar,
    level: row.level || null, level_ar: kind === 'skill' ? (SKILL_LEVEL_AR[row.level] || null) : null,
    evidence: row.evidence_kind || row.evidence_label ? { kind: row.evidence_kind || 'note', kind_ar: EVIDENCE_KIND_AR[row.evidence_kind] || EVIDENCE_KIND_AR.note,
      ref: row.evidence_ref || null, label: row.evidence_label || null } : null,
    period: kind === 'experience' ? { from: day(row.period_from) || null, to: day(row.period_to) || null } : null,
    target_date: kind === 'goal' ? (day(row.target_date) || null) : null,
    status: kind === 'goal' ? (row.status || 'planned') : null, status_ar: kind === 'goal' ? (GOAL_STATUS_AR[row.status || 'planned'] || null) : null,
    source: row.source || 'self', source_ar: SOURCE_AR[row.source || 'self'] || SOURCE_AR.self,
    reviewed: !!row.reviewed_by, reviewed_by: row.reviewed_by || null, reviewed_by_name: row.reviewed_by ? names.get(row.reviewed_by) || null : null,
    reviewed_at: row.reviewed_at || null, note: row.note || null, created_at: row.created_at, updated_at: row.updated_at || null,
  };
}
export async function resourceCapabilities(user, employeeId) {
  const emp = await loadReadableResource(user, employeeId);
  const rows = await all(`SELECT * FROM resource_capability WHERE employee_id = ? AND deleted_at IS NULL
      ORDER BY kind, COALESCE(reviewed_at, created_at) DESC, id`, [emp.id]);
  const names = await namesByIds(rows.map((r) => r.reviewed_by).filter(Boolean));
  const shaped = rows.map((r) => shapeCapability(r, names));
  return {
    skills: shaped.filter((r) => r.kind === 'skill'),
    experiences: shaped.filter((r) => r.kind === 'experience'),
    goals: shaped.filter((r) => r.kind === 'goal'),
    rights: await capabilityRights(user, emp),
    legend_ar: { self: SOURCE_AR.self, manager: SOURCE_AR.manager },
  };
}
// من يكتب: صاحب الملف (ذاتياً)، ومن يملك أمره (مدير إدارته/قطاعه)، ومن يعدّل صفّه (الموارد
// البشرية). والمراجعة صفةُ الكاتب لا خانة: ما كتبه المدير أو الموارد البشرية مراجَع.
// والكتابة على غير الملف الذاتي لا تتسع أبداً عن القراءة: `ownsEmployee` يعدّ الانتماء إلى
// الإدارة تملّكاً (مجموعة إدارات القارئ = ما يقوده ∪ إدارته)، فزميلٌ في الإدارة نفسها بلا منح
// قراءة الموظفين كان يمرّ منه — فيُشترط أولاً أن يكون المورد داخل نطاق قراءته.
async function capabilityRights(user, emp) {
  const self = isSelf(user, emp);
  const reads = !self && resourceInScope(user, emp);
  const reviewer = reads && (user.role_id === 'hr' || canEditResource(user, emp) || leadsResource(user, emp));
  return { write: self || reviewer, review: reviewer, self };
}
export async function upsertCapability(ctx, employeeId, data = {}) {
  const user = ctx.user;
  const emp = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw notFound('المورد غير موجود — قد يكون سجله حُذف');
  const rights = await capabilityRights(user, emp);
  if (!rights.write) throw forbidden('تسجيل القدرات لصاحب الملف أو لمن يدير إدارته أو قطاعه أو الموارد البشرية');
  const kind = String(data.kind || '').trim().toLowerCase();
  if (!CAPABILITY_KINDS.includes(kind)) throw badRequest('نوع السجل: مهارة أو خبرة أو هدف تطوير');
  const name = normText(data.name_ar, 120);
  if (!name) throw badRequest(`اكتب اسم ${CAPABILITY_KIND_AR[kind]}`);
  const row = {
    kind, name_ar: name, level: null, evidence_kind: null, evidence_ref: null, evidence_label: null,
    period_from: null, period_to: null, target_date: null, status: null, note: normText(data.note, 500),
  };
  if (kind === 'skill' && normText(data.level)) {
    const lv = String(data.level).trim().toLowerCase();
    if (!SKILL_LEVELS.includes(lv)) throw badRequest('مستوى المهارة: مبتدئ أو ممارس أو متقدم أو خبير');
    row.level = lv;
  }
  if (kind === 'experience') {
    row.period_from = normIsoDate(data.period_from, 'بداية الخبرة');
    row.period_to = normIsoDate(data.period_to, 'نهاية الخبرة');
    if (row.period_from && row.period_to && row.period_to < row.period_from) throw badRequest('نهاية الخبرة أسبق من بدايتها — صحّح أحد التاريخين');
  }
  if (kind === 'goal') {
    row.target_date = normIsoDate(data.target_date, 'موعد الهدف');
    const st = String(data.status || 'planned').trim().toLowerCase();
    if (!GOAL_STATUSES.includes(st)) throw badRequest('حالة الهدف: مخطَّط أو قيد التنفيذ أو تحقّق');
    row.status = st;
  }
  if (normText(data.evidence_kind) || normText(data.evidence_label) || normText(data.evidence_ref)) {
    const ek = String(data.evidence_kind || 'note').trim().toLowerCase();
    if (!EVIDENCE_KINDS.includes(ek)) throw badRequest('الشاهد: مشروع أو بند داخلي أو مستند أو ملاحظة');
    row.evidence_kind = ek; row.evidence_ref = normText(data.evidence_ref, 120); row.evidence_label = normText(data.evidence_label, 200);
    // الشاهد مرجعٌ إلى سجلٍّ أصلي: المشروع يُتحقق من وجوده ويُقرأ اسمه، والبند من قائمته الثابتة.
    if (ek === 'project') {
      if (!row.evidence_ref) throw badRequest('اختر المشروع الشاهد');
      const p = await get('SELECT id, name_ar FROM project WHERE id = ? AND deleted_at IS NULL', [row.evidence_ref]);
      if (!p) throw badRequest('المشروع الشاهد غير موجود — اختره من القائمة');
      row.evidence_label = row.evidence_label || p.name_ar;
    } else if (ek === 'bucket') {
      if (!WORK_BUCKETS.includes(String(row.evidence_ref || ''))) throw badRequest('اختر بند العمل الداخلي من القائمة');
      row.evidence_label = row.evidence_label || workBucketLabel(row.evidence_ref);
    } else if (!row.evidence_label) throw badRequest('اكتب وصف الشاهد');
  }
  const at = nowIso();
  // الكاتب يحدّد الصفة: صاحب الملف = تقييم ذاتي بلا مراجعة (وتعديله لمراجَعٍ يُسقط مراجعته لأن
  // المحتوى تغيّر)؛ والمدير/الموارد البشرية = مراجَع باسمه وتاريخه.
  if (rights.self) { row.source = 'self'; row.reviewed_by = null; row.reviewed_at = null; }
  else { row.source = 'manager'; row.reviewed_by = user.id; row.reviewed_at = at; }
  const existingId = normText(data.id, 80);
  return await tx(async () => {
    let capId; let before = null;
    if (existingId) {
      const ex = await get('SELECT * FROM resource_capability WHERE id = ? AND employee_id = ? AND deleted_at IS NULL', [existingId, emp.id]);
      if (!ex) throw notFound('السجل غير موجود لهذا المورد — حدّث الصفحة ثم أعد المحاولة');
      if (ex.kind !== kind) throw badRequest('لا يتغيّر نوع السجل — أضف سجلاً جديداً بدل تحويله');
      capId = ex.id; before = capSnapshot(ex);
      await update('resource_capability', capId, { ...row, updated_at: at });
    } else {
      capId = id('cap');
      await insert('resource_capability', { id: capId, employee_id: emp.id, ...row, created_by: user.id, created_at: at });
    }
    const saved = await get('SELECT * FROM resource_capability WHERE id = ?', [capId]);
    await audit(ctx, { action: before ? 'update' : 'create', resource: 'resource_capability', resourceId: capId, sectorId: emp.sector_id,
      detail: { employee_id: emp.id, kind, before, after: capSnapshot(saved), source: row.source } });
    return shapeCapability(saved, await namesByIds([saved.reviewed_by].filter(Boolean)));
  });
}
const capSnapshot = (r) => ({ name_ar: r.name_ar, level: r.level, evidence_kind: r.evidence_kind, evidence_ref: r.evidence_ref, evidence_label: r.evidence_label,
  period_from: r.period_from, period_to: r.period_to, target_date: r.target_date, status: r.status, source: r.source, reviewed_by: r.reviewed_by, note: r.note });
export async function removeCapability(ctx, employeeId, capId) {
  const user = ctx.user;
  const emp = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw notFound('المورد غير موجود — قد يكون سجله حُذف');
  const rights = await capabilityRights(user, emp);
  if (!rights.write) throw forbidden('حذف القدرات لصاحب الملف أو لمن يدير إدارته أو قطاعه أو الموارد البشرية');
  const row = await get('SELECT * FROM resource_capability WHERE id = ? AND employee_id = ? AND deleted_at IS NULL', [String(capId || ''), emp.id]);
  if (!row) throw notFound('السجل غير موجود لهذا المورد — قد يكون حُذف من قبل');
  // ما راجعه المدير لا يمحوه صاحب الملف بيده: التقييم الذاتي وحده يُحذف ذاتياً.
  if (rights.self && !rights.review && row.source === 'manager') throw forbidden('هذا السجل راجعه مديرك — اطلب منه تعديله أو حذفه');
  const at = nowIso();
  await tx(async () => {
    await update('resource_capability', row.id, { deleted_at: at, updated_at: at });
    await audit(ctx, { action: 'delete', resource: 'resource_capability', resourceId: row.id, sectorId: emp.sector_id,
      detail: { employee_id: emp.id, kind: row.kind, before: capSnapshot(row), after: null } });
  });
  return { ok: true, id: row.id };
}

// ═══ S08 — الارتباط والطاقة ═════════════════════════════════════════════════════════════════════
export async function engagement(user, employeeId) {
  const emp = await loadReadableResource(user, employeeId);
  const today = riyadhDate();
  const [names, account, versions] = await Promise.all([
    orgNamesOf(emp), accountOf(emp),
    all('SELECT * FROM capacity_version WHERE employee_id = ? ORDER BY effective_from, created_at', [emp.id]),
  ]);
  const people = await namesByIds([names.manager_user_id, ...versions.map((v) => v.created_by)].filter(Boolean));
  const type = resourceTypeOf(emp);
  const currentPct = capacityOnDay(emp, today, versions);
  // فترات الطاقة: كل إصدارٍ يسري حتى اليوم السابق للإصدار التالي؛ وبلا إصداراتٍ تُقرأ طاقة الصف.
  const changes = versions.length
    ? versions.map((v, i) => ({ from: day(v.effective_from), to: versions[i + 1] ? addDays(day(versions[i + 1].effective_from), -1) : null,
      pct: Number(v.capacity_pct), current: day(v.effective_from) <= today && (!versions[i + 1] || day(versions[i + 1].effective_from) > today) }))
    : [{ from: day(emp.hire_date) || null, to: null, pct: capacityPctOf(emp), current: true }];
  return {
    resource: { id: emp.id, name_ar: emp.name_ar },
    type, type_ar: RESOURCE_TYPE_AR[type], vendor: emp.vendor_name || null, ref: emp.engagement_ref || null,
    employment_type: emp.employment_type || null,
    hire_date: day(emp.hire_date) || null, end_date: day(emp.end_date) || null,
    status: engagementStatus(emp, today), status_ar: ENGAGEMENT_STATUS_AR[engagementStatus(emp, today)],
    manager: names.manager_user_id ? { userId: names.manager_user_id, name: people.get(names.manager_user_id) || null } : null,
    department_name: names.department_name || null, sector_name: names.sector_name || null,
    account: account ? { linked: true, active: Number(account.active) === 1, userId: account.id, username: account.username || null, name: account.name_ar || null }
      : { linked: false, active: false, userId: null, username: null, name: null },
    capacity: {
      currentPct, basis_ar: 'وفق الطاقة التعاقدية المسجلة — ١٠٠ دوام كامل، والشهر الذي تتغيّر فيه يُوزَن بالأيام',
      versions: versions.map((v) => ({ id: v.id, effective_from: day(v.effective_from), capacity_pct: Number(v.capacity_pct), note: v.note || null,
        created_by: v.created_by || null, created_by_name: v.created_by ? people.get(v.created_by) || null : null, created_at: v.created_at })),
      changes,
    },
    rights: { edit: canEditResource(user, emp) },
    limits_ar: ['ارتباطٌ واحد سارٍ لكل مورد (لا سجل ارتباطات متعددة)', 'لا تقويم عطل ولا إجازات — المتاح وفق الطاقة التعاقدية المسجلة'],
  };
}

// «تحفظ بإصدارات مؤرخة، لا تستبدل التاريخ بصمت» (§5). الإصدار يُكتب بتاريخ سريانه، وقيمة الصف
// (`employee.capacity_pct`) تبقى **السارية اليوم** لأن كل حساب طاقةٍ قائم يقرؤها.
//
// ── وأول إصدارٍ يحتاج قاعدةً قبله ──────────────────────────────────────────────────────────
// النموذج يقرأ ما قبل أول إصدارٍ بقيمة أول إصدار (استمرارية معلنة). فلو كُتب أول إصدارٍ بتاريخٍ
// مستقبلي وحده لقرأ الحاضرُ القيمةَ الجديدة قبل أوانها، ولو كُتب بتاريخٍ ماضٍ لأُعيدت كتابة
// الأشهر التي سبقته. فيُكتب معه — مرةً واحدة — إصدارُ قاعدةٍ يسجّل القيمة السارية قبله من تاريخ
// التعيين (أو بداية السنة الجارية إن غاب): فلا يتغيّر الحاضر ولا الماضي إلا بما طُلب.
export async function setCapacity(ctx, employeeId, { capacity_pct, effective_from, note } = {}) {
  const user = ctx.user;
  const emp = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw notFound('المورد غير موجود — قد يكون سجله حُذف');
  if (!canEditResource(user, emp)) throw forbidden('تعديل الطاقة التعاقدية يتطلب صلاحية تعديل الموظف على قطاعه');
  const pct = normCapacityPct(capacity_pct);
  const from = normIsoDate(effective_from, 'تاريخ سريان الطاقة', { required: true });
  const hire = day(emp.hire_date);
  if (hire && from < hire) throw badRequest(`تاريخ السريان ${from} أسبق من تاريخ التعيين ${hire} — صحّح التاريخ أو عدّل تاريخ التعيين أولاً`);
  const today = riyadhDate();
  const startKey = [keyOf(today), keyOf(from)].sort().pop();
  const endKey = addMonths(startKey, 5);
  const beforeMonths = (await figuresFor([emp.id], startKey, endKey, { includePending: false })).figures.get(emp.id)?.months || [];
  const pickFig = (m) => ({ key: m.key, label_ar: monthLabelAr(m.key), state: m.state, capacityUnits: m.units.capacity, nominalPct: m.capacity.nominalPct,
    confirmedPct: m.confirmedPct, availablePct: m.availablePct, overPct: m.overPct });
  const result = await tx(async () => {
    const at = nowIso();
    const existing = await all('SELECT * FROM capacity_version WHERE employee_id = ? ORDER BY effective_from, created_at', [emp.id]);
    const effectiveBefore = capacityOnDay(emp, today, existing);
    const prev = existing.filter((v) => day(v.effective_from) <= today).pop() || null;
    let baselineId = null;
    if (!existing.length) {
      const baseFrom = hire || `${today.slice(0, 4)}-01-01`;
      if (from > baseFrom) {
        baselineId = id('capv');
        await insert('capacity_version', { id: baselineId, employee_id: emp.id, effective_from: baseFrom, capacity_pct: capacityPctOf(emp),
          note: 'القيمة السارية قبل أول تغيير مسجَّل', created_by: user.id, created_at: at });
      }
    }
    const same = existing.find((v) => day(v.effective_from) === from);
    let vid;
    if (same) { vid = same.id; await update('capacity_version', vid, { capacity_pct: pct, note: normText(note, 300), created_by: user.id, created_at: at }); }
    else { vid = id('capv'); await insert('capacity_version', { id: vid, employee_id: emp.id, effective_from: from, capacity_pct: pct, note: normText(note, 300), created_by: user.id, created_at: at }); }
    const versions = await all('SELECT * FROM capacity_version WHERE employee_id = ? ORDER BY effective_from, created_at', [emp.id]);
    const effectiveNow = capacityOnDay(emp, today, versions);
    if (effectiveNow !== Number(emp.capacity_pct)) await update('employee', emp.id, { capacity_pct: effectiveNow, updated_at: at });
    const applied = from <= today && versions.filter((v) => day(v.effective_from) <= today).pop()?.id === vid;
    await audit(ctx, { action: same ? 'update' : 'create', resource: 'capacity_version', resourceId: vid, sectorId: emp.sector_id, detail: {
      employee_id: emp.id,
      before: { capacity_pct: effectiveBefore, effective_from: prev ? day(prev.effective_from) : (hire || null) },
      after: { capacity_pct: pct, effective_from: from },
      reason: normText(note, 300), applied, baseline_version_id: baselineId, employee_capacity_pct: effectiveNow,
    } });
    return { vid, applied, effectiveNow };
  });
  const afterMonths = (await figuresFor([emp.id], startKey, endKey, { includePending: false })).figures.get(emp.id)?.months || [];
  const version = await get('SELECT * FROM capacity_version WHERE id = ?', [result.vid]);
  return {
    version: { id: version.id, effective_from: day(version.effective_from), capacity_pct: Number(version.capacity_pct), note: version.note || null },
    capacityPct: result.effectiveNow, applied: result.applied,
    applied_ar: result.applied ? 'سارٍ من اليوم' : from > today ? `يسري من ${from} — الحاضر كما هو` : 'إصدارٌ سابق — القيمة السارية من إصدارٍ أحدث',
    effect: { from: startKey, to: endKey, months: afterMonths.map((m, i) => ({ key: m.key, label_ar: monthLabelAr(m.key), before: beforeMonths[i] ? pickFig(beforeMonths[i]) : null, after: pickFig(m) })) },
  };
}

// ═══ S09 — نموذج المورد: إنشاء وتعديل فوق خدمة الموظف القائمة ═══════════════════════════════════
const BASE_FIELDS = ['name_ar', 'name_en', 'job_title', 'employment_type', 'status', 'sector_id', 'department_id', 'position_id', 'hire_date', 'end_date', 'active', 'link_user_id'];
const EMPLOYMENT_TYPES = ['أساسي', 'موسمي', 'متعاقد'];
const defaultEmploymentType = (type) => (type === 'internal' ? 'أساسي' : 'متعاقد');
function normEmploymentType(v, type) {
  if (v == null || String(v).trim() === '') return defaultEmploymentType(type);
  const s = String(v).trim();
  if (!EMPLOYMENT_TYPES.includes(s)) throw badRequest('نوع التوظيف: أساسي أو موسمي أو متعاقد');
  return s;
}
// الإدارة تسكن قطاعاً بعينه (قاعدة org.js) — تُفحص هنا أيضاً لأن إنشاء الموظف القائم لا يفحصها.
async function assertDepartmentInSector(depId, secId) {
  if (!depId) return;
  const dep = await get('SELECT id, sector_id, name_ar FROM department WHERE id = ? AND deleted_at IS NULL', [depId]);
  if (!dep) throw badRequest('الإدارة المختارة غير موجودة');
  if (secId && dep.sector_id !== secId) throw badRequest(`إدارة «${dep.name_ar}» ليست تحت القطاع المختار — اختر إدارةً من القطاع نفسه`);
}
// تشابه الاسم تحذيرٌ لا منع (التطابق تمنعه `assertNameFree` في خدمة الموظف): مورد ثانٍ باسمٍ
// قريب غالباً هو الشخص نفسه مكتوباً بصيغةٍ أخرى — يُقال قبل الحفظ ولا يُدمج تلقائياً.
// والمسح داخل نطاق الكاتب وحده: تحذيرٌ يسمّي موظفي قطاعٍ آخر كان يُعدّد الشركة كلها لمن لا يقرؤها.
export async function similarNames(name, excludeId = null, user = null) {
  const want = normName(name);
  if (!want) return [];
  const tokens = want.split(' ').filter((t) => t.length > 1);
  const out = [];
  const scope = user ? resourceScopeSql(user, 'e') : { clause: 'e.deleted_at IS NULL', params: [] };
  for (const r of await all(`SELECT e.id, e.name_ar FROM employee e WHERE ${scope.clause} ORDER BY e.name_ar`, scope.params)) {
    if (r.id === excludeId) continue;
    const have = normName(r.name_ar);
    if (!have || have === want) continue;
    const ht = have.split(' ');
    const shared = tokens.filter((t) => ht.includes(t)).length;
    const similar = (tokens.length >= 2 && shared >= 2) || have.includes(want) || want.includes(have)
      || (tokens.length >= 2 && ht.length >= 2 && tokens[0] === ht[0] && tokens[tokens.length - 1] === ht[ht.length - 1]);
    if (similar) out.push(`يوجد مورد باسم قريب: «${r.name_ar}» — تأكد أنه ليس الشخص نفسه قبل الحفظ`);
    if (out.length >= 5) break;
  }
  return out;
}
const SNAPSHOT_FIELDS = ['name_ar', 'name_en', 'job_title', 'employment_type', 'status', 'sector_id', 'department_id', 'unit_id', 'position_id',
  'hire_date', 'end_date', 'active', 'resource_type', 'vendor_name', 'engagement_ref', 'user_id'];
const snapshot = (e) => Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, e[k] ?? null]));
function diffOf(before, after) {
  const b = {}; const a = {};
  for (const k of SNAPSHOT_FIELDS) if (String(before[k] ?? '') !== String(after[k] ?? '')) { b[k] = before[k]; a[k] = after[k]; }
  return { before: b, after: a };
}
async function readResource(employeeId, today = riyadhDate()) {
  const emp = await get('SELECT * FROM employee WHERE id = ?', [employeeId]);
  const [names, account] = await Promise.all([orgNamesOf(emp), accountOf(emp)]);
  return shapeResource(emp, names, account, today);
}
export async function createResource(ctx, data = {}) {
  const user = ctx.user;
  const sectorId = normText(data.sector_id, 80);
  // المورد ينتمي إلى قطاعٍ أو وحدة مساندة دائماً: بلا قطاعٍ لا يظهر في كشف أحد ولا يُحكم نطاقه.
  if (!sectorId) throw badRequest('اختر القطاع أو وحدة المساندة التي ينتمي إليها المورد');
  if (!canCreateResource(user, sectorId)) throw forbidden('إضافة مورد تتطلب صلاحية إدارة الفريق على هذا القطاع');
  if (!(await get('SELECT id FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]))) throw badRequest('القطاع المختار غير موجود — اختره من القائمة');
  const name = normText(data.name_ar, 120);
  if (!name) throw badRequest('اسم المورد مطلوب');
  const type = normResourceType(data.resource_type);
  const vendor = normText(data.vendor_name, 200);
  if (type === 'partner' && !vendor) throw badRequest('اذكر اسم الجهة الشريكة للمورد من نوع «شريك»');
  const ref = normText(data.engagement_ref, 120);
  const capacity = data.capacity_pct == null || String(data.capacity_pct).trim() === '' ? null : normCapacityPct(data.capacity_pct);
  const employmentType = normEmploymentType(data.employment_type, type);
  const departmentId = normText(data.department_id, 80);
  await assertDepartmentInSector(departmentId, sectorId);
  const endDate = normIsoDate(data.end_date, 'تاريخ انتهاء الارتباط');
  const warnings = await similarNames(name, null, user);
  const eid = await tx(async () => {
    const emp = await createEmployee(ctx, {
      name_ar: name, name_en: normText(data.name_en, 120), sector_id: sectorId, department_id: departmentId,
      unit_id: normText(data.unit_id, 80), position_id: normText(data.position_id, 80), job_title: normText(data.job_title, 120),
      hire_date: data.hire_date, employment_type: employmentType,
    });
    const at = nowIso();
    const patch = { resource_type: type, vendor_name: vendor, engagement_ref: ref, updated_at: at };
    if (capacity != null) patch.capacity_pct = capacity;
    await update('employee', emp.id, patch);
    if (endDate) await updateEmployee(ctx, emp.id, { end_date: endDate });
    let versionId = null;
    if (capacity != null) {
      versionId = id('capv');
      await insert('capacity_version', { id: versionId, employee_id: emp.id, effective_from: day(emp.hire_date) || riyadhDate(), capacity_pct: capacity,
        note: 'الطاقة عند التسجيل', created_by: user.id, created_at: at });
    }
    await audit(ctx, { action: 'update', resource: 'employee', resourceId: emp.id, sectorId, detail: {
      before: null, after: { resource_type: type, vendor_name: vendor, engagement_ref: ref, capacity_pct: capacity, end_date: endDate }, source: 'resource_form', capacity_version_id: versionId,
    } });
    return emp.id;
  });
  return { resource: await readResource(eid), warnings };
}
export async function updateResource(ctx, employeeId, data = {}) {
  const user = ctx.user;
  const emp = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw notFound('المورد غير موجود — قد يكون سجله حُذف');
  if (!canEditResource(user, emp)) throw forbidden('تعديل بيانات المورد يتطلب صلاحية تعديل الموظف على قطاعه');
  const base = {};
  for (const k of BASE_FIELDS) if (k in data) base[k] = data[k];
  const patch = {};
  if ('resource_type' in data) patch.resource_type = normResourceType(data.resource_type);
  if ('vendor_name' in data) patch.vendor_name = normText(data.vendor_name, 200);
  if ('engagement_ref' in data) patch.engagement_ref = normText(data.engagement_ref, 120);
  const finalType = patch.resource_type || resourceTypeOf(emp);
  const finalVendor = 'vendor_name' in patch ? patch.vendor_name : emp.vendor_name;
  if (finalType === 'partner' && !finalVendor) throw badRequest('اذكر اسم الجهة الشريكة للمورد من نوع «شريك»');
  if ('employment_type' in base && base.employment_type != null && String(base.employment_type).trim() !== '') base.employment_type = normEmploymentType(base.employment_type, finalType);
  if ('department_id' in base || 'sector_id' in base) {
    await assertDepartmentInSector('department_id' in base ? normText(base.department_id, 80) : emp.department_id, 'sector_id' in base ? normText(base.sector_id, 80) : emp.sector_id);
  }
  const wantsCapacity = data.capacity_pct != null && String(data.capacity_pct).trim() !== '';
  const warnings = base.name_ar ? await similarNames(String(base.name_ar), emp.id, user) : [];
  const before = snapshot(emp);
  await tx(async () => {
    if (Object.keys(base).length) await updateEmployee(ctx, emp.id, base);
    if (Object.keys(patch).length) { patch.updated_at = nowIso(); await update('employee', emp.id, patch); }
    if (wantsCapacity) await setCapacity(ctx, emp.id, { capacity_pct: data.capacity_pct, effective_from: data.capacity_effective_from || riyadhDate(), note: data.capacity_note });
    const after = snapshot(await get('SELECT * FROM employee WHERE id = ?', [emp.id]));
    const diff = diffOf(before, after);
    // سطرٌ واحد بقبل/بعد لكل ما تغيّر في النموذج (خدمة الموظف تكتب أسماء الأعمدة وحدها)، والطاقة
    // لها سطرها في `capacity_version`. الراتب ليس في اللقطة أصلاً.
    if (Object.keys(diff.after).length) {
      await audit(ctx, { action: 'update', resource: 'employee', resourceId: emp.id, sectorId: after.sector_id || emp.sector_id,
        detail: { before: diff.before, after: diff.after, source: 'resource_form' } });
    }
  });
  return { resource: await readResource(emp.id), warnings };
}

// ═══ S10 — سجل التغييرات ════════════════════════════════════════════════════════════════════════
const AUDIT_FILTERS = ['all', 'profile', 'capacity', 'allocation', 'capability'];
const KIND_OF_RESOURCE = { employee: 'profile', capacity_version: 'capacity', allocation: 'allocation', allocation_request: 'request', resource_capability: 'capability' };
// أي مفتاح راتبٍ يُسقَط من الأثر المعروض مهما كان القارئ — الراتب مختوم لمدير النظام وحده
// وسجل التغييرات ليس باباً خلفياً له.
const SALARY_KEY = /salary/i;
function stripSalary(v) {
  if (Array.isArray(v)) return v.filter((x) => !(typeof x === 'string' && SALARY_KEY.test(x))).map(stripSalary);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !SALARY_KEY.test(k)).map(([k, x]) => [k, stripSalary(x)]));
  return v;
}
export async function resourceAudit(user, employeeId, opts = {}) {
  const emp = await loadReadableResource(user, employeeId);
  const filter = String(opts.filter || 'all').toLowerCase();
  if (!AUDIT_FILTERS.includes(filter)) throw badRequest('مرشّح السجل: الكل، بيانات المورد، الطاقة، التسكين، أو القدرات');
  const resources = filter === 'all' ? Object.keys(KIND_OF_RESOURCE)
    : filter === 'profile' ? ['employee'] : filter === 'capacity' ? ['capacity_version']
      : filter === 'allocation' ? ['allocation', 'allocation_request'] : ['resource_capability'];
  // سطور المورد نفسه بمعرّفه، وسطور ما يخصّه (تسكين/طاقة/قدرات/طلبات) بمعرّفاتها — المحذوف ناعماً
  // ضمنها لأن أثر حذفه جزءٌ من القصة.
  const ownIds = [];
  for (const t of resources.filter((r) => r !== 'employee')) {
    for (const r of await all(`SELECT id FROM ${t} WHERE employee_id = ?`, [emp.id])) ownIds.push([t, r.id]);
  }
  const parts = []; const params = [];
  if (resources.includes('employee')) { parts.push("(resource = 'employee' AND resource_id = ?)"); params.push(emp.id); }
  const byTable = new Map();
  for (const [t, rid] of ownIds) { if (!byTable.has(t)) byTable.set(t, []); byTable.get(t).push(rid); }
  for (const [t, ids] of byTable) { parts.push(`(resource = ? AND resource_id IN (${ph(ids)}))`); params.push(t, ...ids); }
  if (!parts.length) return { rows: [], filter, count: 0 };
  const limit = Math.min(Math.max(Number.parseInt(opts.limit, 10) || 200, 1), 500);
  const rows = await all(`SELECT id, at, user_id, username, role_id, action, resource, resource_id, detail_json
      FROM audit_log WHERE ${parts.join(' OR ')} ORDER BY at DESC, id DESC LIMIT ?`, [...params, limit]);
  const names = await namesByIds(rows.map((r) => r.user_id).filter(Boolean));
  const out = rows.map((r) => {
    let detail = null; try { detail = r.detail_json ? JSON.parse(r.detail_json) : null; } catch { detail = null; }
    detail = stripSalary(detail);
    const kind = KIND_OF_RESOURCE[r.resource] || 'profile';
    const isObj = detail && typeof detail === 'object' && !Array.isArray(detail);
    const before = isObj && 'before' in detail ? detail.before ?? null : null;
    const after = isObj && 'after' in detail ? detail.after ?? null : (isObj && !('before' in detail) ? stripSalary(Object.fromEntries(Object.entries(detail).filter(([k]) => !['reason', 'note', 'source', 'employee_id'].includes(k)))) : null);
    const changed = Array.isArray(detail) ? detail.filter((k) => typeof k === 'string' && k !== 'updated_at') : (after && typeof after === 'object' ? Object.keys(after) : []);
    return {
      id: r.id, at: r.at,
      actor: { userId: r.user_id || null, name: (r.user_id && names.get(r.user_id)) || r.username || 'النظام', role_id: r.role_id || null },
      action: r.action, action_ar: `${auditActionLabel(r.action)} ${AUDIT_KIND_AR[kind] || ''}`.trim(),
      kind, kind_ar: AUDIT_KIND_AR[kind] || kind,
      before, after, changed,
      reason: isObj ? (detail.reason || detail.note || null) : null,
      ref: { kind: r.resource, id: r.resource_id },
    };
  });
  return { rows: out, filter, count: out.length };
}

// ═══ S11 — الهيكل الإداري: الشجرة القائمة + موارد الإدارة المختارة + الارتباطات المشتركة ════════
// الشجرة من `orgTree` القائم، مقصوصةً إلى الهوية والعدّ: لا مستهدفات مالية للقطاعات هنا مهما اتسع
// القارئ — هذه شاشة أشخاصٍ لا شاشة مال (قاعدة ②).
export async function orgResources(user, opts = {}) {
  if (!canReadResources(user)) throw forbidden('عرض الهيكل الإداري للموارد يتطلب صلاحية قراءة الفريق — اطلب تفعيلها من مدير النظام');
  const today = riyadhDate(); const nowKey = keyOf(today);
  const raw = await orgTree(user);
  const managerIds = raw.flatMap((s) => s.departments.map((d) => d.manager_user_id)).filter(Boolean);
  const names = await namesByIds(managerIds);
  const tree = raw.map((s) => ({
    id: s.id, name_ar: s.name_ar, name_en: s.name_en || null, color: s.color || null, kind: s.kind || null, active: Number(s.active) === 1,
    employees: N(s.employees),
    departments: s.departments.map((d) => ({
      id: d.id, name_ar: d.name_ar, name_en: d.name_en || null, active: Number(d.active) === 1, employees: N(d.employees),
      manager_user_id: d.manager_user_id || null, manager_name: d.manager_user_id ? names.get(d.manager_user_id) || null : null,
      units: (d.units || []).map((u) => ({ id: u.id, name_ar: u.name_ar, manager_user_id: u.manager_user_id || null })),
    })),
  }));
  const depId = normText(opts.department, 80);
  let department = null; let resources = []; let shared = [];
  if (depId) {
    const dep = await get(`SELECT d.id, d.name_ar, d.sector_id, d.manager_user_id, s.name_ar sector_name
        FROM department d JOIN sector s ON s.id = d.sector_id WHERE d.id = ? AND d.deleted_at IS NULL`, [depId]);
    if (!dep) throw notFound('الإدارة غير موجودة — قد تكون حُذفت من الهيكل');
    department = { id: dep.id, name_ar: dep.name_ar, sector_id: dep.sector_id, sector_name: dep.sector_name,
      manager_user_id: dep.manager_user_id || null, manager_name: dep.manager_user_id ? (await namesByIds([dep.manager_user_id])).get(dep.manager_user_id) || null : null };
    const scope = resourceScopeSql(user, 'e');
    const where = [scope.clause, 'e.department_id = ?']; const params = [...scope.params, dep.id];
    const term = String(opts.q || '').trim().replace(/[%_]/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    if (term) { where.push(`(LOWER(e.name_ar) LIKE ? OR LOWER(COALESCE(e.job_title,'')) LIKE ?)`); params.push(`%${term}%`, `%${term}%`); }
    const emps = await all(`SELECT e.*, ${USER_ID_SQL('e')} linked_user_id FROM employee e WHERE ${where.join(' AND ')} ORDER BY e.name_ar, e.id`, params);
    const { ctx, figures } = await figuresFor(emps.map((e) => e.id), nowKey, nowKey);
    resources = emps.map((e) => {
      const m = figures.get(e.id)?.months?.[0] || null;
      const type = resourceTypeOf(e);
      return { id: e.id, name_ar: e.name_ar, job_title: e.job_title || null, resourceType: type, resourceType_ar: RESOURCE_TYPE_AR[type],
        engagement: engagementOf(e, today), capacityPct: capacityPctOf(e), userId: e.linked_user_id || null,
        month: m ? { key: m.key, state: m.state, confirmedPct: m.confirmedPct, availablePct: m.availablePct, band: bandOf(m.confirmedPct), band_ar: BAND_AR[bandOf(m.confirmedPct)] } : null };
    });
    // الارتباطات المشتركة: أهل هذه الإدارة المسكَّنون (الشهر الجاري فما بعده في السنة) على مشاريع
    // إدارةٍ أخرى — بأسماء المشاريع وإداراتها ونسبها، بلا قيم.
    const year = Number(today.slice(0, 4)); const month = Number(today.slice(5, 7));
    for (const e of emps) {
      for (const a of ctx.allocs.get(e.id) || []) {
        if (!a.project_id || Number(a.year) !== year) continue;
        const p = ctx.projects.get(a.project_id);
        if (!p || !p.department_id || p.department_id === dep.id) continue;
        const mj = parseMj(a.monthly_json);
        const months = [];
        for (let mm = month; mm <= 12; mm++) { const pct = monthPctOf(mj, mm); if (pct) months.push({ key: monthKey(year, mm), pct }); }
        if (!months.length) continue;
        shared.push({ employeeId: e.id, name_ar: e.name_ar, project: { id: p.id, label: p.name_ar, code: p.code || null, department_id: p.department_id, status: p.status || null, status_ar: projectStatusLabel(p.status) },
          status: String(a.status || '').toLowerCase() === 'tentative' ? 'tentative' : 'confirmed', currentPct: months[0].key === nowKey ? months[0].pct : 0, months });
      }
    }
    const otherDeps = [...new Set(shared.map((s) => s.project.department_id))];
    const depNames = new Map(otherDeps.length
      ? (await all(`SELECT id, name_ar FROM department WHERE id IN (${ph(otherDeps)})`, otherDeps)).map((d) => [d.id, d.name_ar]) : []);
    for (const s of shared) { s.project.department_name = depNames.get(s.project.department_id) || null; s.status_ar = ALLOC_STATUS_AR[s.status]; }
    shared.sort((a, b) => (b.currentPct - a.currentPct) || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'));
  }
  return { tree, department, resources, shared, month: { key: nowKey, label_ar: monthLabelAr(nowKey) }, basis_ar: BASIS_AR, noMoney_ar: NO_MONEY_AR };
}
