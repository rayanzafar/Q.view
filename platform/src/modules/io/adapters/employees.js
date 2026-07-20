// محوّل استيراد/تصدير الموظفين — الكتابة عبر خدمة الهيكل (createEmployee / updateEmployee)
// كي تسري الصلاحيات والتدقيق. عمود الراتب حسّاس: لا يُصدَّر ولا يُستورد إلا لمن يملك قراءة الرواتب
// (المحرك يحذف العمود كلياً من القالب والملف لغير المخوَّلين).
import { all, get, update } from '../../../core/db/index.js';
import { canSeeSensitive } from '../../../core/rbac/index.js';
import { audit } from '../../../core/audit/index.js';
import { nowIso, toSar } from '../../../core/util/ids.js';
import { createEmployee, updateEmployee } from '../../org/org.js';
import { normalizeText } from '../parse.js';

export default {
  type: 'employees',
  labelAr: 'الموظفون',
  resource: 'employee',
  keySets: [['name_ar']],
  columns: [
    { key: 'name_ar', labelAr: 'الاسم', required: true, aliases: ['اسم الموظف', 'الموظف'] },
    { key: 'name_en', labelAr: 'الاسم الإنجليزي', aliases: ['name en'] },
    { key: 'job_title', labelAr: 'المسمى الوظيفي', aliases: ['المسمى', 'الوظيفة'] },
    { key: 'sector', labelAr: 'القطاع', parse: 'lookup', lookup: 'sector' },
    { key: 'employment_type', labelAr: 'نوع التوظيف', aliases: ['نوع العقد'] },
    { key: 'status', labelAr: 'الحالة', aliases: ['حالة الموظف'] },
    { key: 'salary', labelAr: 'الراتب الشهري (ريال)', parse: 'money', min: 0, sensitive: 'salary', aliases: ['الراتب'] },
  ],
  exampleRow: {
    name_ar: 'أحمد محمد العمري', name_en: 'Ahmed Alamri', job_title: 'مستشار أول',
    sector: 'اسم القطاع', employment_type: 'أساسي', status: 'نشط', salary: 18000,
  },

  async fetchRows(user, filters = {}) {
    const seeSalary = canSeeSensitive(user, 'salary');
    const sec = user.scope === 'company' ? (filters.sector || null) : (user.sector_id || null);
    const rows = await all(`
      SELECT e.*, s.name_ar sector_name FROM employee e
      LEFT JOIN sector s ON s.id = e.sector_id
      WHERE e.deleted_at IS NULL ${sec ? 'AND e.sector_id = ?' : ''} ORDER BY e.name_ar`, sec ? [sec] : []);
    return rows.map((e) => ({
      name_ar: e.name_ar, name_en: e.name_en, job_title: e.job_title, sector: e.sector_name,
      employment_type: e.employment_type, status: e.status,
      // الحقل يُدرَج فقط للمخوَّلين — المحرك يحذف العمود أصلاً، وهذا خط دفاع ثانٍ
      ...(seeSalary ? { salary: toSar(e.salary_halalas) } : {}),
    }));
  },

  async resolveRow(ctx, mapped, opts = {}) {
    const cache = opts.cache || {};
    if (!cache.employees) cache.employees = await all('SELECT * FROM employee WHERE deleted_at IS NULL');
    const q = normalizeText(mapped.name_ar);
    const existing = cache.employees.find((e) => normalizeText(e.name_ar) === q) || null;
    if (!existing) return { action: 'create', existing: null, changes: [] };
    const changes = [];
    for (const [k, field] of [['name_en', 'name_en'], ['job_title', 'job_title'], ['employment_type', 'employment_type'], ['status', 'status']]) {
      if (mapped[k] != null && String(existing[field] ?? '') !== String(mapped[k])) changes.push(k);
    }
    if (mapped.sector != null && (existing.sector_id ?? '') !== mapped.sector) changes.push('sector');
    if (mapped.salary != null && canSeeSensitive(ctx.user, 'salary') && Number(existing.salary_halalas || 0) !== Number(mapped.salary)) changes.push('salary');
    return { action: changes.length ? 'update' : 'skip', existing, changes };
  },

  rowTarget(mapped, resolved, user) {
    return { sector_id: mapped.sector || resolved?.existing?.sector_id || user.sector_id || null };
  },
  rowLabel(mapped) { return mapped.name_ar || ''; },

  async applyRow(ctx, mapped, resolved) {
    if (resolved.action === 'create') {
      const created = await createEmployee(ctx, {
        name_ar: mapped.name_ar, name_en: mapped.name_en,
        sector_id: mapped.sector || ctx.user.sector_id || null,
        job_title: mapped.job_title, employment_type: mapped.employment_type || undefined,
        salary_sar: mapped.salary != null ? toSar(mapped.salary) : 0,
      });
      let after = created;
      if (mapped.status && mapped.status !== created.status) after = await updateEmployee(ctx, created.id, { status: mapped.status });
      return { resource: 'employee', resourceId: created.id, before: null, after };
    }
    const before = resolved.existing;
    const patch = {};
    for (const k of resolved.changes) {
      if (k === 'sector') patch.sector_id = mapped.sector;
      else if (k === 'salary') patch.salary_sar = toSar(mapped.salary);
      else patch[k] = mapped[k];
    }
    const after = await updateEmployee(ctx, before.id, patch);
    return { resource: 'employee', resourceId: before.id, before, after };
  },

  async undoRow(ctx, row) {
    if (row.action === 'create') {
      await update('employee', row.resource_id, { deleted_at: nowIso(), updated_at: nowIso() });
      await audit(ctx, { action: 'delete', resource: 'employee', resourceId: row.resource_id, detail: { undoImport: true } });
      return;
    }
    const b = row.before;
    if (!b) return;
    await updateEmployee(ctx, row.resource_id, {
      name_ar: b.name_ar, name_en: b.name_en, job_title: b.job_title,
      employment_type: b.employment_type, status: b.status, sector_id: b.sector_id,
      salary_sar: toSar(b.salary_halalas), // تُطبَّق فقط إن كان المستخدم مخوَّلاً بقراءة الرواتب (داخل الخدمة)
    });
  },
};
