// ── S13 مصفوفة التسكين الشهرية · S14 درج الإضافة والمراجعة · S15 درج معالجة التجاوز ─────────────
//
// «اسم المورد وطاقته مثبتان يميناً، والأشهر مرتبة زمنياً من اليمين إلى اليسار… الخلايا والألوان
//  تنشأ من الحسابات الحقيقية» — الموجّه S13. الصفحة تقرأ `planningMatrix` وحدها وتعرض الحالة
// الأولى كاملةً خادمياً؛ الأدراج (S14/S15) هياكلُ خاملة `<template>` يملؤها عميل الصفحة
// (public/pages/team-planning.js) ويكتب عبر واجهة B2 (`/api/team/allocations/...`) — لا كتابة هنا.
//
// ثلاث قواعد: الأرقام كلها من الخدمة (لا معادلة ثانية — حتى شرائح الشريط داخل الخلية تقسيم
// لبنودها لا حسابٌ جديد)؛ الصلاحية بابُها الخدمة (المصفوفة ترمي رفضاً فنعرض حالةً مصمَّمة)،
// وما نفحصه هنا يخفي زراً أو يظهره فقط؛ ولا مال في أي موضع.
import { all } from '../../../core/db/index.js';
import { can } from '../../../core/rbac/index.js';
import { departmentScope } from '../../../core/rbac/departments.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { riyadhDate, MONTHS_AR } from '../../../core/i18n/time.js';
import { countAr } from '../../../core/i18n/plural.js';
import { G, WORK_BUCKET_AR } from '../../i18n/glossary.js';
import { readerBreadth } from '../../../modules/team/access.js';
import { parseMonthKey, monthKey } from '../../../modules/team/capacity-model.js';
import { planningMatrix } from '../../../modules/team/allocations.js';
import { teamLayout, esc, icon, person, pctChip, stackBar, legend, emptyState, monthLabel, stepper } from './_shell.js';

const N = (v) => Number(v) || 0;
const PCT_MAX = 150;            // سقف الكاتب القائم (projects.js) — تُعرض حدوده لا تُفرض هنا
const DEFAULT_SPAN = 6;         // الشهر الجاري وخمسة بعده
const MAX_SPAN = 24;            // سقف الخدمة

// ── الفترة من الرابط: مفاتيح `YYYY-MM`، ورابطٌ معطوب يعود للافتراضي بلا شاشة خطأ ─────────────
function addMonths(key, n) {
  const p = parseMonthKey(key);
  const idx = p.year * 12 + (p.month - 1) + n;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}
const spanOf = (a, b) => { const x = parseMonthKey(a); const y = parseMonthKey(b); return (y.year * 12 + y.month) - (x.year * 12 + x.month) + 1; };
export function periodFromOpts(opts = {}) {
  const nowKey = riyadhDate().slice(0, 7);
  let from = parseMonthKey(opts.from) ? String(opts.from).trim() : nowKey;
  let to = parseMonthKey(opts.to) ? String(opts.to).trim() : addMonths(from, DEFAULT_SPAN - 1);
  if (to < from) [from, to] = [to, from];
  if (spanOf(from, to) > MAX_SPAN) to = addMonths(from, MAX_SPAN - 1);
  return { from, to, nowKey };
}

/**
 * حقوق التخطيط على مستوى الصفحة — لإظهار زرّ «تسكين جديد» وتفعيل الخلايا فقط. مرآةُ
 * `planningRights` (access.js) بلا موردٍ بعينه: يملك أمر أحدٍ من يملك النطاق أو يقود إدارة،
 * ويطلب من يملك «طلب تسكين». الحكم الفعلي على كل مورد في الخدمة (requestGate) عند المعاينة.
 */
export function pagePlanningRights(user) {
  if (!user) return { direct: false, request: false };
  const direct = user.role_id === 'admin' || user.scope === 'company'
    || (user.scope === 'sector' && !!user.sector_id) || departmentScope(user).length > 0;
  const request = direct || can(user, 'create', 'allocation_request') || can(user, 'create', 'allocation');
  return { direct, request };
}

// ── قوائم الفلاتر بنفس حدود الصفوف (readerBreadth) ────────────────────────────────────────────
async function filterLists(user, sector) {
  const breadth = readerBreadth(user);
  const sectors = breadth === 'company'
    ? await all('SELECT id, name_ar FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order, name_ar') : [];
  let depts = await all('SELECT id, name_ar, sector_id FROM department WHERE active = 1 AND deleted_at IS NULL ORDER BY name_ar');
  if (breadth === 'department') { const mine = departmentScope(user); depts = depts.filter((d) => mine.includes(d.id)); }
  else if (breadth === 'sector') depts = depts.filter((d) => d.sector_id === user.sector_id);
  else if (sector) depts = depts.filter((d) => d.sector_id === sector);
  return { breadth, sectors, depts };
}

// ── مشاريع منتقي S14: نطاق قراءة القارئ نفسه (أسماء ورموز وحالات — لا مال) ──────────────────
async function pickerProjects(user) {
  const pf = scopeFilter(user, 'project', 'read', { deptCol: 'department_id', sectorCol: 'sector_id', ownerCol: 'owner_user_id', memberCol: 'id' });
  if (!pf || pf.clause === '1=0') return [];
  const where = ["deleted_at IS NULL", "status IN ('IN_PROGRESS','PLANNED','NOT_STARTED')"];
  const params = [];
  if (pf.clause !== '1=1') { where.push(pf.clause); params.push(...pf.params); }
  const rows = await all(`SELECT id, name_ar, code, status, kind, sector_id, department_id FROM project WHERE ${where.join(' AND ')} ORDER BY name_ar LIMIT 400`, params);
  return rows.map((p) => ({ id: p.id, name: p.name_ar, code: p.code || null, status: p.status || null,
    billable: String(p.kind || 'external') !== 'internal', sector_id: p.sector_id || null, department_id: p.department_id || null }));
}

// ── الخلية ─────────────────────────────────────────────────────────────────────────────────────
const TONE = { project: 'var(--brand)', bucket: '#2aa89a', other: '#94a3b8' };
const dot = (kind) => `<i style="background:${TONE[kind] || TONE.other}"></i>`;

function cellHtml(res, c, canRequest) {
  const where = `${res.name} — ${monthLabel(c.key)}`;
  if (!c || c.state === 'out') {
    return `<td><div class="cell out" title="${esc(`${where}: ${G.outOfEngagement} — لا طاقة مسجَّلة في هذا الشهر، فلا يُؤكَّد تسكين فيه`)}">${esc(G.outOfEngagementShort)}</div></td>`;
  }
  const confirmed = N(c.confirmedPct); const over = N(c.overPct) > 0 || c.state === 'over';
  const items = c.items || [];
  const partOf = (pred) => items.filter(pred).reduce((a, it) => a + N(it.pct), 0);
  const segs = [
    { pct: partOf((it) => it.status === 'confirmed' && it.kind === 'project'), tone: 'proj', label: 'مؤكد — مشروع' },
    { pct: partOf((it) => it.status === 'confirmed' && it.kind !== 'project'), tone: 'int', label: 'مؤكد — عمل داخلي' },
    { pct: N(c.tentativePct), tone: 'tent', label: G.tentativeAlloc },
  ];
  const lines = items.map((it) => {
    const tent = it.status === 'tentative'; const pend = it.status === 'pending';
    const tag = tent ? ` · ${G.tentativeAlloc}` : pend ? ` · ${G.pendingDecision}` : '';
    return `<div class="li${tent ? ' tent' : pend ? ' pend' : ''}"><span>${tent || pend ? '' : dot(it.kind)}${esc(it.label)}${esc(tag)}</span><b class="tnum">${Math.round(N(it.pct))}%</b></div>`;
  }).join('');
  const foot = over
    ? `<div class="tm-pl-foot is-over">تجاوز +<span class="tnum">${Math.round(N(c.overPct))}%</span></div>`
    : `<div class="tm-pl-foot">متاح <span class="tnum">${Math.round(N(c.availablePct))}%</span></div>`;
  const notes = [];
  if (c.changedWithin || c.capacity?.changedWithin) notes.push('تغيّرت الطاقة داخل الشهر');
  if (c.state === 'partial') notes.push('الارتباط يغطي جزءاً من الشهر');
  if (c.potentialOver && !over) notes.push('تعارض محتمل مع المبدئي والمعلَّق');
  const act = !canRequest ? null : over ? 'pl-fix' : 'pl-cell';
  const aria = `${where}: مؤكد ${confirmed}%${over ? `، تجاوز ${Math.round(N(c.overPct))}%` : `، متاح ${Math.round(N(c.availablePct))}%`}${act ? (over ? ' — افتح معالجة التجاوز' : ' — أضِف تسكيناً') : ''}`;
  return `<td><div class="cell${over ? ' over' : ''}${act ? '' : ' ro'}"${act ? ` role="button" tabindex="0" data-action="${act}"` : ''} data-emp="${esc(res.id)}" data-month="${esc(c.key)}" aria-label="${esc(aria)}">
      <div class="tm-pl-top">${pctChip(confirmed, c.band)}<span class="lbl">${esc(G.confirmedAlloc)}</span></div>
      ${stackBar(segs, { max: Math.max(100, N(c.potentialPct)) })}
      ${lines}${foot}${notes.map((n) => `<div class="tm-pl-note">${esc(n)}</div>`).join('')}
    </div></td>`;
}

const bucketOptions = () => Object.entries(WORK_BUCKET_AR).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');

// ── قوالب الأدراج (خاملة — يستنسخها العميل عند الفتح) ─────────────────────────────────────────
function drawerTemplates() {
  const s14 = `<template id="tpl-pl-new">
    <div class="dh"><div><div class="tm-card-t" id="pl-drawer-title">${esc(G.newAllocation)}</div><div class="tm-card-s" data-pl="subtitle">اختر الوجهة والموارد والفترة، ثم عاين الأثر قبل الإرسال.</div></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="pl-close" aria-label="إغلاق">✕</button></div>
    <div class="db tm-form">
      <div data-pl="stepper">${stepper(['البيانات', 'المراجعة', 'النتيجة'], 0)}</div>
      <div data-pl-step="1">
        <section class="tm-sec"><div class="sh">وجهة العمل</div>
          <div class="tm-radio" role="radiogroup" aria-label="وجهة العمل"><label><input type="radio" name="pl-tk" value="project" checked> مشروع</label><label><input type="radio" name="pl-tk" value="bucket"> عمل داخلي</label></div>
          <div class="field" data-pl="project-box" style="margin-top:.6rem"><label for="pl-pq">المشروع</label>
            <input id="pl-pq" class="input" type="text" placeholder="ابحث باسم المشروع أو رمزه…" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="pl-plist">
            <div id="pl-plist" class="tm-pl-list" role="listbox" aria-label="المشاريع" hidden></div>
            <div class="tm-pl-picked" data-pl="project-picked"></div></div>
          <div class="field" data-pl="bucket-box" style="margin-top:.6rem" hidden><label for="pl-bucket">بند العمل الداخلي</label><select id="pl-bucket" class="input">${bucketOptions()}</select></div>
          <div class="row" style="margin-top:.6rem">
            <div class="field"><label>التصنيف التجاري</label><div class="tm-radio"><label><input type="radio" name="pl-bill" value="1"> قابل للفوترة</label><label><input type="radio" name="pl-bill" value="0" checked> غير قابل للفوترة</label></div></div>
            <div class="field"><label>${esc(G.allocTypeWanted)}</label><div class="tm-radio"><label><input type="radio" name="pl-st" value="confirmed" checked> ${esc(G.confirmedAlloc)}</label><label><input type="radio" name="pl-st" value="tentative"> ${esc(G.tentativeAlloc)}</label></div></div>
          </div>
        </section>
        <section class="tm-sec"><div class="sh">الموارد</div>
          <div class="tm-pl-chips" data-pl="res-chips" aria-live="polite"></div>
          <div class="field"><label for="pl-rq">إضافة مورد</label>
            <input id="pl-rq" class="input" type="text" placeholder="ابحث بالاسم أو المسمى الوظيفي…" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="pl-rlist">
            <div id="pl-rlist" class="tm-pl-list" role="listbox" aria-label="الموارد" hidden></div></div>
        </section>
        <section class="tm-sec"><div class="sh">الفترة والنسبة</div>
          <div class="row"><div class="field"><label for="pl-from">من شهر</label><input id="pl-from" type="month" class="input"></div><div class="field"><label for="pl-to">إلى شهر</label><input id="pl-to" type="month" class="input"></div></div>
          <div class="tm-radio" style="margin-top:.6rem"><label><input type="radio" name="pl-pm" value="uniform" checked> نسبة واحدة لكل الأشهر</label><label><input type="radio" name="pl-pm" value="per"> نسب مختلفة</label></div>
          <div class="field" data-pl="pct-box" style="margin-top:.4rem"><label for="pl-pct">النسبة من طاقة المورد</label><input id="pl-pct" type="number" class="input tnum" min="0" max="${PCT_MAX}" step="5" value="50" style="width:120px"></div>
          <div class="tm-pl-months" data-pl="per-months" hidden></div>
          <div class="tm-note" style="margin-top:.4rem">النسبة من طاقة المورد المتعاقدة (100 = كل طاقته في الشهر)؛ وطلبٌ لكل سنة إن امتدت الفترة على سنتين.</div>
        </section>
        <div data-pl="preview" aria-live="polite"></div>
      </div>
      <div data-pl-step="2" hidden></div>
      <div data-pl-step="3" hidden aria-live="polite"></div>
    </div>
    <div class="df" data-pl="foot"></div>
  </template>`;
  const s15 = `<template id="tpl-pl-fix">
    <div class="dh"><div><div class="tm-card-t" id="pl-drawer-title">مراجعة تعارض التسكين</div><div class="tm-card-s" data-pl="subtitle"></div></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="pl-close" aria-label="إغلاق">✕</button></div>
    <div class="db tm-form">
      <div data-pl="fix-alert"></div>
      <section class="tm-sec"><div class="sh">مصادر التجاوز والنسب المقترحة</div><div data-pl="fix-items"></div></section>
      <section class="tm-sec"><div class="sh">نطاق التعديل</div>
        <div class="tm-radio"><label><input type="radio" name="pl-scope" value="month" checked> هذا الشهر فقط</label><label><input type="radio" name="pl-scope" value="onward"> من هذا الشهر وما بعده</label></div>
        <div class="tm-note" data-pl="scope-note" style="margin-top:.35rem"></div></section>
      <div class="field"><label class="req" for="pl-reason">سبب التغيير</label><textarea id="pl-reason" class="input" rows="2" placeholder="لماذا يُعدَّل التسكين؟ يصل السبب إلى مالك العمل والمعتمِد"></textarea></div>
      <div data-pl="preview" aria-live="polite" style="margin-top:.6rem"></div>
      <div data-pl="result" aria-live="polite"></div>
      <div class="tm-info" style="margin-top:.7rem">يبقى التسكين الحالي كما هو حتى اعتماد التعديل — ولا يُحذف التزام ولا يُنقل إلى شخص آخر تلقائياً.</div>
    </div>
    <div class="df" data-pl="foot"></div>
  </template>`;
  return s14 + s15;
}

const STYLE = `<style>
  .tm-pl-filters{display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:.9rem}
  .tm-pl-filters .field{display:grid;gap:.25rem}.tm-pl-filters .field>label{font-size:var(--fs-micro);color:var(--muted);font-weight:700}
  .tm-pl-filters .input{padding:.45rem .6rem}
  .tm-pl-filters .sw{display:flex;align-items:center;gap:.4rem;font-size:var(--fs-body);cursor:pointer;padding:.45rem 0}
  .tm-pl-filters .grow{flex:1 1 200px}
  .tm-pl-count{font-size:var(--fs-meta);color:var(--muted);margin:.5rem 0 .3rem;display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap}
  .tm-mx .cell.ro{cursor:default}.tm-mx .cell.ro:hover{background:var(--surface)}
  .tm-mx .cell:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
  .tm-mx .cell .tm-pl-top{display:flex;align-items:center;gap:.4rem;margin-bottom:.3rem}
  .tm-mx .cell .tm-pl-top .lbl{font-size:var(--fs-micro);color:var(--muted)}
  .tm-mx .cell .tm-bar{margin-bottom:.3rem}
  .tm-mx .cell .li.pend span{color:#7a4b00;border:1px dashed #f5d38a;border-radius:999px;padding:0 .4rem}
  .tm-mx .cell .tm-pl-foot{margin-top:.35rem;font-size:var(--fs-micro);color:var(--green);font-weight:700}
  .tm-mx .cell .tm-pl-foot.is-over{color:var(--red)}
  .tm-mx .cell .tm-pl-note{font-size:var(--fs-micro);color:#7a4b00;margin-top:.2rem}
  .tm-mx th.tm-mx-emp .tm-pl-res{display:flex;flex-direction:column;gap:.2rem}
  .tm-pl-name{border:0;background:none;padding:0;cursor:pointer;font:inherit;text-align:right}
  .tm-pl-name:hover .n{color:var(--brand)}.tm-pl-name:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:6px}
  .tm-pl-cap{font-size:var(--fs-micro);color:var(--muted);display:flex;gap:.35rem;flex-wrap:wrap;align-items:center}
  .tm-pl-cap a{color:var(--brand);text-decoration:none}
  .tm-pl-legend{display:flex;justify-content:space-between;gap:.8rem;flex-wrap:wrap;align-items:center;padding:.6rem .2rem 0}
  .tm-pl-drawer{width:min(720px,96vw)}
  .tm-pl-drawer [hidden]{display:none!important}
  .tm-pl-drawer .db{padding-bottom:1.4rem}
  .tm-pl-drawer .df{flex-direction:row;flex-wrap:wrap;gap:.5rem}
  .tm-pl-list{border:1px solid var(--line);border-radius:12px;max-height:220px;overflow:auto;background:var(--surface);margin-top:.3rem;padding:.25rem}
  .tm-pl-list[hidden]{display:none}
  .tm-pl-list button{display:flex;justify-content:space-between;gap:.5rem;width:100%;border:0;background:none;font:inherit;text-align:right;padding:.4rem .55rem;border-radius:8px;cursor:pointer;color:var(--ink2);font-size:var(--fs-body)}
  .tm-pl-list button:hover,.tm-pl-list button.active{background:#eef3fc;color:var(--brand)}
  .tm-pl-list .m{color:var(--muted);font-size:var(--fs-micro)}
  .tm-pl-list .none{padding:.5rem;color:var(--muted);font-size:var(--fs-meta)}
  .tm-pl-picked{margin-top:.35rem;font-size:var(--fs-body)}
  .tm-pl-picked b{color:var(--ink2)}
  .tm-pl-chips{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.5rem;min-height:1.6rem}
  .tm-pl-chip{display:inline-flex;align-items:center;gap:.35rem;background:#eef2fb;color:var(--brand);border-radius:999px;padding:.2rem .35rem .2rem .65rem;font-size:var(--fs-meta);font-weight:700}
  .tm-pl-chip button{border:0;background:none;cursor:pointer;color:inherit;font:inherit;padding:0 .2rem;line-height:1}
  .tm-pl-chips .none{font-size:var(--fs-meta);color:var(--muted)}
  .tm-pl-months{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:.4rem;margin-top:.5rem}
  .tm-pl-months[hidden]{display:none}
  .tm-pl-months label{display:grid;gap:.15rem;font-size:var(--fs-micro);color:var(--muted);text-align:center}
  .tm-pl-months input{width:100%;text-align:center}
  .tm-pl-tbl{width:100%;border-collapse:collapse;font-size:var(--fs-body);margin-top:.5rem}
  .tm-pl-tbl th{font-size:var(--fs-micro);color:var(--muted);text-align:right;padding:.35rem .45rem;border-bottom:1px solid var(--line);font-weight:700;white-space:nowrap}
  .tm-pl-tbl td{padding:.35rem .45rem;border-bottom:1px dashed var(--line)}
  .tm-pl-tbl tr.bad td{background:#fdeaea;color:#8a1c1c}
  .tm-pl-tbl tr.out td{color:var(--faint)}
  .tm-pl-tbl tr.tot td{font-weight:800;border-top:2px solid var(--line);border-bottom:0}
  .tm-pl-tblwrap{overflow-x:auto}
  .tm-pl-res-h{display:flex;justify-content:space-between;gap:.6rem;align-items:center;margin-top:.8rem;font-weight:800;color:var(--ink2)}
  .tm-pl-outcome{display:grid;gap:.4rem}
  .tm-pl-outcome .row-o{display:flex;justify-content:space-between;gap:.6rem;align-items:center;background:var(--bg);border-radius:10px;padding:.5rem .7rem;font-size:var(--fs-body);flex-wrap:wrap}
  .tm-pl-outcome .row-o.bad{background:#fdeaea;color:#8a1c1c}.tm-pl-outcome .row-o.ok{background:#e9f8f1;color:#0f5132}.tm-pl-outcome .row-o.wait{background:#fff7e6;color:#7a4b00}
  .tm-pl-cmp{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:.6rem}
  @media (max-width:640px){.tm-pl-cmp{grid-template-columns:1fr}}
  .tm-pl-cmp .c{border-radius:12px;padding:.6rem .8rem}.tm-pl-cmp .c b{display:block;font-size:var(--fs-body)}.tm-pl-cmp .c span{font-size:var(--fs-micro)}
  .tm-pl-cmp .before{background:#fdeaea;color:#8a1c1c}.tm-pl-cmp .after{background:#e9f8f1;color:#0f5132}.tm-pl-cmp .after.bad{background:#fdeaea;color:#8a1c1c}
  .tm-pl-empty-actions{display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;margin-top:.5rem}
</style>`;

export async function planningPage(user, opts = {}) {
  const period = periodFromOpts(opts);
  const tentRaw = Array.isArray(opts.tentative) ? opts.tentative[opts.tentative.length - 1] : opts.tentative;
  const showTentative = String(tentRaw ?? '1') !== '0';
  const q = String(opts.q || '').trim();
  const sectorReq = String(opts.sector || '').trim() || null;
  const departmentReq = String(opts.department || '').trim() || null;
  const rights = pagePlanningRights(user);

  // الخدمة هي الباب: من لا يقرأ الفريق يرى حالةً مصمَّمة لا شاشةَ عطل.
  let data = null; let denied = null;
  try {
    data = await planningMatrix(user, { from: period.from, to: period.to, sector: sectorReq, department: departmentReq, q, showTentative });
  } catch (e) {
    if (e && e.status === 403) denied = e.message; else throw e;
  }
  const crumbs = [{ label: G.planningTab, href: '/app/team/planning' }];
  const subtitle = 'وزّع الموارد عبر الأشهر، وراجع المتاح والتعارضات.';
  if (denied) {
    return teamLayout({ user, path: 'planning', section: 'planning', title: G.pathPlanning, subtitle, crumbs, year: opts.year,
      body: `<div class="tm-card">${emptyState('لا تملك صلاحية عرض مصفوفة التسكين', denied)}
        <div class="tm-pl-empty-actions" style="padding-bottom:1.2rem"><a class="btn" href="/app/team">العودة إلى الفريق</a></div></div>` });
  }

  const { breadth, sectors, depts } = await filterLists(user, data.filters?.sector || sectorReq);
  const sector = data.filters?.sector || null;
  const department = data.filters?.department || null;
  const rows = data.rows || [];
  const months = data.months || [];
  const canRequest = rights.request;
  const projects = canRequest ? await pickerProjects(user) : [];

  // ── الفلاتر (تُحفظ في الرابط؛ العميل يرسل النموذج عند التغيير) ────────────────────────
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const filters = `<form class="tm-pl-filters" id="pl-filters" method="get" action="/app/team/planning" role="search" aria-label="مرشِّحات المصفوفة">
    <div class="field"><label for="pl-f-from">من شهر</label><input class="input" type="month" id="pl-f-from" name="from" value="${esc(period.from)}"></div>
    <div class="field"><label for="pl-f-to">إلى شهر</label><input class="input" type="month" id="pl-f-to" name="to" value="${esc(period.to)}"></div>
    ${breadth === 'company' && sectors.length ? `<div class="field"><label for="pl-f-sector">القطاع</label><select class="input" id="pl-f-sector" name="sector">${opt('', 'كل القطاعات', !sector)}${sectors.map((s) => opt(s.id, s.name_ar, s.id === sector)).join('')}</select></div>` : ''}
    ${depts.length ? `<div class="field"><label for="pl-f-dept">الإدارة</label><select class="input" id="pl-f-dept" name="department">${opt('', 'كل الإدارات', !department)}${depts.map((d) => opt(d.id, d.name_ar, d.id === department)).join('')}</select></div>` : ''}
    <div class="field grow"><label for="pl-f-q">بحث</label><input class="input" type="search" id="pl-f-q" name="q" value="${esc(q)}" placeholder="ابحث عن اسم أو مسمى وظيفي…"></div>
    <input type="hidden" name="tentative" value="0">
    <label class="sw"><input type="checkbox" name="tentative" value="1" id="pl-f-tent"${showTentative ? ' checked' : ''}> ${esc(G.showTentative)}</label>
    <noscript><button type="submit" class="btn">تطبيق</button></noscript>
  </form>`;

  // ── المصفوفة ──────────────────────────────────────────────────────────────────────────────
  const head = `<tr><th class="tm-mx-emp" scope="col">المورد</th>${months.map((m) => `<th scope="col"${m.key === period.nowKey ? ' aria-current="date"' : ''}><span class="tnum" dir="rtl">${esc(m.label_ar || monthLabel(m.key))}</span>${m.key === period.nowKey ? '<div style="font-size:var(--fs-micro);color:var(--brand)">الشهر الحالي</div>' : ''}</th>`).join('')}</tr>`;
  const rowHtml = (r) => {
    const res = r.resource;
    const prof = `/app/team/resources/${encodeURIComponent(res.id)}`;
    const who = canRequest
      ? `<button type="button" class="tm-pl-name" data-action="pl-new-res" data-emp="${esc(res.id)}" title="${esc(`تسكين ${res.name} عبر الفترة المعروضة`)}">${person(res.name, res.job_title)}</button>`
      : person(res.name, res.job_title, { href: prof });
    const meta = [`الطاقة <span class="tnum">${Math.round(N(res.capacityPct))}%</span>`, esc(res.resourceType_ar || ''), res.department_name && !department ? esc(res.department_name) : '']
      .filter(Boolean).join(' · ');
    return `<tr data-emp="${esc(res.id)}"><th class="tm-mx-emp" scope="row"><div class="tm-pl-res">${who}<div class="tm-pl-cap"><span>${meta}</span><a href="${esc(prof)}">الملف</a></div></div></th>${months.map((m, i) => cellHtml(res, r.cells[i], canRequest)).join('')}</tr>`;
  };
  const hasFilters = !!(q || department || sector);
  let matrix;
  if (rows.length) {
    matrix = `<div class="tm-mx" id="pl-mx"><table aria-label="${esc(`مصفوفة التسكين ${monthLabel(period.from)} – ${monthLabel(period.to)}`)}"><thead>${head}</thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
  } else if (q) {
    matrix = `<div class="tm-card">${emptyState('لا نتائج لهذا البحث', `لا مورد يطابق «${q}» ضمن نطاقك — جرّب اسماً آخر أو امسح البحث.`)}
      <div class="tm-pl-empty-actions" style="padding-bottom:1.2rem"><a class="btn" href="/app/team/planning?from=${esc(period.from)}&to=${esc(period.to)}${sector ? `&sector=${esc(sector)}` : ''}${department ? `&department=${esc(department)}` : ''}${showTentative ? '' : '&tentative=0'}">امسح البحث</a></div></div>`;
  } else {
    matrix = `<div class="tm-card">${emptyState('لا موارد ضمن نطاقك', hasFilters ? 'وسّع الفلتر (القطاع أو الإدارة) لترى مواردَ أخرى.' : 'أضِف موارد من سجل الموارد، أو راجع صلاحيات حسابك.')}
      <div class="tm-pl-empty-actions" style="padding-bottom:1.2rem">${hasFilters ? `<a class="btn" href="/app/team/planning?from=${esc(period.from)}&to=${esc(period.to)}">كل الموارد</a>` : `<a class="btn" href="/app/team/resources">${esc(G.resourcesRegistry)}</a>`}</div></div>`;
  }
  const count = countAr(rows.length, { one: 'مورد واحد', two: 'موردان', few: 'موارد', many: 'مورداً', zero: 'لا موارد' });
  const legendHtml = rows.length ? `<div class="tm-pl-legend">${legend([
    ['var(--brand)', 'مؤكد — مشروع'], ['#2aa89a', 'مؤكد — عمل داخلي'], ['#c7b6f5', 'مبدئي (لا يُخصم)'],
    ['#f5d38a', `${G.pendingDecision} (لا يُخصم)`], ['var(--red)', 'تجاوز'], ['#e2e6ef', G.outOfEngagementShort],
  ])}<div class="tm-note">${esc(data.basis_ar || '')}</div></div>` : '';
  const countLine = `<div class="tm-pl-count"><span><b class="tnum">${count}</b> · ${esc(monthLabel(period.from))} – ${esc(monthLabel(period.to))}${showTentative ? '' : ' · المبدئي مخفي'}</span>${rows.length ? '<span>انقر خليةً لإضافة تسكين، أو خليةً متجاوزة لمعالجتها؛ وانقر الاسم لتسكينه عبر الفترة.</span>' : ''}</div>`;

  // ── حمولة العميل (مقصوصة بصلاحية القارئ في الخادم) ───────────────────────────────────────
  const cells = {};
  for (const r of rows) {
    cells[r.resource.id] = {};
    r.cells.forEach((c) => { cells[r.resource.id][c.key] = { state: c.state, band: c.band, confirmedPct: c.confirmedPct, tentativePct: c.tentativePct, pendingPct: c.pendingPct, availablePct: c.availablePct, overPct: c.overPct, items: c.items || [] }; });
  }
  const deepTarget = String(opts.target || '').trim();
  const deep = {
    open: opts.new === '1' || opts.new === 1 || opts.new === 'true' ? 'new' : (opts.fix === '1' || opts.fix === 1 || opts.fix === 'true') ? 'fix' : null,
    employee: String(opts.employee || '').trim() || null,
    target: /^(project|bucket):.+/.test(deepTarget) ? deepTarget : null,
    from: parseMonthKey(opts.from) ? String(opts.from).trim() : null, to: parseMonthKey(opts.to) ? String(opts.to).trim() : null,
    need: String(opts.need || '').trim() || null,
    month: parseMonthKey(opts.month) ? String(opts.month).trim() : null,
  };
  const payload = {
    period: { from: period.from, to: period.to }, today: period.nowKey,
    months: months.map((m) => ({ key: m.key, label_ar: m.label_ar || monthLabel(m.key) })),
    resources: rows.map((r) => ({ id: r.resource.id, name: r.resource.name, job_title: r.resource.job_title || '', capacityPct: r.resource.capacityPct,
      department_id: r.resource.department_id, department_name: r.resource.department_name || '', sector_id: r.resource.sector_id, resourceType_ar: r.resource.resourceType_ar || '' })),
    cells, projects, buckets: Object.entries(WORK_BUCKET_AR).map(([key, label]) => ({ key, label })),
    rights, deep, pctMax: PCT_MAX, monthNames: MONTHS_AR,
  };
  const script = `<script>window.__SANAD=Object.assign(window.__SANAD||{},{teamPlanning:${JSON.stringify(payload).replace(/</g, '\\u003c')}});</script>`;

  const actions = canRequest
    ? `<button type="button" class="btn btn-primary" data-action="pl-new" id="pl-new-btn">${icon('userplus')} ${esc(G.newAllocation)}</button>` : '';
  const drawer = canRequest
    ? `<div class="tm-scrim" id="pl-scrim" data-action="pl-close"></div>
       <aside class="tm-drawer tm-pl-drawer" id="pl-drawer" role="dialog" aria-modal="true" aria-labelledby="pl-drawer-title" aria-hidden="true" style="display:none"></aside>
       ${drawerTemplates()}` : '';

  const body = `${STYLE}${filters}${countLine}${matrix}${legendHtml}${drawer}${script}`;
  return teamLayout({ user, path: 'planning', section: 'planning', title: G.pathPlanning, subtitle, crumbs, actions, body, year: opts.year,
    scripts: ['/static/pages/team-planning.js'] });
}
