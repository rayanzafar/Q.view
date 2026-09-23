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
// ── التوزيع الدوري للمستهدف (KI-110) ──────────────────────────────────────────
// `budget.monthly_json` كان يُكتب من استيرادٍ قديم بصيغة قائمة {month, previousSar, newSar} بلا كاتبٍ في
// المنتج. الصيغة المعتمدة الآن كائنٌ مُعلَّم بإصداره: { v: 2, months: { "1": { sales_halalas, revenue_halalas }, … "12" } }
// — بالهللة، ومجموع الأشهر **يساوي** المستهدف السنوي حرفاً (لا توزيع متساوٍ مفترض باسم الشركة، ولا تقريب
// صامت). القديم يبقى محفوظاً ويُعرض «خطة قديمة» إلى أن يُستبدل بتوزيعٍ معتمد.
export function periodPlanOf(budget) {
  const raw = budget?.monthly_json;
  if (!raw) return { kind: 'none', months: null, legacy: null };
  let parsed; try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return { kind: 'invalid', months: null, legacy: null }; }
  if (parsed && parsed.v === 2 && parsed.months && typeof parsed.months === 'object') {
    const months = {};
    for (let m = 1; m <= 12; m++) {
      const r = parsed.months[String(m)] || {};
      months[m] = { sales_halalas: Number(r.sales_halalas) || 0, revenue_halalas: Number(r.revenue_halalas) || 0 };
    }
    return { kind: 'v2', months, legacy: null, approved_at: parsed.approved_at || null };
  }
  return { kind: 'legacy', months: null, legacy: parsed };
}
const quartersOf = (months) => [1, 2, 3, 4].map((q) => {
  const ms = [q * 3 - 2, q * 3 - 1, q * 3];
  return { quarter: q, months: ms, sales_halalas: ms.reduce((a, m) => a + (months?.[m]?.sales_halalas || 0), 0), revenue_halalas: ms.reduce((a, m) => a + (months?.[m]?.revenue_halalas || 0), 0) };
});
/** قارئ داخلي للتقارير: مستهدف الإيراد الشهري المعتمد (12 قيمة بالهللة) أو null حين لا توزيع معتمد. */
export async function monthlyRevenueTargets(sectorId, year) {
  const annual = await annualSectorTarget(sectorId, year);
  const plan = periodPlanOf(annual.budget);
  if (plan.kind !== 'v2') return null;
  return Array.from({ length: 12 }, (_, i) => plan.months[i + 1].revenue_halalas);
}

export async function sectorTargets(user, { sector, year } = {}) {
  year = targetYear(year);
  const s = await sectorAccess(user, sector, 'read');
  const annual = await annualSectorTarget(sector, year);
  const rows = await all("SELECT at, user_id, username, detail_json, action FROM audit_log WHERE resource = 'budget' AND sector_id = ? AND action IN ('set_targets', 'set_period_plan') ORDER BY at DESC, id DESC", [sector]);
  const history = rows.map((r) => { let detail; try { detail = JSON.parse(r.detail_json); } catch { return null; }
    return detail?.year === year ? { at: r.at, actor: r.username || r.user_id, kind: r.action === 'set_period_plan' ? 'plan' : 'annual', reason: detail.reason, before: detail.before, after: detail.after, revision: detail.revision } : null;
  }).filter(Boolean).sort((a, b) => b.revision - a.revision);
  const plan = periodPlanOf(annual.budget);
  return { sector: { id: s.id, name_ar: s.name_ar }, year, ...annual, budget: annual.budget ? { id: annual.budget.id, fiscal_year: year, sector_id: sector, target_sales_halalas: annual.budget.target_sales_halalas, target_revenue_halalas: annual.budget.target_revenue_halalas, revision: annual.budget.revision, has_monthly_plan: !!annual.budget.monthly_json } : null, history,
    plan: { kind: plan.kind, months: plan.months, quarters: plan.kind === 'v2' ? quartersOf(plan.months) : null,
      consistent: plan.kind === 'v2' && annual.budget
        ? (Object.values(plan.months).reduce((a, m) => a + m.sales_halalas, 0) === Number(annual.budget.target_sales_halalas) && Object.values(plan.months).reduce((a, m) => a + m.revenue_halalas, 0) === Number(annual.budget.target_revenue_halalas))
        : null },
    is_support: isSupportUnit(s), can_edit: !isSupportUnit(s) && annual.status !== 'conflict' && can(user, annual.budget ? 'update' : 'create', 'budget', { sector_id: sector }),
    legacy: { target_sales_halalas: s.target_sales_halalas, target_revenue_halalas: s.target_revenue_halalas },
  };
}

/**
 * حفظ التوزيع الدوري: 12 شهراً × (مبيعات، إيراد) بالريال؛ مجموع كل عمود يساوي المستهدف السنوي المسجَّل
 * بالهللة — وإلا رُفض بذكر الفرق. نفس شرط الإصدار المتفائل والسبب والأثر (قبل/بعد) كالمستهدف السنوي.
 */
export async function savePeriodPlan(ctx, sectorId, data = {}) {
  const year = targetYear(data.year);
  const reason = String(data.reason || '').trim();
  if (reason.length < 3 || reason.length > 1000) throw badRequest('اكتب سبب اعتماد التوزيع من 3 إلى 1000 حرف');
  if (!/^\d+$/.test(String(data.revision ?? '')) || !Number.isSafeInteger(Number(data.revision))) throw badRequest('أعد تحميل المستهدف قبل الحفظ');
  const expected = Number(data.revision);
  const list = Array.isArray(data.months) ? data.months : null;
  if (!list || list.length !== 12) throw badRequest('التوزيع يحتاج الأشهر الاثني عشر كاملة');
  const months = {};
  for (let m = 1; m <= 12; m++) {
    const r = list.find((x) => Number(x?.month) === m);
    if (!r) throw badRequest(`الشهر ${m} ناقص في التوزيع`);
    months[m] = { sales_halalas: money(r.sales_sar), revenue_halalas: money(r.revenue_sar) };
  }
  const sumSales = Object.values(months).reduce((a, x) => a + x.sales_halalas, 0);
  const sumRevenue = Object.values(months).reduce((a, x) => a + x.revenue_halalas, 0);
  let result;
  await tx(async () => {
    const current = await annualSectorTarget(sectorId, year);
    const s = await sectorAccess(ctx.user, sectorId, 'update');
    if (isSupportUnit(s)) throw badRequest('هذه وحدة مساندة؛ لا توزيع مستهدفات لها');
    if (current.status === 'conflict') throw badRequest('توجد مستهدفات متعددة لهذه السنة؛ راجع السجلات مع المالك قبل التوزيع');
    const old = current.budget;
    if (!old) throw badRequest('سجّل المستهدف السنوي أولاً ثم وزّعه على الأشهر');
    if (Number(old.revision || 0) !== expected) throw badRequest('عدّل مستخدم آخر المستهدف؛ أعد تحميل الصفحة وراجع القيم الجديدة');
    const fmt = (h) => (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
    if (sumSales !== Number(old.target_sales_halalas)) throw badRequest(`مجموع أشهر المبيعات ${fmt(sumSales)} لا يساوي المستهدف السنوي ${fmt(Number(old.target_sales_halalas))} — الفرق ${fmt(Number(old.target_sales_halalas) - sumSales)} ريال`);
    if (sumRevenue !== Number(old.target_revenue_halalas)) throw badRequest(`مجموع أشهر الإيراد ${fmt(sumRevenue)} لا يساوي المستهدف السنوي ${fmt(Number(old.target_revenue_halalas))} — الفرق ${fmt(Number(old.target_revenue_halalas) - sumRevenue)} ريال`);
    const before = periodPlanOf(old);
    const revision = expected + 1;
    const stamp = nowIso();
    const plan = { v: 2, approved_at: stamp, months: Object.fromEntries(Object.entries(months).map(([m, x]) => [String(m), x])) };
    const r = await run('UPDATE budget SET monthly_json = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?', [JSON.stringify(plan), revision, stamp, old.id, expected]);
    if (r.changes !== 1) throw badRequest('عدّل مستخدم آخر المستهدف؛ أعد تحميل الصفحة وراجع القيم الجديدة');
    await audit(ctx, { action: 'set_period_plan', resource: 'budget', resourceId: old.id, sectorId,
      detail: { year, revision, reason, before: before.kind === 'v2' ? { quarters: quartersOf(before.months) } : { kind: before.kind }, after: { quarters: quartersOf(months) } } });
    result = { revision };
  });
  return sectorTargets(ctx.user, { sector: sectorId, year });
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
