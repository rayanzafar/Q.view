// Organization service — flexible hierarchy editable from the UI (NOT hard-coded):
// Company → Sector → Department → Unit → Team → Position → Employee.
import { all, get, insert, update } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, badRequest, notFound } from '../../core/http/errors.js';

const requireAdminSectors = (user) => { if (!can(user, 'admin', 'sector') && user.role_id !== 'admin' && !can(user, 'create', 'sector')) throw forbidden('إدارة الهيكل تتطلب صلاحية إدارية'); };

export function orgTree(user) {
  // Gate: the org hierarchy (and its financial targets) must not be readable by any authenticated user.
  if (user.role_id !== 'admin' && !can(user, 'read', 'employee') && !can(user, 'create', 'sector'))
    throw forbidden('عرض الهيكل التنظيمي يتطلب صلاحية إدارية');
  const seeTargets = user.scope === 'company'; // sector financial targets are company-level info
  const sectors = all('SELECT * FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  return sectors.map((s) => ({
    ...s,
    ...(seeTargets ? {} : { target_sales_halalas: null, target_revenue_halalas: null, target_margin_pct: null }),
    departments: all('SELECT * FROM department WHERE sector_id = ? AND deleted_at IS NULL ORDER BY name_ar', [s.id]).map((d) => ({
      ...d,
      units: all('SELECT * FROM org_unit WHERE department_id = ? AND deleted_at IS NULL ORDER BY name_ar', [d.id]),
      employees: get('SELECT COUNT(*) n FROM employee WHERE department_id = ? AND deleted_at IS NULL', [d.id]).n,
    })),
    employees: get('SELECT COUNT(*) n FROM employee WHERE sector_id = ? AND deleted_at IS NULL', [s.id]).n,
  }));
}

// ── Sector CRUD ──
export function createSector(ctx, data) {
  requireAdminSectors(ctx.user);
  if (!data.id || !data.name_ar) throw badRequest('المعرّف والاسم مطلوبان');
  if (get('SELECT id FROM sector WHERE id = ?', [data.id])) throw badRequest('المعرّف مستخدم');
  insert('sector', { id: data.id, name_ar: data.name_ar, name_en: data.name_en || null, color: data.color || '#2563eb',
    target_sales_halalas: toHalalas(data.target_sales_sar), target_revenue_halalas: toHalalas(data.target_revenue_sar),
    target_margin_pct: data.target_margin_pct || 0, active: 1, is_placeholder: data.placeholder ? 1 : 0,
    sort_order: data.sort_order || 99, created_at: nowIso(), created_by: ctx.user.id });
  audit(ctx, { action: 'create', resource: 'sector', resourceId: data.id });
  return get('SELECT * FROM sector WHERE id = ?', [data.id]);
}
export function updateSector(ctx, sectorId, data) {
  requireAdminSectors(ctx.user);
  const s = get('SELECT * FROM sector WHERE id = ?', [sectorId]);
  if (!s) throw notFound('القطاع غير موجود');
  const patch = {};
  for (const k of ['name_ar', 'name_en', 'color', 'active', 'is_placeholder', 'sort_order', 'lead_user_id']) if (k in data) patch[k] = data[k];
  for (const [k, col] of [['target_sales_sar', 'target_sales_halalas'], ['target_revenue_sar', 'target_revenue_halalas']]) if (k in data) patch[col] = toHalalas(data[k]);
  if ('target_margin_pct' in data) patch.target_margin_pct = data.target_margin_pct;
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  update('sector', sectorId, patch);
  audit(ctx, { action: 'update', resource: 'sector', resourceId: sectorId, detail: patch });
  return get('SELECT * FROM sector WHERE id = ?', [sectorId]);
}

// ── Department CRUD ──
export function createDepartment(ctx, data) {
  requireAdminSectors(ctx.user);
  if (!data.sector_id || !data.name_ar) throw badRequest('القطاع والاسم مطلوبان');
  if (!get('SELECT id FROM sector WHERE id = ?', [data.sector_id])) throw badRequest('قطاع غير معروف');
  const did = id('dep');
  insert('department', { id: did, sector_id: data.sector_id, name_ar: data.name_ar, name_en: data.name_en || null,
    manager_user_id: data.manager_user_id || null, active: 1, created_at: nowIso(), created_by: ctx.user.id });
  audit(ctx, { action: 'create', resource: 'department', resourceId: did, sectorId: data.sector_id });
  return get('SELECT * FROM department WHERE id = ?', [did]);
}

// ── Unit / Team / Position ──
export function createUnit(ctx, data) {
  requireAdminSectors(ctx.user);
  if (!data.department_id || !data.name_ar) throw badRequest('الإدارة والاسم مطلوبان');
  const uid = id('unit');
  insert('org_unit', { id: uid, department_id: data.department_id, name_ar: data.name_ar, name_en: data.name_en || null,
    manager_user_id: data.manager_user_id || null, active: 1, created_at: nowIso() });
  audit(ctx, { action: 'create', resource: 'unit', resourceId: uid });
  return get('SELECT * FROM org_unit WHERE id = ?', [uid]);
}

// ── Employee create/update + MOVE (reassign sector/department) ──
export function createEmployee(ctx, data) {
  if (!can(ctx.user, 'create', 'employee', { sector_id: data.sector_id })) throw forbidden();
  if (!data.name_ar) throw badRequest('اسم الموظف مطلوب');
  const eid = id('emp');
  insert('employee', { id: eid, name_ar: data.name_ar, name_en: data.name_en || null, sector_id: data.sector_id || null,
    department_id: data.department_id || null, unit_id: data.unit_id || null, position_id: data.position_id || null,
    job_title: data.job_title || null, salary_halalas: toHalalas(data.salary_sar), employment_type: data.employment_type || 'أساسي',
    status: 'نشط', active: 1, created_at: nowIso(), created_by: ctx.user.id });
  audit(ctx, { action: 'create', resource: 'employee', resourceId: eid, sectorId: data.sector_id });
  return get('SELECT * FROM employee WHERE id = ?', [eid]);
}
export function moveEmployee(ctx, employeeId, data) {
  const e = get('SELECT * FROM employee WHERE id = ?', [employeeId]);
  if (!e) throw notFound('الموظف غير موجود');
  if (!can(ctx.user, 'update', 'employee', e)) throw forbidden();
  const patch = { updated_at: nowIso() };
  for (const k of ['sector_id', 'department_id', 'unit_id', 'position_id', 'job_title', 'line_manager_id']) if (k in data) patch[k] = data[k];
  // salary edits require salary-read gate (HR/admin) — reuse sensitive gate
  if ('salary_sar' in data && can(ctx.user, 'read', 'salary')) patch.salary_halalas = toHalalas(data.salary_sar);
  update('employee', employeeId, patch);
  audit(ctx, { action: 'update', resource: 'employee', resourceId: employeeId, sectorId: patch.sector_id || e.sector_id, detail: { moved: true } });
  return get('SELECT * FROM employee WHERE id = ?', [employeeId]);
}
