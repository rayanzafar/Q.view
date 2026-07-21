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

// invoice.issue_date is a 'YYYY-MM-DD' string; the table has no year column, so derive the
// fiscal year from the date. Reused wherever billing figures must respect the selected year.
const YEAR_PRED = (alias = '') => `CAST(substr(${alias}issue_date,1,4) AS INTEGER) = ?`;

// Outstanding (AR) per invoice = amount − retention − collected.
async function outstanding(inv) {
  const collected = (await get('SELECT COALESCE(SUM(amount_halalas),0) v FROM collection WHERE invoice_id = ?', [inv.id])).v;
  return Math.max(0, inv.amount_halalas - (inv.retention_halalas || 0) - collected);
}

// ── Bridge + AR + DSO (scope-filtered, year-filtered) ──
export async function financeSummary(user, year = FY()) {
  // Alias invoice as `i` everywhere so the scope clause is unambiguous even when joined (collection JOIN invoice).
  const f = scopeFilter(user, 'invoice', 'read', { sectorCol: 'i.sector_id', ownerCol: 'i.owner_user_id' });
  const c = f.clause, p = f.params;
  // Bookings and revenue must respect the caller's scope too, else a sector user sees company-wide
  // bookings/revenue against their sector-only AR — an inconsistent (and over-broad) bridge.
  const companyScope = c.trim() === '1=1';
  const bkP = companyScope ? [year] : [year, user.sector_id];
  const bookings = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? AND o.deleted_at IS NULL${companyScope ? '' : ' AND o.sector_id = ?'}`, bkP)).v;
  const revenue = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year = ?${companyScope ? '' : ' AND sector_id = ?'}`, bkP)).v;
  const invoiced = (await get(`SELECT COALESCE(SUM(i.amount_halalas),0) v FROM invoice i WHERE ${c} AND i.deleted_at IS NULL AND i.status != 'DRAFT' AND ${YEAR_PRED('i.')}`, [...p, year])).v;
  const collected = (await get(`SELECT COALESCE(SUM(col.amount_halalas),0) v FROM collection col JOIN invoice i ON i.id=col.invoice_id WHERE ${c} AND ${YEAR_PRED('i.')}`, [...p, year])).v;
  const invoices = await all(`SELECT i.* FROM invoice i WHERE ${c} AND i.deleted_at IS NULL AND i.status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') AND ${YEAR_PRED('i.')}`, [...p, year]);
  let ar = 0;
  for (const inv of invoices) ar += await outstanding(inv);
  return {
    year, bookings_halalas: bookings, revenue_halalas: revenue, invoiced_halalas: invoiced,
    collected_halalas: collected, ar_halalas: ar,
    collectionRate: invoiced ? Math.round((collected / invoiced) * 100) : 0,
    dso: await dso(user, year), aging: await arAging(user, year),
  };
}

// AR aging buckets by days since issue_date on outstanding invoices.
// Optional {sector}: focus on one sector (sector command center) — the invoice's own sector,
// falling back to its project's sector (same COALESCE path used across finance views).
// Existing callers (arAging(user, year)) are unchanged in signature and result.
export async function arAging(user, year = FY(), { sector } = {}) {
  const f = scopeFilter(user, 'invoice', 'read', { sectorCol: 'i.sector_id', ownerCol: 'i.owner_user_id' });
  const rows = await all(`SELECT i.* FROM invoice i LEFT JOIN project p ON p.id = i.project_id
     WHERE ${f.clause} AND i.deleted_at IS NULL AND i.status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') AND ${YEAR_PRED('i.')}
     ${sector ? 'AND COALESCE(i.sector_id, p.sector_id) = ?' : ''}`,
    [...f.params, year, ...(sector ? [sector] : [])]);
  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const now = Date.now();
  for (const inv of rows) {
    const out = await outstanding(inv);
    if (out <= 0) continue;
    const base = inv.issue_date ? new Date(inv.issue_date).getTime() : now;
    const days = Math.floor((now - base) / 86400000);
    const b = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
    buckets[b] += out;
  }
  return buckets;
}

// DSO = (AR / revenue) * period days (simplified, YTD) for the given year.
export async function dso(user, year = FY()) {
  const f = scopeFilter(user, 'invoice', 'read');
  const rows = await all(`SELECT * FROM invoice WHERE ${f.clause} AND deleted_at IS NULL AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') AND ${YEAR_PRED()}`, [...f.params, year]);
  let ar = 0;
  for (const i of rows) ar += await outstanding(i);
  const rev = (await get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year = ?', [year])).v;
  const month = year === FY() ? new Date().getUTCMonth() + 1 : 12; // prior years use a full-year period
  return rev ? Math.round((ar / rev) * (month * 30)) : 0;
}

// ── Per project manager (year-filtered) ──
export async function financeByPM(user, year = FY()) {
  // Qualify the scope column to the aliased invoice table so it is unambiguous against app_user.sector_id.
  const f = scopeFilter(user, 'invoice', 'read', { sectorCol: 'i.sector_id', ownerCol: 'i.owner_user_id' });
  // group invoices by project owner (PM), within the selected fiscal year
  const rows = await all(`SELECT COALESCE(u.name_ar, u.username, 'غير محدد') pm, i.owner_user_id,
      COALESCE(SUM(CASE WHEN i.status!='DRAFT' THEN i.amount_halalas ELSE 0 END),0) invoiced,
      COUNT(*) n
    FROM invoice i LEFT JOIN app_user u ON u.id=i.owner_user_id
    WHERE ${f.clause} AND i.deleted_at IS NULL AND ${YEAR_PRED('i.')} GROUP BY i.owner_user_id, u.name_ar, u.username ORDER BY invoiced DESC`, [...f.params, year]);
  return Promise.all(rows.map(async (r) => {
    const collected = (await get(`SELECT COALESCE(SUM(c.amount_halalas),0) v FROM collection c JOIN invoice i ON i.id=c.invoice_id
       WHERE i.owner_user_id ${r.owner_user_id ? '= ?' : 'IS NULL'} AND ${YEAR_PRED('i.')}`, r.owner_user_id ? [r.owner_user_id, year] : [year])).v;
    const contractVal = (await get(`SELECT COALESCE(SUM(contract_value_halalas),0) v FROM project WHERE owner_user_id ${r.owner_user_id ? '= ?' : 'IS NULL'} AND deleted_at IS NULL`, r.owner_user_id ? [r.owner_user_id] : [])).v;
    return { pm: r.pm, invoices: r.n, contract_halalas: contractVal, invoiced_halalas: r.invoiced,
      collected_halalas: collected, outstanding_halalas: Math.max(0, r.invoiced - collected) };
  }));
}

// ── Per contract ──
export async function financeByContract(user) {
  // Qualify the scope column to the aliased contract table (project also exposes sector_id → ambiguous otherwise).
  // Contracts have no owner column; if a role ever reads at 'own' scope, resolve ownership via the linked project.
  const f = scopeFilter(user, 'contract', 'read', { sectorCol: 'c.sector_id', ownerCol: 'p.owner_user_id' });
  const contracts = await all(`SELECT c.*, cl.name_ar client_name, p.name_ar project_name, p.owner_user_id
     FROM contract c LEFT JOIN client cl ON cl.id=c.client_id LEFT JOIN project p ON p.id=c.project_id
     WHERE ${f.clause} AND c.deleted_at IS NULL ORDER BY c.value_halalas DESC LIMIT 200`, f.params);
  const rows = await Promise.all(contracts.map(async (c) => {
    const invoiced = (await get("SELECT COALESCE(SUM(amount_halalas),0) v FROM invoice WHERE contract_id=? AND status!='DRAFT' AND deleted_at IS NULL", [c.id])).v;
    const collected = (await get('SELECT COALESCE(SUM(col.amount_halalas),0) v FROM collection col JOIN invoice i ON i.id=col.invoice_id WHERE i.contract_id=?', [c.id])).v;
    return { ...c, invoiced_halalas: invoiced, collected_halalas: collected,
      billed_pct: c.value_halalas ? Math.round((invoiced / c.value_halalas) * 100) : 0,
      backlog_halalas: Math.max(0, c.value_halalas - invoiced), outstanding_halalas: Math.max(0, invoiced - collected) };
  }));
  // Reconciliation: invoices not tied to any contract must still appear, else the by-contract
  // total silently understates financeSummary.invoiced. Surface them as one explicit bucket.
  const fi = scopeFilter(user, 'invoice', 'read'); // unaliased, single-table invoice query
  const un = await get(`SELECT COALESCE(SUM(amount_halalas),0) inv, COUNT(*) n FROM invoice
     WHERE ${fi.clause} AND contract_id IS NULL AND status!='DRAFT' AND deleted_at IS NULL`, fi.params);
  if (un.inv > 0) {
    const unCollected = (await get(`SELECT COALESCE(SUM(col.amount_halalas),0) v FROM collection col JOIN invoice i ON i.id=col.invoice_id
       WHERE i.contract_id IS NULL`, [])).v;
    rows.push({ id: null, code: '—', client_name: '—', project_name: 'فواتير غير مرتبطة بعقد', unassigned: true,
      value_halalas: 0, invoiced_halalas: un.inv, collected_halalas: unCollected,
      billed_pct: null, backlog_halalas: 0, outstanding_halalas: Math.max(0, un.inv - unCollected) });
  }
  return rows;
}

// ── Per client ── contract value, invoiced, collected, outstanding (AR) grouped by client.
export async function financeByClient(user, year = FY()) {
  const f = scopeFilter(user, 'contract', 'read', { sectorCol: 'c.sector_id', ownerCol: 'p.owner_user_id' });
  const rows = await all(`SELECT cl.id, cl.name_ar,
      COUNT(DISTINCT c.id) contracts, COALESCE(SUM(c.value_halalas),0) value_halalas
     FROM contract c JOIN client cl ON cl.id=c.client_id LEFT JOIN project p ON p.id=c.project_id
     WHERE ${f.clause} AND c.deleted_at IS NULL GROUP BY cl.id ORDER BY value_halalas DESC LIMIT 40`, f.params);
  const mapped = await Promise.all(rows.map(async (r) => {
    const invoiced = (await get(`SELECT COALESCE(SUM(i.amount_halalas),0) v FROM invoice i JOIN contract c2 ON c2.id=i.contract_id
       WHERE c2.client_id=? AND i.status!='DRAFT' AND i.deleted_at IS NULL`, [r.id])).v;
    const collected = (await get(`SELECT COALESCE(SUM(col.amount_halalas),0) v FROM collection col JOIN invoice i ON i.id=col.invoice_id
       JOIN contract c2 ON c2.id=i.contract_id WHERE c2.client_id=?`, [r.id])).v;
    return { ...r, invoiced_halalas: invoiced, collected_halalas: collected, outstanding_halalas: Math.max(0, invoiced - collected) };
  }));
  return mapped.filter((r) => r.value_halalas > 0 || r.invoiced_halalas > 0);
}

export async function contractDetail(user, contractId) {
  const c = await get('SELECT * FROM contract WHERE id = ? AND deleted_at IS NULL', [contractId]);
  if (!c) throw notFound('العقد غير موجود');
  if (!can(user, 'read', 'contract', c)) throw forbidden();
  const client = await get('SELECT name_ar FROM client WHERE id=?', [c.client_id]);
  const project = await get('SELECT id, name_ar, owner_user_id, progress_pct FROM project WHERE id=?', [c.project_id]);
  const invoices = await Promise.all((await all("SELECT * FROM invoice WHERE contract_id=? AND deleted_at IS NULL ORDER BY issue_date, claim_no", [contractId]))
    .map(async (i) => ({ ...i, outstanding_halalas: await outstanding(i) })));
  const deliverables = project ? await all("SELECT * FROM deliverable WHERE project_id=? AND deleted_at IS NULL ORDER BY month", [project.id]) : [];
  const invoiced = invoices.filter((i) => i.status !== 'DRAFT').reduce((a, i) => a + i.amount_halalas, 0);
  return { contract: c, client: client?.name_ar, project, invoices, deliverables,
    invoiced_halalas: invoiced, billed_pct: c.value_halalas ? Math.round((invoiced / c.value_halalas) * 100) : 0,
    backlog_halalas: Math.max(0, c.value_halalas - invoiced) };
}

// ── Progress claim (مستخلص) — generate an invoice from delivered deliverables on a contract ──
export async function createProgressClaim(ctx, { contractId, deliverableIds = [], periodLabel }) {
  const user = ctx.user;
  const c = await get('SELECT * FROM contract WHERE id = ? AND deleted_at IS NULL', [contractId]);
  if (!c) throw notFound('العقد غير موجود');
  if (!can(user, 'create', 'invoice', c)) throw forbidden('إصدار المستخلصات يتطلب صلاحية مالية/قيادة قطاع');
  const project = await get('SELECT * FROM project WHERE id=?', [c.project_id]);
  // eligible deliverables: DELIVERED/ACCEPTED and not already on an issued invoice
  const eligible = deliverableIds.length
    ? await all(`SELECT * FROM deliverable WHERE id IN (${deliverableIds.map(() => '?').join(',')}) AND deleted_at IS NULL`, deliverableIds)
    : await all("SELECT * FROM deliverable WHERE project_id=? AND status IN ('DELIVERED','ACCEPTED') AND deleted_at IS NULL", [c.project_id]);
  const toClaim = [];
  for (const d of eligible) {
    if (!(await get('SELECT id FROM invoice_line WHERE deliverable_id=?', [d.id]))) toClaim.push(d);
  }
  if (!toClaim.length) throw badRequest('لا توجد مخرجات مؤهلة للمستخلص (مسلّمة وغير مفوترة)');
  const amount = toClaim.reduce((a, d) => a + (d.amount_halalas || 0), 0);
  // cumulative claim number on this contract
  const claimCount = (await get('SELECT COUNT(*) n FROM invoice WHERE contract_id=? AND kind=\'progress_claim\'', [contractId])).n;
  const invId = id('inv'); const now = nowIso();
  const totalDelivered = (await get("SELECT COALESCE(SUM(amount_halalas),0) v FROM deliverable WHERE project_id=? AND status IN ('DELIVERED','ACCEPTED','INVOICED','PAID') AND deleted_at IS NULL", [c.project_id])).v;
  await insert('invoice', {
    id: invId, code: `${c.code || 'INV'}-C${claimCount + 1}`, contract_id: contractId, project_id: c.project_id,
    client_id: c.client_id, sector_id: c.sector_id, amount_halalas: amount, issue_date: now.slice(0, 10),
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), status: 'ISSUED',
    kind: 'progress_claim', claim_no: String(claimCount + 1), period_label: periodLabel || null,
    progress_pct: c.value_halalas ? Math.round((totalDelivered / c.value_halalas) * 100) : null,
    owner_user_id: project?.owner_user_id || null, created_at: now, created_by: user.id,
  });
  for (const d of toClaim) {
    await insert('invoice_line', { id: id('il'), invoice_id: invId, deliverable_id: d.id, label: d.name_ar, amount_halalas: d.amount_halalas || 0 });
    await update('deliverable', d.id, { status: 'INVOICED', updated_at: now });
  }
  await audit(ctx, { action: 'create', resource: 'invoice', resourceId: invId, sectorId: c.sector_id,
    detail: { kind: 'progress_claim', claim_no: claimCount + 1, deliverables: toClaim.length, amount } });
  return await get('SELECT * FROM invoice WHERE id=?', [invId]);
}

export async function recordCollection(ctx, { invoiceId, amountSar, collectedAt, method }) {
  const user = ctx.user;
  const inv = await get('SELECT * FROM invoice WHERE id=? AND deleted_at IS NULL', [invoiceId]);
  if (!inv) throw notFound('الفاتورة غير موجودة');
  if (!can(user, 'update', 'invoice', inv) && !can(user, 'create', 'collection', inv)) throw forbidden();
  const amt = toHalalas(amountSar);
  if (!(amt > 0)) throw badRequest('مبلغ غير صالح');
  const out = await outstanding(inv);
  if (amt > out + 1) throw badRequest(`المبلغ يتجاوز المتبقي (${(out / 100).toLocaleString()} ر.س.)`);
  await insert('collection', { id: id('col'), invoice_id: invoiceId, amount_halalas: amt,
    collected_at: collectedAt || nowIso().slice(0, 10), method: method || 'تحويل', created_at: nowIso() });
  const newOut = out - amt;
  await update('invoice', invoiceId, { status: newOut <= 0 ? 'PAID' : 'PARTIALLY_PAID' });
  await audit(ctx, { action: 'update', resource: 'invoice', resourceId: invoiceId, sectorId: inv.sector_id, detail: { collected: amt } });
  return await get('SELECT * FROM invoice WHERE id=?', [invoiceId]);
}
