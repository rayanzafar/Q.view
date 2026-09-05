// ── S11 — الهيكل الإداري: شجرة القطاعات والإدارات + موارد الإدارة المختارة + الارتباطات المشتركة ──
//
// «شجرة إدارات قابلة للفتح والبحث مع قائمة موارد الإدارة المختارة. استخدم الهيكل الفعلي للشركة،
//  والأعداد ضمن الصلاحية… مع تجنب تحميل شجرة ضخمة كاملة بلا حاجة» — الموجّه S11.
//
// الشجرة من `orgResources` (وهي `orgTree` القائم مقصوصاً إلى الهوية والعدّ)، أمّا الأعداد على العقد
// فتُحسب هنا **ضمن نطاق القارئ** بالشرط نفسه الذي يبني قائمة الإدارة (resourceScopeSql) — فرقم
// العقدة هو عدد الصفوف التي يراها حين يفتحها، لا عدد الشركة. لا يُحمَّل أهل كل إدارة مسبقاً:
// الإدارة المختارة وحدها (‎?department=‎ في الرابط فيبقى السياق مع زر الرجوع والروابط)، والبحث
// في الشجرة عميلٌ صرف، وفي القائمة خادمي (‎?q=‎) مع ترشيحٍ فوري فوقه. الطيّ بـ<details> الأصلية:
// يعمل بلا جافاسكربت ومتاح بلوحة المفاتيح (Enter/Space على العقدة). التبويب «سجل الموارد» لا
// «سجل إداري» (C3 في سجل التنفيذ).
import { all } from '../../../core/db/index.js';
import { orgResources } from '../../../modules/team/resources.js';
import { resourceScopeSql, canCreateResource } from '../../../modules/team/access.js';
import { countAr } from '../../../core/i18n/plural.js';
import { MONTHS_AR } from '../../../core/i18n/time.js';
import { G } from '../../i18n/glossary.js';
import { teamLayout, person, typePill, engagementPill, emptyState, monthLabel, esc, pill, icon } from './_shell.js';

const N = (v) => Number(v) || 0;
const RES = { one: 'مورد واحد', two: 'موردان', few: 'موارد', many: 'مورداً', zero: 'لا موارد' };
// العدد في خانة الأرقام الموحّدة والمعدود بجانبه — تمييز العدد العربي من `countAr` لا شرطٌ ثنائي.
const countTnum = (n, forms) => {
  const s = countAr(N(n), forms);
  const m = s.match(/^(\d+)\s+([\s\S]*)$/);
  return m ? `<span class="tnum">${m[1]}</span> ${esc(m[2])}` : esc(s);
};
const orgHref = (dep) => `/app/team/org?department=${encodeURIComponent(dep)}`;
const profileHref = (id) => `/app/team/resources/${encodeURIComponent(id)}`;

// ── الأعداد ضمن الصلاحية: استعلامٌ واحد مجمَّع بشرط النطاق نفسه الذي يبني قائمة الإدارة ─────────
async function scopedHeadcounts(user) {
  const sc = resourceScopeSql(user, 'e');
  const hc = { byDept: new Map(), noDept: new Map(), sector: sc.sector || null, departments: sc.departments || [], blind: sc.clause === '1=0' };
  if (hc.blind) return hc;
  const rows = await all(`SELECT e.sector_id, e.department_id, COUNT(*) n FROM employee e
      WHERE ${sc.clause} GROUP BY e.sector_id, e.department_id`, sc.params);
  for (const r of rows) {
    const n = N(r.n);
    if (r.department_id) hc.byDept.set(r.department_id, (hc.byDept.get(r.department_id) || 0) + n);
    else if (r.sector_id) hc.noDept.set(r.sector_id, (hc.noDept.get(r.sector_id) || 0) + n);
  }
  return hc;
}
const inScope = (hc, depId, sectorId) => !hc.blind
  && (hc.departments.length ? hc.departments.includes(depId) : (!hc.sector || hc.sector === sectorId));

// ── الشجرة ──────────────────────────────────────────────────────────────────────────────────────
// أهل الإدارة المختارة وحدهم يظهرون تحت عقدتها (أوائلهم — والقائمة الكاملة في اللوح المجاور).
function peopleUnder(resources) {
  if (!resources.length) return '';
  const shown = resources.slice(0, 4);
  const rest = resources.length - shown.length;
  return `<ul class="tm-org-people">${shown.map((r) => `<li>${person(r.name_ar, r.job_title || '', { href: profileHref(r.id), small: true })}</li>`).join('')}
    ${rest > 0 ? `<li class="tm-org-more">و<span class="tnum">${rest}</span> غيرهم في القائمة</li>` : ''}</ul>`;
}

function deptNode(d, sector, hc, selected, resources) {
  const on = !!selected && selected.id === d.id;
  const scoped = inScope(hc, d.id, sector.id);
  const n = hc.byDept.get(d.id) || 0;
  const label = `${icon('team')}<span class="tm-org-nm">${esc(d.name_ar)}</span>`;
  const node = scoped
    ? `<a class="tm-org-node tm-org-dep${on ? ' on' : ''}" href="${esc(orgHref(d.id))}" data-dep="${esc(d.id)}" data-count="${n}"${on ? ' aria-current="page"' : ''}>${label}<span class="tm-org-cnt">${countTnum(n, RES)}</span></a>`
    : `<span class="tm-org-node tm-org-dep is-out" data-dep="${esc(d.id)}" data-scope="out" title="تُعرض موارد إداراتك وقطاعك فقط">${label}<span class="tm-org-cnt tm-org-out">خارج نطاقك</span></span>`;
  return `<li class="tm-org-depli" data-name="${esc(d.name_ar)}">${node}${on ? peopleUnder(resources) : ''}</li>`;
}

function sectorNode(s, hc, selected, resources) {
  const deps = s.departments || [];
  const noDept = hc.noDept.get(s.id) || 0;
  const total = deps.reduce((a, d) => a + (hc.byDept.get(d.id) || 0), 0) + noDept;
  // من هم في القطاع بلا إدارة لا يختفون من العدّ — ولهم بابٌ في سجل الموارد لا عقدةٌ وهمية هنا.
  const noDeptLine = noDept > 0
    ? `<li class="tm-org-depli tm-org-nodep"><a class="tm-org-node tm-org-dep" href="/app/team/resources?sector=${encodeURIComponent(s.id)}" title="موارد القطاع بلا إدارة — تُفتح في سجل الموارد">${icon('flag')}<span class="tm-org-nm">بلا إدارة</span><span class="tm-org-cnt">${countTnum(noDept, RES)}</span></a></li>` : '';
  return `<li class="tm-org-sec" data-name="${esc(s.name_ar)}">
    <details class="tm-org-det" open>
      <summary class="tm-org-node tm-org-secnode" data-sector="${esc(s.id)}" data-count="${total}">
        <span class="tm-org-chev" aria-hidden="true">◂</span>
        <span class="tm-org-dot" style="background:${esc(s.color || '#244A99')}" aria-hidden="true"></span>
        <span class="tm-org-nm">${esc(s.name_ar)}</span>
        <span class="tm-org-cnt">${countTnum(total, RES)}</span>
      </summary>
      ${deps.length || noDept ? `<ul class="tm-org-deps">${deps.map((d) => deptNode(d, s, hc, selected, resources)).join('')}${noDeptLine}</ul>` : '<div class="tm-org-none">لا إدارات تحت هذا القطاع بعد</div>'}
    </details>
  </li>`;
}

function treePanel(data, hc, selected) {
  const tree = data.tree || [];
  const inner = tree.length
    ? `<ul class="tm-org-ul" id="tm-org-tree">${tree.map((s) => sectorNode(s, hc, selected, data.resources || [])).join('')}</ul>
       <div class="tm-org-tnone" id="tm-org-tnone" hidden>لا قطاع ولا إدارة تطابق البحث — جرّب اسماً آخر.</div>`
    : `${emptyState('لا هيكل بعد', 'أنشئ القطاعات والإدارات من صفحة الهيكل التنظيمي ثم عد إلى هنا.')}<div class="tm-org-cta"><a class="btn btn-sm" href="/app/org">الهيكل التنظيمي</a></div>`;
  return `<section class="tm-card tm-org-treecard" aria-labelledby="tm-org-tree-t">
    <div class="tm-card-h"><div><div class="tm-card-t" id="tm-org-tree-t">${esc(G.orgAffiliation)}</div><div class="tm-card-s">${esc(G.orgAffiliationSub)}</div></div></div>
    <div class="tm-card-b">
      ${tree.length ? `<div class="search tm-org-search">${icon('search')}<input class="input" id="tm-org-tq" type="search" placeholder="ابحث عن قطاع أو إدارة…" aria-label="ابحث عن قطاع أو إدارة" aria-controls="tm-org-tree" autocomplete="off"></div>` : ''}
      ${inner}
    </div>
  </section>`;
}

// ── قائمة الإدارة المختارة ─────────────────────────────────────────────────────────────────────
// رقاقة التوفر للشهر الجاري: اللون من حزام المؤكد (تجاوز = أحمر، قرب الحد = كهرماني…) والنص يقول
// الرقم؛ وخارج فترة الارتباط ليس صفراً — يُقال باسمه.
const availChip = (m) => (!m || m.state === 'out' || m.availablePct == null
  ? `<span class="tm-pct b-out">${esc(G.outOfEngagement)}</span>`
  : `<span class="tm-pct b-${esc(m.band || 'ok')}" title="${esc(m.band_ar || '')}">متاح <span class="tnum">${Math.round(N(m.availablePct))}%</span></span>`);

function resourceRow(r) {
  const href = profileHref(r.id);
  const e = r.engagement || {};
  return `<tr class="tm-row-click" data-emp="${esc(r.id)}" data-href="${esc(href)}" data-action="open-resource" data-hay="${esc(`${r.name_ar} ${r.job_title || ''}`.toLowerCase())}">
    <td>${person(r.name_ar, r.job_title || '', { href })}</td>
    <td>${typePill(r.resourceType, r.resourceType_ar)}</td>
    <td>${availChip(r.month)}</td>
    <td>${engagementPill(e.status, e.status_ar)}</td>
    <td class="tm-org-go"><a href="${esc(href)}" aria-label="فتح ملف ${esc(r.name_ar)}">›</a></td>
  </tr>`;
}

function listPanel(data, hc, q, canAdd) {
  const dep = data.department;
  if (!dep) {
    return `<section class="tm-card tm-org-listcard">${emptyState(G.pickDepartment, 'انقر إدارةً في الشجرة لعرض مواردها وارتباطاتها المشتركة — الاختيار يبقى في الرابط فتعود إليه كما تركته.')}</section>`;
  }
  const rows = data.resources || [];
  const scoped = inScope(hc, dep.id, dep.sector_id);
  const ended = rows.filter((r) => r.engagement && r.engagement.status === 'ended').length;
  const meta = [
    esc(dep.sector_name || ''),
    dep.manager_name ? `المسؤول: ${esc(dep.manager_name)}` : 'بلا مسؤول معيَّن',
    scoped && !q ? `${countTnum(rows.length, RES)}${ended ? ` · منهم <span class="tnum">${ended}</span> منتهي الارتباط` : ''}` : '',
    scoped && q ? `نتائج البحث: ${countTnum(rows.length, RES)}` : '',
  ].filter(Boolean).join(' · ');
  const searchForm = scoped ? `<form class="search tm-org-search" method="get" action="/app/team/org" role="search">
      <input type="hidden" name="department" value="${esc(dep.id)}">
      ${icon('search')}<input class="input" id="tm-org-q" name="q" type="search" value="${esc(q)}" placeholder="ابحث بالاسم أو المسمى…" aria-label="ابحث في موارد الإدارة" autocomplete="off">
    </form>` : '';
  let body;
  if (!scoped) {
    body = emptyState('هذه الإدارة خارج نطاقك', 'تُعرض موارد إداراتك وقطاعك فقط — اختر إدارةً أخرى من الشجرة.');
  } else if (!rows.length && q) {
    body = `${emptyState('لا نتائج تطابق البحث', `لا مورد في ${dep.name_ar} يطابق «${q}».`)}<div class="tm-org-cta"><a class="btn btn-sm" href="${esc(orgHref(dep.id))}">امسح البحث</a></div>`;
  } else if (!rows.length) {
    body = `${emptyState('لا موارد في هذه الإدارة', 'لم يُسجَّل أي مورد تحت هذه الإدارة ضمن نطاقك بعد.')}<div class="tm-org-cta"><a class="btn btn-sm" href="/app/team/resources">${esc(G.resourcesRegistry)}</a>${canAdd ? `<a class="btn btn-primary btn-sm" href="/app/team/resources?new=1&amp;department=${encodeURIComponent(dep.id)}">${esc(G.addResource)}</a>` : ''}</div>`;
  } else {
    body = `<div class="tblwrap"><table class="tm-tbl tm-org-tbl" id="tm-org-rows">
      <thead><tr><th>المورد</th><th>النوع</th><th>حالة التوفر <span class="tm-org-thm">(${esc((data.month && data.month.label_ar) || '')})</span></th><th>الارتباط</th><th></th></tr></thead>
      <tbody>${rows.map(resourceRow).join('')}</tbody></table>
      <div class="tm-empty" id="tm-org-none" hidden><div class="t">لا نتائج تطابق البحث</div><div>جرّب اسماً أو مسمًّى آخر.</div></div></div>
      <div class="tm-note tm-org-basis">${icon('info')}<span>${esc(data.basis_ar || '')} · ${esc(data.noMoney_ar || '')}</span></div>`;
  }
  return `<section class="tm-card tm-org-listcard" aria-labelledby="tm-org-list-t">
    <div class="tm-card-h tm-org-lh"><div><div class="tm-card-t" id="tm-org-list-t">${esc(dep.name_ar)}</div><div class="tm-card-s">${meta}</div></div>${searchForm}</div>
    ${body}
  </section>`;
}

// ── الارتباطات التشغيلية المشتركة ───────────────────────────────────────────────────────────────
// ما تعيده الخدمة: أهل هذه الإدارة المسكَّنون على مشاريع تتبع إدارةً أخرى (من الشهر الجاري إلى آخر
// السنة). يُجمَّعون بالمورد — صفٌّ واحد لكل شخص مهما تعدّدت مشاريعه — فلا يُعدّ مرتين.
function rangeLabel(months) {
  if (!months || !months.length) return '';
  const a = months[0].key; const b = months[months.length - 1].key;
  if (a === b) return monthLabel(a);
  const [ya, ma] = String(a).split('-'); const [yb, mb] = String(b).split('-');
  return ya === yb
    ? `${MONTHS_AR[Number(ma) - 1] || ''} – ${MONTHS_AR[Number(mb) - 1] || ''} ${ya}`
    : `${monthLabel(a)} – ${monthLabel(b)}`;
}

function sharedRow(g) {
  const projects = g.items.map((s) => `<div class="tm-org-sp"><a href="/app/project/${encodeURIComponent(s.project.id)}" class="tm-org-plink">${esc(s.project.label)}</a>${s.project.code ? ` <span class="tnum tm-org-code">${esc(s.project.code)}</span>` : ''}<div class="m">${esc(s.project.department_name || 'إدارة غير محدَّدة')} · ${esc(s.project.status_ar || '')}</div></div>`).join('');
  const allocs = g.items.map((s) => `<div class="tm-org-sp">${N(s.currentPct) > 0
    ? `<b class="tnum">${Math.round(N(s.currentPct))}%</b> هذا الشهر`
    : `يبدأ في ${esc(monthLabel(s.months[0].key))}`} ${pill(esc(s.status_ar || ''), s.status === 'tentative' ? 'violet' : 'blue')}<div class="m">${esc(rangeLabel(s.months))}</div></div>`).join('');
  return `<tr data-shared="${esc(g.id)}">
    <td>${person(g.name, '', { href: profileHref(g.id) })}</td>
    <td>${projects}</td>
    <td>${allocs}</td>
    <td>${pill(esc(G.primaryDeptUnchanged), 'slate')}</td>
  </tr>`;
}

function sharedPanel(data, scoped) {
  const dep = data.department;
  if (!dep || !scoped) return '';
  const groups = new Map();
  for (const s of data.shared || []) {
    if (!groups.has(s.employeeId)) groups.set(s.employeeId, { id: s.employeeId, name: s.name_ar, items: [] });
    groups.get(s.employeeId).items.push(s);
  }
  const list = [...groups.values()];
  const sub = 'موارد هذه الإدارة المسكَّنون على مشاريع تتبع إدارات أخرى — إدارتهم الأساسية لا تتغيّر، ولا يُعدّون مرتين في الإجماليات.';
  const body = !list.length
    ? emptyState('لا ارتباطات مشتركة', `لا أحد من موارد ${dep.name_ar} مسكَّن على مشروع إدارة أخرى من ${(data.month && data.month.label_ar) || 'هذا الشهر'} حتى نهاية السنة.`)
    : `<div class="tblwrap"><table class="tm-tbl tm-org-shared">
        <thead><tr><th>المورد</th><th>المشروع وإدارته</th><th>التسكين</th><th>الإدارة الأساسية</th></tr></thead>
        <tbody>${list.map(sharedRow).join('')}</tbody></table></div>`;
  return `<section class="tm-card tm-org-sharedcard" aria-labelledby="tm-org-shared-t">
    <div class="tm-card-h"><div><div class="tm-card-t" id="tm-org-shared-t">${esc(G.sharedEngagements)}</div><div class="tm-card-s">${esc(sub)}</div></div><div class="tm-card-s">${countTnum(list.length, RES)}</div></div>
    ${body}
  </section>`;
}

const PAGE_CSS = `
  .tm-org-grid{display:grid;grid-template-columns:minmax(250px,1fr) 2fr;gap:1rem;align-items:start}
  @media (max-width:900px){.tm-org-grid{grid-template-columns:1fr}}
  .tm-org-search{position:relative;margin-bottom:.7rem}.tm-org-search .input{width:100%;padding-inline-start:2rem}
  .tm-org-lh{flex-wrap:wrap}.tm-org-lh .tm-org-search{margin:0;min-width:220px;flex:1 1 220px;max-width:340px}
  .tm-org-ul,.tm-org-deps,.tm-org-people{list-style:none;margin:0;padding:0}
  .tm-org-deps{margin:.15rem 0 .4rem;padding-inline-start:1rem;border-inline-start:2px dotted var(--line)}
  .tm-org-det>summary{list-style:none}.tm-org-det>summary::-webkit-details-marker{display:none}
  .tm-org-node{display:flex;align-items:center;gap:.5rem;padding:.5rem .6rem;border-radius:10px;color:var(--ink2);text-decoration:none;font-size:var(--fs-body);cursor:pointer;min-width:0}
  .tm-org-node:hover{background:var(--bg)}.tm-org-node:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
  .tm-org-node svg{width:16px;height:16px;flex:none;color:var(--muted)}
  .tm-org-secnode{font-weight:800}
  .tm-org-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tm-org-cnt{font-size:var(--fs-micro);font-weight:700;color:var(--brand);background:#eef2fb;border-radius:999px;padding:.15rem .55rem;white-space:nowrap}
  .tm-org-dep.on{background:#eef2fb;font-weight:800;box-shadow:inset 0 0 0 1px #cbd7f5}
  .tm-org-dep.on .tm-org-cnt{background:var(--brand);color:#fff}
  .tm-org-dep.is-out{color:var(--faint);cursor:default}.tm-org-dep.is-out:hover{background:none}
  .tm-org-out{background:var(--bg);color:var(--faint)}
  .tm-org-chev{display:inline-block;transition:transform .15s;color:var(--faint);font-size:11px}
  .tm-org-det[open]>summary .tm-org-chev{transform:rotate(-90deg)}
  .tm-org-dot{width:10px;height:10px;border-radius:50%;flex:none}
  .tm-org-none,.tm-org-tnone{font-size:var(--fs-micro);color:var(--faint);padding:.3rem 1.6rem .5rem .6rem}
  .tm-org-people{padding:.1rem 0 .5rem;padding-inline-start:1.4rem;display:flex;flex-direction:column;gap:.35rem}
  .tm-org-more{font-size:var(--fs-micro);color:var(--muted)}
  .tm-org-thm{font-weight:400;color:var(--faint)}
  .tm-org-go a{color:var(--faint);text-decoration:none;font-size:18px;padding:0 .3rem}
  .tm-org-cta{display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;padding:0 1rem 1.2rem}
  .tm-org-basis{padding:.6rem 1.1rem .9rem}
  .tm-org-sharedcard{margin-top:1rem}
  .tm-org-sp{padding:.15rem 0}.tm-org-sp .m{font-size:var(--fs-micro);color:var(--muted)}
  .tm-org-plink{color:var(--brand);font-weight:700;text-decoration:none}
  .tm-org-code{font-size:var(--fs-micro);color:var(--faint)}
`;

export async function teamOrgPage(user, opts = {}) {
  const department = String(opts.department || '').trim();
  const q = String(opts.q || '').trim().slice(0, 60);
  // الخدمة هي البوابة: رفضها (أو إدارةٌ غير موجودة) يصعد كما هو إلى معالج الأخطاء.
  const [data, hc] = await Promise.all([
    orgResources(user, { department: department || null, q }),
    scopedHeadcounts(user),
  ]);
  const dep = data.department;
  const scoped = dep ? inScope(hc, dep.id, dep.sector_id) : false;
  const canAdd = canCreateResource(user, (dep && dep.sector_id) || user.sector_id || null);
  const actions = canAdd
    ? `<a class="btn btn-primary" href="/app/team/resources?new=1${dep ? `&amp;department=${encodeURIComponent(dep.id)}` : ''}">${icon('plus')} ${esc(G.addResource)}</a>` : '';
  const body = `<style>${PAGE_CSS}</style>
    <div class="tm-org-grid">
      ${treePanel(data, hc, dep)}
      <div>${listPanel(data, hc, q, canAdd)}${sharedPanel(data, scoped)}</div>
    </div>`;
  return teamLayout({
    user, path: 'people', section: 'org', title: G.orgStructure,
    subtitle: 'اختر إدارةً من الهيكل لعرض مواردها وارتباطاتها المشتركة.',
    crumbs: [{ label: G.orgStructure, href: '/app/team/org' }],
    actions, body, scripts: ['/static/pages/team-org.js'],
  });
}
