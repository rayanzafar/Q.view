// Clients pages: العملاء (portfolio list) + client 360 detail — decision-story order:
// who is the client → how healthy is the relationship → what money moves → what to do next.
import { layout, card, pill, tr, hbars } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { get } from '../../core/db/index.js';
import { config } from '../../core/config.js';
import { can } from '../../core/rbac/index.js';
import { G } from '../i18n/glossary.js';
import { listClients, clientOverview, CLIENT_TYPES } from '../../modules/clients/clients.js';
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
  const sort = ['pipeline', 'activity'].includes(opts.sort) ? opts.sort : 'revenue';
  const fy = config.fiscalYear;
  const rows = await listClients(user, { query, type, sort });
  const canCreate = can(user, 'create', 'client');

  // preserve current filters in every chip/link (الافتراضي: أكبر العلاقات أولاً = revenue)
  const qs = (patch = {}) => {
    const p = new URLSearchParams();
    const v = { query, type, sort, ...patch };
    if (v.query) p.set('query', v.query);
    if (v.type) p.set('type', v.type);
    if (v.sort && v.sort !== 'revenue') p.set('sort', v.sort);
    const s = p.toString();
    return '/app/clients' + (s ? '?' + s : '');
  };

  // ── الشريط التحليلي: عدد العملاء · تركّز أعلى ٥ · العميل الأول · معدل الفوز · نمو الإيراد ──
  const relCount = { 'نشطة': 0, 'فاترة': 0, 'خاملة': 0 };
  for (const r of rows) relCount[r.relationship] = (relCount[r.relationship] || 0) + 1;
  const companyFy = (await get('SELECT COALESCE(SUM(amount_halalas),0) v FROM revenue_line WHERE year = ?', [fy]))?.v || 0;
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

  // معدل الفوز الإجمالي على العملاء الظاهرين (الفوز التاريخي المستورد خارج الحسبة)
  const sumWon = rows.reduce((a, r) => a + (r.won_count || 0), 0);
  const sumLost = rows.reduce((a, r) => a + (r.lost_count || 0), 0);
  const winRate = sumWon + sumLost ? Math.round((sumWon / (sumWon + sumLost)) * 100) : null;

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
    ${statMini('معدل الفوز الإجمالي', winRate != null ? winRate + '%' : '—',
    winRate != null ? `${sumWon} ${G.won} · ${sumLost} ${G.lost}` : 'لا فرص محسومة بعد',
    winRate == null ? '' : winRate >= 50 ? 'good' : winRate < 30 ? 'warn' : '')}
    ${growthStat}</div>`;

  const chips = `<div class="chips"><span class="lbl">النوع:</span>
    <a href="${qs({ type: '' })}" class="chip ${type ? '' : 'on'}">${G.all}</a>
    ${CLIENT_TYPES.map((t) => `<a href="${qs({ type: t })}" class="chip ${type === t ? 'on' : ''}">${t}</a>`).join('')}
  </div>`;

  const sortOpts = [['revenue', `إيراد ${fy}`], ['pipeline', G.pipeline], ['activity', G.lastActivity]];
  const toolbar = `<div class="toolbar">
    <form method="get" action="/app/clients" id="cl-form" style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
      <div class="search">${icon('search')}<input class="input" id="cl-q" name="query" value="${esc(query)}" aria-label="${G.search} في العملاء" placeholder="ابحث بالاسم أو الكود…"></div>
      ${type ? `<input type="hidden" name="type" value="${esc(type)}">` : ''}
      <label style="display:flex;align-items:center;gap:.35rem;font-size:12px;color:var(--muted)">ترتيب حسب
        <select class="input" id="cl-sort" name="sort" style="padding:.35rem .5rem">${sortOpts.map(([v, l]) => `<option value="${v}" ${sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </form>
    <div class="spacer"></div>
    ${canCreate ? `<button class="btn btn-primary" data-action="client-add">${icon('plus')} عميل جديد</button>` : ''}
  </div>`;

  // ── خلايا الجدول ──
  const dash = '<span style="color:var(--faint)">—</span>';
  const secChips = (r) => {
    const secs = r.sectors || [];
    if (!secs.length) return dash;
    const shown = secs.slice(0, 2);
    const extra = secs.length - shown.length;
    return `<div style="display:flex;gap:.25rem;flex-wrap:wrap;justify-content:center" title="${esc(secs.join(' · '))}">
      ${shown.map((s) => `<span style="font-size:10px;font-weight:700;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:.12rem .45rem;white-space:nowrap;color:var(--muted)">${esc(s)}</span>`).join('')}
      ${extra > 0 ? `<span class="tnum" style="font-size:10px;font-weight:800;color:var(--faint);align-self:center">+${extra}</span>` : ''}</div>`;
  };
  const oppsCell = (r) => (r.open_opps
    ? `<div style="font-size:12.5px;font-weight:700" class="tnum">${oppCountAr(r.open_opps)}</div>
       <div style="font-size:10px;color:var(--muted);font-weight:400" class="tnum">إجمالي ${sarShort(r.open_pipeline_halalas)}</div>
       <div style="font-size:10px;color:var(--brand2);font-weight:400" class="tnum">مرجّح ${sarShort(r.weighted_pipeline_halalas)}</div>`
    : dash);
  const winLossCell = (r) => {
    const parts = [];
    if (r.won_count) parts.push(`<div style="color:var(--green);font-weight:700;font-size:11.5px" class="tnum">${r.won_count} فوز بقيمة ${sarShort(r.won_value_halalas)}</div>`);
    if (r.lost_count) parts.push(`<div style="color:var(--muted);font-size:11px" class="tnum">${r.lost_count} خسارة</div>`);
    if (r.hist_won_count) parts.push(`<div style="color:var(--faint);font-size:10px" class="tnum">+${r.hist_won_count} تاريخي</div>`);
    return parts.join('') || dash;
  };
  const arCell = (r) => (r.open_ar_halalas > 0
    ? `<div class="tnum" style="font-weight:800;font-size:12.5px;color:${r.overdue_ar_halalas > 0 ? 'var(--red)' : 'var(--ink2)'}">${fmtSar(r.open_ar_halalas)}</div>
       ${r.overdue_ar_halalas >= r.open_ar_halalas && r.overdue_ar_halalas > 0 ? `<div style="font-size:10px;color:var(--red)">${G.overdue} بالكامل</div>`
    : r.overdue_ar_halalas > 0 ? `<div style="font-size:10px;color:var(--red)" class="tnum">منه ${G.overdue} ${sarShort(r.overdue_ar_halalas)}</div>` : ''}`
    : dash);
  const money = (v) => (v ? `<span class="tnum" style="font-weight:700;font-size:12.5px">${fmtSar(v)}</span>` : dash);

  const rowsHtml = rows.map((r) => `<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="location.href='/app/client/${r.id}'">
    <td style="padding:.55rem .5rem;min-width:140px">
      <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
        <a href="/app/client/${r.id}" style="font-size:13px;font-weight:700;color:var(--ink2)">${esc(r.name_ar)}</a>
        ${r.type ? pill(esc(r.type), TYPE_TONE[r.type] || 'slate') : ''}
      </div>
      ${r.code ? `<div style="font-size:10.5px;color:var(--faint)"><bdi>${esc(r.code)}</bdi></div>` : ''}</td>
    <td style="padding:.55rem .5rem;text-align:center">${secChips(r)}</td>
    <td style="padding:.55rem .5rem;text-align:center;font-size:12px;color:var(--ink2)">${r.rel_owner ? `<span style="display:inline-block;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle" title="${esc(r.rel_owner)}">${esc(r.rel_owner)}</span>` : dash}</td>
    <td style="padding:.55rem .5rem;text-align:center">${pill(r.relationship, REL_TONE[r.relationship] || 'slate')}</td>
    <td style="padding:.55rem .5rem;text-align:center;font-size:12px;color:var(--muted);white-space:nowrap" class="tnum">${r.last_activity_at ? relDay(r.last_activity_at) : '<span style="color:var(--faint)">لا تواصل مسجل</span>'}</td>
    <td style="padding:.55rem .5rem;text-align:left;white-space:nowrap">${oppsCell(r)}</td>
    <td style="padding:.55rem .5rem;text-align:right;white-space:nowrap">${winLossCell(r)}</td>
    <td style="padding:.55rem .5rem;text-align:center;font-size:12.5px" class="tnum">${r.active_projects || dash}</td>
    <td style="padding:.55rem .5rem;text-align:left;white-space:nowrap">${money(r.contracts_value_halalas)}</td>
    <td style="padding:.55rem .5rem;text-align:left;white-space:nowrap">${money(r.fy_revenue_halalas)}</td>
    <td style="padding:.55rem .5rem;text-align:left;white-space:nowrap">${arCell(r)}</td>
  </tr>`).join('');

  const emptyState = `<div class="empty-state">${icon('client')}
    <div class="t">${query || type ? 'لا نتائج مطابقة' : 'لا عملاء بعد'}</div>
    <div class="s">${query || type ? 'جرّب تعديل كلمة البحث أو إزالة تصفية النوع.' : 'ابدأ ببناء سجل عملائك — كل فرصة وعقد ومشروع سيرتبط بعميله تلقائياً.'}</div>
    ${canCreate && !query && !type ? `<button class="btn btn-primary" data-action="client-add">${icon('plus')} عميل جديد</button>` : ''}</div>`;

  const table = card(`<div class="tblwrap"><table style="width:100%;border-collapse:collapse;min-width:1100px">
    <thead><tr>${th(G.client)}${th('القطاعات', 'center')}${th(G.relOwner, 'center')}${th(G.relationship, 'center')}${th(G.lastActivity, 'center')}${th(G.opportunities, 'left')}${th('الفوز · الخسارة')}${th('مشاريع نشطة', 'center')}${th('قيمة العقود', 'left')}${th(`إيراد ${fy}`, 'left')}${th(G.outstanding, 'left')}</tr></thead>
    <tbody>${rowsHtml}</tbody></table>${rows.length ? '' : emptyState}</div>`);

  const body = `${toolbar}${strip}${chips}${table}${ddTop5}`;
  return layout({ user, active: 'clients', title: G.clients, subtitle: `سجل العلاقات · ${rows.length} عميل`, body, scripts: ['/static/pages/clients.js'] });
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
      <span style="font-size:12px;color:var(--muted)">${c.code ? `<bdi>${esc(c.code)}</bdi> · ` : ''}${G.lastActivity}: <span class="tnum">${k.last_activity_at ? relDay(k.last_activity_at) : 'لا تواصل مسجل'}</span></span>
    </div>`;

  // ── شريط المؤشرات (٥ بلاطات قابلة للنقر → تفصيل) ──
  const stat = (label, val, sub, o = {}) => card(`<div ${o.dd ? `role="button" tabindex="0" data-dd="${o.dd}"` : ''} style="padding:.75rem .95rem">
    <div style="font-size:11px;color:var(--muted)">${label}${o.dd ? ' <span style="color:var(--faint)">⊕</span>' : ''}</div>
    <div class="metric tnum" style="font-size:1.25rem;${o.tone ? 'color:' + o.tone : ''}">${val}</div>
    ${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`, o.dd ? 'cardclick card-h' : '');
  const kpiBand = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:.7rem;margin-bottom:1rem">
    ${stat(`إيراد ${fy}`, fmtSar(k.fy_revenue_halalas), `الإجمالي التاريخي ${sarShort(k.lifetime_revenue_halalas)}`, { dd: 'rev', tone: 'var(--green)' })}
    ${stat(G.pipeline, fmtSar(k.open_pipeline_halalas), `${d.opportunities.open.length} فرصة مفتوحة`, { dd: 'pipe' })}
    ${stat(G.weighted, fmtSar(k.weighted_pipeline_halalas), 'حسب احتمال الفوز', { dd: 'wpipe', tone: 'var(--brand2)' })}
    ${stat('مشاريع نشطة', k.active_projects, `من أصل ${d.projects.length} مشروع`, { dd: 'prj' })}
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
      <div style="font-weight:800;font-size:13.5px">${G.activities}</div><span style="font-size:10.5px;color:var(--muted)">${d.activities.length} حدث</span></div>
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
    <td style="padding:.45rem .7rem;text-align:center;font-size:12px;color:var(--muted)" class="tnum">${Math.round(p.progress_pct || 0)}%</td></tr>`).join('');
  const conRows = d.contracts.slice(0, 20).map((t) => `<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="location.href='/app/contract/${t.id}'">
    <td style="padding:.45rem .7rem;font-size:12.5px"><a href="/app/contract/${t.id}" style="font-weight:700;color:var(--ink2)">${t.code ? `<bdi>${esc(t.code)}</bdi>` : 'عقد'}</a>${t.project_name_ar ? `<div style="font-size:10.5px;color:var(--muted)">${esc(t.project_name_ar)}</div>` : ''}</td>
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
    <div>${ddRows(d.projects.filter((p) => p.status === 'IN_PROGRESS').map((p) => `<div class="dd-row"><span>${esc(p.name_ar)}<span style="color:var(--faint);font-size:10.5px"> · إنجاز ${Math.round(p.progress_pct || 0)}%</span></span><b class="tnum">${p.value_halalas ? fmtSar(p.value_halalas) : '—'}</b></div>`))}</div>`)}
  ${ddWrap('ar', G.outstanding, `${esc(c.name_ar)} · فواتير غير محصلة`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--amber)">${fmtSar(k.open_ar_halalas)}</span><span style="font-size:12px;color:var(--muted)">${G.overdue}: ${fmtSar(s.overdue)}</span></div>
    <div>${ddRows(d.invoices.filter((i) => (i.amount_halalas || 0) - Math.min(i.collected_halalas || 0, i.amount_halalas || 0) > 0).map((i) => {
    const out = (i.amount_halalas || 0) - Math.min(i.collected_halalas || 0, i.amount_halalas || 0);
    return `<div class="dd-row"><span>${i.code ? `فاتورة <bdi>${esc(i.code)}</bdi>` : 'فاتورة'}<span style="color:var(--faint);font-size:10.5px"> · ${(i.issue_date || '').toString().slice(0, 10) || 'بلا تاريخ'} · ${tr(i.status)}</span></span><b class="tnum">${fmtSar(out)}</b></div>`;
  }))}</div>`)}`;

  const body = `${header}${kpiBand}
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:.9rem;align-items:start">
      <div style="display:flex;flex-direction:column;gap:.9rem;min-width:0">${timelineCard}${oppsCard}${workCard}</div>
      <div style="display:flex;flex-direction:column;gap:.9rem;min-width:0">${contactsCard}${revCard}${docsCard}${valueCard}</div>
    </div>
    ${dd}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{clientId:${JSON.stringify(c.id).replace(/</g, '\\u003c')}});</script>`;
  return layout({ user, active: 'clients', title: esc(c.name_ar), subtitle: `${G.client} 360°`, body, scripts: ['/static/pages/clients.js'] });
}
