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
import { scopeFilter } from '../../core/rbac/scope.js';
import { forbidden, notFound } from '../../core/http/errors.js';
import { nowIso } from '../../core/util/ids.js';
import { MONTHS_AR } from '../../core/i18n/time.js';
import { SUPPORT_KIND, staffingRoster } from '../org/org.js';
import { notDemoEmployeeSql, seesDemoAccounts } from '../org/people.js';
import { inDepartmentScope } from '../../core/rbac/departments.js';
import { loadReadableProject } from './project-access.js';
import { teamTasksAccess, notPersonalSql } from './tasks.js';
import { approvedTaskSql } from './task-approval.js';

const N = (v) => Number(v) || 0;

// الطاقة الاستيعابية بالنسبة المئوية. الفراغ يعني مئة — وهو الحال الغالب، فلا يُجبر أحد على
// تعبئة خانة ليقول «متفرّغ كامل».
export const DEFAULT_CAPACITY_PCT = 100;

// عتبات الإشغال بثابتٍ واحد (v5.26): دون 70 سعة متاحة، 101–110 قربٌ من الحد، فوق 110
// تجاوز، و150 سقف الإدخال المقصود (`monthlyPlan`/`setAllocationCell` يقصّان عنده).
// مساحة عمل التسكين وعميلها ومركز القيادة (v5.37: البطاقة والطيف وعميله) يقرؤون من هنا؛
// التحذير لا يمنع الحفظ في كل الأحوال.
export const UTIL_BANDS = Object.freeze({ FREE_BELOW: 70, NEAR_FROM: 101, OVER_ABOVE: 110, MAX_PCT: 150 });
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
async function loadIndex(user, employeeIds, year, month) {
  const ids = [...new Set(employeeIds)].filter(Boolean);
  if (!ids.length) return { alloc: new Map(), opp: new Map(), tasks: new Map() };
  const ph = ids.map(() => '?').join(',');
  const today = nowIso().slice(0, 10);
  // نطاقُ قراءة الفرص للقارئ يقصّ عناوين الفرص: موظفٌ من قطاع المشروع قد يكون مسكَّناً على فرصةٍ
  // في قطاعٍ أو إدارةٍ خارج نطاق القارئ — وعنوانُها كان يظهر هنا بلا حدّ. مصدرُ حقيقةٍ واحد.
  const oppScope = scopeFilter(user, 'opportunity', 'read', {
    sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id',
    deptCol: 'o.department_id', grantCol: 'o.department_id', memberCol: 'o.id',
  });
  const [allocs, opps, tasks] = await Promise.all([
    all(`SELECT a.id, a.employee_id, a.project_id, a.type, a.monthly_json, p.name_ar proj_name, p.status proj_status
       FROM allocation a LEFT JOIN project p ON p.id = a.project_id
      WHERE a.deleted_at IS NULL AND a.year = ? AND a.employee_id IN (${ph})`, [year, ...ids]),
    all(`SELECT m.employee_id, m.allocation_pct, o.id opp_id, o.title_ar
       FROM membership m JOIN opportunity o ON o.id = m.group_id LEFT JOIN stage st ON st.id = o.stage_id
      WHERE m.group_kind = 'opportunity' AND m.deleted_at IS NULL AND m.allocation_pct > 0
       AND COALESCE(m.status, 'ACTIVE') <> 'PENDING'
        AND o.deleted_at IS NULL AND COALESCE(st.is_won, 0) = 0 AND COALESCE(st.is_lost, 0) = 0
        AND m.employee_id IN (${ph})
        AND (${oppScope.clause})`, [...ids, ...oppScope.params]),
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
  // الباب الواحد (v5.27/v5.32): الشراكة والعضوية يفتحان ما تعرضه القوائم — لا فحص خام يُبتلع.
  const p = await loadReadableProject(user, projectId, 'read', 'هذا المشروع خارج نطاق صلاحياتك');
  if (!can(user, 'read', 'employee')) throw forbidden('عرض الفريق يتطلب صلاحية');
  const year = Number(opts.year) || new Date().getUTCFullYear();
  const month = Number(opts.month) || liveMonth(year) || 1;
  const assigned = new Set((await all(
    'SELECT employee_id FROM allocation WHERE project_id = ? AND year = ? AND deleted_at IS NULL', [projectId, year]))
    .map((r) => r.employee_id));
  const emps = (await all(
    `SELECT e.* FROM employee e LEFT JOIN sector s ON s.id = e.sector_id AND s.deleted_at IS NULL
      WHERE e.active = 1 AND e.deleted_at IS NULL AND (e.sector_id = ? OR s.kind = ?)
        ${seesDemoAccounts(user) ? '' : `AND ${notDemoEmployeeSql('e')}`}
      ORDER BY e.name_ar`, [p.sector_id, SUPPORT_KIND]))
    .filter((e) => !assigned.has(e.id));
  const idx = await loadIndex(user, emps.map((e) => e.id), year, month);
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
  // الباب الواحد (v5.27/v5.32): الشراكة والعضوية يفتحان ما تعرضه القوائم — لا فحص خام يُبتلع.
  const p = await loadReadableProject(user, projectId, 'read', 'هذا المشروع خارج نطاق صلاحياتك');
  const year = Number(opts.year) || new Date().getUTCFullYear();
  const month = Number(opts.month) || liveMonth(year) || 1;
  const rows = await all(
    `SELECT a.id alloc_id, a.type, a.monthly_json, a.person_name_ar, e.*
       FROM allocation a LEFT JOIN employee e ON e.id = a.employee_id
      WHERE a.project_id = ? AND a.year = ? AND a.deleted_at IS NULL
      ORDER BY (a.type = 'lead') DESC, a.person_name_ar`, [projectId, year]);
  const idx = await loadIndex(user, rows.map((r) => r.id).filter(Boolean), year, month);
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

// ── مهام الفريق بأسمائها، لكل موظف: عدٌّ ثم أبرز ثلاث ─────────────────────────────
// بقواعد لوحة «مهام فريقي» حرفياً: لا مهام شخصية، ولا معلَّقة بانتظار الاعتماد — وإلا قال
// الرقمُ عن الرجل ما لا يستطيع قارئه فتحه. المتأخرة أولاً، ثم الأقرب استحقاقاً.
async function teamTaskLoad(employeeIds, today, topN = 3) {
  const ids = [...new Set(employeeIds)].filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => '?').join(',');
  // الجسر بمفتاح صفحة الشخص نفسه (`app_user.employee_id`) لا بعمود الموظف — فما يُعدّ هنا هو ما
  // تفتحه «الصفحة الكاملة» حرفاً. والسقف ثلاثة آلاف مهمة مفتوحة للكشف كله — بعده يُعدّ الباقون صفراً.
  const rows = await all(`SELECT e.id employee_id, t.id, t.title, t.due_date, t.status, t.blocked_reason
     FROM employee e JOIN app_user u ON u.employee_id = e.id AND u.deleted_at IS NULL
     JOIN task t ON t.assignee_user_id = u.id
    WHERE e.id IN (${ph}) AND t.deleted_at IS NULL
      AND t.status NOT IN ('DONE','CANCELLED') AND ${notPersonalSql('t.')} AND ${approvedTaskSql('t.')}
    ORDER BY e.id, CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date
    LIMIT 3000`, ids);
  for (const r of rows) {
    if (!out.has(r.employee_id)) out.set(r.employee_id, { open: 0, late: 0, blocked: 0, top: [] });
    const t = out.get(r.employee_id);
    const late = !!(r.due_date && String(r.due_date).slice(0, 10) < today);
    const blocked = r.status === 'BLOCKED' || !!String(r.blocked_reason || '').trim();
    t.open += 1; if (late) t.late += 1; if (blocked) t.blocked += 1;
    t.top.push({ id: r.id, title: r.title || '—', due: r.due_date ? String(r.due_date).slice(0, 10) : null, late, blocked });
  }
  for (const t of out.values()) {
    t.top.sort((a, b) => (b.late - a.late) || (b.blocked - a.blocked) || String(a.due || '9').localeCompare(String(b.due || '9')));
    t.top = t.top.slice(0, topN);
  }
  return out;
}

// ── تفصيل فريق القطاع لمركز القيادة: الشخص، وحِمله المخطَّط، وما على طاولته ─────────────
//
// بطاقة «طاقة الفريق» كانت تُرسَم من `sectorStaffing` (أرقام بلا معرِّفات)، فالضغط على شخصٍ
// لم يكن يجد ما يفتحه. هذا التفصيل يُبنى على كشف التسكين نفسه (`staffingRoster`) — بنطاق
// الأشخاص وقصّ أسماء المشاريع خارج نطاق القارئ كما هي في لوحة التسكين — ويضيف إليه ما
// يحتاجه النافذة المنبثقة: حساب الدخول (به يُفتح ملفه)، وهل يحقّ للقارئ فتح الملف أصلاً
// (بقاعدة `personDossier` حرفياً فلا يُرسَم رابطٌ يُردّ)، ومهامه عدّاً وأسماءً، وتجميعاً
// بالإدارة القائمة. لا راتب ولا حقل حساس يخرج من هنا مهما كان القارئ.
//
// أساس الأرقام واحد: **خطة التسكين الشهرية** لا ساعات عمل. حِمل الفرص المبدئي (يقع على
// الشهر الجاري وحده) يُفصَل في `oppLoadPct` ولا يُخلَط بالخطة — فالبطاقة تقرأ `planNow`
// وتتسق مع متوسطها، والنافذة تقول «+N% حِمل مبدئي» سطراً مستقلاً.
export async function sectorTeamDetail(user, opts = {}) {
  if (user.role_id !== 'admin' && !can(user, 'read', 'employee')) throw forbidden('لا تملك صلاحية عرض أفراد الفريق — اطلبها من مدير النظام');
  const r = await staffingRoster(user, { sector: opts.sector, year: opts.year, month: opts.month });
  const { year, currentMonth: nowM } = r;
  // الطاقة سؤالٌ عن الحاضرين: من غادر لا يُعدّ «متاحاً» ولا يُرسَم له وجه. الكشف يحمله لتاريخه.
  const roster = r.roster.filter((e) => e.active !== 0);
  const ids = roster.map((e) => e.id);
  const ph = ids.map(() => '?').join(',');
  const today = String(opts.todayDate || nowIso().slice(0, 10)).slice(0, 10);
  const sectorId = r.sector || opts.sector || null;
  // حساب الدخول بمفتاح صفحة الشخص نفسه (`app_user.employee_id`) — والحساب الموقوف يبقى حساباً:
  // صفحتُه تُفتح لمديره كما كانت، فلا يُخفى الرابط عن شخصٍ صفحتُه مفتوحة.
  const [links, tasks, outsideRow] = ids.length ? await Promise.all([
    all(`SELECT e.id, u.id user_id, u.sector_id user_sector_id FROM employee e
         LEFT JOIN app_user u ON u.employee_id = e.id AND u.deleted_at IS NULL
        WHERE e.id IN (${ph})`, ids),
    teamTaskLoad(ids, today),
    // مُسكَّنون على أعمال القطاع من خارج الكشف (قطاعٌ آخر أو إدارةٌ خارج نطاق القارئ): يُعدّون ولا يُخفون.
    sectorId ? get(`SELECT COUNT(DISTINCT a.employee_id) n FROM allocation a JOIN employee e ON e.id = a.employee_id
        WHERE a.sector_id = ? AND a.year = ? AND a.deleted_at IS NULL AND e.deleted_at IS NULL AND e.active = 1
          AND a.employee_id NOT IN (${ph})`, [sectorId, year, ...ids]) : null,
  ]) : [[], new Map(), null];
  const linkMap = new Map(links.map((l) => [l.id, l]));
  const access = teamTasksAccess(user);
  // نفس باب `personDossier`: الذات دائماً؛ ثم نطاق مهام الفريق — الشركة كلها، أو إداراته، أو قطاعه.
  const dossierOk = (emp, link) => {
    const uid = link?.user_id || null;
    if (!uid) return false;
    if (uid === user.id) return true;
    if (!access.scope) return false;
    if (access.scope === 'company') return true;
    if (access.scope === 'department') return inDepartmentScope(user, emp.department_id);
    return !!link.user_sector_id && link.user_sector_id === user.sector_id;
  };
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const people = roster.map((e) => {
    const link = linkMap.get(e.id) || null;
    const userId = link?.user_id || null;
    const ok = dossierOk(e, link);
    // الخطة وحدها، بلا حِمل الفرص المبدئي الذي يضيفه الكشف على الشهر الجاري.
    const planMonths = e.months.slice();
    if (nowM && e.oppLoadPct) planMonths[nowM - 1] = Math.max(0, planMonths[nowM - 1] - e.oppLoadPct);
    const planNow = nowM ? planMonths[nowM - 1] : 0;
    const next = nowM && nowM < 12 ? planMonths[nowM] : 0;
    const q3 = nowM ? avg(planMonths.slice(nowM, nowM + 3)) : 0;
    const annual = avg(planMonths);
    // المهام عن زميلٍ مسمّى سجلٌّ لا رقم: تُقرأ لمن يقرأ مهام الفريق (نفس باب «مهام فريقي»)؛ ومن بلا
    // حساب لا مهام له أصلاً. والحالة مسمّاة في `tasksState` كي تقولها النافذة لا أن تُصفّر.
    const tasksState = !userId ? 'no_account' : !access.scope ? 'no_scope' : 'ok';
    const t = tasksState === 'ok' ? (tasks.get(e.id) || { open: 0, late: 0, blocked: 0, top: [] }) : null;
    return {
      id: e.id, userId, dossierOk: ok, name_ar: e.name_ar, job_title: e.job_title || '',
      department_id: e.department_id || null, active: e.active, capacity_pct: e.capacity_pct ?? null,
      employment_type: e.employment_type || null,
      months: planMonths, planNow, next, q3, annual,
      // الفرق عن الشهر الماضي على أساس الخطة وحدها — كالعنوان فوقه، لا على رقم الكشف المخلوط.
      currentUtil: e.currentUtil, prevMonthUtil: e.prevMonthUtil, monthDelta: nowM ? planNow - e.prevMonthUtil : 0,
      oppLoadPct: e.oppLoadPct, peak: Math.max(0, ...planMonths), staffedMonths: planMonths.filter((m) => m > 0).length,
      projects: e.projects.map((p) => ({ allocId: p.allocId, projectId: p.projectId || null, name: p.name, bucket: p.bucket || null,
        type: p.type || 'member', status: p.status || null, months: p.months })),
      opportunities: e.opportunities.map((o) => ({ opportunityId: o.opportunityId, name: o.name, pct: o.pct })),
      // عناوين المهام سجلّات لا أرقام: تُعرض لمن يحقّ له فتح ملف صاحبها فحسب؛ العدّ يبقى.
      tasksState,
      tasks: t ? { open: t.open, late: t.late, blocked: t.blocked, top: ok ? t.top : [] } : null,
    };
  });
  const loadOf = (p) => (nowM ? p.planNow : p.annual);
  // الإدارات القائمة فحسب — لا تُنشأ هنا إدارةٌ ولا تُفترض. من بلا إدارة له سلّته المسمّاة.
  const deptIds = [...new Set(people.map((p) => p.department_id).filter(Boolean))];
  const deptRows = deptIds.length
    ? await all(`SELECT id, name_ar FROM department WHERE id IN (${deptIds.map(() => '?').join(',')}) AND deleted_at IS NULL`, deptIds)
    : [];
  const deptName = new Map(deptRows.map((d) => [d.id, d.name_ar]));
  const groups = new Map();
  for (const p of people) {
    const key = p.department_id && deptName.has(p.department_id) ? p.department_id : null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const departments = [...groups.entries()].map(([key, members]) => ({
    id: key, name_ar: key ? deptName.get(key) : 'بلا إدارة',
    headcount: members.length,
    avgNow: avg(members.map(loadOf)), avgAnnual: avg(members.map((p) => p.annual)),
    over: members.filter((p) => loadOf(p) > UTIL_BANDS.OVER_ABOVE).length,
    free: members.filter((p) => loadOf(p) === 0).length,
    ids: members.map((p) => p.id),
  })).sort((a, b) => (a.id === null) - (b.id === null) || (b.headcount - a.headcount)
    || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'));
  return {
    year, sector: sectorId, currentMonth: nowM, basis: 'plan',
    people, departments,
    outsideRoster: Number(outsideRow?.n) || 0,
    inactive: r.roster.length - roster.length,
    avgNow: avg(people.map(loadOf)),
    over: people.filter((p) => loadOf(p) > UTIL_BANDS.OVER_ABOVE).length,
    free: people.filter((p) => loadOf(p) === 0).length,
  };
}
