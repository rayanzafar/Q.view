// CRM — Opportunity team service (Salesforce "Opportunity Teams" pattern, benchmarks §1).
// Members live in the generic membership table (group_kind='opportunity', group_id=oppId);
// a named team container row (team.kind='opportunity', ref_id=oppId) is auto-created on first
// add so the opportunity team shows up wherever org teams are listed.
// Permission model: managing/viewing the team follows the opportunity itself —
// read → can(read, opportunity, row); add/remove → can(update, opportunity, row). Every write audits.
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';

export const TEAM_ROLES = ['lead', 'member', 'reviewer', 'sponsor'];
export const TEAM_ROLE_LABELS = { lead: 'قائد', member: 'عضو', reviewer: 'مراجع', sponsor: 'راعٍ' };

async function loadOpp(oppId) {
  const opp = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!opp) throw notFound('الفرصة غير موجودة');
  return opp;
}

// Members of an opportunity's team, with the employee's name and job title joined in.
export async function getTeam(user, oppId) {
  const opp = await loadOpp(oppId);
  if (!can(user, 'read', 'opportunity', opp)) throw forbidden();
  return await all(
    `SELECT m.id AS membership_id, m.employee_id, m.role_in_group, m.allocation_pct,
            e.name_ar, e.job_title
       FROM membership m JOIN employee e ON e.id = m.employee_id
      WHERE m.group_kind = 'opportunity' AND m.group_id = ? AND m.deleted_at IS NULL
        AND e.deleted_at IS NULL
      ORDER BY CASE m.role_in_group WHEN 'lead' THEN 0 WHEN 'sponsor' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
               e.name_ar`,
    [oppId]);
}

// Add a member. Ensures the team container row exists (kind='opportunity', ref_id=oppId,
// sector inherited from the opportunity) then inserts the membership.
export async function addMember(ctx, oppId, data = {}) {
  const user = ctx.user;
  const opp = await loadOpp(oppId);
  if (!can(user, 'update', 'opportunity', opp)) throw forbidden('إدارة فريق الفرصة تتطلب صلاحية تعديل الفرصة');
  if (!data.employee_id) throw badRequest('اختر الموظف المراد إضافته للفريق');
  const emp = await get('SELECT id, name_ar, sector_id FROM employee WHERE id = ? AND deleted_at IS NULL', [data.employee_id]);
  if (!emp) throw badRequest('الموظف المحدد غير موجود — حدّث القائمة وحاول مجددًا');
  const role = data.role_in_group || 'member';
  if (!TEAM_ROLES.includes(role)) throw badRequest('دور غير معروف — الأدوار المتاحة: قائد، عضو، مراجع، راعٍ');
  let pct = null;
  if (data.allocation_pct !== undefined && data.allocation_pct !== null && data.allocation_pct !== '') {
    pct = Number(data.allocation_pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw badRequest('نسبة التخصيص يجب أن تكون بين 1 و100');
  }
  const dup = await get(
    "SELECT id FROM membership WHERE group_kind = 'opportunity' AND group_id = ? AND employee_id = ? AND deleted_at IS NULL",
    [oppId, emp.id]);
  if (dup) throw badRequest('هذا الموظف عضو في فريق الفرصة مسبقًا');

  const now = nowIso();
  const mid = id('mem');
  await tx(async () => {
    const teamRow = await get(
      "SELECT id FROM team WHERE kind = 'opportunity' AND ref_id = ? AND deleted_at IS NULL", [oppId]);
    if (!teamRow) {
      await insert('team', {
        id: id('team'), sector_id: opp.sector_id || null, department_id: null,
        name_ar: `فريق الفرصة: ${opp.title_ar}`, kind: 'opportunity', ref_id: oppId, created_at: now,
      });
    }
    await insert('membership', {
      id: mid, employee_id: emp.id, group_kind: 'opportunity', group_id: oppId,
      role_in_group: role, allocation_pct: pct, start_date: now.slice(0, 10), created_at: now,
    });
  });
  await audit(ctx, {
    action: 'create', resource: 'opp_team', resourceId: mid, sectorId: opp.sector_id,
    detail: { opportunity_id: oppId, employee_id: emp.id, role_in_group: role, allocation_pct: pct },
  });
  return await getTeam(user, oppId);
}

// Soft-delete a membership (the team container row stays).
export async function removeMember(ctx, membershipId) {
  const user = ctx.user;
  const m = await get(
    "SELECT * FROM membership WHERE id = ? AND group_kind = 'opportunity' AND deleted_at IS NULL", [membershipId]);
  if (!m) throw notFound('عضوية الفريق غير موجودة');
  const opp = await loadOpp(m.group_id);
  if (!can(user, 'update', 'opportunity', opp)) throw forbidden('إدارة فريق الفرصة تتطلب صلاحية تعديل الفرصة');
  await update('membership', membershipId, { deleted_at: nowIso() });
  await audit(ctx, {
    action: 'delete', resource: 'opp_team', resourceId: membershipId, sectorId: opp.sector_id,
    detail: { opportunity_id: m.group_id, employee_id: m.employee_id },
  });
  return await getTeam(user, opp.id);
}
