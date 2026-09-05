// ── دورة توزيع التكلفة الشهرية: المسودة ⇐ مراجعة المدير ⇐ المراجعة المالية ⇐ الإقفال ⇐ التصحيح ──
//
// «كيف تُوزَّع التكلفة شهرياً؟» — الموجّه §9. الفترة = قطاعٌ × شهر بإصدارٍ يبدأ من 1
// (`cost_period`)، وأسطرها نِسبٌ **بنقاط أساس** (10000 = 100%، `cost_share`) لا أعداد عائمة —
// «لا تحقق مساواة عائم هش» (§9.3). ولا مالَ هنا إطلاقاً: لا راتب ولا كلفة ولا قيمة — النسبة
// وحدها وجهةُ تحميلها (مشروعٌ بكوده المالي، أو القطاع بمركز تكلفته).
//
// القواعد المثبتة:
//   • الأهلية: من كان **مرتبطاً في الشهر** (engagedDays > 0 من نموذج الطاقة) — ومن سواه يُستبعد
//     بسببٍ مكتوب، ولا تُخترع له تكلفة.
//   • المسودة من التسكين المؤكد للشهر: لكل مشروعٍ نصيبُه بنسبته من مجموع المورد، والبنودُ
//     الداخلية وما لم يُسكَّن ⇐ سطر القطاع (`sector.cost_center` وإلا معرّف القطاع نفسه — رمزٌ
//     حقيقي في المنصة لا مخترَع). والمقام max(المجموع، 100): نقصٌ ⇐ بقيةٌ للقطاع، وتجاوزٌ ⇐
//     تناسب. والنسب من تكلفة الشهر لا من الطاقة: نصفُ دوامٍ مسكَّنٌ بكامله = 10000 للمشروع (T04).
//   • كودٌ مالي مفقود يبقى استثناءً ولو اكتمل المجموع (T28)؛ ومشروعٌ مغلقٌ اليوم كان قائماً في
//     الشهر بتواريخه يُقبل (T30)؛ ومجموعٌ ≠ 10000 استثناءٌ ورفضٌ يسمّي المجموع (T27).
//   • الإقفال داخل معاملة بإصدارٍ متوقَّع وتحديثٍ شرطي: إقفالان متزامنان ⇐ واحدٌ ينجح والآخر
//     يُردّ بتعارضٍ عربي بلا إصدارٍ ثانٍ (T31)؛ وبعده لا تعديل (T32) — التصحيح يُنشئ إصداراً
//     جديداً مقفلاً ويُبقي السابق بلقطته (T33)، وتصحيحٌ على إصدارٍ لم يعد الأحدث يُردّ (T34).
//   • التصدير من اللقطة المقفلة **حصراً** (T35)، وحالة الترحيل «لم يتم» دائماً — لا تكامل مالي
//     خارجي في هذه النسخة (T36).
//   • «المراجعة المالية» = مكتب الرئيس التنفيذي ومدير النظام (لا دور مالية — EXECUTION-LOG C1)،
//     ومراجعة المدير = قائد القطاع أو مدير الإدارة على أهل إدارته. الحدّ في الخدمة لا الواجهة.
import { all, get, run, insert, update, tx } from '../../core/db/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { audit } from '../../core/audit/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { departmentScope, departmentInSql } from '../../core/rbac/departments.js';
import { badRequest, forbidden, notFound, conflict } from '../../core/http/errors.js';
import { engagedDays, monthKey, monthStart, monthEnd, parseMonthKey } from './capacity-model.js';
import { figuresFor } from './capacity-read.js';
import { isFinanceReviewer, canManagerReview, canReadClose, resourceTypeOf, RESOURCE_TYPE_AR } from './access.js';
import { notDemoEmployeeSql } from '../org/people.js';

export const FULL_BP = 10000;

// ── التسميات العربية (مفاتيح داخلية + `_ar` حيث تُعرض) ──────────────────────────────────
export const PERIOD_STATUS_AR = Object.freeze({
  draft: 'مسودة', manager_review: 'مراجعة المدير', finance_review: 'المراجعة المالية', locked: 'مقفل', superseded: 'إصدار سابق',
});
export const REVIEW_STATUS_AR = Object.freeze({ draft: 'مسودة', confirmed: 'مؤكد', excluded: 'مستبعد', missing: 'بلا توزيع' });
export const TARGET_KIND_AR = Object.freeze({ project: 'مشروع', sector: 'القطاع' });
export const BASIS_AR = Object.freeze({ allocation: 'من التسكين المؤكد', manager: 'تعديل المدير', correction: 'تصحيح بعد الإقفال' });
export const TRANSFER_STATUS_AR = Object.freeze({ not_transferred: 'لم يتم' });
export const CORRECTION_STATUS_AR = Object.freeze({ draft: 'مسودة', pending: 'بانتظار القرار', approved: 'معتمد', rejected: 'مرفوض' });
export const EXCEPTION_AR = Object.freeze({
  missing_fin_code: 'كود مالي مفقود',
  sum_mismatch: 'المجموع لا يساوي 100%',
  project_inactive: 'مشروع خارج فترته في هذا الشهر',
  project_missing: 'مشروع غير موجود أو محذوف',
  no_lines: 'لا توزيع محفوظ',
  stale_lines: 'توزيع محفوظ لمورد خارج الارتباط',
});
const STAGES = [['draft', 'المسودة'], ['manager_review', 'مراجعة المدير'], ['finance_review', 'المراجعة المالية'], ['locked', 'مقفل']];
const EDITABLE = new Set(['draft', 'manager_review']);
export const EXPORT_COLUMNS = Object.freeze(['resource_id', 'month', 'sector', 'target_kind', 'fin_code', 'share_bp', 'share_pct',
  'basis', 'review_status', 'confirmed_by', 'confirmed_at', 'lock_version', 'correction_ref', 'note']);
export const BASIS_NOTE_AR = 'النسب من تكلفة الشهر بنقاط أساس (10000 = 100%): التسكين المؤكد يُوزَّع على المشاريع بأكوادها المالية، والعمل الداخلي وما لم يُسكَّن على مركز تكلفة القطاع — بلا أي قيمة مالية';

const ph = (arr) => arr.map(() => '?').join(',');
const N = (v) => Number(v) || 0;
export const bpToPct = (bp) => (N(bp) / 100).toFixed(2);
const keyOf = (p) => monthKey(Number(p.year), Number(p.month));
const sectorFinCode = (p) => p.sector_cost_center || p.sector_id;

// ── الحساب الصرف ──────────────────────────────────────────────────────────────────────

/** توزيع 10000 نقطة على أوزانٍ بطريقة أكبر الباقي — المجموع 10000 بالضبط دائماً، لا عائم. */
export function distributeBp(entries) {
  const total = entries.reduce((a, e) => a + N(e.weight), 0);
  if (!(total > 0)) return entries.map((e) => ({ ...e, bp: 0 }));
  const raw = entries.map((e) => (N(e.weight) * FULL_BP) / total);
  const bp = raw.map(Math.floor);
  let rest = FULL_BP - bp.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - bp[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) { if (rest <= 0) break; bp[o.i] += 1; rest -= 1; }
  return entries.map((e, i) => ({ ...e, bp: bp[i] }));
}

/** المشروع قائمٌ في الشهر بتواريخه لا بحالته اليوم (T30): بلا تواريخ يُقبل — لا يُخترع له تاريخ. */
export function projectActiveInMonth(p, year, month) {
  const s = String(p?.start_date || '').slice(0, 10);
  const e = String(p?.end_date || '').slice(0, 10);
  if (s && s > monthEnd(year, month)) return false;
  if (e && e < monthStart(year, month)) return false;
  return true;
}
const describeDates = (p) => {
  const parts = [];
  if (p.start_date) parts.push(`يبدأ ${String(p.start_date).slice(0, 10)}`);
  if (p.end_date) parts.push(`ينتهي ${String(p.end_date).slice(0, 10)}`);
  return parts.join('، ') || 'بلا تواريخ';
};

/** سبب استبعاد المورد من شهرٍ لم يكن مرتبطاً فيه — يُكتب في الصف ولا تُخترع له تكلفة. */
export function exclusionOf(emp, year, month) {
  if (engagedDays(emp, year, month) > 0) return null;
  const hire = String(emp.hire_date || '').slice(0, 10);
  const end = String(emp.end_date || '').slice(0, 10);
  if (Number(emp.active) === 0 && !end) return { code: 'inactive', label_ar: 'سجل مؤرشف بلا تاريخ مغادرة — لا تكلفة تُوزَّع' };
  if (hire && hire > monthEnd(year, month)) return { code: 'not_started', label_ar: `يبدأ ارتباطه في ${hire} — بعد نهاية الشهر` };
  if (end && end < monthStart(year, month)) return { code: 'ended', label_ar: `انتهى ارتباطه في ${end} — قبل بداية الشهر` };
  return { code: 'not_engaged', label_ar: 'خارج فترة الارتباط في هذا الشهر' };
}

/**
 * تركيب مسودة موردٍ من بنود شهره المؤكدة (نسبٌ من طاقته): المشاريع بنسبتها من المقام،
 * والبنود الداخلية وما لم يُسكَّن إلى سطر القطاع. المقام max(المجموع، 100).
 */
export function composeDraft(period, items, projects) {
  const byProject = new Map();
  const bucketNames = [];
  let bucketPct = 0; let total = 0;
  for (const it of items) {
    const pct = N(it.pct);
    if (pct <= 0) continue;
    total += pct;
    if (it.kind === 'project' && it.targetId) byProject.set(it.targetId, (byProject.get(it.targetId) || 0) + pct);
    else { bucketPct += pct; bucketNames.push(`${it.label || 'عمل داخلي'} ${pct}%`); }
  }
  const unassigned = Math.max(0, 100 - total);
  const entries = [...byProject].map(([pid, pct]) => ({ key: pid, kind: 'project', weight: pct }));
  const sectorWeight = bucketPct + unassigned;
  if (sectorWeight > 0) entries.push({ key: period.sector_id, kind: 'sector', weight: sectorWeight });
  const lines = distributeBp(entries).filter((e) => e.bp > 0).map((e) => {
    if (e.kind === 'project') {
      const p = projects.get(e.key);
      return { target_kind: 'project', target_id: e.key, fin_code: p?.financial_code || null, share_bp: e.bp, label: p?.name_ar || 'مشروع', note: null };
    }
    const parts = [];
    if (bucketNames.length) parts.push('عمل داخلي: ' + bucketNames.join('، '));
    if (unassigned > 0) parts.push(`غير مسكَّن ${unassigned}%`);
    return { target_kind: 'sector', target_id: period.sector_id, fin_code: sectorFinCode(period), share_bp: e.bp, label: period.sector_name || 'القطاع', note: parts.join(' + ') || null };
  });
  return { lines, total, basis: Math.max(total, 100), unassigned, bucketPct };
}

const lineKey = (l) => `${l.target_kind}:${l.target_id}`;
const sameLines = (a, b) => {
  if (a.length !== b.length) return false;
  const m = new Map(a.map((l) => [lineKey(l), N(l.share_bp)]));
  return b.every((l) => m.get(lineKey(l)) === N(l.share_bp));
};

// ── القراءة من القاعدة ────────────────────────────────────────────────────────────────
const PERIOD_SQL = `SELECT cp.*, s.name_ar AS sector_name, s.cost_center AS sector_cost_center
    FROM cost_period cp JOIN sector s ON s.id = cp.sector_id`;
async function loadPeriod(periodId) {
  const p = await get(`${PERIOD_SQL} WHERE cp.id = ?`, [periodId]);
  if (!p) throw notFound('فترة الإقفال غير موجودة — افتح الشهر من شاشة الإقفال');
  return p;
}
const latestVersion = (sectorId, year, month) => get(
  `${PERIOD_SQL} WHERE cp.sector_id = ? AND cp.year = ? AND cp.month = ? ORDER BY cp.version DESC LIMIT 1`, [sectorId, year, month]);

const EMP_SQL = `SELECT e.id, e.name_ar, e.job_title, e.department_id, e.sector_id, e.hire_date, e.end_date, e.active,
    e.capacity_pct, e.resource_type, e.employment_type, d.name_ar AS department_name
    FROM employee e LEFT JOIN department d ON d.id = e.department_id`;

/** اتساع قراءة الإقفال: شركة/قطاع/إدارة — الصفوف والعدادات تحت الحد نفسه. */
function closeBreadth(user) {
  if (!user) return 'none';
  if (user.role_id === 'admin' || isFinanceReviewer(user)) return 'company';
  const s = effectiveScope(user, 'read', 'cost_close');
  if (s === 'company' || s === 'sector') return s;
  if (s === 'department') return departmentScope(user).length ? 'department' : 'none';
  return 'none';
}
const employeeVisible = (user, emp) => closeBreadth(user) !== 'department' || departmentScope(user).includes(emp.department_id);

/** موارد القطاع في الفترة — بلا حسابات العرض أبداً (تكلفتها وهمية)، وبنطاق القارئ إن مُرِّر. */
async function periodEmployees(period, scopeUser = null) {
  const where = ['e.sector_id = ?', 'e.deleted_at IS NULL', notDemoEmployeeSql('e')];
  const params = [period.sector_id];
  if (scopeUser && closeBreadth(scopeUser) === 'department') {
    const d = departmentInSql('e.department_id', departmentScope(scopeUser));
    where.push(d.clause); params.push(...d.params);
  }
  return all(`${EMP_SQL} WHERE ${where.join(' AND ')} ORDER BY e.name_ar, e.id`, params);
}
async function loadPeriodEmployee(period, employeeId) {
  const emp = await get(`${EMP_SQL} WHERE e.id = ? AND e.deleted_at IS NULL AND ${notDemoEmployeeSql('e')}`, [employeeId]);
  if (!emp) throw notFound('المورد غير موجود — قد يكون سجله حُذف');
  if (emp.sector_id !== period.sector_id) {
    throw badRequest(`«${emp.name_ar}» ليس من قطاع هذه الفترة (${period.sector_name}) — يُوزَّع ضمن إقفال قطاعه هو`);
  }
  return emp;
}

async function loadProjects(pids) {
  const m = new Map();
  const ids = [...new Set((pids || []).filter(Boolean))];
  if (!ids.length) return m;
  // أسماء وأكواد وتواريخ فقط — لا قيمة ولا ميزانية ولا هامش.
  for (const p of await all(`SELECT id, name_ar, code, financial_code, status, start_date, end_date, sector_id, deleted_at
      FROM project WHERE id IN (${ph(ids)})`, ids)) m.set(p.id, p);
  return m;
}
async function loadLines(periodId, employeeId = null) {
  const params = [periodId];
  let extra = '';
  if (employeeId) { extra = ' AND cs.employee_id = ?'; params.push(employeeId); }
  const rows = await all(`SELECT cs.id, cs.period_id, cs.employee_id, cs.target_kind, cs.target_id, cs.fin_code, cs.share_bp,
      cs.basis, cs.review_status, cs.note, cs.created_by, cs.created_at, u.username AS created_by_username, u.name_ar AS created_by_name
      FROM cost_share cs LEFT JOIN app_user u ON u.id = cs.created_by
      WHERE cs.period_id = ? AND cs.deleted_at IS NULL${extra}
      ORDER BY cs.employee_id, cs.target_kind, cs.target_id, cs.id`, params);
  const projects = await loadProjects(rows.filter((r) => r.target_kind === 'project').map((r) => r.target_id));
  return { rows, projects };
}

/** مسودات مجموعة موارد من بنود الشهر المؤكدة — الحساب من capacity-read لا معادلة ثانية. */
async function draftLinesFor(period, employeeIds) {
  const out = new Map();
  const ids = (employeeIds || []).filter(Boolean);
  if (!ids.length) return out;
  const key = keyOf(period);
  const { ctx, figures } = await figuresFor(ids, key, key, { includePending: false });
  for (const eid of ids) {
    const m = figures.get(eid)?.months?.[0];
    const items = (m?.items || []).filter((it) => it.status === 'confirmed' && N(it.pct) > 0);
    out.set(eid, { ...composeDraft(period, items, ctx.projects), items, figures: m || null });
  }
  return out;
}

async function replaceLines(period, employeeId, lines, { basis, reviewStatus, userId, now, note = null }) {
  await run('UPDATE cost_share SET deleted_at = ?, updated_at = ? WHERE period_id = ? AND employee_id = ? AND deleted_at IS NULL',
    [now, now, period.id, employeeId]);
  const out = [];
  for (const l of lines) {
    const row = {
      id: id('cshr'), period_id: period.id, employee_id: employeeId, target_kind: l.target_kind, target_id: l.target_id,
      fin_code: l.fin_code || null, share_bp: N(l.share_bp), basis, review_status: reviewStatus,
      note: l.note || note || null, created_by: userId || null, created_at: now,
    };
    await insert('cost_share', row);
    out.push(row);
  }
  return out;
}

// ── التقييم: الاستثناءات والموانع لكل مورد ─────────────────────────────────────────────
function assessLine(l, period, projects, emp) {
  const exceptions = [];
  let resolved = l.fin_code || null;
  let label = '';
  if (l.target_kind === 'project') {
    const p = projects.get(l.target_id);
    label = p?.name_ar || 'مشروع';
    if (!p || p.deleted_at) exceptions.push({ code: 'project_missing', label_ar: `${EXCEPTION_AR.project_missing}: ${label}` });
    else {
      if (!projectActiveInMonth(p, period.year, period.month)) {
        exceptions.push({ code: 'project_inactive', label_ar: `${EXCEPTION_AR.project_inactive}: ${label} (${describeDates(p)})` });
      }
      resolved = l.fin_code || p.financial_code || null;
      if (!resolved) exceptions.push({ code: 'missing_fin_code', label_ar: `${EXCEPTION_AR.missing_fin_code}: ${label}` });
    }
  } else {
    label = period.sector_name || 'القطاع';
    resolved = l.fin_code || sectorFinCode(period);
  }
  return {
    id: l.id, employee_id: l.employee_id, employee_name: emp?.name_ar || null, department_id: emp?.department_id || null,
    target_kind: l.target_kind, target_id: l.target_id, label, fin_code: l.fin_code || null, resolved_fin_code: resolved,
    share_bp: N(l.share_bp), basis: l.basis, review_status: l.review_status, note: l.note || null,
    created_by: l.created_by || null, created_by_username: l.created_by_username || null, created_at: l.created_at || null,
    exceptions,
  };
}

async function assessRows(period, emps, lines, projects) {
  const byEmp = new Map();
  for (const l of lines) { if (!byEmp.has(l.employee_id)) byEmp.set(l.employee_id, []); byEmp.get(l.employee_id).push(l); }
  const rows = []; const excluded = []; const blockers = []; const assessed = [];
  for (const e of emps) {
    const mine = byEmp.get(e.id) || [];
    const base = {
      employeeId: e.id, name: e.name_ar, job_title: e.job_title || null, department_id: e.department_id || null,
      department_name: e.department_name || null, resourceType: resourceTypeOf(e), resourceType_ar: RESOURCE_TYPE_AR[resourceTypeOf(e)],
    };
    const ex = exclusionOf(e, period.year, period.month);
    if (ex) {
      const exceptions = mine.length ? [{ code: 'stale_lines', label_ar: `${EXCEPTION_AR.stale_lines} — أعد توليد المسودة` }] : [];
      rows.push({ ...base, excluded: ex, reviewStatus: 'excluded', reviewStatus_ar: REVIEW_STATUS_AR.excluded,
        projectsBp: 0, sectorBp: 0, unallocatedBp: 0, totalBp: 0, lines: [], exceptions });
      excluded.push({ employeeId: e.id, name: e.name_ar, code: ex.code, label_ar: ex.label_ar });
      if (exceptions.length) blockers.push({ employeeId: e.id, text: `${e.name_ar}: ${exceptions[0].label_ar}` });
      continue;
    }
    const outLines = mine.map((l) => assessLine(l, period, projects, e));
    assessed.push(...outLines);
    const total = outLines.reduce((a, l) => a + l.share_bp, 0);
    const projectsBp = outLines.filter((l) => l.target_kind === 'project').reduce((a, l) => a + l.share_bp, 0);
    const sectorBp = outLines.filter((l) => l.target_kind === 'sector').reduce((a, l) => a + l.share_bp, 0);
    const exceptions = outLines.flatMap((l) => l.exceptions);
    if (!mine.length) exceptions.push({ code: 'no_lines', label_ar: `${EXCEPTION_AR.no_lines} — أعد توليد المسودة` });
    else if (total !== FULL_BP) exceptions.push({ code: 'sum_mismatch', label_ar: `المجموع ${bpToPct(total)}% (${total} نقطة أساس) لا 100%` });
    const reviewStatus = !mine.length ? 'missing' : mine.every((l) => l.review_status === 'confirmed') ? 'confirmed' : 'draft';
    if (exceptions.length) blockers.push({ employeeId: e.id, text: `${e.name_ar}: ${exceptions.map((x) => x.label_ar).join('، ')}` });
    else if (reviewStatus !== 'confirmed') blockers.push({ employeeId: e.id, text: `${e.name_ar}: بانتظار تأكيد المدير` });
    rows.push({ ...base, excluded: null, reviewStatus, reviewStatus_ar: REVIEW_STATUS_AR[reviewStatus],
      projectsBp, sectorBp, unallocatedBp: Math.max(0, FULL_BP - total), totalBp: total, lines: outLines, exceptions });
  }
  // أسطرٌ يتيمة: موردٌ لم يعد في القطاع أو حُذف بعد التوزيع — مانعٌ يُسمّى بالاسم لا بالمعرّف.
  const known = new Set(emps.map((e) => e.id));
  const orphans = [...byEmp.keys()].filter((eid) => !known.has(eid));
  if (orphans.length) {
    const names = new Map((await all(`SELECT id, name_ar FROM employee WHERE id IN (${ph(orphans)})`, orphans)).map((r) => [r.id, r.name_ar]));
    for (const eid of orphans) blockers.push({ employeeId: eid, text: `${names.get(eid) || 'مورد محذوف'}: توزيع محفوظ لمورد لم يعد في القطاع — أعد توليد المسودة` });
  }
  const eligible = rows.filter((r) => !r.excluded);
  const counters = {
    resources: eligible.length,
    complete: eligible.filter((r) => r.reviewStatus === 'confirmed' && !r.exceptions.length).length,
    exceptions: eligible.filter((r) => r.exceptions.length).length,
    pending: eligible.filter((r) => r.reviewStatus !== 'confirmed').length,
    excluded: excluded.length,
  };
  return { rows, excluded, blockers, blockers_ar: blockers.map((b) => b.text), counters, lines: assessed, orphans };
}
async function assessPeriod(period) {
  const emps = await periodEmployees(period);            // الحقيقة كاملة بلا نطاق — الموانع لا تُقصّ
  const { rows: lines, projects } = await loadLines(period.id);
  return assessRows(period, emps, lines, projects);
}

// ── الإخراج ───────────────────────────────────────────────────────────────────────────
function stageSteps(status) {
  const idx = status === 'superseded' ? STAGES.length - 1 : STAGES.findIndex((s) => s[0] === status);
  const closed = status === 'locked' || status === 'superseded';
  return STAGES.map(([key, label_ar], i) => ({ key, label_ar, state: i < idx ? 'done' : i === idx ? (closed ? 'done' : 'current') : 'todo' }));
}
function periodMeta(p) {
  return {
    id: p.id, sector_id: p.sector_id, sector_name: p.sector_name || null, sector_fin_code: sectorFinCode(p),
    year: Number(p.year), month: Number(p.month), key: keyOf(p),
    status: p.status, status_ar: PERIOD_STATUS_AR[p.status] || p.status, version: Number(p.version),
    supersedes_id: p.supersedes_id || null, stage_steps: stageSteps(p.status),
    draft_generated_at: p.draft_generated_at || null, manager_confirmed_at: p.manager_confirmed_at || null,
    finance_note: p.finance_note || null, finance_locked_at: p.finance_locked_at || null, finance_locked_by: p.finance_locked_by || null,
    transfer: { status: p.transfer_status || 'not_transferred', status_ar: TRANSFER_STATUS_AR[p.transfer_status || 'not_transferred'] || 'لم يتم' },
  };
}
const lineOut = (l) => ({
  id: l.id, target_kind: l.target_kind, target_kind_ar: TARGET_KIND_AR[l.target_kind] || l.target_kind, target_id: l.target_id,
  label: l.label, fin_code: l.resolved_fin_code || null, shareBp: l.share_bp, sharePct: bpToPct(l.share_bp),
  basis: l.basis, basis_ar: BASIS_AR[l.basis] || l.basis, review_status: l.review_status,
  review_status_ar: REVIEW_STATUS_AR[l.review_status] || l.review_status, note: l.note || null,
  confirmed_by: l.review_status === 'confirmed' ? (l.created_by_username || null) : null,
  confirmed_at: l.review_status === 'confirmed' ? (l.created_at || null) : null,
  exceptions: l.exceptions,
});
const rowOut = (r) => ({ ...r, lines: r.lines.map(lineOut) });
const stripLine = (l) => ({ target_kind: l.target_kind, target_id: l.target_id, fin_code: l.fin_code || null, share_bp: N(l.share_bp), label: l.label || null, note: l.note || null });

const canExportClose = (user) => !!user && (user.role_id === 'admin' || can(user, 'export', 'cost_close'));
/** الإرسال إلى المراجعة المالية: قرار قطاعٍ كامل — قائد القطاع أو المراجعة المالية، لا مدير إدارةٍ وحده. */
function canSendToFinance(user, sectorId) {
  if (!user) return false;
  if (user.role_id === 'admin' || isFinanceReviewer(user)) return true;
  const s = effectiveScope(user, 'update', 'cost_close');
  return (s === 'company' || s === 'sector') && can(user, 'update', 'cost_close', { sector_id: sectorId, department_id: null });
}
function assertEditable(p, what) {
  if (EDITABLE.has(p.status)) return;
  const key = keyOf(p);
  if (p.status === 'locked') throw conflict(`الشهر ${key} مقفل (الإصدار ${p.version}) — ${what} غير ممكن بعد الإقفال؛ التعديل يكون بطلب تصحيح`);
  if (p.status === 'finance_review') throw conflict(`الشهر ${key} عند المراجعة المالية — ${what} غير ممكن حتى يُعاد إلى المدير`);
  if (p.status === 'superseded') throw conflict(`هذا إصدار سابق (${p.version}) من الشهر ${key} — افتح الإصدار الأحدث`);
  throw conflict(`حالة الشهر «${PERIOD_STATUS_AR[p.status] || p.status}» لا تسمح بـ${what}`);
}
const assertReader = (user, sectorId) => {
  if (!canReadClose(user, sectorId)) throw forbidden('شاشة الإقفال لمن يراجع توزيع التكلفة — قائد القطاع أو مدير الإدارة أو المراجعة المالية');
  // منحُ «إدارة» بلا إدارةٍ مُدارة (مدير إدارة لم تُسنَد إليه إدارة بعد) كان يمرّ من البوابة ثم
  // يُقرأ اتساعُه «لا شيء» فتُعامَل صفوفُ القطاع كلها كأنها داخل نطاقه — يُغلَق هنا: لا نطاق ⇒ لا شاشة.
  if (closeBreadth(user) === 'none') throw forbidden('لا إدارة مسندة إليك بعد — شاشة الإقفال تعرض موارد إدارتك فقط؛ اطلب إسناد الإدارة من قائد القطاع');
};

async function correctionsOf(periodId) {
  const rows = await all(`SELECT c.*, e.name_ar AS employee_name, ru.username AS requested_by_username, du.username AS decided_by_username
      FROM cost_correction c
      LEFT JOIN employee e ON e.id = c.employee_id
      LEFT JOIN app_user ru ON ru.id = c.requested_by
      LEFT JOIN app_user du ON du.id = c.decided_by
      WHERE c.period_id = ? ORDER BY c.created_at, c.id`, [periodId]);
  return rows.map(correctionOut);
}
function parseCorrection(c) {
  let raw = null;
  try { raw = JSON.parse(c.proposed_json || 'null'); } catch { raw = null; }
  if (Array.isArray(raw)) return { proposed: raw, previous: [], previous_version: null };
  return { proposed: raw?.proposed || [], previous: raw?.previous || [], previous_version: raw?.previous_version ?? null };
}
function correctionOut(c) {
  const body = parseCorrection(c);
  return {
    id: c.id, period_id: c.period_id, employee_id: c.employee_id, employee_name: c.employee_name || null,
    status: c.status, status_ar: CORRECTION_STATUS_AR[c.status] || c.status, reason: c.reason, evidence_label: c.evidence_label || null,
    proposed: body.proposed, previous: body.previous, previous_version: body.previous_version,
    requested_by: c.requested_by_username || c.requested_by || null, created_at: c.created_at,
    decided_by: c.decided_by_username || c.decided_by || null, decided_at: c.decided_at || null, decision_note: c.decision_note || null,
    result_period_id: c.result_period_id || null,
  };
}

async function overviewOf(user, p) {
  const a = await assessPeriod(p);
  const breadth = closeBreadth(user);
  const mine = (empId, deptId) => breadth !== 'department' || departmentScope(user).includes(deptId);
  const rows = a.rows.filter((r) => mine(r.employeeId, r.department_id)).map(rowOut);
  const excluded = a.excluded.filter((x) => rows.some((r) => r.employeeId === x.employeeId));
  const visibleIds = new Set(rows.map((r) => r.employeeId));
  const blockers_ar = breadth === 'department' ? a.blockers.filter((b) => visibleIds.has(b.employeeId)).map((b) => b.text) : a.blockers_ar;
  const eligible = rows.filter((r) => !r.excluded);
  const counters = breadth === 'department' ? {
    resources: eligible.length,
    complete: eligible.filter((r) => r.reviewStatus === 'confirmed' && !r.exceptions.length).length,
    exceptions: eligible.filter((r) => r.exceptions.length).length,
    pending: eligible.filter((r) => r.reviewStatus !== 'confirmed').length,
    excluded: excluded.length,
  } : a.counters;
  const editable = EDITABLE.has(p.status);
  const finance = isFinanceReviewer(user);
  const versions = (await all('SELECT id, version, status FROM cost_period WHERE sector_id = ? AND year = ? AND month = ? ORDER BY version',
    [p.sector_id, p.year, p.month])).map((v) => ({ id: v.id, version: Number(v.version), status: v.status, status_ar: PERIOD_STATUS_AR[v.status] || v.status }));
  const corrections = (p.status === 'locked' || p.status === 'superseded')
    ? (await correctionsOf(p.id)).filter((c) => breadth !== 'department' || visibleIds.has(c.employee_id)) : [];
  return {
    period: periodMeta(p),
    rows, excluded, counters, blockers_ar,
    canGenerate: editable && canManagerReview(user, p.sector_id),
    canSendToFinance: editable && !a.blockers.length && canSendToFinance(user, p.sector_id),
    canReturn: p.status === 'finance_review' && finance,
    canLock: p.status === 'finance_review' && finance && !a.blockers.length,
    canExport: !!p.locked_snapshot_json && canExportClose(user),
    canCorrect: p.status === 'locked' && canManagerReview(user, p.sector_id),
    corrections, versions,
    transfer: { status: p.transfer_status || 'not_transferred', status_ar: TRANSFER_STATUS_AR[p.transfer_status || 'not_transferred'] || 'لم يتم' },
    basis_ar: BASIS_NOTE_AR,
  };
}

// ── التوليد (المسودة) ─────────────────────────────────────────────────────────────────
/**
 * يعيد بناء أسطر المسودة للموارد في نطاق الفاعل. `preserveConfirmed`: لا يمسّ من أُكِّد توزيعه؛
 * `onlyMissing`: يملأ من لا أسطر له فقط (لفتح الشاشة). ويزيل أسطر من صار خارج الارتباط أو القطاع.
 */
async function regenerate(ctx, p, { preserveConfirmed = true, onlyMissing = false } = {}) {
  const user = ctx.user;
  const emps = await periodEmployees(p, user);
  const existing = new Map();
  for (const l of (await loadLines(p.id)).rows) { if (!existing.has(l.employee_id)) existing.set(l.employee_id, []); existing.get(l.employee_id).push(l); }
  const now = nowIso();
  const stats = { generated: [], kept: [], removed: [], excluded: [] };
  const eligible = emps.filter((e) => !exclusionOf(e, p.year, p.month));
  const drafts = await draftLinesFor(p, eligible.map((e) => e.id));
  const fullScope = closeBreadth(user) !== 'department';
  await tx(async () => {
    for (const e of emps) {
      const mine = existing.get(e.id) || [];
      const ex = exclusionOf(e, p.year, p.month);
      if (ex) {
        if (mine.length) {
          await run('UPDATE cost_share SET deleted_at = ?, updated_at = ? WHERE period_id = ? AND employee_id = ? AND deleted_at IS NULL', [now, now, p.id, e.id]);
          stats.removed.push(e.id);
        }
        stats.excluded.push({ employeeId: e.id, name: e.name_ar, code: ex.code, label_ar: ex.label_ar });
        continue;
      }
      if (mine.length && onlyMissing) { stats.kept.push(e.id); continue; }
      if (preserveConfirmed && mine.some((l) => l.review_status === 'confirmed')) { stats.kept.push(e.id); continue; }
      const d = drafts.get(e.id);
      if (!d) continue;
      await replaceLines(p, e.id, d.lines, { basis: 'allocation', reviewStatus: 'draft', userId: user?.id, now });
      stats.generated.push(e.id);
    }
    if (fullScope) {
      const known = new Set(emps.map((e) => e.id));
      for (const eid of existing.keys()) {
        if (known.has(eid)) continue;
        await run('UPDATE cost_share SET deleted_at = ?, updated_at = ? WHERE period_id = ? AND employee_id = ? AND deleted_at IS NULL', [now, now, p.id, eid]);
        stats.removed.push(eid);
      }
    }
    if (stats.generated.length || stats.removed.length) {
      const patch = { draft_generated_at: now, updated_at: now };
      // إعادة توليدٍ محت كل المؤكد تعيد الشهر إلى «مسودة» — الحالة تقول ما في الأسطر فعلاً.
      if (p.status === 'manager_review') {
        const left = await get(`SELECT COUNT(*) AS n FROM cost_share WHERE period_id = ? AND deleted_at IS NULL AND review_status = 'confirmed'`, [p.id]);
        if (!N(left?.n)) patch.status = 'draft';
      }
      await update('cost_period', p.id, patch);
      await audit(ctx, { action: 'generate_draft', resource: 'cost_period', resourceId: p.id, sectorId: p.sector_id, detail: {
        month: keyOf(p), version: p.version, preserveConfirmed, onlyMissing,
        generated: stats.generated.length, kept: stats.kept.length, removed: stats.removed.length, excluded: stats.excluded,
      } });
    }
  });
  return stats;
}

async function createPeriod(ctx, sector, year, month) {
  const now = nowIso();
  const pid = id('cper');
  await tx(async () => {
    await insert('cost_period', {
      id: pid, sector_id: sector.id, year, month, version: 1, status: 'draft', transfer_status: 'not_transferred',
      created_by: ctx.user?.id || null, created_at: now,
    });
    await audit(ctx, { action: 'create', resource: 'cost_period', resourceId: pid, sectorId: sector.id, detail: { month: monthKey(year, month), version: 1 } });
  });
  return loadPeriod(pid);
}

function resolveMonth({ year, month, period } = {}) {
  let y = Number(year); let m = Number(month);
  if (period) {
    const k = parseMonthKey(period);
    if (!k) throw badRequest('اكتب الشهر بصيغة سنة-شهر (مثل 2026-06)');
    y = k.year; m = k.month;
  }
  if (!year && !month && !period) {
    // الافتراضي: الشهر المنقضي — وهو ما يُقفل عادةً.
    const d = new Date(); let yy = d.getUTCFullYear(); let mm = d.getUTCMonth();   // 0..11 = الشهر السابق
    if (mm === 0) { mm = 12; yy -= 1; }
    y = yy; m = mm;
  }
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 2000 || y > 2100) throw badRequest('اختر سنةً وشهراً صحيحين (الشهر من 1 إلى 12)');
  const now = new Date();
  if (monthKey(y, m) > monthKey(now.getUTCFullYear(), now.getUTCMonth() + 1)) throw badRequest(`لا يُفتح إقفال لشهر لم يبدأ بعد (${monthKey(y, m)})`);
  return { year: y, month: m };
}

// ══ الواجهة العامة ═══════════════════════════════════════════════════════════════════

/** S22 — نظرة الشهر: ينشئ المسودة (الإصدار 1) إن لم توجد، ويملأ من لا أسطر له، ثم يقيّم. */
// `mutate`: القراءة تنشئ مسودة الشهر وتستكمل أسطر الناقصين **لمن يراجعها** — إلا حين يصل الطلب من
// موقعٍ آخر (رابطٌ خبيث يفتح الشاشة بجلسة القارئ): عندها قراءةٌ صرفة بلا إنشاء ولا حذف أسطر.
export async function periodOverview(user, { sector, year, month, period, mutate = true, ip = null } = {}) {
  if (!user) throw forbidden();
  const sectorId = sector || (user.scope !== 'company' ? user.sector_id : null);
  if (!sectorId) throw badRequest('اختر القطاع أولاً — الإقفال يُدار لكل قطاع على حدة');
  assertReader(user, sectorId);
  const { year: y, month: m } = resolveMonth({ year, month, period });
  const sec = await get('SELECT id, name_ar, cost_center FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  if (!sec) throw notFound('القطاع غير موجود — اختر قطاعاً من القائمة');
  const ctx = { user, ip: ip || null };
  let p = await latestVersion(sec.id, y, m);
  const mayWrite = mutate && canManagerReview(user, sec.id);
  if (!p) {
    if (!mayWrite) return { period: null, sector: { id: sec.id, name_ar: sec.name_ar }, year: y, month: m, rows: [], excluded: [], counters: { resources: 0, complete: 0, exceptions: 0, pending: 0, excluded: 0 },
      blockers_ar: [], canGenerate: false, canSendToFinance: false, canReturn: false, canLock: false, canExport: false, canCorrect: false, corrections: [], versions: [],
      transfer: { status: 'not_transferred', status_ar: TRANSFER_STATUS_AR.not_transferred || 'لم يتم' }, basis_ar: BASIS_NOTE_AR,
      note_ar: 'لم تُنشأ مسودة هذا الشهر بعد — تُنشأ حين يفتحها قائد القطاع أو مدير الإدارة أو المراجعة المالية' };
    p = await createPeriod(ctx, sec, y, m);
  }
  if (mayWrite && EDITABLE.has(p.status)) {
    const st = await regenerate(ctx, p, { preserveConfirmed: true, onlyMissing: true });
    if (st.generated.length || st.removed.length) p = await loadPeriod(p.id);
  }
  return overviewOf(user, p);
}

/** نفس النظرة بمعرّف الفترة (S24 وبعد كل إجراء). */
export async function periodDetail(user, periodId) {
  const p = await loadPeriod(periodId);
  assertReader(user, p.sector_id);
  return overviewOf(user, p);
}

/** توليد المسودة صراحةً: يعيد بناء غير المؤكد، و`preserveConfirmed:false` يعيد بناء الكل. */
export async function generateDraft(ctx, periodId, { preserveConfirmed = true } = {}) {
  const user = ctx?.user;
  const p = await loadPeriod(periodId);
  if (!canManagerReview(user, p.sector_id)) throw forbidden('توليد مسودة التوزيع لمن يراجعها — قائد القطاع أو مدير الإدارة أو المراجعة المالية');
  assertEditable(p, 'توليد المسودة');
  const stats = await regenerate(ctx, p, { preserveConfirmed: preserveConfirmed !== false && preserveConfirmed !== 0 && preserveConfirmed !== '0' && preserveConfirmed !== 'false', onlyMissing: false });
  const view = await overviewOf(user, await loadPeriod(p.id));
  return { ...view, generated: stats.generated.length, kept: stats.kept.length, removed: stats.removed.length, excludedNow: stats.excluded };
}

/** S23 — توزيع موردٍ واحد: مرجع التسكين، الأسطر المحفوظة، والفرق عن المسودة المحسوبة. */
export async function resourceShares(user, periodId, employeeId) {
  const p = await loadPeriod(periodId);
  assertReader(user, p.sector_id);
  const emp = await loadPeriodEmployee(p, employeeId);
  if (!employeeVisible(user, emp)) throw forbidden('هذا المورد خارج نطاقك في هذا الشهر — تراجع توزيع أهل إدارتك');
  const ex = exclusionOf(emp, p.year, p.month);
  const { rows: lines, projects } = await loadLines(p.id, emp.id);
  const a = await assessRows(p, [emp], lines, projects);
  const row = a.rows[0];
  const drafts = await draftLinesFor(p, [emp.id]);
  const d = drafts.get(emp.id);
  const m = d?.figures;
  const reference = {
    key: keyOf(p), state: m?.state || 'out', confirmedPct: m?.confirmedPct ?? null, tentativePct: m?.tentativePct ?? null,
    capacity: m ? { engagedDays: m.capacity.engagedDays, days: m.capacity.days, nominalPct: m.capacity.nominalPct, state: m.capacity.state } : null,
    items: (m?.items || []).map((it) => ({ kind: it.kind, targetId: it.targetId, label: it.label, pct: it.pct, status: it.status, billable: !!it.billable })),
    basis_ar: BASIS_NOTE_AR,
  };
  const draft = ex ? [] : (d?.lines || []).map(stripLine);
  let draftDiff_ar;
  if (ex) draftDiff_ar = ex.label_ar;
  else if (!row.lines.length) draftDiff_ar = 'لا توزيع محفوظ بعد — يُولَّد من التسكين المؤكد للشهر';
  else if (sameLines(row.lines, draft)) draftDiff_ar = 'مطابق للتسكين المؤكد للشهر';
  else {
    const cur = new Map(row.lines.map((l) => [lineKey(l), l]));
    const dm = new Map(draft.map((l) => [lineKey(l), l]));
    const keys = [...new Set([...cur.keys(), ...dm.keys()])];
    const parts = keys.map((k) => {
      const c = cur.get(k); const dd = dm.get(k);
      return `${(c || dd).label}: ${bpToPct(c?.share_bp || 0)}% بدل ${bpToPct(dd?.share_bp || 0)}%`;
    });
    draftDiff_ar = 'يختلف عن التسكين المؤكد — ' + parts.join('؛ ');
  }
  return {
    period: periodMeta(p),
    resource: { id: emp.id, name: emp.name_ar, job_title: emp.job_title || null, department_id: emp.department_id || null,
      department_name: emp.department_name || null, resourceType: resourceTypeOf(emp), resourceType_ar: RESOURCE_TYPE_AR[resourceTypeOf(emp)] },
    excluded: ex,
    reference,
    lines: row.lines.map(lineOut),
    totalBp: row.totalBp, projectsBp: row.projectsBp, sectorBp: row.sectorBp, unallocatedBp: row.unallocatedBp,
    exceptions: row.exceptions, reviewStatus: row.reviewStatus, reviewStatus_ar: row.reviewStatus_ar,
    draft, draftDiff_ar,
    canConfirm: EDITABLE.has(p.status) && !ex && canManagerReview(user, p.sector_id, emp.department_id),
    canCorrect: p.status === 'locked' && canManagerReview(user, p.sector_id, emp.department_id),
  };
}

/** فحص أسطرٍ مرسلة: نقاط أساس صحيحة، مجموع 10000، مشاريع قائمة في الشهر، والقطاع قطاعُ الفترة. */
async function normalizeLines(p, lines, { strictFinCode = false } = {}) {
  if (!Array.isArray(lines) || !lines.length) throw badRequest('أضف سطر توزيع واحداً على الأقل — مشروع أو القطاع');
  const seen = new Set(); const out = []; let total = 0;
  for (const raw of lines) {
    const kind = String(raw?.target_kind || raw?.targetKind || '').toLowerCase();
    const bp = Number(raw?.shareBp ?? raw?.share_bp);
    if (!Number.isInteger(bp) || bp <= 0 || bp > FULL_BP) throw badRequest('النسبة تُكتب بنقاط أساس صحيحة بين 1 و10000 (10000 = 100%)');
    let tid;
    if (kind === 'sector') {
      tid = raw.target_id || raw.targetId || p.sector_id;
      if (tid !== p.sector_id) throw badRequest(`سطر القطاع يُحمَّل على قطاع الفترة نفسه (${p.sector_name}) لا على قطاع آخر`);
    } else if (kind === 'project') {
      tid = raw.target_id || raw.targetId;
      if (!tid) throw badRequest('اختر المشروع لسطر التحميل');
    } else throw badRequest('جهة التحميل إما مشروع أو القطاع');
    const k = `${kind}:${tid}`;
    if (seen.has(k)) throw badRequest('جهة التحميل مكررة في أكثر من سطر — اجمعها في سطر واحد');
    seen.add(k);
    out.push({ target_kind: kind, target_id: tid, share_bp: bp, note: raw?.note ? String(raw.note).slice(0, 300) : null });
    total += bp;
  }
  if (total !== FULL_BP) {
    throw badRequest(`مجموع التوزيع ${bpToPct(total)}% (${total} نقطة أساس) — يجب أن يساوي 100% بالضبط (10000 نقطة أساس)`, { totalBp: total });
  }
  const projects = await loadProjects(out.filter((l) => l.target_kind === 'project').map((l) => l.target_id));
  for (const l of out) {
    if (l.target_kind === 'sector') { l.fin_code = sectorFinCode(p); l.label = p.sector_name || 'القطاع'; continue; }
    const pr = projects.get(l.target_id);
    if (!pr || pr.deleted_at) throw notFound('المشروع المختار غير موجود أو محذوف — اختر مشروعاً قائماً');
    if (!projectActiveInMonth(pr, p.year, p.month)) {
      throw badRequest(`المشروع «${pr.name_ar}» لم يكن قائماً في ${keyOf(p)} (${describeDates(pr)}) — اختر جهة تحميل كانت قائمة في الشهر`);
    }
    l.fin_code = pr.financial_code || null;
    l.label = pr.name_ar;
    if (strictFinCode && !l.fin_code) throw badRequest(`المشروع «${pr.name_ar}» بلا كود مالي — سجّل كوده المالي في صفحة المشروع قبل التصحيح`);
  }
  return { lines: out, projects };
}

/** S23 — تأكيد المدير لتوزيع مورد (لا يقفل شيئاً). T27/T28/T04/T30. */
export async function confirmShares(ctx, periodId, employeeId, { lines, reason, sourceRef } = {}) {
  const user = ctx?.user;
  const p = await loadPeriod(periodId);
  assertEditable(p, 'تأكيد التوزيع');
  const emp = await loadPeriodEmployee(p, employeeId);
  // الكتابة لا تتسع عن القراءة: ما لا يراه المراجع في نظرته لا يؤكّده (نظير `resourceShares`).
  if (!employeeVisible(user, emp) || !canManagerReview(user, p.sector_id, emp.department_id)) throw forbidden('تأكيد توزيع هذا المورد لمدير إدارته أو قائد قطاعه أو المراجعة المالية');
  const ex = exclusionOf(emp, p.year, p.month);
  if (ex) throw badRequest(`لا توزيع لـ«${emp.name_ar}» في ${keyOf(p)}: ${ex.label_ar}`);
  const norm = await normalizeLines(p, lines);
  const draft = (await draftLinesFor(p, [emp.id])).get(emp.id);
  const basis = draft && sameLines(norm.lines, draft.lines) ? 'allocation' : 'manager';
  const before = (await loadLines(p.id, emp.id)).rows.map(stripLine);
  const why = reason ? String(reason).trim().slice(0, 500) : null;
  const now = nowIso();
  await tx(async () => {
    await replaceLines(p, emp.id, norm.lines, { basis, reviewStatus: 'confirmed', userId: user.id, now, note: why });
    const patch = { manager_confirmed_by: user.id, manager_confirmed_at: now, updated_at: now };
    if (p.status === 'draft') patch.status = 'manager_review';
    await update('cost_period', p.id, patch);
    await audit(ctx, { action: 'confirm', resource: 'cost_share', resourceId: p.id, sectorId: p.sector_id, detail: {
      periodId: p.id, employeeId: emp.id, month: keyOf(p), version: p.version, basis, reason: why,
      sourceRef: sourceRef ? String(sourceRef).slice(0, 200) : null, before, after: norm.lines.map(stripLine),
    } });
  });
  return resourceShares(user, p.id, emp.id);
}

/** المسودة/مراجعة المدير ⇐ المراجعة المالية، بلا موانع. */
export async function sendToFinance(ctx, periodId) {
  const user = ctx?.user;
  const p = await loadPeriod(periodId);
  if (!canSendToFinance(user, p.sector_id)) throw forbidden('إرسال الشهر إلى المراجعة المالية لقائد القطاع أو المراجعة المالية');
  assertEditable(p, 'الإرسال إلى المراجعة المالية');
  const a = await assessPeriod(p);
  if (a.blockers.length) {
    const n = a.blockers.length;
    throw badRequest(`لا يمكن الإرسال إلى المراجعة المالية — ${n === 1 ? 'مانع واحد' : n === 2 ? 'مانعان' : `${n} موانع`}: ${a.blockers_ar.slice(0, 5).join(' · ')}`, { blockers_ar: a.blockers_ar });
  }
  const now = nowIso();
  await tx(async () => {
    const r = await run(`UPDATE cost_period SET status = 'finance_review', updated_at = ? WHERE id = ? AND status IN ('draft','manager_review')`, [now, p.id]);
    if (!r.changes) throw conflict('تغيّرت حالة الشهر للتو من مستخدم آخر — أعد التحميل');
    await audit(ctx, { action: 'send_to_finance', resource: 'cost_period', resourceId: p.id, sectorId: p.sector_id, detail: {
      month: keyOf(p), version: p.version, resources: a.counters.resources, lines: a.lines.length,
    } });
  });
  return periodDetail(user, p.id);
}

/** المراجعة المالية ⇐ مراجعة المدير، بسببٍ مكتوب. */
export async function returnToManager(ctx, periodId, reason) {
  const user = ctx?.user;
  if (!isFinanceReviewer(user)) throw forbidden('إعادة الشهر إلى المدير للمراجعة المالية (مكتب الرئيس التنفيذي) أو مدير النظام');
  const p = await loadPeriod(periodId);
  if (p.status !== 'finance_review') throw conflict(`الشهر ${keyOf(p)} ليس عند المراجعة المالية (حالته: ${PERIOD_STATUS_AR[p.status] || p.status}) — لا شيء يُعاد`);
  const why = String(reason || '').trim();
  if (why.length < 3) throw badRequest('اكتب سبب الإعادة إلى المدير — يظهر له في شاشة الشهر ويُحفظ في الأثر');
  const now = nowIso();
  await tx(async () => {
    const r = await run(`UPDATE cost_period SET status = 'manager_review', finance_note = ?, updated_at = ? WHERE id = ? AND status = 'finance_review'`, [why.slice(0, 500), now, p.id]);
    if (!r.changes) throw conflict('تغيّرت حالة الشهر للتو من مستخدم آخر — أعد التحميل');
    await audit(ctx, { action: 'return_to_manager', resource: 'cost_period', resourceId: p.id, sectorId: p.sector_id, detail: { month: keyOf(p), version: p.version, reason: why } });
  });
  return periodDetail(user, p.id);
}

function buildSnapshot(p, a, { user, now }) {
  return {
    period_id: p.id, sector_id: p.sector_id, sector_name: p.sector_name || null, sector_fin_code: sectorFinCode(p),
    year: Number(p.year), month: Number(p.month), key: keyOf(p), version: Number(p.version), supersedes_id: p.supersedes_id || null,
    locked_at: now, locked_by: { id: user.id, username: user.username || null, name: user.name_ar || null },
    lines: a.lines.map((l) => ({
      id: l.id, employee_id: l.employee_id, employee_name: l.employee_name, department_id: l.department_id,
      target_kind: l.target_kind, target_id: l.target_id, target_label: l.label, fin_code: l.resolved_fin_code,
      share_bp: l.share_bp, basis: l.basis, review_status: l.review_status,
      confirmed_by: l.created_by_username || l.created_by || null, confirmed_by_id: l.created_by || null, confirmed_at: l.created_at || null,
      note: l.note || null, correction_ref: null,
    })),
    excluded: a.excluded,
    corrections: [],
    totals: { resources: a.counters.resources, lines: a.lines.length },
    transfer_status: 'not_transferred',
  };
}
function parseSnapshot(p) {
  let s = null;
  try { s = JSON.parse(p.locked_snapshot_json || 'null'); } catch { s = null; }
  if (!s || !Array.isArray(s.lines)) throw badRequest('لقطة الإقفال غير مقروءة — راجع مدير النظام');
  return s;
}

/** T31/T32 — الإقفال المالي داخل معاملة بإصدارٍ متوقَّع وتحديثٍ شرطي. */
export async function lockPeriod(ctx, periodId, { expectedVersion } = {}) {
  const user = ctx?.user;
  if (!isFinanceReviewer(user)) throw forbidden('الإقفال المالي للشهر لمكتب الرئيس التنفيذي أو مدير النظام فقط');
  const ev = Number(expectedVersion);
  if (!Number.isInteger(ev) || ev < 1) throw badRequest('أرسل رقم الإصدار الذي تراه على الشاشة مع طلب الإقفال');
  const check = (p) => {
    if (Number(p.version) !== ev) throw conflict(`الإصدار الذي تراه (${ev}) يختلف عن الإصدار الحالي (${p.version}) — أعد تحميل الشهر ثم أقفله`);
    if (p.status === 'locked') throw conflict(`الشهر ${keyOf(p)} مقفل أصلاً (الإصدار ${p.version}) — لا يُقفل مرتين`);
    if (p.status !== 'finance_review') throw conflict(`الشهر ${keyOf(p)} ليس عند المراجعة المالية (حالته: ${PERIOD_STATUS_AR[p.status] || p.status}) — أرسله إلى المراجعة المالية أولاً`);
  };
  check(await loadPeriod(periodId));
  return tx(async () => {
    const p = await loadPeriod(periodId);          // إعادة القراءة داخل المعاملة
    check(p);
    const a = await assessPeriod(p);               // إعادة التحقق: كل الأسطر صالحة ومؤكدة
    if (a.blockers.length) {
      const n = a.blockers.length;
      throw badRequest(`لا يمكن الإقفال — ${n === 1 ? 'مانع واحد' : n === 2 ? 'مانعان' : `${n} موانع`}: ${a.blockers_ar.slice(0, 5).join(' · ')}`, { blockers_ar: a.blockers_ar });
    }
    const now = nowIso();
    // الأكواد المالية تُثبَّت على الأسطر كما حُلّت لحظة الإقفال — فتطابق اللقطة حرفاً.
    for (const l of a.lines) {
      if (l.fin_code !== l.resolved_fin_code) await run('UPDATE cost_share SET fin_code = ?, updated_at = ? WHERE id = ?', [l.resolved_fin_code, now, l.id]);
    }
    const snapshot = buildSnapshot(p, a, { user, now });
    const r = await run(`UPDATE cost_period SET status = 'locked', locked_snapshot_json = ?, finance_locked_by = ?, finance_locked_at = ?, updated_at = ?
        WHERE id = ? AND status = 'finance_review' AND version = ?`, [JSON.stringify(snapshot), user.id, now, now, p.id, ev]);
    if (!r.changes) throw conflict('أُقفل هذا الشهر للتو من مستخدم آخر — أعد التحميل لترى الإصدار المقفل');
    await audit(ctx, { action: 'lock', resource: 'cost_period', resourceId: p.id, sectorId: p.sector_id, detail: {
      month: keyOf(p), version: ev, resources: snapshot.totals.resources, lines: snapshot.totals.lines,
    } });
    return {
      periodId: p.id, version: ev, status: 'locked', status_ar: PERIOD_STATUS_AR.locked, locked_at: now,
      resources: snapshot.totals.resources, lines: snapshot.totals.lines,
      transfer: { status: 'not_transferred', status_ar: TRANSFER_STATUS_AR.not_transferred },
    };
  });
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;                  // حارس حقن المعادلات
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** T35/T36 — التصدير من اللقطة المقفلة حصراً؛ بلا أي قيمة مالية. */
export async function exportPeriod(user, periodId) {
  if (!canExportClose(user)) throw forbidden('تصدير ملف الإقفال للمراجعة المالية (مكتب الرئيس التنفيذي) أو مدير النظام');
  const p = await loadPeriod(periodId);
  if (!p.locked_snapshot_json || !(p.status === 'locked' || p.status === 'superseded')) {
    throw badRequest('لا يُصدَّر إلا شهر مقفل — أكمل المراجعة المالية والإقفال أولاً');
  }
  const snap = parseSnapshot(p);
  const rows = snap.lines.map((l) => ({
    resource_id: l.employee_id, month: snap.key, sector: snap.sector_id, target_kind: l.target_kind, fin_code: l.fin_code || '',
    share_bp: N(l.share_bp), share_pct: bpToPct(l.share_bp), basis: l.basis, review_status: l.review_status,
    confirmed_by: l.confirmed_by || '', confirmed_at: l.confirmed_at || '', lock_version: snap.version,
    correction_ref: l.correction_ref || '', note: l.note || '',
  }));
  const csv = [EXPORT_COLUMNS.join(','), ...rows.map((r) => EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
  await audit({ user, ip: null }, { action: 'export', resource: 'cost_period', resourceId: p.id, sectorId: p.sector_id, detail: { month: snap.key, version: snap.version, lines: rows.length } });
  return {
    filename: `cost-close-${p.sector_id}-${snap.key}-v${snap.version}.csv`, csv, version: Number(snap.version), lines: rows.length,
    transfer: { status: 'not_transferred', status_ar: TRANSFER_STATUS_AR.not_transferred },
  };
}

/** S25/T33 — طلب تصحيح على إصدارٍ مقفل: يحمل القديم من اللقطة والمقترح والسبب، وينتظر المراجع المالي. */
export async function createCorrection(ctx, periodId, employeeId, { proposed, reason, evidenceLabel } = {}) {
  const user = ctx?.user;
  const p = await loadPeriod(periodId);
  if (p.status === 'superseded') {
    const latest = await latestVersion(p.sector_id, p.year, p.month);
    throw conflict(`هذا الإصدار (${p.version}) لم يعد الأحدث — أنشئ طلب التصحيح على الإصدار ${latest?.version || '؟'}`);
  }
  if (p.status !== 'locked') throw badRequest('طلب التصحيح لشهر مقفل فقط — الشهر غير المقفل يُعدَّل توزيعه مباشرة من شاشة المراجعة');
  const emp = await loadPeriodEmployee(p, employeeId);
  if (!employeeVisible(user, emp) || !canManagerReview(user, p.sector_id, emp.department_id)) throw forbidden('طلب التصحيح لمدير إدارة المورد أو قائد قطاعه أو المراجعة المالية');
  const why = String(reason || '').trim();
  if (why.length < 3) throw badRequest('اكتب سبب التصحيح — يُحفظ مع الطلب ويقرؤه المراجع المالي');
  const snap = parseSnapshot(p);
  const previous = snap.lines.filter((l) => l.employee_id === emp.id).map(stripLine);
  if (!previous.length && exclusionOf(emp, p.year, p.month)) {
    throw badRequest(`«${emp.name_ar}» ليس في لقطة هذا الشهر وخارج فترة الارتباط فيه — لا تكلفة تُصحَّح`);
  }
  const norm = await normalizeLines(p, proposed, { strictFinCode: true });
  if (sameLines(norm.lines, previous)) throw badRequest('المقترح مطابق للتوزيع المقفل — لا حاجة لتصحيح');
  const dup = await get(`SELECT id FROM cost_correction WHERE period_id = ? AND employee_id = ? AND status = 'pending'`, [p.id, emp.id]);
  if (dup) throw conflict(`يوجد طلب تصحيح معلق لـ«${emp.name_ar}» على هذا الشهر — انتظر قراره قبل طلب آخر`);
  const now = nowIso();
  const cid = id('ccor');
  const payload = { proposed: norm.lines.map(stripLine), previous, previous_version: Number(p.version) };
  await tx(async () => {
    await insert('cost_correction', {
      id: cid, period_id: p.id, employee_id: emp.id, proposed_json: JSON.stringify(payload), reason: why.slice(0, 500),
      evidence_label: evidenceLabel ? String(evidenceLabel).slice(0, 200) : null, status: 'pending', requested_by: user.id, created_at: now,
    });
    await audit(ctx, { action: 'create', resource: 'cost_correction', resourceId: cid, sectorId: p.sector_id, detail: {
      periodId: p.id, employeeId: emp.id, month: keyOf(p), version: p.version, reason: why, previous, proposed: payload.proposed,
    } });
  });
  return getCorrection(user, cid);
}

export async function getCorrection(user, correctionId) {
  const c = await get(`SELECT c.*, e.name_ar AS employee_name, e.department_id AS employee_department_id, ru.username AS requested_by_username, du.username AS decided_by_username
      FROM cost_correction c LEFT JOIN employee e ON e.id = c.employee_id
      LEFT JOIN app_user ru ON ru.id = c.requested_by LEFT JOIN app_user du ON du.id = c.decided_by
      WHERE c.id = ?`, [correctionId]);
  if (!c) throw notFound('طلب التصحيح غير موجود');
  const p = await loadPeriod(c.period_id);
  assertReader(user, p.sector_id);
  if (!employeeVisible(user, { department_id: c.employee_department_id })) throw forbidden('هذا الطلب لمورد خارج نطاقك');
  return { ...correctionOut(c), period: periodMeta(p) };
}

export async function listCorrections(user, periodId) {
  const p = await loadPeriod(periodId);
  assertReader(user, p.sector_id);
  const rows = await correctionsOf(p.id);
  if (closeBreadth(user) !== 'department') return rows;
  const emps = new Set((await periodEmployees(p, user)).map((e) => e.id));
  return rows.filter((c) => emps.has(c.employee_id));
}

/** T33/T34 — قرار المراجع المالي: الاعتماد يُنشئ إصداراً جديداً مقفلاً ويُبقي السابق بلقطته. */
export async function decideCorrection(ctx, correctionId, action, note) {
  const user = ctx?.user;
  if (!isFinanceReviewer(user)) throw forbidden('قرار التصحيح للمراجعة المالية (مكتب الرئيس التنفيذي) أو مدير النظام');
  const act = String(action || '').toLowerCase();
  if (!['approve', 'reject'].includes(act)) throw badRequest('القرار إما اعتماد أو رفض');
  const c = await get('SELECT * FROM cost_correction WHERE id = ?', [correctionId]);
  if (!c) throw notFound('طلب التصحيح غير موجود');
  if (c.status !== 'pending') throw conflict(`طلب التصحيح ${CORRECTION_STATUS_AR[c.status] || c.status} أصلاً — لا يُقرَّر مرتين`);
  const p = await loadPeriod(c.period_id);
  const body = parseCorrection(c);
  const decision = note ? String(note).trim().slice(0, 500) : '';
  const now = nowIso();
  if (act === 'reject') {
    if (decision.length < 3) throw badRequest('اكتب سبب الرفض — يظهر لصاحب الطلب ويُحفظ في الأثر');
    await tx(async () => {
      const r = await run(`UPDATE cost_correction SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
        [user.id, now, decision, now, c.id]);
      if (!r.changes) throw conflict('قُرِّر هذا الطلب للتو من مستخدم آخر — أعد التحميل');
      await audit(ctx, { action: 'reject', resource: 'cost_correction', resourceId: c.id, sectorId: p.sector_id, detail: { periodId: p.id, employeeId: c.employee_id, month: keyOf(p), version: p.version, note: decision } });
    });
    return getCorrection(user, c.id);
  }
  return tx(async () => {
    const latest = await latestVersion(p.sector_id, p.year, p.month);
    const cur = await loadPeriod(p.id);
    if (!latest || latest.id !== cur.id || cur.status !== 'locked') {
      throw conflict(`الإصدار المرجعي للطلب (${cur.version}) لم يعد الأحدث — الأحدث هو الإصدار ${latest?.version || '؟'}؛ أعد إنشاء طلب التصحيح عليه`);
    }
    const proposedTotal = body.proposed.reduce((a, l) => a + N(l.share_bp), 0);
    if (!body.proposed.length || proposedTotal !== FULL_BP) throw badRequest(`المقترح لا يكتمل إلى 100% (مجموعه ${proposedTotal} نقطة أساس) — أعد إنشاء الطلب`);
    const emp = await get('SELECT id, name_ar, department_id FROM employee WHERE id = ?', [c.employee_id]);
    const snap = parseSnapshot(cur);
    const newVersion = Number(cur.version) + 1;
    const npid = id('cper');
    const newLines = body.proposed.map((l) => ({
      id: id('cshr'), employee_id: c.employee_id, employee_name: emp?.name_ar || null, department_id: emp?.department_id || null,
      target_kind: l.target_kind, target_id: l.target_id, target_label: l.label || null, fin_code: l.fin_code || null,
      share_bp: N(l.share_bp), basis: 'correction', review_status: 'confirmed',
      confirmed_by: user.username || user.id, confirmed_by_id: user.id, confirmed_at: now,
      note: `تصحيح: ${c.reason}`, correction_ref: c.id,
    }));
    const kept = snap.lines.filter((l) => l.employee_id !== c.employee_id);
    const newSnap = {
      ...snap, period_id: npid, version: newVersion, supersedes_id: cur.id, locked_at: now,
      locked_by: { id: user.id, username: user.username || null, name: user.name_ar || null },
      lines: [...kept, ...newLines],
      corrections: [...(snap.corrections || []), { id: c.id, employee_id: c.employee_id, reason: c.reason, decided_at: now, from_version: Number(cur.version), to_version: newVersion }],
      totals: { resources: new Set([...kept, ...newLines].map((l) => l.employee_id)).size, lines: kept.length + newLines.length },
    };
    // ١) السابق يُنسخ أولاً بتحديثٍ شرطي — من سبق فاز، والآخر يُردّ بلا إصدارٍ ثانٍ.
    const r = await run(`UPDATE cost_period SET status = 'superseded', updated_at = ? WHERE id = ? AND status = 'locked'`, [now, cur.id]);
    if (!r.changes) throw conflict('تغيّر الإصدار للتو من مستخدم آخر — أعد التحميل ثم أعد المحاولة');
    await insert('cost_period', {
      id: npid, sector_id: cur.sector_id, year: cur.year, month: cur.month, version: newVersion, status: 'locked', supersedes_id: cur.id,
      draft_generated_at: cur.draft_generated_at || null, manager_confirmed_by: cur.manager_confirmed_by || null, manager_confirmed_at: cur.manager_confirmed_at || null,
      finance_note: cur.finance_note || null, finance_locked_by: user.id, finance_locked_at: now, locked_snapshot_json: JSON.stringify(newSnap),
      transfer_status: 'not_transferred', created_by: user.id, created_at: now,
    });
    // ٢) أسطر الإصدار الجديد: نسخُ أسطر السابق (عدا المورد) كما هي، ثم أسطر التصحيح.
    const oldRows = await all('SELECT * FROM cost_share WHERE period_id = ? AND deleted_at IS NULL AND employee_id <> ? ORDER BY id', [cur.id, c.employee_id]);
    for (const o of oldRows) {
      await insert('cost_share', {
        id: id('cshr'), period_id: npid, employee_id: o.employee_id, target_kind: o.target_kind, target_id: o.target_id, fin_code: o.fin_code,
        share_bp: o.share_bp, basis: o.basis, review_status: o.review_status, note: o.note, created_by: o.created_by, created_at: o.created_at,
      });
    }
    for (const l of newLines) {
      await insert('cost_share', {
        id: l.id, period_id: npid, employee_id: l.employee_id, target_kind: l.target_kind, target_id: l.target_id, fin_code: l.fin_code,
        share_bp: l.share_bp, basis: 'correction', review_status: 'confirmed', note: l.note, created_by: user.id, created_at: now,
      });
    }
    await update('cost_correction', c.id, { status: 'approved', decided_by: user.id, decided_at: now, decision_note: decision || null, result_period_id: npid, updated_at: now });
    await audit(ctx, { action: 'approve', resource: 'cost_correction', resourceId: c.id, sectorId: cur.sector_id, detail: {
      periodId: cur.id, resultPeriodId: npid, fromVersion: Number(cur.version), toVersion: newVersion, employeeId: c.employee_id, previous: body.previous, proposed: body.proposed,
    } });
    await audit(ctx, { action: 'lock', resource: 'cost_period', resourceId: npid, sectorId: cur.sector_id, detail: {
      month: keyOf(cur), version: newVersion, supersedes: cur.id, correctionId: c.id, lines: newSnap.totals.lines,
    } });
    return {
      correction: { id: c.id, status: 'approved', status_ar: CORRECTION_STATUS_AR.approved, result_period_id: npid },
      period: { id: npid, version: newVersion, status: 'locked', status_ar: PERIOD_STATUS_AR.locked, supersedes_id: cur.id },
      superseded: { id: cur.id, version: Number(cur.version), status: 'superseded', status_ar: PERIOD_STATUS_AR.superseded },
    };
  });
}
