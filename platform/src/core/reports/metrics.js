// Metrics/KPIs powering dashboards — YEAR-AWARE. All queries respect the caller's scope;
// sensitive aggregates (cost/margin) only for users who can read those gates.
// Sales = WON opportunities in a fiscal year. Revenue = recognized revenue_line in that year.
// Contracts span years; contract value is total, revenue is recognized per year.
import { all, get } from '../db/index.js';
import { canSeeSensitive } from '../rbac/index.js';
import { config } from '../config.js';

const FY = () => config.fiscalYear;

// Distinct years present in the data (for year pickers), newest first.
export function availableYears() {
  const rows = all(`SELECT DISTINCT y FROM (
      SELECT year y FROM revenue_line WHERE year IS NOT NULL
      UNION SELECT year FROM opportunity WHERE year IS NOT NULL
      UNION SELECT CAST(substr(start_date,1,4) AS INTEGER) FROM contract WHERE start_date IS NOT NULL
    ) WHERE y IS NOT NULL ORDER BY y DESC`);
  const years = rows.map((r) => r.y);
  if (!years.includes(FY())) years.unshift(FY());
  return years;
}

// ── per-sector figures for a single year ──
function sectorYearFigures(sectorId, year) {
  const revenue = get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE sector_id = ? AND year = ?', [sectorId, year]).v;
  // Sales = value of WON opportunities booked in that year (excluding flagged-out)
  const sales = get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o
      JOIN stage st ON st.id = o.stage_id
      WHERE o.sector_id = ? AND o.year = ? AND st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL`,
    [sectorId, year]).v;
  const contractsSigned = get(`SELECT COALESCE(SUM(value_halalas),0) v, COUNT(*) n FROM contract
      WHERE sector_id = ? AND CAST(substr(start_date,1,4) AS INTEGER) = ? AND deleted_at IS NULL`, [sectorId, year]);
  return { revenue_halalas: revenue, sales_halalas: sales,
    contracts_halalas: contractsSigned.v, contracts_count: contractsSigned.n };
}

export function companyOverview(user, opts = {}) {
  const year = Number(opts.year) || FY();
  const sectors = all('SELECT * FROM sector WHERE deleted_at IS NULL AND active = 1 ORDER BY sort_order');
  const perSector = sectors.map((s) => {
    const f = sectorYearFigures(s.id, year);
    const oppCount = get('SELECT COUNT(*) n FROM opportunity WHERE sector_id = ? AND deleted_at IS NULL', [s.id]).n;
    return {
      id: s.id, name_ar: s.name_ar, name_en: s.name_en, color: s.color, placeholder: !!s.is_placeholder,
      revenue_halalas: f.revenue_halalas, target_revenue_halalas: s.target_revenue_halalas,
      sales_halalas: f.sales_halalas, target_sales_halalas: s.target_sales_halalas,
      contracts_halalas: f.contracts_halalas, contracts_count: f.contracts_count,
      revenue_pct: s.target_revenue_halalas ? Math.round((f.revenue_halalas / s.target_revenue_halalas) * 100) : 0,
      sales_pct: s.target_sales_halalas ? Math.round((f.sales_halalas / s.target_sales_halalas) * 100) : 0,
      opp_count: oppCount,
    };
  });
  const totals = perSector.reduce((a, s) => ({
    revenue: a.revenue + s.revenue_halalas, target_revenue: a.target_revenue + s.target_revenue_halalas,
    sales: a.sales + s.sales_halalas, target_sales: a.target_sales + s.target_sales_halalas,
  }), { revenue: 0, target_revenue: 0, sales: 0, target_sales: 0 });
  // Open pipeline (not year-bound): value of non-closed opportunities
  const pipeline = get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
      WHERE st.is_won=0 AND st.is_lost=0 AND o.deleted_at IS NULL`).v;
  return { fiscalYear: year, years: availableYears(), sectors: perSector, totals, pipeline_halalas: pipeline,
    canSeeCost: canSeeSensitive(user, 'cost'), canSeeMargin: canSeeSensitive(user, 'margin') };
}

// Multi-year trend for a sector (or whole company when sectorId is null): last N years.
export function multiYearTrend(sectorId, nYears = 4) {
  const years = availableYears().filter((y) => y <= FY()).slice(0, nYears).sort((a, b) => a - b);
  const secClause = sectorId ? 'AND sector_id = ?' : '';
  const secP = sectorId ? [sectorId] : [];
  return years.map((y) => {
    const revenue = get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year = ? ${secClause}`, [y, ...secP]).v;
    const sales = get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
        WHERE o.year = ? AND st.is_won=1 AND o.exclude_from_sales=0 AND o.deleted_at IS NULL ${sectorId ? 'AND o.sector_id = ?' : ''}`, [y, ...secP]).v;
    const contracts = get(`SELECT COALESCE(SUM(value_halalas),0) v FROM contract
        WHERE CAST(substr(start_date,1,4) AS INTEGER) = ? ${secClause} AND deleted_at IS NULL`, [y, ...secP]).v;
    return { year: y, revenue_halalas: revenue, sales_halalas: sales, contracts_halalas: contracts };
  });
}

export function sectorDashboard(user, sectorId, opts = {}) {
  const year = Number(opts.year) || FY();
  const s = get('SELECT * FROM sector WHERE id = ?', [sectorId]);
  if (!s) return null;
  const f = sectorYearFigures(sectorId, year);
  const projects = all("SELECT status, COUNT(*) n FROM project WHERE sector_id = ? AND deleted_at IS NULL GROUP BY status", [sectorId]);
  const rag = all("SELECT rag, COUNT(*) n FROM project WHERE sector_id = ? AND deleted_at IS NULL AND status='IN_PROGRESS' GROUP BY rag", [sectorId]);
  const deliverables = all("SELECT status, COUNT(*) n FROM deliverable WHERE sector_id = ? AND deleted_at IS NULL GROUP BY status", [sectorId]);
  const openRisks = get("SELECT COUNT(*) n FROM risk WHERE sector_id = ? AND status != 'CLOSED'", [sectorId]).n;
  return {
    sector: { id: s.id, name_ar: s.name_ar }, year,
    projects: Object.fromEntries(projects.map((r) => [r.status, r.n])),
    rag: Object.fromEntries(rag.map((r) => [r.rag, r.n])),
    revenue_halalas: f.revenue_halalas, target_revenue_halalas: s.target_revenue_halalas,
    sales_halalas: f.sales_halalas, target_sales_halalas: s.target_sales_halalas,
    contracts_halalas: f.contracts_halalas, contracts_count: f.contracts_count,
    deliverables: Object.fromEntries(deliverables.map((r) => [r.status, r.n])),
    openRisks, trend: multiYearTrend(sectorId, 4),
  };
}

export function projectKpis(projectId) {
  const tasks = all("SELECT status, COUNT(*) n FROM task WHERE project_id = ? AND deleted_at IS NULL GROUP BY status", [projectId]);
  const t = Object.fromEntries(tasks.map((r) => [r.status, r.n]));
  const totalTasks = Object.values(t).reduce((a, b) => a + b, 0);
  const done = t.DONE || 0;
  const late = get("SELECT COUNT(*) n FROM task WHERE project_id = ? AND status != 'DONE' AND due_date IS NOT NULL AND date(due_date) < date('now') AND deleted_at IS NULL", [projectId]).n;
  const dlv = all("SELECT status, COUNT(*) n FROM deliverable WHERE project_id = ? AND deleted_at IS NULL GROUP BY status", [projectId]);
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

export function sectorUtilization(sectorId, from, to) {
  const rows = all(`SELECT te.user_id, u.name_ar,
      COALESCE(SUM(te.hours),0) total,
      COALESCE(SUM(CASE WHEN te.billable=1 THEN te.hours ELSE 0 END),0) billable
    FROM time_entry te JOIN app_user u ON u.id = te.user_id
    WHERE u.sector_id = ? AND te.entry_date BETWEEN ? AND ? AND te.deleted_at IS NULL
    GROUP BY te.user_id`, [sectorId, from, to]);
  return rows.map((r) => ({ ...r, utilization_pct: r.total ? Math.round((r.billable / r.total) * 100) : 0 }));
}

// ── Period model: quarter (1-4) maps to months; month filters revenue_line directly. ──
export function quarterlyRevenue(sectorId, year) {
  const rows = all(`SELECT month, COALESCE(SUM(amount_halalas),0) v FROM revenue_line
     WHERE year = ? ${sectorId ? 'AND sector_id = ?' : ''} AND month IS NOT NULL GROUP BY month`,
    [year, ...(sectorId ? [sectorId] : [])]);
  const byMonth = Object.fromEntries(rows.map((r) => [r.month, r.v]));
  const q = [0, 0, 0, 0];
  for (let m = 1; m <= 12; m++) q[Math.floor((m - 1) / 3)] += byMonth[m] || 0;
  return q.map((v, i) => ({ quarter: `Q${i + 1}`, year, revenue_halalas: v }));
}

// Win rate per year (won / (won+lost) by count) — for the exec trend.
export function winRateByYear(sectorId, nYears = 4) {
  const years = availableYears().filter((y) => y <= FY()).slice(0, nYears).sort((a, b) => a - b);
  return years.map((y) => ({ year: y, ...winRate(sectorId, y) }));
}

// Backlog = signed contract value not yet recognized as revenue (a Tier-1 commercial metric).
export function backlog(sectorId) {
  const contracted = get(`SELECT COALESCE(SUM(value_halalas),0) v FROM contract
     WHERE status IN ('ACTIVE','DRAFT') ${sectorId ? 'AND sector_id = ?' : ''} AND deleted_at IS NULL`,
    sectorId ? [sectorId] : []).v;
  const recognized = get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line
     WHERE 1=1 ${sectorId ? 'AND sector_id = ?' : ''}`, sectorId ? [sectorId] : []).v;
  return { contracted_halalas: contracted, recognized_halalas: recognized,
    backlog_halalas: Math.max(0, contracted - recognized) };
}

// Pipeline coverage = open weighted pipeline ÷ remaining sales target (Tier-1 commercial ratio).
export function pipelineCoverage(sectorId, year) {
  const target = get(`SELECT COALESCE(SUM(target_sales_halalas),0) v FROM sector
     WHERE active=1 AND deleted_at IS NULL ${sectorId ? 'AND id = ?' : ''}`, sectorId ? [sectorId] : []).v;
  const soldRow = get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? ${sectorId ? 'AND o.sector_id=?' : ''} AND o.deleted_at IS NULL`,
    [year, ...(sectorId ? [sectorId] : [])]);
  const openRow = get(`SELECT COALESCE(SUM(o.value_halalas),0) raw,
       COALESCE(SUM(o.value_halalas * COALESCE(o.win_pct,0)/100.0),0) weighted
     FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=0 AND st.is_lost=0 ${sectorId ? 'AND o.sector_id=?' : ''} AND o.deleted_at IS NULL`,
    sectorId ? [sectorId] : []);
  const remaining = Math.max(0, target - soldRow.v);
  return { open_halalas: openRow.raw, weighted_halalas: Math.round(openRow.weighted),
    remaining_target_halalas: remaining, coverage: remaining ? +(openRow.raw / remaining).toFixed(1) : null };
}

// Win rate for a sector/year (won / (won+lost) by count).
export function winRate(sectorId, year) {
  const r = get(`SELECT
      SUM(CASE WHEN st.is_won=1 THEN 1 ELSE 0 END) won,
      SUM(CASE WHEN st.is_lost=1 THEN 1 ELSE 0 END) lost
    FROM opportunity o JOIN stage st ON st.id=o.stage_id
    WHERE o.deleted_at IS NULL ${sectorId ? 'AND o.sector_id = ?' : ''} ${year ? 'AND o.year = ?' : ''}`,
    [...(sectorId ? [sectorId] : []), ...(year ? [year] : [])]);
  const decided = (r.won || 0) + (r.lost || 0);
  return { won: r.won || 0, lost: r.lost || 0, rate: decided ? Math.round((r.won / decided) * 100) : 0 };
}
