import { layout } from '../layout.js';
import { esc } from './_shared.js';
import { fmtSar } from '../../core/util/ids.js';
import { revenueReview } from '../../modules/finance/revenue-review.js';

export async function revenueReviewPage(user, opts = {}) {
  const d = await revenueReview(user, opts);
  const link = (page) => '/app/revenue-review?' + new URLSearchParams({ year: d.year, sector: d.sector, page });
  const tile = (label, value) => `<div class="card" style="padding:1rem"><div>${label}</div><strong class="tnum" style="font-size:1.4rem">${value}</strong></div>`;
  const body = `<div style="display:grid;gap:1rem">
    <a href="/app/imports">العودة للبيانات</a>
    <form method="get" style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
      <label for="review-year">سنة الإيراد</label><input class="input tnum" id="review-year" name="year" type="number" min="2000" max="2100" value="${d.year}" required style="max-width:120px">
      <input type="hidden" name="sector" value="${esc(d.sector)}"><button class="btn btn-primary">عرض السنة</button>
    </form>
    <div class="alert info">سنة البيع مستقلة عن سنة الإيراد. قد يُباع المشروع في 2025 وتتحقق إيراداته في 2026؛ لكل مخرج شهر وسنة استحقاق. تاريخ إدخال الملف لا يثبت فترة الإنجاز.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.7rem">
      ${tile('صافي الإيراد المسجل', fmtSar(d.recordedNet))}${tile('سجلات تحتاج مراجعة', `${d.issueCount} / ${d.total}`)}${tile('صافي السجلات محل المراجعة', fmtSar(d.reviewNet))}
    </div>
    <p style="color:var(--muted);margin:0">هذه قراءة للسجلات الحالية، وليست اعتمادًا لصحتها. المبلغ محل المراجعة جزء من المسجل؛ لا يُضاف إليه ولا يُخصم منه تلقائيًا. راجع مستند المصدر والمخرج قبل أي تصحيح.</p>
    ${d.rows.length ? `<div class="card tblwrap"><table style="width:100%;border-collapse:collapse;text-align:right">
      <thead><tr>${['المشروع والبيان', 'الفترة المسجلة', 'الصافي', 'ما يحتاج المراجعة', 'الإجراء'].map((h) => `<th scope="col" style="padding:.8rem">${h}</th>`).join('')}</tr></thead>
      <tbody>${d.rows.map((r) => `<tr>${[
        `${esc(r.projectName)}<div style="color:var(--muted)">${esc(r.label)}</div><small>${esc(r.sectorName)}</small>`,
        `<span class="tnum">${r.year}-${String(r.month).padStart(2, '0')}</span>`,
        `<span class="tnum">${fmtSar(r.net)}</span>${r.estimatedNet ? '<small> · محسوب من الإجمالي بالقاعدة الحالية، يحتاج تحققًا</small>' : ''}`,
        r.reasons.map((reason) => `<div>${esc(reason)}</div>`).join(''),
        r.href ? `<a class="btn btn-sm" href="${esc(r.href)}">راجع المشروع</a>` : 'راجع المسؤول عن المشروع',
      ].map((cell) => `<td style="padding:.8rem;border-top:1px solid var(--line);vertical-align:top;min-width:120px">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : `<div class="card empty-state"><div class="t">${d.total ? 'لم تظهر تعارضات في الفحوص الحالية' : 'لا إيراد مسجل لهذه السنة ضمن نطاقك'}</div><div class="s">${d.total ? 'تبقى مطابقة مستندات المصدر مطلوبة لاعتماد الأرقام.' : 'غياب السجلات لا يثبت أن الإيراد الفعلي صفر. راجع الفترة ومصادر البيانات.'}</div></div>`}
    <nav aria-label="صفحات المراجعة" style="display:flex;gap:.7rem;align-items:center">
      ${d.page > 1 ? `<a class="btn" href="${esc(link(d.page - 1))}">السابق</a>` : ''}<span class="tnum">${d.page} / ${d.pages}</span>${d.page < d.pages ? `<a class="btn" href="${esc(link(d.page + 1))}">التالي</a>` : ''}
    </nav></div>`;
  return layout({ user, active: 'imports', title: 'مراجعة جودة الإيراد', subtitle: `السنة ${d.year} · ضمن نطاق صلاحيتك`, body, year: d.year });
}
