// محوّل استيراد/تصدير الفرص — يصف النوع فقط؛ الكتابة تمر حصراً عبر خدمات CRM
// (createOpportunity / updateOpportunity / moveStage) كي تعمل الصلاحيات والتدقيق وسجل المراحل.
import { all, get, update } from '../../../core/db/index.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { audit } from '../../../core/audit/index.js';
import { nowIso, toSar } from '../../../core/util/ids.js';
import { createOpportunity, updateOpportunity, moveStage } from '../../crm/opportunities.js';

// الحقول القابلة للتحديث عبر الخدمات (المالك/القطاع/السنة تُثبَّت عند الإنشاء ولا تُعدَّل بالاستيراد)
const UPDATABLE = ['title_ar', 'client', 'value', 'win_pct', 'stage', 'next_action', 'notes'];
const FIELD_OF = { title_ar: 'title_ar', client: 'client_id', value: 'value_halalas', win_pct: 'win_pct', stage: 'stage_id', next_action: 'next_action', notes: 'notes' };

export default {
  type: 'opportunities',
  labelAr: 'الفرص',
  resource: 'opportunity',
  keySets: [['code'], ['title_ar']],
  columns: [
    { key: 'code', labelAr: 'الكود', aliases: ['رقم الفرصة', 'code', 'الرقم'] },
    { key: 'title_ar', labelAr: 'العنوان', required: true, aliases: ['اسم الفرصة', 'الفرصة', 'title'] },
    { key: 'client', labelAr: 'العميل', parse: 'lookup', lookup: 'client', aliases: ['اسم العميل', 'الجهة'] },
    { key: 'sector', labelAr: 'القطاع', parse: 'lookup', lookup: 'sector' },
    { key: 'stage', labelAr: 'المرحلة', parse: 'lookup', lookup: 'stage' },
    { key: 'owner', labelAr: 'المسؤول', parse: 'lookup', lookup: 'user', aliases: ['صاحب الفرصة', 'المالك'] },
    { key: 'value', labelAr: 'القيمة (ريال)', parse: 'money', min: 0, aliases: ['القيمة', 'قيمة الفرصة'] },
    { key: 'win_pct', labelAr: 'احتمال الفوز (%)', parse: 'pct', aliases: ['الاحتمالية', 'نسبة الفوز'] },
    { key: 'year', labelAr: 'السنة', parse: 'int', min: 2000, max: 2100 },
    { key: 'next_action', labelAr: 'الخطوة التالية', aliases: ['الإجراء التالي'] },
    { key: 'notes', labelAr: 'ملاحظات', aliases: ['ملاحظة', 'تفاصيل'] },
  ],
  exampleRow: {
    code: 'OPP-2026-001', title_ar: 'دراسة تطوير تجربة الزائر', client: 'اسم العميل كما هو مسجّل',
    sector: 'اسم القطاع', stage: 'ليدز', owner: 'اسم المسؤول', value: 250000, win_pct: 30,
    year: 2026, next_action: 'جدولة اجتماع تعريفي', notes: '',
  },

  async fetchRows(user, filters = {}) {
    const f = scopeFilter(user, 'opportunity', 'read');
    // scopeFilter clauses reference bare columns; qualify for the join
    const scopeClause = (f.clause === '1=1' || f.clause === '1=0') ? f.clause : `o.${f.clause}`;
    const where = [scopeClause, 'o.deleted_at IS NULL'];
    const params = [...f.params];
    if (filters.sector) { where.push('o.sector_id = ?'); params.push(filters.sector); }
    if (filters.year) { where.push('o.year = ?'); params.push(Number(filters.year)); }
    const rows = await all(`
      SELECT o.*, c.name_ar client_name, s.name_ar sector_name, st.name_ar stage_name,
             u.name_ar owner_name, u.username owner_username
      FROM opportunity o
      LEFT JOIN client c ON c.id = o.client_id
      LEFT JOIN sector s ON s.id = o.sector_id
      LEFT JOIN stage st ON st.id = o.stage_id
      LEFT JOIN app_user u ON u.id = o.owner_user_id
      WHERE ${where.join(' AND ')} ORDER BY o.created_at`, params);
    return rows.map((o) => ({
      code: o.code, title_ar: o.title_ar, client: o.client_name, sector: o.sector_name,
      stage: o.stage_name, owner: o.owner_name || o.owner_username,
      value: toSar(o.value_halalas), win_pct: o.win_pct, year: o.year,
      next_action: o.next_action, notes: o.notes,
    }));
  },

  async resolveRow(ctx, mapped, opts = {}) {
    let existing = null;
    const useCode = mapped.code && opts.keyField !== 'title_ar';
    if (useCode) existing = await get('SELECT * FROM opportunity WHERE code = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [mapped.code]);
    if (!existing && mapped.title_ar) existing = await get('SELECT * FROM opportunity WHERE title_ar = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [mapped.title_ar]);
    if (!existing) return { action: 'create', existing: null, changes: [] };
    const changes = [];
    for (const k of UPDATABLE) {
      if (mapped[k] == null) continue;
      const cur = existing[FIELD_OF[k]];
      const same = (k === 'value' || k === 'win_pct') ? Number(cur || 0) === Number(mapped[k] || 0) : String(cur ?? '') === String(mapped[k] ?? '');
      if (!same) changes.push(k);
    }
    return { action: changes.length ? 'update' : 'skip', existing, changes };
  },

  rowTarget(mapped, resolved, user) {
    return { sector_id: mapped.sector || resolved?.existing?.sector_id || user.sector_id || null };
  },
  rowLabel(mapped) { return mapped.title_ar || mapped.code || ''; },

  async applyRow(ctx, mapped, resolved) {
    if (resolved.action === 'create') {
      const after = await createOpportunity(ctx, {
        code: mapped.code, title_ar: mapped.title_ar, client_id: mapped.client,
        sector_id: mapped.sector || undefined, owner_user_id: mapped.owner || undefined,
        stage_id: mapped.stage || undefined, value_sar: mapped.value != null ? toSar(mapped.value) : 0,
        win_pct: mapped.win_pct, year: mapped.year || undefined,
        next_action: mapped.next_action, notes: mapped.notes, source: 'import',
      });
      return { resource: 'opportunity', resourceId: after.id, before: null, after };
    }
    const before = resolved.existing;
    const patch = {};
    for (const k of resolved.changes) {
      if (k === 'stage') continue;
      if (k === 'value') patch.value_sar = toSar(mapped.value);
      else if (k === 'client') patch.client_id = mapped.client;
      else patch[k] = mapped[k];
    }
    if (Object.keys(patch).length) await updateOpportunity(ctx, before.id, patch);
    if (resolved.changes.includes('stage')) await moveStage(ctx, before.id, mapped.stage, 'استيراد ملف');
    const after = await get('SELECT * FROM opportunity WHERE id = ?', [before.id]);
    return { resource: 'opportunity', resourceId: before.id, before, after };
  },

  async undoRow(ctx, row) {
    if (row.action === 'create') {
      await update('opportunity', row.resource_id, { deleted_at: nowIso(), updated_by: ctx.user.id });
      await audit(ctx, { action: 'delete', resource: 'opportunity', resourceId: row.resource_id, detail: { undoImport: true } });
      return;
    }
    const b = row.before;
    if (!b) return;
    const cur = await get('SELECT * FROM opportunity WHERE id = ?', [row.resource_id]);
    if (!cur) return;
    if (cur.stage_id !== b.stage_id) await moveStage(ctx, row.resource_id, b.stage_id, 'تراجع عن الاستيراد');
    await updateOpportunity(ctx, row.resource_id, {
      title_ar: b.title_ar, client_id: b.client_id, value_sar: toSar(b.value_halalas),
      win_pct: b.win_pct, next_action: b.next_action, notes: b.notes,
    });
  },
};
