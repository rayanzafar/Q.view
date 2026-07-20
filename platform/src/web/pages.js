import { layout, card, pill, miniBars, tr, gauge, hbars, utilStrip } from './layout.js';
import { icon } from './icons.js';
import { fmtSar } from '../core/util/ids.js';
import { all, get } from '../core/db/index.js';
import { companyOverview, sectorDashboard, projectKpis, multiYearTrend, winRate,
  quarterlyRevenue, quarterlyBookings, backlog, pipelineCoverage, bookToBill, grossMargin,
  sectorStaffing, sectorClients, sectorWins } from '../core/reports/metrics.js';
import { config } from '../core/config.js';

const sarShort = (halalas) => {
  const v = (halalas || 0) / 100;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + 'K';
  return String(Math.round(v));
};
import { listOpportunities, pipelineSummary } from '../modules/crm/opportunities.js';
import { listProjects } from '../modules/pmo/projects.js';
import { myTasks } from '../modules/pmo/tasks.js';
import { myEntries } from '../modules/timesheets/timesheets.js';
import { myApprovalQueue } from '../modules/workflow/engine.js';
import { orgTree, staffingRoster } from '../modules/org/org.js';
import { financeSummary, financeByPM, financeByContract, financeByClient, contractDetail } from '../modules/finance/finance.js';
import { canSeeSensitive, redact, can } from '../core/rbac/index.js';

const pct = (n) => `${Math.round(n || 0)}%`;
// HTML-escape user-controlled strings before interpolating into SSR markup (defense against stored XSS
// now that intake/manual entry accept free-text names, clients, notes).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bar = (p, color = '#2563eb') => `<div class="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
  <div style="width:${Math.min(100, Math.max(0, p))}%;background:${color}" class="h-full rounded-full"></div></div>`;

// ── Shared drill-down modal helpers (CEO dashboard + sector command center) ──
// Popups are pre-rendered inert <template>s opened by Sanad.openDD — server-computed under the
// SAME RBAC scope as the page, so nothing redacted can leak client-side.
const ddWrap = (id, title, sub, inner) => `<template id="dd-${id}">
  <div class="modal-head"><div><div style="font-weight:800;font-size:15px">${title}</div><div style="font-size:11.5px;color:var(--muted)">${sub}</div></div>
    <button class="btn btn-ghost btn-sm" onclick="Sanad.closeModal()" aria-label="إغلاق">✕</button></div>
  <div class="modal-body">${inner}</div></template>`;
const attain = (v, tgt, color) => tgt ? `
  <div><div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:.3rem"><span>الهدف ${fmtSar(tgt)}</span><span class="tnum" style="font-weight:800">${Math.round((v / tgt) * 100)}%</span></div>
  <div class="bar" style="height:8px"><span style="width:${Math.min(100, Math.round((v / tgt) * 100))}%;background:${color}"></span></div></div>` : '';
const ddRows = (rows) => rows.length ? rows.join('') : '<div style="color:var(--faint);font-size:12px">لا بيانات ضمن هذا النطاق</div>';

export function loginPage(err) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>دخول — سند</title>
<script src="/static/tailwind.js"></script></head>
<body class="min-h-screen flex items-center justify-center p-4" style="background:linear-gradient(168deg,#11295c,#1c2a63 42%,#3a1660);font-family:'Segoe UI',Tahoma,sans-serif">
<form method="post" action="/auth/login-web" class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
  <div class="text-center mb-6">
    <div class="text-2xl font-extrabold" style="background:linear-gradient(120deg,#2563eb,#9333ea);-webkit-background-clip:text;background-clip:text;color:transparent">EVC · سند</div>
    <div class="text-sm font-bold text-slate-700 mt-2">منصة إدارة الأعمال المؤسسية</div>
    <div class="text-xs text-slate-400 mt-0.5">رؤية الخبراء الاستشارية</div>
  </div>
  ${err ? `<div class="text-xs text-red-600 mb-3 text-center bg-red-50 rounded-lg py-2">${err}</div>` : ''}
  <label class="block text-xs text-slate-500 mb-1">اسم المستخدم</label>
  <input name="username" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 mb-3 text-sm" placeholder="firstname.lastname" autofocus>
  <label class="block text-xs text-slate-500 mb-1">كلمة المرور</label>
  <input name="password" type="password" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 mb-4 text-sm">
  <button class="w-full py-2.5 rounded-lg text-white font-semibold text-sm" style="background:linear-gradient(120deg,#2563eb,#9333ea)">دخول</button>
</form></body></html>`;
}

export async function ceoPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const ov = await companyOverview(user, { year });
  // Owner flexibility: ?sector=ID filters the ENTIRE dashboard to one sector (chips below switch it);
  // every metric call takes the same scope (null = whole company), so the view stays coherent.
  const sec = opts.sector && ov.sectors.some((s) => s.id === opts.sector) ? opts.sector : null;
  const secObj = sec ? ov.sectors.find((s) => s.id === sec) : null;
  const scopeLabel = sec ? secObj.name_ar : 'الشركة كاملة';
  const t = sec
    ? { revenue: secObj.revenue_halalas, target_revenue: secObj.target_revenue_halalas,
        sales: secObj.sales_halalas, target_sales: secObj.target_sales_halalas }
    : ov.totals;
  const wr = await winRate(sec, year);
  const trend = await multiYearTrend(sec, 4);
  const qRev = await quarterlyRevenue(sec, year);
  const qBook = await quarterlyBookings(sec, year);
  const bk = await backlog(sec);
  const cov = await pipelineCoverage(sec, year);
  const b2b = await bookToBill(sec, year);
  const pipelineVal = sec
    ? (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
        WHERE st.is_won=0 AND st.is_lost=0 AND o.deleted_at IS NULL AND o.sector_id=?`, [sec])).v
    : ov.pipeline_halalas;
  // ── Drill-down datasets (KPI popups). Same filter as the page; embedded as inert <template>s. ──
  const spO = sec ? 'AND o.sector_id = ?' : '';
  const revLines = await all(`SELECT rl.amount_halalas, rl.month, rl.label, p.name_ar project, s.name_ar sector
     FROM revenue_line rl LEFT JOIN project p ON p.id=rl.project_id LEFT JOIN sector s ON s.id=rl.sector_id
     WHERE rl.year=? ${sec ? 'AND rl.sector_id = ?' : ''} ORDER BY rl.amount_halalas DESC LIMIT 8`, sec ? [year, sec] : [year]);
  const wonDeals = await all(`SELECT o.title_ar, o.value_halalas, c.name_ar client, s.name_ar sector
     FROM opportunity o JOIN stage st ON st.id=o.stage_id LEFT JOIN client c ON c.id=o.client_id LEFT JOIN sector s ON s.id=o.sector_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? AND o.deleted_at IS NULL ${spO}
     ORDER BY o.value_halalas DESC LIMIT 8`, sec ? [year, sec] : [year]);
  const pipeStages = await all(`SELECT st.id, st.name_ar, st.color, COUNT(*) n, COALESCE(SUM(o.value_halalas),0) v
     FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=0 AND st.is_lost=0 AND o.deleted_at IS NULL ${spO}
     GROUP BY st.id, st.name_ar, st.color, st.sort_order ORDER BY st.sort_order`, sec ? [sec] : []);
  const topContracts = await all(`SELECT c.code, c.value_halalas, cl.name_ar client, s.name_ar sector
     FROM contract c LEFT JOIN client cl ON cl.id=c.client_id LEFT JOIN sector s ON s.id=c.sector_id
     WHERE c.deleted_at IS NULL ${sec ? 'AND c.sector_id = ?' : ''} ORDER BY c.value_halalas DESC LIMIT 6`, sec ? [sec] : []);
  // Bookings reconciliation: the annual figure (won in THIS fiscal year, vs the annual target) vs the
  // cumulative book (all won deals ever — what the legacy platform showed as one headline number).
  const bookAll = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v, COUNT(*) n FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.deleted_at IS NULL ${spO}`, sec ? [sec] : []));
  const bookByYear = await all(`SELECT o.year, COALESCE(SUM(o.value_halalas),0) v, COUNT(*) n FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.deleted_at IS NULL ${spO} GROUP BY o.year ORDER BY o.year`, sec ? [sec] : []);
  const margins = ov.canSeeMargin
    ? await Promise.all(ov.sectors.map(async (s) => ({ id: s.id, name_ar: s.name_ar, color: s.color, margin: (await grossMargin(s.id, year)).margin_pct })))
    : [];
  const marginVals = margins.filter((m) => m.margin != null);
  const avgMargin = marginVals.length ? Math.round(marginVals.reduce((a, m) => a + m.margin, 0) / marginVals.length) : null;
  const revYoy = trend.length >= 2 ? (() => { const cur = trend[trend.length - 1].revenue_halalas, prev = trend[trend.length - 2].revenue_halalas; return prev ? Math.round((cur - prev) / prev * 100) : null; })() : null;
  const bookYoy = trend.length >= 2 ? (() => { const cur = trend[trend.length - 1].contracts_halalas, prev = trend[trend.length - 2].contracts_halalas; return prev ? Math.round((cur - prev) / prev * 100) : null; })() : null;
  const yoyBadge = (v) => v == null ? '' : `<span style="font-size:11px;font-weight:700;color:${v >= 0 ? '#34d399' : '#fca5a5'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}% سنويًا</span>`;
  // Book-to-Bill risk banner (Tier-1 insight): bookings vs revenue recognition.
  const riskBanner = (b2b.ratio != null && b2b.ratio < 1) ? `
    <div style="border-radius:12px;padding:.85rem 1.1rem;margin-bottom:1rem;background:linear-gradient(90deg,#7f1d1d,#b91c1c);color:#fff;display:flex;align-items:center;gap:.75rem">
      <span style="font-size:20px">⚠</span>
      <div style="flex:1"><b>تنبيه استراتيجي — نسبة الحجز إلى الفوترة ${b2b.ratio}×</b>
      <div style="font-size:12px;opacity:.9">الحجوزات الجديدة (${fmtSar(b2b.bookings_halalas)}) أقل من الإيراد المحقق (${fmtSar(b2b.revenue_halalas)}) لعام ${year} — الشركة تستهلك الأعمال المتعاقدة أسرع من تعويضها. يلزم تكثيف تطوير الأعمال.</div></div>
    </div>` : '';
  const revPct = t.target_revenue ? t.revenue / t.target_revenue * 100 : 0;
  const salesPct = t.target_sales ? t.sales / t.target_sales * 100 : 0;
  // Hero KPI block — clickable: opens the matching drill-down popup (keyboard accessible).
  const heroBlock = (label, val, target, p, color, extra, dd) => `
    <div class="hclick" role="button" tabindex="0" aria-label="${label} — انقر للتفاصيل"
      onclick="Sanad.openDD('${dd}')" onkeydown="if(event.key==='Enter'||event.key===' ')Sanad.openDD('${dd}')"
      style="display:flex;align-items:center;gap:1.15rem;flex:1;min-width:290px;padding:.5rem .65rem;margin:-.5rem -.65rem">
      <div style="flex:0 0 auto">${gauge(p, { color, size: 118, sw: 11, center: pct(p), centerSize: 25, sub: 'من الهدف' })}</div>
      <div style="min-width:0">
        <div style="color:rgba(255,255,255,.72);font-size:12.5px;font-weight:600">${label}</div>
        <div class="metric tnum" style="color:#fff;margin-top:.2rem;font-size:1.85rem">${fmtSar(val)}</div>
        <div style="color:rgba(255,255,255,.55);font-size:11.5px" class="tnum">الهدف ${fmtSar(target)}</div>
        <div style="margin-top:.45rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">${extra || ''}<span class="dd-hint">⊕ التفاصيل</span></div>
      </div>
    </div>`;
  // Per-sector cards. Each card carries its own actions: filter THIS dashboard to the sector, or
  // open the sector command center. The active-filter card gets a visible ring.
  const marginBySector = Object.fromEntries(margins.map((m) => [m.id, m.margin]));
  const sectorCards = ov.sectors.map((s) => {
    const gm = ov.canSeeMargin ? marginBySector[s.id] : undefined;
    const active = sec === s.id;
    return card(`
    <div style="padding:.8rem .9rem${active ? ';box-shadow:inset 0 0 0 2px ' + (s.color || '#2563eb') + ';border-radius:var(--r)' : ''}">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:.5rem">
          <span style="width:9px;height:9px;border-radius:3px;background:${s.color || '#2563eb'}"></span>
          <div><div style="font-weight:800;font-size:14px">${esc(s.name_ar)}</div><div style="font-size:10.5px;color:var(--muted)">${esc(s.name_en || '')}</div></div>
        </div>
        ${s.placeholder ? pill('بانتظار التفعيل', 'amber') : pill(`${s.opp_count} فرصة`, 'blue')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.7rem">
        <div><div style="font-size:11px;color:var(--muted)">الإيراد · ${pct(s.revenue_pct)}</div>
          <div style="font-weight:800" class="tnum">${fmtSar(s.revenue_halalas)}</div>
          <div class="bar" style="margin-top:.35rem"><span style="width:${Math.min(100, s.revenue_pct)}%;background:var(--green)"></span></div></div>
        <div><div style="font-size:11px;color:var(--muted)">المبيعات · ${pct(s.sales_pct)}</div>
          <div style="font-weight:800" class="tnum">${fmtSar(s.sales_halalas)}</div>
          <div class="bar" style="margin-top:.35rem"><span style="width:${Math.min(100, s.sales_pct)}%;background:${s.color || 'var(--brand)'}"></span></div></div>
      </div>
      <div style="margin-top:.7rem;padding-top:.6rem;border-top:1px solid var(--line);font-size:11px;color:var(--muted);display:flex;justify-content:space-between">
        <span>عقود ${year}: <b class="tnum" style="color:var(--ink2)">${fmtSar(s.contracts_halalas)}</b> (${s.contracts_count})</span>
        ${gm != null ? `<span>هامش: <b style="color:${gm >= 20 ? 'var(--green)' : gm >= 10 ? 'var(--amber)' : 'var(--red)'}">${gm}%</b></span>` : ''}
      </div>
      <div style="margin-top:.55rem;display:flex;gap:.4rem">
        ${active
          ? `<a class="btn btn-sm" href="/app/ceo?year=${year}">إلغاء التصفية</a>`
          : `<a class="btn btn-sm" href="/app/ceo?year=${year}&sector=${s.id}">تصفية اللوحة</a>`}
        <a class="btn btn-sm btn-ghost" href="/app/sector?year=${year}&sector=${s.id}">مركز القطاع ←</a>
      </div>
    </div>`, 'card-h');
  }).join('');
  // sector achievement (revenue) comparison, sorted, colored by sector — the "how much each achieved" chart
  const sectorAchv = [...ov.sectors].map((s) => ({ label: esc(s.name_ar), value: s.revenue_halalas || 0, color: s.color || '#2563eb', sub: pct(s.revenue_pct) })).sort((a, b) => b.value - a.value);
  // dense secondary metric inside the hero — clickable when a drill-down key is given
  const hm = (label, val, sub, dd) => `<div ${dd ? `class="hclick" role="button" tabindex="0" aria-label="${label} — التفاصيل" onclick="Sanad.openDD('${dd}')" onkeydown="if(event.key==='Enter'||event.key===' ')Sanad.openDD('${dd}')"` : ''} style="flex:1;min-width:118px;max-width:220px;overflow:hidden;padding:.3rem .45rem;margin:-.3rem -.45rem"><div style="color:rgba(255,255,255,.58);font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}${dd ? ' <span style="opacity:.55">⊕</span>' : ''}</div><div class="tnum" style="color:#fff;font-weight:800;font-size:1.02rem;margin-top:.12rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${val}</div>${sub ? `<div style="color:rgba(255,255,255,.42);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" class="tnum">${sub}</div>` : ''}</div>`;

  // ── Sector filter chips (the owner's per-sector lens) ──
  const chips = `<div class="chips"><span class="lbl">عرض:</span>
    <a href="/app/ceo?year=${year}" class="chip ${sec ? '' : 'on'}">الشركة كاملة</a>
    ${ov.sectors.map((s) => `<a href="/app/ceo?year=${year}&sector=${s.id}" class="chip ${sec === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || '#2563eb'}"></span>${esc(s.name_ar)}</a>`).join('')}
    ${sec ? `<a class="btn btn-sm" style="margin-inline-start:.3rem" href="/app/sector?year=${year}&sector=${sec}">فتح مركز القطاع ←</a>` : ''}
  </div>`;

  // ── Drill-down popup datasets → templates (shared ddWrap/attain/ddRows at module scope) ──
  const secHbars = (key, pctKey) => hbars([...ov.sectors].map((s) => ({ label: esc(s.name_ar), value: s[key] || 0, color: s.color || '#2563eb', sub: pct(s[pctKey]) })).sort((a, b) => b.value - a.value), { fmt: fmtSar });
  const maxStage = Math.max(1, ...pipeStages.map((s) => s.v || 0));
  const ddTemplates = `
  ${ddWrap('revenue', `الإيرادات المحققة · ${year}`, `${scopeLabel} · مقابل الهدف`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--green)">${fmtSar(t.revenue)}</span><span style="font-size:12px;color:var(--muted)">إيراد ${scopeLabel}</span></div>
    ${attain(t.revenue, t.target_revenue, 'var(--green)')}
    ${sec ? '' : `<div class="dd-sec">حسب القطاع</div>${secHbars('revenue_halalas', 'revenue_pct')}`}
    <div class="dd-sec">حسب الربع (ر.س)</div>
    ${miniBars(qRev.map((q) => ({ year: q.quarter, v: q.revenue_halalas })), 'v', { fmt: sarShort, h: 118 })}
    <div class="dd-sec">أكبر بنود الإيراد</div>
    <div>${ddRows(revLines.map((r) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.project || r.label || 'بند إيراد')}<span style="color:var(--faint);font-size:10.5px">${r.month ? ' · شهر ' + r.month : ''}${!sec && r.sector ? ' · ' + esc(r.sector) : ''}</span></span><b class="tnum" style="flex:none">${fmtSar(r.amount_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('sales', `المبيعات (الحجوزات) · ${year}`, `${scopeLabel} · مقابل الهدف`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--brand2)">${fmtSar(t.sales)}</span><span style="font-size:12px;color:var(--muted)">مبيعات ${scopeLabel}</span></div>
    ${attain(t.sales, t.target_sales, 'var(--brand2)')}
    <div style="display:flex;gap:.6rem;margin-top:.2rem">
      <div style="flex:1;background:var(--bg,#f6f7fb);border-radius:10px;padding:.55rem .7rem">
        <div style="font-size:10.5px;color:var(--muted)">مبيعات السنة (${year}) · مقابل الهدف</div>
        <div class="tnum" style="font-weight:800;font-size:15px;color:var(--brand2)">${fmtSar(t.sales)}</div></div>
      <div style="flex:1;background:var(--bg,#f6f7fb);border-radius:10px;padding:.55rem .7rem">
        <div style="font-size:10.5px;color:var(--muted)">إجمالي الحجوزات التراكمية · ${bookAll.n} صفقة</div>
        <div class="tnum" style="font-weight:800;font-size:15px">${fmtSar(bookAll.v)}</div></div>
    </div>
    <div style="font-size:10.5px;color:var(--faint);line-height:1.6">«مبيعات السنة» تحسب الصفقات المكسوبة في ${year} فقط (الأساس الصحيح مقابل الهدف السنوي)؛ «التراكمي» يجمع كل السنوات (كما كانت تعرضه المنصة السابقة كرقم واحد).</div>
    ${bookByYear.length > 1 ? `<div class="dd-sec">الحجوزات حسب سنة الفوز</div>
      <div>${ddRows(bookByYear.map((b) => `<div class="dd-row"><span>${b.year || 'بدون سنة'}<span style="color:var(--faint);font-size:10.5px"> · ${b.n} صفقة</span></span><b class="tnum" style="flex:none${String(b.year) === String(year) ? ';color:var(--brand2)' : ''}">${fmtSar(b.v)}</b></div>`))}</div>` : ''}
    ${sec ? '' : `<div class="dd-sec">حسب القطاع (السنة)</div>${secHbars('sales_halalas', 'sales_pct')}`}
    <div class="dd-sec">حسب الربع (ر.س)</div>
    ${miniBars(qBook.map((q) => ({ year: q.quarter, v: q.sales_halalas })), 'v', { fmt: sarShort, h: 118 })}
    <div class="dd-sec">أكبر الصفقات المكسوبة (${year})</div>
    <div>${ddRows(wonDeals.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(d.client || '—')}${!sec && d.sector ? ' · ' + esc(d.sector) : ''}</span></span><b class="tnum" style="flex:none">${fmtSar(d.value_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('pipeline', 'خط الفرص المفتوح', `${scopeLabel} · حسب المرحلة`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--blue)">${fmtSar(pipelineVal)}</span><span style="font-size:12px;color:var(--muted)">القيمة المرجّحة ${fmtSar(cov.weighted_halalas)} · تغطية ${cov.coverage != null ? cov.coverage + '×' : '—'}</span></div>
    <div class="dd-sec">حسب المرحلة</div>
    <div>${ddRows(pipeStages.map((s) => `<div style="padding:.32rem 0">
      <div style="display:flex;align-items:center;gap:.5rem;font-size:12.5px"><span style="width:9px;height:9px;border-radius:3px;background:${s.color || '#64748b'};flex:none"></span><span style="flex:1">${esc(s.name_ar)}</span><span class="tnum" style="font-weight:800">${s.n}</span><span class="tnum" style="color:var(--muted);font-size:11px">${fmtSar(s.v)}</span></div>
      <div class="bar" style="margin-top:.22rem"><span style="width:${Math.round((s.v / maxStage) * 100)}%;background:${s.color || '#64748b'}"></span></div></div>`))}</div>`)}
  ${ddWrap('winrate', `معدل الفوز · ${year}`, scopeLabel, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--green)">${pct(wr.rate)}</span><span style="font-size:12px;color:var(--muted)">فوز ${wr.won} · خسارة ${wr.lost}</span></div>
    <div class="bar" style="height:8px"><span style="width:${Math.min(100, wr.rate || 0)}%;background:var(--green)"></span></div>
    <div class="dd-sec">الصفقات المكسوبة الأعلى</div>
    <div>${ddRows(wonDeals.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(d.client || '—')}</span></span><b class="tnum" style="flex:none">${fmtSar(d.value_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('backlog', 'الأعمال المتعاقدة (Backlog)', `${scopeLabel} · المتبقي للتحقيق`, `
    <div class="dd-kpi"><span class="v tnum">${fmtSar(bk.backlog_halalas)}</span><span style="font-size:12px;color:var(--muted)">قيمة متعاقدة لم تُحقَّق بعد</span></div>
    <div class="dd-sec">أكبر العقود</div>
    <div>${ddRows(topContracts.map((c) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.client || c.code || 'عقد')}<span style="color:var(--faint);font-size:10.5px">${c.code ? ' · ' + esc(c.code) : ''}${!sec && c.sector ? ' · ' + esc(c.sector) : ''}</span></span><b class="tnum" style="flex:none">${fmtSar(c.value_halalas)}</b></div>`))}</div>`)}
  ${ov.canSeeMargin ? ddWrap('margin', `هامش الربح الإجمالي · ${year}`, 'حسب القطاعات · بيانات حساسة (مالية/قيادة فقط)', `
    ${avgMargin != null ? `<div class="dd-kpi"><span class="v tnum" style="color:${avgMargin >= 20 ? 'var(--green)' : avgMargin >= 10 ? 'var(--amber)' : 'var(--red)'}">${avgMargin}%</span><span style="font-size:12px;color:var(--muted)">متوسط الهامش عبر القطاعات</span></div>` : ''}
    <div>${ddRows(margins.map((m) => `<div class="dd-row"><span style="display:flex;align-items:center;gap:.45rem;min-width:0"><span style="width:9px;height:9px;border-radius:2px;background:${m.color || '#2563eb'};flex:none"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name_ar)}</span></span><b class="tnum" style="flex:none;color:${m.margin == null ? 'var(--faint)' : m.margin >= 20 ? 'var(--green)' : m.margin >= 10 ? 'var(--amber)' : 'var(--red)'}">${m.margin == null ? '—' : m.margin + '%'}</b></div>`))}</div>`) : ''}`;
  const body = `
    ${chips}
    ${riskBanner}
    <div style="border-radius:18px;padding:1.25rem 1.5rem;margin-bottom:.9rem;color:#fff;background:linear-gradient(135deg,#0f2350,#182a5e 55%,#3a1660);box-shadow:0 16px 34px -18px rgba(58,22,96,.6);position:relative;overflow:hidden">
      <div style="position:absolute;inset-inline-end:-40px;top:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(124,58,237,.32),transparent 70%);pointer-events:none"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.9rem;position:relative">
        <div style="color:rgba(255,255,255,.62);font-size:12px;font-weight:600">الأداء · ${esc(scopeLabel)} · السنة المالية ${ov.fiscalYear}</div>
        ${b2b.ratio != null ? `<span style="font-size:11.5px;font-weight:700;background:rgba(255,255,255,.12);padding:.3rem .7rem;border-radius:999px">Book-to-Bill ${b2b.ratio}×</span>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:1.25rem;align-items:center;position:relative">
        ${heroBlock(sec ? 'إيرادات القطاع المحققة' : 'إجمالي الإيرادات المحققة', t.revenue, t.target_revenue, revPct, '#34d399', yoyBadge(revYoy), 'revenue')}
        <div style="width:1px;align-self:stretch;background:rgba(255,255,255,.12)"></div>
        ${heroBlock(sec ? 'مبيعات القطاع (حجوزات)' : 'إجمالي المبيعات (حجوزات)', t.sales, t.target_sales, salesPct, '#c07bff', yoyBadge(bookYoy), 'sales')}
      </div>
      <div style="display:flex;gap:1.1rem;flex-wrap:wrap;margin-top:.95rem;padding-top:.85rem;border-top:1px solid rgba(255,255,255,.1);position:relative">
        ${hm('خط الفرص المفتوح', fmtSar(pipelineVal), 'مرجّح ' + fmtSar(cov.weighted_halalas), 'pipeline')}
        ${hm('معدل الفوز', pct(wr.rate), `فوز ${wr.won} · خسارة ${wr.lost}`, 'winrate')}
        ${hm('الأعمال المتعاقدة', fmtSar(bk.backlog_halalas), 'Backlog لم يُحقَّق', 'backlog')}
        ${hm('تحقيق الإيراد', pct(revPct), 'من ' + fmtSar(t.target_revenue), 'revenue')}
        ${hm('تحقيق المبيعات', pct(salesPct), 'من ' + fmtSar(t.target_sales), 'sales')}
        ${avgMargin != null ? hm('متوسط هامش الربح', avgMargin + '%', 'حسب القطاعات', 'margin') : ''}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1.35fr 1fr;gap:.9rem;margin-bottom:.9rem">
      <div><div style="font-weight:800;font-size:13.5px;margin-bottom:.5rem">أداء القطاعات · ${year}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">${sectorCards}</div></div>
      ${card(`<div style="padding:.9rem 1rem;height:100%;display:flex;flex-direction:column">
        <div style="font-weight:800;font-size:13.5px">تحقيق القطاعات · الإيراد المحقق</div>
        <div style="font-size:11px;color:var(--muted);margin:.1rem 0 .85rem">مقارنة القطاعات لعام ${year} (ر.س. · % من الهدف)</div>
        ${hbars(sectorAchv, { fmt: fmtSar })}</div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem">
      ${card(`<div style="padding:.9rem 1rem"><div style="font-weight:800;font-size:13.5px">الإيراد المحقق حسب الربع · ${year}</div>
        <div style="font-size:11px;color:var(--muted);margin:.1rem 0 .4rem">مليون ر.س.</div>
        ${miniBars(qRev.map((q) => ({ year: q.quarter, revenue_halalas: q.revenue_halalas })), 'revenue_halalas', { fmt: sarShort })}</div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-weight:800;font-size:13.5px">المبيعات (الحجوزات) حسب الربع · ${year}</div>
        <div style="font-size:11px;color:var(--muted);margin:.1rem 0 .4rem">مليون ر.س.</div>
        ${miniBars(qBook.map((q) => ({ year: q.quarter, sales_halalas: q.sales_halalas })), 'sales_halalas', { fmt: sarShort })}</div>`)}
    </div>
    ${ddTemplates}`;
  return layout({ user, active: 'ceo', title: `لوحة القيادة${sec ? ' — ' + esc(secObj.name_ar) : ''}`,
    subtitle: `نظرة تنفيذية · ${esc(scopeLabel)} · السنة المالية ${year}`, body, year });
}

export async function sectorPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  // Company-scope users (owner/CEO office/finance/admin) can inspect ANY sector via ?sector= chips;
  // sector-scoped users stay locked to their own sector regardless of the query param.
  const allSectors = await all('SELECT id, name_ar, color FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const requested = opts.sector && allSectors.some((s) => s.id === opts.sector) ? opts.sector : null;
  const sectorId = user.scope === 'company'
    ? (requested || user.sector_id || allSectors[0]?.id || 'SOLUTIONS')
    : (user.sector_id || 'SOLUTIONS');
  const sd = await sectorDashboard(user, sectorId, { year });
  // Open pipeline BY STAGE for THIS sector (not the user's whole visibility scope).
  const pipe = await all(`SELECT st.id, st.name_ar, st.color, COUNT(*) AS "count", COALESCE(SUM(o.value_halalas),0) AS value_halalas
     FROM opportunity o JOIN stage st ON st.id = o.stage_id
     WHERE st.is_won = 0 AND st.is_lost = 0 AND o.deleted_at IS NULL AND o.sector_id = ?
     GROUP BY st.id, st.name_ar, st.color, st.sort_order ORDER BY st.sort_order`, [sectorId]);
  if (!sd) return layout({ user, active: 'sector', title: 'مركز القطاع', body: '<div style="color:var(--muted)">لا يوجد قطاع مرتبط</div>' });
  const staff = await sectorStaffing(sectorId, year);
  const clients = await sectorClients(sectorId);
  const wins = await sectorWins(sectorId, year);
  // Active contract book (the year-signed figure alone reads as "0" whenever contracts were signed
  // in prior years — the owner needs the LIVE book, with year-signed as secondary context).
  const activeC = await get(`SELECT COUNT(*) n, COALESCE(SUM(value_halalas),0) v FROM contract
     WHERE sector_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'`, [sectorId]);
  const secContracts = await all(`SELECT c.id, c.code, c.value_halalas, c.status, c.start_date, cl.name_ar client,
     (SELECT COALESCE(SUM(i.amount_halalas),0) FROM invoice i WHERE i.contract_id = c.id AND i.status != 'DRAFT' AND i.deleted_at IS NULL) invoiced
     FROM contract c LEFT JOIN client cl ON cl.id = c.client_id
     WHERE c.sector_id = ? AND c.deleted_at IS NULL ORDER BY c.value_halalas DESC LIMIT 10`, [sectorId]);
  // Revenue by project (the owner's ask: WHICH projects produced the revenue, and each one's
  // realization % of its own contract value).
  const revByProject = await all(`SELECT p.id, p.name_ar, p.contract_value_halalas cv, COALESCE(SUM(rl.amount_halalas),0) rev
     FROM revenue_line rl LEFT JOIN project p ON p.id = rl.project_id
     WHERE rl.sector_id = ? AND rl.year = ? GROUP BY p.id, p.name_ar, p.contract_value_halalas
     ORDER BY rev DESC LIMIT 12`, [sectorId, year]);
  const secWon = await all(`SELECT o.title_ar, o.value_halalas, c.name_ar client FROM opportunity o
     JOIN stage st ON st.id = o.stage_id LEFT JOIN client c ON c.id = o.client_id
     WHERE o.sector_id = ? AND o.year = ? AND st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL
     ORDER BY o.value_halalas DESC LIMIT 8`, [sectorId, year]);
  const revPctS = sd.target_revenue_halalas ? Math.round((sd.revenue_halalas / sd.target_revenue_halalas) * 100) : null;
  const salesPctS = sd.target_sales_halalas ? Math.round((sd.sales_halalas / sd.target_sales_halalas) * 100) : null;
  const tasks = await all(`SELECT t.title, t.status, t.priority, t.due_date, COALESCE(u.name_ar,u.username,'—') assignee
     FROM task t LEFT JOIN app_user u ON u.id=t.assignee_user_id
     WHERE t.sector_id=? AND t.deleted_at IS NULL AND t.status != 'DONE' ORDER BY t.due_date LIMIT 12`, [sectorId]);
  // Stat tile: clickable (opens drill-down) + optional attainment bar vs target.
  const stat = (label, val, sub, o = {}) => card(`<div ${o.dd ? `role="button" tabindex="0" onclick="Sanad.openDD('${o.dd}')" onkeydown="if(event.key==='Enter'||event.key===' ')Sanad.openDD('${o.dd}')"` : ''} style="padding:.85rem 1rem">
    <div style="font-size:11px;color:var(--muted)">${label}${o.dd ? ' <span style="color:var(--faint)">⊕</span>' : ''}</div>
    <div class="metric tnum" style="font-size:1.35rem;color:${o.tone || 'var(--ink2)'}">${val}</div>
    ${sub ? `<div style="font-size:10.5px;color:var(--muted)">${sub}</div>` : ''}
    ${o.bar ? `<div class="bar" style="margin-top:.4rem;height:5px"><span style="width:${Math.min(100, o.bar.p || 0)}%;background:${o.bar.color || 'var(--brand)'}"></span></div>` : ''}
  </div>`, o.dd ? 'cardclick card-h' : '');
  const maxPipe = Math.max(1, ...pipe.map((s) => s.value_halalas));
  const pipeRow = pipe.filter((s) => s.count > 0).map((s) => `<div style="padding:.3rem 0">
    <div style="display:flex;align-items:center;gap:.5rem;font-size:12.5px">
      <span style="width:9px;height:9px;border-radius:3px;background:${s.color}"></span>
      <span style="flex:1">${esc(s.name_ar)}</span><span style="font-weight:800" class="tnum">${s.count}</span>
      <span style="color:var(--muted);font-size:11px" class="tnum">${fmtSar(s.value_halalas)}</span></div>
    <div class="bar" style="margin-top:.22rem"><span style="width:${Math.round(s.value_halalas / maxPipe * 100)}%;background:${s.color}"></span></div></div>`).join('') || '<div style="color:var(--faint);font-size:12px">لا فرص</div>';
  const utilTone = (u) => u > 100 ? 'var(--red)' : u >= 70 ? 'var(--green)' : u >= 40 ? 'var(--amber)' : 'var(--muted)';
  const staffRows = staff.employees.slice(0, 12).map((e) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .6rem;font-size:12.5px">${esc(e.name)}<div style="font-size:10.5px;color:var(--muted)">${esc(e.job || '')}</div></td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:12px" class="tnum">${e.projects}</td>
    <td style="padding:.4rem .6rem;width:150px">${utilStrip(e.months, staff.currentMonth)}</td>
    <td style="padding:.4rem .6rem;text-align:center" class="tnum"><span style="font-weight:800;font-size:13px;color:${utilTone(e.current)}">${e.current}%</span><div style="font-size:9.5px;color:var(--faint)">سنويًا ${e.utilization}%</div></td></tr>`).join('') || '<tr><td colspan="4" style="padding:1rem;color:var(--muted);font-size:12px">لا تسكين مسجّل لهذا القطاع في ' + year + '</td></tr>';
  const clientRows = clients.map((c) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .6rem;font-size:12.5px">${esc(c.name_ar)}</td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:12px" class="tnum">${c.opps}</td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:12px" class="tnum">${c.projects}</td>
    <td style="padding:.4rem .6rem;text-align:left;font-size:12px;font-weight:700" class="tnum">${fmtSar(c.pipeline_halalas)}</td></tr>`).join('') || '<tr><td colspan="4" style="padding:1rem;color:var(--muted);font-size:12px">لا عملاء</td></tr>';
  const taskRows = tasks.map((t) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .6rem;font-size:12.5px">${esc(t.title)}</td>
    <td style="padding:.4rem .6rem;font-size:11px;color:var(--muted)">${esc(t.assignee)}</td>
    <td style="padding:.4rem .6rem;text-align:center">${pill(tr(t.status), t.status === 'BLOCKED' ? 'red' : t.status === 'IN_PROGRESS' ? 'blue' : 'slate')}</td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:11px;color:var(--muted)" class="tnum">${t.due_date || '—'}</td></tr>`).join('') || '<tr><td colspan="4" style="padding:1rem;color:var(--muted);font-size:12px">لا مهام مفتوحة</td></tr>';
  const th = (t) => `<th style="padding:.4rem .6rem;font-size:10.5px;color:var(--muted);font-weight:700;text-align:${t.a || 'right'}">${t.t}</th>`;
  // Bonuses/incentives (المكافآت): no bonus/incentive table exists in the data snapshot, and individual
  // salary is HR-gated by design. We show the REAL incentive-pool basis (won-deal value) — never fabricated
  // per-person figures — and state transparently that individual distribution needs an HR/payroll source.
  const avgWon = wins.won ? Math.round(wins.wonValue_halalas / wins.won) : 0;
  const bonusesCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:800;font-size:13.5px">المكافآت والحوافز</div><span style="font-size:10px;color:var(--amber);font-weight:700">مصدر HR غير مربوط</span></div>
    <div style="padding:.6rem 1rem">
      <div style="display:flex;justify-content:space-between;padding:.3rem 0;border-bottom:1px dashed var(--line)"><span style="font-size:12px;color:var(--muted)">أساس الحوافز · قيمة الصفقات المكسوبة ${year}</span><span class="tnum" style="font-weight:800;font-size:13px;color:var(--green)">${fmtSar(wins.wonValue_halalas)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:.3rem 0;border-bottom:1px dashed var(--line)"><span style="font-size:12px;color:var(--muted)">صفقات مكسوبة</span><span class="tnum" style="font-weight:800;font-size:13px">${wins.won}</span></div>
      <div style="display:flex;justify-content:space-between;padding:.3rem 0"><span style="font-size:12px;color:var(--muted)">متوسط قيمة الصفقة</span><span class="tnum" style="font-weight:800;font-size:13px">${fmtSar(avgWon)}</span></div>
      <div style="margin-top:.5rem;font-size:10.5px;color:var(--faint);line-height:1.6;background:var(--bg,#f6f7fb);border-radius:8px;padding:.5rem .6rem">توزيع المكافآت الفردية يتطلب ربط مصدر بيانات الموارد البشرية/الرواتب أو تعريف قاعدة الحوافز. الأساس أعلاه محسوب من الصفقات الفعلية.</div>
    </div>`);
  // ── Drill-down templates: revenue-by-project (owner ask), contract book, sales/wins ──
  const secDD = `
  ${ddWrap('secrev', `إيراد القطاع حسب المشروع · ${year}`, `${esc(sd.sector.name_ar)} · المحقق مقابل قيمة كل مشروع`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--green)">${fmtSar(sd.revenue_halalas)}</span><span style="font-size:12px;color:var(--muted)">إجمالي المحقق ${year}</span></div>
    ${attain(sd.revenue_halalas, sd.target_revenue_halalas, 'var(--green)')}
    <div class="dd-sec">المشاريع المولِّدة للإيراد</div>
    <div>${ddRows(revByProject.map((r) => { const pcv = r.cv ? Math.round((r.rev / r.cv) * 100) : null; return `
      <div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.id ? esc(r.name_ar) : 'إيراد غير مرتبط بمشروع'}</span>
          <b class="tnum" style="flex:none">${fmtSar(r.rev)}</b></div>
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:10.5px;color:var(--muted)">
          <span>${r.cv ? 'قيمة المشروع ' + fmtSar(r.cv) : 'بلا قيمة عقد مسجلة في المصدر'}</span>${pcv != null ? `<span class="tnum" style="font-weight:800">حقّق ${pcv}%</span>` : ''}</div>
        ${pcv != null ? `<div class="bar" style="margin-top:.25rem;height:5px"><span style="width:${Math.min(100, pcv)}%;background:var(--green)"></span></div>` : ''}
      </div>`; }))}</div>`)}
  ${ddWrap('seccontracts', 'سجل عقود القطاع', `${esc(sd.sector.name_ar)} · النشطة + الموقّعة حسب السنة`, `
    <div class="dd-kpi"><span class="v tnum">${fmtSar(activeC.v)}</span><span style="font-size:12px;color:var(--muted)">${activeC.n} عقد نشط · موقّع ${year}: ${sd.contracts_count} (${fmtSar(sd.contracts_halalas)})</span></div>
    <div class="dd-sec">أكبر العقود</div>
    <div>${ddRows(secContracts.map((c) => { const ip = c.value_halalas ? Math.min(100, Math.round(((c.invoiced || 0) / c.value_halalas) * 100)) : 0; return `
      <div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.client || c.code || 'عقد')}${c.code ? ` <span style="color:var(--faint);font-size:10.5px">${esc(c.code)}</span>` : ''}</span>
          <b class="tnum" style="flex:none">${fmtSar(c.value_halalas)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted)"><span>${tr(c.status)}${c.start_date ? ' · ' + String(c.start_date).slice(0, 10) : ''}</span><span class="tnum">فُوتر ${ip}%</span></div>
        <div class="bar" style="margin-top:.25rem;height:5px"><span style="width:${ip}%;background:var(--blue)"></span></div>
      </div>`; }))}</div>`)}
  ${ddWrap('secwins', `المبيعات والفوز · ${year}`, `${esc(sd.sector.name_ar)} · مقابل هدف المبيعات`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--brand2)">${fmtSar(sd.sales_halalas)}</span><span style="font-size:12px;color:var(--muted)">${wins.won} صفقة مكسوبة · معدل ${wins.winRate}%</span></div>
    ${attain(sd.sales_halalas, sd.target_sales_halalas, 'var(--brand2)')}
    <div class="dd-sec">الصفقات المكسوبة</div>
    <div>${ddRows(secWon.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(d.client || '—')}</span></span><b class="tnum" style="flex:none">${fmtSar(d.value_halalas)}</b></div>`))}</div>`)}`;

  const switcher = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    ${allSectors.map((s) => `<a href="/app/sector?year=${year}&sector=${s.id}" class="chip ${s.id === sectorId ? 'on' : ''}"><span class="dot" style="background:${s.color || '#2563eb'}"></span>${esc(s.name_ar)}</a>`).join('')}
    <a class="btn btn-sm" style="margin-inline-start:.3rem" href="/app/ceo?year=${year}&sector=${sectorId}">لوحة القيادة لهذا القطاع</a>
  </div>` : '';
  const body = `
    ${switcher}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:.85rem;margin-bottom:.9rem">
      ${stat(`إيراد ${year}`, fmtSar(sd.revenue_halalas),
        revPctS != null ? `الهدف ${fmtSar(sd.target_revenue_halalas)} · تحقّق ${revPctS}%` : `انقر لتفاصيل المشاريع`,
        { dd: 'secrev', tone: 'var(--green)', bar: revPctS != null ? { p: revPctS, color: 'var(--green)' } : null })}
      ${stat(`مبيعات ${year}`, fmtSar(sd.sales_halalas),
        salesPctS != null ? `الهدف ${fmtSar(sd.target_sales_halalas)} · تحقّق ${salesPctS}%` : `${wins.won} صفقة مكسوبة`,
        { dd: 'secwins', tone: 'var(--brand2)', bar: salesPctS != null ? { p: salesPctS, color: 'var(--brand2)' } : null })}
      ${stat('العقود النشطة', fmtSar(activeC.v), `${activeC.n} عقد نشط · موقّع ${year}: ${sd.contracts_count} (${fmtSar(sd.contracts_halalas)})`, { dd: 'seccontracts' })}
      ${stat('إشغال الفريق الآن', (staff.teamCurrent ?? staff.teamUtil) + '%', `سنويًا ${staff.teamUtil}% · ${staff.headcount} موظف`, { tone: utilTone(staff.teamCurrent ?? staff.teamUtil) })}
      ${stat('الفوز', wins.won + ' فرصة', `نسبة ${wins.winRate}% · خسارة ${wins.lost}`, { dd: 'secwins', tone: 'var(--green)' })}
      ${stat('مشاريع قائمة', sd.projects.IN_PROGRESS || 0, `مخاطر مفتوحة ${sd.openRisks}`)}
    </div>
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.85rem 1rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)"><div style="font-weight:800;font-size:13.5px">التسكين الشهري واليوتيليزيشن</div><span style="font-size:10.5px;color:var(--muted)">أخضر ≥80% · أصفر · أحمر تجاوز</span></div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>${th({ t: 'الموظف' })}${th({ t: 'مشاريع', a: 'center' })}${th({ t: 'يناير → ديسمبر', a: 'center' })}${th({ t: 'الإشغال (الآن·سنوي)', a: 'center' })}</tr></thead><tbody>${staffRows}</tbody></table>`)}
      <div style="display:flex;flex-direction:column;gap:.9rem">
        ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">خط الفرص حسب المرحلة</div><div style="padding:.6rem 1rem">${pipeRow}</div>`)}
        ${bonusesCard}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">العملاء وخط أنابيبهم</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>${th({ t: 'العميل' })}${th({ t: 'فرص', a: 'center' })}${th({ t: 'مشاريع', a: 'center' })}${th({ t: 'الخط', a: 'left' })}</tr></thead><tbody>${clientRows}</tbody></table>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">المهام المُسكَّنة المفتوحة</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>${th({ t: 'المهمة' })}${th({ t: 'المسؤول' })}${th({ t: 'الحالة', a: 'center' })}${th({ t: 'الاستحقاق', a: 'center' })}</tr></thead><tbody>${taskRows}</tbody></table>`)}
    </div>
    ${secDD}`;
  return layout({ user, active: 'sector', title: `مركز القطاع — ${esc(sd.sector.name_ar)}`, subtitle: `قيادة القطاع · السنة المالية ${year}`, body, year });
}

// small stat chip used on PMO toolbars
function statMini(label, value, sub, tone) {
  const c = tone === 'good' ? 'var(--green)' : tone === 'bad' ? 'var(--red)' : tone === 'warn' ? 'var(--amber)' : tone === 'brand' ? 'var(--brand2)' : 'var(--ink2)';
  return `<div class="card" style="padding:.6rem .9rem;min-width:130px">
    <div style="font-size:11px;color:var(--muted);font-weight:700">${label}</div>
    <div class="tnum" style="font-size:1.15rem;font-weight:800;color:${c};letter-spacing:-.02em">${value}</div>
    <div style="font-size:10.5px;color:var(--faint)">${sub || ''}</div></div>`;
}

export async function opportunitiesPage(user) {
  const rows = await listOpportunities(user);
  const stages = await all('SELECT id,name_ar,color,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));
  const users = Object.fromEntries((await all('SELECT id,name_ar,username FROM app_user')).map((u) => [u.id, u.name_ar || u.username]));
  const sectors = await all('SELECT id,name_ar FROM sector WHERE active=1 ORDER BY name_ar');
  const canCreate = can(user, 'create', 'opportunity');
  const canEdit = can(user, 'update', 'opportunity');

  const total = rows.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const weighted = rows.reduce((a, o) => a + (o.value_halalas || 0) * ((o.win_pct || 0) / 100), 0);
  const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const won = rows.filter((o) => stById[o.stage_id]?.is_won).length;
  const openN = rows.filter((o) => { const s = stById[o.stage_id]; return s && !s.is_won && !s.is_lost; }).length;

  const byStage = {}; for (const s of stages) byStage[s.id] = [];
  for (const o of rows) (byStage[o.stage_id] ||= []).push(o);

  const opCard = (o) => {
    const st = stById[o.stage_id] || {};
    const cl = clients[o.client_id]; const ow = users[o.owner_user_id];
    const prTone = o.priority === 'P0' ? 'red' : o.priority === 'P1' ? 'amber' : 'slate';
    const hay = `${o.title_ar} ${cl || ''} ${ow || ''}`.toLowerCase();
    const dnd = canEdit ? 'draggable="true" ondragstart="Sanad.kStart(event)" ondragend="Sanad.kEnd(event)"' : '';
    return `<div class="kcard" ${dnd} data-id="${o.id}" data-sector="${o.sector_id || ''}" data-hay="${esc(hay).replace(/"/g, '')}" style="--_c:${st.color || '#cbd5e1'}${canEdit ? '' : ';cursor:pointer'}"
       onclick="Sanad.oppOpen('${o.id}')">
      <div class="kt">${esc(o.title_ar)}</div>
      <div class="km">${cl ? `<span style="display:inline-flex;align-items:center;gap:.25rem">${icon('building')}${esc(cl)}</span>` : '<span style="color:var(--faint)">—</span>'}
        ${o.priority ? pill(tr(o.priority), prTone) : ''}</div>
      <div class="km"><span class="kv tnum">${fmtSar(o.value_halalas)}</span>
        <span class="tnum" style="margin-inline-start:auto">${pct(o.win_pct)}</span>
        ${ow ? `<span class="kav" title="${ow}">${(ow || '?').trim().charAt(0)}</span>` : ''}</div>
    </div>`;
  };

  const columns = stages.map((s) => {
    const items = byStage[s.id] || [];
    const colTotal = items.reduce((a, o) => a + (o.value_halalas || 0), 0);
    const drop = canEdit ? 'ondragover="Sanad.kOver(event)" ondragleave="Sanad.kLeave(event)" ondrop="Sanad.kDrop(event)"' : '';
    return `<div class="kcol" data-stage="${s.id}" ${drop}>
      <div class="kcol-head"><span class="kcol-dot" style="background:${s.color}"></span>
        <span class="t">${esc(s.name_ar)}</span><span class="n" data-count>${items.length}</span>
        <span class="v tnum" data-total>${sarShort(colTotal)}</span></div>
      <div class="kcol-body">${items.map(opCard).join('') || '<div style="text-align:center;color:var(--faint);font-size:11px;padding:1rem 0">—</div>'}</div>
    </div>`;
  }).join('');

  const tableRows = rows.slice(0, 200).map((o) => {
    const st = stById[o.stage_id] || {};
    return `<tr class="border-b border-line" style="cursor:pointer" onclick="Sanad.oppOpen('${o.id}')">
      <td class="py-2.5 px-3 text-[13px]">${esc(o.title_ar)}</td>
      <td class="px-3 text-[12px]">${esc(clients[o.client_id] || '—')}</td>
      <td class="px-3">${pill(st.name_ar || o.stage_id, 'blue')}</td>
      <td class="px-3 text-[13px] tnum">${fmtSar(o.value_halalas)}</td>
      <td class="px-3 text-[12px] text-muted tnum">${pct(o.win_pct)}</td></tr>`;
  }).join('');

  const body = `
    <div class="toolbar">
      <div class="seg"><button class="on" data-view="kanban" onclick="Sanad.pmoView('opp','kanban')">${icon('kanban')} كانبان</button>
        <button data-view="table" onclick="Sanad.pmoView('opp','table')">${icon('list')} جدول</button></div>
      <div class="search">${icon('search')}<input class="input" id="opp-q" aria-label="بحث في الفرص" oninput="Sanad.oppFilter()" placeholder="ابحث بالعنوان أو العميل…"></div>
      <select class="input" id="opp-sector" aria-label="تصفية حسب القطاع" onchange="Sanad.oppFilter()"><option value="">كل القطاعات</option>${sectors.map((s) => `<option value="${s.id}">${esc(s.name_ar)}</option>`).join('')}</select>
      <div class="spacer"></div>
      ${canCreate ? `<button class="btn btn-primary" onclick="Sanad.oppAdd()">${icon('plus')} فرصة جديدة</button>` : ''}
    </div>
    <div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1.1rem">
      ${statMini('إجمالي الخط', fmtSar(total), rows.length + ' فرصة')}
      ${statMini('المرجّح', fmtSar(weighted), 'حسب الاحتمالية', 'brand')}
      ${statMini('مفتوحة', openN, 'قيد التنفيذ')}
      ${statMini('فائزة', won, 'مُغلقة رابحة', 'good')}
    </div>
    <div id="opp-kanban" class="kanban">${columns}</div>
    <div id="opp-table" class="card" style="display:none;overflow-x:auto">
      <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
        <th class="py-2 px-3 font-medium">العنوان</th><th class="px-3 font-medium">العميل</th><th class="px-3 font-medium">المرحلة</th>
        <th class="px-3 font-medium">القيمة</th><th class="px-3 font-medium">الاحتمالية</th></tr></thead>
      <tbody>${tableRows || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا توجد فرص ضمن نطاقك</td></tr>'}</tbody></table></div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      stages:${JSON.stringify(stages.map((s) => ({ id: s.id, name_ar: s.name_ar, color: s.color })))},
      sectors:${JSON.stringify(sectors)},
      canCreateOpp:${canCreate}
    });</script>`;
  return layout({ user, active: 'opportunities', title: 'الفرص والمبيعات', subtitle: 'خط الفرص · PMO', body });
}

// Personal pipeline — an individual's OWN opportunities (owner = the signed-in user).
export async function myOpportunitiesPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const scoped = await listOpportunities(user);
  const rows = scoped.filter((o) => o.owner_user_id === user.id);
  const stages = await all('SELECT id,name_ar,color,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));

  const isOpen = (o) => { const s = stById[o.stage_id]; return s && !s.is_won && !s.is_lost; };
  const open = rows.filter(isOpen);
  const wonAll = rows.filter((o) => stById[o.stage_id]?.is_won);
  const lostAll = rows.filter((o) => stById[o.stage_id]?.is_lost);
  const wonYear = wonAll.filter((o) => o.year === year);
  const total = open.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const weighted = open.reduce((a, o) => a + (o.value_halalas || 0) * ((o.win_pct || 0) / 100), 0);
  const wonValue = wonYear.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const decided = wonAll.length + lostAll.length;
  const winRatePct = decided ? Math.round(wonAll.length / decided * 100) : 0;

  // pipeline by stage (open opps only) for the comparison chart
  const openStages = stages.filter((s) => !s.is_won && !s.is_lost);
  const stageItems = openStages.map((s) => {
    const items = open.filter((o) => o.stage_id === s.id);
    return { label: esc(s.name_ar), value: items.reduce((a, o) => a + (o.value_halalas || 0), 0), n: items.length, sub: items.length + ' فرصة', color: s.color };
  }).filter((x) => x.n > 0);

  // next actions — open opps with a next_action, soonest by win% desc (closest to closing first)
  const actions = open.filter((o) => o.next_action).sort((a, b) => (b.win_pct || 0) - (a.win_pct || 0)).slice(0, 8);

  const statMy = (l, v, sub, tone) => card(`<div style="padding:.75rem .95rem"><div style="font-size:11px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.35rem;${tone ? 'color:' + tone : ''}">${v}</div>${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`);

  // ranked list of my open pipeline (highest value first), with stage + win% + client + next action
  const oppRows = open.slice().sort((a, b) => (b.value_halalas || 0) - (a.value_halalas || 0)).slice(0, 60).map((o) => {
    const st = stById[o.stage_id] || {};
    const prTone = o.priority === 'P0' ? 'red' : o.priority === 'P1' ? 'amber' : 'slate';
    return `<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="Sanad.oppOpen('${o.id}')">
      <td style="padding:.45rem .7rem;font-size:12.5px">${esc(o.title_ar)}${o.priority ? ' ' + pill(tr(o.priority), prTone) : ''}<div style="font-size:10.5px;color:var(--muted)">${esc(clients[o.client_id] || '—')}</div></td>
      <td style="padding:.45rem .7rem;text-align:center"><span style="display:inline-flex;align-items:center;gap:.3rem;font-size:11.5px"><span style="width:8px;height:8px;border-radius:2px;background:${st.color || '#cbd5e1'}"></span>${esc(st.name_ar || o.stage_id)}</span></td>
      <td style="padding:.45rem .7rem;text-align:left;font-weight:800;font-size:12.5px" class="tnum">${fmtSar(o.value_halalas)}</td>
      <td style="padding:.45rem .7rem;text-align:center;font-size:12px;color:var(--muted)" class="tnum">${pct(o.win_pct)}</td>
      <td style="padding:.45rem .7rem;font-size:11px;color:var(--muted)">${esc(o.next_action || '—')}</td></tr>`;
  }).join('');

  const actionRows = actions.map((o) => `<div style="display:flex;align-items:flex-start;gap:.5rem;padding:.45rem 0;border-bottom:1px dashed var(--line)">
    <span style="width:7px;height:7px;border-radius:99px;margin-top:.35rem;flex:0 0 auto;background:${(stById[o.stage_id] || {}).color || '#cbd5e1'}"></span>
    <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:var(--ink2)">${esc(o.next_action)}</div>
      <div style="font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.title_ar)} · ${esc(clients[o.client_id] || '')}</div></div>
    <span class="tnum" style="font-size:11px;color:var(--muted);flex:0 0 auto">${pct(o.win_pct)}</span></div>`).join('') || '<div style="color:var(--faint);font-size:12px;padding:.5rem 0">لا إجراءات تالية مسجّلة</div>';

  const empty = rows.length === 0;
  const body = empty
    ? noticeCard('لا فرص باسمك بعد', 'لا توجد فرص مملوكة لك حاليًا. عندما تُسند إليك فرصة كمالك ستظهر هنا مع خط أنابيبك الشخصي وإجراءاتك التالية ونسبة فوزك.', '/app/opportunities', 'تصفّح كل الفرص')
    : `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:.75rem;margin-bottom:.9rem">
      ${statMy('خط أنابيبي', fmtSar(total), open.length + ' فرصة مفتوحة')}
      ${statMy('المرجّح', fmtSar(weighted), 'حسب الاحتمالية', 'var(--brand2)')}
      ${statMy('فزت ' + year, wonYear.length, fmtSar(wonValue), 'var(--green)')}
      ${statMy('نسبة فوزي', winRatePct + '%', `${wonAll.length} فوز · ${lostAll.length} خسارة`, winRatePct >= 50 ? 'var(--green)' : 'var(--amber)')}
      ${statMy('إجمالي فرصي', rows.length, 'كل الحالات')}
    </div>
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:.9rem">
      ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;font-size:13.5px">خط أنابيبي — مرتّب حسب القيمة</div><span style="font-size:11px;color:var(--muted)">${open.length} فرصة</span></div>
        <div style="max-height:520px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10.5px;color:var(--muted);text-align:right;position:sticky;top:0;background:var(--surface)">
          <th style="padding:.4rem .7rem">الفرصة</th><th style="padding:.4rem .7rem;text-align:center">المرحلة</th><th style="padding:.4rem .7rem;text-align:left">القيمة</th><th style="padding:.4rem .7rem;text-align:center">الاحتمالية</th><th style="padding:.4rem .7rem">الإجراء التالي</th></tr></thead>
          <tbody>${oppRows || '<tr><td colspan="5" style="padding:1rem;color:var(--muted);font-size:12.5px">لا فرص مفتوحة — كل فرصك مُغلقة</td></tr>'}</tbody></table></div>`)}
      <div style="display:flex;flex-direction:column;gap:.9rem">
        ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">خطي حسب المرحلة</div>
          <div style="padding:.7rem 1rem">${stageItems.length ? hbars(stageItems, { fmt: fmtSar }) : '<div style="color:var(--faint);font-size:12px">لا فرص مفتوحة</div>'}</div>`)}
        ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">إجراءاتي التالية</div>
          <div style="padding:.4rem 1rem .7rem">${actionRows}</div>`)}
      </div>
    </div>`;
  return layout({ user, active: 'my-opportunities', title: 'فرصي', subtitle: `خط الفرص الخاص بي · ${esc(user.name_ar || user.username || '')}`, body });
}

const PRJ_STATUS = [
  { id: 'NOT_STARTED', color: '#94a3b8' }, { id: 'IN_PROGRESS', color: '#2563eb' },
  { id: 'ON_HOLD', color: '#d97706' }, { id: 'COMPLETED', color: '#059669' }, { id: 'CANCELLED', color: '#dc2626' },
];
const ragHex = { GREEN: '#059669', AMBER: '#d97706', RED: '#dc2626' };

export async function projectsPage(user, opts = {}) {
  let rows = await listProjects(user);
  const canCost = canSeeSensitive(user, 'cost');
  const canEdit = can(user, 'update', 'project');
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));
  const sectors = Object.fromEntries((await all('SELECT id,name_ar FROM sector')).map((s) => [s.id, s.name_ar]));
  const ragTone = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
  // Owner lens: filter the board by sector (?sector=). Company-scope only; others already scoped.
  const allSec = await all('SELECT id, name_ar, color FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const secFilter = user.scope === 'company' && opts.sector && allSec.some((s) => s.id === opts.sector) ? opts.sector : null;
  if (secFilter) rows = rows.filter((p) => p.sector_id === secFilter);
  // The legacy source has progress_pct=0 for 37/43 projects and no contract value for 20/43 —
  // present the truth USEFULLY: derive progress from deliverable states (amount-weighted) when the
  // stored figure is 0, and fall back through PO → budget → realized revenue for the money figure.
  const dlv = await all(`SELECT project_id, COUNT(*) n, COALESCE(SUM(amount_halalas),0) tot,
      SUM(CASE WHEN status IN ('DELIVERED','ACCEPTED','INVOICED','PAID') THEN 1 ELSE 0 END) dn,
      COALESCE(SUM(CASE WHEN status IN ('DELIVERED','ACCEPTED','INVOICED','PAID') THEN amount_halalas ELSE 0 END),0) done
      FROM deliverable WHERE deleted_at IS NULL GROUP BY project_id`);
  const dprog = Object.fromEntries(dlv.map((d) => [d.project_id,
    d.tot > 0 ? Math.round((d.done / d.tot) * 100) : (d.n ? Math.round((d.dn / d.n) * 100) : null)]));
  const effProg = (p) => {
    const own = Number(p.progress_pct) || 0;
    if (own > 0) return { v: own, derived: false };
    const dv = p.status === 'COMPLETED' ? 100 : dprog[p.id];
    return dv != null ? { v: dv, derived: true } : { v: 0, derived: false };
  };
  const bestVal = (p) =>
    p.contract_value_halalas ? { v: p.contract_value_halalas, l: 'عقد' } :
    p.po_value_halalas ? { v: p.po_value_halalas, l: 'أمر شراء' } :
    p.budget_halalas ? { v: p.budget_halalas, l: 'ميزانية' } :
    p.revenue_halalas ? { v: p.revenue_halalas, l: 'إيراد محقق' } : { v: 0, l: null };

  // build columns from the standard ladder + any extra statuses present
  const present = [...new Set(rows.map((p) => p.status || 'IN_PROGRESS'))];
  const cols = [...PRJ_STATUS.filter((c) => present.includes(c.id)),
    ...present.filter((s) => !PRJ_STATUS.some((c) => c.id === s)).map((s) => ({ id: s, color: '#64748b' }))];
  if (!cols.length) cols.push({ id: 'IN_PROGRESS', color: '#2563eb' });
  const byStatus = {}; for (const c of cols) byStatus[c.id] = [];
  for (const p of rows) (byStatus[p.status || 'IN_PROGRESS'] ||= []).push(p);

  const prjCard = (p) => {
    const cl = clients[p.client_id] || sectors[p.sector_id] || '';
    const spend = canCost && !p._redacted_actual_spend_halalas ? p.actual_spend_halalas : null;
    const dnd = canEdit ? 'draggable="true" ondragstart="Sanad.kStart(event)" ondragend="Sanad.kEnd(event)"' : '';
    const hay = `${p.name_ar} ${cl}`.toLowerCase().replace(/"/g, '');
    return `<div class="kcard" ${dnd} data-id="${p.id}" data-sector="${p.sector_id || ''}" data-hay="${esc(hay)}" style="--_c:${ragHex[p.rag] || '#cbd5e1'};cursor:pointer" onclick="Sanad.projOpen('${p.id}')">
      <div class="kt">${esc(p.name_ar)}</div>
      <div class="km">${cl ? `<span style="display:inline-flex;align-items:center;gap:.25rem">${icon('building')}${esc(cl)}</span>` : ''}
        ${p.rag ? pill(tr(p.rag), ragTone[p.rag] || 'slate') : ''}</div>
      <div class="km">${(() => { const bv = bestVal(p); const e = effProg(p); return `
        ${bv.l ? `<span class="kv tnum">${fmtSar(bv.v)}</span><span style="font-size:9.5px;font-weight:700;color:var(--faint);background:#eef1f7;border-radius:6px;padding:.1rem .35rem">${bv.l}</span>`
               : '<span style="color:var(--faint);font-size:11px">بلا قيمة مسجلة</span>'}
        <span class="tnum" style="margin-inline-start:auto" ${e.derived ? 'title="محسوبة من حالة المخرجات (المصدر بلا نسبة إنجاز)"' : ''}>${e.v}%${e.derived ? '<span style="color:var(--faint);font-size:9.5px"> ⁎</span>' : ''}</span>`; })()}</div>
      <div class="bar" style="margin-top:.5rem"><span style="width:${Math.min(100, effProg(p).v)}%;background:${ragHex[p.rag] || '#2563eb'}"></span></div>
    </div>`;
  };
  const columns = cols.map((c) => {
    const items = byStatus[c.id] || [];
    const val = items.reduce((a, p) => a + bestVal(p).v, 0);
    const drop = canEdit ? 'ondragover="Sanad.kOver(event)" ondragleave="Sanad.kLeave(event)" ondrop="Sanad.kDrop(event)"' : '';
    return `<div class="kcol" data-stage="${c.id}" ${drop}>
      <div class="kcol-head"><span class="kcol-dot" style="background:${c.color}"></span>
        <span class="t">${tr(c.id)}</span><span class="n" data-count>${items.length}</span>
        <span class="v tnum" data-total>${sarShort(val)}</span></div>
      <div class="kcol-body">${items.map(prjCard).join('') || '<div style="text-align:center;color:var(--faint);font-size:11px;padding:1rem 0">—</div>'}</div>
    </div>`;
  }).join('');

  const tableRows = rows.slice(0, 200).map((p) => `<tr class="border-b border-line" style="cursor:pointer" onclick="Sanad.projOpen('${p.id}')">
    <td class="py-2.5 px-3 text-[13px]">${esc(p.name_ar)}</td>
    <td class="px-3">${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : 'blue')}</td>
    <td class="px-3">${pill(tr(p.rag), ragTone[p.rag] || 'slate')}</td>
    <td class="px-3 text-[13px] tnum">${(() => { const bv = bestVal(p); return bv.l ? `${fmtSar(bv.v)} <span class="text-[10px] text-faint">(${bv.l})</span>` : '—'; })()}</td>
    <td class="px-3 text-[12px] tnum">${canCost && !p._redacted_actual_spend_halalas ? fmtSar(p.actual_spend_halalas) : '<span class="text-slate-300">•••</span>'}</td>
    <td class="px-3 text-[12px] text-muted tnum">${(() => { const e = effProg(p); return `${e.v}%${e.derived ? ' ⁎' : ''}`; })()}</td></tr>`).join('');

  const secChips = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    <a href="/app/projects" class="chip ${secFilter ? '' : 'on'}">الكل</a>
    ${allSec.map((s) => `<a href="/app/projects?sector=${s.id}" class="chip ${secFilter === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || '#2563eb'}"></span>${esc(s.name_ar)}</a>`).join('')}
  </div>` : '';
  const body = `
    ${secChips}
    <div class="toolbar">
      <div class="seg"><button class="on" data-view="kanban" onclick="Sanad.pmoView('prj','kanban')">${icon('kanban')} كانبان</button>
        <button data-view="table" onclick="Sanad.pmoView('prj','table')">${icon('list')} جدول</button></div>
      <div class="search">${icon('search')}<input class="input" id="prj-q" aria-label="بحث في المشاريع" oninput="Sanad.prjFilter()" placeholder="ابحث في المشاريع…"></div>
      <div class="spacer"></div>
      ${canCost ? pill('ترى التكلفة الفعلية', 'green') : pill('التكلفة محجوبة عنك', 'slate')}
      ${canEdit ? `<button class="btn btn-primary" onclick="Sanad.projAdd()">${icon('plus')} مشروع جديد</button>` : ''}
    </div>
    <div style="font-size:10.5px;color:var(--faint);margin:-.5rem 0 .6rem">⁎ نسبة إنجاز محسوبة من حالة المخرجات — المصدر القديم بلا نسبة مسجلة · شارة القيمة توضح أساسها (عقد / أمر شراء / ميزانية / إيراد محقق)</div>
    <div id="prj-kanban" class="kanban" data-kind="prj">${columns}</div>
    <div id="prj-table" class="card" style="display:none;overflow-x:auto">
      <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
        <th class="py-2 px-3 font-medium">المشروع</th><th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">RAG</th>
        <th class="px-3 font-medium">قيمة العقد</th><th class="px-3 font-medium">الصرف الفعلي</th><th class="px-3 font-medium">الإنجاز</th></tr></thead>
      <tbody>${tableRows || '<tr><td class="p-4 text-muted text-sm" colspan="6">لا مشاريع ضمن نطاقك</td></tr>'}</tbody></table></div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{sectors:${JSON.stringify(await all('SELECT id,name_ar FROM sector WHERE active=1 ORDER BY name_ar'))},canEditPrj:${canEdit}});</script>`;
  return layout({ user, active: 'projects', title: 'المشاريع', subtitle: 'PMO · لوحة الحالة', body });
}

export async function tasksPage(user) {
  const rows = await myTasks(user);
  const stColor = { TODO: 'slate', IN_PROGRESS: 'blue', BLOCKED: 'red', IN_REVIEW: 'amber', DONE: 'green' };
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const openT = rows.filter((t) => t.status !== 'DONE');
  const overdue = openT.filter((t) => t.due_date && t.due_date < today).length;
  const dueSoon = openT.filter((t) => t.due_date && t.due_date >= today && t.due_date <= soon).length;
  const blocked = rows.filter((t) => t.status === 'BLOCKED').length;
  const inprog = rows.filter((t) => t.status === 'IN_PROGRESS').length;
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${statMini('مفتوحة', openT.length, 'قيد العمل')}
    ${statMini('قيد التنفيذ', inprog, 'جارية', 'brand')}
    ${statMini('متأخرة', overdue, 'تجاوزت الاستحقاق', overdue ? 'bad' : '')}
    ${statMini('تستحق هذا الأسبوع', dueSoon, 'خلال 7 أيام')}
    ${statMini('معلّقة', blocked, 'محجوبة', blocked ? 'bad' : '')}</div>`;
  const list = rows.map((t) => `<tr class="border-b border-line hover:bg-slate-50" data-task="${t.id}">
    <td class="py-2.5 px-3 text-[13px]">${esc(t.title)}</td>
    <td class="px-3">${pill(tr(t.priority), t.priority === 'P0' ? 'red' : t.priority === 'P1' ? 'amber' : 'slate')}</td>
    <td class="px-3">${pill(tr(t.status), stColor[t.status])}</td>
    <td class="px-3 text-[12px] text-muted">${t.due_date || '—'}</td>
    <td class="px-3"><select onchange="Sanad.setTaskStatus('${t.id}',this.value)" aria-label="تغيير حالة المهمة" class="text-[12px] border border-line rounded px-1 py-0.5">
      ${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${tr(s)}</option>`).join('')}
    </select></td></tr>`).join('');
  const body = `
    ${strip}
    ${card(`<div class="p-4 border-b border-line">
      <div class="font-bold text-sm mb-2">إضافة سريعة</div>
      <div class="flex gap-2">
        <input id="qa-title" placeholder="عنوان المهمة…" class="flex-1 border border-line rounded-lg px-3 py-2 text-sm">
        <select id="qa-priority" class="border border-line rounded-lg px-2 text-sm"><option>P2</option><option>P0</option><option>P1</option><option>P3</option></select>
        <input id="qa-due" type="date" class="border border-line rounded-lg px-2 text-sm">
        <button onclick="Sanad.quickTask()" class="text-white text-[12px] px-4 rounded-lg" style="background:linear-gradient(120deg,#2563eb,#9333ea)">إضافة</button>
      </div></div>
      <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
        <th class="py-2 px-3 font-medium">المهمة</th><th class="px-3 font-medium">الأولوية</th><th class="px-3 font-medium">الحالة</th>
        <th class="px-3 font-medium">الاستحقاق</th><th class="px-3 font-medium">تحديث</th></tr></thead>
        <tbody id="task-rows">${list || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا مهام — أضف واحدة بالأعلى</td></tr>'}</tbody></table>`)}`;
  return layout({ user, active: 'tasks', title: 'مهامي', body });
}

export async function timesheetPage(user) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const rows = await myEntries(user, { from, to });
  const total = rows.reduce((a, r) => a + r.hours, 0);
  const billable = rows.filter((r) => r.billable).reduce((a, r) => a + r.hours, 0);
  const list = rows.map((e) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[13px]">${e.entry_date}</td>
    <td class="px-3 text-[13px]">${e.work_kind}</td>
    <td class="px-3 text-[13px] tabular-nums">${e.hours}</td>
    <td class="px-3">${e.billable ? pill('قابلة للفوترة', 'green') : pill('غير قابلة', 'slate')}</td>
    <td class="px-3 text-[12px] text-muted">${e.note || ''}</td></tr>`).join('');
  const body = `
    <div class="grid grid-cols-3 gap-4 mb-4">
      ${card(`<div class="p-4"><div class="text-[11px] text-muted">إجمالي ساعات الأسبوع</div><div class="text-2xl font-extrabold">${total}</div></div>`)}
      ${card(`<div class="p-4"><div class="text-[11px] text-muted">قابلة للفوترة</div><div class="text-2xl font-extrabold">${billable}</div></div>`)}
      ${card(`<div class="p-4"><div class="text-[11px] text-muted">نسبة الإشغال</div><div class="text-2xl font-extrabold">${total ? Math.round(billable / total * 100) : 0}%</div></div>`)}
    </div>
    ${card(`<div class="p-4 border-b border-line">
      <div class="font-bold text-sm mb-2">تسجيل وقت</div>
      <div class="flex gap-2 flex-wrap">
        <input id="ts-date" type="date" value="${to}" class="border border-line rounded-lg px-2 py-2 text-sm">
        <input id="ts-hours" type="number" step="0.5" min="0" max="16" placeholder="ساعات" class="border border-line rounded-lg px-3 py-2 text-sm w-24">
        <select id="ts-kind" class="border border-line rounded-lg px-2 text-sm">
          ${['project', 'opportunity', 'proposal', 'product', 'internal', 'leave', 'training', 'bd'].map((k) => `<option>${k}</option>`).join('')}
        </select>
        <input id="ts-note" placeholder="ملاحظة" class="flex-1 border border-line rounded-lg px-3 py-2 text-sm">
        <button onclick="Sanad.addTime()" class="text-white text-[12px] px-4 rounded-lg" style="background:linear-gradient(120deg,#2563eb,#9333ea)">تسجيل</button>
      </div></div>
      <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
        <th class="py-2 px-3 font-medium">التاريخ</th><th class="px-3 font-medium">النوع</th><th class="px-3 font-medium">ساعات</th>
        <th class="px-3 font-medium">الفوترة</th><th class="px-3 font-medium">ملاحظة</th></tr></thead>
        <tbody id="ts-rows">${list || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا سجلات هذا الأسبوع</td></tr>'}</tbody></table>`)}`;
  return layout({ user, active: 'timesheet', title: 'سجل الوقت', body });
}

export async function approvalsPage(user) {
  const q = await myApprovalQueue(user);
  const list = q.map((a) => `<tr class="border-b border-line">
    <td class="py-2.5 px-3 text-[13px]">${a.workflow_name}</td>
    <td class="px-3 text-[12px] text-muted">${a.resource} · ${a.resource_id}</td>
    <td class="px-3 text-[13px] tabular-nums">${fmtSar(a.amount_halalas)}</td>
    <td class="px-3">${pill('الخطوة ' + a.current_step, 'amber')}</td>
    <td class="px-3">
      <button onclick="Sanad.approve('${a.id}','approve')" class="text-[12px] text-green-700 font-bold">اعتماد</button>
      <button onclick="Sanad.approve('${a.id}','reject')" class="text-[12px] text-red-600 font-bold mr-2">رفض</button></td></tr>`).join('');
  const totalAmt = q.reduce((a, x) => a + (x.amount_halalas || 0), 0);
  const byRes = {}; for (const x of q) byRes[x.resource] = (byRes[x.resource] || 0) + 1;
  const resBreak = Object.entries(byRes).map(([r, n]) => `${tr(r) || r}: ${n}`).join(' · ') || '—';
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${statMini('بانتظار اعتمادك', q.length, 'طلب')}
    ${statMini('إجمالي المبالغ', fmtSar(totalAmt), 'قيمة قيد الاعتماد', 'brand')}
    ${statMini('حسب النوع', Object.keys(byRes).length, resBreak)}</div>`;
  const body = strip + card(`<div class="p-4 border-b border-line font-bold text-sm">طلبات بانتظار اعتمادك (${q.length})</div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">المسار</th><th class="px-3 font-medium">المورد</th><th class="px-3 font-medium">المبلغ</th>
      <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">إجراء</th></tr></thead>
      <tbody>${list || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا طلبات بانتظارك</td></tr>'}</tbody></table>`);
  return layout({ user, active: 'approvals', title: 'الاعتمادات', body });
}

export async function teamPage(user, opts = {}) {
  const canSalary = canSeeSensitive(user, 'salary');
  const canManage = can(user, 'create', 'employee') || can(user, 'update', 'employee');
  const canCreate = can(user, 'create', 'employee');
  const allSec = await all('SELECT id, name_ar, color FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const sectorNames = Object.fromEntries(allSec.map((s) => [s.id, s.name_ar]));
  const { year, sector, currentMonth, roster } = await staffingRoster(user, { sector: opts.sector });
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const curName = currentMonth ? MONTHS[currentMonth - 1] : '';
  const projects = await all(`SELECT id, name_ar, sector_id FROM project WHERE deleted_at IS NULL AND status IN ('IN_PROGRESS','PLANNED')
     ${sector ? 'AND sector_id = ?' : ''} ORDER BY name_ar`, sector ? [sector] : []);

  const activeN = roster.filter((e) => e.active !== 0).length;
  const avgCurrent = roster.length ? Math.round(roster.reduce((a, e) => a + e.currentUtil, 0) / roster.length) : 0;
  const avgAnnual = roster.length ? Math.round(roster.reduce((a, e) => a + e.annualUtil, 0) / roster.length) : 0;
  const overNow = roster.filter((e) => e.currentUtil > 100).length;
  const benchNow = roster.filter((e) => e.active !== 0 && e.currentUtil === 0).length;
  const totalSalary = canSalary ? roster.reduce((a, e) => a + (e.salary_halalas || 0), 0) : null;
  const avgSalary = canSalary && roster.length ? Math.round(totalSalary / roster.length) : null;
  const uTone = (u) => u > 100 ? 'var(--red)' : u >= 70 ? 'var(--green)' : u >= 40 ? 'var(--amber)' : u > 0 ? 'var(--blue)' : 'var(--faint)';

  const byType = {}; for (const e of roster) { const t = e.employment_type || 'غير محدد'; byType[t] = (byType[t] || 0) + 1; }
  const typeItems = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n], i) => ({ label: esc(t), value: n, color: ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706'][i % 5] }));
  // Distribution of THIS MONTH's load (the actionable "now" view).
  const buckets = [
    { label: 'على المقعد (0%)', test: (u) => u === 0, color: '#94a3b8' },
    { label: 'منخفض (<40%)', test: (u) => u > 0 && u < 40, color: '#2563eb' },
    { label: 'صحي (40–70%)', test: (u) => u >= 40 && u < 70, color: '#0891b2' },
    { label: 'عالٍ (70–100%)', test: (u) => u >= 70 && u <= 100, color: '#059669' },
    { label: 'فوق الطاقة (>100%)', test: (u) => u > 100, color: '#dc2626' },
  ].map((b) => ({ label: b.label, value: roster.filter((e) => e.active !== 0 && b.test(e.currentUtil)).length, color: b.color }));

  const rowsHtml = roster.map((e) => {
    const projTip = e.projects.map((p) => esc(p.name)).join('، ') || 'بلا تسكين';
    return `<tr class="border-b border-line" style="vertical-align:middle">
    <td class="py-2 px-3 text-[13px]">${esc(e.name_ar)}${e.active === 0 ? ' ' + pill('غير نشط', 'slate') : ''}
      <div style="font-size:10.5px;color:var(--muted)">${esc(e.job_title || '—')}${sector ? '' : ' · ' + esc(sectorNames[e.sector_id] || '—')}</div></td>
    <td class="px-3 text-[12px]">${esc(e.employment_type || '—')}</td>
    <td class="px-3" style="min-width:215px">
      <div style="display:flex;align-items:center;gap:.5rem">
        <span class="tnum" style="font-weight:800;font-size:14px;color:${uTone(e.currentUtil)};min-width:40px" title="إشغال ${curName}">${e.currentUtil}%</span>
        <div style="flex:1">${utilStrip(e.months, currentMonth)}</div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:.15rem">${curName ? curName + ' · ' : ''}سنويًا ${e.annualUtil}% · مُسكّن ${e.staffedMonths}/12${e.overMonths ? ` · <span style="color:var(--red);font-weight:700">تجاوز ${e.overMonths} شهر</span>` : ''}</div></td>
    <td class="px-3 text-[12px] tnum" title="${projTip}">${e.projectCount ? `<span class="pill" style="background:#dbeafe;color:#2563eb">${e.projectCount} مشروع</span>` : '<span style="color:var(--faint)">—</span>'}</td>
    ${canSalary ? `<td class="px-3 text-[13px] tabular-nums">${e.salary_halalas ? fmtSar(e.salary_halalas) : '<span style="color:var(--faint)">—</span>'}</td>` : ''}
    ${canManage ? `<td class="px-3"><div style="display:flex;gap:.3rem">
      <button class="btn btn-sm btn-ghost" onclick="Sanad.empEdit('${e.id}')" title="تعديل">✎</button>
      <button class="btn btn-sm btn-ghost" onclick="Sanad.empAssign('${e.id}')" title="تسكين على مشروع">＋مشروع</button></div></td>` : ''}
  </tr>`; }).join('');

  const th = (t, a) => `<th class="px-3 py-2 font-medium" style="text-align:${a || 'right'}">${t}</th>`;
  const kpi = (l, v, sub, tone) => card(`<div style="padding:.75rem .95rem"><div style="font-size:11px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.3rem;${tone ? 'color:' + tone : ''}">${v}</div>${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const secChips = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    <a href="/app/team" class="chip ${sector ? '' : 'on'}">الكل</a>
    ${allSec.map((s) => `<a href="/app/team?sector=${s.id}" class="chip ${sector === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || '#2563eb'}"></span>${esc(s.name_ar)}</a>`).join('')}
  </div>` : '';

  const body = `
    ${secChips}
    <div class="toolbar" style="margin-bottom:.8rem">
      <div style="font-weight:800;font-size:14px">${sector ? esc(sectorNames[sector]) : 'كل القطاعات'} · ${roster.length} عضو</div>
      <div class="spacer"></div>
      ${canManage ? pill('لديك صلاحية إدارة الفريق', 'green') : pill('عرض فقط', 'slate')}
      ${canCreate ? `<button class="btn btn-primary" onclick="Sanad.empAdd()">${icon('plus')} إضافة موظف</button>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem;margin-bottom:.9rem">
      ${kpi('إجمالي الأعضاء', roster.length, `${activeN} نشط`)}
      ${kpi(`إشغال ${curName || year} (متوسط)`, avgCurrent + '%', `متوسط السنة ${avgAnnual}%`, uTone(avgCurrent))}
      ${kpi('على المقعد الآن', benchNow, `بلا تسكين في ${curName || 'الفترة'}`, benchNow ? 'var(--amber)' : 'var(--green)')}
      ${kpi('فوق الطاقة الآن', overNow, `> 100% في ${curName || 'الفترة'}`, overNow ? 'var(--red)' : 'var(--green)')}
      ${canSalary ? kpi('فاتورة الرواتب', totalSalary ? fmtSar(totalSalary) : '—', totalSalary ? `متوسط ${fmtSar(avgSalary)}` : 'غير مسجّلة في بيانات العرض', 'var(--brand2)') : ''}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">توزيع الإشغال — ${curName || year}</div><div style="padding:.7rem 1rem">${hbars(buckets, { fmt: (v) => v + ' موظف' })}</div>`)}
      ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">حسب نوع التوظيف</div><div style="padding:.7rem 1rem">${hbars(typeItems, { fmt: (v) => v + ' عضو' })}</div>`)}
    </div>
    <div style="font-size:10.5px;color:var(--faint);margin-bottom:.55rem">الرقم الكبير = <b>إشغال ${curName || 'الشهر الحالي'}</b> (تسكين الموظف هذا الشهر)؛ «سنويًا» = متوسط تسكينه عبر أشهر ${year}. الشريط يعرض الاثني عشر شهرًا (يناير→ديسمبر) والشهر الحالي مُحاط بإطار — أخضر ≥80% · أصفر · أزرق منخفض · أحمر تجاوز الطاقة · رمادي بلا تسكين. المصدر نموذج التسكين (allocation) وليس ساعات فعلية. الترتيب حسب الأكثر إشغالًا الآن.</div>
    ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">أعضاء الفريق والإشغال</div>
      <div style="overflow-x:auto"><table class="w-full" style="border-collapse:collapse"><thead><tr class="text-[11px] text-muted">
      ${th('الموظف')}${th('النوع')}${th(`الإشغال (${curName || 'الحالي'} · السنوي)`)}${th('المشاريع', 'center')}${canSalary ? th('الراتب') : ''}${canManage ? th('إجراءات', 'center') : ''}
      </tr></thead><tbody>${rowsHtml || `<tr><td colspan="6" style="padding:1.2rem;color:var(--muted);text-align:center">لا أعضاء ضمن نطاقك</td></tr>`}</tbody></table></div>`)}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      emps:${JSON.stringify(Object.fromEntries(roster.map((e) => [e.id, { name_ar: e.name_ar, job_title: e.job_title, employment_type: e.employment_type, status: e.status, active: e.active, sector_id: e.sector_id, salary_sar: canSalary ? Math.round((e.salary_halalas || 0) / 100) : null, projects: e.projects.map((p) => ({ allocId: p.allocId, name: p.name, projectId: p.projectId })) }])))},
      teamSectors:${JSON.stringify(allSec.map((s) => ({ id: s.id, name_ar: s.name_ar })))},
      teamProjects:${JSON.stringify(projects.map((p) => ({ id: p.id, name_ar: p.name_ar, sector_id: p.sector_id })))},
      canSalary:${canSalary}, canManage:${canManage}, teamSectorLocked:${JSON.stringify(sector)}});</script>`;
  return layout({ user, active: 'team', title: 'الفريق والتسكين', subtitle: `الموارد البشرية · الإشغال والتسكين · ${curName || ''} ${year}`, body });
}

export async function usersPage(user) {
  const rows = await all(`SELECT u.*, r.name_ar role_name FROM app_user u LEFT JOIN role r ON r.id = u.role_id
    WHERE u.deleted_at IS NULL ORDER BY u.role_id, u.name_ar LIMIT 300`);
  const list = rows.map((u) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[13px]">${esc(u.name_ar || '')}<div class="text-[11px] text-muted">${esc(u.username || '— بلا دخول')}</div></td>
    <td class="px-3">${pill(u.role_name || u.role_id, 'blue')}</td>
    <td class="px-3 text-[12px]">${u.sector_id || '—'}</td>
    <td class="px-3">${u.active ? pill('نشط', 'green') : pill('معطّل', 'red')}</td>
    <td class="px-3 text-[11px] text-muted">${u.last_login_at ? u.last_login_at.slice(0, 10) : 'لم يدخل'}</td></tr>`).join('');
  const activeN = rows.filter((u) => u.active).length;
  const neverIn = rows.filter((u) => !u.last_login_at).length;
  const byRole = {}; for (const u of rows) { const r = u.role_name || u.role_id || '—'; byRole[r] = (byRole[r] || 0) + 1; }
  const roleItems = Object.entries(byRole).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r, n], i) => ({ label: esc(r), value: n, color: ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#db2777'][i % 6] }));
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:.9rem">
    ${statMini('إجمالي المستخدمين', rows.length, `${Object.keys(byRole).length} دور`)}
    ${statMini('نشط', activeN, 'حسابات مفعّلة', 'good')}
    ${statMini('معطّل', rows.length - activeN, 'حسابات موقوفة', rows.length - activeN ? 'bad' : '')}
    ${statMini('لم يسجّل دخولًا', neverIn, 'حسابات خاملة', neverIn ? 'warn' : '')}</div>`;
  const body = `${strip}
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:.9rem">
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">المستخدمون والصلاحيات (${rows.length})</div>
      <div style="max-height:520px;overflow-y:auto"><table class="w-full"><thead><tr class="text-[11px] text-muted text-right" style="position:sticky;top:0;background:var(--surface)">
        <th class="py-2 px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الدور</th><th class="px-3 font-medium">القطاع</th>
        <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">آخر دخول</th></tr></thead><tbody>${list}</tbody></table></div>`)}
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">التوزيع حسب الدور</div><div style="padding:.7rem 1rem">${hbars(roleItems, { fmt: (v) => v + '' })}</div>`)}
    </div>
    <div class="mt-3 text-[11px] text-muted">التفويض يُنفَّذ على الخادم. تعطيل حسابك أو خفض دورك بنفسك ممنوع خادميًا. الرواتب وعناوين IP محجوبة عن غير المصرّح لهم.</div>`;
  return layout({ user, active: 'users', title: 'المستخدمون والصلاحيات', body });
}

export async function auditPage(user) {
  const rows = await all('SELECT * FROM audit_log ORDER BY at DESC LIMIT 200');
  const today = new Date().toISOString().slice(0, 10);
  const todayN = rows.filter((a) => (a.at || '').slice(0, 10) === today).length;
  const distinctUsers = new Set(rows.map((a) => a.username || a.user_id).filter(Boolean)).size;
  const byAction = {}; for (const a of rows) { const k = a.action || '—'; byAction[k] = (byAction[k] || 0) + 1; }
  const actItems = Object.entries(byAction).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n], i) => ({ label: esc(tr(k) || k), value: n, color: ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'][i % 6] }));
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:.9rem">
    ${statMini('أحداث (آخر 200)', rows.length, 'مسجّلة')}
    ${statMini('اليوم', todayN, 'حدث اليوم', 'brand')}
    ${statMini('مستخدمون نشطون', distinctUsers, 'في السجل')}
    ${statMini('أنواع الإجراءات', Object.keys(byAction).length, 'مختلفة')}</div>`;
  const list = rows.map((a) => `<tr class="border-b border-line">
    <td class="py-1.5 px-3 text-[11px] text-muted tabular-nums">${a.at.slice(0, 19).replace('T', ' ')}</td>
    <td class="px-3 text-[12px]">${esc(a.username || a.user_id || '—')}</td>
    <td class="px-3">${pill(tr(a.action), a.action === 'delete' ? 'red' : a.action === 'create' ? 'green' : 'slate')}</td>
    <td class="px-3 text-[12px]">${esc(a.resource || '')} ${a.resource_id ? '· ' + esc(a.resource_id) : ''}</td></tr>`).join('');
  const body = `${strip}
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:.9rem">
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">سجل التدقيق (آخر 200)</div>
      <div style="max-height:540px;overflow-y:auto"><table class="w-full"><thead><tr class="text-[11px] text-muted text-right" style="position:sticky;top:0;background:var(--surface)">
        <th class="py-2 px-3 font-medium">الوقت</th><th class="px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الإجراء</th>
        <th class="px-3 font-medium">المورد</th></tr></thead><tbody>${list}</tbody></table></div>`)}
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">التوزيع حسب نوع الإجراء</div><div style="padding:.7rem 1rem">${hbars(actItems, { fmt: (v) => v + '' })}</div>`)}
    </div>`;
  return layout({ user, active: 'audit', title: 'سجل التدقيق', body });
}

export async function reportsPage(user) {
  const defs = await all('SELECT * FROM report_definition WHERE active = 1 ORDER BY id');
  const groups = await all('SELECT * FROM recipient_group ORDER BY name_ar');
  const schedules = await all('SELECT rs.*, rd.name_ar rname, rg.name_ar gname FROM report_schedule rs JOIN report_definition rd ON rd.id = rs.report_id LEFT JOIN recipient_group rg ON rg.id = rs.recipient_group_id ORDER BY rs.created_at DESC LIMIT 50');
  const outbox = await all('SELECT * FROM email_queue ORDER BY created_at DESC LIMIT 15');
  const freqAr = { daily: 'يومي', weekly: 'أسبوعي', biweekly: 'كل أسبوعين', monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي' };

  const reportCards = defs.map((d) => card(`<div style="padding:.9rem 1rem">
    <div style="font-weight:700;font-size:13px;margin-bottom:.5rem">${esc(d.name_ar)}</div>
    <div style="display:flex;gap:.4rem">
      <button onclick="Sanad.previewReport('${d.key}')" class="text-white" style="border:none;cursor:pointer;font-size:11px;padding:.35rem .6rem;border-radius:8px;background:var(--brand-grad)">معاينة</button>
      <button onclick="Sanad.testSend('${d.key}')" style="border:1px solid var(--line);cursor:pointer;font-size:11px;padding:.35rem .6rem;border-radius:8px;background:#fff">إرسال تجريبي</button>
    </div></div>`, 'card-h')).join('');

  const schedList = schedules.map((s) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:13px">${s.rname}</td>
    <td style="padding:.5rem .75rem;font-size:12px">${freqAr[s.frequency] || s.frequency}</td>
    <td style="padding:.5rem .75rem;font-size:12px;color:var(--muted)">${s.gname || '—'}</td>
    <td style="padding:.5rem .75rem">${s.active ? pill('مفعّل', 'green') : pill('موقوف', 'slate')}</td>
    <td style="padding:.5rem .75rem;font-size:11px;color:var(--muted)">${s.next_run_at ? s.next_run_at.slice(0, 10) : '—'}</td></tr>`).join('');
  const outList = outbox.map((q) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:12px">${q.subject || ''}</td>
    <td style="padding:.5rem .75rem">${pill(tr(q.status), q.status === 'SENT' ? 'green' : q.status === 'FAILED' ? 'red' : 'amber')}</td>
    <td style="padding:.5rem .75rem;font-size:11px;color:var(--muted)">${q.created_at.slice(0, 16).replace('T', ' ')}</td></tr>`).join('');

  const body = `
    <div style="font-weight:800;font-size:14px;margin-bottom:.5rem">التقارير المتاحة</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.25rem">${reportCards}</div>
    ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:14px;margin-bottom:.6rem">جدولة تقرير جديد</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
        <select id="sch-report" aria-label="التقرير" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;font-size:13px">${defs.map((d) => `<option value="${d.id}">${d.name_ar}</option>`).join('')}</select>
        <select id="sch-freq" aria-label="تكرار الإرسال" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;font-size:13px">${Object.entries(freqAr).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select id="sch-group" aria-label="مجموعة المستلمين" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;font-size:13px"><option value="">— مجموعة مستلمين —</option>${groups.map((g) => `<option value="${g.id}">${g.name_ar}</option>`).join('')}</select>
        <input id="sch-time" type="time" value="08:00" aria-label="وقت الإرسال" style="border:1px solid var(--line);border-radius:8px;padding:.35rem .5rem;font-size:13px">
        <button onclick="Sanad.addSchedule()" class="text-white" style="border:none;cursor:pointer;font-size:13px;padding:.45rem 1rem;border-radius:8px;background:var(--brand-grad)">جدولة</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:.5rem">الصلاحيات تُنفَّذ لكل مستلم وقت الإرسال — لا تُرسَل الأرقام الحساسة لمن لا يملك صلاحيتها.</div></div>`)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1.25rem">
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">التقارير المجدولة</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">التقرير</th><th style="padding:.4rem .75rem">التكرار</th><th style="padding:.4rem .75rem">المستلمون</th><th style="padding:.4rem .75rem">الحالة</th><th style="padding:.4rem .75rem">التالي</th></tr></thead><tbody>${schedList || '<tr><td style="padding:1rem;color:var(--muted);font-size:13px" colspan="5">لا جداول بعد</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">سجل الإرسال (Outbox)</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">الموضوع</th><th style="padding:.4rem .75rem">الحالة</th><th style="padding:.4rem .75rem">الوقت</th></tr></thead><tbody>${outList || '<tr><td style="padding:1rem;color:var(--muted);font-size:13px" colspan="3">لا رسائل بعد</td></tr>'}</tbody></table>`)}
    </div>
    <div id="report-preview" style="margin-top:1rem"></div>`;
  return layout({ user, active: 'reports', title: 'التقارير والبريد', subtitle: 'محرك تقارير تنفيذية + جدولة + بريد', body });
}

export async function orgPage(user) {
  const tree = await orgTree(user);
  const sectorBlocks = tree.map((s) => card(`<div style="padding:1rem">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:.5rem">
        <span style="width:11px;height:11px;border-radius:3px;background:${s.color || '#2563eb'}"></span>
        <div style="font-weight:800">${esc(s.name_ar)}</div>
        ${s.is_placeholder ? pill('قالب', 'amber') : pill(`${s.employees} موظف`, 'blue')}
      </div>
      <span style="font-size:11px;color:var(--muted)">${s.id}</span>
    </div>
    <div style="margin-top:.6rem;display:flex;flex-direction:column;gap:.35rem">
      ${(s.departments || []).map((d) => `<div style="display:flex;align-items:center;gap:.5rem;font-size:13px;padding:.3rem .5rem;background:var(--bg);border-radius:8px">
        <span style="color:var(--muted)">↳</span><span style="flex:1">${esc(d.name_ar)}</span>
        <span style="font-size:11px;color:var(--muted)">${d.units.length} وحدة · ${d.employees} موظف</span></div>`).join('') || '<div style="font-size:12px;color:var(--faint)">لا إدارات — أضِف واحدة</div>'}
    </div>
    <div style="margin-top:.6rem;display:flex;gap:.4rem">
      <input id="dep-${s.id}" placeholder="اسم إدارة جديدة…" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:.35rem .6rem;font-size:12px">
      <button onclick="Sanad.addDept('${s.id}')" style="color:#fff;border:none;cursor:pointer;padding:0 .8rem;border-radius:8px;font-size:12px;background:var(--brand-grad)">+ إدارة</button>
    </div>
  </div>`, 'card-h')).join('');
  const body = `
    ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:14px;margin-bottom:.5rem">إضافة قطاع جديد</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <input id="sec-id" placeholder="المعرّف (EN, مثل FINTECH)" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .7rem;font-size:13px;width:200px">
        <input id="sec-ar" placeholder="اسم القطاع (عربي)" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .7rem;font-size:13px;flex:1">
        <input id="sec-tgt" type="number" placeholder="مستهدف المبيعات (ر.س.)" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .7rem;font-size:13px;width:200px">
        <button onclick="Sanad.addSector()" style="color:#fff;border:none;cursor:pointer;padding:0 1rem;border-radius:8px;font-size:13px;background:var(--brand-grad)">+ قطاع</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:.5rem">الهيكل مرن بالكامل — تُضاف القطاعات/الإدارات من هنا دون تعديل الكود.</div></div>`)}
    <div style="font-weight:800;font-size:14px;margin:1.25rem 0 .5rem">الهيكل التنظيمي</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem">${sectorBlocks}</div>`;
  return layout({ user, active: 'org', title: 'الهيكل التنظيمي', subtitle: 'الشركة ← القطاع ← الإدارة ← الوحدة ← الفريق ← الموظف', body });
}

export async function financePage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const s = await financeSummary(user, year);
  const byPM = await financeByPM(user, year);
  const byClient = await financeByClient(user, year);
  const byContract = await financeByContract(user);
  const tile = (l, v, sub, color) => card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">${l}</div>
    <div class="metric" style="font-size:1.35rem;${color ? 'color:' + color : ''}">${v}</div>${sub ? `<div style="font-size:11px;color:var(--muted)">${sub}</div>` : ''}</div>`);
  // bridge: bookings → revenue → invoiced → collected
  const bridge = [['الحجوزات', s.bookings_halalas, '#2563eb'], ['الإيراد المحقق', s.revenue_halalas, '#7c3aed'],
    ['المُفوتر', s.invoiced_halalas, '#0891b2'], ['المُحصَّل', s.collected_halalas, '#059669']];
  const maxB = Math.max(1, ...bridge.map((b) => b[1]));
  const bridgeHtml = bridge.map((b) => `<div style="flex:1;text-align:center">
    <div style="font-size:11px;color:var(--muted)">${b[0]}</div>
    <div style="font-weight:800;font-size:15px" class="tnum">${fmtSar(b[1])}</div>
    <div class="bar" style="margin-top:.35rem"><span style="width:${Math.round(b[1] / maxB * 100)}%;background:${b[2]}"></span></div></div>`).join('<div style="color:var(--faint);align-self:center;padding:0 .3rem">←</div>');
  const agingMax = Math.max(1, ...Object.values(s.aging));
  const agingHtml = Object.entries(s.aging).map(([k, v]) => `<div style="display:flex;align-items:center;gap:.5rem;font-size:12px;padding:.2rem 0">
    <span style="width:52px;color:var(--muted)">${k} يوم</span>
    <div class="bar" style="flex:1"><span style="width:${Math.round(v / agingMax * 100)}%;background:${k === '90+' ? 'var(--red)' : k === '61-90' ? 'var(--amber)' : 'var(--brand)'}"></span></div>
    <span class="tnum" style="width:90px;text-align:left">${fmtSar(v)}</span></div>`).join('');
  // Client concentration by contract value — the reliable, richly-populated finance signal (invoices in this
  // dataset are largely not contract-linked, so aggregate AR lives in the KPIs/bridge, not per-client here).
  const maxClientVal = Math.max(1, ...byClient.map((c) => c.value_halalas));
  const clientRows = byClient.slice(0, 13).map((c, i) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.42rem .7rem;font-size:12.5px;color:var(--faint);width:20px" class="tnum">${i + 1}</td>
    <td style="padding:.42rem .7rem;font-size:12.5px">${esc(c.name_ar)}</td>
    <td style="padding:.42rem .7rem;text-align:center;font-size:11.5px;color:var(--muted)" class="tnum">${c.contracts}</td>
    <td style="padding:.42rem .7rem;width:150px"><div style="display:flex;align-items:center;gap:.4rem"><div class="bar" style="flex:1"><span style="width:${Math.round(c.value_halalas / maxClientVal * 100)}%;background:var(--brand)"></span></div><span style="font-size:11.5px;white-space:nowrap" class="tnum">${sarShort(c.value_halalas)}</span></div></td></tr>`).join('');
  // Portfolio-summary stats fill the right column with meaningful computed metrics (no sparse whitespace).
  const liveContracts = byContract.filter((c) => !c.unassigned);
  const totalCV = liveContracts.reduce((a, c) => a + (c.value_halalas || 0), 0);
  const totalBacklog = liveContracts.reduce((a, c) => a + (c.backlog_halalas || 0), 0);
  const avgCV = liveContracts.length ? Math.round(totalCV / liveContracts.length) : 0;
  const sumStat = (l, v, tone) => `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:.5rem 0;border-bottom:1px dashed var(--line)"><span style="font-size:12px;color:var(--muted)">${l}</span><span class="tnum" style="font-weight:800;font-size:14px;${tone ? 'color:' + tone : ''}">${v}</span></div>`;
  // Keep the top contracts by value AND always retain the 'unassigned' reconciliation bucket (it is
  // appended last by financeByContract, so a plain slice would drop it and understate the total).
  const cTop = byContract.filter((c) => !c.unassigned).slice(0, 30);
  const cBucket = byContract.find((c) => c.unassigned);
  const cRows = [...cTop, ...(cBucket ? [cBucket] : [])].map((c) => `<tr style="border-bottom:1px solid var(--line)${c.unassigned ? '' : ';cursor:pointer'}" ${c.unassigned ? '' : `onclick="location.href='/app/contract/${c.id}'"`}>
    <td style="padding:.5rem .75rem;font-size:13px">${esc(c.project_name || c.code || c.id)}<div style="font-size:11px;color:var(--muted)">${esc(c.client_name || '')}</div></td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(c.value_halalas)}</td>
    <td style="padding:.5rem .75rem;text-align:center">${c.billed_pct == null ? '<span style="font-size:11px;color:var(--muted)">—</span>' : `<div class="bar" style="width:70px;display:inline-block;vertical-align:middle"><span style="width:${Math.min(100, c.billed_pct)}%;background:var(--brand)"></span></div> <span style="font-size:11px">${c.billed_pct}%</span>`}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center;color:var(--muted)" class="tnum">${fmtSar(c.backlog_halalas)}</td></tr>`).join('');
  const body = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:.85rem;margin-bottom:1.25rem">
      ${tile('الحجوزات', fmtSar(s.bookings_halalas))}
      ${tile('المُفوتر', fmtSar(s.invoiced_halalas))}
      ${tile('الذمم المدينة (AR)', fmtSar(s.ar_halalas), 'مستحق غير محصَّل', 'var(--amber)')}
      ${tile('معدل التحصيل', s.collectionRate + '%')}
      ${tile('DSO', s.dso + ' يوم', 'فترة التحصيل')}
    </div>
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:1rem;margin-bottom:1.25rem">
      ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:14px;margin-bottom:.75rem">الجسر المالي · ${year}</div>
        <div style="display:flex;align-items:stretch">${bridgeHtml}</div></div>`)}
      ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:14px;margin-bottom:.5rem">أعمار الذمم المدينة</div>${agingHtml}</div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:1rem;margin-bottom:1.25rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center"><div style="font-weight:800;font-size:13px">تركّز العملاء حسب قيمة العقود</div><span style="font-size:10.5px;color:var(--muted)">${byClient.length} عميل</span></div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10.5px;color:var(--muted);text-align:right"><th style="padding:.4rem .7rem"></th><th style="padding:.4rem .7rem">العميل</th><th style="padding:.4rem .7rem;text-align:center">عقود</th><th style="padding:.4rem .7rem">قيمة العقود</th></tr></thead>
        <tbody>${clientRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:12.5px" colspan="4">لا عملاء بعقود</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">ملخص محفظة العقود</div>
        <div style="padding:.4rem 1rem .7rem">
          ${sumStat('إجمالي العقود', liveContracts.length + ' عقد')}
          ${sumStat('إجمالي قيمة العقود', fmtSar(totalCV))}
          ${sumStat('متوسط قيمة العقد', fmtSar(avgCV))}
          ${sumStat('Backlog (غير مُفوتر)', fmtSar(totalBacklog), 'var(--brand2)')}
          ${sumStat('المُحصَّل / المُفوتر', s.collectionRate + '%', s.collectionRate < 40 ? 'var(--red)' : 'var(--green)')}
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:.5rem 0"><span style="font-size:12px;color:var(--muted)">مدير المشروع الأنشط</span><span style="font-size:12px;font-weight:700">${esc((byPM.filter((p) => p.invoiced_halalas > 0)[0] || {}).pm || '—')}</span></div>
        </div>`)}
    </div>
    ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center"><div style="font-weight:800;font-size:13px">العقود · اضغط أي عقد للتفصيل والمستخلصات</div><span style="font-size:11px;color:var(--muted)">${cTop.length} عقد</span></div>
      <div style="max-height:460px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10.5px;color:var(--muted);text-align:right;position:sticky;top:0;background:var(--surface)"><th style="padding:.4rem .75rem">العقد/المشروع</th><th style="padding:.4rem .75rem;text-align:center">القيمة</th><th style="padding:.4rem .75rem;text-align:center">نسبة الفوترة</th><th style="padding:.4rem .75rem;text-align:center">Backlog</th></tr></thead>
      <tbody>${cRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:12.5px" colspan="4">لا عقود</td></tr>'}</tbody></table></div>`)}`;
  return layout({ user, active: 'finance', title: 'المالية', subtitle: `عقود · فواتير · مستخلصات · تحصيل · السنة ${year}`, body, year });
}

function noticeCard(title, msg, backHref = '/', backLabel = 'العودة') {
  return `<div style="max-width:440px;margin:64px auto;text-align:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:40px 32px;box-shadow:0 4px 24px rgba(15,23,42,.05)">
    <div style="font-size:16px;font-weight:700;color:#0f172a">${title}</div>
    <div style="font-size:13px;color:var(--muted);margin-top:8px;line-height:1.7">${msg}</div>
    <a href="${backHref}" style="display:inline-block;margin-top:20px;background:linear-gradient(120deg,#2563eb,#9333ea);color:#fff;text-decoration:none;padding:9px 22px;border-radius:10px;font-size:13px;font-weight:600">${backLabel}</a>
  </div>`;
}

export async function contractDetailPage(user, contractId) {
  let d;
  try { d = await contractDetail(user, contractId); } catch (e) { return layout({ user, active: 'finance', title: 'العقد', body: noticeCard('تعذّر عرض العقد', e.message, '/app/finance', 'العودة للمالية') }); }
  const c = d.contract;
  const invRows = d.invoices.map((i) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:13px">${i.kind === 'progress_claim' ? 'مستخلص #' + (i.claim_no || '') : (i.code || i.id)}${i.period_label ? `<div style="font-size:11px;color:var(--muted)">${i.period_label}</div>` : ''}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(i.amount_halalas)}</td>
    <td style="padding:.5rem .75rem;text-align:center">${pill(tr(i.status), i.status === 'PAID' ? 'green' : i.status === 'OVERDUE' ? 'red' : i.status === 'PARTIALLY_PAID' ? 'amber' : 'blue')}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center;color:var(--amber)" class="tnum">${fmtSar(i.outstanding_halalas)}</td>
    <td style="padding:.5rem .75rem;text-align:center">${i.outstanding_halalas > 0 ? `<button onclick="Sanad.recordCollection('${i.id}', ${i.outstanding_halalas / 100})" style="border:1px solid var(--line);cursor:pointer;font-size:11px;padding:.25rem .5rem;border-radius:6px;background:#fff">تسجيل تحصيل</button>` : '✓'}</td></tr>`).join('');
  const eligible = d.deliverables.filter((dl) => ['DELIVERED', 'ACCEPTED'].includes(dl.status));
  const dlvRows = d.deliverables.map((dl) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .75rem;font-size:13px">${esc(dl.name_ar)}</td>
    <td style="padding:.4rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(dl.amount_halalas)}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(tr(dl.status), dl.status === 'PAID' || dl.status === 'INVOICED' ? 'green' : dl.status === 'DELIVERED' ? 'blue' : 'slate')}</td></tr>`).join('');
  const body = `
    <a href="/app/finance" style="font-size:12px;color:var(--muted)">← المالية</a>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.85rem;margin:.75rem 0 1.25rem">
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">قيمة العقد</div><div class="metric" style="font-size:1.3rem">${fmtSar(c.value_halalas)}</div></div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">نسبة الفوترة</div><div class="metric" style="font-size:1.3rem">${d.billed_pct}%</div></div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">Backlog متبقٍّ</div><div class="metric" style="font-size:1.3rem">${fmtSar(d.backlog_halalas)}</div></div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">العميل</div><div style="font-weight:700;font-size:15px;margin-top:.4rem">${esc(d.client || '—')}</div></div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;font-size:13px">المستخلصات والفواتير</div>
        ${eligible.length ? `<button onclick="Sanad.progressClaim('${c.id}')" class="text-white" style="border:none;cursor:pointer;font-size:12px;padding:.35rem .8rem;border-radius:8px;background:var(--brand-grad)">+ مستخلص من ${eligible.length} مخرج مسلّم</button>` : '<span style="font-size:11px;color:var(--muted)">لا مخرجات مؤهلة</span>'}</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">المستخلص/الفاتورة</th><th style="padding:.4rem .75rem;text-align:center">القيمة</th><th style="padding:.4rem .75rem;text-align:center">الحالة</th><th style="padding:.4rem .75rem;text-align:center">متبقٍّ</th><th style="padding:.4rem .75rem"></th></tr></thead>
        <tbody>${invRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:13px" colspan="5">لا مستخلصات بعد — أنشئ واحدًا من المخرجات المسلّمة</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">مخرجات المشروع</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">المخرج</th><th style="padding:.4rem .75rem;text-align:center">القيمة</th><th style="padding:.4rem .75rem;text-align:center">الحالة</th></tr></thead>
        <tbody>${dlvRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:13px" colspan="3">لا مخرجات</td></tr>'}</tbody></table>`)}
    </div>`;
  return layout({ user, active: 'finance', title: `العقد — ${esc(c.code || c.id)}`, subtitle: esc(d.project?.name_ar || ''), body });
}

export async function projectDetailPage(user, projectId) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('المشروع غير موجود', 'ربما حُذف المشروع أو أن الرابط غير صحيح.', '/app/projects', 'العودة للمشاريع') });
  if (!can(user, 'read', 'project', p)) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('لا تملك صلاحية الوصول', 'هذا المشروع خارج نطاق صلاحياتك الحالية — تواصل مع مدير النظام إن كنت تحتاج الوصول.', '/app/projects', 'العودة للمشاريع') });
  const row = redact(user, 'project', p);
  const k = await projectKpis(p.id);
  const canCost = canSeeSensitive(user, 'cost');
  const canEdit = can(user, 'update', 'project', p);
  const tasks = await all("SELECT status, COUNT(*) n FROM task WHERE project_id=? AND deleted_at IS NULL GROUP BY status", [p.id]);
  const tmap = Object.fromEntries(tasks.map((t) => [t.status, t.n]));
  const dlv = await all("SELECT name_ar, amount_halalas, status, month FROM deliverable WHERE project_id=? AND deleted_at IS NULL ORDER BY month LIMIT 24", [p.id]);
  const risks = await all("SELECT title, impact, status FROM risk WHERE project_id=? AND status!='CLOSED' LIMIT 10", [p.id]);
  const client = await get('SELECT id, name_ar FROM client WHERE id=?', [p.client_id]);
  const owner = p.owner_user_id ? await get('SELECT name_ar, username FROM app_user WHERE id=?', [p.owner_user_id]) : null;
  const srcOpp = p.source_opp_id ? await get('SELECT id, title_ar FROM opportunity WHERE id=? AND deleted_at IS NULL', [p.source_opp_id]) : null;
  const contract = await get("SELECT id, code, value_halalas, status FROM contract WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [p.id]);
  // Team assigned to this project (from the allocation model), with each member's month-coverage on THIS project.
  const staff = await all(`SELECT a.person_name_ar, a.type, a.monthly_json, e.job_title
     FROM allocation a LEFT JOIN employee e ON e.id=a.employee_id
     WHERE a.project_id=? AND a.deleted_at IS NULL ORDER BY (a.type='lead') DESC, a.person_name_ar`, [p.id]);

  // ── Financials ──
  const contractVal = p.contract_value_halalas || (contract && contract.value_halalas) || 0;
  const headlineVal = contractVal || p.po_value_halalas || p.budget_halalas || 0;
  const spend = p.actual_spend_halalas || 0;
  const revenue = p.revenue_halalas || 0;
  const showCost = canCost && !row._redacted_actual_spend_halalas;
  const marginPct = p.margin_pct != null ? p.margin_pct : (revenue > 0 ? Math.round((revenue - spend) / revenue * 100) : null);
  const burnPct = p.budget_halalas ? Math.round(spend / p.budget_halalas * 100) : null;

  // ── Timeline / schedule health ──
  const sd = p.start_date ? new Date(p.start_date) : null;
  const ed = p.end_date ? new Date(p.end_date) : null;
  const today = new Date();
  let durTxt = '—', schedulePct = null, scheduleTone = 'var(--muted)', scheduleNote = '';
  if (sd && ed && ed > sd) {
    const totalD = Math.round((ed - sd) / 86400000);
    const elapsed = Math.min(totalD, Math.max(0, Math.round((today - sd) / 86400000)));
    const remain = Math.max(0, Math.round((ed - today) / 86400000));
    schedulePct = Math.round(elapsed / totalD * 100);
    durTxt = `${totalD} يوم · مضى ${elapsed} · متبقٍّ ${remain}`;
    const prog = Math.round(p.progress_pct || 0);
    const gap = prog - schedulePct;
    scheduleTone = gap < -12 ? 'var(--red)' : gap < -4 ? 'var(--amber)' : 'var(--green)';
    scheduleNote = gap < -12 ? 'متأخر عن الجدول' : gap < -4 ? 'قريب من الجدول' : (today > ed ? 'تجاوز تاريخ الانتهاء' : 'ضمن الجدول');
    if (today > ed && prog < 100) { scheduleTone = 'var(--red)'; scheduleNote = 'تجاوز تاريخ الانتهاء'; }
  }

  const stat = (l, v, c, sub) => card(`<div style="padding:.7rem .9rem"><div style="font-size:10.5px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.2rem;${c ? 'color:' + c : ''}">${v}</div>${sub ? `<div style="font-size:10px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const ragColor = p.rag === 'RED' ? 'red' : p.rag === 'AMBER' ? 'amber' : 'green';
  const MONTHS = ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
  const dlvRows = dlv.map((d) => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:.4rem .75rem;font-size:12.5px">${esc(d.name_ar)}${d.month ? `<span style="color:var(--faint);font-size:10px;margin-inline-start:.35rem">${MONTHS[(d.month - 1) % 12] || ''}</span>` : ''}</td>
    <td style="padding:.4rem .75rem;font-size:12.5px;text-align:center" class="tnum">${fmtSar(d.amount_halalas)}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(tr(d.status), ['PAID', 'INVOICED', 'ACCEPTED'].includes(d.status) ? 'green' : d.status === 'DELIVERED' ? 'blue' : 'slate')}</td></tr>`).join('');
  const riskRows = risks.map((r) => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:.4rem .75rem;font-size:12.5px">${esc(r.title)}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(tr(r.impact) || '—', r.impact === 'high' ? 'red' : r.impact === 'medium' ? 'amber' : 'slate')}</td></tr>`).join('');
  // staffing rows: parse each member's monthly_json into a 12-cell coverage strip on this project
  const staffRows = staff.map((s) => {
    let mj = {}; try { mj = JSON.parse(s.monthly_json || '{}'); } catch { mj = {}; }
    const months = Array.from({ length: 12 }, (_, i) => Math.round((Number(mj[i + 1]) || 0) * 100));
    return `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:.4rem .75rem;font-size:12.5px">${esc(s.person_name_ar || '—')}<div style="font-size:10px;color:var(--muted)">${esc(s.job_title || '')}</div></td>
      <td style="padding:.4rem .75rem;text-align:center">${pill(s.type === 'lead' ? 'قائد' : 'عضو', s.type === 'lead' ? 'blue' : 'slate')}</td>
      <td style="padding:.4rem .75rem;width:160px">${utilStrip(months)}</td></tr>`;
  }).join('');

  const financeCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المالية</div>
    <div style="padding:.5rem 1rem">
      ${[['قيمة العقد', fmtSar(headlineVal), 'var(--ink2)'],
    ['الإيراد المُثبت', fmtSar(revenue), 'var(--green)'],
    ['الصرف الفعلي', showCost ? fmtSar(spend) : '••• محجوب', showCost ? 'var(--ink2)' : 'var(--faint)'],
    ['الهامش', marginPct != null && showCost ? marginPct + '%' : (marginPct != null && !canCost ? '••• محجوب' : '—'), (marginPct != null && marginPct < 10) ? 'var(--red)' : 'var(--ink2)']]
    .map(([l, v, c]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:.3rem 0;border-bottom:1px dashed var(--line)"><span style="font-size:12px;color:var(--muted)">${l}</span><span class="tnum" style="font-weight:800;font-size:13px;color:${c}">${v}</span></div>`).join('')}
      ${showCost && burnPct != null ? `<div style="margin-top:.55rem"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>استهلاك الميزانية</span><span class="tnum">${burnPct}%</span></div>${bar(burnPct, burnPct > 90 ? '#dc2626' : burnPct > 70 ? '#d97706' : '#059669')}</div>` : ''}
      ${contract ? `<a href="/app/contract/${contract.id}" style="display:block;margin-top:.6rem;font-size:12px;color:var(--brand2);text-decoration:none">↳ فتح العقد ${esc(contract.code || '')} · ${fmtSar(contract.value_halalas)}</a>` : ''}
    </div>`);

  const timelineCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:800;font-size:13px">الجدول الزمني</div>${schedulePct != null ? `<span style="font-size:11px;font-weight:700;color:${scheduleTone}">${scheduleNote}</span>` : ''}</div>
    <div style="padding:.85rem 1rem">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>${p.start_date || '—'}</span><span>${p.end_date || '—'}</span></div>
      <div style="position:relative;height:10px;background:var(--surface2, #f1f5f9);border-radius:6px;margin:.45rem 0;overflow:hidden">
        <div style="position:absolute;inset-inline-start:0;top:0;height:100%;width:${Math.min(100, Math.round(p.progress_pct || 0))}%;background:linear-gradient(90deg,#2563eb,#7c3aed)"></div>
        ${schedulePct != null ? `<div title="موضع اليوم على الجدول" style="position:absolute;top:-2px;height:14px;width:2px;background:#0f172a;inset-inline-start:${schedulePct}%"></div>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:var(--muted)">الإنجاز <b class="tnum" style="color:var(--ink2)">${Math.round(p.progress_pct || 0)}%</b></span><span style="color:var(--muted)">${schedulePct != null ? `الزمن المنقضي <b class="tnum">${schedulePct}%</b>` : ''}</span></div>
      <div style="font-size:11px;color:var(--faint);margin-top:.4rem">${durTxt}</div>
      <div style="display:flex;gap:1.2rem;margin-top:.65rem;padding-top:.55rem;border-top:1px solid var(--line);font-size:11.5px">
        <div><span style="color:var(--muted)">مدير المشروع</span><div style="font-weight:700">${esc(p.pm_name || owner?.name_ar || owner?.username || '—')}</div></div>
        ${srcOpp ? `<div><span style="color:var(--muted)">الفرصة المصدر</span><div><a href="/app/opportunities" style="color:var(--brand2);text-decoration:none;font-weight:700">${esc(srcOpp.title_ar).slice(0, 26)}</a></div></div>` : ''}
      </div>
    </div>`);

  const body = `
    <a href="/app/projects" style="font-size:12px;color:var(--muted)">← المشاريع</a>
    <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin:.6rem 0 1rem">
      <h2 style="font-size:18px;margin:0">${esc(p.name_ar)}</h2>${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : p.status === 'ON_HOLD' ? 'amber' : 'blue')}${pill('RAG ' + tr(p.rag), ragColor)}
      ${p.kind ? pill(p.kind === 'external' ? 'خارجي' : 'داخلي', 'slate') : ''}
      <span style="font-size:12px;color:var(--muted)">${client ? esc(client.name_ar) : ''} · ${esc(p.code || '')}${p.financial_code ? ' · مالي ' + esc(p.financial_code) : ''}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:.65rem;margin-bottom:1rem">
      ${stat('الإنجاز', Math.round(p.progress_pct || 0) + '%')}
      ${stat('إنجاز المهام', k.taskCompletionRate + '%', '', `${tmap.DONE || 0}/${k.totalTasks}`)}
      ${stat('مهام متأخرة', k.lateTasks, k.lateTasks ? 'var(--red)' : '')}
      ${stat('قبول المخرجات', k.deliverableAcceptanceRate + '%', '', `${dlv.length} مخرج`)}
      ${stat('الفريق المُسكَّن', staff.length, '', staff.length ? 'موظف' : 'لا تسكين')}
      ${stat('المخاطر', risks.length, risks.length ? 'var(--amber)' : '', 'مفتوحة')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${timelineCard}
      ${financeCard}
    </div>
    <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;font-size:13px">التسكين — فريق المشروع (${staff.length})</div>
        ${canEdit ? `<button class="btn btn-sm" style="font-size:11px;padding:.25rem .6rem" onclick="Sanad.projOpen('${p.id}')">${icon('users')} إدارة التسكين</button>` : ''}</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10.5px;color:var(--muted);text-align:right"><th style="padding:.35rem .75rem">الموظف</th><th style="padding:.35rem .75rem;text-align:center">الدور</th><th style="padding:.35rem .75rem;text-align:center">التغطية الشهرية</th></tr></thead>
        <tbody>${staffRows || '<tr><td colspan="3" style="padding:1rem;color:var(--muted);font-size:12.5px">لا يوجد فريق مُسكَّن على هذا المشروع بعد' + (canEdit ? ' — استخدم «إدارة التسكين»' : '') + '</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المخرجات (${dlv.length})</div>
        <div style="max-height:260px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><tbody>${dlvRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:12.5px">لا مخرجات</td></tr>'}</tbody></table></div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem">
      ${card(`<div style="padding:.85rem 1rem"><div style="font-weight:800;font-size:13px;margin-bottom:.5rem">توزيع المهام (${k.totalTasks})</div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => pill(`${tr(s)}: ${tmap[s] || 0}`, s === 'DONE' ? 'green' : s === 'BLOCKED' ? 'red' : 'slate')).join(' ')}</div></div>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المخاطر المفتوحة (${risks.length})</div>
        <table style="width:100%;border-collapse:collapse"><tbody>${riskRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:12.5px">لا مخاطر مفتوحة</td></tr>'}</tbody></table>`)}
    </div>`;
  return layout({ user, active: 'projects', title: esc(p.name_ar), subtitle: 'تفاصيل المشروع', body });
}

export async function portfolioPage(user) {
  const rows = await listProjects(user);
  const sectorNames = Object.fromEntries((await all('SELECT id,name_ar FROM sector')).map((s) => [s.id, s.name_ar]));
  const val = (p) => p.contract_value_halalas || p.budget_halalas || 0;
  const isActive = (p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED';
  const ragC = { GREEN: 0, AMBER: 0, RED: 0 };
  for (const p of rows) if (isActive(p)) ragC[p.rag] = (ragC[p.rag] || 0) + 1;
  const totalVal = rows.reduce((a, p) => a + val(p), 0);
  const active = rows.filter(isActive);
  const completed = rows.filter((p) => p.status === 'COMPLETED').length;
  const avgProg = active.length ? Math.round(active.reduce((a, p) => a + (p.progress_pct || 0), 0) / active.length) : 0;
  const ragTone = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
  const ragHexP = { GREEN: '#059669', AMBER: '#d97706', RED: '#dc2626' };

  const bySector = {};
  for (const p of rows) (bySector[p.sector_id] ||= []).push(p);
  // richest sectors first
  const sectorEntries = Object.entries(bySector).sort((a, b) => b[1].reduce((x, p) => x + val(p), 0) - a[1].reduce((x, p) => x + val(p), 0));

  const groups = sectorEntries.map(([sid, ps]) => {
    const sVal = ps.reduce((a, p) => a + val(p), 0);
    const sActive = ps.filter(isActive);
    const sAvg = sActive.length ? Math.round(sActive.reduce((a, p) => a + (p.progress_pct || 0), 0) / sActive.length) : 0;
    const sRag = { GREEN: 0, AMBER: 0, RED: 0 }; for (const p of sActive) sRag[p.rag] = (sRag[p.rag] || 0) + 1;
    const ragDots = ['GREEN', 'AMBER', 'RED'].filter((r) => sRag[r]).map((r) => `<span style="display:inline-flex;align-items:center;gap:.2rem;font-size:11px"><span style="width:8px;height:8px;border-radius:99px;background:${ragHexP[r]}"></span><span class="tnum">${sRag[r]}</span></span>`).join('<span style="color:var(--faint);margin:0 .15rem"></span>');
    const top = ps.slice().sort((a, b) => val(b) - val(a)).slice(0, 7);
    return card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:800;font-size:13.5px">${esc(sectorNames[sid] || sid || '—')}</div><span class="tnum" style="font-size:12.5px;font-weight:800">${fmtSar(sVal)}</span></div>
        <div style="display:flex;align-items:center;gap:.8rem;margin-top:.35rem;font-size:11px;color:var(--muted)"><span>${ps.length} مشروع</span><span style="display:flex;gap:.5rem">${ragDots || '—'}</span><span style="margin-inline-start:auto">إنجاز ${sAvg}%</span></div>
        <div class="bar" style="margin-top:.3rem"><span style="width:${sAvg}%;background:var(--brand-grad)"></span></div></div>
      <div style="padding:.4rem .5rem">${top.map((p) => `<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem .5rem;font-size:12px">
        <span style="width:8px;height:8px;border-radius:99px;flex:none;background:${ragHexP[p.rag] || '#94a3b8'}"></span>
        <a href="/app/project/${p.id}" style="flex:1;color:var(--ink2);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name_ar)}</a>
        <span class="tnum" style="color:var(--faint);font-size:10.5px;flex:none">${sarShort(val(p))}</span>
        <span class="tnum" style="color:var(--muted);font-size:11px;width:34px;text-align:left;flex:none">${pct(p.progress_pct)}</span></div>`).join('')}
        ${ps.length > 7 ? `<div style="padding:.3rem .5rem;font-size:11px;color:var(--faint)">+${ps.length - 7} مشروع آخر</div>` : ''}</div>`);
  }).join('');

  const kpi = (l, v, sub, tone) => card(`<div style="padding:.75rem .95rem"><div style="font-size:11px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.35rem;${tone ? 'color:' + tone : ''}">${v}</div>${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const body = `
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:.7rem;margin-bottom:1rem">
      ${kpi('إجمالي المشاريع', rows.length, `${active.length} قائم · ${completed} مكتمل`)}
      ${kpi('قيمة المحفظة', fmtSar(totalVal), 'قيمة العقود')}
      ${kpi('سليمة (أخضر)', ragC.GREEN, 'ضمن المسار', 'var(--green)')}
      ${kpi('تحذير (أصفر)', ragC.AMBER, 'تحتاج متابعة', 'var(--amber)')}
      ${kpi('متعثرة (أحمر)', ragC.RED, 'تدخّل عاجل', ragC.RED ? 'var(--red)' : '')}
      ${kpi('متوسط الإنجاز', avgProg + '%', 'للمشاريع القائمة')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:.9rem;align-items:start">${groups || '<div style="color:var(--muted);font-size:13px">لا مشاريع ضمن نطاقك</div>'}</div>`;
  return layout({ user, active: 'portfolio', title: 'محفظة المشاريع', subtitle: 'نظرة تنفيذية على صحة المحفظة', body });
}
