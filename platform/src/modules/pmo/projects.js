// PMO — Projects service. Scope-filtered, redacts sensitive financials (cost/margin).
import { all, get, insert, update } from '../../core/db/index.js';
import { can, redact, redactList } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';
import { isDelivery, SUPPORT_KIND } from '../org/org.js';

export async function listProjects(user, filters = {}) {
  const f = scopeFilter(user, 'project', 'read', { ownerCol: 'owner_user_id' });
  const where = [f.clause, 'deleted_at IS NULL'];
  const params = [...f.params];
  if (filters.sector) { where.push('sector_id = ?'); params.push(filters.sector); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  // مرشّح السنة (اختياري): المشروع «يخص السنة» إذا تقاطعت مدته معها (بدأ فيها أو قبلها ولم
  // ينتهِ قبلها) أو سُجّل له إيراد فيها. بدون سنة = السلوك السابق كاملًا.
  // Portable on both drivers: year via substr(date,1,4) (no strftime/date()).
  const y = Number(filters.year);
  if (Number.isInteger(y) && y >= 2000 && y <= 2100) {
    where.push(`((start_date IS NOT NULL AND substr(start_date,1,4) <= ? AND (end_date IS NULL OR substr(end_date,1,4) >= ?))
      OR id IN (SELECT project_id FROM revenue_line WHERE year = ? AND project_id IS NOT NULL))`);
    params.push(String(y), String(y), y);
  }
  const rows = await all(`SELECT * FROM project WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`, params);
  return redactList(user, 'project', rows);
}

// «الخطوة التالية» للمحفظة: أقرب معلم قادم (PENDING) حسب تاريخ الاستحقاق لكل مشروع —
// استعلام مجمّع واحد للمحفظة كلها، لا استعلام لكل صف. المعالم غير المؤرّخة تُعامل كأبعد
// تاريخ ممكن فتظهر فقط عندما لا يوجد معلم قادم مؤرّخ. يعيد [{project_id, title, due_date}].
export async function nextMilestones(projectIds = []) {
  const ids = [...new Set(projectIds)].filter(Boolean);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = await all(
    `SELECT m.project_id, m.name_ar AS title, m.due_date
       FROM milestone m
       JOIN (SELECT project_id, MIN(COALESCE(due_date, '9999-12-31')) AS nd
               FROM milestone
              WHERE status = 'PENDING' AND deleted_at IS NULL AND project_id IN (${ph})
              GROUP BY project_id) nx
         ON nx.project_id = m.project_id AND COALESCE(m.due_date, '9999-12-31') = nx.nd
      WHERE m.status = 'PENDING' AND m.deleted_at IS NULL
      ORDER BY m.project_id, m.created_at`, ids);
  const out = []; const seen = new Set();
  for (const r of rows) { // معلمان بنفس التاريخ لنفس المشروع: الأقدم إنشاءً يمثّل الخطوة
    if (seen.has(r.project_id)) continue;
    seen.add(r.project_id);
    out.push({ project_id: r.project_id, title: r.title, due_date: r.due_date || null });
  }
  return out;
}

export async function getProject(user, pid) {
  const row = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [pid]);
  if (!row) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', row)) throw forbidden();
  return redact(user, 'project', row);
}

export async function createProject(ctx, data) {
  const user = ctx.user;
  const sectorId = data.sector_id || user.sector_id;
  if (!can(user, 'create', 'project', { sector_id: sectorId })) throw forbidden();
  if (!data.name_ar) throw badRequest('اسم المشروع مطلوب');
  const pid = id('prj'); const now = nowIso();
  await insert('project', {
    id: pid, code: data.code || null, name_ar: data.name_ar, sector_id: sectorId,
    client_id: data.client_id || null, owner_user_id: data.owner_user_id || user.id,
    status: data.status || 'IN_PROGRESS', rag: data.rag || 'GREEN', kind: data.kind || 'external',
    budget_halalas: toHalalas(data.budget_sar), contract_value_halalas: toHalalas(data.contract_value_sar),
    start_date: data.start_date || null, end_date: data.end_date || null,
    source_opp_id: data.source_opp_id || null, created_at: now, created_by: user.id,
  });
  await audit(ctx, { action: 'create', resource: 'project', resourceId: pid, sectorId });
  return await getProject(user, pid);
}

export async function updateProject(ctx, pid, data) {
  const user = ctx.user;
  const row = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [pid]);
  if (!row) throw notFound('المشروع غير موجود');
  if (!can(user, 'update', 'project', row)) throw forbidden();
  // Validate controlled enums so the Kanban PATCH (or any client) can't store arbitrary values.
  const STATUSES = ['NOT_STARTED', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
  const RAGS = ['GREEN', 'AMBER', 'RED'];
  if ('status' in data && !STATUSES.includes(data.status)) throw badRequest('حالة المشروع غير صحيحة');
  if ('rag' in data && !RAGS.includes(data.rag)) throw badRequest('حالة المشروع غير صحيحة — اخترها من القائمة');
  if ('progress_pct' in data) { const n = Number(data.progress_pct); if (!Number.isFinite(n) || n < 0 || n > 100) throw badRequest('نسبة الإنجاز يجب أن تكون بين 0 و100'); }
  const patch = {};
  for (const k of ['name_ar', 'status', 'rag', 'progress_pct', 'start_date', 'end_date', 'pm_name']) {
    if (k in data) patch[k] = data[k];
  }
  for (const [k, col] of [['budget_sar', 'budget_halalas'], ['contract_value_sar', 'contract_value_halalas']]) {
    if (k in data) patch[col] = toHalalas(data[k]);
  }
  patch.updated_at = nowIso(); patch.updated_by = user.id;
  await update('project', pid, patch);
  await audit(ctx, { action: 'update', resource: 'project', resourceId: pid, sectorId: row.sector_id, detail: patch });
  return await getProject(user, pid);
}

// ── Staffing (تسكين): assign/unassign employees to a project via the allocation model ──
export async function projectStaffing(user, projectId) {
  const p = await get('SELECT * FROM project WHERE id=? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', p)) throw forbidden();
  const assigned = await all(`SELECT a.id, a.employee_id, a.person_name_ar, a.type, e.job_title
     FROM allocation a LEFT JOIN employee e ON e.id=a.employee_id
     WHERE a.project_id=? AND a.deleted_at IS NULL ORDER BY a.created_at`, [projectId]);
  const assignedIds = new Set(assigned.map((a) => a.employee_id));
  // المتاحون للتسكين = موظفو قطاع المشروع + **موظفو وحدات المساندة** (الخدمات المشتركة، تطوير
  // الأعمال، المالية). وحدة المساندة ليست قطاع تسليم، وأشخاصها مورد مشترك للشركة كلها يُستعان
  // بهم على مشاريع أي قطاع — وهذا هو سبب وجودها أصلاً. بلا هذا السطر يبقى الثلاثة في «الخدمات
  // المشتركة» غير قابلين للاختيار على أي مشروع، فتُسجَّل تسكيناتهم الحقيقية خارج المنصة.
  const available = (await all(
    `SELECT e.id, e.name_ar, e.job_title FROM employee e
       LEFT JOIN sector s ON s.id = e.sector_id AND s.deleted_at IS NULL
      WHERE e.active = 1 AND e.deleted_at IS NULL AND (e.sector_id = ? OR s.kind = ?)
      ORDER BY e.name_ar`, [p.sector_id, SUPPORT_KIND]))
    .filter((e) => !assignedIds.has(e.id));
  return { project: { id: p.id, name_ar: p.name_ar, sector_id: p.sector_id }, assigned, available, canStaff: can(user, 'update', 'project', p) };
}

// Build a {month: fraction} map from an allocation % and a month range (defaults: from the current
// month through year-end at 100%). Fraction is 0–1.5 (150% caps deliberate over-allocation input).
function monthlyPlan({ pct, fromMonth, toMonth }) {
  const frac = Math.max(0, Math.min(150, Number(pct) || 100)) / 100;
  const f = Math.max(1, Math.min(12, Number(fromMonth) || (new Date().getUTCMonth() + 1)));
  const t = Math.max(f, Math.min(12, Number(toMonth) || 12));
  const mj = {}; for (let m = f; m <= t; m++) mj[m] = frac;
  return mj;
}

export async function assignEmployee(ctx, projectId, { employeeId, type, pct, fromMonth, toMonth }) {
  const user = ctx.user;
  const p = await get('SELECT * FROM project WHERE id=? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'update', 'project', p)) throw forbidden('تسكين الموظفين يتطلب صلاحية إدارة المشروع');
  const emp = await get('SELECT * FROM employee WHERE id=? AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw badRequest('الموظف غير موجود');
  // الحاجز بين القطاعات يبقى قائماً بين **قطاعات التسليم** وحدها: موظف الحلول لا يُسكَّن على
  // مشروع الاستشارات بلا نقله. أما موظف **وحدة مساندة** (خدمات مشتركة، تطوير أعمال، مالية) فهو
  // مورد مشترك على مستوى الشركة بحكم تعريف وحدته، ويُسكَّن على مشروع أي قطاع بلا نقل ولا استثناء
  // يدوي — وهذا هو الغرض المعلن من وحدات المساندة.
  if (emp.sector_id && p.sector_id && emp.sector_id !== p.sector_id) {
    const home = await get('SELECT id, name_ar, kind FROM sector WHERE id = ?', [emp.sector_id]);
    if (isDelivery(home)) throw badRequest('لا يمكن تسكين موظف من قطاع آخر على هذا المشروع');
  }
  if (await get('SELECT id FROM allocation WHERE project_id=? AND employee_id=? AND deleted_at IS NULL', [projectId, employeeId])) throw badRequest('الموظف مُسكَّن على هذا المشروع مسبقًا');
  const aid = id('alloc'); const now = nowIso();
  await insert('allocation', { id: aid, employee_id: employeeId, person_name_ar: emp.name_ar, project_id: projectId,
    project_name: p.name_ar, sector_id: p.sector_id, type: type || 'member', year: new Date().getUTCFullYear(),
    monthly_json: JSON.stringify(monthlyPlan({ pct, fromMonth, toMonth })), source: 'manual', created_at: now });
  await audit(ctx, { action: 'create', resource: 'allocation', resourceId: aid, sectorId: p.sector_id, detail: { project: projectId, employee: employeeId, pct: pct || 100 } });
  return await projectStaffing(user, projectId);
}

// Edit an existing allocation's load (%/month-range). Same permission as staffing the project.
// A body carrying `month` is a SINGLE-CELL edit (heat-grid inline editing) → setAllocationCell.
export async function setAllocation(ctx, allocationId, body = {}) {
  if (body.month != null) return setAllocationCell(ctx, allocationId, body.month, body.pct);
  const { pct, fromMonth, toMonth, type } = body;
  const user = ctx.user;
  const a = await get('SELECT * FROM allocation WHERE id=? AND deleted_at IS NULL', [allocationId]);
  if (!a) throw notFound('التسكين غير موجود');
  const p = await get('SELECT * FROM project WHERE id=?', [a.project_id]);
  if (!p || !can(user, 'update', 'project', p)) throw forbidden();
  // NOTE: allocation carries no updated_at column — patch only real columns.
  // الأشهر المحرَّرة يدوياً (تحرير الخلية الواحدة) تُحفظ: كان استبدال الخريطة كاملة يمحوها بصمت.
  // القاعدة: النطاق الجديد يحدد الأشهر المشمولة، وأي شهر داخل النطاق له قيمة يدوية سابقة تختلف
  // عن النسبة العامة يبقى كما هو؛ والأشهر خارج النطاق تُزال كما هو متوقع من تعديل النطاق.
  let prev = {}; try { prev = JSON.parse(a.monthly_json || '{}'); } catch { prev = {}; }
  const plan = monthlyPlan({ pct, fromMonth, toMonth });
  const planFrac = Object.values(plan)[0];
  const merged = {};
  for (const m of Object.keys(plan)) {
    const keptManual = prev[m] != null && Number(prev[m]) !== planFrac;
    merged[m] = keptManual ? prev[m] : plan[m];
  }
  const patch = { monthly_json: JSON.stringify(merged) };
  if (type) patch.type = type;
  await update('allocation', allocationId, patch);
  await audit(ctx, { action: 'update', resource: 'allocation', resourceId: allocationId, sectorId: a.sector_id, detail: { pct: pct || 100 } });
  return await projectStaffing(user, a.project_id);
}

// Single-month edit of an allocation's monthly_json (heat-grid cell editing). `pct` arrives as a
// PERCENTAGE (0–150) and is stored as a fraction clamped to 0–1.5; 0 clears the month.
// Permission = same as setAllocation (manage the project's staffing). Audited.
export async function setAllocationCell(ctx, allocationId, month, pct) {
  const user = ctx.user;
  const a = await get('SELECT * FROM allocation WHERE id=? AND deleted_at IS NULL', [allocationId]);
  if (!a) throw notFound('التسكين غير موجود');
  const p = await get('SELECT * FROM project WHERE id=?', [a.project_id]);
  if (!p || !can(user, 'update', 'project', p)) throw forbidden('تعديل التسكين يتطلب صلاحية إدارة المشروع');
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw badRequest('الشهر يجب أن يكون بين 1 و12');
  const n = Number(pct);
  if (!Number.isFinite(n)) throw badRequest('أدخل نسبة تسكين صحيحة (0–150)');
  const frac = Math.max(0, Math.min(150, n)) / 100; // clamp: fraction 0–1.5
  let mj = {}; try { mj = JSON.parse(a.monthly_json || '{}'); } catch { mj = {}; }
  if (frac > 0) mj[m] = frac; else delete mj[m];
  await update('allocation', allocationId, { monthly_json: JSON.stringify(mj) });
  await audit(ctx, { action: 'update', resource: 'allocation', resourceId: allocationId, sectorId: a.sector_id,
    detail: { month: m, pct: Math.round(frac * 100) } });
  return { id: allocationId, employee_id: a.employee_id, project_id: a.project_id, month: m,
    pct: Math.round(frac * 100), months: mj };
}

export async function unassignEmployee(ctx, allocationId) {
  const user = ctx.user;
  const a = await get('SELECT * FROM allocation WHERE id=? AND deleted_at IS NULL', [allocationId]);
  if (!a) throw notFound('التسكين غير موجود');
  const p = await get('SELECT * FROM project WHERE id=?', [a.project_id]);
  if (!p || !can(user, 'update', 'project', p)) throw forbidden();
  await update('allocation', allocationId, { deleted_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: 'allocation', resourceId: allocationId, sectorId: a.sector_id });
  return await projectStaffing(user, a.project_id);
}
