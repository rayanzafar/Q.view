// SSR layout + role-based navigation. World-class design system, SVG icons, year-aware header.
import { ROLE_LABELS } from '../core/rbac/matrix.js';
import { icon } from './icons.js';
import { availableYears } from '../core/reports/metrics.js';
import { config } from '../core/config.js';
import { NAV_ITEMS, pageAllowed } from './nav.js';
import { MONTHS_AR, MONTHS_EN3 } from '../core/i18n/time.js';

const GROUPS = { company: 'قيادة الشركة', work: 'العمل اليومي', manage: 'الإدارة', admin: 'النظام' };

// الإظهار في القائمة = نفس دالة السماح بفتح الصفحة (nav.js) — لا انفصال ممكن بينهما.
export function navFor(user) { return NAV_ITEMS.filter((n) => n.live !== false && pageAllowed(user, n.key)); }

const STYLE = `
/* هوية EVC الرسمية (من ملف الأصول): أزرق ملكي #244A99 + بنفسجي #834798، التدرج أزرق→بنفسجي.
   الأزرق = لون التفاعل الأساسي؛ البنفسجي = لمسة هوية مقتصدة؛ الأخضر/الكهرماني/الأحمر = حالة فقط. */
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Light.woff2') format('woff2');font-weight:300;font-display:swap}
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Medium.woff2') format('woff2');font-weight:500 700;font-display:swap}
@font-face{font-family:'IBM Plex Sans Arabic';src:url('/static/fonts/IBMPlexSansArabic-Bold.woff2') format('woff2');font-weight:800 900;font-display:swap}
:root{
  --brand:#244A99; --brand2:#834798; --brand-grad:linear-gradient(120deg,#244A99,#834798);
  --side:linear-gradient(170deg,#182c56 0%,#1f3a75 45%,#56316b 100%);
  --ink:#0f172a; --ink2:#1e293b; --muted:#5b6472; --faint:#79828f;
  --line:#e6e9f0; --bg:#f6f7fb; --surface:#fff;
  --green:#047857; --amber:#a16207; --red:#dc2626; --blue:#244A99; --gold:#C9A227;
  --r:14px; --r-sm:10px; --sh-sm:0 1px 2px rgba(15,23,42,.05),0 1px 3px rgba(15,23,42,.05);
  --sh:0 2px 8px rgba(15,23,42,.06),0 12px 28px rgba(36,74,153,.08);
  /* مقياس الخط الموحد (v2.1): نصوص 6 + أرقام 3 — أي font-size جديد يستخدم هذه حصراً */
  --fs-micro:10.5px; --fs-meta:11.5px; --fs-body:12.5px; --fs-ui:13px; --fs-title:14px; --fs-page:16px;
  --fs-num-sm:15px; --fs-num-md:1.35rem; --fs-num-lg:1.9rem;
  --pad-card-h:.85rem 1rem; --pad-card-b:.7rem 1rem; --pad-cell:.45rem .7rem; --gap:.9rem;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,system-ui,-apple-system,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0;color:var(--ink2);font-weight:700}
a{text-decoration:none;color:inherit}
.tnum{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;unicode-bidi:isolate}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-sm);transition:box-shadow .18s,transform .18s,border-color .18s}
.card-h:hover{box-shadow:var(--sh);transform:translateY(-1px);border-color:#d6def0}
.pill{display:inline-flex;align-items:center;gap:.3rem;padding:.2rem .55rem;border-radius:999px;font-size:.7rem;font-weight:700;line-height:1;white-space:nowrap}
.nav-a{display:flex;align-items:center;gap:.6rem;padding:.55rem .9rem;font-size:var(--fs-ui);color:rgba(255,255,255,.72);border-radius:10px;margin:1px .5rem;transition:background .15s,color .15s}
.nav-a:hover{background:rgba(255,255,255,.08);color:#fff}
.nav-a.on{background:rgba(255,255,255,.14);color:#fff;font-weight:700}
.nav-a svg{opacity:.85;flex:0 0 auto}
.grp{padding:.9rem .9rem .25rem;font-size:10px;font-weight:800;letter-spacing:.08em;color:rgba(255,255,255,.38)}
::selection{background:rgba(36,74,153,.18)}
::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:99px;border:2px solid var(--bg)}
.metric{font-size:1.9rem;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.bar{height:6px;background:#eef1f7;border-radius:999px;overflow:hidden}
.bar>span{display:block;height:100%;border-radius:999px}
select.yr{background:#fff;border:1px solid var(--line);border-radius:8px;padding:.3rem .6rem;font-size:12px;font-weight:700;color:var(--ink2)}

/* ── component layer (v2 redesign) ── */
.btn{display:inline-flex;align-items:center;gap:.4rem;border:1px solid var(--line);background:#fff;color:var(--ink2);
  font-size:var(--fs-body);font-weight:700;padding:.48rem .85rem;border-radius:10px;cursor:pointer;transition:all .15s;white-space:nowrap}
.btn:hover{border-color:#c9d3e8;background:#fbfcfe}
.btn svg{width:15px;height:15px}
.btn-primary{background:var(--brand);color:#fff;border:none;box-shadow:0 6px 16px -6px rgba(36,74,153,.55)}
.btn-primary:hover{background:#1d3d80}
.btn-ghost{border:none;background:transparent;color:var(--muted)}
.btn-ghost:hover{background:#eef1f7;color:var(--ink2)}
.btn-sm{padding:.32rem .6rem;font-size:var(--fs-meta);border-radius:8px}
.toolbar{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:1.1rem}
.toolbar .spacer{margin-inline-start:auto}
.input{border:1px solid var(--line);border-radius:10px;padding:.5rem .7rem;font-size:var(--fs-ui);color:var(--ink2);background:#fff;font-family:inherit}
.input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.14)}
.search{position:relative;display:flex;align-items:center}
.search svg{position:absolute;inset-inline-start:.6rem;width:15px;height:15px;color:var(--faint);pointer-events:none}
.search input{padding-inline-start:2rem;min-width:230px}
.seg{display:inline-flex;background:#eef1f7;border-radius:10px;padding:3px;gap:2px}
.seg button{border:none;background:none;cursor:pointer;font-size:12px;font-weight:700;color:var(--muted);padding:.35rem .7rem;border-radius:8px;display:flex;align-items:center;gap:.35rem}
.seg button.on{background:#fff;color:var(--ink2);box-shadow:var(--sh-sm)}

/* Kanban */
/* الزر العائم شبه شفاف كي لا يحجب أرقام الجداول؛ يكتمل عند المرور أو التركيز */
.ai-fab:hover,.ai-fab:focus-visible{opacity:1!important}
.kanban{display:flex;gap:.9rem;overflow-x:auto;padding-bottom:.75rem;align-items:flex-start;scroll-snap-type:x proximity}
.kcol{flex:0 0 300px;width:300px;background:#eef1f7;border-radius:14px;padding:.55rem;scroll-snap-align:start;max-height:calc(100vh - 240px);display:flex;flex-direction:column}
.kcol-head{display:flex;align-items:center;gap:.5rem;padding:.35rem .5rem .55rem}
.kcol-dot{width:9px;height:9px;border-radius:50%;flex:none}
.kcol-head .t{font-weight:800;font-size:var(--fs-ui)}
.kcol-head .n{font-size:11px;color:var(--muted);font-weight:700}
.kcol-head .v{margin-inline-start:auto;font-size:11px;font-weight:800;color:var(--ink2)}
.kcol-body{display:flex;flex-direction:column;gap:.55rem;overflow-y:auto;padding:.15rem;min-height:60px}
.kcol.drop{outline:2px dashed var(--brand);outline-offset:-3px;background:#e4ebfa}
.kcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:.7rem .75rem;cursor:grab;box-shadow:var(--sh-sm);transition:box-shadow .15s,transform .1s;border-inline-start:3px solid var(--_c,#cbd5e1)}
.kcard:hover{box-shadow:var(--sh);transform:translateY(-1px)}
.kcard:active{cursor:grabbing}
.kcard.drag{opacity:.5}
.kcard .kt{font-weight:700;font-size:var(--fs-ui);color:var(--ink2);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
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
.kv-row{display:flex;justify-content:space-between;gap:1rem;padding:.55rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-ui)}
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
.field>label{font-size:var(--fs-meta);font-weight:700;color:var(--muted)}
.field .input,.field select,.field textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:.55rem .7rem;font-size:var(--fs-ui);font-family:inherit;background:#fff}
.field .input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.14)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:.85rem}
@media(max-width:520px){.grid2{grid-template-columns:1fr}}
@media prefers-reduced-motion{.drawer,.scrim,.modal-card{transition:none;animation:none}}

/* ── Sector filter chips + clickable KPIs + drill-down rows ── */
.chips{display:flex;gap:.45rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem}
.chips .lbl{font-size:11px;font-weight:800;color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:.45rem;padding:.4rem .8rem;border-radius:999px;font-size:var(--fs-body);font-weight:700;
  background:#fff;border:1px solid var(--line);color:var(--ink2);transition:all .15s;cursor:pointer}
.chip:hover{border-color:#c9d3e8;box-shadow:var(--sh-sm);transform:translateY(-1px)}
.chip.on{background:var(--brand);border-color:transparent;color:#fff;box-shadow:0 6px 14px -6px rgba(36,74,153,.5)}
.chip .dot{width:8px;height:8px;border-radius:50%;flex:none}
.chip.on .dot{outline:2px solid rgba(255,255,255,.5)}
.hclick{cursor:pointer;border-radius:12px;transition:background .15s,box-shadow .15s}
.hclick:hover{background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
.hclick:focus-visible{outline:2px solid #fff;outline-offset:3px}
.dd-hint{font-size:10px;font-weight:700;color:rgba(255,255,255,.5);display:inline-flex;align-items:center;gap:.25rem}
.dd-row{display:flex;justify-content:space-between;gap:.8rem;padding:.5rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body);align-items:center}
.dd-row:last-child{border-bottom:none}
/* Long label shrinks (ellipsis); the money value never shrinks/wraps and is bidi-isolated so its
   leading digit is never clipped by the RTL flex + Intl RLM marks. */
.dd-row>span:first-child{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dd-row>b{flex:0 0 auto;white-space:nowrap;direction:ltr;unicode-bidi:isolate}
.modal-card{overflow-x:hidden}
.dd-kpi{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap}
.dd-kpi .v{font-size:1.6rem;font-weight:800;letter-spacing:-.02em}
.dd-sec{font-weight:800;font-size:var(--fs-body);margin-top:.35rem;color:var(--ink2)}
.cardclick{cursor:pointer}
.cardclick:hover{box-shadow:var(--sh),0 0 0 2px rgba(36,74,153,.16);transform:translateY(-1px)}
.cardclick:focus-visible{outline:2px solid var(--brand);outline-offset:2px}

/* ── حالات التصميم (فارغ/تحميل/تنبيه) ── */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;padding:2.2rem 1rem;text-align:center;color:var(--muted)}
.empty-state svg{width:34px;height:34px;color:var(--faint)}
.empty-state .t{font-weight:700;font-size:13.5px;color:var(--ink2)}
.empty-state .s{font-size:12px;max-width:340px;line-height:1.8}
.skeleton{position:relative;overflow:hidden;background:#eef1f7;border-radius:8px;min-height:14px}
.skeleton::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent);animation:shimmer 1.4s infinite}
@keyframes shimmer{from{transform:translateX(100%)}to{transform:translateX(-100%)}}
.alert{display:flex;gap:.6rem;align-items:flex-start;padding:.7rem .9rem;border-radius:12px;font-size:var(--fs-body);border:1px solid}
.alert.ok{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
.alert.warn{background:#fffbeb;border-color:#fde68a;color:#92400e}
.alert.err{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.alert.info{background:#eff6ff;border-color:#bfdbfe;color:#1e40af}
.tblwrap{overflow-x:auto;-webkit-overflow-scrolling:touch}

/* ── النموذج الزمني الموحد (v2.1) ──────────────────────────────────────────
   .mtrack: مسار 12 شهراً يُقرأ كما يُقرأ النص — يناير في أقصى اليمين، ديسمبر في أقصى اليسار.
   العناوين المزدوجة: .m-full عربية كاملة على الواسع، .m-tight إنجليزية Jan على الضيق
   (قاعدة المالك: لا اختصارات عربية أبداً). مؤشر «نحن هنا» الوحيد = .now-dot الذهبية. */
.mtrack{display:grid;grid-template-columns:repeat(12,1fr);direction:rtl;gap:3px;align-items:end}
.m-tight{display:none;direction:ltr;unicode-bidi:isolate}
@media (max-width:640px){.m-full{display:none}.m-tight{display:inline}}
/* تجاوب الجوال (v2.2): الشبكات الداخلية ثابتة الأعمدة كانت تفيض أفقياً على الشاشات الضيقة.
   الأقسام الرئيسية+الجانبية (Nfr 1fr) تتراص لعمود واحد؛ شرائط البطاقات المتساوية repeat(N,1fr)
   تتحوّل إلى auto-fit فتصبح عمودين حيث تتّسع؛ والأرقام الكبيرة تصغُر قليلاً. تُستثنى الرسوم
   البيانية (var(--bcols)) وشرائط الأشهر (.mtrack، صنفية) والشبكات المرنة (minmax) — بلا مساس. */
@media (max-width:640px){
  [style*="fr 1fr"]{grid-template-columns:1fr!important}
  [style*="grid-template-columns:repeat"]:not([style*="minmax"]){grid-template-columns:repeat(auto-fit,minmax(150px,1fr))!important}
  :root{--fs-num-lg:1.45rem;--fs-num-md:1.2rem}
}
.now-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 2px #fff,0 0 0 3.5px var(--gold);flex:none}

/* شريط «الإيقاع مقابل الخطة»: مقياسه المستهدف فقط (100% = الهدف السنوي)؛ التعبئة = المحقق؛
   النقطة الذهبية = أين يجب أن نكون اليوم (انقضى N% من السنة). المتوقع سطر نصي، لا شريط. */
.pace-bar{position:relative;height:14px;background:#eef1f7;border-radius:7px}
.pace-bar .fill{position:absolute;inset-block:2.5px;inset-inline-start:0;border-radius:5px;max-width:100%;background:var(--brand)}
.pace-bar .now{position:absolute;top:50%;transform:translate(50%,-50%);z-index:1}
.pace-chip{display:inline-flex;align-items:center;gap:.3rem;padding:.14rem .5rem;border-radius:999px;font-size:var(--fs-micro);font-weight:800;line-height:1.5}
.pace-chip.up{background:#ecfdf5;color:var(--green)}
.pace-chip.down{background:#fef2f2;color:var(--red)}
.pace-chip.flat{background:#f1f5f9;color:var(--muted)}

/* بند "يحتاج انتباهك" — جملة + إجراء واحد */
.attn{display:flex;align-items:center;gap:.7rem;padding:.65rem .8rem;border-radius:12px;border:1px solid var(--line);background:#fff;font-size:var(--fs-ui)}
.attn:hover{border-color:#d6def0;box-shadow:var(--sh-sm)}
.attn .ic{flex:0 0 auto;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center}
.attn .tx{flex:1;min-width:0}
.attn .tx .h{font-weight:700;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.attn .tx .s{font-size:var(--fs-meta);color:var(--muted)}
.attn .go{flex:0 0 auto}

/* تلميح معنى (شرح مصطلح/مرحلة) — CSS فقط */
[data-tip]{position:relative;cursor:help}
[data-tip]:hover::after,[data-tip]:focus-visible::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);inset-inline-start:50%;transform:translateX(50%);
  background:var(--ink);color:#fff;font-size:var(--fs-meta);font-weight:600;line-height:1.7;padding:.5rem .7rem;border-radius:9px;width:max-content;max-width:260px;white-space:normal;z-index:70;box-shadow:var(--sh);pointer-events:none;text-align:right}
[data-tip]:hover::before,[data-tip]:focus-visible::before{content:'';position:absolute;bottom:calc(100% + 2px);inset-inline-start:50%;transform:translateX(50%);border:6px solid transparent;border-top-color:var(--ink);z-index:70;pointer-events:none}

/* الموبايل: القائمة الجانبية تنزلق كطبقة */
.side-toggle{display:none}
@media(max-width:920px){
  .side-toggle{display:inline-flex;background:none;border:none;color:var(--ink2);cursor:pointer;padding:.3rem}
  aside.side{position:fixed;inset-block:0;inset-inline-start:0;z-index:65;transform:translateX(105%);transition:transform .25s}
  body.side-open aside.side{transform:none;box-shadow:0 0 60px rgba(15,23,42,.4)}
  .kcol{flex-basis:260px;width:260px}
}
`;

export async function layout({ user, active, title, subtitle, body, year, extraHead = '', scripts }) {
  const items = navFor(user);
  const byGroup = {};
  for (const n of items) (byGroup[n.group] ||= []).push(n);
  const roleLabel = ROLE_LABELS[user.role_id]?.ar || user.role_id;
  const initial = (user.name_ar || user.username || '?').trim().charAt(0);
  const nav = Object.entries(byGroup).map(([g, ns]) => `
    <div class="grp">${GROUPS[g] || ''}</div>
    ${ns.map((n) => `<a href="/app/${n.key}${year ? '?year=' + year : ''}" class="nav-a ${active === n.key ? 'on' : ''}">${icon(n.ic)}<span>${n.ar}</span></a>`).join('')}`).join('');

  const years = await availableYears();
  const showYear = ['ceo', 'portfolio', 'sector'].includes(active);
  // Preserve other query params (e.g. the owner's ?sector= filter) when switching year.
  const yearSel = showYear ? `<select class="yr" aria-label="السنة المالية" onchange="const p=new URLSearchParams(location.search);p.set('year',this.value);location.search=p.toString()">
    ${years.map((y) => `<option value="${y}" ${String(y) === String(year || config.fiscalYear) ? 'selected' : ''}>سنة ${y}</option>`).join('')}
  </select>` : '';

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title || 'سند'} · منصة سند EVC</title>
<link rel="icon" type="image/svg+xml" href="/static/brand/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/static/brand/favicon-32.png">
<link rel="apple-touch-icon" href="/static/brand/favicon-180.png">
<script src="/static/tailwind.js"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:'#244A99',brand2:'#834798',ink:'#0f172a',ink2:'#1e293b',muted:'#64748b',faint:'#94a3b8',line:'#e6e9f0'}}}}
window.__SANAD_MONTHS=${JSON.stringify(MONTHS_AR)};window.__SANAD_MONTHS_EN=${JSON.stringify(MONTHS_EN3)};</script>
<style>${STYLE}</style>
<link rel="stylesheet" href="/static/styles.css">${extraHead}</head>
<body>
<div style="display:flex;min-height:100vh">
  <aside class="side" style="width:250px;flex:0 0 250px;background:var(--side);display:flex;flex-direction:column;color:#fff">
    <div style="padding:1.15rem 1.1rem 1rem;border-bottom:1px solid rgba(255,255,255,.08)">
      <img src="/static/brand/logo-white.svg" alt="رؤية الخبراء الاستشارية EVC" style="width:170px;max-width:100%;display:block"/>
      <div style="margin-top:.65rem;font-size:var(--fs-micro);color:rgba(255,255,255,.55);letter-spacing:.02em">سند · نظام تشغيل الأعمال</div>
    </div>
    <nav style="flex:1;overflow-y:auto;padding:.4rem 0">${nav}</nav>
    <div style="padding:.8rem 1.1rem;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:rgba(255,255,255,.55)">السنة المالية ${config.fiscalYear} · SAR</div>
  </aside>
  <div style="flex:1;display:flex;flex-direction:column;min-width:0">
    <header style="height:60px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 1.5rem;flex:0 0 auto">
      <div style="display:flex;align-items:center;gap:.6rem">
        <button class="side-toggle" aria-label="القائمة" onclick="document.body.classList.toggle('side-open')">${icon('menu') || '☰'}</button>
        <div><div style="font-weight:800;font-size:var(--fs-page)">${title || ''}</div>${subtitle ? `<div style="font-size:12px;color:var(--muted)">${subtitle}</div>` : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:1rem">
        ${yearSel}
        <a href="/app/tasks" title="الإشعارات" style="position:relative;color:var(--muted)">${icon('bell')}<span id="notif-badge" style="display:none;position:absolute;top:-4px;left:-4px;background:var(--red);color:#fff;font-size:9px;border-radius:99px;padding:1px 4px;font-weight:700"></span></a>
        <div style="display:flex;align-items:center;gap:.55rem">
          <div style="width:34px;height:34px;border-radius:50%;background:var(--brand-grad);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">${initial}</div>
          <div style="text-align:right"><div style="font-size:var(--fs-ui);font-weight:700">${user.name_ar || user.username}</div><div style="font-size:11px;color:var(--muted)">${roleLabel}</div></div>
        </div>
        <form method="post" action="/auth/logout-web"><button title="خروج" style="color:var(--muted);background:none;border:none;cursor:pointer">${icon('logout')}</button></form>
      </div>
    </header>
    <main style="flex:1;overflow-y:auto;padding:1.15rem 1.35rem 5.5rem">${body}</main>
  </div>
</div>
<button onclick="Sanad.aiToggle()" title="مساعد سند الذكي" class="ai-fab" style="position:fixed;bottom:18px;left:18px;z-index:40;width:44px;height:44px;border:none;cursor:pointer;border-radius:50%;color:#fff;box-shadow:0 8px 22px -6px rgba(124,58,237,.5);background:var(--brand-grad);display:flex;align-items:center;justify-content:center;opacity:.55;transition:opacity .15s">${icon('ai')}</button>
<div id="ai-panel" class="card" style="display:none;position:fixed;bottom:88px;left:22px;z-index:40;width:390px;max-width:calc(100vw - 2rem);height:min(580px,calc(100vh - 130px));flex-direction:column;overflow:hidden;box-shadow:var(--sh)">
  <div style="padding:.8rem 1rem;color:#fff;display:flex;align-items:center;justify-content:space-between;background:var(--brand-grad)">
    <div style="display:flex;align-items:center;gap:.5rem">${icon('ai')}<div><div style="font-weight:800;font-size:var(--fs-ui)">مساعد سند الذكي</div><div id="ai-mode" style="font-size:10px;color:rgba(255,255,255,.6)">…</div></div></div>
    <button onclick="Sanad.aiToggle()" style="color:rgba(255,255,255,.7);background:none;border:none;cursor:pointer;font-size:var(--fs-page)">✕</button>
  </div>
  <div id="ai-box" style="flex:1;overflow-y:auto;padding:.75rem;display:flex;flex-direction:column;gap:.5rem;background:var(--bg);font-size:var(--fs-ui)">
    <div style="text-align:center;color:var(--muted);font-size:12px;line-height:1.9;padding:1rem">جرّب: «لخّص مشروع…» · «تقرير أسبوعي» · «المخاطر» · «جودة البيانات» · «أولوياتي» · «انقل الفرصة X إلى فائزة»</div>
  </div>
  <div style="padding:.5rem;border-top:1px solid var(--line);display:flex;gap:.5rem">
    <input id="ai-input" onkeydown="if(event.key==='Enter')Sanad.aiSend()" placeholder="اكتب…" style="flex:1;border:1px solid var(--line);border-radius:10px;padding:.5rem .75rem;font-size:var(--fs-ui)">
    <button onclick="Sanad.aiSend()" style="color:#fff;border:none;cursor:pointer;padding:0 .9rem;border-radius:10px;background:var(--brand-grad)">↑</button>
  </div>
</div>
<div id="scrim" class="scrim" onclick="Sanad.closeDrawer()"></div>
<aside id="drawer" class="drawer" aria-hidden="true"></aside>
<div id="modal" class="modal" onclick="if(event.target===this)Sanad.closeModal()"></div>
<script src="/static/app.js"></script>${(scripts || []).map((s) => `<script src="${s}" defer></script>`).join('')}
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
  const c = { green: '#dcfce7|#059669', red: '#fee2e2|#b91c1c', amber: '#fef3c7|#92400e', blue: '#dbeafe|#2563eb', violet: '#ede9fe|#7c3aed', slate: '#f1f5f9|#475569' }[color] || '#f1f5f9|#475569';
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
  // rtl: الزمن يُقرأ كما يُقرأ النص — أول الفترة في أقصى اليمين (النموذج الزمني الموحد).
  // التمييز يبقى على آخر فترة زمنياً، وopts.now (فهرس بالسلسلة الأصلية) يرسم نقطة «نحن هنا» الذهبية.
  const view = opts.rtl ? [...series].reverse() : series;
  const bars = view.map((s, i) => {
    const orig = opts.rtl ? n - 1 - i : i;
    const val = s[valueKey] || 0;
    const bh = Math.max(2, Math.round((val / max) * plotH));
    const x = padX + i * gap + (gap - bw) / 2;
    const y = padT + plotH - bh;
    const last = orig === n - 1;
    const isNow = opts.now != null && orig === opts.now;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="4" fill="url(#${gid})" opacity="${last ? 1 : 0.8}"/>
      ${isNow ? `<circle cx="${(x + bw / 2).toFixed(1)}" cy="${H - 20.5}" r="3" fill="#C9A227" stroke="#fff" stroke-width="1.2"><title>الفترة الحالية</title></circle>` : ''}
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 7}" font-size="11" fill="${isNow ? '#a3821c' : '#94a3b8'}" font-weight="${isNow ? '800' : '400'}" text-anchor="middle">${s.year}</text>
      <text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" font-size="11" fill="${last ? '#834798' : '#475569'}" text-anchor="middle" font-weight="800">${opts.fmt ? opts.fmt(val) : Math.round(val)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#244A99"/><stop offset="1" stop-color="#834798"/></linearGradient></defs>${grid}${bars}</svg>`;
}

// Horizontal comparison bars (e.g. revenue achieved per sector). items: [{label,value,color,sub}].
export function hbars(items, opts = {}) {
  const max = Math.max(1, ...items.map((i) => i.value || 0));
  return `<div style="display:flex;flex-direction:column;gap:.7rem">${items.map((i) => {
    const w = Math.round(((i.value || 0) / max) * 100);
    return `<div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:var(--fs-body);margin-bottom:.28rem">
        <span style="display:flex;align-items:center;gap:.45rem;min-width:0"><span style="width:9px;height:9px;border-radius:2px;background:${i.color || '#2563eb'};flex:none"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.label}</span></span>
        <span class="tnum" style="font-weight:800;color:var(--ink2);flex:none;margin-inline-start:.6rem">${opts.fmt ? opts.fmt(i.value) : i.value}${i.sub ? `<span style="font-weight:600;color:var(--muted);font-size:11px"> · ${i.sub}</span>` : ''}</span>
      </div>
      <div style="height:10px;background:#eef1f7;border-radius:999px;overflow:hidden"><div style="width:${w}%;height:100%;background:${i.color || '#2563eb'};border-radius:999px;transition:width .5s"></div></div>
    </div>`;
  }).join('')}</div>`;
}

// 12-month utilization heat strip (allocation % per month). Over-allocation shows red; the current
// month (1-based `now`) carries the unified gold "we are here" ring. RTL like all time tracks:
// January at the far right, December at the far left (the platform's single time model).
export function utilStrip(months, now = 0) {
  return `<div class="mtrack" style="gap:2px">${months.map((v, i) => {
    const c = v === 0 ? '#eef1f7' : v > 105 ? '#dc2626' : v >= 80 ? '#059669' : v >= 40 ? '#f59e0b' : '#93c5fd';
    const cur = (i + 1) === now;
    return `<span title="${MONTHS_AR[i]}: ${v}%" style="height:15px;border-radius:3px;background:${c}${cur ? ';box-shadow:0 0 0 2px var(--gold);position:relative;z-index:1' : ''}"></span>`;
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
    <text x="${cx}" y="${cx - 4}" text-anchor="middle" dominant-baseline="central" fill="${opts.centerColor || '#fff'}" font-size="${opts.centerSize || 26}" font-weight="800" font-family="'IBM Plex Sans Arabic','Segoe UI',sans-serif">${opts.center || (Math.round(pct || 0) + '%')}</text>
    ${opts.sub ? `<text x="${cx}" y="${cx + 18}" text-anchor="middle" fill="${opts.subColor || 'rgba(255,255,255,.6)'}" font-size="10.5" font-weight="600">${opts.sub}</text>` : ''}
  </svg>`;
}
