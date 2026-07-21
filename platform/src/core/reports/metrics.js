// Metrics/KPIs powering dashboards — YEAR-AWARE. All queries respect the caller's scope;
// sensitive aggregates (cost/margin) only for users who can read those gates.
// Sales = WON opportunities in a fiscal year. Revenue = recognized revenue_line in that year.
// Contracts span years; contract value is total, revenue is recognized per year.
import { all, get } from '../db/index.js';
import { canSeeSensitive } from '../rbac/index.js';
import { config } from '../config.js';
import { nowIso } from '../util/ids.js';

const FY = () => config.fiscalYear;

// Distinct years present in the data (for year pickers), newest first.
export async function availableYears() {
  const rows = await all(`SELECT DISTINCT y FROM (
      SELECT year y FROM revenue_line WHERE year IS NOT NULL
      UNION SELECT year FROM opportunity WHERE year IS NOT NULL
      UNION SELECT CAST(substr(start_date,1,4) AS INTEGER) FROM contract WHERE start_date IS NOT NULL
    ) WHERE y IS NOT NULL ORDER BY y DESC`);
  const years = rows.map((r) => r.y);
  if (!years.includes(FY())) years.unshift(FY());
  return years;
}

// ── per-sector figures for a single year ──
async function sectorYearFigures(sectorId, year) {
  const revenue = (await get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE sector_id = ? AND year = ?', [sectorId, year])).v;
  // Sales = value of WON opportunities booked in that year (excluding flagged-out)
  const sales = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o
      JOIN stage st ON st.id = o.stage_id
      WHERE o.sector_id = ? AND o.year = ? AND st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL`,
    [sectorId, year])).v;
  const contractsSigned = await get(`SELECT COALESCE(SUM(value_halalas),0) v, COUNT(*) n FROM contract
      WHERE sector_id = ? AND CAST(substr(start_date,1,4) AS INTEGER) = ? AND deleted_at IS NULL`, [sectorId, year]);
  return { revenue_halalas: revenue, sales_halalas: sales,
    contracts_halalas: contractsSigned.v, contracts_count: contractsSigned.n };
}

export async function companyOverview(user, opts = {}) {
  const year = Number(opts.year) || FY();
  const sectors = await all('SELECT * FROM sector WHERE deleted_at IS NULL AND active = 1 ORDER BY sort_order');
  const perSector = await Promise.all(sectors.map(async (s) => {
    const f = await sectorYearFigures(s.id, year);
    const oppCount = (await get('SELECT COUNT(*) n FROM opportunity WHERE sector_id = ? AND deleted_at IS NULL', [s.id])).n;
    return {
      id: s.id, name_ar: s.name_ar, name_en: s.name_en, color: s.color, placeholder: !!s.is_placeholder,
      revenue_halalas: f.revenue_halalas, target_revenue_halalas: s.target_revenue_halalas,
      sales_halalas: f.sales_halalas, target_sales_halalas: s.target_sales_halalas,
      contracts_halalas: f.contracts_halalas, contracts_count: f.contracts_count,
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
    const revenue = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year = ? ${secClause}`, [y, ...secP])).v;
    const sales = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
        WHERE o.year = ? AND st.is_won=1 AND o.exclude_from_sales=0 AND o.deleted_at IS NULL ${sectorId ? 'AND o.sector_id = ?' : ''}`, [y, ...secP])).v;
    const contracts = (await get(`SELECT COALESCE(SUM(value_halalas),0) v FROM contract
        WHERE CAST(substr(start_date,1,4) AS INTEGER) = ? ${secClause} AND deleted_at IS NULL`, [y, ...secP])).v;
    return { year: y, revenue_halalas: revenue, sales_halalas: sales, contracts_halalas: contracts };
  }));
}

export async function sectorDashboard(user, sectorId, opts = {}) {
  const year = Number(opts.year) || FY();
  const s = await get('SELECT * FROM sector WHERE id = ?', [sectorId]);
  if (!s) return null;
  const f = await sectorYearFigures(sectorId, year);
  const projects = await all("SELECT status, COUNT(*) n FROM project WHERE sector_id = ? AND deleted_at IS NULL GROUP BY status", [sectorId]);
  const rag = await all("SELECT rag, COUNT(*) n FROM project WHERE sector_id = ? AND deleted_at IS NULL AND status='IN_PROGRESS' GROUP BY rag", [sectorId]);
  const deliverables = await all("SELECT status, COUNT(*) n FROM deliverable WHERE sector_id = ? AND deleted_at IS NULL GROUP BY status", [sectorId]);
  const openRisks = (await get("SELECT COUNT(*) n FROM risk WHERE sector_id = ? AND status != 'CLOSED'", [sectorId])).n;
  return {
    sector: { id: s.id, name_ar: s.name_ar }, year,
    projects: Object.fromEntries(projects.map((r) => [r.status, r.n])),
    rag: Object.fromEntries(rag.map((r) => [r.rag, r.n])),
    revenue_halalas: f.revenue_halalas, target_revenue_halalas: s.target_revenue_halalas,
    sales_halalas: f.sales_halalas, target_sales_halalas: s.target_sales_halalas,
    contracts_halalas: f.contracts_halalas, contracts_count: f.contracts_count,
    deliverables: Object.fromEntries(deliverables.map((r) => [r.status, r.n])),
    openRisks, trend: await multiYearTrend(sectorId, 4),
  };
}

export async function projectKpis(projectId) {
  const tasks = await all("SELECT status, COUNT(*) n FROM task WHERE project_id = ? AND deleted_at IS NULL GROUP BY status", [projectId]);
  const t = Object.fromEntries(tasks.map((r) => [r.status, r.n]));
  const totalTasks = Object.values(t).reduce((a, b) => a + b, 0);
  const done = t.DONE || 0;
  const late = (await get("SELECT COUNT(*) n FROM task WHERE project_id = ? AND status != 'DONE' AND due_date IS NOT NULL AND substr(due_date,1,10) < ? AND deleted_at IS NULL", [projectId, nowIso().slice(0, 10)])).n;
  const dlv = await all("SELECT status, COUNT(*) n FROM deliverable WHERE project_id = ? AND deleted_at IS NULL GROUP BY status", [projectId]);
  const dlvMap = Object.fromEntries(dlv.map((r) => [r.status, r.n]));
  const accepted = (dlvMap.ACCEPTED || 0) + (dlvMap.INVOICED || 0) + (dlvMap.PAID || 0);
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
export async function quarterlyRevenue(sectorId, year) {
  const rows = await all(`SELECT month, COALESCE(SUM(amount_halalas),0) v FROM revenue_line
     WHERE year = ? ${sectorId ? 'AND sector_id = ?' : ''} AND month IS NOT NULL GROUP BY month`,
    [year, ...(sectorId ? [sectorId] : [])]);
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
export async function quarterlyBookings(sectorId, year) {
  const rows = await all(`SELECT CAST(substr(o.stage_changed_at,6,2) AS INTEGER) m, COALESCE(SUM(o.value_halalas),0) v
     FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? AND o.deleted_at IS NULL AND o.stage_changed_at IS NOT NULL
     ${sectorId ? 'AND o.sector_id = ?' : ''} GROUP BY m`, [year, ...(sectorId ? [sectorId] : [])]);
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
export async function backlog(sectorId) {
  const contracted = (await get(`SELECT COALESCE(SUM(value_halalas),0) v FROM contract
     WHERE status IN ('ACTIVE','DRAFT') ${sectorId ? 'AND sector_id = ?' : ''} AND deleted_at IS NULL`,
    sectorId ? [sectorId] : [])).v;
  const recognized = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line
     WHERE 1=1 ${sectorId ? 'AND sector_id = ?' : ''}`, sectorId ? [sectorId] : [])).v;
  return { contracted_halalas: contracted, recognized_halalas: recognized,
    backlog_halalas: Math.max(0, contracted - recognized) };
}

// Pipeline coverage = open weighted pipeline ÷ remaining sales target (Tier-1 commercial ratio).
export async function pipelineCoverage(sectorId, year) {
  const target = (await get(`SELECT COALESCE(SUM(target_sales_halalas),0) v FROM sector
     WHERE active=1 AND deleted_at IS NULL ${sectorId ? 'AND id = ?' : ''}`, sectorId ? [sectorId] : [])).v;
  const soldRow = await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? ${sectorId ? 'AND o.sector_id=?' : ''} AND o.deleted_at IS NULL`,
    [year, ...(sectorId ? [sectorId] : [])]);
  const openRow = await get(`SELECT COALESCE(SUM(o.value_halalas),0) raw,
       COALESCE(SUM(o.value_halalas * COALESCE(o.win_pct,0)/100.0),0) weighted
     FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=0 AND st.is_lost=0 ${sectorId ? 'AND o.sector_id=?' : ''} AND o.deleted_at IS NULL`,
    sectorId ? [sectorId] : []);
  const remaining = Math.max(0, target - soldRow.v);
  return { open_halalas: openRow.raw, weighted_halalas: Math.round(openRow.weighted),
    remaining_target_halalas: remaining, coverage: remaining ? +(openRow.raw / remaining).toFixed(1) : null };
}

// Book-to-Bill = new bookings (won value in year) ÷ revenue recognized in year.
// < 1 sustained = burning backlog faster than replacing it (Tier-1 commercial risk).
export async function bookToBill(sectorId, year) {
  const bookings = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? ${sectorId ? 'AND o.sector_id=?' : ''} AND o.deleted_at IS NULL`,
    [year, ...(sectorId ? [sectorId] : [])])).v;
  const revenue = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year=? ${sectorId ? 'AND sector_id=?' : ''}`,
    [year, ...(sectorId ? [sectorId] : [])])).v;
  return { bookings_halalas: bookings, revenue_halalas: revenue,
    ratio: revenue ? +(bookings / revenue).toFixed(2) : null };
}

// Gross Margin % for a sector/year = (revenue − cost − approved expense) ÷ revenue. SENSITIVE.
export async function grossMargin(sectorId, year) {
  const rev = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year=? ${sectorId ? 'AND sector_id=?' : ''}`, [year, ...(sectorId ? [sectorId] : [])])).v;
  const cost = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM cost_line WHERE year=? ${sectorId ? 'AND sector_id=?' : ''}`, [year, ...(sectorId ? [sectorId] : [])])).v;
  const exp = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM expense WHERE incurred_year=? AND status IN ('APPROVED','PAID') ${sectorId ? 'AND sector_id=?' : ''}`, [year, ...(sectorId ? [sectorId] : [])])).v;
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
  const rows = await all(`SELECT month, COALESCE(SUM(amount_halalas),0) v FROM revenue_line
      WHERE year = ? ${sectorId ? 'AND sector_id = ?' : ''} GROUP BY month ORDER BY month`,
    sectorId ? [year, sectorId] : [year]);
  const out = Array(12).fill(0);
  for (const r of rows) { const i = Number(r.month) - 1; if (i >= 0 && i < 12) out[i] = r.v || 0; }
  return out;
}

// End-of-year revenue forecast = recognized revenue + weighted OPEN pipeline for the same FY.
// (المتوقع نهاية السنة = المحقق + المرجّح من الفرص المفتوحة لهذه السنة — معادلة معلنة في الواجهة.)
export async function revenueForecast(sectorId, year) {
  const actual = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line
      WHERE year = ? ${sectorId ? 'AND sector_id = ?' : ''}`, sectorId ? [year, sectorId] : [year]))?.v || 0;
  const wp = (await get(`SELECT COALESCE(SUM(o.value_halalas * o.win_pct / 100.0),0) v
      FROM opportunity o JOIN stage st ON st.id = o.stage_id
      WHERE o.deleted_at IS NULL AND st.is_won = 0 AND st.is_lost = 0 AND o.year = ?
      ${sectorId ? 'AND o.sector_id = ?' : ''}`, sectorId ? [year, sectorId] : [year]))?.v || 0;
  const weightedOpen = Math.round(wp);
  return { actual, weightedOpen, forecast: actual + weightedOpen };
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
