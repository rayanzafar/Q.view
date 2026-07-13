import { layout, card, pill, miniBars, tr } from './layout.js';
import { icon } from './icons.js';
import { fmtSar } from '../core/util/ids.js';
import { all, get } from '../core/db/index.js';
import { companyOverview, sectorDashboard, projectKpis, multiYearTrend, winRate,
  winRateByYear, quarterlyRevenue, backlog, pipelineCoverage, bookToBill, grossMargin } from '../core/reports/metrics.js';
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
import { orgTree } from '../modules/org/org.js';
import { financeSummary, financeByPM, financeByContract, contractDetail } from '../modules/finance/finance.js';
import { canSeeSensitive, redact, can } from '../core/rbac/index.js';

const pct = (n) => `${Math.round(n || 0)}%`;
const bar = (p, color = '#2563eb') => `<div class="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
  <div style="width:${Math.min(100, Math.max(0, p))}%;background:${color}" class="h-full rounded-full"></div></div>`;

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

export function ceoPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const ov = companyOverview(user, { year });
  const t = ov.totals;
  const wr = winRate(null, year);
  const trend = multiYearTrend(null, 4);
  const wrYear = winRateByYear(null, 4);
  const qRev = quarterlyRevenue(null, year);
  const bk = backlog(null);
  const cov = pipelineCoverage(null, year);
  const b2b = bookToBill(null, year);
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
  const heroKpi = (label, val, target, p, color) => `
    <div style="color:rgba(255,255,255,.7);font-size:13px">${label}</div>
    <div class="metric" style="color:#fff;margin-top:.25rem">${fmtSar(val)}</div>
    <div style="color:rgba(255,255,255,.6);font-size:12px">من ${fmtSar(target)} · ${pct(p)}</div>
    <div class="bar" style="margin-top:.5rem;background:rgba(255,255,255,.15)"><span style="width:${Math.min(100, p)}%;background:${color}"></span></div>`;
  const sectorCards = ov.sectors.map((s) => card(`
    <div style="padding:1rem">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:.5rem">
          <span style="width:10px;height:10px;border-radius:3px;background:${s.color || '#2563eb'}"></span>
          <div><div style="font-weight:800;font-size:15px">${s.name_ar}</div><div style="font-size:11px;color:var(--muted)">${s.name_en || ''}</div></div>
        </div>
        ${s.placeholder ? pill('بانتظار التفعيل', 'amber') : pill(`${s.opp_count} فرصة`, 'blue')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-top:.85rem">
        <div><div style="font-size:11px;color:var(--muted)">الإيراد · ${pct(s.revenue_pct)}</div>
          <div style="font-weight:800" class="tnum">${fmtSar(s.revenue_halalas)}</div>
          <div class="bar" style="margin-top:.35rem"><span style="width:${Math.min(100, s.revenue_pct)}%;background:var(--green)"></span></div></div>
        <div><div style="font-size:11px;color:var(--muted)">المبيعات · ${pct(s.sales_pct)}</div>
          <div style="font-weight:800" class="tnum">${fmtSar(s.sales_halalas)}</div>
          <div class="bar" style="margin-top:.35rem"><span style="width:${Math.min(100, s.sales_pct)}%;background:${s.color || 'var(--brand)'}"></span></div></div>
      </div>
      <div style="margin-top:.7rem;padding-top:.6rem;border-top:1px solid var(--line);font-size:11px;color:var(--muted);display:flex;justify-content:space-between">
        <span>عقود ${year}: <b class="tnum" style="color:var(--ink2)">${fmtSar(s.contracts_halalas)}</b> (${s.contracts_count})</span>
        ${ov.canSeeMargin ? (() => { const gm = grossMargin(s.id, year); return gm.margin_pct != null ? `<span>هامش: <b style="color:${gm.margin_pct >= 20 ? 'var(--green)' : gm.margin_pct >= 10 ? 'var(--amber)' : 'var(--red)'}">${gm.margin_pct}%</b></span>` : ''; })() : ''}
      </div>
    </div>`, 'card-h')).join('');
  const kpiTile = (label, val, sub) => card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">${label}</div><div class="metric" style="font-size:1.4rem">${val}</div>${sub ? `<div style="font-size:11px;color:var(--muted)">${sub}</div>` : ''}</div>`);
  const body = `
    ${riskBanner}
    <div style="border-radius:18px;padding:1.5rem;margin-bottom:1.25rem;color:#fff;background:linear-gradient(135deg,#0f2350,#182a5e,#3a1660)">
      <div style="color:rgba(255,255,255,.6);font-size:12px;margin-bottom:.25rem">الأداء على مستوى الشركة · السنة المالية ${ov.fiscalYear}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-top:.5rem">
        <div>${heroKpi('إجمالي الإيرادات المحققة', t.revenue, t.target_revenue, t.target_revenue ? t.revenue / t.target_revenue * 100 : 0, '#34d399')}
          <div style="margin-top:.35rem">${yoyBadge(revYoy)}</div></div>
        <div>${heroKpi('إجمالي المبيعات المحققة (حجوزات)', t.sales, t.target_sales, t.target_sales ? t.sales / t.target_sales * 100 : 0, '#c07bff')}
          <div style="margin-top:.35rem">${yoyBadge(bookYoy)} <span style="font-size:11px;color:rgba(255,255,255,.6)">· Book-to-Bill ${b2b.ratio != null ? b2b.ratio + '×' : '—'}</span></div></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:.85rem;margin-bottom:1.25rem">
      ${kpiTile('خط الفرص المفتوح', fmtSar(ov.pipeline_halalas), `مرجّح ${fmtSar(cov.weighted_halalas)}`)}
      ${kpiTile('تغطية خط الأنابيب', cov.coverage != null ? cov.coverage + '×' : '—', 'المتبقي من الهدف')}
      ${kpiTile('معدل الفوز', pct(wr.rate), `فوز ${wr.won} · خسارة ${wr.lost}`)}
      ${kpiTile('الأعمال المتعاقدة (Backlog)', fmtSar(bk.backlog_halalas), 'متعاقد لم يُحقَّق')}
      ${kpiTile('تحقيق الإيراد', pct(t.target_revenue ? t.revenue / t.target_revenue * 100 : 0), `الهدف ${fmtSar(t.target_revenue)}`)}
      ${kpiTile('تحقيق المبيعات', pct(t.target_sales ? t.sales / t.target_sales * 100 : 0), `الهدف ${fmtSar(t.target_sales)}`)}
    </div>
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:1rem;margin-bottom:1.25rem">
      <div><div style="font-weight:800;font-size:14px;margin-bottom:.5rem">أداء القطاعات · ${year}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">${sectorCards}</div></div>
      ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:14px;margin-bottom:.25rem">الاتجاه متعدد السنوات</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:.4rem">العقود الموقّعة (مليون ر.س.)</div>
        ${miniBars(trend, 'contracts_halalas', { fmt: sarShort })}
        <div style="font-size:11px;color:var(--muted);margin:.6rem 0 .4rem">معدل الفوز حسب السنة</div>
        ${miniBars(wrYear, 'rate', { fmt: (v) => Math.round(v) + '%' })}</div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem">
      ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:14px;margin-bottom:.25rem">الإيراد المحقق حسب الربع · ${year}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:.5rem">مليون ر.س.</div>
        ${miniBars(qRev.map((q) => ({ year: q.quarter, revenue_halalas: q.revenue_halalas })), 'revenue_halalas', { fmt: sarShort })}</div>`)}
      ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:14px;margin-bottom:.5rem">الإيراد المحقق متعدد السنوات (مليون ر.س.)</div>
        ${miniBars(trend, 'revenue_halalas', { fmt: sarShort })}</div>`)}
    </div>`;
  return layout({ user, active: 'ceo', title: 'لوحة القيادة', subtitle: `نظرة تنفيذية · السنة المالية ${year}`, body, year });
}

export function sectorPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const sectorId = user.sector_id || 'SOLUTIONS';
  const sd = sectorDashboard(user, sectorId, { year });
  const pipe = pipelineSummary(user);
  if (!sd) return layout({ user, active: 'sector', title: 'مركز القطاع', body: '<div style="color:var(--muted)">لا يوجد قطاع مرتبط</div>' });
  const stat = (label, val, sub) => card(`<div style="padding:1rem"><div style="font-size:11px;color:var(--muted)">${label}</div><div class="metric" style="font-size:1.5rem">${val}</div>${sub ? `<div style="font-size:11px;color:var(--muted)">${sub}</div>` : ''}</div>`);
  const maxPipe = Math.max(1, ...pipe.map((s) => s.value_halalas));
  const pipeRow = pipe.map((s) => `<div style="padding:.35rem 0">
    <div style="display:flex;align-items:center;gap:.5rem;font-size:13px">
      <span style="width:9px;height:9px;border-radius:3px;background:${s.color}"></span>
      <span style="flex:1">${s.name_ar}</span><span style="font-weight:800" class="tnum">${s.count}</span>
      <span style="color:var(--muted);font-size:11px" class="tnum">${fmtSar(s.value_halalas)}</span></div>
    <div class="bar" style="margin-top:.25rem"><span style="width:${Math.round(s.value_halalas / maxPipe * 100)}%;background:${s.color}"></span></div></div>`).join('');
  const body = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.25rem">
      ${stat(`إيراد ${year}`, fmtSar(sd.revenue_halalas), `مبيعات ${fmtSar(sd.sales_halalas)}`)}
      ${stat(`عقود ${year}`, fmtSar(sd.contracts_halalas), `${sd.contracts_count} عقد`)}
      ${stat('مشاريع قائمة', sd.projects.IN_PROGRESS || 0, `مكتملة ${sd.projects.COMPLETED || 0}`)}
      ${stat('مخاطر مفتوحة', sd.openRisks, `مخرجات مسلّمة ${sd.deliverables.DELIVERED || 0}`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem">
      ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:14px;margin-bottom:.5rem">خط الفرص حسب المرحلة</div>${pipeRow}</div>`)}
      ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:14px;margin-bottom:.25rem">الاتجاه متعدد السنوات — عقود القطاع</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:.5rem">مليون ر.س.</div>
        ${miniBars(sd.trend, 'contracts_halalas', { fmt: sarShort })}
        <div style="margin-top:.75rem;display:flex;gap:.5rem">
          ${pill('على المسار ' + (sd.rag.GREEN || 0), 'green')}
          ${pill('في خطر ' + (sd.rag.AMBER || 0), 'amber')}
          ${pill('حرج ' + (sd.rag.RED || 0), 'red')}
        </div></div>`)}
    </div>`;
  return layout({ user, active: 'sector', title: `مركز القطاع — ${sd.sector.name_ar}`, subtitle: `السنة المالية ${year}`, body, year });
}

// small stat chip used on PMO toolbars
function statMini(label, value, sub, tone) {
  const c = tone === 'good' ? 'var(--green)' : tone === 'brand' ? 'var(--brand2)' : 'var(--ink2)';
  return `<div class="card" style="padding:.6rem .9rem;min-width:130px">
    <div style="font-size:11px;color:var(--muted);font-weight:700">${label}</div>
    <div class="tnum" style="font-size:1.15rem;font-weight:800;color:${c};letter-spacing:-.02em">${value}</div>
    <div style="font-size:10.5px;color:var(--faint)">${sub || ''}</div></div>`;
}

export function opportunitiesPage(user) {
  const rows = listOpportunities(user);
  const stages = all('SELECT id,name_ar,color,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const clients = Object.fromEntries(all('SELECT id,name_ar FROM client').map((c) => [c.id, c.name_ar]));
  const users = Object.fromEntries(all('SELECT id,name_ar,username FROM app_user').map((u) => [u.id, u.name_ar || u.username]));
  const sectors = all('SELECT id,name_ar FROM sector WHERE active=1 ORDER BY name_ar');
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
    return `<div class="kcard" ${dnd} data-id="${o.id}" data-sector="${o.sector_id || ''}" data-hay="${hay.replace(/"/g, '')}" style="--_c:${st.color || '#cbd5e1'}${canEdit ? '' : ';cursor:pointer'}"
       onclick="Sanad.oppOpen('${o.id}')">
      <div class="kt">${o.title_ar}</div>
      <div class="km">${cl ? `<span style="display:inline-flex;align-items:center;gap:.25rem">${icon('building')}${cl}</span>` : '<span style="color:var(--faint)">—</span>'}
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
        <span class="t">${s.name_ar}</span><span class="n" data-count>${items.length}</span>
        <span class="v tnum" data-total>${sarShort(colTotal)}</span></div>
      <div class="kcol-body">${items.map(opCard).join('') || '<div style="text-align:center;color:var(--faint);font-size:11px;padding:1rem 0">—</div>'}</div>
    </div>`;
  }).join('');

  const tableRows = rows.slice(0, 200).map((o) => {
    const st = stById[o.stage_id] || {};
    return `<tr class="border-b border-line" style="cursor:pointer" onclick="Sanad.oppOpen('${o.id}')">
      <td class="py-2.5 px-3 text-[13px]">${o.title_ar}</td>
      <td class="px-3 text-[12px]">${clients[o.client_id] || '—'}</td>
      <td class="px-3">${pill(st.name_ar || o.stage_id, 'blue')}</td>
      <td class="px-3 text-[13px] tnum">${fmtSar(o.value_halalas)}</td>
      <td class="px-3 text-[12px] text-muted tnum">${pct(o.win_pct)}</td></tr>`;
  }).join('');

  const body = `
    <div class="toolbar">
      <div class="seg"><button class="on" data-view="kanban" onclick="Sanad.pmoView('opp','kanban')">${icon('kanban')} كانبان</button>
        <button data-view="table" onclick="Sanad.pmoView('opp','table')">${icon('list')} جدول</button></div>
      <div class="search">${icon('search')}<input class="input" id="opp-q" oninput="Sanad.oppFilter()" placeholder="ابحث بالعنوان أو العميل…"></div>
      <select class="input" id="opp-sector" onchange="Sanad.oppFilter()"><option value="">كل القطاعات</option>${sectors.map((s) => `<option value="${s.id}">${s.name_ar}</option>`).join('')}</select>
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

export function projectsPage(user) {
  const rows = listProjects(user);
  const canCost = canSeeSensitive(user, 'cost');
  const ragColor = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
  const list = rows.slice(0, 100).map((p) => `<tr class="border-b border-line hover:bg-slate-50" style="cursor:pointer" onclick="location.href='/app/project/${p.id}'">
    <td class="py-2.5 px-3 text-[13px]">${p.name_ar}</td>
    <td class="px-3">${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : 'blue')}</td>
    <td class="px-3">${pill(tr(p.rag), ragColor[p.rag] || 'slate')}</td>
    <td class="px-3 text-[13px] tabular-nums">${fmtSar(p.contract_value_halalas)}</td>
    <td class="px-3 text-[12px]">${canCost && !p._redacted_actual_spend_halalas ? fmtSar(p.actual_spend_halalas) : '<span class="text-slate-300">•••</span>'}</td>
    <td class="px-3 text-[12px] text-muted">${pct(p.progress_pct)}</td></tr>`).join('');
  const body = `${card(`
    <div class="p-4 flex items-center justify-between border-b border-line">
      <div class="font-bold text-sm">المشاريع (${rows.length})</div>
      ${canCost ? pill('ترى التكلفة الفعلية', 'green') : pill('التكلفة محجوبة عنك', 'slate')}
    </div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">المشروع</th><th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">RAG</th>
      <th class="px-3 font-medium">قيمة العقد</th><th class="px-3 font-medium">الصرف الفعلي</th><th class="px-3 font-medium">الإنجاز</th></tr></thead>
      <tbody>${list || '<tr><td class="p-4 text-muted text-sm" colspan="6">لا مشاريع ضمن نطاقك</td></tr>'}</tbody></table>`)}`;
  return layout({ user, active: 'projects', title: 'المشاريع', body });
}

export function tasksPage(user) {
  const rows = myTasks(user);
  const stColor = { TODO: 'slate', IN_PROGRESS: 'blue', BLOCKED: 'red', IN_REVIEW: 'amber', DONE: 'green' };
  const list = rows.map((t) => `<tr class="border-b border-line hover:bg-slate-50" data-task="${t.id}">
    <td class="py-2.5 px-3 text-[13px]">${t.title}</td>
    <td class="px-3">${pill(tr(t.priority), t.priority === 'P0' ? 'red' : t.priority === 'P1' ? 'amber' : 'slate')}</td>
    <td class="px-3">${pill(tr(t.status), stColor[t.status])}</td>
    <td class="px-3 text-[12px] text-muted">${t.due_date || '—'}</td>
    <td class="px-3"><select onchange="Sanad.setTaskStatus('${t.id}',this.value)" aria-label="تغيير حالة المهمة" class="text-[12px] border border-line rounded px-1 py-0.5">
      ${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${tr(s)}</option>`).join('')}
    </select></td></tr>`).join('');
  const body = `
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

export function timesheetPage(user) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const rows = myEntries(user, { from, to });
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

export function approvalsPage(user) {
  const q = myApprovalQueue(user);
  const list = q.map((a) => `<tr class="border-b border-line">
    <td class="py-2.5 px-3 text-[13px]">${a.workflow_name}</td>
    <td class="px-3 text-[12px] text-muted">${a.resource} · ${a.resource_id}</td>
    <td class="px-3 text-[13px] tabular-nums">${fmtSar(a.amount_halalas)}</td>
    <td class="px-3">${pill('الخطوة ' + a.current_step, 'amber')}</td>
    <td class="px-3">
      <button onclick="Sanad.approve('${a.id}','approve')" class="text-[12px] text-green-700 font-bold">اعتماد</button>
      <button onclick="Sanad.approve('${a.id}','reject')" class="text-[12px] text-red-600 font-bold mr-2">رفض</button></td></tr>`).join('');
  const body = card(`<div class="p-4 border-b border-line font-bold text-sm">طلبات بانتظار اعتمادك (${q.length})</div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">المسار</th><th class="px-3 font-medium">المورد</th><th class="px-3 font-medium">المبلغ</th>
      <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">إجراء</th></tr></thead>
      <tbody>${list || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا طلبات بانتظارك</td></tr>'}</tbody></table>`);
  return layout({ user, active: 'approvals', title: 'الاعتمادات', body });
}

export function teamPage(user) {
  const canSalary = canSeeSensitive(user, 'salary');
  const rows = all("SELECT * FROM employee WHERE deleted_at IS NULL " +
    (user.scope === 'company' ? '' : 'AND sector_id = ?') + ' ORDER BY name_ar LIMIT 200',
    user.scope === 'company' ? [] : [user.sector_id]);
  const totalSalary = canSalary ? rows.reduce((a, r) => a + (r.salary_halalas || 0), 0) : null;
  const list = rows.map((e) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[13px]">${e.name_ar}</td>
    <td class="px-3 text-[12px] text-muted">${e.job_title || ''}</td>
    <td class="px-3 text-[12px]">${e.employment_type || ''}</td>
    <td class="px-3 text-[13px] tabular-nums">${canSalary ? fmtSar(e.salary_halalas) : '<span class="text-slate-300">••• محجوب</span>'}</td></tr>`).join('');
  const body = `
    ${canSalary ? card(`<div class="p-4 mb-4"><div class="text-[11px] text-muted">إجمالي فاتورة الرواتب الشهرية (${rows.length} عضو)</div>
      <div class="text-2xl font-extrabold">${fmtSar(totalSalary)}</div></div>`) : `<div class="mb-4">${pill('الرواتب محجوبة عن دورك — تظهر لمدير النظام والموارد البشرية فقط', 'slate')}</div>`}
    ${card(`<table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">الاسم</th><th class="px-3 font-medium">المسمى</th><th class="px-3 font-medium">النوع</th>
      <th class="px-3 font-medium">الراتب</th></tr></thead><tbody>${list}</tbody></table>`)}`;
  return layout({ user, active: 'team', title: 'الفريق', body });
}

export function usersPage(user) {
  const rows = all(`SELECT u.*, r.name_ar role_name FROM app_user u LEFT JOIN role r ON r.id = u.role_id
    WHERE u.deleted_at IS NULL ORDER BY u.role_id, u.name_ar LIMIT 300`);
  const list = rows.map((u) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[13px]">${u.name_ar || ''}<div class="text-[11px] text-muted">${u.username || '— بلا دخول'}</div></td>
    <td class="px-3">${pill(u.role_name || u.role_id, 'blue')}</td>
    <td class="px-3 text-[12px]">${u.sector_id || '—'}</td>
    <td class="px-3">${u.active ? pill('نشط', 'green') : pill('معطّل', 'red')}</td>
    <td class="px-3 text-[11px] text-muted">${u.last_login_at ? u.last_login_at.slice(0, 10) : 'لم يدخل'}</td></tr>`).join('');
  const body = `${card(`<div class="p-4 border-b border-line font-bold text-sm">المستخدمون والصلاحيات (${rows.length})</div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الدور</th><th class="px-3 font-medium">القطاع</th>
      <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">آخر دخول</th></tr></thead><tbody>${list}</tbody></table>`)}
    <div class="mt-3 text-[11px] text-muted">التفويض يُنفَّذ على الخادم. تعطيل حسابك أو خفض دورك بنفسك ممنوع خادميًا. الرواتب وعناوين IP محجوبة عن غير المصرّح لهم.</div>`;
  return layout({ user, active: 'users', title: 'المستخدمون والصلاحيات', body });
}

export function auditPage(user) {
  const rows = all('SELECT * FROM audit_log ORDER BY at DESC LIMIT 200');
  const list = rows.map((a) => `<tr class="border-b border-line">
    <td class="py-1.5 px-3 text-[11px] text-muted tabular-nums">${a.at.slice(0, 19).replace('T', ' ')}</td>
    <td class="px-3 text-[12px]">${a.username || a.user_id || '—'}</td>
    <td class="px-3">${pill(tr(a.action), 'slate')}</td>
    <td class="px-3 text-[12px]">${a.resource || ''} ${a.resource_id ? '· ' + a.resource_id : ''}</td></tr>`).join('');
  const body = card(`<div class="p-4 border-b border-line font-bold text-sm">سجل التدقيق (آخر 200)</div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">الوقت</th><th class="px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الإجراء</th>
      <th class="px-3 font-medium">المورد</th></tr></thead><tbody>${list}</tbody></table>`);
  return layout({ user, active: 'audit', title: 'سجل التدقيق', body });
}

export function reportsPage(user) {
  const defs = all('SELECT * FROM report_definition WHERE active = 1 ORDER BY id');
  const groups = all('SELECT * FROM recipient_group ORDER BY name_ar');
  const schedules = all('SELECT rs.*, rd.name_ar rname, rg.name_ar gname FROM report_schedule rs JOIN report_definition rd ON rd.id = rs.report_id LEFT JOIN recipient_group rg ON rg.id = rs.recipient_group_id ORDER BY rs.created_at DESC LIMIT 50');
  const outbox = all('SELECT * FROM email_queue ORDER BY created_at DESC LIMIT 15');
  const freqAr = { daily: 'يومي', weekly: 'أسبوعي', biweekly: 'كل أسبوعين', monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي' };

  const reportCards = defs.map((d) => card(`<div style="padding:.9rem 1rem">
    <div style="font-weight:700;font-size:13px;margin-bottom:.5rem">${d.name_ar}</div>
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

export function orgPage(user) {
  const tree = orgTree(user);
  const sectorBlocks = tree.map((s) => card(`<div style="padding:1rem">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:.5rem">
        <span style="width:11px;height:11px;border-radius:3px;background:${s.color || '#2563eb'}"></span>
        <div style="font-weight:800">${s.name_ar}</div>
        ${s.is_placeholder ? pill('قالب', 'amber') : pill(`${s.employees} موظف`, 'blue')}
      </div>
      <span style="font-size:11px;color:var(--muted)">${s.id}</span>
    </div>
    <div style="margin-top:.6rem;display:flex;flex-direction:column;gap:.35rem">
      ${(s.departments || []).map((d) => `<div style="display:flex;align-items:center;gap:.5rem;font-size:13px;padding:.3rem .5rem;background:var(--bg);border-radius:8px">
        <span style="color:var(--muted)">↳</span><span style="flex:1">${d.name_ar}</span>
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

export function financePage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const s = financeSummary(user, year);
  const byPM = financeByPM(user, year);
  const byContract = financeByContract(user);
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
  const pmRows = byPM.filter((p) => p.invoiced_halalas > 0 || p.contract_halalas > 0).map((p) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:13px">${p.pm}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(p.contract_halalas)}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(p.invoiced_halalas)}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(p.collected_halalas)}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum" style="color:var(--amber)">${fmtSar(p.outstanding_halalas)}</td></tr>`).join('');
  const cRows = byContract.slice(0, 30).map((c) => `<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="location.href='/app/contract/${c.id}'">
    <td style="padding:.5rem .75rem;font-size:13px">${c.project_name || c.code || c.id}<div style="font-size:11px;color:var(--muted)">${c.client_name || ''}</div></td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(c.value_halalas)}</td>
    <td style="padding:.5rem .75rem;text-align:center"><div class="bar" style="width:70px;display:inline-block;vertical-align:middle"><span style="width:${c.billed_pct}%;background:var(--brand)"></span></div> <span style="font-size:11px">${c.billed_pct}%</span></td>
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
    <div style="display:grid;grid-template-columns:1fr 1.2fr;gap:1rem">
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المالية حسب مدير المشروع</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">مدير المشروع</th><th style="padding:.4rem .75rem;text-align:center">العقود</th><th style="padding:.4rem .75rem;text-align:center">مُفوتر</th><th style="padding:.4rem .75rem;text-align:center">محصَّل</th><th style="padding:.4rem .75rem;text-align:center">متبقٍّ</th></tr></thead>
        <tbody>${pmRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:13px" colspan="5">لا بيانات</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">العقود (اضغط للتفصيل والمستخلصات)</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">العقد/المشروع</th><th style="padding:.4rem .75rem;text-align:center">القيمة</th><th style="padding:.4rem .75rem;text-align:center">نسبة الفوترة</th><th style="padding:.4rem .75rem;text-align:center">Backlog</th></tr></thead>
        <tbody>${cRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:13px" colspan="4">لا عقود</td></tr>'}</tbody></table>`)}
    </div>`;
  return layout({ user, active: 'finance', title: 'المالية', subtitle: `عقود · فواتير · مستخلصات · تحصيل · السنة ${year}`, body, year });
}

function noticeCard(title, msg, backHref = '/', backLabel = 'العودة') {
  return `<div style="max-width:440px;margin:64px auto;text-align:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:40px 32px;box-shadow:0 4px 24px rgba(15,23,42,.05)">
    <div style="font-size:16px;font-weight:700;color:#0f172a">${title}</div>
    <div style="font-size:13px;color:var(--muted);margin-top:8px;line-height:1.7">${msg}</div>
    <a href="${backHref}" style="display:inline-block;margin-top:20px;background:linear-gradient(120deg,#2563eb,#9333ea);color:#fff;text-decoration:none;padding:9px 22px;border-radius:10px;font-size:13px;font-weight:600">${backLabel}</a>
  </div>`;
}

export function contractDetailPage(user, contractId) {
  let d;
  try { d = contractDetail(user, contractId); } catch (e) { return layout({ user, active: 'finance', title: 'العقد', body: noticeCard('تعذّر عرض العقد', e.message, '/app/finance', 'العودة للمالية') }); }
  const c = d.contract;
  const invRows = d.invoices.map((i) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:13px">${i.kind === 'progress_claim' ? 'مستخلص #' + (i.claim_no || '') : (i.code || i.id)}${i.period_label ? `<div style="font-size:11px;color:var(--muted)">${i.period_label}</div>` : ''}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(i.amount_halalas)}</td>
    <td style="padding:.5rem .75rem;text-align:center">${pill(tr(i.status), i.status === 'PAID' ? 'green' : i.status === 'OVERDUE' ? 'red' : i.status === 'PARTIALLY_PAID' ? 'amber' : 'blue')}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center;color:var(--amber)" class="tnum">${fmtSar(i.outstanding_halalas)}</td>
    <td style="padding:.5rem .75rem;text-align:center">${i.outstanding_halalas > 0 ? `<button onclick="Sanad.recordCollection('${i.id}', ${i.outstanding_halalas / 100})" style="border:1px solid var(--line);cursor:pointer;font-size:11px;padding:.25rem .5rem;border-radius:6px;background:#fff">تسجيل تحصيل</button>` : '✓'}</td></tr>`).join('');
  const eligible = d.deliverables.filter((dl) => ['DELIVERED', 'ACCEPTED'].includes(dl.status));
  const dlvRows = d.deliverables.map((dl) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .75rem;font-size:13px">${dl.name_ar}</td>
    <td style="padding:.4rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(dl.amount_halalas)}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(tr(dl.status), dl.status === 'PAID' || dl.status === 'INVOICED' ? 'green' : dl.status === 'DELIVERED' ? 'blue' : 'slate')}</td></tr>`).join('');
  const body = `
    <a href="/app/finance" style="font-size:12px;color:var(--muted)">← المالية</a>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.85rem;margin:.75rem 0 1.25rem">
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">قيمة العقد</div><div class="metric" style="font-size:1.3rem">${fmtSar(c.value_halalas)}</div></div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">نسبة الفوترة</div><div class="metric" style="font-size:1.3rem">${d.billed_pct}%</div></div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">Backlog متبقٍّ</div><div class="metric" style="font-size:1.3rem">${fmtSar(d.backlog_halalas)}</div></div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">العميل</div><div style="font-weight:700;font-size:15px;margin-top:.4rem">${d.client || '—'}</div></div>`)}
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
  return layout({ user, active: 'finance', title: `العقد — ${c.code || c.id}`, subtitle: d.project?.name_ar || '', body });
}

export function projectDetailPage(user, projectId) {
  const p = get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('المشروع غير موجود', 'ربما حُذف المشروع أو أن الرابط غير صحيح.', '/app/projects', 'العودة للمشاريع') });
  if (!can(user, 'read', 'project', p)) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('لا تملك صلاحية الوصول', 'هذا المشروع خارج نطاق صلاحياتك الحالية — تواصل مع مدير النظام إن كنت تحتاج الوصول.', '/app/projects', 'العودة للمشاريع') });
  const row = redact(user, 'project', p);
  const k = projectKpis(p.id);
  const canCost = canSeeSensitive(user, 'cost');
  const tasks = all("SELECT status, COUNT(*) n FROM task WHERE project_id=? AND deleted_at IS NULL GROUP BY status", [p.id]);
  const tmap = Object.fromEntries(tasks.map((t) => [t.status, t.n]));
  const dlv = all("SELECT name_ar, amount_halalas, status FROM deliverable WHERE project_id=? AND deleted_at IS NULL ORDER BY month LIMIT 20", [p.id]);
  const risks = all("SELECT title, impact, status FROM risk WHERE project_id=? AND status!='CLOSED' LIMIT 10", [p.id]);
  const client = get('SELECT name_ar FROM client WHERE id=?', [p.client_id]);
  const stat = (l, v, c) => card(`<div style="padding:.85rem 1rem"><div style="font-size:11px;color:var(--muted)">${l}</div><div class="metric" style="font-size:1.25rem;${c ? 'color:' + c : ''}">${v}</div></div>`);
  const ragColor = p.rag === 'RED' ? 'red' : p.rag === 'AMBER' ? 'amber' : 'green';
  const dlvRows = dlv.map((d) => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:.4rem .75rem;font-size:13px">${d.name_ar}</td>
    <td style="padding:.4rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(d.amount_halalas)}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(tr(d.status), ['PAID', 'INVOICED', 'ACCEPTED'].includes(d.status) ? 'green' : d.status === 'DELIVERED' ? 'blue' : 'slate')}</td></tr>`).join('');
  const riskRows = risks.map((r) => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:.4rem .75rem;font-size:13px">${r.title}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(r.impact || '—', r.impact === 'high' ? 'red' : r.impact === 'medium' ? 'amber' : 'slate')}</td></tr>`).join('');
  const body = `
    <a href="/app/projects" style="font-size:12px;color:var(--muted)">← المشاريع</a>
    <div style="display:flex;align-items:center;gap:.75rem;margin:.6rem 0 1rem">
      <h2 style="font-size:18px">${p.name_ar}</h2>${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : 'blue')}${pill('RAG ' + tr(p.rag), ragColor)}
      <span style="font-size:12px;color:var(--muted)">${client?.name_ar || ''} · ${p.code || ''}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:.75rem;margin-bottom:1.25rem">
      ${stat('الإنجاز', Math.round(p.progress_pct || 0) + '%')}
      ${stat('إنجاز المهام', k.taskCompletionRate + '%')}
      ${stat('مهام متأخرة', k.lateTasks, k.lateTasks ? 'var(--red)' : '')}
      ${stat('قبول المخرجات', k.deliverableAcceptanceRate + '%')}
      ${stat('قيمة العقد', fmtSar(p.contract_value_halalas))}
      ${stat('الصرف الفعلي', canCost && !row._redacted_actual_spend_halalas ? fmtSar(p.actual_spend_halalas) : '••• محجوب', canCost ? '' : 'var(--faint)')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المخرجات (${dlv.length})</div>
        <table style="width:100%;border-collapse:collapse"><tbody>${dlvRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:13px">لا مخرجات</td></tr>'}</tbody></table>`)}
      <div style="display:flex;flex-direction:column;gap:1rem">
        ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:13px;margin-bottom:.5rem">توزيع المهام</div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => pill(`${s}: ${tmap[s] || 0}`, s === 'DONE' ? 'green' : s === 'BLOCKED' ? 'red' : 'slate')).join(' ')}</div></div>`)}
        ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المخاطر المفتوحة (${risks.length})</div>
          <table style="width:100%;border-collapse:collapse"><tbody>${riskRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:13px">لا مخاطر مفتوحة</td></tr>'}</tbody></table>`)}
      </div>
    </div>`;
  return layout({ user, active: 'projects', title: p.name_ar, subtitle: 'تفاصيل المشروع', body });
}

export function portfolioPage(user) {
  const rows = listProjects(user);
  const bySector = {};
  for (const p of rows) (bySector[p.sector_id] ||= []).push(p);
  const groups = Object.entries(bySector).map(([sid, ps]) => card(`<div class="p-4">
    <div class="font-bold text-sm mb-2">${sid} · ${ps.length} مشروع</div>
    ${ps.slice(0, 8).map((p) => `<div class="flex items-center gap-2 py-1 text-[13px]">
      ${pill(tr(p.rag), p.rag === 'RED' ? 'red' : p.rag === 'AMBER' ? 'amber' : 'green')}
      <span class="flex-1">${p.name_ar}</span><span class="text-muted text-[11px]">${pct(p.progress_pct)}</span></div>`).join('')}
  </div>`)).join('');
  return layout({ user, active: 'portfolio', title: 'محفظة المشاريع', body: `<div class="grid grid-cols-2 gap-4">${groups}</div>` });
}
