// الطاقة الاستيعابية والضغط الحالي — «هل يتحمّل هذا الشخص مشروعاً آخر».
//
// الكشف العام (org/staffingRoster) يجيب عن القطاع كله ويصلح للتخطيط السنوي. وهذا الملف يجيب
// عن سؤالٍ أضيق يُسأل في لحظة قرار: أنا أُسكِّن أحداً على مشروع الآن — من المتاح، وكم يتحمّل،
// وماذا على طاولته أصلاً. ثلاثة فروق عن الكشف العام تجعله ضرورياً لا تكراراً:
//
//   ١) الطاقة تُقرأ من الموظف لا من مئةٍ ثابتة في الكود. المتفرّغ جزئياً والموسمي والمشترك
//      طاقاتهم مختلفة، ومقارنةُ الجميع بمئة تجعل نصف المتفرّغ يبدو محمَّلاً ٥٠٪ وهو مكتمل.
//   ٢) الضغط يُقاس على **فترة التسكين** لا على مدة المشروع. المشروع سنتان وتسكين الشخص فيه
//      شهران — واعتبارُه محمَّلاً طوال المدة يحجب سبعة عشر شهراً متاحة عنه بلا سبب.
//   ٣) العبء ليس التسكين وحده: المهام المفتوحة والمتأخرة تُقرأ معه. من نسبته ٤٠٪ وعليه إحدى
//      عشرة مهمة متأخرة ليس «متاحاً» بأي معنى مفيد.
//
// حدّ الصلاحية: كل ما هنا خلف `can(read, employee)` + نطاق الأشخاص، ولا يعود منه راتب ولا
// حقل حساس — الحمولة كلها تشغيلية (اسم · مسمّى · نسبة · عدد مهام).
import { all, get } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { forbidden, notFound } from '../../core/http/errors.js';
import { nowIso } from '../../core/util/ids.js';
import { MONTHS_AR } from '../../core/i18n/time.js';
import { SUPPORT_KIND } from '../org/org.js';

const N = (v) => Number(v) || 0;

// الطاقة الاستيعابية بالنسبة المئوية. الفراغ يعني مئة — وهو الحال الغالب، فلا يُجبر أحد على
// تعبئة خانة ليقول «متفرّغ كامل».
export const DEFAULT_CAPACITY_PCT = 100;
export const capacityOf = (emp) => {
  const c = Number(emp?.capacity_pct);
  return Number.isFinite(c) && c > 0 ? c : DEFAULT_CAPACITY_PCT;
};

export const parseMonths = (json) => {
  try { const o = JSON.parse(json || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
};

// فترة التسكين كما تُقرأ: من أول شهر له نسبة إلى آخره. هذا ما يمنع «محمَّل طوال مدة المشروع».
export function allocationPeriod(monthlyJson, year) {
  const mj = parseMonths(monthlyJson);
  const months = Object.keys(mj).map(Number).filter((m) => m >= 1 && m <= 12 && N(mj[m]) > 0).sort((a, b) => a - b);
  if (!months.length) return { from: null, to: null, label: 'بلا فترة محدَّدة', months: [], avgPct: 0 };
  const from = months[0], to = months[months.length - 1];
  const avgPct = Math.round((months.reduce((a, m) => a + N(mj[m]), 0) / months.length) * 100);
  const y = year ? ` ${year}` : '';
  const label = from === to ? `${MONTHS_AR[from - 1]}${y}` : `${MONTHS_AR[from - 1]} — ${MONTHS_AR[to - 1]}${y}`;
  return { from, to, label, months, avgPct };
}

const liveMonth = (year) => (year === new Date().getUTCFullYear() ? new Date().getUTCMonth() + 1 : 0);

// ── حِمل شخصٍ واحد في شهرٍ بعينه، من كل ما سُكِّن عليه (مشاريع + فرص) ─────────────────
// يُبنى مرة واحدة لمجموعة الموظفين كلها: استعلامان اثنان لا اثنان لكل شخص.
async function loadIndex(employeeIds, year, month) {
  const ids = [...new Set(employeeIds)].filter(Boolean);
  if (!ids.length) return { alloc: new Map(), opp: new Map(), tasks: new Map() };
  const ph = ids.map(() => '?').join(',');
  const today = nowIso().slice(0, 10);
  const [allocs, opps, tasks] = await Promise.all([
    all(`SELECT a.id, a.employee_id, a.project_id, a.type, a.monthly_json, p.name_ar proj_name, p.status proj_status
       FROM allocation a LEFT JOIN project p ON p.id = a.project_id
      WHERE a.deleted_at IS NULL AND a.year = ? AND a.employee_id IN (${ph})`, [year, ...ids]),
    all(`SELECT m.employee_id, m.allocation_pct, o.id opp_id, o.title_ar
       FROM membership m JOIN opportunity o ON o.id = m.group_id LEFT JOIN stage st ON st.id = o.stage_id
      WHERE m.group_kind = 'opportunity' AND m.deleted_at IS NULL AND m.allocation_pct > 0
        AND o.deleted_at IS NULL AND COALESCE(st.is_won, 0) = 0 AND COALESCE(st.is_lost, 0) = 0
        AND m.employee_id IN (${ph})`, ids),
    // المهام تُسنَد إلى **مستخدم** والتسكين إلى **موظف**، والجسر بينهما عمود المستخدم على الموظف.
    // ومن لا حساب له لا مهام له في المنصة — وهو صادق: لا مسار لإسناد مهمة إلى غير مستخدم.
    all(`SELECT e.id employee_id,
            SUM(CASE WHEN t.status NOT IN ('DONE','CANCELLED') THEN 1 ELSE 0 END) open_tasks,
            SUM(CASE WHEN t.status NOT IN ('DONE','CANCELLED') AND t.due_date IS NOT NULL
                      AND substr(t.due_date,1,10) < ? THEN 1 ELSE 0 END) late_tasks
       FROM employee e JOIN task t ON t.assignee_user_id = e.user_id
      WHERE e.id IN (${ph}) AND t.deleted_at IS NULL AND e.user_id IS NOT NULL
      GROUP BY e.id`, [today, ...ids]),
  ]);
  const alloc = new Map(); const opp = new Map();
  for (const a of allocs) { if (!alloc.has(a.employee_id)) alloc.set(a.employee_id, []); alloc.get(a.employee_id).push(a); }
  for (const o of opps) { if (!opp.has(o.employee_id)) opp.set(o.employee_id, []); opp.get(o.employee_id).push(o); }
  const taskMap = new Map(tasks.map((t) => [t.employee_id, { open: N(t.open_tasks), late: N(t.late_tasks) }]));
  return { alloc, opp, tasks: taskMap, month };
}

// صورةُ شخصٍ واحد: الطاقة · المُسكَّن الآن · المتبقّي · تجاوز المئة · ما على طاولته.
function personLoad(emp, idx, year, month, { excludeProjectId = null } = {}) {
  const mine = (idx.alloc.get(emp.id) || []).filter((a) => a.project_id !== excludeProjectId);
  const capacity = capacityOf(emp);
  const perProject = mine.map((a) => {
    const period = allocationPeriod(a.monthly_json, year);
    const mj = parseMonths(a.monthly_json);
    return { allocId: a.id, projectId: a.project_id, name: a.proj_name || '—', type: a.type || 'member',
      status: a.proj_status, period, pctNow: month ? Math.round(N(mj[month]) * 100) : 0 };
  });
  const oppList = (idx.opp.get(emp.id) || []).map((o) => ({ opportunityId: o.opp_id, name: o.title_ar || '—', pct: Math.round(N(o.allocation_pct)) }));
  // حِمل الفرص يقع على «الآن» بحكم تعريفه: طلبٌ لم يتحوّل إلى مشروع بعد فلا خطة شهرية له.
  const oppPct = oppList.reduce((a, o) => a + o.pct, 0);
  const projectPct = perProject.reduce((a, p) => a + p.pctNow, 0);
  const assignedPct = projectPct + (month ? oppPct : 0);
  const t = idx.tasks.get(emp.id) || { open: 0, late: 0 };
  return {
    id: emp.id, name_ar: emp.name_ar, job_title: emp.job_title, sector_id: emp.sector_id,
    active: emp.active, capacityPct: capacity,
    assignedPct, projectPct, oppPct,
    remainingPct: Math.round(capacity - assignedPct),
    over: assignedPct > capacity,
    // ما يُقال للمستخدم حرفياً عند التجاوز — الرقم وحده لا يُصرِّح بأن ثمة مشكلة.
    overBy: assignedPct > capacity ? Math.round(assignedPct - capacity) : 0,
    openTasks: t.open, lateTasks: t.late,
    projects: perProject, opportunities: oppList,
  };
}

// ── من يصلح لهذا المشروع، مرتَّبين بالأقل تحميلاً ────────────────────────────────
// نفس قاعدة الأهلية المطبَّقة في التسكين نفسه (projects.projectStaffing): موظفو قطاع المشروع
// **مع** موظفي وحدات المساندة، لأنهم مورد مشترك للشركة بحكم تعريف وحدتهم. أي قاعدة ثانية هنا
// تعني قائمةً تعرض من لا يقبله الحفظ — أسوأ من قائمة ناقصة.
export async function staffingCandidates(user, projectId, opts = {}) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', { ...p, project_id: p.id })) throw forbidden('هذا المشروع خارج نطاق صلاحياتك');
  if (!can(user, 'read', 'employee')) throw forbidden('عرض الفريق يتطلب صلاحية');
  const year = Number(opts.year) || new Date().getUTCFullYear();
  const month = Number(opts.month) || liveMonth(year) || 1;
  const assigned = new Set((await all(
    'SELECT employee_id FROM allocation WHERE project_id = ? AND year = ? AND deleted_at IS NULL', [projectId, year]))
    .map((r) => r.employee_id));
  const emps = (await all(
    `SELECT e.* FROM employee e LEFT JOIN sector s ON s.id = e.sector_id AND s.deleted_at IS NULL
      WHERE e.active = 1 AND e.deleted_at IS NULL AND (e.sector_id = ? OR s.kind = ?)
      ORDER BY e.name_ar`, [p.sector_id, SUPPORT_KIND]))
    .filter((e) => !assigned.has(e.id));
  const idx = await loadIndex(emps.map((e) => e.id), year, month);
  const rows = emps.map((e) => personLoad(e, idx, year, month));
  // الترتيب: الأقل تحميلاً أولاً، ثم الأقل تأخّراً في مهامه، ثم الاسم. ومن تجاوز طاقته يهبط
  // إلى الآخر بحكم نسبته — ولا يُخفى: إخفاؤه يجعل القائمة تكذب حين لا يبقى أحد تحت المئة.
  rows.sort((a, b) => (a.assignedPct - b.assignedPct) || (a.lateTasks - b.lateTasks)
    || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'));
  return { projectId, year, month, monthLabel: MONTHS_AR[month - 1] || '', candidates: rows,
    available: rows.filter((r) => !r.over).length, overloaded: rows.filter((r) => r.over).length };
}

// ── فريق المشروع مع ضغطه الكامل ───────────────────────────────────────────────
// «نسبته على هذا المشروع» و«مجموع تسكينه» رقمان مختلفان، وعرضُ الأول وحده هو ما يجعل مديراً
// يضيف عشرين بالمئة على شخصٍ بلغ مئةً وأربعين في مكانٍ آخر لا يراه.
export async function projectTeamLoad(user, projectId, opts = {}) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', { ...p, project_id: p.id })) throw forbidden('هذا المشروع خارج نطاق صلاحياتك');
  const year = Number(opts.year) || new Date().getUTCFullYear();
  const month = Number(opts.month) || liveMonth(year) || 1;
  const rows = await all(
    `SELECT a.id alloc_id, a.type, a.monthly_json, a.person_name_ar, e.*
       FROM allocation a LEFT JOIN employee e ON e.id = a.employee_id
      WHERE a.project_id = ? AND a.year = ? AND a.deleted_at IS NULL
      ORDER BY (a.type = 'lead') DESC, a.person_name_ar`, [projectId, year]);
  const idx = await loadIndex(rows.map((r) => r.id).filter(Boolean), year, month);
  const team = rows.map((r) => {
    const period = allocationPeriod(r.monthly_json, year);
    const mj = parseMonths(r.monthly_json);
    const onThis = month ? Math.round(N(mj[month]) * 100) : 0;
    // الحِمل الكلي يُحسب **باستثناء هذا المشروع** ثم يُضاف إليه، فيُقرأ الرقمان بلا ازدواج.
    const others = r.id ? personLoad(r, idx, year, month, { excludeProjectId: projectId }) : null;
    const capacity = capacityOf(r);
    const totalPct = (others ? others.assignedPct : 0) + onThis;
    return {
      allocId: r.alloc_id, employeeId: r.id || null,
      // حساب الشخص المرتبط — به وحده تُفتح صفحته (`personDossier` يقرأ معرّف الحساب لا الموظف).
      // وبدونه كان اسمُ المُسكَّن نصّاً جامداً على جدول الفريق: يرى المديرُ مَن على مشروعه ولا
      // يستطيع الوصول إلى ما عنده — وهو انقطاعٌ في السلسلة التي يُفترض أن تكون موصولة.
      userId: r.user_id || null,
      name: r.name_ar || r.person_name_ar || '—', job_title: r.job_title || '',
      role: r.type === 'lead' ? 'قائد' : 'عضو', isLead: r.type === 'lead',
      period, onThisPct: onThis, otherPct: others ? others.assignedPct : 0,
      totalPct, capacityPct: capacity, over: totalPct > capacity,
      overBy: totalPct > capacity ? Math.round(totalPct - capacity) : 0,
      openTasks: others ? others.openTasks : 0, lateTasks: others ? others.lateTasks : 0,
      months: Array.from({ length: 12 }, (_, i) => Math.round(N(mj[i + 1]) * 100)),
    };
  });
  return { projectId, year, month, monthLabel: MONTHS_AR[month - 1] || '', team,
    overloaded: team.filter((t) => t.over).length,
    // مجموع ما يُنفَق على المشروع هذا الشهر بوحدة الشخص الكامل — الرقم الذي يُقارن بالميزانية.
    fteNow: Math.round(team.reduce((a, t) => a + t.onThisPct, 0)) / 100 };
}
