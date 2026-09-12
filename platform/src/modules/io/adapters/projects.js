// محوّل استيراد/تصدير المشاريع — الكتابة عبر خدمة المشاريع (createProject / updateProject).
// الحقول الحسّاسة (الصرف الفعلي/الهامش) خارج المحوّل نهائياً — لا تُصدَّر ولا تُستورد.
import { all, get, update } from '../../../core/db/index.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { audit } from '../../../core/audit/index.js';
import { nowIso, toSar } from '../../../core/util/ids.js';
import { createProject, updateProject } from '../../pmo/projects.js';
import { enumLabel } from '../parse.js';

const STATUS = [
  { v: 'NOT_STARTED', labels: ['لم يبدأ'] },
  { v: 'PLANNED', labels: ['مُخطَّط', 'مخطط'] },
  { v: 'IN_PROGRESS', labels: ['قيد التنفيذ', 'جارٍ', 'جاري'] },
  { v: 'ON_HOLD', labels: ['متوقّف مؤقتًا', 'متوقف مؤقتا', 'متوقف'] },
  { v: 'COMPLETED', labels: ['مكتمل', 'منجز'] },
  { v: 'CANCELLED', labels: ['ملغى', 'ملغي'] },
];
const RAG = [
  { v: 'GREEN', labels: ['أخضر'] },
  { v: 'AMBER', labels: ['أصفر', 'كهرماني'] },
  { v: 'RED', labels: ['أحمر'] },
];

// حقول التحديث المدعومة في خدمة updateProject (العميل/القطاع يثبتان عند الإنشاء)
const DIFF = [
  ['name_ar', 'name_ar'], ['status', 'status'], ['rag', 'rag'], ['progress', 'progress_pct'],
  ['budget', 'budget_halalas'], ['contract_value', 'contract_value_halalas'],
  ['start_date', 'start_date'], ['end_date', 'end_date'], ['pm_name', 'pm_name'],
];

export default {
  type: 'projects',
  labelAr: 'المشاريع',
  resource: 'project',
  keySets: [['code'], ['name_ar']],
  columns: [
    { key: 'code', labelAr: 'الكود', aliases: ['رقم المشروع', 'code'] },
    { key: 'name_ar', labelAr: 'اسم المشروع', required: true, aliases: ['المشروع', 'الاسم'] },
    { key: 'client', labelAr: 'العميل', parse: 'lookup', lookup: 'client' },
    { key: 'sector', labelAr: 'القطاع', parse: 'lookup', lookup: 'sector' },
    { key: 'status', labelAr: 'حالة المشروع', parse: 'enum', enum: STATUS, aliases: ['الحالة'] },
    { key: 'rag', labelAr: 'مؤشر الصحة', parse: 'enum', enum: RAG, aliases: ['المؤشر'] },
    { key: 'progress', labelAr: 'نسبة الإنجاز (%)', parse: 'pct', aliases: ['الإنجاز'] },
    { key: 'budget', labelAr: 'الميزانية (ريال)', parse: 'money', min: 0 },
    { key: 'contract_value', labelAr: 'قيمة العقد (ريال)', parse: 'money', min: 0, aliases: ['قيمة التعاقد'] },
    { key: 'start_date', labelAr: 'تاريخ البداية', parse: 'date', aliases: ['البداية'] },
    { key: 'end_date', labelAr: 'تاريخ النهاية', parse: 'date', aliases: ['النهاية'] },
    { key: 'pm_name', labelAr: 'مدير المشروع', aliases: ['المدير'] },
  ],
  exampleRow: {
    code: 'PRJ-2026-001', name_ar: 'برنامج التحول المؤسسي', client: 'اسم العميل', sector: 'اسم القطاع',
    status: 'قيد التنفيذ', rag: 'أخضر', progress: 40, budget: 1200000, contract_value: 1500000,
    start_date: '2026-01-01', end_date: '2026-12-31', pm_name: 'م. خالد السالم',
  },

  async fetchRows(user, filters = {}) {
    // كل الأعمدة مؤهَّلة باسم كنية الجدول (`p.`) داخل الخيارات — لا بلصق `p.` على الشرط كاملاً:
    // شرطُ نطاق «الإدارة» صار مركّباً (إدارةٌ في المجموعة **أو** يتيمُ القطاع)، ولصقُ الكنية
    // على أوّله وحده يكسر بقيّته. و`deptCol` يُقصّ التصدير على إدارة القارئ + أيتام قطاعه (v5.9).
    const f = scopeFilter(user, 'project', 'read',
      { deptCol: 'p.department_id', sectorCol: 'p.sector_id', ownerCol: 'p.owner_user_id', projectCol: 'p.id', memberCol: 'p.id' });
    const where = [f.clause, 'p.deleted_at IS NULL'];
    const params = [...f.params];
    if (filters.sector) { where.push('p.sector_id = ?'); params.push(filters.sector); }
    if (filters.status) { where.push('p.status = ?'); params.push(filters.status); }
    const rows = await all(`
      SELECT p.*, c.name_ar client_name, s.name_ar sector_name
      FROM project p LEFT JOIN client c ON c.id = p.client_id LEFT JOIN sector s ON s.id = p.sector_id
      WHERE ${where.join(' AND ')} ORDER BY p.created_at`, params);
    return rows.map((p) => ({
      code: p.code, name_ar: p.name_ar, client: p.client_name, sector: p.sector_name,
      status: enumLabel(STATUS, p.status), rag: enumLabel(RAG, p.rag), progress: p.progress_pct,
      budget: toSar(p.budget_halalas), contract_value: toSar(p.contract_value_halalas),
      start_date: p.start_date, end_date: p.end_date, pm_name: p.pm_name,
    }));
  },

  async resolveRow(ctx, mapped, opts = {}) {
    let existing = null;
    if (mapped.code && opts.keyField !== 'name_ar') {
      existing = await get('SELECT * FROM project WHERE code = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [mapped.code]);
    }
    if (!existing && mapped.name_ar) {
      existing = await get('SELECT * FROM project WHERE trim(name_ar) = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [String(mapped.name_ar).trim()]);
    }
    if (!existing) return { action: 'create', existing: null, changes: [] };
    const changes = [];
    for (const [k, field] of DIFF) {
      if (mapped[k] == null) continue;
      const cur = existing[field];
      const numeric = ['progress', 'budget', 'contract_value'].includes(k);
      const same = numeric ? Number(cur || 0) === Number(mapped[k] || 0) : String(cur ?? '') === String(mapped[k] ?? '');
      if (!same) changes.push(k);
    }
    return { action: changes.length ? 'update' : 'skip', existing, changes };
  },

  rowTarget(mapped, resolved, user) {
    // الهدف يحمل الإدارة والمالك (لا القطاع وحده) كي يفحص محرّك الصلاحيات الصفَّ بنطاق «الإدارة»
    // و«خاصتي» أيضاً — دفاعٌ في العمق فوق إعادة الحراسة داخل خدمة المشاريع نفسها.
    return {
      sector_id: mapped.sector || resolved?.existing?.sector_id || user.sector_id || null,
      department_id: resolved?.existing?.department_id ?? null,
      owner_user_id: resolved?.existing?.owner_user_id ?? null,
    };
  },
  rowLabel(mapped) { return mapped.name_ar || mapped.code || ''; },

  async applyRow(ctx, mapped, resolved) {
    if (resolved.action === 'create') {
      const created = await createProject(ctx, {
        code: mapped.code, name_ar: mapped.name_ar, sector_id: mapped.sector || undefined,
        client_id: mapped.client, status: mapped.status || undefined, rag: mapped.rag || undefined,
        budget_sar: mapped.budget != null ? toSar(mapped.budget) : 0,
        contract_value_sar: mapped.contract_value != null ? toSar(mapped.contract_value) : 0,
        start_date: mapped.start_date, end_date: mapped.end_date,
      });
      let after = created;
      const extras = {};
      if (mapped.progress != null) extras.progress_pct = mapped.progress;
      if (mapped.pm_name) extras.pm_name = mapped.pm_name;
      if (Object.keys(extras).length) after = await updateProject(ctx, created.id, extras);
      return { resource: 'project', resourceId: created.id, before: null, after };
    }
    const before = resolved.existing;
    const patch = {};
    for (const k of resolved.changes) {
      if (k === 'budget') patch.budget_sar = toSar(mapped.budget);
      else if (k === 'contract_value') patch.contract_value_sar = toSar(mapped.contract_value);
      else if (k === 'progress') patch.progress_pct = mapped.progress;
      else patch[k] = mapped[k];
    }
    const after = await updateProject(ctx, before.id, patch);
    return { resource: 'project', resourceId: before.id, before, after };
  },

  async undoRow(ctx, row) {
    if (row.action === 'create') {
      await update('project', row.resource_id, { deleted_at: nowIso(), updated_at: nowIso(), updated_by: ctx.user.id });
      await audit(ctx, { action: 'delete', resource: 'project', resourceId: row.resource_id, detail: { undoImport: true } });
      return;
    }
    const b = row.before;
    if (!b) return;
    await updateProject(ctx, row.resource_id, {
      name_ar: b.name_ar, status: b.status, rag: b.rag, progress_pct: b.progress_pct,
      start_date: b.start_date, end_date: b.end_date, pm_name: b.pm_name,
      budget_sar: toSar(b.budget_halalas), contract_value_sar: toSar(b.contract_value_halalas),
    });
  },
};
