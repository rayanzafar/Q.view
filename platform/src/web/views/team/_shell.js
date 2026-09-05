// ── الهيكل المشترك لشاشات «الفريق والموارد» (ADR-0016) ────────────────────────────────
//
// «حافظ على الشريط الجانبي الأيمن وهوية EVC وسند… عنوانٌ رئيسي واحد داخل منطقة المحتوى،
//  ومسار تنقل متسق، وأسلوب ثابت لأزرار الحفظ والإلغاء» — الموجّه §4.2. فكل شاشةٍ في الوحدة
// تمرّ بـ`teamLayout` — نفس `layout()` المنصة (القائمة، الرأس، البحث) — ويُضاف تحت الرأس
// مسارُ تنقّل (الفريق › المسار › الصفحة) وتبويباتُ المسار، وورقةُ أنماطٍ واحدة بادئتها `tm-`
// كي لا تتصادم مع أنماط الصفحات الأخرى. لا مكوّن هنا يقرأ قاعدةً ولا يقرّر صلاحية: عرضٌ صرف.
import { layout, pill } from '../../layout.js';
import { icon } from '../../icons.js';
import { esc } from '../_shared.js';
import { G } from '../../i18n/glossary.js';
import { MONTHS_AR } from '../../../core/i18n/time.js';

// المسارات الأربعة (S01) بمفاتيح ثابتة تُستعمل في الروابط والتبويبات.
export const PATHS = Object.freeze({
  people: { key: 'people', label: G.pathPeople, href: '/app/team/resources', icon: 'team',
    blurb: 'استعرض موارد فريقك ومهاراتهم وقدراتهم: الداخليين والخارجيين والشركاء.' },
  planning: { key: 'planning', label: G.pathPlanning, href: '/app/team/planning', icon: 'clock',
    blurb: 'خطّط تسكين الموارد على المشاريع والمنتجات والأعمال الداخلية شهراً بشهر، وراجع المتاح والتجاوزات.' },
  work: { key: 'work', label: G.pathWork, href: '/app/team/work', icon: 'tasks',
    blurb: 'نظرة الفريق عبر المهام والمشاريع والمنتجات والفرص — وكل مهمة تُعدّ مرة واحدة.' },
  analysis: { key: 'analysis', label: G.pathAnalysis, href: '/app/team/analysis', icon: 'trend',
    blurb: 'حلّل الاستخدام وحِمل المهام والتغطية، وخطّط الاحتياجات القادمة.' },
});

// تبويبات كل مسار — الترتيب كما في الصور (من اليمين).
export const SECTION_TABS = Object.freeze({
  // «حسابات الدخول» هي شاشة الموظفين القائمة (ربط الحساب بالموظف، الإضافة/الحذف الإداري) —
  // تبقى بابها الوحيد لهذه المهمة، بجانب «سجل الموارد» الجديد الذي يقرأ الطاقة والتسكين.
  people: [{ key: 'resources', label: G.resourcesRegistry, href: '/app/team/resources' }, { key: 'org', label: G.orgStructure, href: '/app/team/org' }, { key: 'accounts', label: G.accountsTab, href: '/app/team/people' }],
  planning: [{ key: 'planning', label: G.planningTab, href: '/app/team/planning' }, { key: 'requests', label: G.requestsTab, href: '/app/team/requests' }, { key: 'close', label: G.closeTab, href: '/app/team/close' }],
  work: [],
  analysis: [{ key: 'utilization', label: G.utilizationTab, href: '/app/team/analysis' }, { key: 'needs', label: G.needsTab, href: '/app/team/needs' }],
});

export const TEAM_CSS = `
  .tm-wrap{max-width:1180px;margin-inline:auto}
  .tm-crumbs{display:flex;gap:.45rem;align-items:center;font-size:var(--fs-meta);color:var(--muted);margin-bottom:.35rem;flex-wrap:wrap}
  .tm-crumbs a{color:var(--muted);text-decoration:none}.tm-crumbs a:hover{color:var(--brand)}
  .tm-crumbs .sep{color:var(--faint)}.tm-crumbs b{color:var(--ink2);font-weight:700}
  .tm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:.9rem}
  .tm-title{font-size:var(--fs-page);font-weight:800;color:var(--ink2);margin:0}
  .tm-sub{font-size:var(--fs-body);color:var(--muted);margin-top:.2rem}
  .tm-actions{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
  .tm-tabs{display:flex;gap:.1rem;border-bottom:1px solid var(--line);margin-bottom:1rem}
  .tm-tabs a{padding:.55rem .9rem;font-size:var(--fs-body);color:var(--muted);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}
  .tm-tabs a.on{color:var(--brand);border-color:var(--brand);font-weight:700}
  .tm-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-sm)}
  .tm-card .tm-card-h{display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.9rem 1.1rem;border-bottom:1px solid var(--line)}
  .tm-card .tm-card-t{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
  .tm-card .tm-card-s{font-size:var(--fs-meta);color:var(--muted)}
  .tm-card .tm-card-b{padding:.9rem 1.1rem}
  .tm-grid2{display:grid;grid-template-columns:2fr 1fr;gap:1rem}
  @media (max-width:900px){.tm-grid2{grid-template-columns:1fr}}
  .tm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.6rem;margin-bottom:1rem}
  .tm-kpi{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:.8rem 1rem}
  .tm-kpi .l{font-size:var(--fs-meta);color:var(--muted)}.tm-kpi .v{font-size:var(--fs-val-md);font-weight:800;color:var(--ink2);margin-top:.15rem}
  .tm-kpi .s{font-size:var(--fs-micro);color:var(--faint);margin-top:.15rem}
  .tm-av{width:38px;height:38px;border-radius:50%;display:inline-grid;place-items:center;font-weight:800;color:#fff;font-size:15px;flex:none;background:var(--brand-grad)}
  .tm-av.sm{width:30px;height:30px;font-size:13px}
  .tm-person{display:flex;align-items:center;gap:.6rem;min-width:0}
  .tm-person .n{display:block;font-weight:700;color:var(--ink2);font-size:var(--fs-body);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tm-person .j{display:block;font-size:var(--fs-micro);color:var(--muted)}
  .tm-tbl{width:100%;border-collapse:collapse}
  .tm-tbl th{font-size:var(--fs-meta);font-weight:700;color:var(--muted);text-align:right;padding:.6rem .75rem;border-bottom:1px solid var(--line);background:var(--bg);white-space:nowrap}
  .tm-tbl td{padding:.65rem .75rem;border-bottom:1px solid var(--line);font-size:var(--fs-body);vertical-align:middle}
  .tm-tbl tr.tm-row-click{cursor:pointer}.tm-tbl tr.tm-row-click:hover td,.tm-tbl tr.is-sel td{background:#f2f5fc}
  .tm-pct{display:inline-block;min-width:52px;text-align:center;border-radius:8px;padding:.2rem .5rem;font-weight:800;font-size:var(--fs-body)}
  .tm-pct.b-free,.tm-pct.b-low{background:#e8f0fd;color:var(--brand)}.tm-pct.b-ok{background:#e6f7f1;color:var(--green)}
  .tm-pct.b-near{background:#fff4e0;color:var(--amber)}.tm-pct.b-over{background:#fdeaea;color:var(--red)}.tm-pct.b-out{background:var(--bg);color:var(--faint)}
  .tm-bar{height:9px;border-radius:999px;background:var(--track);overflow:hidden;display:flex}
  .tm-bar i{display:block;height:100%}
  .tm-bar .c-proj{background:var(--brand)}.tm-bar .c-int{background:#2aa89a}.tm-bar .c-tent{background:repeating-linear-gradient(45deg,#c7b6f5 0 4px,#efe9fb 4px 8px)}.tm-bar .c-over{background:var(--red)}
  .tm-legend{display:flex;gap:.9rem;flex-wrap:wrap;font-size:var(--fs-micro);color:var(--muted);align-items:center}
  .tm-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-inline-end:.3rem;vertical-align:middle}
  .tm-note{font-size:var(--fs-micro);color:var(--muted);display:flex;gap:.4rem;align-items:center}
  .tm-empty{padding:2rem 1rem;text-align:center;color:var(--muted);font-size:var(--fs-body)}
  .tm-empty .t{font-weight:800;color:var(--ink2);margin-bottom:.25rem}
  .tm-paths{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  @media (max-width:820px){.tm-paths{grid-template-columns:1fr}}
  .tm-path{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:1.1rem 1.2rem;display:flex;gap:1rem;cursor:pointer;position:relative;transition:box-shadow .15s,border-color .15s}
  .tm-path:hover,.tm-path.on{border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.12)}
  .tm-path .ttl{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
  .tm-path .blurb{font-size:var(--fs-body);color:var(--muted);margin:.3rem 0 .7rem;line-height:1.7}
  .tm-path .facts{display:flex;gap:.5rem;flex-wrap:wrap}
  .tm-path .fact{background:var(--bg);border-radius:12px;padding:.55rem .8rem;min-width:96px;text-align:center;text-decoration:none;color:inherit}
  .tm-path .fact b{display:block;font-size:var(--fs-val-sm);color:var(--brand)}.tm-path .fact span{font-size:var(--fs-micro);color:var(--muted)}
  .tm-path .art{width:150px;flex:none;border-radius:12px;background:linear-gradient(135deg,#eef2fb,#f6f2fc);display:grid;place-items:center;color:var(--brand2)}
  .tm-path .go{position:absolute;bottom:1rem;left:1rem;border:1px solid var(--line);border-radius:10px;width:36px;height:34px;display:grid;place-items:center;background:var(--surface);color:var(--ink2)}
  .tm-path .tag{position:absolute;top:.9rem;left:1rem;font-size:var(--fs-micro);background:#eef2fb;color:var(--brand);border-radius:999px;padding:.15rem .6rem}
  .tm-preview{margin-top:1rem;background:var(--surface);border:1px solid var(--brand);border-radius:16px;padding:1rem 1.2rem}
  .tm-preview .ph{display:flex;justify-content:space-between;align-items:center;gap:.6rem}
  .tm-preview .ph .t{font-weight:800;color:var(--ink2)}.tm-preview .ph .s{font-size:var(--fs-micro);color:var(--muted)}
  .tm-preview .facts{display:flex;gap:.6rem;flex-wrap:wrap;margin:.8rem 0}
  .tm-preview .fact{flex:1 1 200px;background:var(--bg);border-radius:12px;padding:.7rem .9rem;display:flex;gap:.6rem;align-items:center}
  .tm-preview .fact b{display:block;color:var(--ink2)}.tm-preview .fact span{font-size:var(--fs-micro);color:var(--muted)}
  .tm-preview .links{display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap}
  .tm-preview .links a.l{color:var(--brand);font-size:var(--fs-body);text-decoration:none;margin-inline-start:.6rem}
  .tm-drawer{position:fixed;top:0;bottom:0;left:0;width:min(480px,94vw);background:var(--surface);box-shadow:-12px 0 40px rgba(15,23,42,.18);z-index:120;display:flex;flex-direction:column;transform:translateX(-100%);transition:transform .18s}
  .tm-drawer.open{transform:none}
  .tm-drawer .dh{padding:1rem 1.2rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:.6rem;align-items:flex-start}
  .tm-drawer .db{padding:1rem 1.2rem;overflow:auto;flex:1}
  .tm-drawer .df{padding:.8rem 1.2rem;border-top:1px solid var(--line);display:flex;gap:.5rem;flex-direction:column}
  .tm-scrim{position:fixed;inset:0;background:rgba(15,23,42,.25);z-index:110;display:none}.tm-scrim.open{display:block}
  .tm-steps{display:flex;align-items:center;gap:0;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:.7rem 1rem}
  .tm-steps .st{flex:1;text-align:center;position:relative;font-size:var(--fs-micro);color:var(--muted)}
  .tm-steps .st i{display:block;width:14px;height:14px;border-radius:50%;border:2px solid var(--line);margin:0 auto .3rem;background:var(--surface)}
  .tm-steps .st.done i{background:var(--brand);border-color:var(--brand)}.tm-steps .st.on i{border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.15)}
  .tm-steps .st.on{color:var(--brand);font-weight:700}
  .tm-mx{overflow:auto;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}
  .tm-mx table{border-collapse:separate;border-spacing:0;min-width:760px;width:100%}
  .tm-mx th,.tm-mx td{border-bottom:1px solid var(--line);border-left:1px solid var(--line);padding:.55rem .6rem;vertical-align:top;background:var(--surface)}
  .tm-mx thead th{position:sticky;top:0;z-index:3;background:var(--bg);font-size:var(--fs-meta);font-weight:700;color:var(--ink2);text-align:center}
  .tm-mx th.tm-mx-emp{position:sticky;right:0;z-index:4;min-width:190px;text-align:right;background:var(--surface)}
  .tm-mx thead th.tm-mx-emp{z-index:5;background:var(--bg)}
  .tm-mx .cell{min-width:150px;font-size:var(--fs-micro);color:var(--muted);cursor:pointer;border-radius:8px;padding:.35rem;text-align:right}
  .tm-mx .cell:hover{background:#f6f8fd}.tm-mx .cell.over{outline:2px solid var(--red);outline-offset:-2px;background:#fff7f7}
  .tm-mx .cell.out{background:repeating-linear-gradient(45deg,#f6f7fb 0 6px,#fff 6px 12px);color:var(--faint);text-align:center;cursor:default}
  .tm-mx .cell .li{display:flex;justify-content:space-between;gap:.4rem;margin-top:.15rem}
  .tm-mx .cell .li i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-inline-start:.3rem}
  .tm-mx .cell .li.tent span{border:1px dashed #b39ddb;border-radius:999px;padding:0 .4rem;color:var(--brand2)}
  .tm-form .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.7rem}
  .tm-form .field label{display:block;font-size:var(--fs-meta);color:var(--muted);margin-bottom:.25rem}
  .tm-form .req::after{content:' *';color:var(--red)}
  .tm-radio{display:flex;gap:1rem;flex-wrap:wrap}.tm-radio label{display:flex;gap:.35rem;align-items:center;font-size:var(--fs-body);cursor:pointer}
  .tm-sec{background:var(--bg);border-radius:12px;padding:.8rem 1rem;margin-bottom:.8rem}
  .tm-sec .sh{font-weight:800;color:var(--ink2);margin-bottom:.6rem;font-size:var(--fs-body)}
  .tm-diff{color:var(--red)}.tm-diff.up{color:var(--green)}
  .tm-warn{background:#fff7e6;border:1px solid #f5d38a;border-radius:12px;padding:.7rem .9rem;font-size:var(--fs-body);color:#7a4b00}
  .tm-danger{background:#fdeaea;border:1px solid #f3b4b4;border-radius:12px;padding:.7rem .9rem;font-size:var(--fs-body);color:#8a1c1c}
  .tm-ok{background:#e9f8f1;border:1px solid #b7e4cc;border-radius:12px;padding:.7rem .9rem;font-size:var(--fs-body);color:#0f5132}
  .tm-info{background:#eef2fb;border:1px solid #cbd7f5;border-radius:12px;padding:.7rem .9rem;font-size:var(--fs-body);color:#1e3a8a}
  .tm-foot{font-size:var(--fs-micro);color:var(--muted);margin-top:1rem}
  .tm-list{display:flex;flex-direction:column;gap:.45rem}
  .tm-li{display:flex;justify-content:space-between;align-items:center;gap:.6rem;background:var(--bg);border-radius:10px;padding:.55rem .75rem;font-size:var(--fs-body)}
  .tm-li .m{color:var(--muted);font-size:var(--fs-micro)}
  .tm-pager{display:flex;justify-content:space-between;align-items:center;padding:.6rem .75rem;font-size:var(--fs-meta);color:var(--muted)}
  .tm-pager .btn[disabled]{opacity:.4}
  @media (max-width:640px){.tm-head{flex-direction:column}.tm-tbl th:nth-child(n+4),.tm-tbl td:nth-child(n+4){display:none}.tm-tbl.keep-all th,.tm-tbl.keep-all td{display:table-cell}}
`;

const AV_COLORS = ['#4f6bd6', '#2aa89a', '#8b5cf6', '#e0679a', '#3b82f6', '#059669', '#d97706'];
export function avatar(name, { small = false } = {}) {
  const n = String(name || '').trim();
  const ch = n ? n[0] : '؟';
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="tm-av${small ? ' sm' : ''}" style="background:${AV_COLORS[h % AV_COLORS.length]}" aria-hidden="true">${esc(ch)}</span>`;
}
export function person(name, job, { href = null, small = false } = {}) {
  const inner = `${avatar(name, { small })}<span style="min-width:0"><span class="n">${esc(name)}</span>${job ? `<span class="j">${esc(job)}</span>` : ''}</span>`;
  return href ? `<a class="tm-person" href="${esc(href)}" style="text-decoration:none">${inner}</a>` : `<span class="tm-person">${inner}</span>`;
}
export const pctChip = (pct, band) => (pct == null
  ? `<span class="tm-pct b-out" title="${esc(G.outOfEngagement)}">—</span>`
  : `<span class="tm-pct b-${esc(band || 'ok')} tnum">${Math.round(pct)}%</span>`);
export const TYPE_TONE = { internal: 'blue', external: 'violet', partner: 'green' };
export const typePill = (type, label) => pill(label || ({ internal: 'داخلي', external: 'خارجي', partner: 'شريك' })[type] || 'داخلي', TYPE_TONE[type] || 'blue');
export const ENGAGE_TONE = { active: 'green', ending: 'amber', ended: 'slate', upcoming: 'blue' };
export const engagementPill = (status, label) => pill(label || ({ active: 'نشط', ending: 'ينتهي قريباً', ended: 'منتهٍ', upcoming: 'لم يبدأ' })[status] || '—', ENGAGE_TONE[status] || 'slate');

/** شريط توزيع مكدَّس: [{ pct, tone: 'proj'|'int'|'tent'|'over', label }]. */
export function stackBar(segs, { max = 100 } = {}) {
  const inner = (segs || []).filter((s) => s.pct > 0).map((s) => `<i class="c-${esc(s.tone || 'proj')}" style="width:${Math.min(100, (s.pct / max) * 100)}%" title="${esc(s.label || '')}"></i>`).join('');
  return `<div class="tm-bar" aria-hidden="true">${inner}</div>`;
}
export const legend = (items) => `<div class="tm-legend">${items.map(([color, label]) => `<span><i style="background:${color}"></i>${esc(label)}</span>`).join('')}</div>`;
export const emptyState = (title, sub) => `<div class="tm-empty"><div class="t">${esc(title)}</div>${sub ? `<div>${esc(sub)}</div>` : ''}</div>`;
export const monthLabel = (key) => { const [y, m] = String(key).split('-'); return `${MONTHS_AR[Number(m) - 1] || ''} ${y}`; };
export const stepper = (steps, current) => `<div class="tm-steps" role="list">${steps.map((s, i) => `<div class="st${i < current ? ' done' : i === current ? ' on' : ''}" role="listitem"><i></i>${esc(s)}</div>`).join('')}</div>`;
export const kv = (rows) => `<table class="tm-tbl keep-all" style="font-size:var(--fs-body)"><tbody>${rows.map(([k, v]) => `<tr><td style="color:var(--muted);width:40%">${esc(k)}</td><td>${v == null || v === '' ? '<span style="color:var(--faint)">—</span>' : v}</td></tr>`).join('')}</tbody></table>`;

/** غلاف الوحدة: شريط التنقل وتبويبات المسار، ثم جسم الصفحة. */
export async function teamLayout({ user, path, section = null, title, subtitle = '', crumbs = [], actions = '', body, scripts = [], extraHead = '', year }) {
  const p = PATHS[path] || null;
  const crumbRow = [{ label: G.team, href: '/app/team' }, ...(p ? [{ label: p.label, href: p.href }] : []), ...crumbs];
  const crumbHtml = `<nav class="tm-crumbs" aria-label="مسار التنقل">${crumbRow.map((c, i) => (i === crumbRow.length - 1
    ? `<b>${esc(c.label)}</b>` : `<a href="${esc(c.href)}">${esc(c.label)}</a><span class="sep">‹</span>`)).join('')}</nav>`;
  const tabs = p && (SECTION_TABS[path] || []).length && section
    ? `<div class="tm-tabs" role="tablist">${SECTION_TABS[path].map((t) => `<a role="tab" href="${esc(t.href)}" class="${t.key === section ? 'on' : ''}"${t.key === section ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}</div>` : '';
  // العنوان الرئيسي واحد: يحمله رأس المنصة (`layout`) كما في كل الصفحات؛ وداخل المحتوى مسارُ
  // التنقّل (آخر عنصر فيه هو اسم الصفحة بخطٍّ عريض) وأزرار الإجراء — لا عنوانٌ ثانٍ مكرّر.
  const html = `<style>${TEAM_CSS}</style><div class="tm-wrap">
    <div class="tm-head"><div>${crumbHtml}${subtitle ? `<div class="tm-sub">${esc(subtitle)}</div>` : ''}</div><div class="tm-actions">${actions}</div></div>
    ${tabs}
    ${body}
  </div>`;
  // عنوان الرأس اسم الصفحة، وسطره الثاني اسم المسار — وإن تطابقا (صفحة المسار الرئيسة) فسطر البوابة.
  const headSub = p && p.label !== title ? p.label : G.teamGatewaySub;
  return layout({ user, active: 'team', title, subtitle: headSub, body: html, scripts, extraHead, year });
}
export { esc, pill, icon };
