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

/* ── component layer (v2 redesign) ── */
.btn{display:inline-flex;align-items:center;gap:.4rem;border:1px solid var(--line);background:#fff;color:var(--ink2);
  font-size:12.5px;font-weight:700;padding:.48rem .85rem;border-radius:10px;cursor:pointer;transition:all .15s;white-space:nowrap}
.btn:hover{border-color:#c9d3e8;background:#fbfcfe}
.btn svg{width:15px;height:15px}
.btn-primary{background:var(--brand-grad);color:#fff;border:none;box-shadow:0 6px 16px -6px rgba(37,99,235,.6)}
.btn-primary:hover{filter:brightness(1.06);background:var(--brand-grad)}
.btn-ghost{border:none;background:transparent;color:var(--muted)}
.btn-ghost:hover{background:#eef1f7;color:var(--ink2)}
.btn-sm{padding:.32rem .6rem;font-size:11.5px;border-radius:8px}
.toolbar{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:1.1rem}
.toolbar .spacer{margin-inline-start:auto}
.input{border:1px solid var(--line);border-radius:10px;padding:.5rem .7rem;font-size:13px;color:var(--ink2);background:#fff;font-family:inherit}
.input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.search{position:relative;display:flex;align-items:center}
.search svg{position:absolute;inset-inline-start:.6rem;width:15px;height:15px;color:var(--faint);pointer-events:none}
.search input{padding-inline-start:2rem;min-width:230px}
.seg{display:inline-flex;background:#eef1f7;border-radius:10px;padding:3px;gap:2px}
.seg button{border:none;background:none;cursor:pointer;font-size:12px;font-weight:700;color:var(--muted);padding:.35rem .7rem;border-radius:8px;display:flex;align-items:center;gap:.35rem}
.seg button.on{background:#fff;color:var(--ink2);box-shadow:var(--sh-sm)}

/* Kanban */
.kanban{display:flex;gap:.9rem;overflow-x:auto;padding-bottom:.75rem;align-items:flex-start;scroll-snap-type:x proximity}
.kcol{flex:0 0 300px;width:300px;background:#eef1f7;border-radius:14px;padding:.55rem;scroll-snap-align:start;max-height:calc(100vh - 240px);display:flex;flex-direction:column}
.kcol-head{display:flex;align-items:center;gap:.5rem;padding:.35rem .5rem .55rem}
.kcol-dot{width:9px;height:9px;border-radius:50%;flex:none}
.kcol-head .t{font-weight:800;font-size:13px}
.kcol-head .n{font-size:11px;color:var(--muted);font-weight:700}
.kcol-head .v{margin-inline-start:auto;font-size:11px;font-weight:800;color:var(--ink2)}
.kcol-body{display:flex;flex-direction:column;gap:.55rem;overflow-y:auto;padding:.15rem;min-height:60px}
.kcol.drop{outline:2px dashed var(--brand);outline-offset:-3px;background:#e4ebfa}
.kcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:.7rem .75rem;cursor:grab;box-shadow:var(--sh-sm);transition:box-shadow .15s,transform .1s;border-inline-start:3px solid var(--_c,#cbd5e1)}
.kcard:hover{box-shadow:var(--sh);transform:translateY(-1px)}
.kcard:active{cursor:grabbing}
.kcard.drag{opacity:.5}
.kcard .kt{font-weight:700;font-size:13px;color:var(--ink2);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.kcard .km{display:flex;align-items:center;gap:.4rem;margin-top:.5rem;font-size:11px;color:var(--muted);flex-wrap:wrap}
.kcard .kv{font-weight:800;color:var(--ink2)}
.kcard .kav{width:22px;height:22px;border-radius:50%;background:var(--brand-grad);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:800}

/* Drawer (slide-over from inline-end / left in RTL) */
.scrim{position:fixed;inset:0;background:rgba(15,23,42,.42);backdrop-filter:blur(2px);z-index:60;opacity:0;transition:opacity .22s;pointer-events:none}
.scrim.on{opacity:1;pointer-events:auto}
/* Anchored to the physical LEFT edge (opposite the RTL sidebar); hidden off-screen to the left. */
.drawer{position:fixed;top:0;bottom:0;left:0;right:auto;width:520px;max-width:94vw;background:var(--surface);z-index:61;
  box-shadow:0 0 60px rgba(15,23,42,.25);transform:translateX(-104%);transition:transform .26s cubic-bezier(.4,0,.2,1);
  display:flex;flex-direction:column;will-change:transform}
.drawer.on{transform:translateX(0)}
.drawer-head{padding:1.1rem 1.25rem;border-bottom:1px solid var(--line);display:flex;align-items:flex-start;gap:.75rem}
.drawer-body{flex:1;overflow-y:auto;padding:1.15rem 1.25rem}
.drawer-foot{padding:.85rem 1.25rem;border-top:1px solid var(--line);display:flex;gap:.6rem;justify-content:flex-start;background:var(--bg)}
.kv-row{display:flex;justify-content:space-between;gap:1rem;padding:.55rem 0;border-bottom:1px dashed var(--line);font-size:13px}
.kv-row .k{color:var(--muted)}.kv-row .v{font-weight:700;color:var(--ink2);text-align:end}
.editable{cursor:text;border-radius:6px;padding:.1rem .3rem;margin:-.1rem -.3rem;transition:background .12s}
.editable:hover{background:#f1f5ff;box-shadow:inset 0 0 0 1px #dbe3f5}

/* Modal */
.modal{position:fixed;z-index:62;inset:0;display:none;align-items:center;justify-content:center;padding:1rem}
.modal.on{display:flex}
.modal-card{background:var(--surface);border-radius:18px;width:520px;max-width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 30px 80px rgba(15,23,42,.35);animation:pop .2s ease}
@keyframes pop{from{transform:scale(.96) translateY(8px);opacity:0}to{transform:none;opacity:1}}
.modal-head{padding:1.1rem 1.35rem;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}
.modal-body{padding:1.25rem 1.35rem;display:grid;gap:.85rem}
.modal-foot{padding:.9rem 1.35rem;border-top:1px solid var(--line);display:flex;gap:.6rem;justify-content:flex-start}
.field{display:grid;gap:.3rem}
.field>label{font-size:11.5px;font-weight:700;color:var(--muted)}
.field .input,.field select,.field textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:.55rem .7rem;font-size:13px;font-family:inherit;background:#fff}
.field .input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:.85rem}
@media(max-width:520px){.grid2{grid-template-columns:1fr}}
@media prefers-reduced-motion{.drawer,.scrim,.modal-card{transition:none;animation:none}}
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
    <main style="flex:1;overflow-y:auto;padding:1.15rem 1.35rem">${body}</main>
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
<div id="scrim" class="scrim" onclick="Sanad.closeDrawer()"></div>
<aside id="drawer" class="drawer" aria-hidden="true"></aside>
<div id="modal" class="modal" onclick="if(event.target===this)Sanad.closeModal()"></div>
<script src="/static/app.js"></script>
</body></html>`;
}

export function card(inner, cls = '') { return `<div class="card ${cls}">${inner}</div>`; }

// Arabic labels for DB enum values so no raw English leaks into the RTL UI. tr() falls back
// to the original value for anything unmapped (e.g. already-Arabic names).
export const LABELS = {
  // project / generic status
  IN_PROGRESS: 'قيد التنفيذ', COMPLETED: 'مكتمل', PLANNED: 'مُخطَّط', ON_HOLD: 'متوقّف مؤقتًا', CANCELLED: 'ملغى', NOT_STARTED: 'لم يبدأ',
  // RAG
  GREEN: 'أخضر', AMBER: 'أصفر', RED: 'أحمر',
  // task status
  TODO: 'قيد الانتظار', BLOCKED: 'مُعطَّل', IN_REVIEW: 'قيد المراجعة', DONE: 'منجز',
  // priority
  P0: 'حرجة', P1: 'عالية', P2: 'متوسطة', P3: 'منخفضة',
  // deliverable status
  DELIVERED: 'مُسلَّم', PENDING: 'قيد الإعداد', ACCEPTED: 'مقبول', INVOICED: 'مُفوتَر', PAID: 'مدفوع',
  // invoice status
  ISSUED: 'صادر', PARTIALLY_PAID: 'مدفوع جزئيًا', OVERDUE: 'متأخر', DRAFT: 'مسودة',
  // contract status
  ACTIVE: 'نشط', CLOSED: 'مغلق', SUSPENDED: 'موقوف',
  // report/email queue + approvals
  SENT: 'أُرسل', FAILED: 'فشل', QUEUED: 'في الطابور', PROCESSING: 'قيد المعالجة',
  APPROVED: 'معتمد', REJECTED: 'مرفوض',
  // audit actions
  create: 'إنشاء', update: 'تعديل', delete: 'حذف', login: 'تسجيل دخول', logout: 'تسجيل خروج', approve: 'اعتماد', reject: 'رفض',
};
export const tr = (v) => (v == null ? v : (LABELS[v] || v));

export function pill(text, color = 'slate') {
  const c = { green: '#dcfce7|#059669', red: '#fee2e2|#dc2626', amber: '#fef3c7|#b45309', blue: '#dbeafe|#2563eb', violet: '#ede9fe|#7c3aed', slate: '#f1f5f9|#475569' }[color] || '#f1f5f9|#475569';
  const [bg, fg] = c.split('|');
  return `<span class="pill" style="background:${bg};color:${fg}">${text}</span>`;
}
// Inline SVG bar chart. Fills its container width (height follows the viewBox aspect), with
// gridlines, value labels and an emphasized latest bar. Unique gradient id per instance.
let _miniBarsSeq = 0;
export function miniBars(series, valueKey, opts = {}) {
  const n = series.length || 1;
  const W = opts.w || 480, H = opts.h || 150, padT = 18, padB = 24, padX = 10;
  const gid = 'mbGrad' + (++_miniBarsSeq);
  const max = Math.max(1, ...series.map((s) => s[valueKey] || 0));
  const plotH = H - padT - padB, gap = (W - padX * 2) / n, bw = Math.min(46, gap * 0.56);
  let grid = '';
  for (let i = 0; i <= 3; i++) { const gy = padT + plotH * i / 3; grid += `<line x1="${padX}" x2="${W - padX}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#eef1f7" stroke-width="1"/>`; }
  const bars = series.map((s, i) => {
    const val = s[valueKey] || 0;
    const bh = Math.max(2, Math.round((val / max) * plotH));
    const x = padX + i * gap + (gap - bw) / 2;
    const y = padT + plotH - bh;
    const last = i === n - 1;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="4" fill="url(#${gid})" opacity="${last ? 1 : 0.8}"/>
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 7}" font-size="11" fill="#94a3b8" text-anchor="middle">${s.year}</text>
      <text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" font-size="11" fill="${last ? '#7c3aed' : '#475569'}" text-anchor="middle" font-weight="800">${opts.fmt ? opts.fmt(val) : Math.round(val)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>${grid}${bars}</svg>`;
}

// Horizontal comparison bars (e.g. revenue achieved per sector). items: [{label,value,color,sub}].
export function hbars(items, opts = {}) {
  const max = Math.max(1, ...items.map((i) => i.value || 0));
  return `<div style="display:flex;flex-direction:column;gap:.7rem">${items.map((i) => {
    const w = Math.round(((i.value || 0) / max) * 100);
    return `<div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;margin-bottom:.28rem">
        <span style="display:flex;align-items:center;gap:.45rem;min-width:0"><span style="width:9px;height:9px;border-radius:2px;background:${i.color || '#2563eb'};flex:none"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.label}</span></span>
        <span class="tnum" style="font-weight:800;color:var(--ink2);flex:none;margin-inline-start:.6rem">${opts.fmt ? opts.fmt(i.value) : i.value}${i.sub ? `<span style="font-weight:600;color:var(--muted);font-size:11px"> · ${i.sub}</span>` : ''}</span>
      </div>
      <div style="height:10px;background:#eef1f7;border-radius:999px;overflow:hidden"><div style="width:${w}%;height:100%;background:${i.color || '#2563eb'};border-radius:999px;transition:width .5s"></div></div>
    </div>`;
  }).join('')}</div>`;
}

// Radial attainment gauge (SVG donut). pct may exceed 100 (over-target) — arc clamps, label shows true %.
export function gauge(pct, opts = {}) {
  const size = opts.size || 128, sw = opts.sw || 12, r = (size - sw) / 2, C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct || 0));
  const off = C * (1 - p / 100);
  const col = opts.color || '#34d399', track = opts.track || 'rgba(255,255,255,.16)';
  const cx = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <g transform="rotate(-90 ${cx} ${cx})">
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </g>
    <text x="${cx}" y="${cx - 4}" text-anchor="middle" dominant-baseline="central" fill="${opts.centerColor || '#fff'}" font-size="${opts.centerSize || 26}" font-weight="800" font-family="'Segoe UI',sans-serif">${opts.center || (Math.round(pct || 0) + '%')}</text>
    ${opts.sub ? `<text x="${cx}" y="${cx + 18}" text-anchor="middle" fill="${opts.subColor || 'rgba(255,255,255,.6)'}" font-size="10.5" font-weight="600">${opts.sub}</text>` : ''}
  </svg>`;
}
