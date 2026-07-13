// SSR layout + role-based navigation. Nav items are filtered by server-side permissions.
import { can } from '../core/rbac/index.js';
import { ROLE_LABELS } from '../core/rbac/matrix.js';

// Nav model. `show` is a predicate over the user (server-side gate).
const NAV = [
  { key: 'ceo', ar: 'لوحة الرئيس التنفيذي', icon: '★', group: 'company',
    show: (u) => u.scope === 'company' },
  { key: 'portfolio', ar: 'محفظة المشاريع', icon: '▦', group: 'company',
    show: (u) => u.scope === 'company' },
  { key: 'sector', ar: 'مركز القطاع', icon: '◈', group: 'work',
    show: (u) => can(u, 'read', 'project') || can(u, 'read', 'opportunity') },
  { key: 'opportunities', ar: 'الفرص', icon: '◉', group: 'work',
    show: (u) => can(u, 'read', 'opportunity') },
  { key: 'projects', ar: 'المشاريع', icon: '▣', group: 'work',
    show: (u) => can(u, 'read', 'project') },
  { key: 'tasks', ar: 'مهامي', icon: '✓', group: 'work', show: () => true },
  { key: 'timesheet', ar: 'سجل الوقت', icon: '◷', group: 'work', show: () => true },
  { key: 'approvals', ar: 'الاعتمادات', icon: '⧉', group: 'work',
    show: (u) => ['admin', 'sector_lead', 'finance', 'department_manager', 'line_manager', 'approver', 'ceo_office'].includes(u.role_id) },
  { key: 'team', ar: 'الفريق', icon: '☰', group: 'manage',
    show: (u) => can(u, 'read', 'employee') },
  { key: 'reports', ar: 'التقارير والبريد', icon: '✉', group: 'manage',
    show: (u) => can(u, 'read', 'report') },
  { key: 'users', ar: 'المستخدمون والصلاحيات', icon: '⚙', group: 'admin',
    show: (u) => u.role_id === 'admin' },
  { key: 'audit', ar: 'سجل التدقيق', icon: '⛊', group: 'admin',
    show: (u) => u.role_id === 'admin' },
];

const GROUPS = { company: 'قيادة الشركة', work: 'العمل اليومي', manage: 'الإدارة', admin: 'النظام' };

export function navFor(user) {
  return NAV.filter((n) => { try { return n.show(user); } catch { return false; } });
}

export function layout({ user, active, title, body, extraHead = '' }) {
  const items = navFor(user);
  const byGroup = {};
  for (const n of items) (byGroup[n.group] ||= []).push(n);
  const roleLabel = ROLE_LABELS[user.role_id]?.ar || user.role_id;
  const nav = Object.entries(byGroup).map(([g, ns]) => `
    <div class="px-4 pt-4 pb-1 text-[10px] font-bold tracking-wide text-white/40">${GROUPS[g] || ''}</div>
    ${ns.map((n) => `<a href="/app/${n.key}" class="flex items-center gap-2.5 px-4 py-2 text-[13px] ${active === n.key ? 'bg-white/15 font-bold text-white border-r-2 border-white' : 'text-white/75 hover:bg-white/10'}">
      <span class="w-4 text-center opacity-80">${n.icon}</span><span>${n.ar}</span></a>`).join('')}
  `).join('');

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title || 'سند'} — منصة سند EVC</title>
<script src="/static/tailwind.js"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:'#2563eb',brand2:'#9333ea',ink:'#0f172a',muted:'#64748b',line:'#e2e8f0'}}}}</script>
<link rel="stylesheet" href="/static/styles.css">${extraHead}</head>
<body class="bg-slate-50 text-ink" style="font-family:'Segoe UI',Tahoma,system-ui,sans-serif">
<div class="flex min-h-screen">
  <aside class="w-64 shrink-0 text-white flex flex-col" style="background:linear-gradient(168deg,#11295c,#1c2a63 42%,#3a1660)">
    <div class="px-4 py-4 border-b border-white/10">
      <div class="text-lg font-extrabold tracking-wide" style="background:linear-gradient(120deg,#5b9bff,#c07bff);-webkit-background-clip:text;background-clip:text;color:transparent">EVC · سند</div>
      <div class="text-[11px] text-white/50">منصة إدارة الأعمال المؤسسية</div>
    </div>
    <nav class="flex-1 overflow-y-auto py-1">${nav}</nav>
    <div class="px-4 py-3 border-t border-white/10 text-[11px] text-white/60">FY 2026 · SAR</div>
  </aside>
  <div class="flex-1 flex flex-col min-w-0">
    <header class="h-14 bg-white border-b border-line flex items-center justify-between px-6 shrink-0">
      <div class="font-bold text-[15px]">${title || ''}</div>
      <div class="flex items-center gap-3">
        <span id="notif-badge" class="hidden text-[11px] bg-red-100 text-red-600 rounded-full px-2 py-0.5"></span>
        <div class="text-right">
          <div class="text-[13px] font-semibold">${user.name_ar || user.username}</div>
          <div class="text-[11px] text-muted">${roleLabel}</div>
        </div>
        <form method="post" action="/auth/logout-web"><button class="text-[12px] text-muted hover:text-red-600">خروج ↺</button></form>
      </div>
    </header>
    <main class="flex-1 overflow-y-auto p-6">${body}</main>
  </div>
</div>
<button onclick="Sanad.aiToggle()" title="مساعد سند الذكي" class="fixed bottom-5 left-5 z-40 w-13 h-13 rounded-full text-white shadow-2xl flex items-center justify-center text-xl hover:scale-105 transition"
  style="width:52px;height:52px;background:linear-gradient(120deg,#2563eb,#9333ea)">✨</button>
<div id="ai-panel" class="hidden fixed bottom-20 left-5 z-40 w-[380px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-line flex flex-col overflow-hidden" style="height:min(560px,calc(100vh - 120px))">
  <div class="px-4 py-3 text-white flex items-center justify-between" style="background:linear-gradient(120deg,#11295c,#3a1660)">
    <div><div class="font-bold text-sm">✨ مساعد سند الذكي</div><div id="ai-mode" class="text-[10px] text-white/60">…</div></div>
    <button onclick="Sanad.aiToggle()" class="text-white/70 hover:text-white">✕</button>
  </div>
  <div id="ai-box" class="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50 text-[13px]">
    <div class="text-center text-muted text-xs leading-relaxed py-4">اسألني: «لخّص مشروع…» · «تقرير أسبوعي» · «المخاطر» · «جودة البيانات» · «أولوياتي» · «انقل الفرصة X إلى فائزة»</div>
  </div>
  <div class="p-2 border-t border-line flex gap-2">
    <input id="ai-input" onkeydown="if(event.key==='Enter')Sanad.aiSend()" placeholder="اكتب…" class="flex-1 border border-line rounded-lg px-3 py-2 text-sm">
    <button onclick="Sanad.aiSend()" class="text-white text-[12px] px-3 rounded-lg" style="background:linear-gradient(120deg,#2563eb,#9333ea)">↑</button>
  </div>
</div>
<script src="/static/app.js"></script>
</body></html>`;
}

export function card(inner, cls = '') {
  return `<div class="bg-white border border-line rounded-xl shadow-sm ${cls}">${inner}</div>`;
}
export function pill(text, color = 'slate') {
  const map = { green: 'bg-green-100 text-green-700', red: 'bg-red-100 text-red-600',
    amber: 'bg-amber-100 text-amber-700', blue: 'bg-blue-100 text-blue-700', slate: 'bg-slate-100 text-slate-600' };
  return `<span class="inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 ${map[color] || map.slate}">${text}</span>`;
}
