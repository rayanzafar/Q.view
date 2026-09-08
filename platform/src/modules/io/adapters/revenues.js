// محوّل استيراد/تصدير الإيراد المحقق (revenue_line) — لا توجد خدمة إيراد مستقلة بعد،
// فالمحوّل يحمل خدمة مصغّرة داخلية: فحص صلاحية revenue_line + تدقيق لكل كتابة.
// ملاحظة بنيوية: جدول الإيراد بلا حذف ناعم، لذا التراجع عن سطر مُنشأ يحذفه فعلياً (مع تدقيق).
import { all, get, insert, update, run } from '../../../core/db/index.js';
import { can } from '../../../core/rbac/index.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { audit } from '../../../core/audit/index.js';
import { id, nowIso, toSar } from '../../../core/util/ids.js';
import { splitGross } from '../../finance/vat.js';
import { badRequest, forbidden } from '../../../core/http/errors.js';

function assertRowPermission(ctx, action, sectorId) {
  if (!can(ctx.user, action, 'revenue_line', { sector_id: sectorId })) {
    throw forbidden('تسجيل الإيراد يتطلب صلاحية مالية على هذا القطاع');
  }
}

const EDITABLE = ['sector_id', 'project_id', 'year', 'month', 'label', 'amount_halalas', 'net_amount_halalas', 'vat_halalas'];
const derived = (r) => !!(r.auto || r.deliverable_id || r.rule_id || String(r.id || '').startsWith('rl_dlv_'));
const changesOf = (r, m) => Object.entries({ sector: 'sector_id', project: 'project_id', year: 'year', month: 'month', label: 'label', amount: 'amount_halalas' })
  .filter(([key, col]) => String(m[key] ?? '') !== String(r[col] ?? '')).map(([key]) => key);
function assertManual(r) {
  if (derived(r)) throw badRequest('هذا الإيراد يتبع مصدره — عدّل المخرج من صفحة المشروع ثم أعد التصدير');
}
async function checkTarget(ctx, mapped, action = 'update') {
  assertRowPermission(ctx, action, mapped.sector);
  if (mapped.project) {
    const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [mapped.project]);
    if (!p || !can(ctx.user, 'read', 'project', p)) throw forbidden('المشروع غير متاح ضمن صلاحيتك — اختر مشروعًا مسموحًا');
    if (p.sector_id !== mapped.sector) throw badRequest('قطاع الإيراد لا يطابق قطاع المشروع — صحّح القطاع أو المشروع');
  }
}
function fieldsOf(m, before = null) {
  const money = splitGross(m.amount);
  // Preserve explicitly stored tax treatments when only a date/label changes.
  if (before && Number(before.amount_halalas) !== Number(m.amount)) {
    const old = splitGross(before.amount_halalas);
    if ((before.net_amount_halalas != null && Number(before.net_amount_halalas) !== old.net_halalas)
      || (before.vat_halalas != null && Number(before.vat_halalas) !== old.vat_halalas)) {
      throw badRequest('للسطر معالجة ضريبية خاصة — راجع أساس المبلغ قبل تغييره');
    }
  }
  return { sector_id: m.sector, project_id: m.project || null, year: m.year, month: m.month,
    label: m.label || null, amount_halalas: m.amount,
    net_amount_halalas: before && Number(before.amount_halalas) === Number(m.amount) ? before.net_amount_halalas : money.net_halalas,
    vat_halalas: before && Number(before.amount_halalas) === Number(m.amount) ? before.vat_halalas : money.vat_halalas };
}
async function resolveExisting(ctx, mapped, existing) {
  assertRowPermission(ctx, 'update', existing.sector_id);
  await checkTarget(ctx, mapped);
  const changes = changesOf(existing, mapped);
  if (changes.length) { assertManual(existing); fieldsOf(mapped, existing); }
  return { action: changes.length ? 'update' : 'skip', existing, changes };
}

export default {
  type: 'revenues',
  labelAr: 'الإيراد المحقق',
  resource: 'revenue_line',
  keySets: [['id'], ['sector', 'year', 'month', 'label', 'amount']],
  columns: [
    { key: 'sector', labelAr: 'القطاع', required: true, parse: 'lookup', lookup: 'sector' },
    { key: 'year', labelAr: 'السنة', required: true, parse: 'int', min: 2000, max: 2100 },
    { key: 'month', labelAr: 'الشهر', required: true, parse: 'int', min: 1, max: 12, aliases: ['رقم الشهر'] },
    { key: 'amount', labelAr: 'المبلغ شامل الضريبة (ريال)', required: true, parse: 'money', aliases: ['المبلغ (ريال)', 'الإيراد', 'القيمة'] },
    { key: 'label', labelAr: 'البيان', aliases: ['الوصف', 'التفاصيل'] },
    { key: 'project', labelAr: 'المشروع', parse: 'lookup', lookup: 'project', aliases: ['اسم المشروع'] },
    // مفتاح حتمي للملفات المصدَّرة — يميّز الأسطر المشروعة المتطابقة القيم
    { key: 'id', labelAr: 'معرف السطر', aliases: ['المعرف'] },
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
      label: r.label, project: r.proj_code || r.proj_name, id: r.id,
    }));
  },

  async resolveRow(ctx, mapped) {
    if (mapped.id) {
      const byId = await get('SELECT * FROM revenue_line WHERE id = ?', [String(mapped.id).trim()]);
      if (!byId) throw new Error('معرف السطر غير موجود — لا تعدّل عمود «معرف السطر» يدوياً');
      return await resolveExisting(ctx, mapped, byId);
    }
    const existing = await get(`
      SELECT * FROM revenue_line
      WHERE sector_id = ? AND year = ? AND month = ?
        AND COALESCE(label, '') = ? AND COALESCE(project_id, '') = ?
      ORDER BY created_at LIMIT 1`,
      [mapped.sector, mapped.year, mapped.month, mapped.label || '', mapped.project || '']);
    if (!existing) { await checkTarget(ctx, mapped, 'create'); return { action: 'create', existing: null, changes: [] }; }
    return await resolveExisting(ctx, mapped, existing);
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
      await checkTarget(ctx, mapped, 'create');
      const rid = id('rev');
      await insert('revenue_line', {
        id: rid, ...fieldsOf(mapped), auto: 0, created_at: nowIso(),
      });
      await audit(ctx, { action: 'create', resource: 'revenue_line', resourceId: rid, sectorId: mapped.sector, detail: { source: 'import' } });
      const after = await get('SELECT * FROM revenue_line WHERE id = ?', [rid]);
      return { resource: 'revenue_line', resourceId: rid, before: null, after };
    }
    const before = await get('SELECT * FROM revenue_line WHERE id = ?', [resolved.existing.id]);
    if (!before) throw badRequest('السطر لم يعد موجودًا — أعد المعاينة');
    assertManual(before);
    await checkTarget(ctx, mapped);
    assertRowPermission(ctx, 'update', before.sector_id);
    await update('revenue_line', before.id, fieldsOf(mapped, before));
    await audit(ctx, { action: 'update', resource: 'revenue_line', resourceId: before.id, sectorId: before.sector_id, detail: { source: 'import' } });
    const after = await get('SELECT * FROM revenue_line WHERE id = ?', [before.id]);
    return { resource: 'revenue_line', resourceId: before.id, before, after };
  },

  async undoRow(ctx, row) {
    const cur = await get('SELECT * FROM revenue_line WHERE id = ?', [row.resource_id]);
    if (!cur) throw badRequest('السطر لم يعد موجودًا — راجع التغييرات قبل التراجع');
    assertManual(cur);
    if (!row.after || EDITABLE.some((k) => String(cur[k] ?? '') !== String(row.after[k] ?? ''))) {
      throw badRequest('تغيّر السطر بعد الاستيراد — راجع التعديل الأحدث قبل التراجع');
    }
    if (row.action === 'create') {
      assertRowPermission(ctx, 'create', cur.sector_id);
      await run('DELETE FROM revenue_line WHERE id = ?', [row.resource_id]);
      await audit(ctx, { action: 'delete', resource: 'revenue_line', resourceId: row.resource_id, sectorId: cur.sector_id, detail: { undoImport: true } });
      return;
    }
    const b = row.before;
    if (!b) return;
    assertRowPermission(ctx, 'update', cur.sector_id);
    assertRowPermission(ctx, 'update', b.sector_id);
    await update('revenue_line', row.resource_id, Object.fromEntries(EDITABLE.map((k) => [k, b[k] ?? null])));
    await audit(ctx, { action: 'update', resource: 'revenue_line', resourceId: row.resource_id, sectorId: cur.sector_id, detail: { undoImport: true } });
  },
};
