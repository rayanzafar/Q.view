// SSR layout + role-based navigation. World-class design system, SVG icons, year-aware header.
import { can } from '../core/rbac/index.js';
import { ROLE_LABELS } from '../core/rbac/matrix.js';
import { icon } from './icons.js';
import { availableYears } from '../core/reports/metrics.js';
import { config } from '../core/config.js';

const NAV = [
  { key: 'ceo', ar: 'لوحة القيادة', ic: 'ceo', group: 'company', show: (u) => u.scope === 'company' },
  { key: 'portfolio', ar: 'محفظة المشاريع', ic: 'portfolio', group: 'company', show: (u) => u.scope === 'company' },
  { key: 'sector', ar: 'مركز القطاع', ic: 'sector', group: 'work', show: (u) => can(u, 'read', 'project') || can(u, 'read', 'opportunity') },
  { key: 'opportunities', ar: 'الفرص', ic: 'opportunity', group: 'work', show: (u) => can(u, 'read', 'opportunity') },
  { key: 'projects', ar: 'المشاريع', ic: 'projects', group: 'work', show: (u) => can(u, 'read', 'project') },
  { key: 'tasks', ar: 'مهامي', ic: 'tasks', group: 'work', show: () => true },
  { key: 'timesheet', ar: 'سجل الوقت', ic: 'timesheet', group: 'work', show: () => true },
  { key: 'approvals', ar: 'الاعتمادات', ic: 'approvals', group: 'work', show: (u) => ['admin', 'sector_lead', 'finance', 'department_manager', 'line_manager', 'approver', 'ceo_office'].includes(u.role_id) },
  { key: 'finance', ar: 'المالية والعقود', ic: 'money', group: 'manage', show: (u) => can(u, 'read', 'invoice') || can(u, 'read', 'contract') },
  { key: 'team', ar: 'الفريق', ic: 'team', group: 'manage', show: (u) => can(u, 'read', 'employee') },
  { key: 'reports', ar: 'التقارير والبريد', ic: 'reports', group: 'manage', show: (u) => can(u, 'read', 'report') },
  { key: 'org', ar: 'الهيكل التنظيمي', ic: 'sector', group: 'admin', show: (u) => u.role_id === 'admin' || can(u, 'create', 'sector') || can(u, 'create', 'employee') },
  { key: 'users', ar: 'المستخدمون والصلاحيات', ic: 'users', group: 'admin', show: (u) => u.role_id === 'admin' },
  { key: 'audit', ar: 'سجل التدقيق', ic: 'audit', group: 'admin', show: (u) => u.role_id === 'admin' },
];
const GROUPS = { company: 'قيادة الشركة', work: 'العمل اليومي', manage: 'الإدارة', admin: 'النظام' };

export function navFor(user) { return NAV.filter((n) => { try { return n.show(user); } catch { return false; } }); }

const STYLE = `
:root{
  --brand:#2563eb; --brand2:#7c3aed; --brand-grad:linear-gradient(120deg,#2563eb,#7c3aed);
  --side:linear-gradient(170deg,#0f2350 0%,#182a5e 45%,#3a1660 100%);
  --ink:#0f172a; --ink2:#1e293b; --muted:#64748b; --faint:#94a3b8;
  --line:#e6e9f0; --bg:#f6f7fb; --surface:#fff;
  --green:#059669; --amber:#d97706; --red:#dc2626; --blue:#2563eb;
  --r:14px; --r-sm:10px; --sh-sm:0 1px 2px rgba(15,23,42,.05),0 1px 3px rgba(15,23,42,.05);
  --sh:0 2px 8px rgba(15,23,42,.06),0 12px 28px rgba(37,99,235,.07);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Segoe UI',Tahoma,system-ui,-apple-system,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased;letter-spacing:-.003em}
h1,h2,h3,h4{margin:0;color:var(--ink2);font-weight:700;letter-spacing:-.01em}
a{text-decoration:none;color:inherit}
.tnum{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-sm);transition:box-shadow .18s,transform .18s,border-color .18s}
.card-h:hover{box-shadow:var(--sh);transform:translateY(-1px);border-color:#d6def0}
.pill{display:inline-flex;align-items:center;gap:.3rem;padding:.2rem .55rem;border-radius:999px;font-size:.7rem;font-weight:700;line-height:1;white-space:nowrap}
.nav-a{display:flex;align-items:center;gap:.6rem;padding:.55rem .9rem;font-size:13px;color:rgba(255,255,255,.72);border-radius:10px;margin:1px .5rem;transition:background .15s,color .15s}
.nav-a:hover{background:rgba(255,255,255,.08);color:#fff}
.nav-a.on{background:rgba(255,255,255,.14);color:#fff;font-weight:700}
.nav-a svg{opacity:.85;flex:0 0 auto}
.grp{padding:.9rem .9rem .25rem;font-size:10px;font-weight:800;letter-spacing:.08em;color:rgba(255,255,255,.38)}
::selection{background:rgba(124,58,237,.2)}
::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:99px;border:2px solid var(--bg)}
.metric{font-size:1.9rem;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.bar{height:6px;background:#eef1f7;border-radius:999px;overflow:hidden}
.bar>span{display:block;height:100%;border-radius:999px}
select.yr{background:#fff;border:1px solid var(--line);border-radius:8px;padding:.3rem .6rem;font-size:12px;font-weight:700;color:var(--ink2)}
`;

export function layout({ user, active, title, subtitle, body, year, extraHead = '' }) {
  const items = navFor(user);
  const byGroup = {};
  for (const n of items) (byGroup[n.group] ||= []).push(n);
  const roleLabel = ROLE_LABELS[user.role_id]?.ar || user.role_id;
  const initial = (user.name_ar || user.username || '?').trim().charAt(0);
  const nav = Object.entries(byGroup).map(([g, ns]) => `
    <div class="grp">${GROUPS[g] || ''}</div>
    ${ns.map((n) => `<a href="/app/${n.key}${year ? '?year=' + year : ''}" class="nav-a ${active === n.key ? 'on' : ''}">${icon(n.ic)}<span>${n.ar}</span></a>`).join('')}`).join('');

  const years = availableYears();
  const showYear = ['ceo', 'portfolio', 'sector'].includes(active);
  const yearSel = showYear ? `<select class="yr" onchange="location.search='?year='+this.value">
    ${years.map((y) => `<option value="${y}" ${String(y) === String(year || config.fiscalYear) ? 'selected' : ''}>سنة ${y}</option>`).join('')}
  </select>` : '';

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title || 'سند'} · منصة سند EVC</title>
<script src="/static/tailwind.js"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:'#2563eb',brand2:'#7c3aed',ink:'#0f172a',ink2:'#1e293b',muted:'#64748b',faint:'#94a3b8',line:'#e6e9f0'}}}}</script>
<style>${STYLE}</style>
<link rel="stylesheet" href="/static/styles.css">${extraHead}</head>
<body>
<div style="display:flex;min-height:100vh">
  <aside style="width:250px;flex:0 0 250px;background:var(--side);display:flex;flex-direction:column;color:#fff">
    <div style="padding:1.1rem 1.1rem;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:.6rem">
      <div style="width:34px;height:34px;border-radius:9px;background:var(--brand-grad);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px">EVC</div>
      <div><div style="font-weight:800;font-size:15px">سند</div><div style="font-size:10px;color:rgba(255,255,255,.5)">نظام تشغيل الأعمال</div></div>
    </div>
    <nav style="flex:1;overflow-y:auto;padding:.4rem 0">${nav}</nav>
    <div style="padding:.8rem 1.1rem;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:rgba(255,255,255,.55)">السنة المالية ${config.fiscalYear} · SAR</div>
  </aside>
  <div style="flex:1;display:flex;flex-direction:column;min-width:0">
    <header style="height:60px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 1.5rem;flex:0 0 auto">
      <div><div style="font-weight:800;font-size:16px">${title || ''}</div>${subtitle ? `<div style="font-size:12px;color:var(--muted)">${subtitle}</div>` : ''}</div>
      <div style="display:flex;align-items:center;gap:1rem">
        ${yearSel}
        <a href="/app/tasks" title="الإشعارات" style="position:relative;color:var(--muted)">${icon('bell')}<span id="notif-badge" style="display:none;position:absolute;top:-4px;left:-4px;background:var(--red);color:#fff;font-size:9px;border-radius:99px;padding:1px 4px;font-weight:700"></span></a>
        <div style="display:flex;align-items:center;gap:.55rem">
          <div style="width:34px;height:34px;border-radius:50%;background:var(--brand-grad);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">${initial}</div>
          <div style="text-align:right"><div style="font-size:13px;font-weight:700">${user.name_ar || user.username}</div><div style="font-size:11px;color:var(--muted)">${roleLabel}</div></div>
        </div>
        <form method="post" action="/auth/logout-web"><button title="خروج" style="color:var(--muted);background:none;border:none;cursor:pointer">${icon('logout')}</button></form>
      </div>
    </header>
    <main style="flex:1;overflow-y:auto;padding:1.5rem">${body}</main>
  </div>
</div>
<button onclick="Sanad.aiToggle()" title="مساعد سند الذكي" style="position:fixed;bottom:22px;left:22px;z-index:40;width:54px;height:54px;border:none;cursor:pointer;border-radius:50%;color:#fff;box-shadow:0 10px 30px -6px rgba(124,58,237,.55);background:var(--brand-grad);display:flex;align-items:center;justify-content:center">${icon('ai')}</button>
<div id="ai-panel" class="card" style="display:none;position:fixed;bottom:88px;left:22px;z-index:40;width:390px;max-width:calc(100vw - 2rem);height:min(580px,calc(100vh - 130px));flex-direction:column;overflow:hidden;box-shadow:var(--sh)">
  <div style="padding:.8rem 1rem;color:#fff;display:flex;align-items:center;justify-content:space-between;background:linear-gradient(120deg,#0f2350,#3a1660)">
    <div style="display:flex;align-items:center;gap:.5rem">${icon('ai')}<div><div style="font-weight:800;font-size:13px">مساعد سند الذكي</div><div id="ai-mode" style="font-size:10px;color:rgba(255,255,255,.6)">…</div></div></div>
    <button onclick="Sanad.aiToggle()" style="color:rgba(255,255,255,.7);background:none;border:none;cursor:pointer;font-size:16px">✕</button>
  </div>
  <div id="ai-box" style="flex:1;overflow-y:auto;padding:.75rem;display:flex;flex-direction:column;gap:.5rem;background:var(--bg);font-size:13px">
    <div style="text-align:center;color:var(--muted);font-size:12px;line-height:1.9;padding:1rem">جرّب: «لخّص مشروع…» · «تقرير أسبوعي» · «المخاطر» · «جودة البيانات» · «أولوياتي» · «انقل الفرصة X إلى فائزة»</div>
  </div>
  <div style="padding:.5rem;border-top:1px solid var(--line);display:flex;gap:.5rem">
    <input id="ai-input" onkeydown="if(event.key==='Enter')Sanad.aiSend()" placeholder="اكتب…" style="flex:1;border:1px solid var(--line);border-radius:10px;padding:.5rem .75rem;font-size:13px">
    <button onclick="Sanad.aiSend()" style="color:#fff;border:none;cursor:pointer;padding:0 .9rem;border-radius:10px;background:var(--brand-grad)">↑</button>
  </div>
</div>
<script src="/static/app.js"></script>
</body></html>`;
}

export function card(inner, cls = '') { return `<div class="card ${cls}">${inner}</div>`; }
export function pill(text, color = 'slate') {
  const c = { green: '#dcfce7|#059669', red: '#fee2e2|#dc2626', amber: '#fef3c7|#b45309', blue: '#dbeafe|#2563eb', violet: '#ede9fe|#7c3aed', slate: '#f1f5f9|#475569' }[color] || '#f1f5f9|#475569';
  const [bg, fg] = c.split('|');
  return `<span class="pill" style="background:${bg};color:${fg}">${text}</span>`;
}
// Inline SVG mini bar chart for multi-year trends.
export function miniBars(series, valueKey, opts = {}) {
  const w = opts.w || 260, h = opts.h || 90, pad = 22, n = series.length || 1;
  const max = Math.max(1, ...series.map((s) => s[valueKey] || 0));
  const bw = (w - pad) / n * 0.6, gap = (w - pad) / n;
  const bars = series.map((s, i) => {
    const val = s[valueKey] || 0;
    const bh = Math.round((val / max) * (h - 28));
    const x = pad + i * gap + (gap - bw) / 2;
    const y = h - 16 - bh;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="3" fill="url(#g)"/>
      <text x="${x + bw / 2}" y="${h - 4}" font-size="9" fill="#94a3b8" text-anchor="middle">${s.year}</text>
      <text x="${x + bw / 2}" y="${y - 3}" font-size="8.5" fill="#475569" text-anchor="middle" font-weight="700">${opts.fmt ? opts.fmt(val) : Math.round(val)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>${bars}</svg>`;
}
