// ── الاحتياجات القادمة ومقارنة المرشحين — S19/S20/S21 (وحدة الفريق والموارد) ─────────────
//
// «تسجيل الاحتياج لا يعني تغطيته» (الموجّه §5). الاحتياج سجلٌّ مستقل: مصدرٌ أصلي (مشروع/بند
// داخلي/فرصة)، ودورٌ مطلوب، وحجمٌ بوحدةٍ واضحة (عدد × نسبة طاقة طوال الفترة)، ويقينٌ (مبدئي/
// مؤكد) منفصلٌ عن حالة التغطية. **حفظُه لا يحجز طاقةً لأحد** — الحجز لا يقع إلا عبر طلب
// تسكينٍ يمرّ بمحرّك الاعتماد (allocations.submitRequest).
//
// المرشحون (S21): الأهليةُ قاعدةُ التسكين نفسها (pmo/capacity.js staffingCandidates) — موظفو
// قطاع مصدر العمل **مع** وحدات المساندة، لأنهم مورد مشترك للشركة؛ وقاعدةٌ ثانية هنا تعني
// قائمةً تعرض من لا يقبله الحفظ. والمتاح من capacity-model عبر capacity-read وحده (لا معادلة
// ثانية)، والمعلَّق طبقةٌ تُعرض ولا تُخصم (T02/T26). **ولا نسبة ملاءمةٍ رقمية**: الجمل العربية
// تقول ما يُغطَّى وما ينقص، فلا يُختزل إنسانٌ في رقمٍ لا يعرف أحدٌ بسطَه ومقامه.
//
// لا مال هنا بأي شكل (قاعدة access.js ②): أسماء الأعمال وفتراتها ونسبها فقط.
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { SCOPE_RANK } from '../../core/rbac/matrix.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { MONTHS_AR } from '../../core/i18n/time.js';
import { SUPPORT_KIND } from '../../core/org/kind.js';
import { workBucketLabel } from '../../web/i18n/glossary.js';
import { isWorkBucket } from '../pmo/projects.js';
import { loadReadableProject } from '../pmo/project-access.js';
import { SKILL_LEVELS } from './resources.js';
import { loadReadableOpportunity } from '../crm/opp-access.js';
import { seesDemoAccounts, notDemoEmployeeSql, namesByIds } from '../org/people.js';
import { canReadResources, canPlanResources, resourceScopeSql } from './access.js';
import { inDepartmentScope } from '../../core/rbac/departments.js';
import { figuresFor } from './capacity-read.js';
import { monthsBetween, parseMonthKey } from './capacity-model.js';

const N = (v) => Number(v) || 0;
const ph = (arr) => arr.map(() => '?').join(',');

export const SOURCE_KINDS = ['project', 'bucket', 'opportunity'];
export const SOURCE_KIND_AR = Object.freeze({ project: 'مشروع', bucket: 'عمل داخلي', opportunity: 'فرصة' });
export const CERTAINTY_AR = Object.freeze({ tentative: 'مبدئي', confirmed: 'مؤكد' });
export const NEED_STATUS_AR = Object.freeze({
  draft: 'مسودة', open: 'مفتوح', shortlisting: 'قيد الترشيح', partial: 'مغطى جزئياً', covered: 'مغطى', cancelled: 'ملغى',
});
export const COVERAGE_AR = Object.freeze({ uncovered: 'غير مغطى', pending: 'بانتظار اعتماد', partial: 'مغطى جزئياً', covered: 'مغطى' });
export const SKILL_STATE_AR = Object.freeze({ verified: 'موثقة', needs_confirmation: 'تحتاج تأكيداً', missing: 'غير مسجلة' });
const NEED_STATUSES = Object.keys(NEED_STATUS_AR);
const MAX_MONTHS = 36;

// ── صياغة الحجم بلسانٍ عربي: «مورد واحد × 50% FTE طوال الفترة» ──────────────────────────
const countAr = (n) => (n === 1 ? 'مورد واحد' : n === 2 ? 'موردان' : n <= 10 ? `${n} موارد` : `${n} مورداً`);
export const demandAr = (headcount, ftePct) => `${countAr(N(headcount))} × ${N(ftePct)}% من الدوام الكامل طوال الفترة`;

// ── محقِّقات المدخلات — رسالةٌ تقول ما حدث وما العمل ─────────────────────────────────
const isoDate = (v) => {
  const s = String(v == null ? '' : v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && s === new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) ? s : null;
};
const dateOrThrow = (v, label, sample) => {
  const s = isoDate(v);
  if (!s) throw badRequest(`${label} غير صحيح — أدخله بصيغة سنة-شهر-يوم مثل ${sample}`);
  return s;
};
const dateOrNull = (v, label, sample) => (v == null || String(v).trim() === '' ? null : dateOrThrow(v, label, sample));
const intOrThrow = (v, { min, max, msg }) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(msg);
  return n;
};
const text = (v, max) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, max) : null; };
const uniqNames = (arr) => [...new Set((Array.isArray(arr) ? arr : String(arr || '').split(/[،,]/))
  .map((s) => String(s == null ? '' : s).trim()).filter(Boolean).map((s) => s.slice(0, 60)))].slice(0, 20);
const normSkills = (v) => {
  if (v == null) return null;
  if (Array.isArray(v) || typeof v === 'string') return { required: uniqNames(v), preferred: [] };
  if (typeof v !== 'object') throw badRequest('المهارات تُكتب قائمةً — المطلوبة والمفضَّلة');
  return { required: uniqNames(v.required), preferred: uniqNames(v.preferred) };
};
const parseSkills = (json) => {
  let s = null; try { s = JSON.parse(json || 'null'); } catch { s = null; }
  return { required: uniqNames(s?.required), preferred: uniqNames(s?.preferred) };
};
const monthKeyOfDate = (iso) => String(iso).slice(0, 7);
const skillKey = (s) => String(s || '').replace(/[ـً-ْٰ]/g, '').replace(/[آأإٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// ── مصدر الاحتياج: يُقرأ بالباب الواحد لكل نوع، فلا يُسجَّل احتياجٌ على ما لا يصل إليه صاحبه ──
async function resolveSource(user, kind, sourceId, hints = {}) {
  const k = String(kind || '').toLowerCase();
  if (!SOURCE_KINDS.includes(k)) throw badRequest('مصدر الاحتياج إما مشروع أو عمل داخلي أو فرصة — اختر واحداً');
  const sid = String(sourceId == null ? '' : sourceId).trim();
  if (!sid) throw badRequest('حدّد مصدر الاحتياج: المشروع أو بند العمل الداخلي أو الفرصة');
  if (k === 'project') {
    const p = await loadReadableProject(user, sid, 'read', 'هذا المشروع خارج نطاق صلاحياتك — سجّل الاحتياج على مشروعٍ تقرؤه');
    return { kind: k, id: p.id, label: p.name_ar, sector_id: p.sector_id || null, department_id: p.department_id || null, project_id: p.id };
  }
  if (k === 'opportunity') {
    const o = await loadReadableOpportunity(user, sid, 'read', 'هذه الفرصة خارج نطاق صلاحياتك — سجّل الاحتياج على فرصةٍ تقرؤها');
    return { kind: k, id: o.id, label: o.title_ar, sector_id: o.sector_id || null, department_id: o.department_id || null, project_id: null };
  }
  if (!isWorkBucket(sid)) throw badRequest('اختر بند العمل الداخلي من القائمة: تطوير أعمال، تطوير منتجات، إدارة مشاريع');
  // بند العمل الداخلي لا قطاع له في ذاته؛ قطاعُه قطاعُ من يسجّله (أو ما يسمّيه قارئُ الشركة).
  const sector = (user.scope === 'company' ? (hints.sector_id || user.sector_id) : user.sector_id) || null;
  if (!sector) throw badRequest('حدّد القطاع الذي يخصّه بند العمل الداخلي');
  // الإدارة المرفقة تُقرأ من القاعدة وتُشترط داخل القطاع نفسه (وداخل نطاق صاحب النافذة الضيقة) —
  // لا معرّفاً حراً يزرع احتياج قطاعٍ في إدارة قطاعٍ آخر.
  let departmentId = null;
  const wanted = hints.department_id || user.department_id || null;
  if (wanted) {
    const dep = await get('SELECT id, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [wanted]);
    if (!dep || dep.sector_id !== sector) throw badRequest('الإدارة المختارة ليست في هذا القطاع — اختر إدارةً من قطاع الاحتياج');
    if (user.scope === 'department' && !inDepartmentScope(user, dep.id)) throw forbidden('هذه الإدارة خارج نطاقك — يُسجَّل الاحتياج على إدارتك');
    departmentId = dep.id;
  }
  return { kind: k, id: sid, label: workBucketLabel(sid), sector_id: sector, department_id: departmentId, project_id: null };
}

const needTarget = (n) => ({
  sector_id: n.sector_id || null, department_id: n.department_id || null,
  project_id: n.source_kind === 'project' ? n.source_id : null,
  owner_user_id: n.owner_user_id, created_by: n.created_by,
});
const isOwner = (user, n) => !!user && (n.owner_user_id === user.id || n.created_by === user.id);

async function loadNeed(needId) {
  const n = await get('SELECT * FROM resource_need WHERE id = ? AND deleted_at IS NULL', [needId]);
  if (!n) throw notFound('الاحتياج غير موجود — قد يكون حُذف');
  return n;
}
async function loadReadableNeed(user, needId) {
  const n = await loadNeed(needId);
  if (user.role_id === 'admin' || isOwner(user, n) || can(user, 'read', 'resource_need', needTarget(n))) return n;
  throw forbidden('هذا الاحتياج خارج نطاقك — يُفتح لصاحبه ولمن يدير إدارته أو قطاعه');
}
function assertCanEdit(user, n) {
  if (user.role_id === 'admin' || isOwner(user, n) || can(user, 'update', 'resource_need', needTarget(n))) return;
  throw forbidden('تعديل هذا الاحتياج لصاحبه أو لمن يدير إدارته أو قطاعه');
}

// ── التغطية: تُقرأ من طلبات التسكين المرتبطة بالاحتياج، لا من عمود حالته ─────────────────
// المطبَّق/المعتمد يغطّي، والمعلَّق ينتظر، وما سواهما (مُعاد/مرفوض/مسحوب) لا يُحتسب. النسبة
// لكل طلب = متوسط نسب أشهره (نسبةٌ من طاقة المورد كما كُتبت)، والفجوة = المطلوب − المغطى.
function requestPct(monthsJson) {
  let mj = {}; try { mj = JSON.parse(monthsJson || '{}'); } catch { mj = {}; }
  const vals = Object.values(mj || {}).map(N).filter((v) => v > 0);
  return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) / vals.length) : 0;
}
function coverageOf(need, requests = []) {
  const demand = N(need.headcount) * N(need.fte_pct);
  // المورد الواحد يُحسب مرةً: احتياجٌ يمتد على سنتين يولّد طلباً لكل سنة للشخص نفسه (وحدة
  // allocation_request سنوية) — فتُجمع نسبته على أعلى طلباته لا على مجموعها.
  const perEmp = new Map();
  let requestId = null; let pendingId = null;
  for (const r of requests) {
    const st = String(r.status || '');
    const k = r.employee_id || r.id;
    const cur = perEmp.get(k) || { covered: 0, pending: 0 };
    if (st === 'applied' || st === 'approved') { cur.covered = Math.max(cur.covered, requestPct(r.months_json)); requestId = requestId || r.id; }
    else if (st === 'pending') { cur.pending = Math.max(cur.pending, requestPct(r.months_json)); pendingId = pendingId || r.id; }
    perEmp.set(k, cur);
  }
  let covered = 0; let pending = 0;
  for (const v of perEmp.values()) { covered += v.covered; pending += v.pending; }
  const gapPct = Math.max(demand - covered, 0);
  const status = gapPct === 0 && demand > 0 ? 'covered' : covered > 0 ? 'partial' : pending > 0 ? 'pending' : 'uncovered';
  return { status, status_ar: COVERAGE_AR[status], demandPct: demand, coveredPct: covered, pendingPct: pending, gapPct,
    requestId: pendingId || requestId || null, requests: requests.length };
}

function shapeNeed(n, { sourceLabel = null, ownerName = null, requests = [] } = {}) {
  const months = monthsBetween(monthKeyOfDate(n.from_date), monthKeyOfDate(n.to_date));
  const status = String(n.status || 'open');
  const certainty = String(n.certainty || 'confirmed');
  return {
    id: n.id,
    role_ar: n.role_ar,
    source: { kind: n.source_kind, id: n.source_id, kind_ar: SOURCE_KIND_AR[n.source_kind] || n.source_kind,
      label: sourceLabel || (n.source_kind === 'bucket' ? workBucketLabel(n.source_id) : null) || '—' },
    period: { from: n.from_date, to: n.to_date, months: months.map((m) => m.key) },
    headcount: N(n.headcount), ftePct: N(n.fte_pct),
    demand_ar: demandAr(n.headcount, n.fte_pct),
    certainty, certainty_ar: CERTAINTY_AR[certainty] || certainty,
    status, status_ar: NEED_STATUS_AR[status] || status,
    coverage: coverageOf(n, requests),
    decide_by: n.decide_by || null,
    owner: { userId: n.owner_user_id, name: ownerName || null },
    skills: parseSkills(n.skills_json), level: n.level || null,
    splittable: N(n.splittable) === 1, goal: n.goal || null,
    sector_id: n.sector_id || null, department_id: n.department_id || null,
    created_at: n.created_at, updated_at: n.updated_at || null,
  };
}

async function sourceLabels(rows) {
  const pids = [...new Set(rows.filter((r) => r.source_kind === 'project').map((r) => r.source_id))];
  const oids = [...new Set(rows.filter((r) => r.source_kind === 'opportunity').map((r) => r.source_id))];
  const map = new Map();
  if (pids.length) for (const p of await all(`SELECT id, name_ar FROM project WHERE id IN (${ph(pids)})`, pids)) map.set('project:' + p.id, p.name_ar);
  if (oids.length) for (const o of await all(`SELECT id, title_ar FROM opportunity WHERE id IN (${ph(oids)})`, oids)) map.set('opportunity:' + o.id, o.title_ar);
  return map;
}
async function requestsByNeed(needIds) {
  const ids = [...new Set(needIds.filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await all(`SELECT id, need_id, employee_id, status, months_json, alloc_status, created_at, requested_by
      FROM allocation_request WHERE deleted_at IS NULL AND need_id IN (${ph(ids)}) ORDER BY created_at DESC`, ids);
  for (const r of rows) { if (!map.has(r.need_id)) map.set(r.need_id, []); map.get(r.need_id).push(r); }
  return map;
}

/**
 * S19 — الاحتياجات القادمة في نطاق القارئ. المرشّحات خادمية، والعدّاد بنفس الشرط.
 * @returns {{ rows, summary: { confirmed, tentative }, followups, period, basis_ar }}
 */
export async function listNeeds(user, { from, to, department, status, certainty, sector, todayDate } = {}) {
  if (!user || (user.role_id !== 'admin' && !can(user, 'read', 'resource_need')))
    throw forbidden('عرض الاحتياجات يتطلب صلاحية «الاحتياجات» — اطلبها من مدير النظام');
  const sc = scopeFilter(user, 'resource_need', 'read', {
    sectorCol: 'n.sector_id', ownerCol: 'n.owner_user_id', deptCol: 'n.department_id', projectCol: 'n.source_id',
  });
  // صاحبُ الاحتياج يرى ما سجّله دائماً — إضافةٌ لا تُوسِّع نطاق أحدٍ إلى ما لم يكتبه هو.
  const where = ['n.deleted_at IS NULL', `((${sc.clause}) OR n.owner_user_id = ?)`];
  const params = [...sc.params, user.id];
  const f = isoDate(from) || (parseMonthKey(from) ? `${from}-01` : null);
  const t = isoDate(to) || (parseMonthKey(to) ? `${to}-31` : null);
  if (f) { where.push('n.to_date >= ?'); params.push(f); }
  if (t) { where.push('n.from_date <= ?'); params.push(t); }
  if (sector && user.scope === 'company') { where.push('n.sector_id = ?'); params.push(String(sector)); }
  if (department) { where.push('n.department_id = ?'); params.push(String(department)); }
  const st = String(status || '').trim();
  if (st && st !== 'all') {
    if (!NEED_STATUSES.includes(st)) throw badRequest('حالة الاحتياج غير معروفة — اختر من القائمة');
    where.push('n.status = ?'); params.push(st);
  } else if (st !== 'all') where.push("n.status <> 'cancelled'");
  const ct = String(certainty || '').trim();
  if (ct) {
    if (!CERTAINTY_AR[ct]) throw badRequest('اليقين إما «مبدئي» أو «مؤكد»');
    where.push('n.certainty = ?'); params.push(ct);
  }
  const rows = await all(`SELECT n.* FROM resource_need n WHERE ${where.join(' AND ')}
      ORDER BY n.from_date, COALESCE(n.decide_by, n.to_date), n.created_at`, params);
  const [labels, reqs, owners] = await Promise.all([
    sourceLabels(rows), requestsByNeed(rows.map((r) => r.id)), namesByIds(rows.map((r) => r.owner_user_id)),
  ]);
  const shaped = rows.map((n) => shapeNeed(n, {
    sourceLabel: labels.get(`${n.source_kind}:${n.source_id}`), ownerName: owners.get(n.owner_user_id) || null,
    requests: reqs.get(n.id) || [],
  }));
  const live = shaped.filter((r) => r.status !== 'cancelled');
  // «اليوم» يُربط نصاً لا دالةَ قاعدة (القاعدة المحمولة) — ويُمرَّر في الاختبار كي يكون الجواب حاسماً.
  const today = String(todayDate || nowIso().slice(0, 10)).slice(0, 10);
  const soon = new Date(Date.parse(today + 'T00:00:00Z') + 14 * 86400000).toISOString().slice(0, 10);
  const followups = [];
  for (const r of live) {
    if (r.coverage.status === 'covered' || r.status === 'covered') continue;
    if (r.decide_by && r.decide_by < today) followups.push({ needId: r.id, role_ar: r.role_ar, decide_by: r.decide_by, kind: 'decision_overdue', reason_ar: `تجاوز موعد القرار (${r.decide_by}) بلا تغطية` });
    else if (r.decide_by && r.decide_by <= soon) followups.push({ needId: r.id, role_ar: r.role_ar, decide_by: r.decide_by, kind: 'decision_due', reason_ar: `موعد القرار ${r.decide_by} — التغطية ${r.coverage.status_ar}` });
    else if (r.period.from <= soon && r.period.to >= today) followups.push({ needId: r.id, role_ar: r.role_ar, decide_by: r.decide_by, kind: 'starting', reason_ar: `يبدأ ${r.period.from} والتغطية ${r.coverage.status_ar}` });
  }
  return {
    rows: shaped,
    total: shaped.length,
    summary: {
      confirmed: live.filter((r) => r.certainty === 'confirmed').length,
      tentative: live.filter((r) => r.certainty === 'tentative').length,
      uncovered: live.filter((r) => r.coverage.status === 'uncovered').length,
      pending: live.filter((r) => r.coverage.status === 'pending').length,
    },
    followups,
    period: { from: f, to: t },
    basis_ar: 'الاحتياج تسجيلٌ لا حجز: التغطية تُقرأ من طلبات التسكين المرتبطة به (المطبَّق يغطّي، والمعلَّق ينتظر). الحجم بوحدة عدد × نسبة طاقة طوال الفترة.',
  };
}

/** احتياجٌ واحد بتفاصيله (لصفحة الاحتياج ونافذة التعديل). */
export async function getNeed(user, needId) {
  const n = await loadReadableNeed(user, needId);
  const [labels, reqs, owners] = await Promise.all([sourceLabels([n]), requestsByNeed([n.id]), namesByIds([n.owner_user_id])]);
  const shaped = shapeNeed(n, { sourceLabel: labels.get(`${n.source_kind}:${n.source_id}`), ownerName: owners.get(n.owner_user_id) || null, requests: reqs.get(n.id) || [] });
  shaped.requests = (reqs.get(n.id) || []).map((r) => ({ id: r.id, employeeId: r.employee_id, status: r.status, pct: requestPct(r.months_json), alloc_status: r.alloc_status, created_at: r.created_at }));
  shaped.rights = { edit: user.role_id === 'admin' || isOwner(user, n) || can(user, 'update', 'resource_need', needTarget(n)) };
  return shaped;
}

// ── التحقق المشترك بين الإنشاء والتعديل ─────────────────────────────────────────────────
function validateCore(data, base = {}) {
  const out = {};
  const role = data.role_ar !== undefined ? text(data.role_ar, 120) : base.role_ar;
  if (!role) throw badRequest('الدور المطلوب مطلوب — مثل «محلل بيانات» أو «مدير مشروع»');
  out.role_ar = role;
  const from = data.from_date !== undefined ? dateOrThrow(data.from_date, 'تاريخ بداية الاحتياج', '2026-10-01') : base.from_date;
  const to = data.to_date !== undefined ? dateOrThrow(data.to_date, 'تاريخ نهاية الاحتياج', '2026-12-31') : base.to_date;
  if (!from || !to) throw badRequest('حدّد فترة الاحتياج: تاريخ البداية وتاريخ النهاية');
  if (from > to) throw badRequest('بداية الفترة بعد نهايتها — صحّح التاريخين');
  const months = monthsBetween(monthKeyOfDate(from), monthKeyOfDate(to));
  if (!months.length || months.length > MAX_MONTHS) throw badRequest(`الفترة أطول من ${MAX_MONTHS} شهراً — قسّم الاحتياج إلى فترات أقصر`);
  out.from_date = from; out.to_date = to;
  out.fte_pct = data.fte_pct !== undefined ? intOrThrow(data.fte_pct, { min: 1, max: 100, msg: 'نسبة الطاقة المطلوبة رقم صحيح من 1 إلى 100 — و100 تعني دواماً كاملاً' })
    : (base.fte_pct ?? 100);
  out.headcount = data.headcount !== undefined ? intOrThrow(data.headcount, { min: 1, max: 50, msg: 'عدد الموارد المطلوب رقم صحيح لا يقل عن 1' })
    : (base.headcount ?? 1);
  const cert = data.certainty !== undefined ? String(data.certainty || '').trim().toLowerCase() : (base.certainty || 'confirmed');
  if (!CERTAINTY_AR[cert]) throw badRequest('اليقين إما «مبدئي» أو «مؤكد»');
  out.certainty = cert;
  out.decide_by = data.decide_by !== undefined ? dateOrNull(data.decide_by, 'موعد القرار', '2026-09-20') : (base.decide_by || null);
  if (data.skills !== undefined) { const s = normSkills(data.skills); out.skills_json = s ? JSON.stringify(s) : null; }
  if (data.level !== undefined) {
    // مستوى الخبرة مفتاحٌ من قائمة مستويات القدرات نفسها (مبتدئ/ممارس/متقدم/خبير) — لا نصاً حراً
    // يُطبع كما هو في الشاشة؛ الفراغ يعني «غير محدد».
    const lv = String(data.level || '').trim().toLowerCase();
    if (lv && !SKILL_LEVELS.includes(lv)) throw badRequest('مستوى الخبرة: مبتدئ أو ممارس أو متقدم أو خبير — أو اتركه فارغاً');
    out.level = lv || null;
  }
  if (data.goal !== undefined) out.goal = text(data.goal, 500);
  if (data.splittable !== undefined) out.splittable = data.splittable === true || Number(data.splittable) === 1 ? 1 : 0;
  return out;
}

/**
 * S20 — تسجيل احتياج. تحقق خادمي من المصدر (يقرؤه صاحبه فعلاً) والفترة والنسب والعدد.
 * **الحفظ لا يحجز**: لا صفّ تسكين ولا طلب يُكتب هنا.
 */
export async function createNeed(ctx, data = {}) {
  const user = ctx.user;
  if (!user || (user.role_id !== 'admin' && !can(user, 'create', 'resource_need')))
    throw forbidden('تسجيل الاحتياج يتطلب صلاحية «الاحتياجات» — تُمنح لمدير المشروع ومدير الإدارة وقائد القطاع وتطوير الأعمال');
  const src = await resolveSource(user, data.source_kind, data.source_id, { sector_id: data.sector_id, department_id: data.department_id });
  // بند العمل الداخلي احتياجُ إدارةٍ أو قطاع لا احتياجُ مشروعٍ بعينه — فمن نطاقُه مشروعٌ أو
  // «خاصتي» يسجّل احتياجه على مشروعه (فحص الإنشاء بلا مشروعٍ يمرّ فارغاً على نطاق «مشروع»).
  const width = SCOPE_RANK[effectiveScope(user, 'create', 'resource_need')] || 0;
  if (src.kind === 'bucket' && user.role_id !== 'admin' && width < SCOPE_RANK.department)
    throw forbidden('احتياج العمل الداخلي يسجّله مدير الإدارة أو قائد القطاع — سجّل احتياجك على مشروعك');
  const target = { sector_id: src.sector_id, department_id: src.department_id, project_id: src.project_id, owner_user_id: user.id };
  if (user.role_id !== 'admin' && !can(user, 'create', 'resource_need', target))
    throw forbidden('تسجيل احتياج على هذا المصدر خارج نطاقك — اختر مشروعاً أو إدارةً ضمن صلاحيتك');
  const core = validateCore(data, { fte_pct: 100, headcount: 1, certainty: 'confirmed' });
  const status = data.status === 'draft' ? 'draft' : 'open';
  const nid = id('need'); const now = nowIso();
  const row = {
    id: nid, source_kind: src.kind, source_id: src.id, sector_id: src.sector_id, department_id: src.department_id,
    owner_user_id: user.id, role_ar: core.role_ar, skills_json: core.skills_json ?? null, level: core.level ?? null,
    headcount: core.headcount, fte_pct: core.fte_pct, from_date: core.from_date, to_date: core.to_date,
    decide_by: core.decide_by, certainty: core.certainty, status, splittable: core.splittable ?? 0, goal: core.goal ?? null,
    created_by: user.id, created_at: now,
  };
  await tx(async () => {
    await insert('resource_need', row);
    await audit(ctx, { action: 'create', resource: 'resource_need', resourceId: nid, sectorId: src.sector_id,
      detail: { source: { kind: src.kind, id: src.id, label: src.label }, role_ar: core.role_ar, headcount: core.headcount,
        fte_pct: core.fte_pct, from: core.from_date, to: core.to_date, certainty: core.certainty, status } });
  });
  return shapeNeed(await loadNeed(nid), { sourceLabel: src.label, ownerName: user.name_ar || user.username || null });
}

/** S20 — تعديل احتياج قائم؛ الملغى لا يُعدَّل. تغيير المصدر يُعاد التحقق منه كالإنشاء. */
export async function updateNeed(ctx, needId, data = {}) {
  const user = ctx.user;
  const n = await loadNeed(needId);
  assertCanEdit(user, n);
  if (n.status === 'cancelled') throw badRequest('الاحتياج ملغى ولا يُعدَّل — أنشئ احتياجاً جديداً');
  const patch = {};
  let src = null;
  if (data.source_kind !== undefined || data.source_id !== undefined) {
    src = await resolveSource(user, data.source_kind ?? n.source_kind, data.source_id ?? n.source_id, { sector_id: data.sector_id, department_id: data.department_id });
    if (user.role_id !== 'admin' && !can(user, 'update', 'resource_need', { sector_id: src.sector_id, department_id: src.department_id, project_id: src.project_id, owner_user_id: n.owner_user_id, created_by: n.created_by }))
      throw forbidden('نقل الاحتياج إلى هذا المصدر خارج نطاقك — اختر مصدراً ضمن صلاحيتك');
    Object.assign(patch, { source_kind: src.kind, source_id: src.id, sector_id: src.sector_id, department_id: src.department_id });
  }
  const core = validateCore(data, n);
  for (const k of ['role_ar', 'from_date', 'to_date', 'fte_pct', 'headcount', 'certainty', 'decide_by', 'skills_json', 'level', 'goal', 'splittable'])
    if (core[k] !== undefined) patch[k] = core[k];
  if (data.status !== undefined) {
    const st = String(data.status || '').trim();
    if (!NEED_STATUSES.includes(st) || st === 'cancelled') throw badRequest('لتغيير الحالة اختر من القائمة — والإلغاء له زرّه الخاص');
    patch.status = st;
  }
  const before = {}; const after = {};
  for (const [k, v] of Object.entries(patch)) {
    const old = n[k] == null ? null : n[k];
    if (String(old ?? '') === String(v ?? '')) { delete patch[k]; continue; }
    before[k] = old; after[k] = v;
  }
  if (!Object.keys(patch).length) return await getNeed(user, needId);
  patch.updated_at = nowIso();
  await tx(async () => {
    await update('resource_need', needId, patch);
    await audit(ctx, { action: 'update', resource: 'resource_need', resourceId: needId, sectorId: patch.sector_id || n.sector_id,
      detail: { before, after } });
  });
  return await getNeed(user, needId);
}

/** S19 — إلغاء احتياج. طلبٌ معلَّق مرتبطٌ به يمنع الإلغاء: يُسحب أو يُقرَّر أولاً، فلا يُعتمد حجزٌ لاحتياجٍ لم يعد قائماً. */
export async function cancelNeed(ctx, needId, { reason } = {}) {
  const user = ctx.user;
  const n = await loadNeed(needId);
  if (!(user.role_id === 'admin' || isOwner(user, n) || can(user, 'delete', 'resource_need', needTarget(n)) || can(user, 'update', 'resource_need', needTarget(n))))
    throw forbidden('إلغاء هذا الاحتياج لصاحبه أو لمن يدير إدارته أو قطاعه');
  if (n.status === 'cancelled') return { ...(await getNeed(user, needId)), already: true };
  const pending = await all(`SELECT id, employee_id FROM allocation_request WHERE need_id = ? AND status = 'pending' AND deleted_at IS NULL ORDER BY created_at`, [needId]);
  if (pending.length) {
    const names = await all(`SELECT id, name_ar FROM employee WHERE id IN (${ph(pending.map((p) => p.employee_id))})`, pending.map((p) => p.employee_id));
    const nm = new Map(names.map((e) => [e.id, e.name_ar]));
    const list = pending.map((p) => `${nm.get(p.employee_id) || 'مورد'} (${p.id})`).join('، ');
    throw badRequest(`للاحتياج طلب تسكين معلَّق: ${list} — اسحبه أو انتظر قراره قبل الإلغاء`);
  }
  const now = nowIso();
  await tx(async () => {
    await update('resource_need', needId, { status: 'cancelled', updated_at: now });
    await audit(ctx, { action: 'cancel', resource: 'resource_need', resourceId: needId, sectorId: n.sector_id,
      detail: { from: n.status, reason: text(reason, 300) } });
  });
  return await getNeed(user, needId);
}

// ── S21: مقارنة المرشحين ───────────────────────────────────────────────────────────────
const monthLabelAr = (m, withYear) => `${MONTHS_AR[m.month - 1]}${withYear ? ' ' + m.year : ''}`;
const joinAr = (arr) => arr.join(' و');
const skillsOf = (rows, employeeId) => (rows.get(employeeId) || []);

function fitSentences({ needPct, engaged, gaps, potentialOverPct, potentialMonth, skills, withYear }) {
  const out = [];
  const lbl = (a) => monthLabelAr(a.m, withYear);
  if (!engaged.length) out.push('خارج فترة الارتباط طوال الفترة المطلوبة');
  else if (gaps.length) out.push(`متاح في ${joinAr(engaged.map(lbl))} فقط — فجوة في ${joinAr(gaps.map(lbl))}`);
  if (engaged.length) {
    const short = engaged.filter((a) => N(a.availablePct) < needPct);
    if (!short.length) out.push(gaps.length ? 'يغطي الطاقة في أشهر ارتباطه' : 'يغطي الطاقة');
    else out.push(`المتاح أقل من المطلوب (${needPct}%) في ${joinAr(short.map((a) => `${lbl(a)} (${N(a.availablePct)}%)`))}`);
  }
  if (potentialOverPct > 100) out.push(`تعارض محتمل ${potentialOverPct}% في ${potentialMonth} إن اعتُمد الطلب المعلَّق`);
  const req = skills.filter((s) => s.required);
  const missing = req.filter((s) => s.state === 'missing');
  const unconfirmed = req.filter((s) => s.state === 'needs_confirmation');
  if (missing.length) out.push(`نقص في مهارة موثقة: ${missing.map((s) => s.name).join('، ')}`);
  if (unconfirmed.length) out.push(`مهارة تحتاج تأكيداً: ${unconfirmed.map((s) => s.name).join('، ')}`);
  if (req.length && !missing.length && !unconfirmed.length) out.push('المهارات المطلوبة موثقة');
  return out;
}

/**
 * S21 — من يصلح لهذا الاحتياج: قطاع مصدر العمل + وحدات المساندة، بمتاحهم شهراً شهراً داخل
 * فترة ارتباطهم (T25)، وطلباتهم المعلَّقة منفصلةً مع التعارض المحتمل (T26)، ومهاراتهم بحالة
 * توثيقها. الترتيب بالتغطية ثم الاسم — ولا رقم ملاءمة.
 */
export async function candidates(user, needId, { department, q } = {}) {
  const n = await loadReadableNeed(user, needId);
  // مدير المشروع يقارن مرشّحي احتياجه بسياج قطاعه (canPlanResources) — أسماء وطاقة ومهارات، لا مال.
  if (!canPlanResources(user)) throw forbidden('مقارنة المرشحين تتطلب صلاحية عرض الفريق أو «طلب تسكين» — اطلبها من مدير النظام');
  const months = monthsBetween(monthKeyOfDate(n.from_date), monthKeyOfDate(n.to_date));
  if (!months.length) throw badRequest('فترة الاحتياج غير صالحة — صحّح تاريخي البداية والنهاية');
  const needPct = N(n.fte_pct);
  const where = ['e.active = 1', 'e.deleted_at IS NULL'];
  const params = [];
  if (n.sector_id) { where.push('(e.sector_id = ? OR s.kind = ?)'); params.push(n.sector_id, SUPPORT_KIND); }
  else { where.push('s.kind = ?'); params.push(SUPPORT_KIND); }
  if (department) { where.push('e.department_id = ?'); params.push(String(department)); }
  const qq = String(q || '').trim().toLowerCase();
  if (qq) { where.push('(LOWER(e.name_ar) LIKE ? OR LOWER(COALESCE(e.job_title, \'\')) LIKE ?)'); params.push(`%${qq}%`, `%${qq}%`); }
  if (!seesDemoAccounts(user)) where.push(notDemoEmployeeSql('e'));
  // الصفوف تحت حدّ القارئ نفسه: من لا يقرأ الموظف لا يراه مرشحاً بتوفره ومهاراته — إلا وحدات
  // المساندة (مورد مشترك للقطاعات كلها كما في مرشّحي التسكين القائمين) فتبقى ظاهرة لكل قارئ.
  const scope = resourceScopeSql(user, 'e');
  where.push(`((${scope.clause}) OR s.kind = ?)`); params.push(...scope.params, SUPPORT_KIND);
  const emps = await all(`SELECT e.*, d.name_ar department_name, s.name_ar sector_name, s.kind sector_kind
       FROM employee e
       LEFT JOIN sector s ON s.id = e.sector_id AND s.deleted_at IS NULL
       LEFT JOIN department d ON d.id = e.department_id AND d.deleted_at IS NULL
      WHERE ${where.join(' AND ')} ORDER BY e.name_ar`, params);
  const ids = emps.map((e) => e.id);
  const fromKey = months[0].key; const toKey = months[months.length - 1].key;
  const { figures } = await figuresFor(ids, fromKey, toKey, { includePending: true });
  const skillRows = new Map();
  if (ids.length) {
    for (const r of await all(`SELECT employee_id, name_ar, level, reviewed_by FROM resource_capability
        WHERE kind = 'skill' AND deleted_at IS NULL AND employee_id IN (${ph(ids)})`, ids)) {
      if (!skillRows.has(r.employee_id)) skillRows.set(r.employee_id, []);
      skillRows.get(r.employee_id).push(r);
    }
  }
  const need = shapeNeed(n, { sourceLabel: (await sourceLabels([n])).get(`${n.source_kind}:${n.source_id}`), requests: (await requestsByNeed([n.id])).get(n.id) || [] });
  const wanted = [...need.skills.required.map((s) => ({ name: s, required: true })), ...need.skills.preferred.map((s) => ({ name: s, required: false }))];
  const withYear = months[0].year !== months[months.length - 1].year;
  const rows = [];
  for (const e of emps) {
    const fg = figures.get(e.id);
    if (!fg) continue;
    const availability = fg.months.map((f, i) => ({
      m: months[i], key: f.key, label_ar: monthLabelAr(months[i], withYear), state: f.state,
      availablePct: f.availablePct, confirmedPct: f.confirmedPct, tentativePct: f.tentativePct, pendingPct: f.pendingPct,
      potentialPct: f.state === 'out' ? null : N(f.confirmedPct) + N(f.pendingPct) + needPct,
      shortfall: f.state === 'out' ? null : Math.max(needPct - N(f.availablePct), 0),
    }));
    const engaged = availability.filter((a) => a.state !== 'out');
    const gaps = availability.filter((a) => a.state === 'out');
    let potentialOverPct = 0; let potentialMonth = null;
    for (const a of engaged) if (a.potentialPct > 100 && a.potentialPct > potentialOverPct) { potentialOverPct = a.potentialPct; potentialMonth = a.label_ar; }
    // الطلبات المعلَّقة من بنود الأشهر نفسها (طبقة pending في capacity-read) — أعلى نسبةٍ لكل طلب.
    const pend = new Map();
    for (const f of fg.months) for (const it of f.items) {
      if (it.status !== 'pending') continue;
      const cur = pend.get(it.requestId) || { id: it.requestId, pct: 0, label: it.label, months: [] };
      cur.pct = Math.max(cur.pct, N(it.pct)); cur.months.push(f.key); pend.set(it.requestId, cur);
    }
    const have = skillsOf(skillRows, e.id);
    const skills = wanted.map((w) => {
      const hit = have.find((h) => skillKey(h.name_ar) === skillKey(w.name));
      const state = !hit ? 'missing' : hit.reviewed_by ? 'verified' : 'needs_confirmation';
      return { name: w.name, required: w.required, state, state_ar: SKILL_STATE_AR[state], level: hit?.level || null };
    });
    const alreadyOnSource = fg.months.some((f) => f.items.some((it) => it.status !== 'pending' && it.targetId === n.source_id && it.kind === n.source_kind));
    rows.push({
      employeeId: e.id, name: e.name_ar, job_title: e.job_title || '', department_id: e.department_id || null,
      department_name: e.department_name || null, sector_id: e.sector_id || null, sector_name: e.sector_name || null,
      supportUnit: String(e.sector_kind || '') === SUPPORT_KIND, userId: e.user_id || null,
      skills,
      availability: availability.map(({ m, ...a }) => a),
      pendingRequests: [...pend.values()],
      fit_ar: fitSentences({ needPct, engaged, gaps, potentialOverPct, potentialMonth, skills, withYear }),
      eligible: engaged.length > 0,
      coversAllMonths: gaps.length === 0 && engaged.every((a) => N(a.availablePct) >= needPct),
      gapMonths: gaps.map((a) => a.key),
      minAvailablePct: engaged.length ? Math.min(...engaged.map((a) => N(a.availablePct))) : null,
      potentialOverPct,
      alreadyOnSource,
    });
  }
  rows.sort((a, b) => (Number(b.eligible) - Number(a.eligible)) || (Number(b.coversAllMonths) - Number(a.coversAllMonths))
    || (a.gapMonths.length - b.gapMonths.length) || (N(b.minAvailablePct) - N(a.minAvailablePct))
    || String(a.name).localeCompare(String(b.name), 'ar'));
  return {
    need, rows, total: rows.length,
    months: months.map((m) => ({ key: m.key, label_ar: monthLabelAr(m, withYear) })),
    basis_ar: 'المتاح محسوب من الطاقة التعاقدية المسجلة بعد التسكين المؤكد، شهراً شهراً داخل فترة الارتباط. الطلبات المعلَّقة تُعرض منفصلة ولا تُخصم، والتعارض المحتمل = المؤكد + المعلَّق + هذا الاحتياج. الأهلية: قطاع مصدر العمل ووحدات المساندة. لا نسبة ملاءمة رقمية — الجمل تقول ما يُغطَّى وما ينقص.',
  };
}

/**
 * S21 — اختيار مرشح = طلب تسكين عبر allocations.submitRequest بمعرّف الاحتياج. لا حجز مباشر هنا.
 * التكرار: طلبٌ معلَّق لهذا المورد على الاحتياج نفسه يُرفض برسالةٍ تسمّيه.
 */
/**
 * تحديث حالة الاحتياج المخزَّنة من تغطيته الفعلية — يُنادى بعد بتّ طلب تسكين مرتبط (تطبيق أو
 * رفض أو إعادة أو سحب) كي لا تبقى «قيد الترشيح» على احتياجٍ غُطّي، ولا «مغطى» على طلبٍ رُفض.
 * بلا مستخدم (إجراء نظامي يتبع القرار)؛ لا يمسّ الملغى ولا المسودة.
 */
/**
 * احتياجٌ يُرفق بطلب تسكين: يقرؤه الطالب ويملك تعديله، ووجهةُ الطلب هي مصدرُ الاحتياج نفسه
 * (مشروع الاحتياج أو بنده) — وإلا رُفض قبل أن يُكتب طلبٌ يقلب حالة احتياج لا يملكه.
 */
export async function assertNeedForRequest(user, needId, change = {}) {
  const n = await loadReadableNeed(user, needId);
  assertCanEdit(user, n);
  if (['cancelled'].includes(n.status)) throw badRequest('هذا الاحتياج ملغى — لا يُطلب له تسكين');
  const t = change?.target || {};
  const kind = String(t.kind || '').toLowerCase(); const tid = String(t.id || '');
  const okSource = (n.source_kind === 'project' && kind === 'project' && tid === n.source_id)
    || (n.source_kind === 'bucket' && kind === 'bucket' && tid === n.source_id);
  if (!okSource) throw badRequest('وجهة الطلب لا تطابق مصدر الاحتياج — يُطلب التسكين على العمل الذي سُجّل عليه الاحتياج');
  return n;
}

export async function refreshNeedStatus(needId, ctx = null) {
  const n = await get('SELECT * FROM resource_need WHERE id = ? AND deleted_at IS NULL', [needId]);
  if (!n || ['cancelled', 'draft'].includes(n.status)) return null;
  const cov = coverageOf(n, (await requestsByNeed([needId])).get(needId) || []);
  const next = cov.status === 'covered' ? 'covered' : cov.status === 'partial' ? 'partial'
    : cov.status === 'pending' ? 'shortlisting' : (n.status === 'shortlisting' || n.status === 'partial' || n.status === 'covered') ? 'open' : n.status;
  if (n.status !== next) {
    await update('resource_need', needId, { status: next, updated_at: nowIso() });
    if (ctx) await audit(ctx, { action: 'update', resource: 'resource_need', resourceId: needId, sectorId: n.sector_id || null,
      detail: { status: next, before: n.status, via: 'allocation_request', coverage: cov.status } });
  }
  return next;
}

export async function requestFromCandidate(ctx, needId, employeeId, { pct, allocStatus, idempotencyKey } = {}) {
  const user = ctx.user;
  const n = await loadReadableNeed(user, needId);
  assertCanEdit(user, n);
  if (n.status === 'cancelled') throw badRequest('الاحتياج ملغى — لا يُطلب تسكين عليه');
  if (n.source_kind === 'opportunity')
    throw badRequest('الاحتياج مسجَّل على فرصة — يُطلب التسكين بعد تحويلها إلى مشروع، وحتى ذلك الحين أضف المرشح إلى فريق الفرصة');
  const eid = String(employeeId == null ? '' : employeeId).trim();
  if (!eid) throw badRequest('اختر المرشح المطلوب تسكينه');
  const emp = await get('SELECT id, name_ar, sector_id, department_id FROM employee WHERE id = ? AND deleted_at IS NULL AND active = 1', [eid]);
  if (!emp) throw notFound('المرشح غير موجود أو غير نشط');
  const wantPct = pct === undefined || pct === null || pct === '' ? N(n.fte_pct)
    : intOrThrow(pct, { min: 1, max: 100, msg: 'نسبة التسكين المطلوبة رقم صحيح من 1 إلى 100' });
  const status = String(allocStatus || (n.certainty === 'tentative' ? 'tentative' : 'confirmed')).toLowerCase();
  if (!['confirmed', 'tentative'].includes(status)) throw badRequest('نوع التسكين المطلوب إما «مؤكد» أو «مبدئي»');
  const prior = await all(`SELECT id, status, created_at FROM allocation_request
      WHERE need_id = ? AND employee_id = ? AND deleted_at IS NULL AND status IN ('pending', 'applied', 'approved')
      ORDER BY created_at DESC`, [needId, eid]);
  const pendingReq = prior.find((r) => r.status === 'pending');
  if (pendingReq)
    throw badRequest(`يوجد طلب تسكين معلَّق لـ${emp.name_ar} على هذا الاحتياج (منذ ${String(pendingReq.created_at).slice(0, 10)}) — انتظر قراره أو اسحبه قبل طلبٍ جديد`);
  const applied = prior.find((r) => r.status !== 'pending');
  if (applied)
    throw badRequest(`${emp.name_ar} مسكَّن على هذا الاحتياج فعلاً — عدّل تسكينه من مصفوفة التسكين`);
  const fromKey = monthKeyOfDate(n.from_date); const toKey = monthKeyOfDate(n.to_date);
  const months = monthsBetween(fromKey, toKey);
  // طلب التسكين يغطي سنةً واحدة (وحدة allocation_request) — فالاحتياج الممتد على سنتين طلبٌ لكل سنة.
  const years = [...new Set(months.map((m) => m.year))];
  // مفتاح عدم التكرار للنقر المزدوج داخل الدقيقة؛ وطلبٌ أُعيد أو رُفض لا يحجب طلباً جديداً بعدها.
  const key = text(idempotencyKey, 120) || `need:${needId}:${eid}:${nowIso().slice(0, 16)}`;
  const { submitRequest } = await import('./allocations.js');
  const requests = []; const results = [];
  for (const y of years) {
    const ms = months.filter((m) => m.year === y);
    const change = {
      kind: 'new', employeeIds: [eid], target: { kind: n.source_kind, id: n.source_id },
      from: ms[0].key, to: ms[ms.length - 1].key, pct: wantPct, allocStatus: status,
      billable: n.source_kind === 'bucket' ? 0 : null, scope: 'month',
    };
    const result = await submitRequest(ctx, change, { idempotencyKey: years.length > 1 ? `${key}:${y}` : key, needId });
    results.push(result);
    for (const r of (Array.isArray(result?.requests) ? result.requests : [])) requests.push(r);
  }
  const requestIds = requests.map((r) => r.id).filter(Boolean);
  await tx(async () => {
    // حالة الاحتياج تتبع تغطيته: ما طُبِّق مباشرةً يغطّي الآن، وما عُلِّق يُبقيه «قيد الترشيح».
    const cov = coverageOf(n, (await requestsByNeed([needId])).get(needId) || []);
    const next = cov.status === 'covered' ? 'covered' : cov.status === 'partial' ? 'partial' : 'shortlisting';
    if (n.status !== next) await update('resource_need', needId, { status: next, updated_at: nowIso() });
    await audit(ctx, { action: 'request', resource: 'resource_need', resourceId: needId, sectorId: n.sector_id,
      detail: { employeeId: eid, pct: wantPct, allocStatus: status, from: fromKey, to: toKey, requestIds, status: next } });
  });
  return { need: await getNeed(user, needId), requests, requestId: requestIds[0] || null, requestIds,
    results: results.length === 1 ? results[0] : results, employee: { id: emp.id, name: emp.name_ar } };
}
