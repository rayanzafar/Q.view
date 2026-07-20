// محوّل استيراد/تصدير التسكين (توزيع الموظفين على المشاريع بنِسب شهرية).
// الكتابة عبر خدمتي assignEmployee / setAllocation (صلاحيات + تدقيق + منع التكرار)، ثم يُستكمل
// المخطط الشهري الدقيق مباشرة على السجل نفسه لأن الخدمة تقبل نطاقاً موحّداً فقط.
// صيغتا إدخال مقبولتان: أعمدة الأشهر (يناير..ديسمبر بنسب %) أو «من شهر/إلى شهر + نسبة الإشغال».
import { all, get, update } from '../../../core/db/index.js';
import { can } from '../../../core/rbac/index.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { audit } from '../../../core/audit/index.js';
import { nowIso } from '../../../core/util/ids.js';
import { forbidden, notFound } from '../../../core/http/errors.js';
import { assignEmployee, setAllocation } from '../../pmo/projects.js';

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const monthsOf = (json) => {
  let mj = {}; try { mj = JSON.parse(json || '{}'); } catch { mj = {}; }
  return Array.from({ length: 12 }, (_, i) => Number(mj[i + 1] || 0));
};
const sameMonths = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.005);
const toMj = (arr) => {
  const mj = {};
  arr.forEach((v, i) => { if (v > 0) mj[i + 1] = v; });
  return mj;
};

// يبني مصفوفة الأشهر (كسور 0–1.5) من الصف الممسوح: أعمدة الأشهر أولاً، وإلا النطاق+النسبة.
function plannedMonths(mapped) {
  const monthly = Array.from({ length: 12 }, (_, i) => mapped[`m${i + 1}`]);
  if (monthly.some((v) => v != null)) return monthly.map((v) => (v == null ? 0 : v / 100));
  // لا شهور ولا نسبة ولا مدى في الملف = «اتركه كما هو» — تكليف بلا تسكين شهري يبقى كذلك،
  // ولا يُخترع له مخطط افتراضي يغيّر البيانات عند إعادة استيراد ملف مصدَّر
  if (mapped.pct == null && mapped.from_month == null && mapped.to_month == null) return Array(12).fill(0);
  const pct = (mapped.pct == null ? 100 : mapped.pct) / 100;
  const f = Math.max(1, Math.min(12, mapped.from_month || 1));
  const t = Math.max(f, Math.min(12, mapped.to_month || 12));
  return Array.from({ length: 12 }, (_, i) => (i + 1 >= f && i + 1 <= t ? pct : 0));
}
// نطاق موحّد للنداء الخدمي: {pct, fromMonth, toMonth} أو null إن كان المخطط غير منتظم.
function uniformRange(arr) {
  const f = arr.findIndex((v) => v > 0) + 1;
  if (!f) return null;
  let t = 12; while (t > f && arr[t - 1] === 0) t--;
  const v = arr[f - 1];
  for (let m = f; m <= t; m++) if (Math.abs(arr[m - 1] - v) > 0.004) return null;
  return { pct: Math.round(v * 100), fromMonth: f, toMonth: t };
}

async function guardedAllocation(ctx, allocId) {
  const a = await get('SELECT * FROM allocation WHERE id = ? AND deleted_at IS NULL', [allocId]);
  if (!a) throw notFound('التسكين غير موجود');
  const p = await get('SELECT * FROM project WHERE id = ?', [a.project_id]);
  if (!p || !can(ctx.user, 'update', 'project', p)) throw forbidden('تعديل التسكين يتطلب صلاحية إدارة المشروع');
  return a;
}

export default {
  type: 'staffing',
  labelAr: 'التسكين',
  resource: 'allocation',
  keySets: [['employee', 'project', 'year']],
  columns: [
    { key: 'employee', labelAr: 'الموظف', required: true, parse: 'lookup', lookup: 'employee', aliases: ['اسم الموظف'] },
    { key: 'project', labelAr: 'المشروع', required: true, parse: 'lookup', lookup: 'project', aliases: ['اسم المشروع', 'كود المشروع'] },
    { key: 'year', labelAr: 'السنة', parse: 'int', min: 2000, max: 2100 },
    { key: 'type', labelAr: 'الدور', aliases: ['الدور في المشروع'] },
    { key: 'from_month', labelAr: 'من شهر', parse: 'int', min: 1, max: 12 },
    { key: 'to_month', labelAr: 'إلى شهر', parse: 'int', min: 1, max: 12 },
    { key: 'pct', labelAr: 'نسبة الإشغال (%)', parse: 'pct', max: 150, aliases: ['النسبة', 'نسبة'] },
    ...MONTHS_AR.map((m, i) => ({ key: `m${i + 1}`, labelAr: m, parse: 'pct', max: 150 })),
  ],
  exampleRow: {
    employee: 'اسم الموظف كما في النظام', project: 'كود المشروع أو اسمه', year: new Date().getUTCFullYear(),
    type: 'member', from_month: 1, to_month: 6, pct: 50,
  },

  normalizeRow(ctx, mapped) {
    mapped.year = mapped.year || new Date().getUTCFullYear();
    mapped._months = plannedMonths(mapped);
    return mapped;
  },

  async fetchRows(user, filters = {}) {
    const f = scopeFilter(user, 'allocation', 'read');
    const scopeClause = (f.clause === '1=1' || f.clause === '1=0') ? f.clause : `a.${f.clause}`;
    const where = [scopeClause, 'a.deleted_at IS NULL', 'a.employee_id IS NOT NULL', 'a.project_id IS NOT NULL'];
    const params = [...f.params];
    if (filters.year) { where.push('a.year = ?'); params.push(Number(filters.year)); }
    if (filters.sector) { where.push('a.sector_id = ?'); params.push(filters.sector); }
    const rows = await all(`
      SELECT a.*, e.name_ar emp_name, p.code proj_code, p.name_ar proj_name
      FROM allocation a
      LEFT JOIN employee e ON e.id = a.employee_id
      LEFT JOIN project p ON p.id = a.project_id
      WHERE ${where.join(' AND ')} ORDER BY e.name_ar, p.name_ar`, params);
    return rows.map((a) => {
      const months = monthsOf(a.monthly_json);
      const out = {
        employee: a.emp_name || a.person_name_ar, project: a.proj_code || a.proj_name || a.project_name,
        year: a.year, type: a.type,
      };
      months.forEach((v, i) => { out[`m${i + 1}`] = v > 0 ? Math.round(v * 1000) / 10 : null; });
      return out;
    });
  },

  async resolveRow(ctx, mapped) {
    const existing = await get(
      'SELECT * FROM allocation WHERE employee_id = ? AND project_id = ? AND year = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1',
      [mapped.employee, mapped.project, mapped.year]);
    const project = await get('SELECT id, sector_id, name_ar FROM project WHERE id = ?', [mapped.project]);
    if (!existing) return { action: 'create', existing: null, changes: [], project };
    const changes = [];
    if (!sameMonths(monthsOf(existing.monthly_json), mapped._months)) changes.push('months');
    if (mapped.type != null && String(existing.type ?? '') !== String(mapped.type)) changes.push('type');
    return { action: changes.length ? 'update' : 'skip', existing, changes, project };
  },

  rowTarget(mapped, resolved, user) {
    return { sector_id: resolved?.project?.sector_id || user.sector_id || null };
  },
  rowLabel(mapped, lookups) {
    const emp = lookups?.employee?.rows?.find((e) => e.id === mapped.employee);
    return emp?.name_ar || mapped.employee || '';
  },

  async applyRow(ctx, mapped, resolved) {
    const months = mapped._months;
    const range = uniformRange(months) || { pct: 100, fromMonth: 1, toMonth: 12 };
    if (resolved.action === 'create') {
      const staffing = await assignEmployee(ctx, mapped.project, {
        employeeId: mapped.employee, type: mapped.type || 'member',
        pct: range.pct, fromMonth: range.fromMonth, toMonth: range.toMonth,
      });
      const allocId = staffing.assigned.find((a) => a.employee_id === mapped.employee)?.id;
      // استكمال المخطط الدقيق/السنة (الخدمة أنجزت الصلاحيات والتدقيق ومنع التكرار)
      const after0 = await get('SELECT * FROM allocation WHERE id = ?', [allocId]);
      const exact = { };
      if (!sameMonths(monthsOf(after0.monthly_json), months)) exact.monthly_json = JSON.stringify(toMj(months));
      if (Number(after0.year) !== Number(mapped.year)) exact.year = mapped.year;
      if (Object.keys(exact).length) await update('allocation', allocId, exact);
      const after = await get('SELECT * FROM allocation WHERE id = ?', [allocId]);
      return { resource: 'allocation', resourceId: allocId, before: null, after };
    }
    const before = resolved.existing;
    await setAllocation(ctx, before.id, {
      pct: range.pct, fromMonth: range.fromMonth, toMonth: range.toMonth, type: mapped.type || undefined,
    });
    const mid = await get('SELECT * FROM allocation WHERE id = ?', [before.id]);
    if (!sameMonths(monthsOf(mid.monthly_json), months)) {
      await update('allocation', before.id, { monthly_json: JSON.stringify(toMj(months)) });
    }
    const after = await get('SELECT * FROM allocation WHERE id = ?', [before.id]);
    return { resource: 'allocation', resourceId: before.id, before, after };
  },

  async undoRow(ctx, row) {
    if (row.action === 'create') {
      // نفس أثر unassignEmployee: حذف ناعم بعد فحص صلاحية المشروع
      const a = await guardedAllocation(ctx, row.resource_id).catch(() => null);
      if (!a) return;
      await update('allocation', row.resource_id, { deleted_at: nowIso() });
      await audit(ctx, { action: 'delete', resource: 'allocation', resourceId: row.resource_id, sectorId: a.sector_id, detail: { undoImport: true } });
      return;
    }
    const b = row.before;
    if (!b) return;
    await guardedAllocation(ctx, row.resource_id);
    await update('allocation', row.resource_id, { monthly_json: b.monthly_json, type: b.type, year: b.year, updated_at: nowIso() });
    await audit(ctx, { action: 'update', resource: 'allocation', resourceId: row.resource_id, sectorId: b.sector_id, detail: { undoImport: true } });
  },
};
