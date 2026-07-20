// Organization service — flexible hierarchy editable from the UI (NOT hard-coded):
// Company → Sector → Department → Unit → Team → Position → Employee.
import { all, get, insert, update } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, badRequest, notFound } from '../../core/http/errors.js';

const requireAdminSectors = (user) => { if (!can(user, 'admin', 'sector') && user.role_id !== 'admin' && !can(user, 'create', 'sector')) throw forbidden('إدارة الهيكل تتطلب صلاحية إدارية'); };

export async function orgTree(user) {
  // Gate: the org hierarchy (and its financial targets) must not be readable by any authenticated user.
  if (user.role_id !== 'admin' && !can(user, 'read', 'employee') && !can(user, 'create', 'sector'))
    throw forbidden('عرض الهيكل التنظيمي يتطلب صلاحية إدارية');
  const seeTargets = user.scope === 'company'; // sector financial targets are company-level info
  const sectors = await all('SELECT * FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  return await Promise.all(sectors.map(async (s) => ({
    ...s,
    ...(seeTargets ? {} : { target_sales_halalas: null, target_revenue_halalas: null, target_margin_pct: null }),
    departments: await Promise.all((await all('SELECT * FROM department WHERE sector_id = ? AND deleted_at IS NULL ORDER BY name_ar', [s.id])).map(async (d) => ({
      ...d,
      units: await all('SELECT * FROM org_unit WHERE department_id = ? AND deleted_at IS NULL ORDER BY name_ar', [d.id]),
      employees: (await get('SELECT COUNT(*) n FROM employee WHERE department_id = ? AND deleted_at IS NULL', [d.id])).n,
    }))),
    employees: (await get('SELECT COUNT(*) n FROM employee WHERE sector_id = ? AND deleted_at IS NULL', [s.id])).n,
  })));
}

// ── Sector CRUD ──
export async function createSector(ctx, data) {
  requireAdminSectors(ctx.user);
  if (!data.id || !data.name_ar) throw badRequest('المعرّف والاسم مطلوبان');
  if (await get('SELECT id FROM sector WHERE id = ?', [data.id])) throw badRequest('المعرّف مستخدم');
  await insert('sector', { id: data.id, name_ar: data.name_ar, name_en: data.name_en || null, color: data.color || '#2563eb',
    target_sales_halalas: toHalalas(data.target_sales_sar), target_revenue_halalas: toHalalas(data.target_revenue_sar),
    target_margin_pct: data.target_margin_pct || 0, active: 1, is_placeholder: data.placeholder ? 1 : 0,
    sort_order: data.sort_order || 99, created_at: nowIso(), created_by: ctx.user.id });
  await audit(ctx, { action: 'create', resource: 'sector', resourceId: data.id });
  return await get('SELECT * FROM sector WHERE id = ?', [data.id]);
}
export async function updateSector(ctx, sectorId, data) {
  requireAdminSectors(ctx.user);
  const s = await get('SELECT * FROM sector WHERE id = ?', [sectorId]);
  if (!s) throw notFound('القطاع غير موجود');
  const patch = {};
  for (const k of ['name_ar', 'name_en', 'color', 'active', 'is_placeholder', 'sort_order', 'lead_user_id']) if (k in data) patch[k] = data[k];
  for (const [k, col] of [['target_sales_sar', 'target_sales_halalas'], ['target_revenue_sar', 'target_revenue_halalas']]) if (k in data) patch[col] = toHalalas(data[k]);
  if ('target_margin_pct' in data) patch.target_margin_pct = data.target_margin_pct;
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  await update('sector', sectorId, patch);
  await audit(ctx, { action: 'update', resource: 'sector', resourceId: sectorId, detail: patch });
  return await get('SELECT * FROM sector WHERE id = ?', [sectorId]);
}

// ── Department CRUD ──
export async function createDepartment(ctx, data) {
  requireAdminSectors(ctx.user);
  if (!data.sector_id || !data.name_ar) throw badRequest('القطاع والاسم مطلوبان');
  if (!(await get('SELECT id FROM sector WHERE id = ?', [data.sector_id]))) throw badRequest('قطاع غير معروف');
  const did = id('dep');
  await insert('department', { id: did, sector_id: data.sector_id, name_ar: data.name_ar, name_en: data.name_en || null,
    manager_user_id: data.manager_user_id || null, active: 1, created_at: nowIso(), created_by: ctx.user.id });
  await audit(ctx, { action: 'create', resource: 'department', resourceId: did, sectorId: data.sector_id });
  return await get('SELECT * FROM department WHERE id = ?', [did]);
}

// ── Unit / Team / Position ──
export async function createUnit(ctx, data) {
  requireAdminSectors(ctx.user);
  if (!data.department_id || !data.name_ar) throw badRequest('الإدارة والاسم مطلوبان');
  const uid = id('unit');
  await insert('org_unit', { id: uid, department_id: data.department_id, name_ar: data.name_ar, name_en: data.name_en || null,
    manager_user_id: data.manager_user_id || null, active: 1, created_at: nowIso() });
  await audit(ctx, { action: 'create', resource: 'unit', resourceId: uid });
  return await get('SELECT * FROM org_unit WHERE id = ?', [uid]);
}

// ── Employee create/update + MOVE (reassign sector/department) ──
export async function createEmployee(ctx, data) {
  if (!can(ctx.user, 'create', 'employee', { sector_id: data.sector_id })) throw forbidden();
  if (!data.name_ar) throw badRequest('اسم الموظف مطلوب');
  const eid = id('emp');
  await insert('employee', { id: eid, name_ar: data.name_ar, name_en: data.name_en || null, sector_id: data.sector_id || null,
    department_id: data.department_id || null, unit_id: data.unit_id || null, position_id: data.position_id || null,
    job_title: data.job_title || null, salary_halalas: toHalalas(data.salary_sar), employment_type: data.employment_type || 'أساسي',
    status: 'نشط', active: 1, created_at: nowIso(), created_by: ctx.user.id });
  await audit(ctx, { action: 'create', resource: 'employee', resourceId: eid, sectorId: data.sector_id });
  return await get('SELECT * FROM employee WHERE id = ?', [eid]);
}
export async function moveEmployee(ctx, employeeId, data) {
  const e = await get('SELECT * FROM employee WHERE id = ?', [employeeId]);
  if (!e) throw notFound('الموظف غير موجود');
  if (!can(ctx.user, 'update', 'employee', e)) throw forbidden();
  const patch = { updated_at: nowIso() };
  for (const k of ['sector_id', 'department_id', 'unit_id', 'position_id', 'job_title', 'line_manager_id']) if (k in data) patch[k] = data[k];
  // salary edits require salary-read gate (HR/admin) — reuse sensitive gate
  if ('salary_sar' in data && can(ctx.user, 'read', 'salary')) patch.salary_halalas = toHalalas(data.salary_sar);
  await update('employee', employeeId, patch);
  await audit(ctx, { action: 'update', resource: 'employee', resourceId: employeeId, sectorId: patch.sector_id || e.sector_id, detail: { moved: true } });
  return await get('SELECT * FROM employee WHERE id = ?', [employeeId]);
}

// General attribute edit (name / job / type / status / active + salary when the caller may read it).
// A sector manager editing across sectors is blocked by the sector-scoped 'update employee' grant.
export async function updateEmployee(ctx, employeeId, data) {
  const e = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!e) throw notFound('الموظف غير موجود');
  if (!can(ctx.user, 'update', 'employee', e)) throw forbidden('تعديل الموظف يتطلب صلاحية إدارية على قطاعه');
  const patch = { updated_at: nowIso() };
  for (const k of ['name_ar', 'name_en', 'job_title', 'employment_type', 'status', 'sector_id', 'department_id', 'position_id']) if (k in data) patch[k] = data[k];
  if ('active' in data) patch.active = data.active ? 1 : 0;
  // moving to another sector requires update rights on the TARGET sector too
  if (patch.sector_id && patch.sector_id !== e.sector_id && !can(ctx.user, 'update', 'employee', { sector_id: patch.sector_id })) throw forbidden('لا تملك صلاحية على القطاع الهدف');
  if ('salary_sar' in data && can(ctx.user, 'read', 'salary')) patch.salary_halalas = toHalalas(data.salary_sar);
  await update('employee', employeeId, patch);
  await audit(ctx, { action: 'update', resource: 'employee', resourceId: employeeId, sectorId: patch.sector_id || e.sector_id, detail: Object.keys(patch) });
  return await get('SELECT * FROM employee WHERE id = ?', [employeeId]);
}

// Staffing roster v3 — PLANNED utilization from the allocation model (scoped) PLUS opportunity
// soft load (membership group_kind='opportunity' with allocation_pct on an OPEN opportunity,
// counted against the CURRENT month only, labeled 'فرصة'). Company users may pass a sector
// filter; sector-scoped users are locked to their own sector.
// opts.month (1–12) overrides the "current month" for deterministic tests/renders.
export async function staffingRoster(user, opts = {}) {
  if (user.role_id !== 'admin' && !can(user, 'read', 'employee')) throw forbidden('عرض الفريق يتطلب صلاحية');
  const year = Number(opts.year) || new Date().getUTCFullYear();
  const sec = user.scope === 'company' ? (opts.sector || null) : (user.sector_id || null);
  const emps = await all(`SELECT * FROM employee WHERE deleted_at IS NULL ${sec ? 'AND sector_id = ?' : ''} ORDER BY name_ar`, sec ? [sec] : []);
  const allocs = await all(`SELECT a.id, a.employee_id, a.project_id, a.project_name, a.type, a.monthly_json, p.name_ar proj_name, p.status proj_status
     FROM allocation a LEFT JOIN project p ON p.id = a.project_id
     WHERE a.deleted_at IS NULL AND a.year = ? AND a.employee_id IS NOT NULL ${sec ? 'AND a.sector_id = ?' : ''}`, sec ? [year, sec] : [year]);
  const byEmp = {};
  for (const a of allocs) (byEmp[a.employee_id] ||= []).push(a);
  // Opportunity soft load: open-opportunity team memberships with an allocation % — demand that
  // hasn't converted to a project yet, so it weighs on "now" only (not the yearly plan).
  const oppRows = await all(`SELECT m.id membership_id, m.employee_id, m.allocation_pct, m.role_in_group, o.id opp_id, o.title_ar
     FROM membership m JOIN opportunity o ON o.id = m.group_id LEFT JOIN stage st ON st.id = o.stage_id
     WHERE m.group_kind = 'opportunity' AND m.deleted_at IS NULL AND m.allocation_pct > 0
       AND o.deleted_at IS NULL AND COALESCE(st.is_won, 0) = 0 AND COALESCE(st.is_lost, 0) = 0`);
  const oppByEmp = {};
  for (const r of oppRows) (oppByEmp[r.employee_id] ||= []).push(r);
  // "current month": explicit override wins (determinism); otherwise the live month when viewing
  // the live year — a past/future year has no meaningful "now".
  const mOverride = Number(opts.month);
  const nowM = Number.isInteger(mOverride) && mOverride >= 1 && mOverride <= 12
    ? mOverride
    : (year === new Date().getUTCFullYear() ? (new Date().getUTCMonth() + 1) : 0);
  const roster = emps.map((e) => {
    const mine = byEmp[e.id] || [];
    const monthLoad = Array(12).fill(0);
    const projects = mine.map((a) => {
      let mj = {}; try { mj = JSON.parse(a.monthly_json || '{}'); } catch { mj = {}; }
      for (const [m, f] of Object.entries(mj)) { const i = Number(m) - 1; if (i >= 0 && i < 12) monthLoad[i] += Number(f) || 0; }
      return { allocId: a.id, projectId: a.project_id, name: a.proj_name || a.project_name || '—', type: a.type || 'member', status: a.proj_status, months: mj };
    });
    const opportunities = (oppByEmp[e.id] || []).map((r) => ({
      membershipId: r.membership_id, opportunityId: r.opp_id, name: r.title_ar || '—',
      pct: Math.round(Number(r.allocation_pct) || 0), role: r.role_in_group || 'member', label: 'فرصة',
    }));
    const oppLoadPct = opportunities.reduce((a, o) => a + o.pct, 0);
    // prev-month util from PROJECT plan only (soft load applies to the current month by definition)
    const prevMonthUtil = nowM >= 2 ? Math.round(monthLoad[nowM - 2] * 100) : 0;
    if (nowM && oppLoadPct) monthLoad[nowM - 1] += oppLoadPct / 100; // soft load lands on "now"
    const months = monthLoad.map((f) => Math.round(f * 100));
    const annualUtil = Math.round(months.reduce((a, b) => a + b, 0) / 12); // % of annual capacity used
    const currentUtil = nowM ? months[nowM - 1] : 0;                        // this month's load (incl. soft)
    const monthDelta = nowM ? currentUtil - prevMonthUtil : 0;              // vs last month's planned load
    const staffedMonths = months.filter((m) => m > 0).length;
    const intensity = staffedMonths ? Math.round(months.filter((m) => m > 0).reduce((a, b) => a + b, 0) / staffedMonths) : 0; // avg load WHEN staffed
    return { id: e.id, name_ar: e.name_ar, name_en: e.name_en, job_title: e.job_title, employment_type: e.employment_type,
      status: e.status, active: e.active, sector_id: e.sector_id,
      // QH-1: الراتب حقل حساس — يُسلسَل فقط لمن يملك صلاحية قراءته (HR/admin)، في الواجهة والـAPI معاً
      ...(can(user, 'read', 'salary') ? { salary_halalas: e.salary_halalas } : {}),
      months, annualUtil, currentUtil, prevMonthUtil, monthDelta, oppLoadPct, staffedMonths, intensity, peak: Math.max(0, ...months),
      overMonths: months.filter((m) => m > 100).length, projects, projectCount: projects.length, opportunities };
  });
  // Order by who is busiest NOW, then by annual load, then name — so managers see live staffing first.
  roster.sort((a, b) => (b.currentUtil - a.currentUtil) || (b.annualUtil - a.annualUtil) || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'));
  // Decision-story summary: capacity vs assigned NOW + who needs a staffing decision.
  const active = roster.filter((e) => e.active !== 0);
  const summary = {
    capacityFte: active.length,
    assignedNowFte: Math.round(active.reduce((a, e) => a + e.currentUtil, 0)) / 100, // Σ current fractions
    benchNow: active.filter((e) => e.currentUtil === 0).length,
    overloadedNow: active.filter((e) => e.currentUtil > 110).length,
    underusedNow: active.filter((e) => e.currentUtil > 0 && e.currentUtil < 40).length,
  };
  return { year, sector: sec, currentMonth: nowM, roster, summary };
}
