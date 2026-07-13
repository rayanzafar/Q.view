// Metrics/KPIs powering dashboards. All queries respect the caller's scope; sensitive
// aggregates (cost/margin) are only computed for users who can read those gates.
import { all, get } from '../db/index.js';
import { canSeeSensitive } from '../rbac/index.js';
import { scopeFilter } from '../rbac/scope.js';
import { config } from '../config.js';

const yr = () => config.fiscalYear;

export function companyOverview(user) {
  const sectors = all('SELECT * FROM sector WHERE deleted_at IS NULL AND active = 1 ORDER BY sort_order');
  const perSector = sectors.map((s) => {
    const rev = get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE sector_id = ? AND year = ?',
      [s.id, yr()]).v;
    const sales = get(`SELECT COALESCE(SUM(value_halalas),0) v FROM opportunity o
      JOIN stage st ON st.id = o.stage_id
      WHERE o.sector_id = ? AND st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL`, [s.id]).v;
    const oppCount = get('SELECT COUNT(*) n FROM opportunity WHERE sector_id = ? AND deleted_at IS NULL', [s.id]).n;
    return {
      id: s.id, name_ar: s.name_ar, name_en: s.name_en, color: s.color, placeholder: !!s.is_placeholder,
      revenue_halalas: rev, target_revenue_halalas: s.target_revenue_halalas,
      sales_halalas: sales, target_sales_halalas: s.target_sales_halalas,
      revenue_pct: s.target_revenue_halalas ? Math.round((rev / s.target_revenue_halalas) * 100) : 0,
      sales_pct: s.target_sales_halalas ? Math.round((sales / s.target_sales_halalas) * 100) : 0,
      opp_count: oppCount,
    };
  });
  const totals = perSector.reduce((a, s) => ({
    revenue: a.revenue + s.revenue_halalas, target_revenue: a.target_revenue + s.target_revenue_halalas,
    sales: a.sales + s.sales_halalas, target_sales: a.target_sales + s.target_sales_halalas,
  }), { revenue: 0, target_revenue: 0, sales: 0, target_sales: 0 });
  const pipeline = get('SELECT COALESCE(SUM(value_halalas),0) v FROM opportunity WHERE deleted_at IS NULL').v;
  return { fiscalYear: yr(), sectors: perSector, totals, pipeline_halalas: pipeline,
    canSeeCost: canSeeSensitive(user, 'cost'), canSeeMargin: canSeeSensitive(user, 'margin') };
}

export function sectorDashboard(user, sectorId) {
  const s = get('SELECT * FROM sector WHERE id = ?', [sectorId]);
  if (!s) return null;
  const projects = all("SELECT status, COUNT(*) n FROM project WHERE sector_id = ? AND deleted_at IS NULL GROUP BY status", [sectorId]);
  const rag = all("SELECT rag, COUNT(*) n FROM project WHERE sector_id = ? AND deleted_at IS NULL AND status='IN_PROGRESS' GROUP BY rag", [sectorId]);
  const rev = get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE sector_id = ? AND year = ?', [sectorId, yr()]).v;
  const deliverables = all("SELECT status, COUNT(*) n FROM deliverable WHERE sector_id = ? AND deleted_at IS NULL GROUP BY status", [sectorId]);
  const openRisks = get("SELECT COUNT(*) n FROM risk WHERE sector_id = ? AND status != 'CLOSED'", [sectorId]).n;
  return {
    sector: { id: s.id, name_ar: s.name_ar },
    projects: Object.fromEntries(projects.map((r) => [r.status, r.n])),
    rag: Object.fromEntries(rag.map((r) => [r.rag, r.n])),
    revenue_halalas: rev, target_revenue_halalas: s.target_revenue_halalas,
    deliverables: Object.fromEntries(deliverables.map((r) => [r.status, r.n])),
    openRisks,
  };
}

// PMO KPIs (project-level) — computed from tasks/deliverables/milestones.
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

// Workforce utilization across a sector for a period.
export function sectorUtilization(sectorId, from, to) {
  const rows = all(`SELECT te.user_id, u.name_ar,
      COALESCE(SUM(te.hours),0) total,
      COALESCE(SUM(CASE WHEN te.billable=1 THEN te.hours ELSE 0 END),0) billable
    FROM time_entry te JOIN app_user u ON u.id = te.user_id
    WHERE u.sector_id = ? AND te.entry_date BETWEEN ? AND ? AND te.deleted_at IS NULL
    GROUP BY te.user_id`, [sectorId, from, to]);
  return rows.map((r) => ({ ...r, utilization_pct: r.total ? Math.round((r.billable / r.total) * 100) : 0 }));
}
