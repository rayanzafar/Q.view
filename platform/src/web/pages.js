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
import { orgTree } from '../modules/org/org.js';
import { financeSummary, financeByPM, financeByContract, contractDetail } from '../modules/finance/finance.js';
import { canSeeSensitive, redact, can } from '../core/rbac/index.js';

const pct = (n) => `${Math.round(n || 0)}%`;
// HTML-escape user-controlled strings before interpolating into SSR markup (defense against stored XSS
// now that intake/manual entry accept free-text names, clients, notes).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  const qRev = quarterlyRevenue(null, year);
  const qBook = quarterlyBookings(null, year);
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
  const revPct = t.target_revenue ? t.revenue / t.target_revenue * 100 : 0;
  const salesPct = t.target_sales ? t.sales / t.target_sales * 100 : 0;
  const heroBlock = (label, val, target, p, color, extra) => `
    <div style="display:flex;align-items:center;gap:1.15rem;flex:1;min-width:290px">
      <div style="flex:0 0 auto">${gauge(p, { color, size: 118, sw: 11, center: pct(p), centerSize: 25, sub: 'من الهدف' })}</div>
      <div style="min-width:0">
        <div style="color:rgba(255,255,255,.72);font-size:12.5px;font-weight:600">${label}</div>
        <div class="metric tnum" style="color:#fff;margin-top:.2rem;font-size:1.85rem">${fmtSar(val)}</div>
        <div style="color:rgba(255,255,255,.55);font-size:11.5px" class="tnum">الهدف ${fmtSar(target)}</div>
        <div style="margin-top:.45rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">${extra || ''}</div>
      </div>
    </div>`;
  const sectorCards = ov.sectors.map((s) => card(`
    <div style="padding:.8rem .9rem">
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
        ${ov.canSeeMargin ? (() => { const gm = grossMargin(s.id, year); return gm.margin_pct != null ? `<span>هامش: <b style="color:${gm.margin_pct >= 20 ? 'var(--green)' : gm.margin_pct >= 10 ? 'var(--amber)' : 'var(--red)'}">${gm.margin_pct}%</b></span>` : ''; })() : ''}
      </div>
    </div>`, 'card-h')).join('');
  // sector achievement (revenue) comparison, sorted, colored by sector — the "how much each achieved" chart
  const sectorAchv = [...ov.sectors].map((s) => ({ label: esc(s.name_ar), value: s.revenue_halalas || 0, color: s.color || '#2563eb', sub: pct(s.revenue_pct) })).sort((a, b) => b.value - a.value);
  // dense secondary metric inside the hero (fills what used to be dead banner space)
  const hm = (label, val, sub) => `<div style="flex:1;min-width:118px;max-width:220px;overflow:hidden"><div style="color:rgba(255,255,255,.58);font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div><div class="tnum" style="color:#fff;font-weight:800;font-size:1.02rem;margin-top:.12rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${val}</div>${sub ? `<div style="color:rgba(255,255,255,.42);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" class="tnum">${sub}</div>` : ''}</div>`;
  const body = `
    ${riskBanner}
    <div style="border-radius:18px;padding:1.25rem 1.5rem;margin-bottom:.9rem;color:#fff;background:linear-gradient(135deg,#0f2350,#182a5e 55%,#3a1660);box-shadow:0 16px 34px -18px rgba(58,22,96,.6);position:relative;overflow:hidden">
      <div style="position:absolute;inset-inline-end:-40px;top:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(124,58,237,.32),transparent 70%);pointer-events:none"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.9rem;position:relative">
        <div style="color:rgba(255,255,255,.62);font-size:12px;font-weight:600">الأداء على مستوى الشركة · السنة المالية ${ov.fiscalYear}</div>
        ${b2b.ratio != null ? `<span style="font-size:11.5px;font-weight:700;background:rgba(255,255,255,.12);padding:.3rem .7rem;border-radius:999px">Book-to-Bill ${b2b.ratio}×</span>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:1.25rem;align-items:center;position:relative">
        ${heroBlock('إجمالي الإيرادات المحققة', t.revenue, t.target_revenue, revPct, '#34d399', yoyBadge(revYoy))}
        <div style="width:1px;align-self:stretch;background:rgba(255,255,255,.12)"></div>
        ${heroBlock('إجمالي المبيعات (حجوزات)', t.sales, t.target_sales, salesPct, '#c07bff', yoyBadge(bookYoy))}
      </div>
      <div style="display:flex;gap:1.1rem;flex-wrap:wrap;margin-top:.95rem;padding-top:.85rem;border-top:1px solid rgba(255,255,255,.1);position:relative">
        ${hm('خط الفرص المفتوح', fmtSar(ov.pipeline_halalas), 'مرجّح ' + fmtSar(cov.weighted_halalas))}
        ${hm('معدل الفوز', pct(wr.rate), `فوز ${wr.won} · خسارة ${wr.lost}`)}
        ${hm('الأعمال المتعاقدة', fmtSar(bk.backlog_halalas), 'Backlog لم يُحقَّق')}
        ${hm('تحقيق الإيراد', pct(revPct), 'من ' + fmtSar(t.target_revenue))}
        ${hm('تحقيق المبيعات', pct(salesPct), 'من ' + fmtSar(t.target_sales))}
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
    </div>`;
  return layout({ user, active: 'ceo', title: 'لوحة القيادة', subtitle: `نظرة تنفيذية · السنة المالية ${year}`, body, year });
}

export function sectorPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const sectorId = user.sector_id || 'SOLUTIONS';
  const sd = sectorDashboard(user, sectorId, { year });
  const pipe = pipelineSummary(user);
  if (!sd) return layout({ user, active: 'sector', title: 'مركز القطاع', body: '<div style="color:var(--muted)">لا يوجد قطاع مرتبط</div>' });
  const staff = sectorStaffing(sectorId, year);
  const clients = sectorClients(sectorId);
  const wins = sectorWins(sectorId, year);
  const tasks = all(`SELECT t.title, t.status, t.priority, t.due_date, COALESCE(u.name_ar,u.username,'—') assignee
     FROM task t LEFT JOIN app_user u ON u.id=t.assignee_user_id
     WHERE t.sector_id=? AND t.deleted_at IS NULL AND t.status != 'DONE' ORDER BY t.due_date LIMIT 12`, [sectorId]);
  const stat = (label, val, sub, tone) => card(`<div style="padding:.85rem 1rem"><div style="font-size:11px;color:var(--muted)">${label}</div><div class="metric tnum" style="font-size:1.45rem;color:${tone || 'var(--ink2)'}">${val}</div>${sub ? `<div style="font-size:11px;color:var(--muted)">${sub}</div>` : ''}</div>`);
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
    <td style="padding:.4rem .6rem;width:150px">${utilStrip(e.months)}</td>
    <td style="padding:.4rem .6rem;text-align:center;font-weight:800;font-size:13px" class="tnum" style="color:${utilTone(e.utilization)}">${e.utilization}%</td></tr>`).join('') || '<tr><td colspan="4" style="padding:1rem;color:var(--muted);font-size:12px">لا تسكين مسجّل لهذا القطاع في ' + year + '</td></tr>';
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
  const body = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:.85rem;margin-bottom:.9rem">
      ${stat(`إيراد ${year}`, fmtSar(sd.revenue_halalas), `مبيعات ${fmtSar(sd.sales_halalas)}`)}
      ${stat(`عقود ${year}`, fmtSar(sd.contracts_halalas), `${sd.contracts_count} عقد`)}
      ${stat('يوتيليزيشن الفريق', staff.teamUtil + '%', `${staff.headcount} موظفًا مُسكَّنًا`, utilTone(staff.teamUtil))}
      ${stat('الفوز', wins.won + ' فرصة', `نسبة ${wins.winRate}% · خسارة ${wins.lost}`, 'var(--green)')}
      ${stat('مشاريع قائمة', sd.projects.IN_PROGRESS || 0, `مخاطر مفتوحة ${sd.openRisks}`)}
    </div>
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.85rem 1rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)"><div style="font-weight:800;font-size:13.5px">التسكين الشهري واليوتيليزيشن</div><span style="font-size:10.5px;color:var(--muted)">أخضر ≥80% · أصفر · أحمر تجاوز</span></div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>${th({ t: 'الموظف' })}${th({ t: 'مشاريع', a: 'center' })}${th({ t: 'ينا … ديس (شهريًا)', a: 'center' })}${th({ t: 'اليوتيليزيشن', a: 'center' })}</tr></thead><tbody>${staffRows}</tbody></table>`)}
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
    </div>`;
  return layout({ user, active: 'sector', title: `مركز القطاع — ${esc(sd.sector.name_ar)}`, subtitle: `قيادة القطاع · السنة المالية ${year}`, body, year });
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
export function myOpportunitiesPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const scoped = listOpportunities(user);
  const rows = scoped.filter((o) => o.owner_user_id === user.id);
  const stages = all('SELECT id,name_ar,color,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const clients = Object.fromEntries(all('SELECT id,name_ar FROM client').map((c) => [c.id, c.name_ar]));

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

export function projectsPage(user) {
  const rows = listProjects(user);
  const canCost = canSeeSensitive(user, 'cost');
  const canEdit = can(user, 'update', 'project');
  const clients = Object.fromEntries(all('SELECT id,name_ar FROM client').map((c) => [c.id, c.name_ar]));
  const sectors = Object.fromEntries(all('SELECT id,name_ar FROM sector').map((s) => [s.id, s.name_ar]));
  const ragTone = { GREEN: 'green', AMBER: 'amber', RED: 'red' };

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
      <div class="km"><span class="kv tnum">${fmtSar(p.contract_value_halalas)}</span>
        <span class="tnum" style="margin-inline-start:auto">${pct(p.progress_pct)}</span></div>
      <div class="bar" style="margin-top:.5rem"><span style="width:${Math.min(100, p.progress_pct || 0)}%;background:${ragHex[p.rag] || '#2563eb'}"></span></div>
    </div>`;
  };
  const columns = cols.map((c) => {
    const items = byStatus[c.id] || [];
    const val = items.reduce((a, p) => a + (p.contract_value_halalas || 0), 0);
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
    <td class="px-3 text-[13px] tnum">${fmtSar(p.contract_value_halalas)}</td>
    <td class="px-3 text-[12px] tnum">${canCost && !p._redacted_actual_spend_halalas ? fmtSar(p.actual_spend_halalas) : '<span class="text-slate-300">•••</span>'}</td>
    <td class="px-3 text-[12px] text-muted tnum">${pct(p.progress_pct)}</td></tr>`).join('');

  const body = `
    <div class="toolbar">
      <div class="seg"><button class="on" data-view="kanban" onclick="Sanad.pmoView('prj','kanban')">${icon('kanban')} كانبان</button>
        <button data-view="table" onclick="Sanad.pmoView('prj','table')">${icon('list')} جدول</button></div>
      <div class="search">${icon('search')}<input class="input" id="prj-q" aria-label="بحث في المشاريع" oninput="Sanad.prjFilter()" placeholder="ابحث في المشاريع…"></div>
      <div class="spacer"></div>
      ${canCost ? pill('ترى التكلفة الفعلية', 'green') : pill('التكلفة محجوبة عنك', 'slate')}
      ${canEdit ? `<button class="btn btn-primary" onclick="Sanad.projAdd()">${icon('plus')} مشروع جديد</button>` : ''}
    </div>
    <div id="prj-kanban" class="kanban" data-kind="prj">${columns}</div>
    <div id="prj-table" class="card" style="display:none;overflow-x:auto">
      <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
        <th class="py-2 px-3 font-medium">المشروع</th><th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">RAG</th>
        <th class="px-3 font-medium">قيمة العقد</th><th class="px-3 font-medium">الصرف الفعلي</th><th class="px-3 font-medium">الإنجاز</th></tr></thead>
      <tbody>${tableRows || '<tr><td class="p-4 text-muted text-sm" colspan="6">لا مشاريع ضمن نطاقك</td></tr>'}</tbody></table></div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{sectors:${JSON.stringify(all('SELECT id,name_ar FROM sector WHERE active=1 ORDER BY name_ar'))},canEditPrj:${canEdit}});</script>`;
  return layout({ user, active: 'projects', title: 'المشاريع', subtitle: 'PMO · لوحة الحالة', body });
}

export function tasksPage(user) {
  const rows = myTasks(user);
  const stColor = { TODO: 'slate', IN_PROGRESS: 'blue', BLOCKED: 'red', IN_REVIEW: 'amber', DONE: 'green' };
  const list = rows.map((t) => `<tr class="border-b border-line hover:bg-slate-50" data-task="${t.id}">
    <td class="py-2.5 px-3 text-[13px]">${esc(t.title)}</td>
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
    <td class="py-2 px-3 text-[13px]">${esc(e.name_ar)}</td>
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
    <td class="py-2 px-3 text-[13px]">${esc(u.name_ar || '')}<div class="text-[11px] text-muted">${esc(u.username || '— بلا دخول')}</div></td>
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

export function orgPage(user) {
  const tree = orgTree(user);
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
    <td style="padding:.5rem .75rem;font-size:13px">${esc(p.pm)}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(p.contract_halalas)}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(p.invoiced_halalas)}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum">${fmtSar(p.collected_halalas)}</td>
    <td style="padding:.5rem .75rem;font-size:13px;text-align:center" class="tnum" style="color:var(--amber)">${fmtSar(p.outstanding_halalas)}</td></tr>`).join('');
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

export function projectDetailPage(user, projectId) {
  const p = get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('المشروع غير موجود', 'ربما حُذف المشروع أو أن الرابط غير صحيح.', '/app/projects', 'العودة للمشاريع') });
  if (!can(user, 'read', 'project', p)) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('لا تملك صلاحية الوصول', 'هذا المشروع خارج نطاق صلاحياتك الحالية — تواصل مع مدير النظام إن كنت تحتاج الوصول.', '/app/projects', 'العودة للمشاريع') });
  const row = redact(user, 'project', p);
  const k = projectKpis(p.id);
  const canCost = canSeeSensitive(user, 'cost');
  const canEdit = can(user, 'update', 'project', p);
  const tasks = all("SELECT status, COUNT(*) n FROM task WHERE project_id=? AND deleted_at IS NULL GROUP BY status", [p.id]);
  const tmap = Object.fromEntries(tasks.map((t) => [t.status, t.n]));
  const dlv = all("SELECT name_ar, amount_halalas, status, month FROM deliverable WHERE project_id=? AND deleted_at IS NULL ORDER BY month LIMIT 24", [p.id]);
  const risks = all("SELECT title, impact, status FROM risk WHERE project_id=? AND status!='CLOSED' LIMIT 10", [p.id]);
  const client = get('SELECT id, name_ar FROM client WHERE id=?', [p.client_id]);
  const owner = p.owner_user_id ? get('SELECT name_ar, username FROM app_user WHERE id=?', [p.owner_user_id]) : null;
  const srcOpp = p.source_opp_id ? get('SELECT id, title_ar FROM opportunity WHERE id=? AND deleted_at IS NULL', [p.source_opp_id]) : null;
  const contract = get("SELECT id, code, value_halalas, status FROM contract WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [p.id]);
  // Team assigned to this project (from the allocation model), with each member's month-coverage on THIS project.
  const staff = all(`SELECT a.person_name_ar, a.type, a.monthly_json, e.job_title
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

export function portfolioPage(user) {
  const rows = listProjects(user);
  const bySector = {};
  for (const p of rows) (bySector[p.sector_id] ||= []).push(p);
  const groups = Object.entries(bySector).map(([sid, ps]) => card(`<div class="p-4">
    <div class="font-bold text-sm mb-2">${sid} · ${ps.length} مشروع</div>
    ${ps.slice(0, 8).map((p) => `<div class="flex items-center gap-2 py-1 text-[13px]">
      ${pill(tr(p.rag), p.rag === 'RED' ? 'red' : p.rag === 'AMBER' ? 'amber' : 'green')}
      <span class="flex-1">${esc(p.name_ar)}</span><span class="text-muted text-[11px]">${pct(p.progress_pct)}</span></div>`).join('')}
  </div>`)).join('');
  return layout({ user, active: 'portfolio', title: 'محفظة المشاريع', body: `<div class="grid grid-cols-2 gap-4">${groups}</div>` });
}
