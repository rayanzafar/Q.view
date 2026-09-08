// ── العمل والالتزامات — S12 (وحدة الفريق والموارد) ──────────────────────────────────────
//
// «ما الالتزام المخطَّط؟ وعلى ماذا يعمل الفريق؟» — سؤالٌ واحد بوجهين: بحسب العمل (مشروع/بند
// داخلي/فرصة ⇐ من عليه، وما التزامه القادم، وما يعطّله) وبحسب المورد (الشخص ⇐ أعماله ومهامه).
//
// قواعد العدّ ثابتة (T23): المهمة تُعدّ **مرةً واحدة** — لها مسؤولٌ واحد وجهةٌ واحدة، فتسكن
// صفَّ عملها وحده في وجه «العمل» وصفَّ مسؤولها وحده في وجه «المورد». ولا مهامَّ شخصية ولا
// معلَّقةً بانتظار الاعتماد (`openLoadSql` — الشرط الواحد الذي يقرؤه مقياس الحِمل نفسه).
// التسكين من capacity-model عبر capacity-read (مؤكد/مبدئي منفصلان)، ولا مال في أي حقل.
import { all } from '../../core/db/index.js';
import { nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden } from '../../core/http/errors.js';
import { MONTHS_AR } from '../../core/i18n/time.js';
import { taskStatusLabel, taskPriorityLabel } from '../../core/i18n/task-vocab.js';
import { openLoadSql } from '../pmo/task-load.js';
import { canReadResources, resourceScopeSql } from './access.js';
import { figuresFor } from './capacity-read.js';
import { monthKey } from './capacity-model.js';

const N = (v) => Number(v) || 0;
const ph = (arr) => arr.map(() => '?').join(',');

// حالة المشروع بلسانٍ عربي — تُعرَّف محلياً (المعجم لا يحملها) ولا تُطبع قيمةٌ خام أبداً.
export const PROJECT_STATUS_AR = Object.freeze({
  NOT_STARTED: 'لم يبدأ', IN_PROGRESS: 'قيد التنفيذ', ACTIVE: 'قيد التنفيذ', ON_HOLD: 'متوقف مؤقتاً',
  COMPLETED: 'مكتمل', CLOSED: 'مغلق', CANCELLED: 'ملغى',
});
const projectStatusAr = (s) => PROJECT_STATUS_AR[String(s || '').toUpperCase()] || 'غير محدَّدة';
const WORK_KIND_AR = Object.freeze({ project: 'مشروع', bucket: 'عمل داخلي', opportunity: 'فرصة', internal: 'عمل داخلي بلا جهة' });
const INTERNAL_KEY = 'internal:';

function parsePeriod({ year, month } = {}) {
  const now = new Date();
  const y = Number(year) || now.getUTCFullYear();
  const m = Number(month) || now.getUTCMonth() + 1;
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw badRequest('السنة غير صحيحة — أدخلها بأربعة أرقام مثل 2026');
  if (!Number.isInteger(m) || m < 1 || m > 12) throw badRequest('الشهر رقم من 1 إلى 12');
  return { year: y, month: m, key: monthKey(y, m), label_ar: `${MONTHS_AR[m - 1]} ${y}` };
}

async function scopedEmployees(user, period, { department, sector } = {}) {
  const sc = resourceScopeSql(user, 'e', sector);
  if (sc.clause === '1=0') return [];
  const where = [sc.clause, '(e.active = 1 OR (e.end_date IS NOT NULL AND substr(e.end_date,1,10) >= ?))'];
  const params = [...sc.params, `${period.key}-01`];
  const wantDept = String(department || '').trim();
  if (wantDept) {
    let ok = false;
    if (sc.departments?.length) ok = sc.departments.includes(wantDept);
    else {
      const d = (await all('SELECT id, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [wantDept]))[0];
      ok = !!d && (!sc.sector || d.sector_id === sc.sector);
    }
    if (!ok) throw forbidden('هذه الإدارة خارج نطاقك — اختر إدارةً من قطاعك أو إداراتك');
    where.push('e.department_id = ?'); params.push(wantDept);
  }
  return await all(`SELECT e.id, e.name_ar, e.job_title, e.user_id, e.department_id, e.sector_id, d.name_ar department_name
       FROM employee e LEFT JOIN department d ON d.id = e.department_id AND d.deleted_at IS NULL
      WHERE ${where.join(' AND ')} ORDER BY e.name_ar`, params);
}

// الجسر موظف ⇄ حساب من الجهتين (المنتج يكتب الاثنين). موظفٌ بلا حساب لا مهام له — وهو صادق.
async function accountsOf(emps) {
  const ids = emps.map((e) => e.id);
  const byEmp = new Map(); const byUser = new Map();
  if (!ids.length) return { byEmp, byUser };
  const rows = await all(`SELECT e.id employee_id, e.user_id emp_user, u.id acc_user, COALESCE(u.name_ar, u.username) acc_name
       FROM employee e LEFT JOIN app_user u ON u.employee_id = e.id AND u.deleted_at IS NULL WHERE e.id IN (${ph(ids)})`, ids);
  for (const r of rows) {
    if (byEmp.has(r.employee_id)) continue;
    const uid = r.acc_user || r.emp_user || null;
    if (!uid) continue;
    byEmp.set(r.employee_id, uid);
    if (!byUser.has(uid)) byUser.set(uid, r.employee_id);
  }
  return { byEmp, byUser };
}

const dueOf = (v) => (v ? String(v).slice(0, 10) : null);
function nextOf(candidates, today) {
  const dated = candidates.filter((c) => c.due);
  if (!dated.length) return null;
  const ahead = dated.filter((c) => c.due >= today).sort((a, b) => a.due.localeCompare(b.due));
  if (ahead.length) return { ...ahead[0], late: false };
  const behind = dated.sort((a, b) => b.due.localeCompare(a.due));   // الأقرب في الماضي: التزامٌ فات ولم يُغلق
  return { ...behind[0], late: true };
}
const isBlocked = (t) => String(t.status || '').toUpperCase() === 'BLOCKED' || !!String(t.blocked_reason || '').trim();

/**
 * S12 — العمل والالتزامات لشهرٍ في نطاق القارئ.
 * @param {'work'|'resource'} by وجه العرض
 * @returns {{ period, by, rows, counts, basis_ar, asOf }}
 */
export async function teamCommitments(user, { year, month, department, by = 'work', sector, todayDate } = {}) {
  if (!canReadResources(user)) throw forbidden('عرض العمل والالتزامات يتطلب صلاحية عرض الفريق — اطلبها من مدير النظام');
  const view = String(by || 'work').toLowerCase();
  if (!['work', 'resource'].includes(view)) throw badRequest('وجه العرض إما بحسب العمل أو بحسب المورد');
  const period = parsePeriod({ year, month });
  const today = String(todayDate || nowIso().slice(0, 10)).slice(0, 10);
  const emps = await scopedEmployees(user, period, { department, sector });
  const ids = emps.map((e) => e.id);
  const [{ ctx, figures }, accounts] = await Promise.all([
    figuresFor(ids, period.key, period.key, { includePending: false }),
    accountsOf(emps),
  ]);
  const uids = [...accounts.byUser.keys()];
  // المهام الجارية المسنَدة إلى أهل الكشف — صفٌّ واحد لكل مهمة، بلا شخصية ولا معلَّقة.
  const tasks = uids.length ? await all(`SELECT t.id, t.title, t.assignee_user_id, t.project_id, t.opportunity_id, t.work_kind,
         t.due_date, t.status, t.blocked_reason, t.priority, t.utilization_pct, t.next_step
       FROM task t WHERE ${openLoadSql('t.')} AND t.assignee_user_id IN (${ph(uids)})
       ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.title`, uids) : [];
  // أسماء الأعمال التي لم تصل عبر التسكين (مهمة على مشروعٍ لا تسكين عليه هذا الشهر، أو على فرصة).
  const pids = [...new Set(tasks.map((t) => t.project_id).filter((p) => p && !ctx.projects.has(p)))];
  if (pids.length) for (const p of await all(`SELECT id, name_ar, code, status, kind FROM project WHERE id IN (${ph(pids)})`, pids)) ctx.projects.set(p.id, p);
  const oids = [...new Set(tasks.map((t) => t.opportunity_id).filter(Boolean))];
  const opps = new Map();
  if (oids.length) for (const o of await all(`SELECT id, title_ar FROM opportunity WHERE id IN (${ph(oids)})`, oids)) opps.set(o.id, o);
  const allProjectIds = [...new Set([...ctx.projects.keys()])];
  const milestones = new Map();
  if (allProjectIds.length) {
    for (const m of await all(`SELECT id, project_id, name_ar, due_date FROM milestone
        WHERE deleted_at IS NULL AND status = 'PENDING' AND due_date IS NOT NULL AND project_id IN (${ph(allProjectIds)})
        ORDER BY due_date`, allProjectIds)) {
      if (!milestones.has(m.project_id)) milestones.set(m.project_id, []);
      milestones.get(m.project_id).push({ kind: 'milestone', id: m.id, title: m.name_ar, due: dueOf(m.due_date) });
    }
  }
  const nameOfUser = new Map(emps.map((e) => [accounts.byEmp.get(e.id), e.name_ar]).filter(([u]) => u));

  const shapeTask = (t) => {
    const eid = accounts.byUser.get(t.assignee_user_id) || null;
    const due = dueOf(t.due_date);
    const work = t.project_id ? { kind: 'project', id: t.project_id, label: ctx.projects.get(t.project_id)?.name_ar || 'مشروع' }
      : t.opportunity_id ? { kind: 'opportunity', id: t.opportunity_id, label: opps.get(t.opportunity_id)?.title_ar || 'فرصة' }
        : { kind: 'internal', id: null, label: WORK_KIND_AR.internal };
    return {
      id: t.id, title: t.title, assignee: { userId: t.assignee_user_id, employeeId: eid, name: nameOfUser.get(t.assignee_user_id) || null },
      due, late: !!(due && due < today), status: t.status, status_ar: taskStatusLabel(t.status),
      priority: t.priority || null, priority_ar: taskPriorityLabel(t.priority),
      blocked: isBlocked(t), blocked_reason: t.blocked_reason || null, utilization_pct: t.utilization_pct == null ? null : N(t.utilization_pct),
      next_step: t.next_step || null, work,
    };
  };
  const shapedTasks = tasks.map(shapeTask);
  const workKeyOf = (w) => (w.kind === 'internal' ? INTERNAL_KEY : `${w.kind}:${w.id}`);

  let rows;
  if (view === 'work') {
    const map = new Map();
    const rowFor = (w) => {
      const k = workKeyOf(w);
      if (!map.has(k)) {
        const p = w.kind === 'project' ? ctx.projects.get(w.id) : null;
        map.set(k, {
          work: { kind: w.kind, id: w.id, label: w.label, kind_ar: WORK_KIND_AR[w.kind] || w.kind,
            status: p ? p.status || null : null, status_ar: p ? projectStatusAr(p.status) : (w.kind === 'bucket' ? 'بند داخلي' : w.kind === 'opportunity' ? 'فرصة قائمة' : '—'),
            code: p?.code || null },
          team: [], confirmedPct: 0, tentativePct: 0, confirmedFte: 0, tasks: [], blockers: [], nextCommitment: null,
        });
      }
      return map.get(k);
    };
    for (const e of emps) {
      const fg = figures.get(e.id); if (!fg) continue;
      const f0 = fg.months[0];
      for (const it of f0.items) {
        if (it.status === 'pending') continue;
        const r = rowFor({ kind: it.kind, id: it.targetId, label: it.label });
        r.team.push({ employeeId: e.id, name: e.name_ar, job_title: e.job_title || '', pct: it.pct, status: it.status, status_ar: it.status === 'tentative' ? 'مبدئي' : 'مؤكد', role: it.role || 'member' });
        if (it.status === 'tentative') r.tentativePct += it.pct;
        else { r.confirmedPct += it.pct; r.confirmedFte += Math.round((it.pct * f0.capacity.units) / 100 * 100) / 100; }
      }
    }
    for (const t of shapedTasks) rowFor(t.work).tasks.push(t);   // كل مهمة في صفّ عملها وحده — مرةً واحدة
    for (const r of map.values()) {
      r.blockers = r.tasks.filter((t) => t.blocked).map((t) => ({ id: t.id, title: t.title, blocked_reason: t.blocked_reason, assignee: t.assignee }));
      const cands = r.tasks.map((t) => ({ kind: 'task', id: t.id, title: t.title, due: t.due, assignee: t.assignee }))
        .concat(r.work.kind === 'project' ? (milestones.get(r.work.id) || []) : []);
      r.nextCommitment = nextOf(cands, today);
      r.taskCount = r.tasks.length; r.lateCount = r.tasks.filter((t) => t.late).length;
      r.confirmedFte = Math.round(r.confirmedFte) / 100;
      r.team.sort((a, b) => (b.pct - a.pct) || String(a.name).localeCompare(String(b.name), 'ar'));
    }
    const order = { project: 0, bucket: 1, opportunity: 2, internal: 3 };
    rows = [...map.values()].sort((a, b) => (order[a.work.kind] - order[b.work.kind]) || (b.confirmedPct - a.confirmedPct) || String(a.work.label).localeCompare(String(b.work.label), 'ar'));
  } else {
    const byAssignee = new Map();
    for (const t of shapedTasks) { const k = t.assignee.employeeId; if (!k) continue; if (!byAssignee.has(k)) byAssignee.set(k, []); byAssignee.get(k).push(t); }
    rows = emps.map((e) => {
      const fg = figures.get(e.id);
      const f0 = fg?.months?.[0] || null;
      const mine = byAssignee.get(e.id) || [];
      const works = (f0?.items || []).filter((it) => it.status !== 'pending').map((it) => ({
        kind: it.kind, id: it.targetId, label: it.label, kind_ar: WORK_KIND_AR[it.kind] || it.kind, pct: it.pct, status: it.status,
        status_ar: it.status === 'tentative' ? 'مبدئي' : 'مؤكد', role: it.role || 'member',
        work_status_ar: it.kind === 'project' ? projectStatusAr(it.targetStatus) : null,
      }));
      const pids2 = works.filter((w) => w.kind === 'project').map((w) => w.id);
      const cands = mine.map((t) => ({ kind: 'task', id: t.id, title: t.title, due: t.due })).concat(pids2.flatMap((p) => milestones.get(p) || []));
      return {
        resource: { employeeId: e.id, name: e.name_ar, job_title: e.job_title || '', department_id: e.department_id || null,
          department_name: e.department_name || null, userId: accounts.byEmp.get(e.id) || null },
        engagement: f0 ? f0.state : 'out',
        confirmedPct: f0 ? f0.confirmedPct : null, tentativePct: f0 ? f0.tentativePct : null, availablePct: f0 ? f0.availablePct : null,
        works, tasks: mine, taskCount: mine.length, lateCount: mine.filter((t) => t.late).length,
        blockers: mine.filter((t) => t.blocked).map((t) => ({ id: t.id, title: t.title, blocked_reason: t.blocked_reason })),
        nextCommitment: nextOf(cands, today),
        hasAccount: accounts.byEmp.has(e.id),
      };
    });
  }
  return {
    period, by: view, rows, total: rows.length,
    counts: { resources: emps.length, works: view === 'work' ? rows.length : new Set(rows.flatMap((r) => r.works.map((w) => `${w.kind}:${w.id}`))).size, tasks: shapedTasks.length,
      blocked: shapedTasks.filter((t) => t.blocked).length, late: shapedTasks.filter((t) => t.late).length },
    basis_ar: 'التسكين من مصفوفة التسكين للشهر (المؤكد والمبدئي منفصلان، والمعلَّق لا يُعرض هنا). المهام الجارية المسنَدة إلى أهل الكشف تُعدّ مرةً واحدة — بلا مهام شخصية ولا مهام بانتظار الاعتماد. الالتزام القادم أقرب مهمة أو معلم مستحق.',
    asOf: nowIso(),
  };
}
