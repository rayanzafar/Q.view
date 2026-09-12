import { all } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { forbidden, badRequest } from '../../core/http/errors.js';
import { config } from '../../core/config.js';
import { recognitionPeriod } from './revenue-period.js';
import { splitGross } from './vat.js';

// Read-only diagnostics. A finding identifies missing/conflicting evidence, not a correction.
export async function revenueReview(user, opts = {}) {
  if (!can(user, 'read', 'revenue_line')) throw forbidden();
  const year = opts.year == null || opts.year === '' ? config.fiscalYear : Number(opts.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('السنة غير صحيحة — اختر سنة بين 2000 و2100');
  const scope = scopeFilter(user, 'revenue_line', 'read', { sectorCol: 'r.sector_id', projectCol: 'r.project_id' });
  const where = [scope.clause, 'r.year = ?']; const params = [...scope.params, year];
  const sector = typeof opts.sector === 'string' ? opts.sector : '';
  if (sector) { where.push('r.sector_id = ?'); params.push(sector); }
  const records = await all(`SELECT r.*, p.name_ar project_name, p.department_id, p.owner_user_id, p.deleted_at project_deleted,
    d.id source_id, d.year source_year, d.month source_month, d.accepted_at, d.delivered_at, d.status_at,
    d.amount_halalas source_amount, d.deleted_at source_deleted, s.name_ar sector_name
    FROM revenue_line r LEFT JOIN project p ON p.id = r.project_id
    LEFT JOIN deliverable d ON d.id = r.deliverable_id
    LEFT JOIN sector s ON s.id = r.sector_id
    WHERE ${where.join(' AND ')} ORDER BY r.month, r.project_id, r.id`, params);
  const issues = []; let recordedNet = 0;
  for (const r of records) {
    const net = r.net_amount_halalas == null ? splitGross(r.amount_halalas).net_halalas : Number(r.net_amount_halalas);
    recordedNet += net;
    const reasons = [];
    if (r.net_amount_halalas == null || r.vat_halalas == null) reasons.push('تفصيل الصافي والضريبة غير مكتمل — راجع أساس المبلغ');
    if (!r.deliverable_id) reasons.push('غير مربوط بمخرج — راجع مصدره من المشروع');
    else if (!r.source_id || r.source_deleted) reasons.push('المخرج المرتبط غير متاح — راجع سجل المشروع');
    else {
      try {
        const period = recognitionPeriod({ year: r.source_year, month: r.source_month, accepted_at: r.accepted_at,
          delivered_at: r.delivered_at, status_at: r.status_at });
        if (period.year !== Number(r.year) || period.month !== Number(r.month)) reasons.push('فترة الإيراد تختلف عن فترة المخرج');
      } catch (e) { if (e.code !== 'bad_request') throw e; reasons.push(e.message); }
      if (Number(r.amount_halalas) !== Number(r.source_amount)) reasons.push('المبلغ المسجل يختلف عن مبلغ المخرج');
    }
    if (r.vat_halalas != null && net + Number(r.vat_halalas) !== Number(r.amount_halalas)) reasons.push('الصافي والضريبة لا يساويان الإجمالي');
    if (!reasons.length) continue;
    const mayOpen = r.project_id && !r.project_deleted && can(user, 'read', 'project', {
      id: r.project_id, sector_id: r.sector_id, department_id: r.department_id, owner_user_id: r.owner_user_id });
    issues.push({ id: r.id, year: Number(r.year), month: Number(r.month), net, reasons,
      label: r.label || 'إيراد بلا بيان', sectorName: r.sector_name || 'غير مسجل',
      estimatedNet: r.net_amount_halalas == null,
      projectName: mayOpen ? r.project_name : 'تفاصيل المشروع غير متاحة',
      href: mayOpen ? `/app/project/${encodeURIComponent(r.project_id)}?year=${year}#sec-deliverables` : null });
  }
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(issues.length / pageSize));
  const page = Math.min(pages, Math.max(1, Number.parseInt(opts.page, 10) || 1));
  return { year, sector, page, pages, total: records.length, issueCount: issues.length, recordedNet,
    reviewNet: issues.reduce((sum, r) => sum + r.net, 0), rows: issues.slice((page - 1) * pageSize, page * pageSize) };
}
