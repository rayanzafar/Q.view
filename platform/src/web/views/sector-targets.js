import { layout } from '../layout.js';
import { esc } from './_shared.js';
import { fmtSar } from '../../core/util/ids.js';
import { sectorTargets, targetSectorChoices, targetYear } from '../../modules/org/sector-targets.js';

import { config } from '../../core/config.js';

export async function sectorTargetsPage(user, opts = {}) {
  const year = targetYear(opts.year == null || opts.year === '' ? config.fiscalYear : opts.year);
  const choices = await targetSectorChoices(user);
  const sector = opts.sector || (choices.some((s) => s.id === user.sector_id) ? user.sector_id : null);
  const periodForm = `<form id="target-period-form" method="get" style="display:flex;gap:.75rem;align-items:end;flex-wrap:wrap">
    <label>القطاع<select class="input" name="sector" required><option value="">اختر القطاع</option>${choices.map((s) => `<option value="${esc(s.id)}" ${s.id === sector ? 'selected' : ''}>${esc(s.name_ar)}</option>`).join('')}</select></label>
    <label>السنة<input class="input tnum" type="number" name="year" value="${year}" min="2000" max="2100" required></label><button class="btn">عرض المستهدفات</button></form>`;
  if (!sector) return layout({ user, active: 'sector', title: 'مستهدفات القطاع', subtitle: 'حدّد القطاع والسنة لمراجعة المستهدفات', year,
    body: `<div style="display:grid;gap:1rem;max-width:1050px;margin:auto">${periodForm}<div id="target-values" class="card" style="padding:1.5rem"><h2>${choices.length ? 'اختر القطاع للبدء' : 'لا توجد قطاعات متاحة ضمن صلاحيتك'}</h2><p>تظهر المبيعات والإيرادات المستهدفة للسنة المختارة، مع سجل التعديلات. لا تُنسخ القيم القديمة إلى سنة جديدة تلقائيًا.</p></div></div>` });
  const d = await sectorTargets(user, { sector, year });
  const amount = (v) => v == null ? 'غير محدد' : fmtSar(v);
  const budget = d.budget;
  const historyAmount = (r) => r ? `المبيعات ${amount(r.target_sales_halalas)} · الإيراد ${amount(r.target_revenue_halalas)}` : 'لم يكن هناك مستهدف سنوي';
  const body = `<div style="display:grid;gap:1rem;max-width:1050px;margin:auto">
    <a href="/app/sector?sector=${encodeURIComponent(d.sector.id)}&year=${d.year}">العودة للقطاع</a>
    ${periodForm}
    <div class="alert info">المبيعات المستهدفة تخص الصفقات المباعة في هذه السنة، والإيراد المستهدف يخص الإيراد المعترف به فيها. المبالغ صافية من الضريبة. لا يغيّر تعديل سنة مستهدفات السنوات الأخرى.</div>
    ${d.is_support ? '<div class="alert info">هذه وحدة مساندة؛ لا تقاس بمستهدفات مبيعات وإيراد قطاعات التسليم.</div>' : ''}
    ${d.status === 'conflict' ? `<div class="alert warning">توجد ${d.count} سجلات مستهدف لهذه السنة. لا نختار أحدها ولا ندمجها تلقائيًا؛ راجع السجلات مع المالك قبل التعديل.</div>` : ''}
    ${d.status === 'missing' ? '<div class="alert info">لا يوجد مستهدف مسجل لهذه السنة. غياب المستهدف لا يعني أن قيمته صفر.</div>' : ''}
    <div id="target-values" class="card" style="padding:1.5rem"><h2>مستهدفات ${d.year}</h2>
    ${d.can_edit ? `<form id="sector-targets-form" data-sector="${esc(d.sector.id)}" data-year="${d.year}" data-revision="${budget?.revision || 0}">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem">
      <label>مستهدف المبيعات بالريال<input class="input tnum" name="target_sales_sar" type="number" min="0" step="0.01" required value="${budget?.target_sales_halalas == null ? '' : budget.target_sales_halalas / 100}"></label>
      <label>مستهدف الإيراد بالريال<input class="input tnum" name="target_revenue_sar" type="number" min="0" step="0.01" required value="${budget?.target_revenue_halalas == null ? '' : budget.target_revenue_halalas / 100}"></label></div>
      <label style="display:block;margin:1rem 0">سبب التحديد أو التعديل<textarea class="input" name="reason" minlength="3" maxlength="1000" required rows="3"></textarea></label>
      <p>يُحفظ التغيير باسمك وسببه وقيمته السابقة. لا يُوزع المستهدف بالتساوي على الأشهر تلقائيًا.</p>
      <button class="btn btn-primary" type="submit">حفظ المستهدفات</button><p id="target-save-status" role="status" aria-live="polite"></p></form>`
      : `<p>المبيعات: <strong class="tnum">${amount(budget?.target_sales_halalas)}</strong></p><p>الإيراد: <strong class="tnum">${amount(budget?.target_revenue_halalas)}</strong></p>${!d.is_support && d.status !== 'conflict' ? '<p>العرض فقط حسب صلاحياتك الحالية.</p>' : ''}`}
    ${budget?.has_monthly_plan ? '<p class="alert info">يوجد توزيع شهري محفوظ سابقًا؛ لم يغيّره هذا النموذج. راجعه عند تغيير المستهدف السنوي للتأكد من اتساق الخطة.</p>' : ''}</div>
    ${(d.legacy.target_sales_halalas || d.legacy.target_revenue_halalas) ? `<details class="card" style="padding:1rem"><summary>قيم قديمة تحتاج تحديد السنة</summary><p>هذه القيم محفوظة في سجل القطاع دون سنة؛ لا تدخل في مقارنة السنة المعروضة ولا تُنسخ إليها تلقائيًا.</p><p>المبيعات ${amount(d.legacy.target_sales_halalas)} · الإيراد ${amount(d.legacy.target_revenue_halalas)}</p></details>` : ''}
    <section class="card" style="padding:1.5rem"><h2>سجل التعديلات</h2>${d.history.length ? `<ol>${d.history.map((r) => `<li style="margin-bottom:1rem"><strong>${esc(r.actor || 'مستخدم مسجل')} · <time class="tnum">${esc(r.at)}</time></strong><p>${esc(r.reason)}</p><div>قبل: ${esc(historyAmount(r.before))}</div><div>بعد: ${esc(historyAmount(r.after))}</div></li>`).join('')}</ol>` : '<p>لا يوجد سجل تعديلات محفوظ لهذه السنة. وجود قيمة قديمة لا يثبت وجود سجل مراجعة لها.</p>'}</section></div>`;
  return layout({ user, active: 'sector', title: 'مستهدفات القطاع', subtitle: `${d.sector.name_ar} · ${d.year}`, body, year: d.year, scripts: ['/static/pages/sector-targets.js'] });
}
