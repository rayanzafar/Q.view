// تقرير مركز التطوير للطباعة — صفحةٌ واحدة تُفتح بالمرشِّحات نفسها التي على الشاشة، وتُطبع
// من المتصفح إلى ملفٍّ للقراءة خارج المنصة. لا قائمة جانبية ولا ترويسة تطبيق: ورقةٌ نظيفة.
//
// كل المرشِّحات تُقرأ من عنوان الصفحة، فما يُطبع هو ما كان معروضاً حرفاً بحرف — ومن أرسل
// الرابط لغيره أرسل القائمة نفسها لا قائمةً أخرى.
//
// العقد مع وحدة المنتجات: getProduct / listItems / itemStats / itemImages وحدها.
import { esc } from './_shared.js';
import { asset } from '../assets.js';
import { G } from '../i18n/glossary.js';
import { all } from '../../core/db/index.js';
import { getProduct } from '../../modules/products/products.js';
import { listItems, itemStats, itemImages } from '../../modules/products/items.js';

const STATUS_KEYS = ['NEW', 'TRIAGED', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'RESOLVED', 'NEEDS_INFO', 'DECLINED', 'DUPLICATE'];
const TYPE_KEYS = ['bug', 'suggestion'];
const URGENCY_KEYS = ['blocks', 'delays', 'improve'];
const LIMIT = 300;

const statusLabel = (v) => G.itemStatusAr[String(v || '')] || G.notSet;
const typeLabel = (v) => G.itemTypeAr[String(v || '')] || G.notSet;
const urgencyLabel = (v) => G.itemUrgencyAr[String(v || '')] || G.notSet;
const priorityLabel = (v) => G.itemPriorityAr[String(v || '')] || G.notSet;
const day = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 10) : G.notSet);

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f6f7fb;color:#1e293b;font-family:'IBM Plex Sans Arabic','Segoe UI',sans-serif;font-size:13px;line-height:1.9}
.sheet{max-width:900px;margin:0 auto;padding:24px}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:2px solid #244A99;padding-bottom:12px}
.top h1{font-size:19px;margin:0;font-weight:800}
.top .sub{font-size:12px;color:#64748b;margin-top:4px}
.tools{display:flex;gap:8px}
.tools button,.tools a{font:inherit;font-size:12px;font-weight:700;border:1px solid #cbd5e1;background:#fff;color:#244A99;border-radius:9px;padding:7px 14px;cursor:pointer;text-decoration:none}
.filters{margin-top:10px;font-size:11.5px;color:#64748b}
.sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:14px 0}
.sum div{background:#fff;border:1px solid #e6e9f0;border-radius:10px;padding:9px 11px}
.sum b{display:block;font-size:17px;font-weight:800}
.sum span{font-size:11px;color:#64748b;font-weight:700}
.it{background:#fff;border:1px solid #e6e9f0;border-radius:12px;padding:12px 14px;margin-bottom:10px;page-break-inside:avoid;break-inside:avoid}
.it h2{font-size:14px;margin:0 0 2px;font-weight:800}
.it .k{font-weight:800;color:#244A99}
.it .meta{font-size:11.5px;color:#64748b;display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.it .desc{margin-top:7px;white-space:pre-wrap}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.pair figure{margin:0}
.pair figcaption{font-size:11px;color:#64748b;font-weight:700;margin-bottom:3px}
.pair img{width:100%;border:1px solid #e6e9f0;border-radius:8px}
.tnum{unicode-bidi:isolate}
.none{background:#fff;border:1px solid #e6e9f0;border-radius:12px;padding:28px;text-align:center;color:#64748b}
@media print{
  body{background:#fff}
  .sheet{max-width:none;padding:0}
  .tools{display:none}
  .it{border-color:#d8dde7}
  @page{size:A4;margin:14mm}
}`;

export async function devCenterReportPage(user, productId, opts = {}) {
  const product = await getProduct(user, productId);
  const cur = {
    status: STATUS_KEYS.includes(opts.status) ? opts.status : '',
    type: TYPE_KEYS.includes(opts.type) ? opts.type : '',
    urgency: URGENCY_KEYS.includes(opts.urgency) ? opts.urgency : '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from || '')) ? String(opts.from) : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(String(opts.to || '')) ? String(opts.to) : '',
    q: String(opts.q || '').trim().slice(0, 80),
  };
  const [rows, s, sectorRows] = await Promise.all([
    listItems(user, product.id, { ...cur, limit: LIMIT }),
    itemStats(user, product.id, cur),
    all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL'),
  ]);
  const sectors = new Map(sectorRows.map((r) => [r.id, r.name_ar]));
  // صور «قبل/بعد» تُقرأ لكل بندٍ على حدة (بلا بايتات — بياناتُها وحدها) لأن الورقة تعرضها
  // جنباً إلى جنب: هي الدليل الذي يُقرأ خارج المنصة، لا زينةٌ تُحذف عند الطباعة.
  const shots = await Promise.all(rows.map((r) => itemImages(r.id)));
  rows.forEach((r, i) => { r.images = shots[i]; });

  const applied = [
    cur.status ? `${G.statusWord}: ${statusLabel(cur.status)}` : '',
    cur.type ? `${G.itemType}: ${typeLabel(cur.type)}` : '',
    cur.urgency ? `${G.urgency}: ${urgencyLabel(cur.urgency)}` : '',
    cur.from ? `${G.fromDate}: ${cur.from}` : '',
    cur.to ? `${G.toDate}: ${cur.to}` : '',
    cur.q ? `${G.searchWord}: ${cur.q}` : '',
  ].filter(Boolean).join(' · ') || G.noFilters;

  const sum = `<div class="sum">
    <div><b class="tnum">${esc(String(s.total || 0))}</b><span>${esc(G.itemsTotal)}</span></div>
    <div><b class="tnum">${esc(String(s.open || 0))}</b><span>${esc(G.itemsOpen)}</span></div>
    <div><b class="tnum">${esc(String(s.byStatus.AWAITING_APPROVAL || 0))}</b><span>${esc(G.awaitingApprovalShort)}</span></div>
    <div><b class="tnum">${esc(String(s.resolved || 0))}</b><span>${esc(G.itemResolvedShort)}</span></div>
    <div><b class="tnum">${esc(String(s.byStatus.DECLINED || 0))}</b><span>${esc(G.itemDeclinedShort)}</span></div>
  </div>`;

  const imgs = (r) => {
    const list = Array.isArray(r.images) ? r.images : [];
    const before = list.filter((i) => i.kind === 'before');
    const after = list.filter((i) => i.kind === 'after');
    if (!before.length && !after.length) return '';
    const col = (label, arr) => `<figure><figcaption>${esc(label)}</figcaption>
      ${arr.map((i) => `<img alt="${esc(label)} — ${esc(r.item_key || '')}" src="/api/products/items/${encodeURIComponent(r.id)}/images/${encodeURIComponent(i.id)}">`).join('')}</figure>`;
    return `<div class="pair">${col(G.beforeWord, before)}${col(G.afterWord, after)}</div>`;
  };

  const cards = rows.length ? rows.map((r) => `<article class="it">
    <h2><span class="k tnum">${esc(r.item_key || '')}</span> — ${esc(r.title || G.noTitle)}</h2>
    <div class="meta">
      <span>${esc(typeLabel(r.type))}</span>
      <span>${esc(statusLabel(r.status))}</span>
      <span>${esc(G.urgency)}: ${esc(urgencyLabel(r.urgency))}</span>
      <span>${esc(G.priority)}: ${esc(priorityLabel(r.priority))}</span>
      <span>${esc(G.reporter)}: ${esc(r.reporter_name || G.notSet)}</span>
      ${sectors.get(r.sector_id) ? `<span>${esc(sectors.get(r.sector_id))}</span>` : ''}
      ${r.tenant_name ? `<span>${esc(r.tenant_name)}</span>` : ''}
      <span class="tnum">${esc(day(r.created_at))}</span>
      ${r.version_label ? `<span>${esc(G.versionTag)}: ${esc(r.version_label)}</span>` : ''}
    </div>
    ${r.where_text ? `<div class="desc"><b>${esc(G.whereHappened)}:</b> ${esc(r.where_text)}</div>` : ''}
    ${r.description ? `<div class="desc">${esc(r.description)}</div>` : ''}
    ${r.dev_description ? `<div class="desc"><b>${esc(G.devNote)}:</b> ${esc(r.dev_description)}</div>` : ''}
    ${r.decline_reason ? `<div class="desc"><b>${esc(G.declineReason)}:</b> ${esc(r.decline_reason)}</div>` : ''}
    ${imgs(r)}
  </article>`).join('') : `<div class="none">${esc(G.noItemsInRange)}</div>`;

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(product.name_ar || G.devCenter)} — ${esc(G.reportsTab)}</title>
<style>${CSS}</style></head><body>
<div class="sheet">
  <div class="top">
    <div><h1>${esc(product.name_ar || G.devCenter)} — ${esc(G.reportsTab)}</h1>
      <div class="sub">${esc(G.preparedBy)}: ${esc(user.name_ar || user.username || '')} · <span class="tnum">${esc(new Date().toISOString().slice(0, 10))}</span></div></div>
    <div class="tools">
      <button type="button" data-action="dc-print">${esc(G.printNow)}</button>
      <a href="/app/dev-center/${esc(encodeURIComponent(product.id))}">${esc(G.backToScreen)}</a>
    </div>
  </div>
  <div class="filters">${esc(G.appliedFilters)}: ${esc(applied)}</div>
  ${sum}
  ${cards}
</div>
<script src="${asset('/static/pages/report.js')}" defer></script>
</body></html>`;
}
