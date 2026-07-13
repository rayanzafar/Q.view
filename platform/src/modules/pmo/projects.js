// PMO — Projects service. Scope-filtered, redacts sensitive financials (cost/margin).
import { all, get, insert, update } from '../../core/db/index.js';
import { can, redact, redactList } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';

export function listProjects(user, filters = {}) {
  const f = scopeFilter(user, 'project', 'read', { ownerCol: 'owner_user_id' });
  const where = [f.clause, 'deleted_at IS NULL'];
  const params = [...f.params];
  if (filters.sector) { where.push('sector_id = ?'); params.push(filters.sector); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  const rows = all(`SELECT * FROM project WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`, params);
  return redactList(user, 'project', rows);
}

export function getProject(user, pid) {
  const row = get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [pid]);
  if (!row) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', row)) throw forbidden();
  return redact(user, 'project', row);
}

export function createProject(ctx, data) {
  const user = ctx.user;
  const sectorId = data.sector_id || user.sector_id;
  if (!can(user, 'create', 'project', { sector_id: sectorId })) throw forbidden();
  if (!data.name_ar) throw badRequest('اسم المشروع مطلوب');
  const pid = id('prj'); const now = nowIso();
  insert('project', {
    id: pid, code: data.code || null, name_ar: data.name_ar, sector_id: sectorId,
    client_id: data.client_id || null, owner_user_id: data.owner_user_id || user.id,
    status: data.status || 'IN_PROGRESS', rag: data.rag || 'GREEN', kind: data.kind || 'external',
    budget_halalas: toHalalas(data.budget_sar), contract_value_halalas: toHalalas(data.contract_value_sar),
    start_date: data.start_date || null, end_date: data.end_date || null,
    source_opp_id: data.source_opp_id || null, created_at: now, created_by: user.id,
  });
  audit(ctx, { action: 'create', resource: 'project', resourceId: pid, sectorId });
  return getProject(user, pid);
}

export function updateProject(ctx, pid, data) {
  const user = ctx.user;
  const row = get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [pid]);
  if (!row) throw notFound('المشروع غير موجود');
  if (!can(user, 'update', 'project', row)) throw forbidden();
  const patch = {};
  for (const k of ['name_ar', 'status', 'rag', 'progress_pct', 'start_date', 'end_date', 'pm_name']) {
    if (k in data) patch[k] = data[k];
  }
  for (const [k, col] of [['budget_sar', 'budget_halalas'], ['contract_value_sar', 'contract_value_halalas']]) {
    if (k in data) patch[col] = toHalalas(data[k]);
  }
  patch.updated_at = nowIso(); patch.updated_by = user.id;
  update('project', pid, patch);
  audit(ctx, { action: 'update', resource: 'project', resourceId: pid, sectorId: row.sector_id, detail: patch });
  return getProject(user, pid);
}
