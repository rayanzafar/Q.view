// Clients pages: العملاء (portfolio list) + client 360 detail — decision-story order:
// who is the client → how healthy is the relationship → what money moves → what to do next.
import { layout, card, pill, tr, hbars } from '../layout.js';
import { netSql } from '../../modules/finance/vat.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { get } from '../../core/db/index.js';
import { config } from '../../core/config.js';
import { can } from '../../core/rbac/index.js';
import { G } from '../i18n/glossary.js';
import { countAr } from '../../core/i18n/plural.js';
import { listClients, clientOverview, salesWinRate, CLIENT_TYPES, likelyDuplicateClients, clientNameReview } from '../../modules/clients/clients.js';
import { sarShort, esc, statMini, noticeCard, ddWrap, ddRows } from './_shared.js';

const REL_TONE = { 'نشطة': 'green', 'فاترة': 'amber', 'خاملة': 'slate' };
const TYPE_TONE = { 'حكومي': 'blue', 'شبه حكومي': 'violet', 'خاص': 'slate', 'داخلي': 'slate' };
const DOC_KIND_AR = { contract: 'عقد', proposal: 'عرض', report: 'تقرير', letter: 'خطاب', other: 'أخرى' };

// «منذ n يوماً» بصيغة عربية صحيحة (اليوم/أمس/يومين/أيام/يوماً)
export function relDay(at) {
  if (!at) return null;
  const d = Math.max(0, Math.floor((Date.now() - new Date(String(at).slice(0, 10) + 'T00:00:00Z').getTime()) / 86400000));
  if (d === 0) return 'اليوم';
  if (d === 1) return 'أمس';
  if (d === 2) return 'منذ يومين';
  if (d <= 10) return `منذ ${d} أيام`;
  return `منذ ${d} يوماً`;
}

// activity-kind icons (inline SVG — self-contained, colored bubble per kind)
const AK = {
  call: ['var(--brand)', '<path d="M5 4c0 8.5 6.5 15 15 15l1.5-3.5-4-1.8-1.8 1.8c-2.8-1.2-5-3.4-6.2-6.2L11.3 7.5 9.5 3.5z"/>'],
  meeting: ['var(--brand2)', '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0111 0"/><circle cx="17" cy="9" r="2.4"/><path d="M14.8 19a4.6 4.6 0 016.7 0"/>'],
  email: ['#0891b2', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7.5l9 6 9-6"/>'],
  visit: ['#0d9488', '<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M10 20.5v-3.5h4v3.5"/><path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2"/>'],
  note: ['#64748b', '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'],
  proposal: ['#834798', '<path d="M6 2.5h8.5L20 8v13.5H6z"/><path d="M14 2.5V8h6"/>'],
  update: ['#64748b', '<path d="M21 12a9 9 0 11-2.6-6.4"/><path d="M21 3v5h-5"/>'],
  other: ['#64748b', '<circle cx="12" cy="12" r="3.5"/>'],
  won: ['#059669', '<path d="M4 12.5l5 5L20 6.5"/>'],
  lost: ['#dc2626', '<path d="M6 6l12 12M18 6L6 18"/>'],
  contract_signed: ['#244A99', '<path d="M6 2.5h8.5L20 8v13.5H6z"/><path d="M14 2.5V8h6"/><path d="M9.5 15l2 2 3.5-4"/>'],
  invoice_issued: ['#834798', '<path d="M6 2.5h12V21l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9.5 8h5M9.5 11.5h5"/>'],
  collection: ['#059669', '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8m0 0l-3-3m3 3l3-3"/>'],
  project_started: ['var(--brand)', '<path d="M5 21V4"/><path d="M5 4h12l-2.5 3.5L17 11H5"/>'],
};
const aicon = (kind) => {
  const [c, p] = AK[kind] || AK.other;
  return `<span style="flex:0 0 auto;width:28px;height:28px;border-radius:9px;background:${c}18;color:${c};display:inline-flex;align-items:center;justify-content:center">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${p}</svg></span>`;
};

const th = (t, a) => `<th style="padding:.45rem .7rem;font-size:10.5px;color:var(--muted);font-weight:700;text-align:${a || 'right'};white-space:nowrap">${t}</th>`;

// ─────────────────────────────────────────────────────────────────────────────
// صفحة العملاء — جدول قرار: هوية العميل ← صحة العلاقة ← الفرص ← المال والمستحقات
// ─────────────────────────────────────────────────────────────────────────────
// «N فرص» بصيغة عربية صحيحة
const oppCountAr = (n) => (n === 1 ? 'فرصة واحدة' : n === 2 ? 'فرصتان' : n <= 10 ? `${n} فرص` : `${n} فرصة`);

export async function clientsPage(user, opts = {}) {
  const query = (opts.query || '').toString().trim();
  const type = (opts.type || '').toString().trim();
  const rel = ['نشطة', 'فاترة', 'خاملة'].includes(opts.rel) ? opts.rel : '';
  const sort = ['pipeline', 'activity'].includes(opts.sort) ? opts.sort : 'revenue';
  const fy = config.fiscalYear;
  const rows = await listClients(user, { query, type, sort });
  const canCreate = can(user, 'create', 'client');
  // تصفية حالة العلاقة (نشطة/فاترة/خاملة) عاملُ تركيز علويّ — الإحصاءات تبقى محسوبةً على كل العملاء
  const shown = rel ? rows.filter((r) => r.relationship === rel) : rows;

  // preserve current filters in every chip/link (الافتراضي: أكبر العلاقات أولاً = revenue)
  const qs = (patch = {}) => {
    const p = new URLSearchParams();
    const v = { query, type, rel, sort, ...patch };
    if (v.query) p.set('query', v.query);
    if (v.type) p.set('type', v.type);
    if (v.rel) p.set('rel', v.rel);
    if (v.sort && v.sort !== 'revenue') p.set('sort', v.sort);
    const s = p.toString();
    return '/app/clients' + (s ? '?' + s : '');
  };

  // ── الشريط التحليلي: عدد العملاء · تركّز أعلى ٥ · العميل الأول · معدل الفوز · نمو الإيراد ──
  const relCount = { 'نشطة': 0, 'فاترة': 0, 'خاملة': 0 };
  for (const r of rows) relCount[r.relationship] = (relCount[r.relationship] || 0) + 1;
  const companyFy = (await get(`SELECT COALESCE(SUM(${netSql('amount_halalas', 'net_amount_halalas')}),0) v FROM revenue_line WHERE year = ?`, [fy]))?.v || 0;
  const top5 = rows.slice().sort((a, b) => b.fy_revenue_halalas - a.fy_revenue_halalas).filter((r) => r.fy_revenue_halalas > 0).slice(0, 5);
  const top5Rev = top5.reduce((a, r) => a + r.fy_revenue_halalas, 0);
  const top5Pct = companyFy > 0 && top5.length ? Math.round((top5Rev / companyFy) * 100) : null;
  const concStat = card(`<div role="button" tabindex="0" data-dd="top5" style="padding:.6rem .9rem;min-width:150px">
      <div style="font-size:11px;color:var(--muted);font-weight:700">${G.concentration} — أعلى 5 عملاء <span style="color:var(--faint)">⊕</span></div>
      <div class="tnum" style="font-size:1.15rem;font-weight:800;color:${top5Pct != null && top5Pct >= 60 ? 'var(--amber)' : 'var(--ink2)'};letter-spacing:-.02em">${top5Pct != null ? top5Pct + '%' : '—'}</div>
      <div style="font-size:10.5px;color:var(--faint)">من إيراد الشركة ${fy}</div></div>`, 'cardclick card-h');
  const ddTop5 = ddWrap('top5', `${G.concentration} — أعلى 5 عملاء`, `حصة كل عميل من إيراد الشركة ${fy} (${fmtSar(companyFy)})`, `
    <div>${ddRows(top5.map((r) => {
    const share = companyFy > 0 ? Math.round((r.fy_revenue_halalas / companyFy) * 100) : 0;
    return `<div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name_ar)}</span>
          <b class="tnum" style="flex:none">${fmtSar(r.fy_revenue_halalas)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted)"><span>حصة ${share}%</span></div>
        <div class="bar" style="margin-top:.25rem;height:5px"><span style="width:${Math.min(100, share)}%;background:var(--brand)"></span></div>
      </div>`;
  }))}</div>`);

  // العميل الأول: صاحب أعلى إيراد هذه السنة + حصته من إيراد الشركة
  const top1 = top5[0] || null;
  const top1Share = top1 && companyFy > 0 ? Math.round((top1.fy_revenue_halalas / companyFy) * 100) : null;
  const topStat = top1
    ? card(`<div style="padding:.6rem .9rem;min-width:150px;max-width:230px">
      <div style="font-size:11px;color:var(--muted);font-weight:700">${G.topClient}</div>
      <div style="font-size:13.5px;font-weight:800;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:.15rem 0"><a href="/app/client/${top1.id}" style="color:inherit">${esc(top1.name_ar)}</a></div>
      <div style="font-size:10.5px;color:var(--faint)" class="tnum">${top1Share != null ? `حصته ${top1Share}% من إيراد ${fy}` : `إيراده ${fmtSar(top1.fy_revenue_halalas)}`}</div></div>`, 'card-h')
    : statMini(G.topClient, '—', `لا إيراد مسجلاً في ${fy}`);

  // نسبة الفوز — موحّدة مع لوحة الفرص: النطاق والمعادلة نفسها (فوز÷(فوز+خسارة)).
  // الرئيسي = السنة المالية (نفس عدّاد «مكسوبة سنة FY» في اللوحة)؛ التاريخي سطر ثانوي (= بطاقة اللوحة).
  const wr = await salesWinRate(user, fy);
  const winStat = statMini(`${G.winRate} · ${fy}`,
    wr.fy_win_rate != null ? wr.fy_win_rate + '%' : '—',
    wr.fy_win_rate != null
      ? `${wr.fy_won} ${G.won} · ${wr.fy_lost} ${G.lost}${wr.hist_win_rate != null ? ` <span style="color:var(--faint)">· تاريخي ${wr.hist_win_rate}%</span>` : ''}`
      : `لا فرص محسومة في ${fy}`,
    wr.fy_win_rate == null ? '' : wr.fy_win_rate >= 50 ? 'good' : wr.fy_win_rate < 30 ? 'warn' : '');

  // نمو الإيراد: مجموع إيراد العملاء الظاهرين هذه السنة مقابل السنة الماضية
  const curRev = rows.reduce((a, r) => a + (r.fy_revenue_halalas || 0), 0);
  const prevRev = rows.reduce((a, r) => a + (r.prev_fy_revenue_halalas || 0), 0);
  const growth = prevRev > 0 ? Math.round(((curRev - prevRev) / prevRev) * 100) : null;
  const growthChip = growth == null ? ''
    : `<span class="pace-chip ${growth > 0 ? 'up' : growth < 0 ? 'down' : 'flat'}">${growth > 0 ? '▲' : growth < 0 ? '▼' : '•'} مقابل ${sarShort(prevRev)} في ${fy - 1}</span>`;
  const growthStat = statMini('نمو الإيراد', growth == null ? '—' : `${growth > 0 ? '+' : ''}${growth}%`,
    growth == null ? `لا إيراد مسجلاً في ${fy - 1}` : growthChip,
    growth == null ? '' : growth > 0 ? 'good' : growth < 0 ? 'bad' : '');

  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${statMini('عدد العملاء', rows.length, `${relCount['نشطة']} ${G.relActive} · ${relCount['فاترة']} ${G.relCooling} · ${relCount['خاملة']} ${G.relDormant}`)}
    ${concStat}
    ${topStat}
    ${winStat}
    ${growthStat}</div>`;

  const relChip = (val, label) => `<a href="${qs({ rel: val })}" class="chip ${rel === val ? 'on' : ''}">${label}${val && relCount[val] ? ` <span class="tnum" style="opacity:.65">${relCount[val]}</span>` : ''}</a>`;
  const chips = `<div class="chips" style="margin-bottom:.55rem"><span class="lbl">النوع:</span>
    <a href="${qs({ type: '' })}" class="chip ${type ? '' : 'on'}">${G.all}</a>
    ${CLIENT_TYPES.map((t) => `<a href="${qs({ type: t })}" class="chip ${type === t ? 'on' : ''}">${t}</a>`).join('')}
  </div>
  <div class="chips"><span class="lbl">العلاقة:</span>
    ${relChip('', G.all)}${relChip('نشطة', 'نشطة')}${relChip('فاترة', 'فاترة')}${relChip('خاملة', 'خاملة')}
  </div>`;

  const sortOpts = [['revenue', `إيراد ${fy}`], ['pipeline', G.pipeline], ['activity', G.lastActivity]];
  const toolbar = `<div class="toolbar">
    <form method="get" action="/app/clients" id="cl-form" style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
      <div class="search">${icon('search')}<input class="input" id="cl-q" name="query" value="${esc(query)}" aria-label="${G.search} في العملاء" placeholder="ابحث بالاسم أو الكود…"></div>
      ${type ? `<input type="hidden" name="type" value="${esc(type)}">` : ''}
      ${rel ? `<input type="hidden" name="rel" value="${esc(rel)}">` : ''}
      <label style="display:flex;align-items:center;gap:.35rem;font-size:12px;color:var(--muted)">ترتيب حسب
        <select class="input" id="cl-sort" name="sort" style="padding:.35rem .5rem">${sortOpts.map(([v, l]) => `<option value="${v}" ${sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </form>
    <div class="spacer"></div>
    ${canCreate ? `<button class="btn btn-primary" data-action="client-add">${icon('plus')} عميل جديد</button>` : ''}
  </div>`;

  // ── خلايا الجدول (٦ أعمدة قرار: الهوية ← العلاقة ← الفرص ← السجل ← التنفيذ ← المال) ──
  const dash = '<span style="color:var(--faint)">—</span>';
  // القطاعات وسوماً صغيرة أسفل اسم العميل (طُوي عمود «القطاعات» المستقل داخل خانة الهوية)
  const secChips = (r) => {
    const secs = r.sectors || [];
    if (!secs.length) return '';
    const shown = secs.slice(0, 3);
    const extra = secs.length - shown.length;
    return `<div style="display:flex;gap:.25rem;flex-wrap:wrap;margin-top:.3rem" title="${esc(secs.join(' · '))}">
      ${shown.map((s) => `<span style="font-size:9.5px;font-weight:700;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:.1rem .4rem;white-space:nowrap;color:var(--muted)">${esc(s)}</span>`).join('')}
      ${extra > 0 ? `<span class="tnum" style="font-size:9.5px;font-weight:800;color:var(--faint);align-self:center">+${extra}</span>` : ''}</div>`;
  };
  // العلاقة: الحالة + آخر تواصل (طُوي عمودان في واحد) + تنبيه «عميل مهم يبرد»
  // (علاقة فاترة/خاملة لكن له إيراد أو خط فرص أو مستحق مفتوح — أولوية تواصل قبل أن نخسره).
  const relCell = (r) => {
    // تنبيه انتقائي «act now»: عميل ذو قيمة (إيراد/خط فرص/مستحق) وعلاقته فاترة أو خاملة وصمتٌ ٦٠ يوماً
    // فأكثر. نستثني «نشطة» لأن الفرصة المفتوحة تُبقيه نشطاً ولو تأخّر آخر تواصل مسجّل.
    const hasValue = (r.fy_revenue_halalas > 0) || (r.open_pipeline_halalas > 0) || (r.open_ar_halalas > 0);
    const daysSilent = r.last_activity_at
      ? Math.floor((Date.now() - new Date(String(r.last_activity_at).slice(0, 10) + 'T00:00:00Z').getTime()) / 86400000) : 999;
    const atRisk = (r.relationship === 'فاترة' || r.relationship === 'خاملة') && hasValue && daysSilent >= 60;
    return `${pill(r.relationship, REL_TONE[r.relationship] || 'slate')}
    <div class="tnum" style="font-size:10.5px;color:var(--muted);margin-top:.28rem;white-space:nowrap">${r.last_activity_at ? relDay(r.last_activity_at) : '<span style="color:var(--faint)">لا تواصل مسجّل</span>'}</div>
    ${atRisk ? '<div style="font-size:9.5px;color:var(--amber);font-weight:800;margin-top:.18rem;white-space:nowrap" title="عميل ذو قيمة وعلاقته تبرد — بادر بالتواصل">⚠ يحتاج تواصلاً</div>' : ''}`;
  };
  // خط الفرص المفتوح: القيمة الإجمالية (رئيسي) + العدد والمرجّح (ثانوي)
  const oppsCell = (r) => (r.open_opps
    ? `<div class="tnum" style="font-weight:800;font-size:12.5px;color:var(--ink2)">${sarShort(r.open_pipeline_halalas)}</div>
       <div class="tnum" style="font-size:10px;color:var(--muted)">${oppCountAr(r.open_opps)} · مرجّح ${sarShort(r.weighted_pipeline_halalas)}</div>`
    : dash);
  // الفوز · الخسارة: مضغوط — «N فوز» أخضر · «M خسارة» + المستورد التاريخي سطر خافت
  const wlCell = (r) => {
    const seg = [];
    if (r.won_count) seg.push(`<span style="color:var(--green);font-weight:800" class="tnum">${r.won_count} فوز</span>`);
    if (r.lost_count) seg.push(`<span style="color:var(--muted);font-weight:700" class="tnum">${r.lost_count} خسارة</span>`);
    if (!seg.length && !r.hist_won_count) return dash;
    const main = seg.length ? `<div style="font-size:11.5px">${seg.join('<span style="color:var(--faint)"> · </span>')}</div>` : '';
    return `${main}${r.hist_won_count ? `<div class="tnum" style="color:var(--faint);font-size:10px">+${r.hist_won_count} تاريخي</div>` : ''}`;
  };
  // المال: إيراد السنة (رئيسي) + المستحق سطر أحمر عند التأخر (طُوي عمود «المستحق» هنا — «قيمة العقود» أُسقط لخلوّه)
  const moneyCell = (r) => {
    const rev = r.fy_revenue_halalas > 0
      ? `<div class="tnum" style="font-weight:800;font-size:12.5px;color:var(--ink2)">${fmtSar(r.fy_revenue_halalas)}</div>` : '';
    let ar = '';
    if (r.overdue_ar_halalas > 0) ar = `<div class="tnum" style="font-size:10.5px;font-weight:800;color:var(--red)">${G.overdue} ${sarShort(r.overdue_ar_halalas)}</div>`;
    else if (r.open_ar_halalas > 0) ar = `<div class="tnum" style="font-size:10.5px;font-weight:700;color:var(--amber)">${G.outstanding} ${sarShort(r.open_ar_halalas)}</div>`;
    return (rev + ar) || dash;
  };

  const rowTpl = (r) => `<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="location.href='/app/client/${r.id}'">
    <td style="padding:.6rem .55rem;min-width:200px;max-width:290px">
      <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
        <a href="/app/client/${r.id}" style="font-size:13px;font-weight:700;color:var(--ink2)">${esc(r.name_ar)}</a>
        ${r.type ? pill(esc(r.type), TYPE_TONE[r.type] || 'slate') : ''}
      </div>
      ${r.code ? `<div style="font-size:10px;color:var(--faint);margin-top:.15rem"><bdi>${esc(r.code)}</bdi></div>` : ''}
      ${secChips(r)}</td>
    <td data-label="${G.relationship}" style="padding:.6rem .55rem;text-align:center">${relCell(r)}</td>
    <td data-label="الفرص المفتوحة" style="padding:.6rem .55rem;text-align:left;white-space:nowrap">${oppsCell(r)}</td>
    <td data-label="الفوز · الخسارة" style="padding:.6rem .55rem;text-align:center">${wlCell(r)}</td>
    <td data-label="مشاريع نشطة" style="padding:.6rem .55rem;text-align:center;font-size:13px" class="tnum">${r.active_projects || dash}</td>
    <td data-label="إيراد ${fy}" style="padding:.6rem .55rem;text-align:left;white-space:nowrap">${moneyCell(r)}</td>
  </tr>`;
  // تقسيم القائمة المعروضة: عملاء لهم تعامل فعلي (إيراد/فرص/مشاريع/حسم/مستحق) في الجدول الرئيسي،
  // وجهاتٌ في السجل بلا حراك تُطوى في ذيل قابل للفتح — يحوّل الجدار الطويل إلى قائمة قرار مركّزة.
  // عند تفعيل تصفية العلاقة نعرض كل المطابق في جدول واحد بلا طيّ.
  const dealings = (r) => (r.fy_revenue_halalas > 0) || (r.open_opps > 0) || (r.active_projects > 0) || (r.won_count > 0) || (r.lost_count > 0) || (r.open_ar_halalas > 0);
  const engaged = rel ? shown : shown.filter(dealings);
  const idle = rel ? [] : shown.filter((r) => !dealings(r));

  const filtering = query || type || rel;
  const emptyState = `<div class="empty-state">${icon('client')}
    <div class="t">${filtering ? 'لا نتائج مطابقة' : 'لا عملاء بعد'}</div>
    <div class="s">${filtering ? 'جرّب تعديل كلمة البحث أو إزالة التصفية.' : 'ابدأ ببناء سجل عملائك — كل فرصة وعقد ومشروع سيرتبط بعميله تلقائياً.'}</div>
    ${canCreate && !filtering ? `<button class="btn btn-primary" data-action="client-add">${icon('plus')} عميل جديد</button>` : ''}</div>`;

  const relTip = 'تُقاس حالة العلاقة بآخر تواصل مسجّل: عميل بلا تواصل حديث يتحوّل من نشطة إلى فاترة ثم خاملة، وأي فرصة مفتوحة تُبقيه نشطاً';
  const headRow = `<thead><tr>${th(G.client)}${th(`<span data-tip="${esc(relTip)}">${G.relationship} ⓘ</span>`, 'center')}${th('الفرص المفتوحة', 'left')}${th('الفوز · الخسارة', 'center')}${th('مشاريع نشطة', 'center')}${th(`إيراد ${fy}`, 'left')}</tr></thead>`;
  const tableFor = (list, empty) => `<div class="tblwrap"><table class="rtbl" style="width:100%;border-collapse:collapse;min-width:860px">${headRow}<tbody>${list.map(rowTpl).join('')}</tbody></table>${list.length ? '' : empty}</div>`;
  const table = card(tableFor(engaged, emptyState));
  const idleBlock = idle.length ? `<details style="margin-top:.85rem">
    <summary style="cursor:pointer;list-style:none;padding:.6rem .9rem;background:#fff;border:1px solid var(--line);border-radius:12px;font-size:12.5px;display:flex;align-items:center;gap:.5rem">
      <span style="font-weight:800;color:var(--ink2)">جهات في السجل بلا تعامل بعد</span>
      <span class="tnum" style="background:#f1f5f9;border-radius:20px;padding:.05rem .55rem;font-weight:700;color:var(--muted)">${idle.length}</span>
      <span style="color:var(--faint);font-size:11px">بلا فرص أو مشاريع أو إيراد — إظهار / إخفاء</span></summary>
    <div style="margin-top:.5rem">${card(tableFor(idle, ''))}</div></details>` : '';

  // شرح ظاهر لحالة العلاقة وأساسها (يُحدَّد آلياً بآخر تواصل مسجّل + وجود فرصة مفتوحة)
  const relLegend = `<div class="card" style="padding:.65rem .9rem;margin-bottom:1rem;display:flex;gap:.35rem 1.3rem;flex-wrap:wrap;align-items:center;font-size:11.5px;color:var(--muted)">
    <span style="font-weight:800;color:var(--ink2)">حالة العلاقة تُحدَّد آلياً بآخر تواصل مسجّل:</span>
    <span style="display:inline-flex;align-items:center;gap:.4rem">${pill('نشطة', 'green')} تواصل خلال 30 يوماً أو لديه فرصة مفتوحة</span>
    <span style="display:inline-flex;align-items:center;gap:.4rem">${pill('فاترة', 'amber')} آخر تواصل بين 31 و120 يوماً</span>
    <span style="display:inline-flex;align-items:center;gap:.4rem">${pill('خاملة', 'slate')} لا تواصل منذ أكثر من 120 يوماً وبلا فرص مفتوحة</span></div>`;
  // ── جهات يُحتمل أنها واحدة ──────────────────────────────────────────────────
  // الجهة الواحدة كانت تُسجَّل مرتين وينقسم عملها بين الصفَّين تبعاً لقطاع EVC المنفِّذ، فتُقرأ
  // جهتان متوسطتان مكان جهة كبيرة. وحارس الاسم يمسك المطابق حرفياً لا «س» و«س - الديوان العام».
  // يُعرَض هنا لا في فحص الهيكل: مكان القرار هو الشاشة التي يُتَّخذ فيها، والدمج فعلٌ على جهة.
  const mayMerge = can(user, 'update', 'client') && can(user, 'delete', 'client');
  const dupPairs = mayMerge ? await likelyDuplicateClients(user) : [];
  const dupRow = (p) => `<div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;padding:.5rem 0;border-bottom:1px dashed var(--line)">
      <span style="font-weight:700;color:var(--ink2);font-size:12.5px">${esc(p.a.name_ar)}</span>
      <span style="color:var(--faint)">↔</span>
      <span style="font-weight:700;color:var(--ink2);font-size:12.5px">${esc(p.b.name_ar)}</span>
      ${p.kind === 'contained'
    ? pill('اسم يحتوي الآخر', 'amber')
    : pill('تشابه عالٍ — راجِعها', 'slate')}
      <button class="btn btn-sm" style="margin-inline-start:auto" data-action="client-merge"
        data-a="${esc(p.a.id)}" data-a-name="${esc(p.a.name_ar)}"
        data-b="${esc(p.b.id)}" data-b-name="${esc(p.b.name_ar)}">مراجعة ودمج</button>
    </div>`;
  const dupBlock = dupPairs.length ? `<details style="margin-bottom:1rem" open>
    <summary style="cursor:pointer;list-style:none;padding:.6rem .9rem;background:#fff;border:1px solid var(--amber);border-radius:12px;font-size:12.5px;display:flex;align-items:center;gap:.5rem">
      <span style="font-weight:800;color:var(--ink2)">جهات يُحتمل أنها جهة واحدة</span>
      <span class="tnum" style="background:#fef3c7;border-radius:20px;padding:.05rem .55rem;font-weight:700;color:var(--ink2)">${dupPairs.length}</span>
      <span style="color:var(--faint);font-size:11px">تسجيل الجهة مرتين يقسم إيرادها وفرصها نصفين — إظهار / إخفاء</span></summary>
    <div style="margin-top:.5rem">${card(`<div style="font-size:11.5px;color:var(--muted);margin-bottom:.4rem">
        الدمج ينقل المشاريع والفرص والعقود والفواتير للجهة الباقية، ويُبقي المدموجة محفوظة قابلة للاسترجاع.
        و«تشابه عالٍ» ليس دليلاً — فروع إقليمية مختلفة تتشابه أسماؤها.
      </div>${dupPairs.map(dupRow).join('')}`)}</div></details>` : '';

  // ── الأسماء مقابل المرجع الرسمي ────────────────────────────────────────────
  // المرجع يمسك ما تعجز عنه مقارنة النصوص: «هدف» و«صندوق تنمية الموارد البشرية» لا رابط
  // لغوي بينهما، والمرجع يعرف أنهما واحد. واليقين هنا يحتاج برهاناً: ما دون المطابقة
  // النصّية الكاملة يُعرَض للمراجعة ولا يُنفَّذ — لأن جولة تشابهٍ متساهلة على هذه البيانات
  // نفسها رشّحت «الأمن العام» لتصير «الهيئة الوطنية للأمن السيبراني»، وعليها ٢٧٠ مليوناً.
  const nameReview = mayMerge ? await clientNameReview(user) : null;
  const nrRow = (r, certain) => `<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.45rem 0;border-bottom:1px dashed var(--line)">
      <span style="font-size:12.5px;color:var(--muted)">${esc(r.client.name_ar)}</span>
      <span style="color:var(--faint)">⟵</span>
      <b style="font-size:12.5px;color:var(--ink2)">${esc(r.official_name)}</b>
      ${r.abbr ? `<span class="tnum" style="font-size:10.5px;color:var(--faint)">${esc(r.abbr)}</span>` : ''}
      <span style="font-size:10.5px;color:var(--faint)">${esc(r.reason_ar)}</span>
      <span style="margin-inline-start:auto;display:inline-flex;gap:.35rem">
        ${certain ? `<button class="btn btn-sm" data-action="client-rename"
          data-id="${esc(r.client.id)}" data-to="${esc(r.official_name)}">اعتمد الاسم الرسمي</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-action="client-name-keep"
          data-id="${esc(r.client.id)}" data-name="${esc(r.client.name_ar)}"
          title="الاسم الحالي صحيح — لا تقترح تغييره مرة أخرى">الاسم صحيح</button>
      </span>
    </div>`;
  const nameBlock = nameReview && (nameReview.rename.length || nameReview.review.length)
    ? `<details style="margin-bottom:1rem">
    <summary style="cursor:pointer;list-style:none;padding:.6rem .9rem;background:#fff;border:1px solid var(--line);border-radius:12px;font-size:12.5px;display:flex;align-items:center;gap:.5rem">
      <span style="font-weight:800;color:var(--ink2)">أسماء تخالف المرجع الرسمي</span>
      <span class="tnum" style="background:#f1f5f9;border-radius:20px;padding:.05rem .55rem;font-weight:700;color:var(--muted)">${nameReview.rename.length + nameReview.review.length}</span>
      <span style="color:var(--faint);font-size:11px">من ${nameReview.registry_size} جهة في المرجع — إظهار / إخفاء</span></summary>
    <div style="margin-top:.5rem">${card(`
      ${nameReview.rename.length ? `<div style="font-size:11.5px;font-weight:800;color:var(--ink2);margin-bottom:.2rem">مؤكَّد — الاسم نفسه بصيغة أخرى</div>
        ${nameReview.rename.map((r) => nrRow(r, true)).join('')}` : ''}
      ${nameReview.review.length ? `<div style="font-size:11.5px;font-weight:800;color:var(--ink2);margin:.7rem 0 .2rem">للمراجعة — لا يُعتمَد بلا قرارك</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:.3rem">تشابهٌ لا يكفي دليلاً: قد تكون جهةً أخرى أو فرعاً مستقلاً.</div>
        ${nameReview.review.map((r) => nrRow(r, false)).join('')}` : ''}`)}</div></details>`
    : '';

  const body = `${toolbar}${strip}${chips}${dupBlock}${nameBlock}${relLegend}${table}${idleBlock}${ddTop5}`;
  return layout({ user, active: 'clients', title: G.clients, subtitle: `سجل العلاقات · ${countAr(rows.length, { one: 'عميل واحد', two: 'عميلان', few: 'عملاء', many: 'عميلاً' })}${rel ? ` · عرض «${rel}»` : ''}`, body, scripts: ['/static/pages/clients.js'] });
}

// ─────────────────────────────────────────────────────────────────────────────
// صفحة العميل 360 — التفاصيل
// ─────────────────────────────────────────────────────────────────────────────
export async function clientDetailPage(user, clientId) {
  let d;
  try { d = await clientOverview(user, clientId); } catch (e) {
    return layout({ user, active: 'clients', title: G.client, body: noticeCard('تعذّر عرض العميل', e.message, '/app/clients', 'العودة للعملاء') });
  }
  const c = d.client, k = d.kpis, fy = d.fiscal_year;
  const canContact = can(user, 'create', 'contact');
  const canDelContact = can(user, 'delete', 'contact');
  const canDocs = can(user, 'update', 'client');

  // ── الرأس ──
  const header = `
    <a href="/app/clients" style="font-size:12px;color:var(--muted)">← ${G.clients}</a>
    <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin:.55rem 0 1rem">
      <h2 style="font-size:18px;margin:0">${esc(c.name_ar)}</h2>
      ${c.type ? pill(esc(c.type), TYPE_TONE[c.type] || 'slate') : ''}
      ${pill(`${G.relationship}: ${k.relationship}`, REL_TONE[k.relationship] || 'slate')}
      <span style="font-size:12px;color:var(--muted)">${c.code ? `<bdi>${esc(c.code)}</bdi> · ` : ''}${G.lastActivity}: <span class="tnum">${k.last_activity_at ? relDay(k.last_activity_at) : 'لا تواصل مسجّل بعد'}</span></span>
    </div>`;

  // ── شريط المؤشرات (٥ بلاطات قابلة للنقر → تفصيل) ──
  const stat = (label, val, sub, o = {}) => card(`<div ${o.dd ? `role="button" tabindex="0" data-dd="${o.dd}"` : ''} style="padding:.75rem .95rem">
    <div style="font-size:11px;color:var(--muted)">${label}${o.dd ? ' <span style="color:var(--faint)">⊕</span>' : ''}</div>
    <div class="metric tnum" style="font-size:1.25rem;${o.tone ? 'color:' + o.tone : ''}">${val}</div>
    ${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`, o.dd ? 'cardclick card-h' : '');
  const kpiBand = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:.7rem;margin-bottom:1rem">
    ${stat(`إيراد ${fy}`, fmtSar(k.fy_revenue_halalas), `الإجمالي التاريخي ${sarShort(k.lifetime_revenue_halalas)}`, { dd: 'rev', tone: 'var(--green)' })}
    ${stat(G.pipeline, fmtSar(k.open_pipeline_halalas), countAr(d.opportunities.open.length, { one: 'فرصة واحدة مفتوحة', two: 'فرصتان مفتوحتان', few: 'فرص مفتوحة', many: 'فرصة مفتوحة' }), { dd: 'pipe' })}
    ${stat(G.weighted, fmtSar(k.weighted_pipeline_halalas), 'حسب احتمال الفوز', { dd: 'wpipe', tone: 'var(--brand2)' })}
    ${stat('مشاريع نشطة', k.active_projects, `من أصل ${countAr(d.projects.length, { one: 'مشروع واحد', two: 'مشروعين', few: 'مشاريع', many: 'مشروعاً' })}`, { dd: 'prj' })}
    ${stat(G.outstanding, fmtSar(k.open_ar_halalas), d.invoices_summary.overdue ? `منه ${G.overdue}: ${fmtSar(d.invoices_summary.overdue)}` : 'لا متأخرات', { dd: 'ar', tone: k.open_ar_halalas ? 'var(--amber)' : 'var(--ink2)' })}
  </div>`;

  // ── الخط الزمني (سجل التواصل + الأحداث المشتقة) ──
  const FORM_KINDS = [['call', 'اتصال'], ['meeting', 'اجتماع'], ['email', 'بريد'], ['visit', 'زيارة'], ['note', 'ملاحظة']];
  const actForm = `<div style="display:flex;gap:.45rem;flex-wrap:wrap;align-items:center;padding:.7rem .9rem;border-bottom:1px solid var(--line);background:var(--bg)">
    <select class="input" id="act-kind" aria-label="نوع النشاط" style="padding:.4rem .5rem">${FORM_KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <input class="input" id="act-title" style="flex:1;min-width:170px" placeholder="ماذا حدث؟ مثال: اجتماع مراجعة النطاق">
    <input class="input" id="act-detail" style="flex:1;min-width:150px" placeholder="تفاصيل (اختياري)">
    <button class="btn btn-primary btn-sm" data-action="act-save">تسجيل النشاط</button>
  </div>`;
  const feedItems = d.activities.map((a) => `<div style="display:flex;gap:.6rem;padding:.55rem 0;border-bottom:1px dashed var(--line)">
      ${aicon(a.kind)}
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:700;color:var(--ink2)">${esc(a.title)}</div>
        ${a.detail ? `<div style="font-size:11.5px;color:var(--muted)">${esc(a.detail)}</div>` : ''}
        <div style="font-size:10.5px;color:var(--faint)" class="tnum">${a.actor ? esc(a.actor) + ' · ' : ''}${relDay(a.at) || ''}${a.source === 'derived' ? ' · من سجلات المنصة' : ''}</div>
      </div></div>`).join('');
  const timelineCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:800;font-size:13.5px">${G.activities}</div><span style="font-size:10.5px;color:var(--muted)">${countAr(d.activities.length, { one: 'حدث واحد', two: 'حدثان', few: 'أحداث', many: 'حدثاً' })}</span></div>
    ${actForm}
    <div style="padding:.3rem 1rem .7rem;max-height:520px;overflow-y:auto">${feedItems || `<div class="empty-state">${icon('history')}<div class="t">لا تواصل مسجلاً بعد</div><div class="s">سجّل أول اتصال أو اجتماع من النموذج بالأعلى — يبني الخط الزمني ذاكرة العلاقة.</div></div>`}</div>`);

  // ── الفرص ──
  const wonValue = d.opportunities.won.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const openRows = d.opportunities.open.map((o) => `<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="location.href='/app/opportunity/${o.id}'">
    <td style="padding:.45rem .7rem;font-size:12.5px">${esc(o.title_ar)}${o.next_action ? `<div style="font-size:10.5px;color:var(--muted)">${G.nextAction}: ${esc(o.next_action)}</div>` : ''}</td>
    <td style="padding:.45rem .7rem;text-align:center;font-size:11.5px">${esc(o.stage_name_ar || o.stage_id || '—')}</td>
    <td style="padding:.45rem .7rem;text-align:left;font-weight:700;font-size:12.5px" class="tnum">${fmtSar(o.value_halalas)}</td>
    <td style="padding:.45rem .7rem;text-align:center;font-size:12px;color:var(--muted)" class="tnum">${Math.round(o.win_pct || 0)}%</td></tr>`).join('');
  const oppsCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.4rem">
      <div style="font-weight:800;font-size:13.5px">${G.opportunities}</div>
      <span style="font-size:11px;color:var(--muted)">${G.winLossHistory}: <b class="tnum" style="color:var(--ink2)">${G.winRate} ${d.opportunities.win_rate}%</b> · <span class="tnum">${d.opportunities.won.length}</span> ${G.won} (<span class="tnum">${sarShort(wonValue)}</span>) · <span class="tnum">${d.opportunities.lost.length}</span> ${G.lost}</span></div>
    <div class="tblwrap"><table style="width:100%;border-collapse:collapse;min-width:520px">
      <thead><tr>${th('الفرصة')}${th(G.stage, 'center')}${th(G.raw, 'left')}${th(G.probability, 'center')}</tr></thead>
      <tbody>${openRows || `<tr><td colspan="4" style="padding:1rem;color:var(--muted);font-size:12.5px">لا فرص مفتوحة على هذا العميل حالياً</td></tr>`}</tbody></table></div>`);

  // ── المشاريع والعقود ──
  const prjRows = d.projects.slice(0, 20).map((p) => `<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="location.href='/app/project/${p.id}'">
    <td style="padding:.45rem .7rem;font-size:12.5px"><a href="/app/project/${p.id}" style="font-weight:700;color:var(--ink2)">${esc(p.name_ar)}</a></td>
    <td style="padding:.45rem .7rem;text-align:center">${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : p.status === 'ON_HOLD' ? 'amber' : p.status === 'IN_PROGRESS' ? 'blue' : 'slate')}</td>
    <td style="padding:.45rem .7rem;text-align:left;font-size:12.5px" class="tnum">${p.value_halalas ? fmtSar(p.value_halalas) : '—'}</td>
    <td style="padding:.45rem .7rem;text-align:center;font-size:12px;color:var(--muted)" class="tnum">${Math.round(p.progress_effective_pct || 0)}%</td></tr>`).join('');
  const conRows = d.contracts.slice(0, 20).map((t) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.45rem .7rem;font-size:12.5px"><span style="font-weight:700;color:var(--ink2)">${t.code ? `<bdi>${esc(t.code)}</bdi>` : 'عقد'}</span>${t.project_name_ar ? `<div style="font-size:10.5px;color:var(--muted)">${esc(t.project_name_ar)}</div>` : ''}</td>
    <td style="padding:.45rem .7rem;text-align:left;font-size:12.5px;font-weight:700" class="tnum">${fmtSar(t.value_halalas)}</td>
    <td style="padding:.45rem .7rem;text-align:center">${pill(tr(t.status), t.status === 'ACTIVE' ? 'green' : t.status === 'COMPLETED' ? 'blue' : 'slate')}</td>
    <td style="padding:.45rem .7rem;text-align:center;font-size:11.5px;color:var(--muted)" class="tnum">${(t.signed_at || t.start_date || '—').toString().slice(0, 10)}</td></tr>`).join('');
  const workCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">${G.projects} والعقود</div>
    <div class="tblwrap"><table style="width:100%;border-collapse:collapse;min-width:520px">
      <thead><tr>${th(G.project)}${th('الحالة', 'center')}${th('القيمة', 'left')}${th(G.progress, 'center')}</tr></thead>
      <tbody>${prjRows || `<tr><td colspan="4" style="padding:.9rem;color:var(--muted);font-size:12.5px">لا مشاريع لهذا العميل بعد</td></tr>`}</tbody></table></div>
    <div style="padding:.6rem 1rem .2rem;font-weight:800;font-size:12.5px;border-top:1px solid var(--line)">العقود</div>
    <div class="tblwrap"><table style="width:100%;border-collapse:collapse;min-width:520px">
      <thead><tr>${th('العقد')}${th(G.contractValue, 'left')}${th('الحالة', 'center')}${th('التوقيع', 'center')}</tr></thead>
      <tbody>${conRows || `<tr><td colspan="4" style="padding:.9rem;color:var(--muted);font-size:12.5px">لا عقود مسجلة لهذا العميل</td></tr>`}</tbody></table></div>`);

  // ── جهات الاتصال ──
  const contactRows = d.contacts.map((p) => `<div style="display:flex;gap:.55rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px dashed var(--line)">
      <span class="kav" style="width:26px;height:26px;font-size:10px;flex:0 0 auto">${esc((p.name || '؟').trim().charAt(0))}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:700">${esc(p.name)}</div>
        ${p.title ? `<div style="font-size:11px;color:var(--muted)">${esc(p.title)}</div>` : ''}
        ${p.email || p.phone ? `<div style="font-size:10.5px;color:var(--faint);direction:ltr;text-align:left"><bdi>${esc([p.email, p.phone].filter(Boolean).join(' · '))}</bdi></div>` : ''}
      </div>
      ${canDelContact ? `<button class="btn btn-ghost btn-sm" data-action="contact-del" data-id="${p.id}" title="${G.delete}" aria-label="حذف جهة الاتصال">✕</button>` : ''}
    </div>`).join('');
  const contactForm = canContact ? `<div style="display:grid;gap:.4rem;margin-top:.6rem;border-top:1px solid var(--line);padding-top:.6rem">
      <input class="input" id="cf-name" placeholder="الاسم *">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem">
        <input class="input" id="cf-title" placeholder="المنصب">
        <input class="input" id="cf-phone" placeholder="الجوال" style="direction:ltr;text-align:right">
      </div>
      <input class="input" id="cf-email" placeholder="البريد الإلكتروني" style="direction:ltr;text-align:right">
      <button class="btn btn-primary btn-sm" data-action="contact-add" style="justify-self:start">${G.add}</button>
    </div>` : '';
  const contactsCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:800;font-size:13.5px">${G.contacts}</div><span style="font-size:10.5px;color:var(--muted)" class="tnum">${d.contacts.length}</span></div>
    <div style="padding:.3rem 1rem .8rem">
      ${contactRows || `<div class="empty-state" style="padding:1.1rem .5rem">${icon('users')}<div class="t">لا جهات اتصال</div><div class="s">أضف مسؤول العميل حتى يعرف الفريق مَن يخاطب.</div></div>`}
      ${contactForm}</div>`);

  // ── الإيراد والتحصيل ──
  const s = d.invoices_summary;
  const finRow = (l, v, tone) => `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:.7rem;padding:.35rem 0;border-bottom:1px dashed var(--line)">
    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--muted)">${l}</span>
    <span class="tnum" style="flex:0 0 auto;font-weight:800;font-size:12.5px;${tone ? 'color:' + tone : ''}">${fmtSar(v)}</span></div>`;
  const yoyItems = d.yoy.map((y, i) => ({ label: String(y.year), value: y.revenue_halalas, color: i === d.yoy.length - 1 ? '#834798' : '#244A99' }));
  const revCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">${G.revenue} والتحصيل</div>
    <div style="padding:.5rem 1rem .8rem">
      ${finRow(G.invoiced, s.invoiced)}
      ${finRow(G.collected, s.collected, 'var(--green)')}
      ${finRow(G.outstanding, s.outstanding, s.outstanding ? 'var(--amber)' : '')}
      ${finRow(G.overdue, s.overdue, s.overdue ? 'var(--red)' : '')}
      ${yoyItems.length ? `<div style="font-weight:800;font-size:11.5px;margin:.7rem 0 .45rem;color:var(--ink2)">الإيراد عبر السنوات</div>${hbars(yoyItems, { fmt: sarShort })}` : '<div style="font-size:11px;color:var(--faint);margin-top:.5rem">لا إيراد مسجلاً لهذا العميل بعد</div>'}
    </div>`);

  // ── المستندات ──
  const docRows = d.documents.map((doc) => `<div style="display:flex;gap:.5rem;align-items:flex-start;padding:.45rem 0;border-bottom:1px dashed var(--line)">
      ${aicon(doc.kind === 'contract' ? 'contract_signed' : 'proposal')}
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.url ? `<a href="${esc(doc.url)}" target="_blank" rel="noopener" style="color:var(--brand)">${esc(doc.name)}</a>` : esc(doc.name)}</div>
        <div style="font-size:10.5px;color:var(--faint)" class="tnum">${DOC_KIND_AR[doc.kind] || 'أخرى'}${doc.uploaded_by ? ' · ' + esc(doc.uploaded_by) : ''} · ${relDay(doc.created_at) || ''}</div>
      </div></div>`).join('');
  const docForm = canDocs ? `<div style="display:grid;gap:.4rem;margin-top:.6rem;border-top:1px solid var(--line);padding-top:.6rem">
      <input class="input" id="dc-name" placeholder="اسم المستند *">
      <input class="input" id="dc-url" placeholder="https://…" style="direction:ltr;text-align:left">
      <div style="display:flex;gap:.4rem">
        <select class="input" id="dc-kind" style="flex:1">${Object.entries(DOC_KIND_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" data-action="doc-add">${G.add}</button>
      </div></div>` : '';
  const docsCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:800;font-size:13.5px">المستندات</div><span style="font-size:10.5px;color:var(--muted)" class="tnum">${d.documents.length}</span></div>
    <div style="padding:.3rem 1rem .8rem">
      ${docRows || `<div style="font-size:11.5px;color:var(--faint);padding:.5rem 0">لا مستندات — أضف رابط العقد أو العرض ليجدها الفريق هنا.</div>`}
      ${docForm}</div>`);

  // ── قيمة العميل ──
  const conc = d.concentration_pct || 0;
  const valueCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">${G.clientValue}</div>
    <div style="padding:.6rem 1rem .85rem">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)"><span>${G.concentration} من إيراد الشركة ${fy}</span><b class="tnum" style="color:${conc >= 30 ? 'var(--amber)' : 'var(--ink2)'}">${conc}%</b></div>
      <div class="bar" style="margin:.35rem 0 .7rem;height:7px"><span style="width:${Math.min(100, conc)}%;background:${conc >= 30 ? 'var(--amber)' : 'var(--brand)'}"></span></div>
      ${finRow(`إيراد ${fy}`, k.fy_revenue_halalas, 'var(--green)')}
      ${finRow('الإيراد التاريخي الإجمالي', k.lifetime_revenue_halalas)}
      ${conc >= 30 ? `<div style="margin-top:.5rem;font-size:10.5px;color:var(--amber);line-height:1.6">تركّز مرتفع — خسارة هذا العميل تؤثر جوهرياً على إيراد السنة.</div>` : ''}
    </div>`);

  // ── قوالب التفصيل (drill-down) ──
  const dd = `
  ${ddWrap('rev', `إيراد العميل ${fy}`, esc(c.name_ar), `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--green)">${fmtSar(k.fy_revenue_halalas)}</span><span style="font-size:12px;color:var(--muted)">${G.concentration} ${conc}% من إيراد الشركة</span></div>
    <div class="dd-sec">حسب المشروع</div>
    <div>${ddRows(d.fy_revenue_by_project.map((r) => `<div class="dd-row"><span>${esc(r.name_ar)}</span><b class="tnum">${fmtSar(r.revenue_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('pipe', G.pipeline, `${esc(c.name_ar)} · ${d.opportunities.open.length} فرصة مفتوحة`, `
    <div class="dd-kpi"><span class="v tnum">${fmtSar(k.open_pipeline_halalas)}</span><span style="font-size:12px;color:var(--muted)">${G.raw}</span></div>
    <div>${ddRows(d.opportunities.open.map((o) => `<div class="dd-row"><span>${esc(o.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(o.stage_name_ar || '')}</span></span><b class="tnum">${fmtSar(o.value_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('wpipe', G.weighted, `${esc(c.name_ar)} · القيمة × احتمال الفوز`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--brand2)">${fmtSar(k.weighted_pipeline_halalas)}</span></div>
    <div>${ddRows(d.opportunities.open.map((o) => `<div class="dd-row"><span>${esc(o.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${Math.round(o.win_pct || 0)}% من ${fmtSar(o.value_halalas)}</span></span><b class="tnum">${fmtSar(Math.round((o.value_halalas || 0) * ((o.win_pct || 0) / 100)))}</b></div>`))}</div>`)}
  ${ddWrap('prj', 'المشاريع النشطة', esc(c.name_ar), `
    <div class="dd-kpi"><span class="v tnum">${k.active_projects}</span><span style="font-size:12px;color:var(--muted)">قيد التنفيذ الآن</span></div>
    <div>${ddRows(d.projects.filter((p) => p.status === 'IN_PROGRESS').map((p) => `<div class="dd-row"><span>${esc(p.name_ar)}<span style="color:var(--faint);font-size:10.5px"> · إنجاز ${Math.round(p.progress_effective_pct || 0)}%</span></span><b class="tnum">${p.value_halalas ? fmtSar(p.value_halalas) : '—'}</b></div>`))}</div>`)}
  ${ddWrap('ar', G.outstanding, `${esc(c.name_ar)} · فواتير غير محصلة`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--amber)">${fmtSar(k.open_ar_halalas)}</span><span style="font-size:12px;color:var(--muted)">${G.overdue}: ${fmtSar(s.overdue)}</span></div>
    <div>${ddRows(d.invoices.filter((i) => (i.amount_halalas || 0) - Math.min(i.collected_halalas || 0, i.amount_halalas || 0) > 0).map((i) => {
    const out = (i.amount_halalas || 0) - Math.min(i.collected_halalas || 0, i.amount_halalas || 0);
    return `<div class="dd-row"><span>${i.code ? `فاتورة <bdi>${esc(i.code)}</bdi>` : 'فاتورة'}<span style="color:var(--faint);font-size:10.5px"> · ${(i.issue_date || '').toString().slice(0, 10) || 'بلا تاريخ'} · ${tr(i.status)}</span></span><b class="tnum">${fmtSar(out)}</b></div>`;
  }))}</div>`)}`;

  // ── «مَن منّا يشتغل معهم وعلى ماذا» — العمل موزَّعاً على قطاعاتنا ─────────────
  // قرار المالك: الجهة تبقى **عميلاً واحداً** باسمها الصحيح مهما تعدّدت قطاعاتنا العاملة
  // معها، ويظهر التقسيم هنا لا في سجل العملاء. تقسيمه إلى عميلين يكسر هويّته ويشطر تركّزه
  // وأعمار ديونه؛ وعرضه هنا يجيب السؤال نفسه بلا كسر شيء.
  const secRow = (s) => {
    const projs = s.project_names.slice(0, 6);
    const more = s.project_names.length - projs.length;
    const chip = (p) => `<a href="/app/project/${esc(p.id)}" class="pill" style="text-decoration:none;font-size:11px;${p.active ? '' : 'opacity:.62'}">
        ${esc(p.name_ar)}${p.active && p.progress_effective_pct != null ? ` <span class="tnum" style="color:var(--faint)">${p.progress_effective_pct}%</span>` : ''}</a>`;
    const facts = [
      s.active_projects ? `<b class="tnum">${s.active_projects}</b> مشروع جارٍ` : null,
      s.projects > s.active_projects ? `<span class="tnum">${s.projects - s.active_projects}</span> منتهٍ` : null,
      s.open_opps ? `<b class="tnum">${s.open_opps}</b> فرصة مفتوحة · ${fmtSar(s.open_value_halalas)}` : null,
      s.won_opps ? `<span class="tnum">${s.won_opps}</span> فوز` : null,
    ].filter(Boolean);
    return `<div style="padding:.65rem 0;border-bottom:1px dashed var(--line)">
      <div style="display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap">
        <b style="font-size:13px;color:var(--ink2)">${esc(s.name_ar)}</b>
        <span style="font-size:11.5px;color:var(--muted)">${facts.join(' · ') || 'لا عمل مسجَّل بعد'}</span>
      </div>
      ${projs.length ? `<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.4rem">${projs.map(chip).join('')}${more > 0 ? `<span style="font-size:11px;color:var(--faint);align-self:center">و${more} غيرها</span>` : ''}</div>` : ''}
    </div>`;
  };
  const sectorsCard = card(`<div style="padding:.75rem .9rem .2rem">
    <div style="font-weight:800;font-size:13px;color:var(--ink2)">قطاعاتنا العاملة مع هذه الجهة</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:.3rem">الجهة عميل واحد باسمها؛ وهذا توزيع عملنا معها على قطاعاتنا.</div>
    ${(d.by_sector || []).length
    ? (d.by_sector || []).map(secRow).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:.5rem 0">لا مشاريع ولا فرص مسجَّلة على هذه الجهة بعد.</div>'}
  </div>`);

  const body = `${header}${kpiBand}
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:.9rem;align-items:start">
      <div style="display:flex;flex-direction:column;gap:.9rem;min-width:0">${sectorsCard}${timelineCard}${oppsCard}${workCard}</div>
      <div style="display:flex;flex-direction:column;gap:.9rem;min-width:0">${contactsCard}${revCard}${docsCard}${valueCard}</div>
    </div>
    ${dd}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{clientId:${JSON.stringify(c.id).replace(/</g, '\\u003c')}});</script>`;
  return layout({ user, active: 'clients', title: c.name_ar, subtitle: `${G.client} 360°`, body, scripts: ['/static/pages/clients.js'] });
}
