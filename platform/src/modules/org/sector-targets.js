import { all, get, run, tx } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { isSupportUnit } from '../../core/org/kind.js';

export function targetYear(value) {
  const text = String(value ?? '');
  if (!/^\d{4}$/.test(text) || +text < 2000 || +text > 2100) throw badRequest('حدّد السنة بين 2000 و2100');
  return +text;
}
// Internal reader: callers retain their own authorization. Never guess a year for legacy sector fields.
export async function annualSectorTarget(sectorId, year) {
  const rows = await all('SELECT * FROM budget WHERE sector_id = ? AND fiscal_year = ? ORDER BY id', [sectorId, targetYear(year)]);
  return { status: rows.length > 1 ? 'conflict' : rows.length ? 'recorded' : 'missing', budget: rows.length === 1 ? rows[0] : null, count: rows.length };
}
async function sectorAccess(user, sectorId, action) {
  if (!can(user, action, 'budget', { sector_id: sectorId })) throw forbidden('مستهدفات هذا القطاع خارج صلاحيتك');
  const sector = await get('SELECT * FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  if (!sector) throw notFound('القطاع غير موجود');
  return sector;
}
export async function targetSectorChoices(user) {
  if (!can(user, 'read', 'budget')) throw forbidden('عرض المستهدفات خارج صلاحيتك');
  const rows = await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  return rows.filter((s) => can(user, 'read', 'budget', { sector_id: s.id }));
}
export async function sectorTargets(user, { sector, year } = {}) {
  year = targetYear(year);
  const s = await sectorAccess(user, sector, 'read');
  const annual = await annualSectorTarget(sector, year);
  const rows = await all("SELECT at, user_id, username, detail_json FROM audit_log WHERE resource = 'budget' AND sector_id = ? AND action = 'set_targets' ORDER BY at DESC, id DESC", [sector]);
  const history = rows.map((r) => { let detail; try { detail = JSON.parse(r.detail_json); } catch { return null; }
    return detail?.year === year ? { at: r.at, actor: r.username || r.user_id, reason: detail.reason, before: detail.before, after: detail.after, revision: detail.revision } : null;
  }).filter(Boolean).sort((a, b) => b.revision - a.revision);
  return { sector: { id: s.id, name_ar: s.name_ar }, year, ...annual, budget: annual.budget ? { id: annual.budget.id, fiscal_year: year, sector_id: sector, target_sales_halalas: annual.budget.target_sales_halalas, target_revenue_halalas: annual.budget.target_revenue_halalas, revision: annual.budget.revision, has_monthly_plan: !!annual.budget.monthly_json } : null, history,
    is_support: isSupportUnit(s), can_edit: !isSupportUnit(s) && annual.status !== 'conflict' && can(user, annual.budget ? 'update' : 'create', 'budget', { sector_id: sector }),
    legacy: { target_sales_halalas: s.target_sales_halalas, target_revenue_halalas: s.target_revenue_halalas },
  };
}
function money(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw badRequest('أدخل المستهدف بالريال، صفرًا أو مبلغًا موجبًا بمنزلتين عشريتين كحد أقصى');
  const [whole, fraction = ''] = s.split('.');
  const h = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(h)) throw badRequest('المبلغ يتجاوز الحد المسموح');
  return h;
}
const snapshot = (r) => r ? { target_sales_halalas: r.target_sales_halalas, target_revenue_halalas: r.target_revenue_halalas } : null;
export async function saveSectorTargets(ctx, sectorId, data = {}) {
  const year = targetYear(data.year);
  const reason = String(data.reason || '').trim();
  if (reason.length < 3 || reason.length > 1000) throw badRequest('اكتب سبب التحديد أو التعديل من 3 إلى 1000 حرف');
  if (!/^\d+$/.test(String(data.revision ?? '')) || !Number.isSafeInteger(Number(data.revision))) throw badRequest('أعد تحميل المستهدف قبل الحفظ');
  const expected = Number(data.revision);
  const values = { target_sales_halalas: money(data.target_sales_sar), target_revenue_halalas: money(data.target_revenue_sar) };
  await tx(async () => {
    const current = await annualSectorTarget(sectorId, year);
    const s = await sectorAccess(ctx.user, sectorId, current.budget ? 'update' : 'create');
    if (isSupportUnit(s)) throw badRequest('هذه وحدة مساندة؛ مستهدفات المبيعات والإيراد مخصصة لقطاعات التسليم');
    if (current.status === 'conflict') throw badRequest('توجد مستهدفات متعددة لهذه السنة؛ راجع السجلات مع المالك قبل تعديلها');
    const old = current.budget;
    if (Number(old?.revision || 0) !== expected) throw badRequest('عدّل مستخدم آخر المستهدف؛ أعد تحميل الصفحة وراجع القيم الجديدة');
    const revision = expected + 1;
    const stamp = nowIso();
    const budgetId = old?.id || `annual:${year}:${sectorId}`;
    if (old) {
      const result = await run('UPDATE budget SET target_sales_halalas = ?, target_revenue_halalas = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?',
        [values.target_sales_halalas, values.target_revenue_halalas, revision, stamp, budgetId, expected]);
      if (result.changes !== 1) throw badRequest('عدّل مستخدم آخر المستهدف؛ أعد تحميل الصفحة وراجع القيم الجديدة');
    } else {
      const result = await run('INSERT INTO budget (id, fiscal_year, sector_id, target_sales_halalas, target_revenue_halalas, revision, created_at, updated_at, target_margin_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT (id) DO NOTHING',
        [budgetId, year, sectorId, values.target_sales_halalas, values.target_revenue_halalas, revision, stamp, stamp]);
      if (result.changes !== 1) throw badRequest('سُجل مستهدف أثناء التعديل؛ أعد تحميل الصفحة وراجع القيم الجديدة');
    }
    await audit(ctx, { action: 'set_targets', resource: 'budget', resourceId: budgetId, sectorId,
      detail: { year, revision, reason, before: snapshot(old), after: values } });
  });
  return sectorTargets(ctx.user, { sector: sectorId, year });
}
