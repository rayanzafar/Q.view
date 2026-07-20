// محوّل استيراد/تصدير الإيراد المحقق (revenue_line) — لا توجد خدمة إيراد مستقلة بعد،
// فالمحوّل يحمل خدمة مصغّرة داخلية: فحص صلاحية revenue_line + تدقيق لكل كتابة.
// ملاحظة بنيوية: جدول الإيراد بلا حذف ناعم، لذا التراجع عن سطر مُنشأ يحذفه فعلياً (مع تدقيق).
import { all, get, insert, update, run } from '../../../core/db/index.js';
import { can } from '../../../core/rbac/index.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { audit } from '../../../core/audit/index.js';
import { id, nowIso, toSar } from '../../../core/util/ids.js';
import { forbidden } from '../../../core/http/errors.js';

function assertRowPermission(ctx, action, sectorId) {
  if (!can(ctx.user, action, 'revenue_line', { sector_id: sectorId })) {
    throw forbidden('تسجيل الإيراد يتطلب صلاحية مالية على هذا القطاع');
  }
}

export default {
  type: 'revenues',
  labelAr: 'الإيراد المحقق',
  resource: 'revenue_line',
  keySets: [['sector', 'year', 'month', 'label']],
  columns: [
    { key: 'sector', labelAr: 'القطاع', required: true, parse: 'lookup', lookup: 'sector' },
    { key: 'year', labelAr: 'السنة', required: true, parse: 'int', min: 2000, max: 2100 },
    { key: 'month', labelAr: 'الشهر', required: true, parse: 'int', min: 1, max: 12, aliases: ['رقم الشهر'] },
    { key: 'amount', labelAr: 'المبلغ (ريال)', required: true, parse: 'money', aliases: ['الإيراد', 'القيمة'] },
    { key: 'label', labelAr: 'البيان', aliases: ['الوصف', 'التفاصيل'] },
    { key: 'project', labelAr: 'المشروع', parse: 'lookup', lookup: 'project', aliases: ['اسم المشروع'] },
  ],
  exampleRow: {
    sector: 'اسم القطاع', year: new Date().getUTCFullYear(), month: 1, amount: 500000,
    label: 'دفعة مستخلص يناير', project: 'كود المشروع أو اسمه (اختياري)',
  },

  async fetchRows(user, filters = {}) {
    const f = scopeFilter(user, 'revenue_line', 'read');
    const scopeClause = (f.clause === '1=1' || f.clause === '1=0') ? f.clause : `r.${f.clause}`;
    const where = [scopeClause];
    const params = [...f.params];
    if (filters.year) { where.push('r.year = ?'); params.push(Number(filters.year)); }
    if (filters.sector) { where.push('r.sector_id = ?'); params.push(filters.sector); }
    const rows = await all(`
      SELECT r.*, s.name_ar sector_name, p.code proj_code, p.name_ar proj_name
      FROM revenue_line r
      LEFT JOIN sector s ON s.id = r.sector_id
      LEFT JOIN project p ON p.id = r.project_id
      WHERE ${where.join(' AND ')} ORDER BY r.year, r.month, s.name_ar`, params);
    return rows.map((r) => ({
      sector: r.sector_name, year: r.year, month: r.month, amount: toSar(r.amount_halalas),
      label: r.label, project: r.proj_code || r.proj_name,
    }));
  },

  async resolveRow(ctx, mapped) {
    const existing = await get(`
      SELECT * FROM revenue_line
      WHERE sector_id = ? AND year = ? AND month = ?
        AND COALESCE(label, '') = ? AND COALESCE(project_id, '') = ?
      ORDER BY created_at LIMIT 1`,
      [mapped.sector, mapped.year, mapped.month, mapped.label || '', mapped.project || '']);
    if (!existing) return { action: 'create', existing: null, changes: [] };
    const changes = Number(existing.amount_halalas || 0) === Number(mapped.amount || 0) ? [] : ['amount'];
    return { action: changes.length ? 'update' : 'skip', existing, changes };
  },

  rowTarget(mapped, resolved, user) {
    return { sector_id: mapped.sector || resolved?.existing?.sector_id || user.sector_id || null };
  },
  rowLabel(mapped, lookups) {
    const sec = lookups?.sector?.rows?.find((s) => s.id === mapped.sector);
    return `${sec?.name_ar || mapped.sector || ''} ${mapped.month}/${mapped.year}`.trim();
  },

  async applyRow(ctx, mapped, resolved) {
    if (resolved.action === 'create') {
      assertRowPermission(ctx, 'create', mapped.sector);
      const rid = id('rev');
      await insert('revenue_line', {
        id: rid, project_id: mapped.project || null, sector_id: mapped.sector,
        amount_halalas: mapped.amount, month: mapped.month, year: mapped.year,
        label: mapped.label || null, auto: 0, created_at: nowIso(),
      });
      await audit(ctx, { action: 'create', resource: 'revenue_line', resourceId: rid, sectorId: mapped.sector, detail: { source: 'import' } });
      const after = await get('SELECT * FROM revenue_line WHERE id = ?', [rid]);
      return { resource: 'revenue_line', resourceId: rid, before: null, after };
    }
    const before = resolved.existing;
    assertRowPermission(ctx, 'update', before.sector_id);
    await update('revenue_line', before.id, { amount_halalas: mapped.amount });
    await audit(ctx, { action: 'update', resource: 'revenue_line', resourceId: before.id, sectorId: before.sector_id, detail: { source: 'import' } });
    const after = await get('SELECT * FROM revenue_line WHERE id = ?', [before.id]);
    return { resource: 'revenue_line', resourceId: before.id, before, after };
  },

  async undoRow(ctx, row) {
    const cur = await get('SELECT * FROM revenue_line WHERE id = ?', [row.resource_id]);
    if (!cur) return;
    if (row.action === 'create') {
      assertRowPermission(ctx, 'create', cur.sector_id);
      await run('DELETE FROM revenue_line WHERE id = ?', [row.resource_id]);
      await audit(ctx, { action: 'delete', resource: 'revenue_line', resourceId: row.resource_id, sectorId: cur.sector_id, detail: { undoImport: true } });
      return;
    }
    const b = row.before;
    if (!b) return;
    assertRowPermission(ctx, 'update', cur.sector_id);
    await update('revenue_line', row.resource_id, { amount_halalas: b.amount_halalas });
    await audit(ctx, { action: 'update', resource: 'revenue_line', resourceId: row.resource_id, sectorId: cur.sector_id, detail: { undoImport: true } });
  },
};
