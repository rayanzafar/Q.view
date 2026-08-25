// Metrics/KPIs powering dashboards — YEAR-AWARE. All queries respect the caller's scope;
// sensitive aggregates (cost/margin) only for users who can read those gates.
// Sales = WON opportunities in a fiscal year. Revenue = recognized revenue_line in that year.
// Contracts span years; contract value is total, revenue is recognized per year.
import { all, get } from '../db/index.js';
import { can, canSeeSensitive } from '../rbac/index.js';
import { config } from '../config.js';
import { nowIso } from '../util/ids.js';
import { forbidden } from '../http/errors.js';
import { DELIVERY_SECTOR_SQL, isSupportUnit } from '../org/kind.js';
// مقاييس المشروع تُبنى على عمله المعتمَد: مهمةٌ تنتظر اعتماد مدير كاتبها ليست من عمل المشروع
// بعد، وعدُّها يرفع مقام «الإنجاز» أو يخفضه بعملٍ لم يوافق عليه أحد.
import { approvedTaskSql } from '../../modules/pmo/task-approval.js';
// قاعدة «مشروع السنة» الواحدة — نفس مرشّح صفحة المشاريع حرفاً (قرار المالك 2026-08-16).
import { projectYearClause } from '../../modules/pmo/projects.js';

const FY = () => config.fiscalYear;

// ── الإيراد هنا **صافٍ** بعد فصل الضريبة (ترحيلة ٠١٩) ───────────────────────────────────────
// كل مقياسٍ في هذا الملف يقارن الإيراد بمستهدفٍ أو بكلفة، وكلاهما صافٍ أصلاً: المستهدفات يضعها
// المالك صافيةً (ولذلك بقيت `sector.target_*` و`budget.target_*` خارج نطاق الفصل)، وبنود الكلفة
// اعترافٌ بكلفةٍ صافية بطبيعتها لأن الضريبة المدخلة مستردّة. فقراءة الإيراد إجمالياً كانت تضخّم
// نسبة التحقّق خمسة عشر بالمئة وتضخّم الهامش معها — رقمان يُبنى عليهما قرار.
// والصيغة هي القاعدة الواحدة: المخزَّن إن سُجِّل وإلا اشتقاقٌ قياسي، كي لا يسقط صفٌّ كتبه مسارٌ
// لا يعرف بالضريبة. نسختها الأصلية في `src/modules/finance/vat.js`، ويحرس التطابق فحصُ الوحدة.
const NET_REVENUE = 'COALESCE(SUM(COALESCE(net_amount_halalas, CAST(COALESCE(amount_halalas, 0) AS BIGINT) * 100 / 115)), 0)';

// Distinct years present in the data (for year pickers), newest first.
export async function availableYears() {
  const rows = await all(`SELECT DISTINCT y FROM (
      SELECT year y FROM revenue_line WHERE year IS NOT NULL
      UNION SELECT year FROM opportunity WHERE year IS NOT NULL
      UNION SELECT CAST(substr(start_date,1,4) AS INTEGER) FROM contract WHERE start_date IS NOT NULL
    ) WHERE y IS NOT NULL ORDER BY y DESC`);
  const years = new Set(rows.map((r) => r.y));
  years.add(FY());
  // سنوات البيانات وحدها (+ الجارية). كانت السنة القادمة تُحقن دائماً فتفتح صفحةً كلها
  // «لا سجلّ بعد» — وقرّر أ. حسين إخفاءها ما دامت فارغة (2026-08-25). متى أُسنِدت صفقةٌ أو
  // سُجِّل بندٌ لسنةٍ قادمة ظهرت وحدها من الصف الأول أعلاه، بوسم «قادمة» وتوقّعِ الامتداد.
  return [...years].sort((a, b) => b - a);
}

// ── per-sector figures for a single year ──
async function sectorYearFigures(sectorId, year) {
  const revenue = (await get(`SELECT ${NET_REVENUE} v FROM revenue_line WHERE sector_id = ? AND year = ?`, [sectorId, year])).v;
  // Sales = value of WON opportunities booked in that year (excluding flagged-out)
  const sales = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o
      JOIN stage st ON st.id = o.stage_id
      WHERE o.sector_id = ? AND o.year = ? AND st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL`,
    [sectorId, year])).v;
  // قيمة العقود الموقّعة **إجمالية**: هي ما وقّعه العميل ويُطالَب به. وصافيها بجانبها لأنها
  // تُعرض في الشاشة نفسها التي فيها الإيراد الصافي، فلولاه قُرئ الفارق بينهما تناقضاً.
  const contractsSigned = await get(`SELECT COALESCE(SUM(value_halalas),0) v, COUNT(*) n,
      COALESCE(SUM(COALESCE(net_value_halalas, CAST(COALESCE(value_halalas, 0) AS BIGINT) * 100 / 115)), 0) net
      FROM contract
      WHERE sector_id = ? AND CAST(substr(start_date,1,4) AS INTEGER) = ? AND deleted_at IS NULL`, [sectorId, year]);
  return { revenue_halalas: revenue, sales_halalas: sales,
    contracts_halalas: contractsSigned.v, contracts_net_halalas: contractsSigned.net,
    contracts_count: contractsSigned.n };
}

export async function companyOverview(user, opts = {}) {
  // Company-wide revenue/sales/pipeline/deals — the same guard /api/metrics/company enforces at
  // its route. Checked here too so every caller (report engine, AI assistant) inherits it, not
  // just the one route that remembered to ask.
  if (!user || user.scope !== 'company') throw forbidden('هذا التقرير على مستوى الشركة كاملة، خارج نطاق صلاحيتك');
  const year = Number(opts.year) || FY();
  // قطاعات التسليم وحدها. هذه هي مقارنة القطاعات التي يقرأها المالك، ووحدة المساندة (الخدمات
  // المشتركة، تطوير الأعمال، المالية) ليست قطاعاً: لا هدف لها ولا إيراد، فظهورها هنا يعني صفاً
  // خامساً بأصفار يُفسد المقارنة ويُنقص متوسطاتها — وهو ما وُعد المالك بألا يحدث.
  const sectors = await all(`SELECT * FROM sector WHERE deleted_at IS NULL AND active = 1
      AND ${DELIVERY_SECTOR_SQL} ORDER BY sort_order`);
  const perSector = await Promise.all(sectors.map(async (s) => {
    const f = await sectorYearFigures(s.id, year);
    const oppCount = (await get('SELECT COUNT(*) n FROM opportunity WHERE sector_id = ? AND deleted_at IS NULL', [s.id])).n;
    return {
      id: s.id, name_ar: s.name_ar, name_en: s.name_en, color: s.color, placeholder: !!s.is_placeholder,
      revenue_halalas: f.revenue_halalas, target_revenue_halalas: s.target_revenue_halalas,
      sales_halalas: f.sales_halalas, target_sales_halalas: s.target_sales_halalas,
      contracts_halalas: f.contracts_halalas, contracts_net_halalas: f.contracts_net_halalas,
      contracts_count: f.contracts_count,
      revenue_pct: s.target_revenue_halalas ? Math.round((f.revenue_halalas / s.target_revenue_halalas) * 100) : 0,
      sales_pct: s.target_sales_halalas ? Math.round((f.sales_halalas / s.target_sales_halalas) * 100) : 0,
      opp_count: oppCount,
    };
  }));
  const totals = perSector.reduce((a, s) => ({
    revenue: a.revenue + s.revenue_halalas, target_revenue: a.target_revenue + s.target_revenue_halalas,
    sales: a.sales + s.sales_halalas, target_sales: a.target_sales + s.target_sales_halalas,
  }), { revenue: 0, target_revenue: 0, sales: 0, target_sales: 0 });
  // Open pipeline (not year-bound): value of non-closed opportunities
  const pipeline = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
      WHERE st.is_won=0 AND st.is_lost=0 AND o.deleted_at IS NULL`)).v;
  return { fiscalYear: year, years: await availableYears(), sectors: perSector, totals, pipeline_halalas: pipeline,
    canSeeCost: canSeeSensitive(user, 'cost'), canSeeMargin: canSeeSensitive(user, 'margin') };
}

// Multi-year trend for a sector (or whole company when sectorId is null).
// Build a CONTINUOUS year axis (min..FY) so years with no data render as zero bars rather than
// being silently dropped and misrepresenting the time axis with uneven spacing.
export async function multiYearTrend(sectorId, nYears = 5) {
  const withData = (await availableYears()).filter((y) => y <= FY());
  const minY = Math.max(withData.length ? Math.min(...withData) : FY() - nYears + 1, FY() - nYears - 1);
  const years = [];
  for (let y = minY; y <= FY(); y++) years.push(y);
  const secClause = sectorId ? 'AND sector_id = ?' : '';
  const secP = sectorId ? [sectorId] : [];
  return Promise.all(years.map(async (y) => {
    const revenue = (await get(`SELECT ${NET_REVENUE} v FROM revenue_line WHERE year = ? ${secClause}`, [y, ...secP])).v;
    const sales = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
        WHERE o.year = ? AND st.is_won=1 AND o.exclude_from_sales=0 AND o.deleted_at IS NULL ${sectorId ? 'AND o.sector_id = ?' : ''}`, [y, ...secP])).v;
    const contracts = (await get(`SELECT COALESCE(SUM(value_halalas),0) v FROM contract
        WHERE CAST(substr(start_date,1,4) AS INTEGER) = ? ${secClause} AND deleted_at IS NULL`, [y, ...secP])).v;
    return { year: y, revenue_halalas: revenue, sales_halalas: sales, contracts_halalas: contracts };
  }));
}

// ── قرار: لوحة وحدة المساندة تعمل ولا تُرفض، لكنها لا تدّعي هدفاً ──
// الطلب هنا صريح بمعرّف واحد (لا قائمة)، ومَن يطلبه فعلاً هو موظف الوحدة نفسه: صفحة مركز
// القيادة تسقط إلى قطاع حساب المستخدم، وقطاع من يعمل في «الخدمات المشتركة» هو الوحدة نفسها.
// الرفض كان يعني صفحة رئيسية فارغة (أو رسالة «لا يوجد قطاع مرتبط بحسابك» وهي كذبة: قطاعه
// موجود) لشخص لم يرتكب خطأً — فالرفض أشد إرباكاً من القبول. لذلك:
//   • الأرقام **الفعلية** تُعرض كما هي: لو سُجّل إيراد على الوحدة فإخفاؤه كذبة ثانية.
//   • أما **المستهدفات** فتُعاد فارغة لوحدة المساندة: هي لا تُقاس بمبيعات ولا إيراد، وأي رقم
//     مسجَّل عليها سهواً كان سينتج نسبة إنجاز موهومة على شريط في الشاشة. الفراغ يعرض الحالة
//     المصمَّمة سلفاً («لا هدف مسجّل لهذه السنة») بدل نسبة لا معنى لها.
//   • ويرافق الصف نوعه (kind/is_support) كي تسمّيها الشاشة «وحدة مساندة» لا «قطاعاً».
export async function sectorDashboard(user, sectorId, opts = {}) {
  const year = Number(opts.year) || FY();
  // الحارس هنا لا على المسار وحده. كانت الدالة تستقبل المستخدم ولا تفحصه إطلاقاً، وتتكل على فحص
  // مسار الواجهة البرمجية — بينما الصفحة تستدعيها مباشرةً ولا تمرّ بذلك الفحص. أي أن بوابة واحدة
  // كانت تحرس بابين، وأحدهما لا يمرّ بها. من نطاقه قطاع يرى قطاعه وحده مهما كان المطلوب.
  if (user && user.scope !== 'company' && user.sector_id !== sectorId) throw forbidden('هذا القطاع خارج نطاقك');
  const s = await get('SELECT * FROM sector WHERE id = ?', [sectorId]);
  if (!s) return null;
  const support = isSupportUnit(s);
  const targetRevenue = support ? null : s.target_revenue_halalas;
  const targetSales = support ? null : s.target_sales_halalas;
  const f = await sectorYearFigures(sectorId, year);
  // عدّ المشاريع بعدسة السنة نفسها التي تعرضها اللوحة — قاعدة «مشروع السنة» الواحدة
  // (projectYearClause): كانت العدسة عمياء عن السنة فعرضت «صحة التنفيذ 2026» مشاريعَ
  // قديمة بلا تواريخ ولا إيراد، وقرّر المالك أن صفحة المشاريع هي الصحيحة (2026-08-16).
  const yc = projectYearClause(year);
  const projects = await all(`SELECT status, COUNT(*) n FROM project WHERE sector_id = ? AND deleted_at IS NULL AND ${yc.clause} GROUP BY status`, [sectorId, ...yc.params]);
  const rag = await all(`SELECT rag, COUNT(*) n FROM project WHERE sector_id = ? AND deleted_at IS NULL AND status='IN_PROGRESS' AND ${yc.clause} GROUP BY rag`, [sectorId, ...yc.params]);
  const deliverables = await all("SELECT status, COUNT(*) n FROM deliverable WHERE sector_id = ? AND deleted_at IS NULL GROUP BY status", [sectorId]);
  const openRisks = (await get("SELECT COUNT(*) n FROM risk WHERE sector_id = ? AND status != 'CLOSED' AND deleted_at IS NULL", [sectorId])).n;
  return {
    sector: { id: s.id, name_ar: s.name_ar, kind: s.kind || null, is_support: support }, year,
    projects: Object.fromEntries(projects.map((r) => [r.status, r.n])),
    rag: Object.fromEntries(rag.map((r) => [r.rag, r.n])),
    revenue_halalas: f.revenue_halalas, target_revenue_halalas: targetRevenue,
    sales_halalas: f.sales_halalas, target_sales_halalas: targetSales,
    contracts_halalas: f.contracts_halalas, contracts_net_halalas: f.contracts_net_halalas,
    contracts_count: f.contracts_count,
    deliverables: Object.fromEntries(deliverables.map((r) => [r.status, r.n])),
    openRisks, trend: await multiYearTrend(sectorId, 4),
  };
}

export async function projectKpis(projectId) {
  const tasks = await all(`SELECT status, COUNT(*) n FROM task WHERE project_id = ? AND deleted_at IS NULL
     AND ${approvedTaskSql('')} GROUP BY status`, [projectId]);
  const t = Object.fromEntries(tasks.map((r) => [r.status, r.n]));
  const totalTasks = Object.values(t).reduce((a, b) => a + b, 0);
  const done = t.DONE || 0;
  const late = (await get(`SELECT COUNT(*) n FROM task WHERE project_id = ? AND status != 'DONE' AND due_date IS NOT NULL
     AND substr(due_date,1,10) < ? AND deleted_at IS NULL AND ${approvedTaskSql('')}`, [projectId, nowIso().slice(0, 10)])).n;
  // «معتمَد» صار حالةً واحدة صريحة. كانت تُجمع من ثلاث (مقبول + مفوتر + مدفوع) لأن الفوترة
  // تمحو القبول فيلزم استرجاعه منها — فكان **إصدارُ المستخلص وحده يرفع نسبة الاعتماد** ولو لم
  // يعتمد العميل شيئاً. زال المحو (ترحيلة ٠١٧) فزالت الحاجة، وزالت معها الكذبة.
  const dlv = await all("SELECT status, COUNT(*) n FROM deliverable WHERE project_id = ? AND deleted_at IS NULL GROUP BY status", [projectId]);
  const dlvMap = Object.fromEntries(dlv.map((r) => [r.status, r.n]));
  const accepted = dlvMap.ACCEPTED || 0;
  const totalDlv = Object.values(dlvMap).reduce((a, b) => a + b, 0);
  return {
    taskCompletionRate: totalTasks ? Math.round((done / totalTasks) * 100) : 0,
    lateTasks: late,
    deliverableAcceptanceRate: totalDlv ? Math.round((accepted / totalDlv) * 100) : 0,
    totalTasks, totalDeliverables: totalDlv,
  };
}

export async function sectorUtilization(sectorId, from, to) {
  const rows = await all(`SELECT te.user_id, u.name_ar,
      COALESCE(SUM(te.hours),0) total,
      COALESCE(SUM(CASE WHEN te.billable=1 THEN te.hours ELSE 0 END),0) billable
    FROM time_entry te JOIN app_user u ON u.id = te.user_id
    WHERE u.sector_id = ? AND te.entry_date BETWEEN ? AND ? AND te.deleted_at IS NULL
    GROUP BY te.user_id, u.name_ar`, [sectorId, from, to]);
  return rows.map((r) => ({ ...r, utilization_pct: r.total ? Math.round((r.billable / r.total) * 100) : 0 }));
}

// ── Period model: quarter (1-4) maps to months; month filters revenue_line directly. ──
export async function quarterlyRevenue(sectorId, year, scope = {}) {
  const sc = projectScopeSql('p', scope);
  const rows = await all(`SELECT rl.month, ${NET_REVENUE} v FROM revenue_line rl
     ${sc.active ? 'LEFT JOIN project p ON p.id = rl.project_id' : ''}
     WHERE rl.year = ? ${sectorId ? 'AND rl.sector_id = ?' : ''} AND rl.month IS NOT NULL${sc.clause} GROUP BY rl.month`,
    [year, ...(sectorId ? [sectorId] : []), ...sc.args]);
  const byMonth = Object.fromEntries(rows.map((r) => [r.month, r.v]));
  const q = [0, 0, 0, 0];
  for (let m = 1; m <= 12; m++) q[Math.floor((m - 1) / 3)] += byMonth[m] || 0;
  return q.map((v, i) => ({ quarter: `Q${i + 1}`, year, revenue_halalas: v }));
}

// ── Sector command-center metrics ──
// Monthly staffing + utilization from the allocation model (allocation.monthly_json = {month: fraction}).
export async function sectorStaffing(sectorId, year) {
  const allocs = await all(`SELECT a.employee_id, a.person_name_ar, a.project_name, a.monthly_json, e.job_title
     FROM allocation a LEFT JOIN employee e ON e.id=a.employee_id
     WHERE a.sector_id = ? AND a.year = ? AND a.deleted_at IS NULL`, [sectorId, year]);
  const byEmp = {};
  for (const a of allocs) {
    const key = a.employee_id || a.person_name_ar || 'x';
    if (!byEmp[key]) byEmp[key] = { name: a.person_name_ar || '—', job: a.job_title || '', projects: new Set(), months: {} };
    if (a.project_name) byEmp[key].projects.add(a.project_name);
    let mj = {}; try { mj = JSON.parse(a.monthly_json || '{}'); } catch { mj = {}; }
    for (const [m, frac] of Object.entries(mj)) byEmp[key].months[m] = (byEmp[key].months[m] || 0) + Number(frac || 0);
  }
  const nowM = year === new Date().getUTCFullYear() ? (new Date().getUTCMonth() + 1) : 0;
  const employees = Object.values(byEmp).map((e) => {
    const months = Array.from({ length: 12 }, (_, i) => Math.round((e.months[i + 1] || 0) * 100));
    const util = Math.round(months.reduce((a, b) => a + b, 0) / 12); // annual: % of the year utilized
    const current = nowM ? months[nowM - 1] : 0;                     // this month's load
    return { name: e.name, job: e.job, projects: e.projects.size, months, utilization: util, current };
  }).sort((a, b) => (b.current - a.current) || (b.utilization - a.utilization));
  const teamUtil = employees.length ? Math.round(employees.reduce((a, e) => a + e.utilization, 0) / employees.length) : 0;
  const teamCurrent = employees.length ? Math.round(employees.reduce((a, e) => a + e.current, 0) / employees.length) : 0;
  // العدد المعلن = موظفو القطاع النشطون (نفس أساس صفحة الفريق) — لا من لديهم تسكين فقط،
  // كي لا يقرأ المالك ثلاثة أحجام مختلفة للفريق نفسه عبر الصفحات
  const activeHeadcount = (await get(
    'SELECT COUNT(*) n FROM employee WHERE sector_id = ? AND active = 1 AND deleted_at IS NULL', [sectorId]))?.n || 0;
  return { employees, teamUtil, teamCurrent, currentMonth: nowM, headcount: Math.max(activeHeadcount, employees.length) };
}

// Clients active in a sector, with their pipeline and project counts.
export async function sectorClients(sectorId) {
  return await all(`SELECT c.id, c.name_ar,
     (SELECT COUNT(*) FROM opportunity o WHERE o.client_id=c.id AND o.sector_id=? AND o.deleted_at IS NULL) opps,
     (SELECT COALESCE(SUM(o.value_halalas),0) FROM opportunity o WHERE o.client_id=c.id AND o.sector_id=? AND o.deleted_at IS NULL) pipeline_halalas,
     (SELECT COUNT(*) FROM project p WHERE p.client_id=c.id AND p.sector_id=? AND p.deleted_at IS NULL) projects
     FROM client c WHERE c.deleted_at IS NULL
     AND (EXISTS(SELECT 1 FROM opportunity o WHERE o.client_id=c.id AND o.sector_id=? AND o.deleted_at IS NULL)
       OR EXISTS(SELECT 1 FROM project p WHERE p.client_id=c.id AND p.sector_id=? AND p.deleted_at IS NULL))
     ORDER BY pipeline_halalas DESC LIMIT 12`, [sectorId, sectorId, sectorId, sectorId, sectorId]);
}

// Win/loss for a sector in a year.
export async function sectorWins(sectorId, year) {
  const w = await get(`SELECT COUNT(*) n, COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE o.sector_id=? AND o.year=? AND st.is_won=1 AND o.exclude_from_sales=0 AND o.deleted_at IS NULL`, [sectorId, year]);
  const l = await get(`SELECT COUNT(*) n FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE o.sector_id=? AND o.year=? AND st.is_lost=1 AND o.deleted_at IS NULL`, [sectorId, year]);
  return { won: w.n, wonValue_halalas: w.v, lost: l.n, winRate: (w.n + l.n) ? Math.round(w.n / (w.n + l.n) * 100) : 0 };
}

// Bookings (won-opportunity value) per quarter of the year, by the win date (stage_changed_at).
export async function quarterlyBookings(sectorId, year, scope = {}) {
  const sc = projectScopeSql('o', scope);
  const rows = await all(`SELECT CAST(substr(o.stage_changed_at,6,2) AS INTEGER) m, COALESCE(SUM(o.value_halalas),0) v
     FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? AND o.deleted_at IS NULL AND o.stage_changed_at IS NOT NULL
     ${sectorId ? 'AND o.sector_id = ?' : ''}${sc.clause} GROUP BY m`, [year, ...(sectorId ? [sectorId] : []), ...sc.args]);
  const byM = Object.fromEntries(rows.map((r) => [r.m, r.v]));
  const q = [0, 0, 0, 0];
  for (let m = 1; m <= 12; m++) q[Math.floor((m - 1) / 3)] += byM[m] || 0;
  return q.map((v, i) => ({ quarter: `Q${i + 1}`, year, sales_halalas: v }));
}

// Win rate per year (won / (won+lost) by count) — for the exec trend.
export async function winRateByYear(sectorId, nYears = 5) {
  // Continuous year axis (matches multiYearTrend) so a gap year shows its real value, not a skipped bar.
  const withData = (await availableYears()).filter((y) => y <= FY());
  const minY = Math.max(withData.length ? Math.min(...withData) : FY() - nYears + 1, FY() - nYears - 1);
  const years = [];
  for (let y = minY; y <= FY(); y++) years.push(y);
  return Promise.all(years.map(async (y) => ({ year: y, ...(await winRate(sectorId, y)) })));
}

// Backlog = signed contract value not yet recognized as revenue (a Tier-1 commercial metric).
// طرفا الطرح **صافيان معاً**: المطروح منه صافي قيمة العقود والمطروح صافي الإيراد المعترف به.
// طرحُ صافٍ من إجمالي كان يترك في «المتبقي» ضريبةَ العقود كلها ويعرضها عملاً لم يُنجَز بعد —
// وهو رقمٌ يُقرأ التزاماً تعاقدياً ويُبنى عليه توظيف. والإجمالي مذكور بجانبه لمن يريد قيمة
// العقود كما وُقّعت مع العميل.
export async function backlog(sectorId) {
  const c = await get(`SELECT COALESCE(SUM(value_halalas),0) gross,
       COALESCE(SUM(COALESCE(net_value_halalas, CAST(COALESCE(value_halalas, 0) AS BIGINT) * 100 / 115)), 0) net
     FROM contract
     WHERE status IN ('ACTIVE','DRAFT') ${sectorId ? 'AND sector_id = ?' : ''} AND deleted_at IS NULL`,
  sectorId ? [sectorId] : []);
  const recognized = (await get(`SELECT ${NET_REVENUE} v FROM revenue_line
     WHERE 1=1 ${sectorId ? 'AND sector_id = ?' : ''}`, sectorId ? [sectorId] : [])).v;
  return { contracted_halalas: c.net, contracted_gross_halalas: c.gross, recognized_halalas: recognized,
    backlog_halalas: Math.max(0, c.net - recognized) };
}

// Pipeline coverage = open weighted pipeline ÷ remaining sales target (Tier-1 commercial ratio).
export async function pipelineCoverage(sectorId, year) {
  // مستهدف المبيعات مجموع قطاعات التسليم وحدها: وحدة المساندة لا تُقاس بالمبيعات أصلاً، فأي
  // رقم مسجَّل عليها سهواً كان سيتضخّم به مستهدف الشركة كله وتنخفض به «تغطية خط الفرص».
  // الشرط مطبَّق في الحالتين (الشركة كلها وقطاع بعينه) كي لا يفترق حكم الرقمين على الوحدة نفسها.
  const target = (await get(`SELECT COALESCE(SUM(target_sales_halalas),0) v FROM sector
     WHERE active=1 AND deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL} ${sectorId ? 'AND id = ?' : ''}`,
    sectorId ? [sectorId] : [])).v;
  const soldRow = await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? ${sectorId ? 'AND o.sector_id=?' : ''} AND o.deleted_at IS NULL`,
    [year, ...(sectorId ? [sectorId] : [])]);
  // الطرف المفتوح كان بلا سنةٍ وبلا استبعادٍ وبمعلّقةٍ داخله، ثم تُقسَم قيمتُه **الخام** على
  // المتبقي بينما البطاقة تعرض **المرجّح** فوقها — رقمان لا يتطابقان فوق بعضهما. التعريف الآن
  // واحد: مرجّحٌ · سنة معروضة (أو بلا سنة) · بلا «معلّقة» — كما يستبعدها قمع الصفحة نفسه.
  const openRow = await get(`SELECT COALESCE(SUM(o.value_halalas),0) raw,
       ${WEIGHTED_OPEN} weighted
     FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=0 AND st.is_lost=0 AND o.stage_id != 'ON_HOLD' AND o.exclude_from_sales=0
       AND (o.year = ? OR o.year IS NULL)
       ${sectorId ? 'AND o.sector_id=?' : ''} AND o.deleted_at IS NULL`,
    [year, ...(sectorId ? [sectorId] : [])]);
  const remaining = Math.max(0, target - soldRow.v);
  const weighted = Math.round(openRow.weighted);
  return { open_halalas: openRow.raw, weighted_halalas: weighted,
    remaining_target_halalas: remaining, coverage: remaining ? +(weighted / remaining).toFixed(1) : null };
}

// Book-to-Bill = new bookings (won value in year) ÷ revenue recognized in year.
// < 1 sustained = burning backlog faster than replacing it (Tier-1 commercial risk).
// المقام صافٍ، والبسط قيمة فرصٍ مكسوبة — وهي تقديرُ ما قبل التعاقد وبقيت خارج فصل الضريبة عمداً
// (لا فاتورة صدرت بها ولا مستند ضريبي). فالنسبة تقريبية بطبيعتها كما كانت، ولم يزدها الفصل ولم
// ينقصها: هي مؤشر اتجاه لا رقم محاسبي، ويصير دقيقاً حين تُقاس التعاقدات من جدول العقود.
export async function bookToBill(sectorId, year) {
  const bookings = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? ${sectorId ? 'AND o.sector_id=?' : ''} AND o.deleted_at IS NULL`,
    [year, ...(sectorId ? [sectorId] : [])])).v;
  const revenue = (await get(`SELECT ${NET_REVENUE} v FROM revenue_line WHERE year=? ${sectorId ? 'AND sector_id=?' : ''}`,
    [year, ...(sectorId ? [sectorId] : [])])).v;
  return { bookings_halalas: bookings, revenue_halalas: revenue,
    ratio: revenue ? +(bookings / revenue).toFixed(2) : null };
}

// Gross Margin % for a sector/year = (revenue − cost − approved expense) ÷ revenue. SENSITIVE.
// المعادلة صافيةٌ في أطرافها الثلاثة الآن، وكان طرفها الأول وحده إجمالياً فيخرج هامشٌ أعلى من
// حقيقته: خمسة عشر بالمئة من الإيراد كانت تُحسب ربحاً وهي أمانةٌ تُورَّد للدولة.
//   • الإيراد: صافٍ بالقاعدة الواحدة.
//   • بند الكلفة: كما هو — اعترافٌ بكلفةٍ صافية بطبيعته (الضريبة المدخلة مستردّة فلا تدخله)،
//     وأول أنواعه «رواتب» ولا ضريبة على راتب. فصلُه كان يخترع ضريبةً مستردّة وينقص الكلفة.
//   • المصروف: صافيه **المسجَّل** إن سُجِّل، وإلا فإجماليه. أي أن ما لم تُسجَّل ضريبته يُحمَّل
//     كاملاً على الكلفة — وهو التحفّظ الصحيح: لا يُفترض استردادٌ لم يُثبته أحد.
export async function grossMargin(sectorId, year) {
  const rev = (await get(`SELECT ${NET_REVENUE} v FROM revenue_line WHERE year=? ${sectorId ? 'AND sector_id=?' : ''}`, [year, ...(sectorId ? [sectorId] : [])])).v;
  const cost = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM cost_line WHERE year=? ${sectorId ? 'AND sector_id=?' : ''}`, [year, ...(sectorId ? [sectorId] : [])])).v;
  const exp = (await get(`SELECT COALESCE(SUM(COALESCE(net_amount_halalas, amount_halalas)),0) v FROM expense WHERE incurred_year=? AND status IN ('APPROVED','PAID') ${sectorId ? 'AND sector_id=?' : ''}`, [year, ...(sectorId ? [sectorId] : [])])).v;
  const gp = rev - cost - exp;
  return { revenue_halalas: rev, cost_halalas: cost + exp, gross_profit_halalas: gp, margin_pct: rev ? Math.round((gp / rev) * 100) : null };
}

// Year-over-year delta % for a numeric field between year and year-1 (uses a getter fn).
export function yoy(getterForYear, year) {
  const cur = getterForYear(year), prev = getterForYear(year - 1);
  if (!prev) return { cur, prev, pct: null };
  return { cur, prev, pct: Math.round(((cur - prev) / prev) * 100) };
}

// Win rate for a sector/year (won / (won+lost) by count).
export async function winRate(sectorId, year) {
  const r = await get(`SELECT
      SUM(CASE WHEN st.is_won=1 THEN 1 ELSE 0 END) won,
      SUM(CASE WHEN st.is_lost=1 THEN 1 ELSE 0 END) lost
    FROM opportunity o JOIN stage st ON st.id=o.stage_id
    WHERE o.deleted_at IS NULL ${sectorId ? 'AND o.sector_id = ?' : ''} ${year ? 'AND o.year = ?' : ''}`,
    [...(sectorId ? [sectorId] : []), ...(year ? [year] : [])]);
  const decided = (r.won || 0) + (r.lost || 0);
  return { won: r.won || 0, lost: r.lost || 0, rate: decided ? Math.round((r.won / decided) * 100) : 0 };
}

// ── Delivery-2 additions (sector center v3) ──

// Monthly recognized revenue for a sector (or company when sectorId null) in a fiscal year.
export async function monthlyRevenue(sectorId, year) {
  const rows = await all(`SELECT month, ${NET_REVENUE} v FROM revenue_line
      WHERE year = ? ${sectorId ? 'AND sector_id = ?' : ''} GROUP BY month ORDER BY month`,
    sectorId ? [year, sectorId] : [year]);
  const out = Array(12).fill(0);
  for (const r of rows) { const i = Number(r.month) - 1; if (i >= 0 && i < 12) out[i] = r.v || 0; }
  return out;
}

// ── التعبير القانوني الواحد للخط المرجّح ─────────────────────────────────────────────
// فرصة بلا احتمال فوز تُساهم بصفر في المرجّح (لا تُسمِّم المجموع بـnull فتُسقط غيرها) — وكانت
// ثلاثة مواضع تحسبه بصيغتين مختلفتين فيعرض للقارئ رقمان «مرجّحان» لا يتطابقان. من هنا فقط.
export const WEIGHTED_OPEN = 'COALESCE(SUM(o.value_halalas * COALESCE(o.win_pct,0) / 100.0),0)';

// المرسّى شهرياً — سلسلة اثني عشر شهراً متتابعة تنتهي عند نهاية النافذة، بتاريخ الفوز الفعلي
// (stage_changed_at للفرص المحسومة موثوق — إعادة ضبط ساعة المراحل 2026-08-03 مسّت المفتوحة وحدها).
// تعبر حدود سنة الفرصة عمداً: سلسلةٌ زمنية متدحرجة لا إسنادُ سنةٍ مالية.
export async function winsByMonth(sectorId, { untilIso, months = 12 } = {}) {
  const u = String(untilIso).slice(0, 10);
  const last = new Date(Date.parse(u) - 86400000);
  const slots = [];
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - k, 1));
    slots.push({ ym: d.toISOString().slice(0, 7), year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, n: 0, v: 0 });
  }
  const sinceIso = `${slots[0].ym}-01`;
  const rows = await all(`SELECT substr(o.stage_changed_at,1,7) ym, COUNT(*) n, COALESCE(SUM(o.value_halalas),0) v
     FROM opportunity o JOIN stage st ON st.id = o.stage_id
     WHERE st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL AND o.stage_changed_at IS NOT NULL
       AND substr(o.stage_changed_at,1,10) >= ? AND substr(o.stage_changed_at,1,10) < ?
       ${sectorId ? 'AND o.sector_id = ?' : ''}
     GROUP BY substr(o.stage_changed_at,1,7)`, [sinceIso, u, ...(sectorId ? [sectorId] : [])]);
  const byYm = Object.fromEntries(rows.map((r) => [r.ym, r]));
  for (const sl of slots) { const r = byYm[sl.ym]; if (r) { sl.n = r.n || 0; sl.v = r.v || 0; } }
  return { sinceIso, untilIso: u, slots };
}

// أرقام النافذة — مصدر واحد يغذّي شريط المؤشرات ورقائق النبض معاً فلا يفترق رقمان لنفس الشيء.
// المكسوب ونسبة الفوز في استعلام واحد؛ المفوتر والمحصَّل لمن يقرأ الفواتير وإلا null (لا صفر كاذب).
export async function windowFigures(user, sectorId, sinceIso, untilIso, scope = {}) {
  const invoicesOk = can(user, 'read', 'invoice');
  // قصّ الإدارة/العميل: الفرص بعموديها مباشرةً، والفواتير والتحصيل عبر مشروع الفاتورة —
  // فاتورةٌ بلا مشروع تدخل «بلا إدارة» وتسقط من الترشيح الموجب (الشاشة تُفصح عن غير المنسوب).
  const osc = projectScopeSql('o', scope);
  const psc = invoiceScopeSql(scope);
  const [w, inv, col] = await Promise.all([
    get(`SELECT
        SUM(CASE WHEN st.is_won = 1 AND o.exclude_from_sales = 0 THEN 1 ELSE 0 END) won_n,
        COALESCE(SUM(CASE WHEN st.is_won = 1 AND o.exclude_from_sales = 0 THEN o.value_halalas ELSE 0 END),0) won_v,
        SUM(CASE WHEN st.is_lost = 1 THEN 1 ELSE 0 END) lost_n
      FROM opportunity o JOIN stage st ON st.id = o.stage_id
      WHERE o.sector_id = ? AND o.deleted_at IS NULL AND o.stage_changed_at IS NOT NULL
        AND substr(o.stage_changed_at,1,10) >= ? AND substr(o.stage_changed_at,1,10) < ?${osc.clause}`,
    [sectorId, sinceIso, untilIso, ...osc.args]),
    invoicesOk ? get(`SELECT COUNT(*) n, COALESCE(SUM(i.amount_halalas),0) v FROM invoice i LEFT JOIN project p ON p.id = i.project_id
      WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL AND i.status NOT IN ('DRAFT','CANCELLED')
        AND i.issue_date IS NOT NULL AND substr(i.issue_date,1,10) >= ? AND substr(i.issue_date,1,10) < ?${psc.clause}`,
    [sectorId, sinceIso, untilIso, ...psc.args]) : null,
    invoicesOk ? get(`SELECT COUNT(*) n, COALESCE(SUM(col.amount_halalas),0) v FROM collection col
      JOIN invoice i ON i.id = col.invoice_id LEFT JOIN project p ON p.id = i.project_id
      WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL
        AND col.collected_at IS NOT NULL AND substr(col.collected_at,1,10) >= ? AND substr(col.collected_at,1,10) < ?${psc.clause}`,
    [sectorId, sinceIso, untilIso, ...psc.args]) : null,
  ]);
  const won = w?.won_n || 0, lost = w?.lost_n || 0, decided = won + lost;
  return {
    wins: { n: won, v: w?.won_v || 0 },
    decided: { won, lost, rate: decided ? Math.round((won / decided) * 100) : null },
    invoiced: inv ? { n: inv.n || 0, v: inv.v || 0 } : null,
    collected: col ? { n: col.n || 0, v: col.v || 0 } : null,
  };
}

// ── توقّع الإيراد نهاية السنة: من الإيراد نفسه، لا من قيمة الصفقات ────────────────────────
// الصيغة السابقة (المحقق + الخط المرجّح) كانت تجمع **مخزوناً** من قيمةٍ تعاقدية إجمالية متعددة
// السنوات إلى **تدفّقٍ** من إيراد سنةٍ واحدة معترفٍ به — ولا علاقة حسابية بينهما: لا مسار في
// المنصة يحوّل قيمة فرصة إلى إيراد؛ الإيراد لا يُولَد إلا حين يبلغ مخرَجٌ حالة «سُلِّم/قُبِل»
// (recognition.js وترحيلة 020). فصفقةُ خدماتٍ مُدارة بـ270 مليوناً على خمس سنوات كانت تُضيف
// 81 مليوناً إلى توقّع سنةٍ هدفُها 32 — فيخرج «+1057%» بجانب شارةٍ تقول «متقدّم بعشر نقاط».
//
// الأساس الآن الوتيرة المُثبَتة: ما تحقّق مقسوماً على ما انقضى من السنة. والحدّان من تباين
// الأشهر المسجَّلة نفسها لا من الخط:
//   المتحفّظ = المحقق + (أدنى شهرٍ مسجَّل × الأشهر المتبقية)   ← «إن استمر أبطأ شهر»
//   الأساس   = المحقق ÷ نسبة انقضاء السنة                      ← «إن استمرت الوتيرة نفسها»
//   المتفائل = المحقق + (أفضل شهرٍ مسجَّل × الأشهر المتبقية)   ← «إن تكرّر أفضل شهر»
// وسنةٌ منقضية توقّعُها = محقّقها (لا تنبّؤ لما مضى)، وسنةٌ لم يمضِ منها شهرٌ بعدُ لا تُتنبَّأ.
export async function revenueOutlook(sectorId, year, today = new Date()) {
  // ── سنةٌ قادمة واحدة: «امتداد الوتيرة المُثبَتة» (قرار أ. حسين 2026-08-25) ────────────
  // لا سجلّ للسنة القادمة، فأساسها متوسطُ الشهر المسجَّل في السنة الجارية × 12، وحدّاها
  // أبطأ/أفضل شهرٍ مسجَّل × 12 — امتدادُ وتيرةٍ معلَنٌ يحمل علامته، لا تنبؤاً بغيب. وما
  // سُجِّل عليها فعلاً (نادراً) يُعاد في actual كما هو. وأبعدُ من سنةٍ: لا توقّع — لا أساس يُمدّ.
  const nowY = today.getUTCFullYear();
  if (Number(year) === nowY + 1) {
    const actual = (await get(`SELECT ${NET_REVENUE} v FROM revenue_line
        WHERE year = ? ${sectorId ? 'AND sector_id = ?' : ''}`, sectorId ? [year, sectorId] : [year]))?.v || 0;
    const basis = await revenueOutlook(sectorId, nowY, today);
    if (basis.tooEarly || !basis.monthsSeen) {
      return { actual, elapsedPct: 0, base: null, low: null, high: null, monthsSeen: 0,
        remainingMonths: 12, minMonth: 0, maxMonth: 0, closed: false, tooEarly: true,
        nextYear: true, basisYear: nowY, avgMonth: 0 };
    }
    const avgMonth = Math.round(basis.actual / Math.max(1, basis.monthsSeen));
    const low = basis.minMonth * 12, high = basis.maxMonth * 12;
    return { actual, elapsedPct: 0,
      base: Math.max(low, Math.min(high, avgMonth * 12)), low, high,
      monthsSeen: basis.monthsSeen, remainingMonths: 12,
      minMonth: basis.minMonth, maxMonth: basis.maxMonth,
      closed: false, tooEarly: false, nextYear: true, basisYear: nowY, avgMonth };
  }
  const actual = (await get(`SELECT ${NET_REVENUE} v FROM revenue_line
      WHERE year = ? ${sectorId ? 'AND sector_id = ?' : ''}`, sectorId ? [year, sectorId] : [year]))?.v || 0;
  const elapsed = yearElapsedPct(today, year);
  const months = await monthlyRevenue(sectorId, year);
  // الأشهر المنقضية وحدها هي المسجَّلة: شهرٌ لم يأتِ بعد ليس «شهراً بصفر»
  const doneM = elapsed >= 100 ? 12 : Math.max(0, Math.min(12, Math.floor(elapsed / 100 * 12)));
  const seen = months.slice(0, doneM);
  const remainingM = Math.max(0, 12 - doneM);
  if (elapsed >= 100) {
    return { actual, elapsedPct: 100, base: actual, low: actual, high: actual,
      monthsSeen: doneM, remainingMonths: 0, minMonth: 0, maxMonth: 0, closed: true, tooEarly: false };
  }
  if (!doneM || !elapsed) {
    return { actual, elapsedPct: elapsed, base: null, low: null, high: null,
      monthsSeen: doneM, remainingMonths: remainingM, minMonth: 0, maxMonth: 0, closed: false, tooEarly: true };
  }
  const minMonth = Math.min(...seen), maxMonth = Math.max(...seen);
  const base = Math.round(actual / (elapsed / 100));
  const low = actual + minMonth * remainingM;
  const high = actual + maxMonth * remainingM;
  return { actual, elapsedPct: elapsed,
    base: Math.max(low, Math.min(high, base)), low, high,
    monthsSeen: doneM, remainingMonths: remainingM, minMonth, maxMonth, closed: false, tooEarly: false };
}

// ── قصّ الإدارة/العميل عبر مشروع السجل (قاعدة ترحيلة 034: الإدارة المسؤولة وحدها) ─────────
// بنود الإيراد والفواتير تُنسَب لإدارةٍ أو عميلٍ عبر مشروعها: LEFT JOIN ثم شرطٌ على أعمدة
// المشروع. بندٌ بلا مشروع يدخل «بلا إدارة» (أعمدته كلها فارغة في الضم الأيسر) ويسقط من أي
// ترشيحٍ موجب — والشاشة تُفصح عن الساقط بدل إسقاطه صامتاً. صالحةٌ أيضاً لجدول الفرص مباشرةً
// (فيه العمودان نفساهما) بتمرير اسمه المستعار.
export function projectScopeSql(alias, { dept = null, client = null } = {}) {
  let clause = '';
  const args = [];
  if (dept === 'none') clause += ` AND ${alias}.department_id IS NULL`;
  else if (dept) { clause += ` AND ${alias}.department_id = ?`; args.push(dept); }
  if (client) { clause += ` AND ${alias}.client_id = ?`; args.push(client); }
  return { clause, args, active: !!(dept || client) };
}

// قصّ الفواتير خاصةً: العميل من الفاتورة نفسها إن سُجِّل وإلا من مشروعها (الفاتورة تحمل
// عميلها مباشرةً)، والإدارة عبر المشروع دوماً. يفترض الاستعلامَ ضامّاً invoice i وproject p.
export function invoiceScopeSql({ dept = null, client = null } = {}) {
  let clause = '';
  const args = [];
  if (dept === 'none') clause += ' AND p.department_id IS NULL';
  else if (dept) { clause += ' AND p.department_id = ?'; args.push(dept); }
  if (client) { clause += ' AND COALESCE(i.client_id, p.client_id) = ?'; args.push(client); }
  return { clause, args, active: !!(dept || client) };
}

// بنود الإيراد مرشَّحةً بإدارة/عميل: الأشهر للرسم، والإجمالي للبطاقة (يضمّ بنوداً منسوبةً بلا
// شهر)، وغير المنسوب (بند بلا مشروع) يُعاد ليُفصَح عنه — تحت ترشيحٍ موجب لا سبيل لنسبته.
export async function revenueScope(sectorId, year, scope = {}) {
  const sc = projectScopeSql('p', scope);
  const rows = await all(`SELECT rl.month, ${NET_REVENUE} v FROM revenue_line rl
      LEFT JOIN project p ON p.id = rl.project_id
      WHERE rl.sector_id = ? AND rl.year = ?${sc.clause} GROUP BY rl.month ORDER BY rl.month`,
  [sectorId, year, ...sc.args]);
  const months = Array(12).fill(0);
  let total = 0;
  for (const r of rows) { total += r.v || 0; const i = Number(r.month) - 1; if (i >= 0 && i < 12) months[i] = r.v || 0; }
  const needsAttr = !!(scope.client || (scope.dept && scope.dept !== 'none'));
  const un = needsAttr ? (await get(`SELECT ${NET_REVENUE} v FROM revenue_line
      WHERE sector_id = ? AND year = ? AND project_id IS NULL`, [sectorId, year]))?.v || 0 : 0;
  return { months, total, unattributed: un };
}

// التوقّع من سلسلةٍ شهرية جاهزة (المقصوصة بإدارة/عميل) — رياضيات revenueOutlook نفسها حرفاً:
// الأساس محقّقُ السلسلة ÷ المنقضي من السنة مثبَّتاً بين الحدّين، والحدّان من تباين أشهرها.
export function outlookFromMonths(months, year, today = new Date()) {
  const elapsed = yearElapsedPct(today, year);
  const actual = (months || []).reduce((a, v) => a + (v || 0), 0);
  const doneM = elapsed >= 100 ? 12 : Math.max(0, Math.min(12, Math.floor(elapsed / 100 * 12)));
  const seen = (months || []).slice(0, doneM);
  const remainingM = Math.max(0, 12 - doneM);
  if (elapsed >= 100) {
    return { actual, elapsedPct: 100, base: actual, low: actual, high: actual,
      monthsSeen: doneM, remainingMonths: 0, minMonth: 0, maxMonth: 0, closed: true, tooEarly: false };
  }
  if (!doneM || !elapsed) {
    return { actual, elapsedPct: elapsed, base: null, low: null, high: null,
      monthsSeen: doneM, remainingMonths: remainingM, minMonth: 0, maxMonth: 0, closed: false, tooEarly: true };
  }
  const minMonth = Math.min(...seen), maxMonth = Math.max(...seen);
  const base = Math.round(actual / (elapsed / 100));
  const low = actual + minMonth * remainingM;
  const high = actual + maxMonth * remainingM;
  return { actual, elapsedPct: elapsed,
    base: Math.max(low, Math.min(high, base)), low, high,
    monthsSeen: doneM, remainingMonths: remainingM, minMonth, maxMonth, closed: false, tooEarly: false };
}

// إيراد النافذة — بنود الإيراد شهرية، فالمجموع لأشهرٍ تتقاطع مع النافذة (والشاشة تُعلن الأساس).
// النافذة مقصوصة على سنتها في windowBounds فكل أشهرها من السنة نفسها.
export async function windowRevenue(sectorId, year, sinceIso, untilIso, scope = {}) {
  const since = String(sinceIso).slice(0, 10), until = String(untilIso).slice(0, 10);
  if (!(since < until)) return { v: 0, months: [] };
  const last = new Date(Date.parse(until) - 86400000);
  const firstM = Number(since.slice(5, 7));
  const lastM = last.getUTCFullYear() === Number(year) ? last.getUTCMonth() + 1
    : (last.getUTCFullYear() > Number(year) ? 12 : 0);
  if (!lastM || lastM < firstM) return { v: 0, months: [] };
  const months = []; for (let m = firstM; m <= lastM; m++) months.push(m);
  const sc = projectScopeSql('p', scope);
  const r = await get(`SELECT ${NET_REVENUE} v FROM revenue_line rl
      ${sc.active ? 'LEFT JOIN project p ON p.id = rl.project_id' : ''}
      WHERE rl.year = ? ${sectorId ? 'AND rl.sector_id = ?' : ''} AND rl.month IN (${months.map(() => '?').join(',')})${sc.clause}`,
  [year, ...(sectorId ? [sectorId] : []), ...months, ...sc.args]);
  return { v: r?.v || 0, months };
}

// Open-pipeline age buckets by days-in-current-stage (needs a bound `today` for portability).
export async function pipelineAging(sectorId, today) {
  const rows = await all(`SELECT o.value_halalas, COALESCE(substr(o.stage_changed_at,1,10), substr(o.created_at,1,10)) d
      FROM opportunity o JOIN stage st ON st.id = o.stage_id
      WHERE o.deleted_at IS NULL AND st.is_won = 0 AND st.is_lost = 0 ${sectorId ? 'AND o.sector_id = ?' : ''}`,
    sectorId ? [sectorId] : []);
  const buckets = [
    { key: '0-14', label: 'أقل من أسبوعين', max: 14, n: 0, v: 0 },
    { key: '15-30', label: 'أسبوعان إلى شهر', max: 30, n: 0, v: 0 },
    { key: '31-60', label: 'شهر إلى شهرين', max: 60, n: 0, v: 0 },
    { key: '60+', label: 'أكثر من شهرين', max: Infinity, n: 0, v: 0 },
  ];
  const T = Date.parse(today);
  for (const r of rows) {
    const age = r.d ? Math.floor((T - Date.parse(r.d)) / 86400000) : 0;
    const b = buckets.find((x) => age <= x.max);
    if (b) { b.n++; b.v += r.value_halalas || 0; }
  }
  return buckets;
}

// ── v2.1: رياضيات «الإيقاع مقابل الخطة» (Pace vs Plan) — دوال نقية بلا قاعدة بيانات ──
// المبدأ الثابت: مقياس أي شريط = المستهدف السنوي فقط؛ المتوقع لا يحدد مقياس شريط أبداً.
import { yearElapsedPct } from '../i18n/time.js';
export { yearElapsedPct };

// المستهدف «حتى اليوم» = المستهدف السنوي × نسبة السنة المنقضية
export function targetToDate(targetHalalas, today = new Date(), year = today.getUTCFullYear()) {
  return Math.round((targetHalalas || 0) * (yearElapsedPct(today, year) / 100));
}

// انحراف الإيقاع بالنقاط المئوية: (المحقق/المستهدف)% − (المنقضي من السنة)%
// موجب = متقدم عن الخطة الزمنية، سالب = متأخر. null عند غياب المستهدف.
export function paceDelta(actualHalalas, targetHalalas, today = new Date(), year = today.getUTCFullYear()) {
  if (!targetHalalas) return null;
  const attain = ((actualHalalas || 0) / targetHalalas) * 100;
  return Math.round(attain - yearElapsedPct(today, year));
}

// «المطلوب شهرياً للمتبقي»: (المستهدف − المحقق) ÷ الأشهر المتبقية (يشمل الشهر الجاري).
// null عند غياب المستهدف أو انتهاء السنة؛ 0 عند بلوغ الهدف.
export function requiredRunRate(actualHalalas, targetHalalas, today = new Date(), year = today.getUTCFullYear()) {
  if (!targetHalalas) return null;
  const y = Number(year);
  const nowY = today.getUTCFullYear();
  const monthsLeft = nowY < y ? 12 : nowY > y ? 0 : 12 - today.getUTCMonth();
  if (monthsLeft <= 0) return null;
  const gap = Math.max(0, (targetHalalas || 0) - (actualHalalas || 0));
  return Math.round(gap / monthsLeft);
}
