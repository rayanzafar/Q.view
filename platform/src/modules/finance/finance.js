// Finance module — the contract→deliverable→progress-claim→collection lifecycle,
// aggregated per project manager, per contract, per deliverable. Scope + audit enforced.
import { all, get, insert, update, run } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { config } from '../../core/config.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';

const FY = () => config.fiscalYear;

// Outstanding (AR) per invoice = amount − retention − collected.
function outstanding(inv) {
  const collected = get('SELECT COALESCE(SUM(amount_halalas),0) v FROM collection WHERE invoice_id = ?', [inv.id]).v;
  return Math.max(0, inv.amount_halalas - (inv.retention_halalas || 0) - collected);
}

// ── Bridge + AR + DSO (scope-filtered) ──
export function financeSummary(user, year = FY()) {
  const f = scopeFilter(user, 'invoice', 'read'); // invoice has sector_id
  const invClause = f.clause, invP = f.params;
  const bookings = get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? AND o.deleted_at IS NULL`, [year]).v;
  const revenue = get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year = ?', [year]).v;
  const invoiced = get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM invoice WHERE ${invClause} AND deleted_at IS NULL AND status != 'DRAFT'`, invP).v;
  const collected = get(`SELECT COALESCE(SUM(c.amount_halalas),0) v FROM collection c JOIN invoice i ON i.id=c.invoice_id WHERE ${invClause}`, invP).v;
  const invoices = all(`SELECT * FROM invoice WHERE ${invClause} AND deleted_at IS NULL AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')`, invP);
  const ar = invoices.reduce((a, i) => a + outstanding(i), 0);
  return {
    year, bookings_halalas: bookings, revenue_halalas: revenue, invoiced_halalas: invoiced,
    collected_halalas: collected, ar_halalas: ar,
    collectionRate: invoiced ? Math.round((collected / invoiced) * 100) : 0,
    dso: dso(user), aging: arAging(user),
  };
}

// AR aging buckets by days since issue_date on outstanding invoices.
export function arAging(user) {
  const f = scopeFilter(user, 'invoice', 'read');
  const rows = all(`SELECT * FROM invoice WHERE ${f.clause} AND deleted_at IS NULL AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')`, f.params);
  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const now = Date.now();
  for (const inv of rows) {
    const out = outstanding(inv);
    if (out <= 0) continue;
    const base = inv.issue_date ? new Date(inv.issue_date).getTime() : now;
    const days = Math.floor((now - base) / 86400000);
    const b = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
    buckets[b] += out;
  }
  return buckets;
}

// DSO = (AR / revenue) * period days (simplified, YTD).
export function dso(user) {
  const f = scopeFilter(user, 'invoice', 'read');
  const ar = all(`SELECT * FROM invoice WHERE ${f.clause} AND deleted_at IS NULL AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')`, f.params)
    .reduce((a, i) => a + outstanding(i), 0);
  const rev = get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year = ?', [FY()]).v;
  const month = new Date().getUTCMonth() + 1;
  return rev ? Math.round((ar / rev) * (month * 30)) : 0;
}

// ── Per project manager ──
export function financeByPM(user, year = FY()) {
  const f = scopeFilter(user, 'invoice', 'read');
  // group invoices by project owner (PM)
  const rows = all(`SELECT COALESCE(u.name_ar, u.username, 'غير محدد') pm, i.owner_user_id,
      COALESCE(SUM(CASE WHEN i.status!='DRAFT' THEN i.amount_halalas ELSE 0 END),0) invoiced,
      COUNT(*) n
    FROM invoice i LEFT JOIN app_user u ON u.id=i.owner_user_id
    WHERE ${f.clause} AND i.deleted_at IS NULL GROUP BY i.owner_user_id ORDER BY invoiced DESC`, f.params);
  return rows.map((r) => {
    const collected = get(`SELECT COALESCE(SUM(c.amount_halalas),0) v FROM collection c JOIN invoice i ON i.id=c.invoice_id
       WHERE i.owner_user_id ${r.owner_user_id ? '= ?' : 'IS NULL'}`, r.owner_user_id ? [r.owner_user_id] : []).v;
    const contractVal = get(`SELECT COALESCE(SUM(contract_value_halalas),0) v FROM project WHERE owner_user_id ${r.owner_user_id ? '= ?' : 'IS NULL'} AND deleted_at IS NULL`, r.owner_user_id ? [r.owner_user_id] : []).v;
    return { pm: r.pm, invoices: r.n, contract_halalas: contractVal, invoiced_halalas: r.invoiced,
      collected_halalas: collected, outstanding_halalas: Math.max(0, r.invoiced - collected) };
  });
}

// ── Per contract ──
export function financeByContract(user) {
  const f = scopeFilter(user, 'contract', 'read');
  const contracts = all(`SELECT c.*, cl.name_ar client_name, p.name_ar project_name, p.owner_user_id
     FROM contract c LEFT JOIN client cl ON cl.id=c.client_id LEFT JOIN project p ON p.id=c.project_id
     WHERE ${f.clause} AND c.deleted_at IS NULL ORDER BY c.value_halalas DESC LIMIT 200`, f.params);
  return contracts.map((c) => {
    const invoiced = get("SELECT COALESCE(SUM(amount_halalas),0) v FROM invoice WHERE contract_id=? AND status!='DRAFT' AND deleted_at IS NULL", [c.id]).v;
    const collected = get('SELECT COALESCE(SUM(col.amount_halalas),0) v FROM collection col JOIN invoice i ON i.id=col.invoice_id WHERE i.contract_id=?', [c.id]).v;
    return { ...c, invoiced_halalas: invoiced, collected_halalas: collected,
      billed_pct: c.value_halalas ? Math.round((invoiced / c.value_halalas) * 100) : 0,
      backlog_halalas: Math.max(0, c.value_halalas - invoiced), outstanding_halalas: Math.max(0, invoiced - collected) };
  });
}

export function contractDetail(user, contractId) {
  const c = get('SELECT * FROM contract WHERE id = ? AND deleted_at IS NULL', [contractId]);
  if (!c) throw notFound('العقد غير موجود');
  if (!can(user, 'read', 'contract', c)) throw forbidden();
  const client = get('SELECT name_ar FROM client WHERE id=?', [c.client_id]);
  const project = get('SELECT id, name_ar, owner_user_id, progress_pct FROM project WHERE id=?', [c.project_id]);
  const invoices = all("SELECT * FROM invoice WHERE contract_id=? AND deleted_at IS NULL ORDER BY issue_date, claim_no", [contractId])
    .map((i) => ({ ...i, outstanding_halalas: outstanding(i) }));
  const deliverables = project ? all("SELECT * FROM deliverable WHERE project_id=? AND deleted_at IS NULL ORDER BY month", [project.id]) : [];
  const invoiced = invoices.filter((i) => i.status !== 'DRAFT').reduce((a, i) => a + i.amount_halalas, 0);
  return { contract: c, client: client?.name_ar, project, invoices, deliverables,
    invoiced_halalas: invoiced, billed_pct: c.value_halalas ? Math.round((invoiced / c.value_halalas) * 100) : 0,
    backlog_halalas: Math.max(0, c.value_halalas - invoiced) };
}

// ── Progress claim (مستخلص) — generate an invoice from delivered deliverables on a contract ──
export function createProgressClaim(ctx, { contractId, deliverableIds = [], periodLabel }) {
  const user = ctx.user;
  const c = get('SELECT * FROM contract WHERE id = ? AND deleted_at IS NULL', [contractId]);
  if (!c) throw notFound('العقد غير موجود');
  if (!can(user, 'create', 'invoice', c)) throw forbidden('إصدار المستخلصات يتطلب صلاحية مالية/قيادة قطاع');
  const project = get('SELECT * FROM project WHERE id=?', [c.project_id]);
  // eligible deliverables: DELIVERED/ACCEPTED and not already on an issued invoice
  const eligible = deliverableIds.length
    ? all(`SELECT * FROM deliverable WHERE id IN (${deliverableIds.map(() => '?').join(',')}) AND deleted_at IS NULL`, deliverableIds)
    : all("SELECT * FROM deliverable WHERE project_id=? AND status IN ('DELIVERED','ACCEPTED') AND deleted_at IS NULL", [c.project_id]);
  const toClaim = eligible.filter((d) => !get('SELECT id FROM invoice_line WHERE deliverable_id=?', [d.id]));
  if (!toClaim.length) throw badRequest('لا توجد مخرجات مؤهلة للمستخلص (مسلّمة وغير مفوترة)');
  const amount = toClaim.reduce((a, d) => a + (d.amount_halalas || 0), 0);
  // cumulative claim number on this contract
  const claimCount = get('SELECT COUNT(*) n FROM invoice WHERE contract_id=? AND kind=\'progress_claim\'', [contractId]).n;
  const invId = id('inv'); const now = nowIso();
  const totalDelivered = get("SELECT COALESCE(SUM(amount_halalas),0) v FROM deliverable WHERE project_id=? AND status IN ('DELIVERED','ACCEPTED','INVOICED','PAID') AND deleted_at IS NULL", [c.project_id]).v;
  insert('invoice', {
    id: invId, code: `${c.code || 'INV'}-C${claimCount + 1}`, contract_id: contractId, project_id: c.project_id,
    client_id: c.client_id, sector_id: c.sector_id, amount_halalas: amount, issue_date: now.slice(0, 10),
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), status: 'ISSUED',
    kind: 'progress_claim', claim_no: String(claimCount + 1), period_label: periodLabel || null,
    progress_pct: c.value_halalas ? Math.round((totalDelivered / c.value_halalas) * 100) : null,
    owner_user_id: project?.owner_user_id || null, created_at: now, created_by: user.id,
  });
  for (const d of toClaim) {
    insert('invoice_line', { id: id('il'), invoice_id: invId, deliverable_id: d.id, label: d.name_ar, amount_halalas: d.amount_halalas || 0 });
    update('deliverable', d.id, { status: 'INVOICED', updated_at: now });
  }
  audit(ctx, { action: 'create', resource: 'invoice', resourceId: invId, sectorId: c.sector_id,
    detail: { kind: 'progress_claim', claim_no: claimCount + 1, deliverables: toClaim.length, amount } });
  return get('SELECT * FROM invoice WHERE id=?', [invId]);
}

export function recordCollection(ctx, { invoiceId, amountSar, collectedAt, method }) {
  const user = ctx.user;
  const inv = get('SELECT * FROM invoice WHERE id=? AND deleted_at IS NULL', [invoiceId]);
  if (!inv) throw notFound('الفاتورة غير موجودة');
  if (!can(user, 'update', 'invoice', inv) && !can(user, 'create', 'collection', inv)) throw forbidden();
  const amt = toHalalas(amountSar);
  if (!(amt > 0)) throw badRequest('مبلغ غير صالح');
  const out = outstanding(inv);
  if (amt > out + 1) throw badRequest(`المبلغ يتجاوز المتبقي (${(out / 100).toLocaleString()} ر.س.)`);
  insert('collection', { id: id('col'), invoice_id: invoiceId, amount_halalas: amt,
    collected_at: collectedAt || nowIso().slice(0, 10), method: method || 'تحويل', created_at: nowIso() });
  const newOut = out - amt;
  update('invoice', invoiceId, { status: newOut <= 0 ? 'PAID' : 'PARTIALLY_PAID' });
  audit(ctx, { action: 'update', resource: 'invoice', resourceId: invoiceId, sectorId: inv.sector_id, detail: { collected: amt } });
  return get('SELECT * FROM invoice WHERE id=?', [invoiceId]);
}
