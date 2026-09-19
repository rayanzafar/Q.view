// قائمة دخل القطاع — ورقةٌ للطباعة تُفتح بالمرشِّحات نفسها التي على الشاشة.
//
// لا قائمة جانبية ولا ترويسة تطبيق: ما يُطبع ورقةٌ تُقرأ خارج المنصة، ومن أرسل الرابط لغيره
// أرسل القائمة نفسها لا قائمةً أخرى — كل مرشِّح يُقرأ من العنوان عبر `statementFromQuery`،
// وهو القارئ الواحد الذي تقرأ منه الشاشة والملفّ وهذه الورقة معاً.
//
// ثلاث قواعد لا تُكسر في هذه الورقة:
//   ١) ما لم يُسجَّل يُقال «لم يُسجَّل» ولا يُكتب صفراً — الصفر في سطر كلفةٍ يُنتج «مجمل ربحٍ»
//      يساوي الإيراد كاملاً، ورقمٌ كهذا يُبنى عليه قرار.
//   ٢) الكلفة بين قوسين كما في القوائم المالية المطبوعة، فالسالب يُقرأ بلا علامةٍ تُلتبس.
//   ٣) الإيراد ليس المبيعات — جملةٌ حاضرة دائماً أسفل الورقة لا تُخفى بحال.
import { esc } from './_shared.js';
import { asset } from '../assets.js';
import { audit } from '../../core/audit/index.js';
import { G } from '../i18n/glossary.js';
import { fmtSar } from '../../core/util/ids.js';
import { statementFromQuery, varianceTone, noteText } from '../../modules/finance/income-statement.js';

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f6f7fb;color:#1e293b;font-family:'IBM Plex Sans Arabic','Segoe UI',sans-serif;font-size:13px;line-height:1.9}
.sheet{max-width:900px;margin:0 auto;padding:24px}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:2px solid #244A99;padding-bottom:12px}
.top h1{font-size:19px;margin:0;font-weight:800}
.top .sub{font-size:12px;color:#64748b;margin-top:4px}
.tools{display:flex;gap:8px;flex-wrap:wrap}
.tools button,.tools a{font:inherit;font-size:12px;font-weight:700;border:1px solid #cbd5e1;background:#fff;color:#244A99;border-radius:9px;padding:7px 14px;cursor:pointer;text-decoration:none}
.filters{margin-top:10px;font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.filters b{font-weight:800;color:#475569}
.fchip{background:#fff;border:1px solid #cbd5e1;border-radius:999px;padding:2px 10px;font-weight:700;color:#334155}
.tblwrap{overflow-x:auto;margin-top:14px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e6e9f0;border-radius:12px;overflow:hidden}
th,td{padding:9px 11px;text-align:right;border-bottom:1px solid #eef1f6;font-size:12.5px;white-space:nowrap}
th{background:#f8fafc;font-weight:800;color:#475569;font-size:11.5px}
td.item{white-space:normal;min-width:180px}
td.item b{display:block;font-weight:800;color:#1e293b}
td.item span{display:block;font-size:10.5px;color:#94a3b8;font-weight:600}
tr.sub td,tr.result td{background:#f8fafc;font-weight:800}
tr.result td{border-top:2px solid #244A99}
tr.gp td{background:#f1f5f9;font-weight:800}
bdi{unicode-bidi:isolate;font-variant-numeric:tabular-nums}
.na{color:#94a3b8;font-weight:700}
.good{color:#047857;font-weight:800}
.bad{color:#b91c1c;font-weight:800}
.neutral{color:#64748b;font-weight:700}
.notes{margin-top:14px;background:#fff;border:1px solid #e6e9f0;border-radius:12px;padding:12px 14px}
.notes .lead{font-weight:800;color:#244A99;margin-bottom:6px}
.notes ul{margin:0;padding-inline-start:18px;color:#475569;font-size:12px}
@media print{
  body{background:#fff}
  .sheet{max-width:none;padding:0}
  .tools{display:none}
  table{border-color:#d8dde7}
  @page{size:A4;margin:14mm}
}`;

// مبلغٌ يُقرأ: الكلفة بين قوسين، والفارغ يُقال «لم يُسجَّل» لا صفراً ولا شرطة.
// مُصدَّرتان لأن فصل «قائمة الدخل» على الشاشة يعرض الجدول نفسه: صيغةُ خليّةٍ واحدة للورقة
// والشاشة معاً، فلا تفترق الطباعة عمّا رآه القارئ قبل أن يطبع (الصنف `na` يُنسَّق عند كلٍّ).
export const plMoney = (halalas, kind) => {
  if (halalas == null) return `<span class="na">${esc(G.notEnteredYet)}</span>`;
  const text = fmtSar(Math.abs(halalas));
  const bracketed = (kind === 'cost' || kind === 'subtotal') || halalas < 0;
  return `<bdi dir="ltr">${esc(bracketed ? `(${text})` : text)}</bdi>`;
};
export const plPct = (v) => (v == null
  ? `<span class="na">${esc(G.notEnteredYet)}</span>`
  : `<bdi dir="ltr">${esc(`${v}%`)}</bdi>`);
const money = plMoney;
const pct = plPct;
const variance = (kind, v) => (v == null
  ? `<span class="na">${esc(G.notEnteredYet)}</span>`
  : `<bdi dir="ltr" class="${varianceTone(kind, v)}">${esc(`${v > 0 ? '+' : ''}${v}%`)}</bdi>`);

const ROW_CLASS = { subtotal: 'sub', result: 'result' };

/**
 * ورقة قائمة الدخل. `opts` يحمل ما في العنوان: sector / year / p / dept / client / project،
 * و`_ip` عنوانَ الطلب كي يكتمل سياق الأثر (المسار يكتبه، لا القارئ).
 */
export async function sectorPlPrintPage(user, opts = {}) {
  const { statement, sector, year, period, scope, labels } = await statementFromQuery(user, opts);
  // أثرُ الورقة كأثرِ الملفّ حرفاً: المورد نفسه والمعرِّف نفسه والتفصيل نفسه، ويُفرَّق بينهما
  // بـ`format` وحده — فمن يقرأ السجل يرى نسخةَ مالٍ خرجت من المنصة، طُبعت أم نُزِّلت.
  await audit({ user, ip: opts._ip ?? null }, {
    action: 'export',
    resource: 'report',
    resourceId: `income-statement:${sector.id}`,
    sectorId: sector.id,
    detail: { year, period: period.key, scope, rows: statement.rows.length, format: 'print' },
  });

  const chips = [
    `${G.periodWord}: ${labels.period} ${year}`,
    ...labels.filters,
  ].map((t) => `<span class="fchip">${esc(t)}</span>`).join('');

  const rows = statement.rows.map((r) => `<tr class="${ROW_CLASS[r.kind] || ''}">
    <td class="item"><b>${esc(r.ar)}</b><span dir="ltr">${esc(r.en)}</span></td>
    <td>${money(r.fy_plan_halalas, r.kind)}</td>
    <td>${pct(r.attainment_pct)}</td>
    <td>${money(r.period_plan_halalas, r.kind)}</td>
    <td>${money(r.period_actual_halalas, r.kind)}</td>
    <td>${variance(r.kind, r.variance_pct)}</td>
  </tr>`).join('');

  // نسبة مجمل الربح تتبع سطرها: إن حُذف السطر لغياب بابَي الكلفة والهامش فلا نسبة تُعرض.
  const gpShown = statement.rows.some((r) => r.key === 'gross_profit');
  const gp = statement.gross_profit_pct || {};
  // بلا مصطلحٍ إنجليزي تحت الاسم: ورقةُ الأعمال المتَّفق عليها لا تحمل سطر النسبة أصلاً، فلا
  // مصطلح له يُكتب — و«Gross Profit %» كان اختراعاً لا مصدرَ له.
  const gpRow = gpShown ? `<tr class="gp">
    <td class="item"><b>${esc(G.grossProfitPct)}</b></td>
    <td>${pct(gp.fy_plan)}</td>
    <td></td>
    <td>${pct(gp.period_plan)}</td>
    <td>${pct(gp.period_actual)}</td>
    <td></td>
  </tr>` : '';

  const noteItems = (statement.notes || []).map(noteText).filter(Boolean)
    .map((t) => `<li>${esc(t)}</li>`).join('');

  // رابط الملفّ يحمل المرشِّحات **بعد** التحقق منها، لا كما وردت في العنوان — فما أُهمل على
  // الورقة لأنه لا وجود له يُهمل في الملفّ أيضاً، والصورتان واحدة.
  const q = new URLSearchParams();
  q.set('year', String(year));
  if (opts.p) q.set('p', String(opts.p));
  if (scope.dept) q.set('dept', scope.dept);
  if (scope.client) q.set('client', scope.client);
  if (scope.project) q.set('project', scope.project);
  const xlsxHref = `/api/sectors/${encodeURIComponent(sector.id)}/income-statement.xlsx?${q.toString()}`;

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(G.incomeStatement)} — ${esc(labels.sector)}</title>
<style>${CSS}</style></head><body>
<div class="sheet">
  <div class="top">
    <div><h1>${esc(G.incomeStatement)} — ${esc(labels.sector)}</h1>
      <div class="sub">${esc(G.preparedBy)}: ${esc(user.name_ar || user.username || '')} · <bdi dir="ltr">${esc(new Date().toISOString().slice(0, 10))}</bdi></div></div>
    <div class="tools">
      <button type="button" data-action="dc-print">${esc(G.printNow)}</button>
      <a href="${esc(xlsxHref)}">${esc(G.downloadExcel)}</a>
      <a href="/app/sector">${esc(G.backToScreen)}</a>
    </div>
  </div>
  <div class="filters"><b>${esc(G.appliedFilters)}</b>${chips}</div>
  <div class="tblwrap"><table>
    <thead><tr>
      <th>${esc(G.lineItem)}</th>
      <th>${esc(G.fyPlan)}</th>
      <th>${esc(G.attainment)}</th>
      <th>${esc(G.periodPlan)}</th>
      <th>${esc(G.periodActual)}</th>
      <th>${esc(G.deviation)}</th>
    </tr></thead>
    <tbody>${rows}${gpRow}</tbody>
  </table></div>
  <div class="notes">
    <div class="lead">${esc(G.revenueVsSalesExplain)}</div>
    ${noteItems ? `<ul>${noteItems}</ul>` : ''}
  </div>
</div>
<script src="${asset('/static/pages/report.js')}" defer></script>
</body></html>`;
}
