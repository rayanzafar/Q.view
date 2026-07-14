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
  // Validate controlled enums so the Kanban PATCH (or any client) can't store arbitrary values.
  const STATUSES = ['NOT_STARTED', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
  const RAGS = ['GREEN', 'AMBER', 'RED'];
  if ('status' in data && !STATUSES.includes(data.status)) throw badRequest('حالة المشروع غير صحيحة');
  if ('rag' in data && !RAGS.includes(data.rag)) throw badRequest('قيمة RAG غير صحيحة');
  if ('progress_pct' in data) { const n = Number(data.progress_pct); if (!Number.isFinite(n) || n < 0 || n > 100) throw badRequest('نسبة الإنجاز يجب أن تكون بين 0 و100'); }
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

// ── Staffing (تسكين): assign/unassign employees to a project via the allocation model ──
export function projectStaffing(user, projectId) {
  const p = get('SELECT * FROM project WHERE id=? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', p)) throw forbidden();
  const assigned = all(`SELECT a.id, a.employee_id, a.person_name_ar, a.type, e.job_title
     FROM allocation a LEFT JOIN employee e ON e.id=a.employee_id
     WHERE a.project_id=? AND a.deleted_at IS NULL ORDER BY a.created_at`, [projectId]);
  const assignedIds = new Set(assigned.map((a) => a.employee_id));
  const available = all('SELECT id, name_ar, job_title FROM employee WHERE sector_id=? AND active=1 AND deleted_at IS NULL ORDER BY name_ar', [p.sector_id])
    .filter((e) => !assignedIds.has(e.id));
  return { project: { id: p.id, name_ar: p.name_ar, sector_id: p.sector_id }, assigned, available, canStaff: can(user, 'update', 'project', p) };
}

export function assignEmployee(ctx, projectId, { employeeId, type }) {
  const user = ctx.user;
  const p = get('SELECT * FROM project WHERE id=? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'update', 'project', p)) throw forbidden('تسكين الموظفين يتطلب صلاحية إدارة المشروع');
  const emp = get('SELECT * FROM employee WHERE id=? AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw badRequest('الموظف غير موجود');
  if (emp.sector_id && p.sector_id && emp.sector_id !== p.sector_id) throw badRequest('لا يمكن تسكين موظف من قطاع آخر على هذا المشروع');
  if (get('SELECT id FROM allocation WHERE project_id=? AND employee_id=? AND deleted_at IS NULL', [projectId, employeeId])) throw badRequest('الموظف مُسكَّن على هذا المشروع مسبقًا');
  const aid = id('alloc'); const now = nowIso();
  insert('allocation', { id: aid, employee_id: employeeId, person_name_ar: emp.name_ar, project_id: projectId,
    project_name: p.name_ar, sector_id: p.sector_id, type: type || 'member', year: new Date().getUTCFullYear(), source: 'manual', created_at: now });
  audit(ctx, { action: 'create', resource: 'allocation', resourceId: aid, sectorId: p.sector_id, detail: { project: projectId, employee: employeeId } });
  return projectStaffing(user, projectId);
}

export function unassignEmployee(ctx, allocationId) {
  const user = ctx.user;
  const a = get('SELECT * FROM allocation WHERE id=? AND deleted_at IS NULL', [allocationId]);
  if (!a) throw notFound('التسكين غير موجود');
  const p = get('SELECT * FROM project WHERE id=?', [a.project_id]);
  if (!p || !can(user, 'update', 'project', p)) throw forbidden();
  update('allocation', allocationId, { deleted_at: nowIso() });
  audit(ctx, { action: 'delete', resource: 'allocation', resourceId: allocationId, sectorId: a.sector_id });
  return projectStaffing(user, a.project_id);
}
