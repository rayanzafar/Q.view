// ── ملف المورد — S04 نظرة عامة · S05 العمل المرتبط · S06 المهام · S07 القدرات · S08 الارتباط والطاقة · S10 السجل ──
//
// «رأس موحد للهوية والإدارة والنوع والحالة والإجراءات المسموحة. ستة تبويبات» — الموجّه §11 S04.
// الصفحة تعرض ما تعيده خدمة الموارد (`modules/team/resources.js`) حرفاً: كل رقمٍ من نموذج الطاقة
// الواحد، وكل زرٍّ من `rights` التي تقرّرها الخدمة — لا فحص صلاحيةٍ هنا ولا معادلةٍ ثانية. والرفض
// والفقد يرتفعان من الخدمة كما هما (المسار يحوّلهما إلى صفحة رفضٍ عربية).
//
// ثلاث قواعد عرضٍ تحكم كل تبويب:
//   • «غير متاح» ≠ صفر: شهرٌ خارج الارتباط يُقال «خارج فترة الارتباط» لا «100% متاح» (S08/T11).
//   • المبدئي يُعرض منفصلاً ولا يُخصم من المتاح (T02)، وعدد المهام لا يتحوّل إلى نسبة استغلال (S06).
//   • لا مال: أسماء الأعمال وفتراتها ونسبها فقط، ولا مفتاح راتبٍ في السجل (الخدمة تُسقطه ونحن لا نطبعه).
import { all } from '../../../core/db/index.js';
import { MONTHS_AR, riyadhDate } from '../../../core/i18n/time.js';
import { countAr } from '../../../core/i18n/plural.js';
import { G, workBucketLabel, WORK_BUCKET_AR } from '../../i18n/glossary.js';
import { namesByIds } from '../../../modules/org/people.js';
import {
  resourceProfile, linkedWork, resourceCapabilities, engagement, resourceAudit,
  SKILL_LEVELS, SKILL_LEVEL_AR, GOAL_STATUSES, GOAL_STATUS_AR, EVIDENCE_KINDS, EVIDENCE_KIND_AR,
  ALLOC_STATUS_AR, CAPABILITY_KIND_AR, SOURCE_AR, AUDIT_KIND_AR,
} from '../../../modules/team/resources.js';
import { RESOURCE_TYPE_AR } from '../../../modules/team/access.js';
import {
  teamLayout, avatar, pctChip, typePill, engagementPill, stackBar, legend, emptyState, monthLabel, kv, esc, pill, icon,
} from './_shell.js';
// نموذج S09 (درج التعديل) وقوائمه — مصدرٌ واحد مع سجل الموارد S02 كي لا تفترق القائمتان.
import { resourceFormTemplate } from './resource-form.js';
import { resourceFormOptions } from './resources.js';

const TABS = ['overview', 'work', 'tasks', 'skills', 'engagement', 'audit'];
const AUDIT_FILTERS = [['all', 'الكل'], ['profile', 'الملف'], ['capacity', 'الطاقة'], ['allocation', 'التسكين'], ['capability', 'القدرات']];
const DASH = '<span style="color:var(--faint)">—</span>';
const pad2 = (n) => String(n).padStart(2, '0');
const N = (v) => Number(v) || 0;

// ── تنسيق التواريخ والأرقام: أرقامٌ لاتينية داخل `.tnum` معزولة الاتجاه ─────────────────────
const dayAr = (iso) => {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return `<span class="tnum">${Number(s.slice(8, 10))}</span> ${MONTHS_AR[Number(s.slice(5, 7)) - 1] || ''} <span class="tnum">${s.slice(0, 4)}</span>`;
};
// وقت التسجيل بتوقيت الرياض (+3) — يومٌ وساعة، فيفترق «متى سُجّل» عن «متى يسري».
const stampAr = (iso) => {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return dayAr(iso);
  const d = new Date(t + 3 * 3600e3);
  const hasTime = /T\d{2}:\d{2}/.test(String(iso));
  const day = dayAr(d.toISOString().slice(0, 10));
  return hasTime ? `${day} · <span class="tnum">${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}</span>` : day;
};
const pctHtml = (v) => (v == null || !Number.isFinite(Number(v)) ? DASH : `<span class="tnum">${Math.round(Number(v))}%</span>`);
const fmtFte = (pct) => String(Math.round(N(pct)) / 100);
const fteHtml = (pct) => `<span class="tnum">${fmtFte(pct)}</span>`;
const periodHtml = (from, to) => {
  if (from && to) return from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;
  if (from) return `من ${monthLabel(from)}`;
  if (to) return `حتى ${monthLabel(to)}`;
  return '<span style="color:var(--faint)">غير محددة</span>';
};
const dateOr = (iso, fallback = DASH) => dayAr(iso) || fallback;
const workHref = (w) => (!w ? null : w.kind === 'project' ? `/app/project/${encodeURIComponent(w.id)}`
  : w.kind === 'opportunity' ? `/app/opportunity/${encodeURIComponent(w.id)}` : null);
const TASK_TONE = { TODO: 'slate', IN_PROGRESS: 'blue', BLOCKED: 'red', IN_REVIEW: 'amber', DONE: 'green', CANCELLED: 'slate' };
const PRIORITY_TONE = { P0: 'red', P1: 'amber', P2: 'slate', P3: 'slate' };
const ALLOC_TONE = { confirmed: 'green', tentative: 'violet', pending: 'amber', mixed: 'blue' };
const GOAL_TONE = { planned: 'slate', in_progress: 'blue', done: 'green' };
// حزام الحالة كلمةً بلونها (لا رقماً ثانياً بجوار النسبة): أخضر ضمن الطاقة، كهرماني قرب الحد، أحمر تجاوز.
const BAND_TONE = { free: 'blue', low: 'blue', ok: 'green', near: 'amber', over: 'red', out: 'slate' };
const bandPill = (band, label) => pill(esc(label || ''), BAND_TONE[band] || 'slate');
const tasksWord = (n) => countAr(N(n), { one: 'مهمة واحدة مفتوحة', two: 'مهمتان مفتوحتان', few: 'مهام مفتوحة', many: 'مهمة مفتوحة', zero: 'لا مهام مفتوحة' });
const unsizedWord = (n) => countAr(N(n), { one: 'واحدة بلا نسبة مقدَّرة', two: 'اثنتان بلا نسبة مقدَّرة', few: 'بلا نسبة مقدَّرة', many: 'بلا نسبة مقدَّرة' });

// القيم الفارغة لا تصل المتصفح كلمةً («null») بل فراغاً — والعميل يقرأ الفراغ غياباً.
const clean = (v) => (v == null ? '' : Array.isArray(v) ? v.map(clean) : typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v);
const json = (v) => JSON.stringify(clean(v)).replace(/</g, '\\u003c');

const CSS = `
  .tm-profile-id{padding:1rem 1.1rem 0;margin-bottom:1rem}
  .tm-profile-idrow{display:flex;gap:.9rem;align-items:flex-start;flex-wrap:wrap}
  .tm-profile-idrow .tm-av{width:56px;height:56px;font-size:22px}
  .tm-profile-who{flex:1 1 240px;min-width:0}
  .tm-profile-name{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;font-size:var(--fs-page);font-weight:800;color:var(--ink2)}
  .tm-profile-job{font-size:var(--fs-body);color:var(--muted);margin-top:.1rem}
  .tm-profile-org{font-size:var(--fs-meta);color:var(--muted);margin-top:.3rem;display:flex;gap:.35rem;align-items:center;flex-wrap:wrap}
  .tm-profile-org svg{width:14px;height:14px}
  .tm-profile-tabs{display:flex;gap:.1rem;margin-top:.8rem;border-top:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
  .tm-profile-tabs a{padding:.6rem .85rem;font-size:var(--fs-body);color:var(--muted);text-decoration:none;border-bottom:2px solid transparent;white-space:nowrap;display:inline-flex;gap:.35rem;align-items:center}
  .tm-profile-tabs a.on{color:var(--brand);border-color:var(--brand);font-weight:700}
  .tm-profile-tabs a .c{font-size:var(--fs-micro);background:var(--bg);border-radius:999px;padding:0 .4rem;color:var(--muted)}
  .tm-profile-month{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
  .tm-profile-bar{position:relative;margin:.4rem 0 .6rem}
  .tm-profile-cap{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink2);opacity:.45}
  .tm-profile-tent{border:1px dashed #b39ddb;background:#faf7ff}
  .tm-profile-sec{margin-bottom:1rem}
  .tm-profile-big{font-size:var(--fs-val-lg);font-weight:800;color:var(--brand);line-height:1.1}
  .tm-profile-kv td:first-child{width:38%}
  .tm-profile-diff{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}
  @media(max-width:640px){.tm-profile-diff{grid-template-columns:1fr}}
  .tm-profile-diff h4{font-size:var(--fs-body);font-weight:800;color:var(--brand);margin:0 0 .4rem}
  .tm-profile-diff .r{display:flex;justify-content:space-between;gap:.5rem;font-size:var(--fs-body);padding:.3rem 0;border-bottom:1px dashed var(--line)}
  .tm-profile-diff .r span:first-child{color:var(--muted);flex:0 0 40%}
  .tm-profile-diff .r span:last-child{flex:1;min-width:0;overflow-wrap:anywhere;text-align:start}
  .tm-profile-chips{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.8rem}
  .tm-profile-list .tm-li{flex-wrap:wrap}
  .tm-profile-list .tm-li .lbl{flex:1 1 200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:var(--ink2)}
  .tm-profile-list .tm-li a.lbl{text-decoration:none}
  .tm-profile-list .tm-li a.lbl:hover{color:var(--brand)}
  .tm-profile-list .tm-li .meta{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;flex:0 0 auto}
  .tm-profile-late{color:var(--red);font-weight:700}
  .tm-profile-note{font-size:var(--fs-micro);color:var(--muted);margin-top:.5rem;line-height:1.7}
  .tm-profile-tbl tr[data-action]{cursor:pointer}
  .tm-profile-tbl tr[data-action]:hover td{background:#f6f8fd}
  .tm-profile-tbl tr[data-action]:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
  .tm-profile-sub{font-size:var(--fs-micro);color:var(--muted)}
`;

// ── عرض التبويبات ═══════════════════════════════════════════════════════════════════════════════
export async function resourceProfilePage(user, employeeId, opts = {}) {
  const tab = TABS.includes(String(opts.tab || '')) ? String(opts.tab) : 'overview';
  const p = await resourceProfile(user, employeeId, { year: opts.year, month: opts.month, tab });
  const r = p.resource;
  const base = `/app/team/resources/${encodeURIComponent(r.id)}`;
  // كل رابطٍ داخلي يحفظ الشهر المختار (الحالة في الرابط) ويبدّل التبويب أو المعامل وحده.
  const link = (params = {}) => {
    const q = new URLSearchParams();
    const merged = { tab, year: opts.year, month: opts.month, ...params };
    for (const [k, v] of Object.entries(merged)) if (v != null && v !== '') q.set(k, String(v));
    const s = q.toString();
    return base + (s ? `?${s}` : '');
  };
  const today = riyadhDate();

  // ── الرأس: الهوية والإجراءات التي تسمح بها الخدمة ────────────────────────────────────
  const actions = [];
  if (p.rights.edit) actions.push(`<button type="button" class="btn" data-action="resource-edit" data-emp="${esc(r.id)}">${icon('edit')} ${esc(G.editProfile)}</button>`);
  if (p.rights.planning && p.rights.planning.request) {
    actions.push(`<a class="btn btn-primary" href="${esc(`/app/team/planning?new=1&employee=${r.id}`)}">${icon('plus')} ${esc(G.requestAllocation)}</a>`);
  }
  if (r.userId && p.tabs.tasks.dossier) {
    actions.push(`<a class="btn" href="/app/person/${encodeURIComponent(r.userId)}">${icon('users')} ${esc(p.rights.self ? G.myTasksAndDossier : G.tasksAndDossier)}</a>`);
  }
  const tabCount = (k) => (p.tabs[k] && p.tabs[k].count != null ? `<span class="c tnum">${N(p.tabs[k].count)}</span>` : '');
  const tabsHtml = `<nav class="tm-profile-tabs" role="tablist" aria-label="أقسام ملف المورد">${TABS.map((k) => `<a role="tab" href="${esc(link({ tab: k, window: null, filter: null }))}" class="${k === tab ? 'on' : ''}"${k === tab ? ' aria-current="page"' : ''}>${esc(p.tabs[k]?.label_ar || k)}${tabCount(k)}</a>`).join('')}</nav>`;
  const orgLine = [r.department_name, r.sector_name].filter(Boolean).map(esc).join(' · ') || 'بلا إدارة مسجَّلة';
  const header = `<div class="tm-card tm-profile-id">
    <div class="tm-profile-idrow">
      ${avatar(r.name_ar)}
      <div class="tm-profile-who">
        <div class="tm-profile-name"><span>${esc(r.name_ar)}</span>${typePill(r.resourceType, r.resourceType_ar)}${engagementPill(r.engagement.status, r.engagement.status_ar)}</div>
        <div class="tm-profile-job">${esc(r.job_title || 'بلا مسمى وظيفي مسجَّل')}${r.vendor_name ? ` · ${esc(r.vendor_name)}` : ''}</div>
        <div class="tm-profile-org">${icon('building')}<span>${orgLine}</span></div>
      </div>
    </div>
    ${tabsHtml}
  </div>`;

  // ── جسم التبويب + ما يحتاجه العميل ───────────────────────────────────────────────────
  const payload = { employeeId: r.id, userId: r.userId, tab, today, resourceName: r.name_ar, capacityPct: r.capacityPct,
    rights: { edit: !!p.rights.edit, self: !!p.rights.self } };
  let body = '';
  if (tab === 'overview') body = overviewHtml(p, { link });
  else if (tab === 'work') body = await workHtml(user, p, { link, window: opts.window });
  else if (tab === 'tasks') body = tasksHtml(p, { payload, today });
  else if (tab === 'skills') body = await skillsHtml(user, p, { payload });
  else if (tab === 'engagement') body = await engagementHtml(user, p, { payload });
  else body = await auditHtml(user, p, { link, filter: opts.filter, base });

  // نموذج S09 (درج «تعديل الملف»): قالبٌ خامل يُضمَّن لمن يملك التعديل، ويستنسخه عميله
  // (team-resource-form.js) عند الضغط على الزر ذي `data-action="resource-edit"`.
  const formHtml = p.rights.edit ? resourceFormTemplate({ mode: 'edit', ...(await resourceFormOptions(user)) }) : '';

  const html = `<style>${CSS}</style>${header}${body}${formHtml}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{teamProfile:${json(payload)}});</script>`;
  return teamLayout({
    user, path: 'people', section: 'resources', title: G.resourceProfile,
    crumbs: [{ label: G.resourcesRegistry, href: '/app/team/resources' }, { label: r.name_ar }],
    actions: actions.join(''), body: html, year: opts.year,
    scripts: ['/static/pages/team-profile.js', ...(p.rights.edit ? ['/static/pages/team-resource-form.js'] : [])],
  });
}

// ═══ S04 — النظرة العامة ═══════════════════════════════════════════════════════════════════════
function overviewHtml(p, { link }) {
  const r = p.resource; const f = p.figures; const out = !f || f.state === 'out';
  const tl = p.taskLoad || {};
  const tile = (key, label, value, sub) => `<div class="tm-kpi" data-kpi="${key}"><div class="l">${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div>`;
  const nominal = f && !out ? f.capacity.nominalPct : r.capacityPct;
  const kpis = `<div class="tm-kpis">
    ${tile('capacity', esc(G.baseCapacity), pctHtml(nominal), `يعادل ${fteHtml(nominal)} من الدوام الكامل`)}
    ${tile('confirmed', esc(G.confirmedAllocation), out ? DASH : pctHtml(f.confirmedPct), out ? esc(G.outOfEngagement) : `${esc(G.ofHisCapacity)} · ${bandPill(f.band, f.band_ar)}`)}
    ${tile('available', esc(G.availableNow), out ? DASH : pctHtml(f.availablePct), out ? esc(G.outOfEngagement) : 'من طاقته التعاقدية المسجلة بعد المؤكد')}
    ${tile('tasks', esc(G.taskLoad), esc(tl.level_ar || G.unmeasured), tl.linked
    ? `<span class="tnum">${esc(tasksWord(tl.open))}</span>${N(tl.unsized) ? ` · <span class="tnum">${esc(unsizedWord(tl.unsized))}</span>` : ''}`
    : 'لا حساب دخول مرتبط — لا مهام تُقاس')}
  </div>`;

  // التوزيع: المؤكد (مشروع/داخلي) ثم المبدئي منفصلاً بنقشٍ متقطّع، والمعلَّق طبقة عرض. المقياس
  // يتّسع للمجموع كي لا يُخفي تجاوزاً، وخطٌّ يعلّم حدّ الطاقة (100) حين يتجاوزه المجموع.
  const items = p.distribution || [];
  const confirmed = items.filter((i) => i.status === 'confirmed');
  const tentative = items.filter((i) => i.status === 'tentative');
  const pending = items.filter((i) => i.status === 'pending');
  const max = Math.max(100, f && !out ? N(f.potentialPct) : 0);
  const segs = confirmed.map((i) => ({ pct: i.pct, tone: i.kind === 'project' ? 'proj' : 'int', label: `${i.label} ${Math.round(i.pct)}%` }))
    .concat(tentative.map((i) => ({ pct: i.pct, tone: 'tent', label: `${i.label} ${Math.round(i.pct)}% مبدئي` })));
  const bar = `<div class="tm-profile-bar">${stackBar(segs, { max })}${max > 100 ? `<i class="tm-profile-cap" style="right:${(100 / max) * 100}%" title="حدّ الطاقة"></i>` : ''}</div>`;
  const legendHtml = legend([['var(--brand)', 'مشروع'], ['#2aa89a', 'عمل داخلي'], ['#c7b6f5', 'مبدئي — لا يُخصم'], ...(f && N(f.overPct) > 0 ? [['var(--red)', 'تجاوز']] : [])]);
  const itemRow = (i) => {
    const href = i.kind === 'project' ? `/app/project/${encodeURIComponent(i.targetId)}` : i.requestId ? `/app/team/requests/${encodeURIComponent(i.requestId)}` : null;
    const lbl = href ? `<a class="lbl" href="${esc(href)}">${esc(i.label)}</a>` : `<span class="lbl">${esc(i.label)}</span>`;
    return `<div class="tm-li${i.status === 'tentative' ? ' tm-profile-tent' : ''}">${lbl}
      <span class="meta">${i.role_ar ? `<span class="m">${esc(i.role_ar)}</span>` : ''}${pill(esc(i.kind === 'project' ? 'مشروع' : i.kind === 'bucket' ? 'عمل داخلي' : 'عمل'), i.kind === 'project' ? 'blue' : 'slate')}${pill(esc(i.status_ar), ALLOC_TONE[i.status] || 'slate')}${pill(i.billable ? 'قابل للفوترة' : 'غير قابل للفوترة', i.billable ? 'green' : 'slate')}<span class="tm-pct b-${i.status === 'tentative' ? 'low' : 'ok'} tnum">${Math.round(i.pct)}%</span></span></div>`;
  };
  const list = out ? emptyState(G.outOfEngagement, 'لا طاقة محسوبة لهذا الشهر — الأشهر خارج الارتباط لا تُعرض متاحةً.')
    : !items.length ? emptyState('لا تسكين في هذا الشهر', 'طاقته متاحة بالكامل هذا الشهر.') + (p.rights.planning?.request ? `<div style="text-align:center;margin-top:-1rem;padding-bottom:1rem"><a class="btn btn-sm" href="${esc(`/app/team/planning?new=1&employee=${r.id}`)}">${esc(G.requestAllocation)}</a></div>` : '')
      : `<div class="tm-list tm-profile-list">
        ${confirmed.map(itemRow).join('')}
        <div class="tm-li"><span class="lbl">${esc(G.availableNow)}</span><span class="meta"><span class="m">بعد المؤكد وحده</span>${pctChip(f.availablePct, N(f.availablePct) > 0 ? 'low' : 'near')}</span></div>
        ${N(f.overPct) > 0 ? `<div class="tm-danger">تجاوز الطاقة بـ<span class="tnum">${Math.round(f.overPct)}%</span> هذا الشهر — راجع التسكين من صفحة التخطيط.</div>` : ''}
        ${tentative.length ? `<div class="tm-profile-sub" style="margin-top:.4rem">تسكين مبدئي — يُعرض منفصلاً ولا يُخصم من المتاح:</div>${tentative.map(itemRow).join('')}` : ''}
        ${pending.length ? `<div class="tm-profile-sub" style="margin-top:.4rem">طلبات بانتظار الاعتماد — لا تحجز طاقة قبل القرار:</div>${pending.map(itemRow).join('')}` : ''}
      </div>`;
  const monthNav = `<div class="tm-profile-month">
    <a class="btn btn-sm" href="${esc(link({ ...shift(p.month, -1) }))}">الشهر السابق</a>
    <b>${esc(p.month.label_ar)}</b>${p.month.isCurrent ? pill('الشهر الحالي', 'blue') : `<a class="btn btn-ghost btn-sm" href="${esc(link({ year: null, month: null }))}">الشهر الحالي</a>`}
    <a class="btn btn-sm" href="${esc(link({ ...shift(p.month, 1) }))}">الشهر التالي</a>
  </div>`;
  const distribution = `<div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div><div class="tm-card-t">التوزيع · ${esc(p.month.label_ar)}</div><div class="tm-card-s">${esc(p.basis_ar)}</div></div>${monthNav}</div>
    <div class="tm-card-b">${out ? '' : bar + legendHtml}${list}</div>
  </div>`;

  // القادم خلال 30 يوماً: مهام حسابه المرتبط ومعالم مشاريعه المسكَّن عليها — بروابطها.
  const up = p.upcoming30 || [];
  const upRow = (u) => {
    const href = u.kind === 'task' ? `${link({ tab: 'tasks' })}#task-${encodeURIComponent(u.id)}` : workHref(u.work);
    return `<div class="tm-li">${href ? `<a class="lbl" href="${esc(href)}">${esc(u.title)}</a>` : `<span class="lbl">${esc(u.title)}</span>`}
      <span class="meta">${pill(esc(u.kind_ar), u.kind === 'task' ? 'blue' : 'violet')}${u.work ? `<span class="m">${esc(u.work.label)}</span>` : ''}<span class="m">${dateOr(u.due)}</span>${u.status_ar ? `<span class="m">${esc(u.status_ar)}</span>` : ''}</span></div>`;
  };
  const upcoming = `<div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div class="tm-card-t">القادم خلال <span class="tnum">30</span> يوماً</div><div class="tm-card-s tnum">${esc(countAr(up.length, { one: 'موعد واحد', two: 'موعدان', few: 'مواعيد', many: 'موعداً', zero: 'لا مواعيد' }))}</div></div>
    <div class="tm-card-b">${up.length ? `<div class="tm-list tm-profile-list">${up.map(upRow).join('')}</div>` : emptyState('لا مواعيد خلال 30 يوماً', r.userId ? 'لا مهام مستحقة ولا معالم قادمة لهذا المورد.' : 'لا حساب دخول مرتبط — تُعرض معالم المشاريع المسكَّن عليها فقط.')}</div>
  </div>`;

  // بيانات المورد: الأساسيات بلا مال، وروابط إلى التبويبات المتخصّصة.
  const acct = r.userId ? pill('مربوط', 'green') : pill('غير مربوط', 'slate');
  const facts = `<div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div class="tm-card-t">بيانات المورد</div></div>
    <div class="tm-card-b tm-profile-kv">${kv([
    ['نوع المورد', esc(r.resourceType_ar)],
    ...(r.vendor_name ? [['الجهة المتعاقدة', esc(r.vendor_name)]] : []),
    ['القطاع', r.sector_name ? esc(r.sector_name) : null],
    ['الإدارة', r.department_name ? esc(r.department_name) : null],
    ...(r.unit_name ? [['الوحدة', esc(r.unit_name)]] : []),
    ['تاريخ البداية', dayAr(r.hire_date)],
    ['تاريخ النهاية', r.end_date ? dayAr(r.end_date) : 'ارتباط مفتوح'],
    ['حالة الارتباط', engagementPill(r.engagement.status, r.engagement.status_ar)],
    ['حساب الدخول', acct],
    ['الطاقة التعاقدية', `${pctHtml(r.capacityPct)} <span class="tm-profile-sub">— ${fteHtml(r.capacityPct)} من الدوام الكامل</span>`],
  ])}
      <div style="display:flex;gap:.6rem;justify-content:space-between;flex-wrap:wrap;margin-top:.8rem;padding-top:.6rem;border-top:1px solid var(--line)">
        <a href="${esc(link({ tab: 'tasks' }))}" style="color:var(--brand);text-decoration:none;font-size:var(--fs-body)">${icon('tasks')} عرض المهام</a>
        <a href="${esc(link({ tab: 'engagement' }))}" style="color:var(--brand);text-decoration:none;font-size:var(--fs-body)">${icon('users')} عرض الارتباط</a>
      </div>
      <div class="tm-profile-note">${metaLine(p.meta)}</div>
    </div>
  </div>`;
  return `${kpis}<div class="tm-grid2"><div>${distribution}${upcoming}</div><div>${facts}</div></div>`;
}
const shift = ({ year, month }, n) => { const idx = year * 12 + (month - 1) + n; return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }; };
const metaLine = (meta) => {
  if (!meta || !meta.lastUpdatedAt) return 'لم يُسجَّل تحديث لهذا الملف بعد.';
  return `آخر تحديث: ${stampAr(meta.lastUpdatedAt)}${meta.lastUpdatedBy ? ` بواسطة ${esc(meta.lastUpdatedBy)}` : ''}`;
};

// ═══ S05 — العمل المرتبط ═══════════════════════════════════════════════════════════════════════
async function workHtml(user, p, { link, window }) {
  const win = ['current', 'past'].includes(String(window || '')) ? String(window) : 'current';
  const w = await linkedWork(user, p.resource.id, { window: win });
  const chip = (k, label) => `<a class="chip${win === k ? ' on' : ''}" href="${esc(link({ tab: 'work', window: k }))}"${win === k ? ' aria-current="page"' : ''}>${label}</a>`;
  const kindTone = { project: 'blue', bucket: 'green', opportunity: 'violet' };
  const allocCell = (row) => {
    if (row.allocation) {
      const a = row.allocation;
      const pct = row.currentPct > 0 ? row.currentPct : row.peakPct;
      const when = row.currentPct > 0 ? 'هذا الشهر' : 'أعلى شهر';
      const href = `/app/team/planning?employee=${encodeURIComponent(p.resource.id)}&month=${encodeURIComponent(row.currentPct > 0 ? w.asOf : (row.period.from || w.asOf))}`;
      return `<a href="${esc(href)}" style="text-decoration:none;display:inline-flex;gap:.35rem;align-items:center;flex-wrap:wrap"><span class="tm-pct b-${a.status === 'tentative' ? 'low' : 'ok'} tnum">${Math.round(pct)}%</span>${pill(esc(a.status_ar), ALLOC_TONE[a.status] || 'slate')}<span class="tm-profile-sub">${when}</span></a>`;
    }
    if (row.membership) return `${pill('مشارك', 'slate')}${row.membership.status === 'pending' ? ` <span class="tm-profile-sub">${esc(row.membership.status_ar)}</span>` : ''}`;
    return DASH;
  };
  const rows = (w.rows || []).map((row) => {
    const href = workHref({ kind: row.kind, id: row.id });
    const open = row.kind === 'project' ? 'فتح المشروع' : row.kind === 'opportunity' ? 'فتح الفرصة' : null;
    return `<tr>
      <td><div style="font-weight:700;color:var(--ink2)">${href ? `<a href="${esc(href)}" style="text-decoration:none;color:inherit">${esc(row.label)}</a>` : esc(row.label)}</div>
        <div class="tm-profile-sub">${[row.code, row.work?.client_name].filter(Boolean).map(esc).join(' · ')}</div></td>
      <td>${pill(esc(row.kind_ar), kindTone[row.kind] || 'slate')}</td>
      <td>${esc(row.role_ar)}</td>
      <td>${allocCell(row)}</td>
      <td>${periodHtml(row.period?.from, row.period?.to)}</td>
      <td>${esc(row.work?.status_ar || '—')}</td>
      <td>${href && open ? `<a class="btn btn-ghost btn-sm" href="${esc(href)}">${open}</a>` : DASH}</td>
    </tr>`;
  });
  const empty = win === 'current'
    ? emptyState('لا عمل مرتبط حالياً', 'لا تسكين مؤكد ولا مبدئي ولا مشاركة مفتوحة لهذا المورد الآن.')
      + (p.rights.planning?.request ? `<div style="text-align:center;margin-top:-1rem;padding-bottom:1rem"><a class="btn btn-sm" href="${esc(`/app/team/planning?new=1&employee=${p.resource.id}`)}">${esc(G.requestAllocation)}</a></div>` : '')
    : emptyState('لا عمل سابق مسجَّل', 'كل ما انتهى من تسكينه أو مشاركاته يظهر هنا.');
  return `<div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div><div class="tm-card-t">العمل المرتبط</div><div class="tm-card-s">المشاريع والأعمال الداخلية والفرص التي يشارك فيها — <span class="tnum">${w.count}</span></div></div>
      <div class="tm-profile-chips" style="margin:0">${chip('current', 'الحالي')}${chip('past', 'السابق')}</div></div>
    ${rows.length ? `<div class="tblwrap"><table class="tm-tbl keep-all tm-profile-tbl"><thead><tr><th>العمل</th><th>النوع</th><th>الدور</th><th>التسكين</th><th>الفترة</th><th>حالة العمل</th><th>الإجراء</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : empty}
    <div class="tm-card-b tm-note">${icon('info')} المشاركة في العمل لا تعني وجود تسكين مؤكد — ${esc(w.basis_ar)}.</div>
  </div>`;
}

// ═══ S06 — المهام (من ملف الشخص القائم عبر الخدمة) ═══════════════════════════════════════════
function tasksHtml(p, { payload, today }) {
  const r = p.resource;
  const t = p.tasks || { linked: !!r.userId, available: false, tasks: [], limits_ar: [], note_ar: null, taskLoad: p.taskLoad };
  const openHref = t.linked && p.tabs.tasks.dossier && r.userId ? `/app/person/${encodeURIComponent(r.userId)}` : null;
  payload.tasks = (t.tasks || []).map((x) => ({
    id: x.id, title: x.title, status: x.status, status_ar: x.status_ar, priority: x.priority, priority_ar: x.priority_ar, due_date: x.due_date,
    next_step: x.next_step, blocked_reason: x.blocked_reason, pending: !!x.pending, department_name: x.department_name,
    utilization_pct: x.utilization_pct == null ? null : x.utilization_pct,
    work: x.work ? { kind: x.work.kind, id: x.work.id, label: x.work.label, href: workHref(x.work) } : null,
  }));
  payload.taskLimits = t.limits_ar || [];
  payload.openHref = openHref;
  payload.tasksReadOnly = true;
  const tl = t.taskLoad || p.taskLoad || {};
  const loadLine = `<div class="tm-note" style="margin-bottom:.8rem">${icon('info')} ${esc(G.taskLoad)}: <b>${esc(tl.level_ar || G.unmeasured)}</b> — ${esc(tl.basis_ar || '')}</div>`;

  if (!t.linked) {
    return `<div class="tm-card tm-profile-sec"><div class="tm-card-b">${emptyState(G.noAccountNoTasks, t.note_ar || 'المهام تُسند إلى حسابات الدخول، وهذا المورد بلا حساب مرتبط.')}
      ${p.rights.edit ? '<div style="text-align:center;margin-top:-1rem;padding-bottom:1rem"><button type="button" class="btn btn-sm" data-action="resource-edit" data-emp="' + esc(r.id) + '">ربط حساب الدخول</button></div>' : ''}</div></div>`;
  }
  if (!t.available) {
    return `<div class="tm-card tm-profile-sec"><div class="tm-card-b"><div class="tm-warn">${esc(t.note_ar || 'قراءة مهام هذا المورد تتطلب صلاحية قراءة مهام إدارته أو قطاعه.')}</div>${loadLine}</div></div>`;
  }
  const tasks = t.tasks || [];
  if (!tasks.length) {
    return `<div class="tm-card tm-profile-sec"><div class="tm-card-b">${loadLine}${emptyState(G.noTasksRecorded, 'لا مهمة مسنَدة إلى حسابه — وهذا غير انخفاض حِمل المهام: العبء يُقاس من النسب المكتوبة على المهام لا من عددها.')}
      ${openHref ? `<div style="text-align:center;margin-top:-1rem;padding-bottom:1rem"><a class="btn btn-sm" href="${esc(openHref)}">${esc(p.rights.self ? G.myTasksAndDossier : G.tasksAndDossier)}</a></div>` : ''}</div></div>`;
  }
  const open = tasks.filter((x) => x.status !== 'DONE');
  const done = tasks.filter((x) => x.status === 'DONE');
  const row = (x) => {
    const late = x.status !== 'DONE' && x.due_date && x.due_date < today;
    return `<tr data-action="task-open" data-task="${esc(x.id)}" tabindex="0" role="button" aria-label="تفاصيل المهمة: ${esc(x.title)}">
      <td><div style="font-weight:700;color:var(--ink2)">${esc(x.title)}</div>${x.pending ? `<div class="tm-profile-sub">بانتظار اعتماد المدير</div>` : ''}${x.blocked_reason ? `<div class="tm-profile-sub" style="color:var(--red)">${esc(G.blocker)}: ${esc(x.blocked_reason)}</div>` : ''}</td>
      <td>${x.work ? (x.work.href ? `<a href="${esc(workHref(x.work))}" style="text-decoration:none">${esc(x.work.label)}</a>` : esc(x.work.label)) : `<span class="tm-profile-sub">${esc(G.internalWork)}</span>`}</td>
      <td>${x.due_date ? `<span class="${late ? 'tm-profile-late' : ''}">${dayAr(x.due_date)}${late ? ' · متأخرة' : ''}</span>` : `<span class="tm-profile-sub">${esc(G.noDueDate)}</span>`}</td>
      <td>${pill(esc(x.status_ar), TASK_TONE[x.status] || 'slate')}</td>
      <td>${x.priority_ar ? pill(esc(x.priority_ar), PRIORITY_TONE[x.priority] || 'slate') : DASH}</td>
    </tr>`;
  };
  const table = (rows) => `<div class="tblwrap"><table class="tm-tbl keep-all tm-profile-tbl"><thead><tr><th>المهمة</th><th>العمل</th><th>${esc(G.dueDate)}</th><th>${esc(G.taskStatus)}</th><th>${esc(G.priority)}</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>`;
  return `<div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div><div class="tm-card-t">المهام المفتوحة <span class="tnum">${open.length}</span></div><div class="tm-card-s">عرض مرتبط بسجلات المهام الأصلية — اضغط المهمة لتفاصيلها</div></div>
      ${openHref ? `<a class="btn btn-sm" href="${esc(openHref)}">${esc(G.openOriginalTask)}</a>` : ''}</div>
    <div class="tm-card-b" style="padding-bottom:0">${loadLine}</div>
    ${open.length ? table(open) : emptyState('لا مهام مفتوحة', `كل مهامه المسجَّلة منجزة (${done.length}).`)}
  </div>
  <div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div class="tm-card-t">المهام المكتملة <span class="tnum">${done.length}</span></div><div class="tm-card-s">${done.length > 20 ? 'آخر 20 مهمة' : ''}</div></div>
    ${done.length ? table(done.slice(0, 20)) : emptyState('لا مهام مكتملة بعد', 'تظهر هنا المهام التي أُنجزت من حسابه.')}
  </div>`;
}

// ═══ S07 — القدرات والتطور ═════════════════════════════════════════════════════════════════════
async function skillsHtml(user, p, { payload }) {
  const c = await resourceCapabilities(user, p.resource.id);
  const write = c.rights ? !!c.rights.write : (!!p.rights.edit || !!p.rights.self);
  payload.capsWrite = write;
  payload.caps = [...c.skills, ...c.experiences, ...c.goals].map((x) => ({
    id: x.id, kind: x.kind, name_ar: x.name_ar, level: x.level, evidence_kind: x.evidence?.kind || null, evidence_ref: x.evidence?.ref || null,
    evidence_label: x.evidence?.label || null, period_from: x.period?.from || null, period_to: x.period?.to || null, target_date: x.target_date, status: x.status, note: x.note,
  }));
  payload.capOptions = {
    levels: SKILL_LEVELS.map((k) => [k, SKILL_LEVEL_AR[k]]), goalStatuses: GOAL_STATUSES.map((k) => [k, GOAL_STATUS_AR[k]]),
    evidenceKinds: EVIDENCE_KINDS.map((k) => [k, EVIDENCE_KIND_AR[k]]), buckets: Object.entries(WORK_BUCKET_AR),
    projects: await linkedProjectsFor(user, p.resource.id),
  };
  const evidence = (x) => {
    if (!x.evidence) return `<span class="tm-profile-sub">بلا شاهد</span>`;
    const e = x.evidence;
    const label = e.label || e.kind_ar;
    if (e.kind === 'project' && e.ref) return `<a href="/app/project/${encodeURIComponent(e.ref)}" style="text-decoration:none">${esc(label)}</a> <span class="tm-profile-sub">${esc(e.kind_ar)}</span>`;
    return `${esc(label)} <span class="tm-profile-sub">${esc(e.kind_ar)}</span>`;
  };
  const source = (x) => (x.reviewed
    ? `${pill(esc(x.source_ar), 'green')}<div class="tm-profile-sub">${x.reviewed_by_name ? esc(x.reviewed_by_name) : 'مراجِع'}${x.reviewed_at ? ` · ${dayAr(x.reviewed_at)}` : ''}</div>`
    : `${pill(esc(x.source_ar), 'slate')}<div class="tm-profile-sub">بانتظار مراجعة المدير</div>`);
  const act = (x) => (write ? `<div style="display:flex;gap:.3rem;flex-wrap:wrap"><button type="button" class="btn btn-ghost btn-sm" data-action="cap-edit" data-cap="${esc(x.id)}">تعديل</button><button type="button" class="btn btn-ghost btn-sm" style="color:var(--red)" data-action="cap-remove" data-cap="${esc(x.id)}" data-name="${esc(x.name_ar)}">حذف</button></div>` : '');
  const addBtn = (kind, label) => (write ? `<button type="button" class="btn btn-sm" data-action="cap-add" data-kind="${kind}">${icon('plus')} ${label}</button>` : '');
  const skillsTbl = c.skills.length ? `<div class="tblwrap"><table class="tm-tbl keep-all"><thead><tr><th>المهارة</th><th>المستوى</th><th>الشاهد</th><th>المصدر والمراجعة</th>${write ? '<th></th>' : ''}</tr></thead><tbody>${c.skills.map((x) => `<tr>
      <td><div style="font-weight:700;color:var(--ink2)">${esc(x.name_ar)}</div>${x.note ? `<div class="tm-profile-sub">${esc(x.note)}</div>` : ''}</td>
      <td>${x.level_ar ? esc(x.level_ar) : '<span class="tm-profile-sub">غير محدد</span>'}</td>
      <td>${evidence(x)}</td><td>${source(x)}</td>${write ? `<td>${act(x)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
    : emptyState('لا مهارات مسجَّلة', write ? 'أضف مهارةً مع مستواها وشاهدٍ عليها — التقييم الذاتي يُميَّز عن المراجَع.' : 'لم تُسجَّل مهارات لهذا المورد بعد.');
  const expList = c.experiences.length ? `<div class="tm-list tm-profile-list">${c.experiences.map((x) => `<div class="tm-li"><span class="lbl">${esc(x.name_ar)}</span>
      <span class="meta"><span class="m">${x.period && (x.period.from || x.period.to) ? `${dateOr(x.period.from, 'بداية غير محددة')} – ${x.period.to ? dayAr(x.period.to) : 'مستمرة'}` : 'فترة غير محددة'}</span><span class="m">${evidence(x)}</span>${act(x)}</span>
      ${x.note ? `<div class="tm-profile-sub" style="flex-basis:100%">${esc(x.note)}</div>` : ''}</div>`).join('')}</div>`
    : emptyState('لا خبرات سابقة مسجَّلة', 'تاريخ الخبرة يُكتب من بياناتٍ صحيحة — لا من صورة.');
  const goalsTbl = c.goals.length ? `<div class="tblwrap"><table class="tm-tbl keep-all"><thead><tr><th>الهدف</th><th>المستهدف</th><th>الحالة</th>${write ? '<th></th>' : ''}</tr></thead><tbody>${c.goals.map((x) => `<tr>
      <td><div style="font-weight:700;color:var(--ink2)">${esc(x.name_ar)}</div>${x.note ? `<div class="tm-profile-sub">${esc(x.note)}</div>` : ''}</td>
      <td>${dateOr(x.target_date, '<span class="tm-profile-sub">بلا موعد</span>')}</td>
      <td>${pill(esc(x.status_ar || GOAL_STATUS_AR.planned), GOAL_TONE[x.status] || 'slate')}</td>${write ? `<td>${act(x)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
    : emptyState('لا أهداف تطوير', write ? 'سجّل هدفاً بموعدٍ مستهدف وتابع حالته.' : 'لم تُسجَّل أهداف تطوير لهذا المورد.');
  const sec = (title, sub, btn, inner) => `<div class="tm-card tm-profile-sec"><div class="tm-card-h"><div><div class="tm-card-t">${title}</div><div class="tm-card-s">${sub}</div></div>${btn}</div>${inner}</div>`;
  return `${sec('المهارات والخبرة', `<span class="tnum">${esc(countAr(c.skills.length, { one: 'مهارة واحدة', two: 'مهارتان', few: 'مهارات', many: 'مهارة', zero: 'لا مهارات بعد' }))}</span> — مستوىً وشاهدٌ ومراجعة، لا درجة عامة ولا ترتيب`, addBtn('skill', 'إضافة مهارة'), skillsTbl)}
    <div class="tm-grid2">
      <div>${sec('أهداف التطوير', 'سجلٌّ بسيط: الهدف والموعد والحالة', addBtn('goal', 'إضافة هدف'), goalsTbl)}</div>
      <div>${sec('الخبرة السابقة', 'بفترتها وشاهدها', addBtn('experience', 'إضافة خبرة'), `<div class="tm-card-b">${expList}</div>`)}</div>
    </div>
    <div class="tm-note">${icon('users')} مراجعة المهارات: الموظف ومديره المباشر أو الموارد البشرية — ${esc(c.legend_ar?.self || SOURCE_AR.self)} يُميَّز عن ${esc(c.legend_ar?.manager || SOURCE_AR.manager)}. لا يُحوَّل هذا الجدول إلى درجةٍ عامة للشخص.</div>`;
}
// مشاريع المورد المرتبطة — خيارات «الشاهد» في نموذج المهارة (أسماء فقط).
async function linkedProjectsFor(user, employeeId) {
  try {
    const w = await linkedWork(user, employeeId, { window: 'all' });
    return (w.rows || []).filter((x) => x.kind === 'project').map((x) => ({ id: x.id, name_ar: x.label }));
  } catch { return []; }
}

// ═══ S08 — الارتباط والطاقة ═════════════════════════════════════════════════════════════════════
async function engagementHtml(user, p, { payload }) {
  const e = await engagement(user, p.resource.id);
  const f = p.figures; const out = !f || f.state === 'out';
  payload.capacity = { currentPct: e.capacity.currentPct, hireDate: e.hire_date };
  payload.rights.capacity = !!e.rights?.edit;
  const acct = !e.account.linked ? pill('غير مربوط', 'slate') : e.account.active ? pill('مربوط · نشط', 'green') : pill('مربوط · موقوف', 'amber');
  const acctNote = e.account.linked && !e.account.active ? '<div class="tm-profile-sub">تعطيل الحساب لا ينهي الارتباط — الطاقة تبقى محسوبة حتى تاريخ النهاية.</div>' : '';
  const engagementCard = `<div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div class="tm-card-t">الارتباط التعاقدي</div>${engagementPill(e.status, e.status_ar)}</div>
    <div class="tm-card-b tm-profile-kv">${kv([
    ['نوع المورد', esc(e.type_ar)],
    ...(e.type !== 'internal' || e.vendor ? [['الجهة المتعاقدة', e.vendor ? esc(e.vendor) : '<span class="tm-profile-sub">لم تُسجَّل</span>']] : []),
    ['مرجع الارتباط', e.ref ? esc(e.ref) : null],
    ['القطاع', e.sector_name ? esc(e.sector_name) : null],
    ['الإدارة', e.department_name ? esc(e.department_name) : null],
    ['مدير المورد', e.manager ? (e.manager.name ? `<a href="/app/person/${encodeURIComponent(e.manager.userId)}" style="text-decoration:none">${esc(e.manager.name)}</a>` : 'مدير الإدارة') : '<span class="tm-profile-sub">لا مدير مسجَّل للإدارة</span>'],
    ['تاريخ البداية', dayAr(e.hire_date)],
    ['تاريخ النهاية', e.end_date ? dayAr(e.end_date) : 'ارتباط مفتوح'],
    ['حساب الدخول', `${acct}${e.account.name ? ` <span class="tm-profile-sub">${esc(e.account.name)}</span>` : ''}${acctNote}`],
  ])}
      <div class="tm-info" style="margin-top:.8rem">${esc(G.engagementNotEndedByAccount)}</div>
      <ul class="tm-profile-note" style="padding-inline-start:1rem;margin:.5rem 0 0">${(e.limits_ar || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>
  </div>`;

  // «0.5 من الدوام الكامل محجوزٌ بكامله = 100% من طاقته و0% متاح» — من أرقام الخدمة نفسها.
  const cur = e.capacity.currentPct;
  const monthRows = out
    ? `<div class="tm-warn">${esc(p.month.label_ar)}: ${esc(G.outOfEngagement)} — لا طاقة محسوبة، ولا يُعرض الشهر متاحاً.</div>`
    : `<table class="tm-tbl keep-all" style="margin-top:.6rem"><tbody>
        <tr><td style="color:var(--muted)">المسكَّن · ${esc(p.month.label_ar)}</td><td>${fteHtml(f.units.confirmed)} من الدوام الكامل</td></tr>
        <tr><td style="color:var(--muted)">المؤكد من طاقته</td><td data-kpi="busy">${pctHtml(f.confirmedPct)} ${bandPill(f.band, f.band_ar)}</td></tr>
        <tr><td style="color:var(--muted)">المتاح من طاقته</td><td data-kpi="available">${pctHtml(f.availablePct)}</td></tr>
        ${N(f.tentativePct) > 0 ? `<tr><td style="color:var(--muted)">مبدئي (لا يُخصم)</td><td>${pctHtml(f.tentativePct)}</td></tr>` : ''}
        <tr><td style="color:var(--muted)">من الطاقة التعاقدية</td><td><div style="display:flex;gap:.5rem;align-items:center">${pctHtml(f.confirmedPct)}<div style="flex:1">${stackBar([{ pct: Math.min(100, N(f.confirmedPct)), tone: N(f.overPct) > 0 ? 'over' : 'proj', label: 'المشغول' }])}</div></div></td></tr>
      </tbody></table>
      <div class="tm-profile-sub" style="margin-top:.4rem">${esc(e.capacity.basis_ar)}</div>`;
  const capacityCard = `<div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div class="tm-card-t">الطاقة المتعاقد عليها</div>${e.rights?.edit ? `<button type="button" class="btn btn-sm" data-action="capacity-edit">${icon('edit')} ${esc(G.editCapacity)}</button>` : ''}</div>
    <div class="tm-card-b">
      <div class="tm-profile-big"><span class="tnum">${Math.round(cur)}%</span></div>
      <div class="tm-profile-sub">${cur === 100 ? 'دوام كامل' : cur === 50 ? 'نصف طاقة الدوام الكامل' : `يعادل ${fteHtml(cur)} من الدوام الكامل`}${out ? '' : f.capacity.state === 'partial' ? ` · <span class="tnum">${f.capacity.engagedDays}</span> من <span class="tnum">${f.capacity.days}</span> يوماً داخل الارتباط هذا الشهر` : ''}</div>
      ${monthRows}
    </div>
  </div>`;

  const versions = e.capacity.versions || [];
  const changes = e.capacity.changes || [];
  const changesHtml = changes.length ? `<table class="tm-tbl keep-all"><tbody>${changes.map((ch) => `<tr>
      <td>${ch.from ? dayAr(ch.from) : 'منذ التسجيل'} – ${ch.to ? dayAr(ch.to) : 'مستمر'}</td>
      <td>${pctHtml(ch.pct)} <span class="tm-profile-sub">${fteHtml(ch.pct)} من الدوام الكامل</span></td>
      <td>${ch.current ? pill('السارية الآن', 'green') : ch.from && ch.from > riyadhDate() ? pill('تسري لاحقاً', 'blue') : pill('سابقة', 'slate')}</td></tr>`).join('')}</tbody></table>` : '';
  const versionsHtml = versions.length ? `<div class="tblwrap"><table class="tm-tbl keep-all"><thead><tr><th>${esc(G.effectiveFrom)}</th><th>الطاقة</th><th>الملاحظة</th><th>سجّلها</th><th>${esc(G.recordedAt)}</th></tr></thead><tbody>${versions.map((v) => `<tr>
      <td>${dayAr(v.effective_from)}</td><td>${pctHtml(v.capacity_pct)}</td><td>${v.note ? esc(v.note) : DASH}</td><td>${v.created_by_name ? esc(v.created_by_name) : DASH}</td><td>${stampAr(v.created_at) || DASH}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="tm-card-b">${emptyState('لا إصدارات طاقة مسجَّلة', 'الطاقة الحالية من سجل المورد؛ كل تغييرٍ لاحق يُكتب بتاريخ سريانه ويُحفظ هنا.')}</div>`;
  const historyCard = `<div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div><div class="tm-card-t">تغيّر الطاقة عبر الفترة</div><div class="tm-card-s">تغيير الطاقة يسري من تاريخٍ محدد ويُحفظ في السجل — الماضي لا يُعاد كتابته</div></div></div>
    ${changesHtml ? `<div class="tm-card-b" style="padding-bottom:0">${changesHtml}</div>` : ''}
    ${versionsHtml}
    <div class="tm-card-b" style="display:flex;gap:1rem;flex-wrap:wrap;border-top:1px solid var(--line)">
      <a href="${esc(`/app/team/planning?employee=${p.resource.id}`)}" style="color:var(--brand);text-decoration:none;font-size:var(--fs-body)">${icon('clock')} عرض تسكين المورد</a>
      <a href="${esc(`/app/team/resources/${p.resource.id}?tab=audit&filter=capacity`)}" style="color:var(--brand);text-decoration:none;font-size:var(--fs-body)">${icon('history')} عرض سجل التعديلات</a>
    </div>
  </div>`;
  return `<div class="tm-grid2"><div>${engagementCard}</div><div>${capacityCard}</div></div>${historyCard}`;
}

// ═══ S10 — سجل التغييرات ════════════════════════════════════════════════════════════════════════
const AUDIT_KEY_AR = {
  name_ar: 'الاسم', name_en: 'الاسم بالإنجليزية', job_title: 'المسمى', department_id: 'الإدارة', sector_id: 'القطاع', unit_id: 'الوحدة',
  position_id: 'المنصب', capacity_pct: 'الطاقة', end_date: 'تاريخ النهاية', hire_date: 'تاريخ البداية', resource_type: 'نوع المورد',
  vendor_name: 'الجهة المتعاقدة', engagement_ref: 'مرجع الارتباط', employment_type: 'نوع التوظيف', monthly_json: 'النسب الشهرية',
  months_json: 'الأشهر المطلوبة', status: 'الحالة', active: 'نشط', user_id: 'حساب الدخول', link_user_id: 'حساب الدخول', effective_from: 'تاريخ السريان',
  level: 'المستوى', evidence_kind: 'نوع الشاهد', evidence_ref: 'مرجع الشاهد', evidence_label: 'الشاهد', period_from: 'بداية الخبرة',
  period_to: 'نهاية الخبرة', target_date: 'موعد الهدف', source: 'المصدر', reviewed_by: 'راجعه', note: 'ملاحظة', type: 'الدور',
  project_id: 'المشروع', project_name: 'اسم المشروع', work_bucket: 'البند الداخلي', billable: 'قابل للفوترة', year: 'السنة',
  alloc_status: 'نوع التسكين', kind: 'النوع', target_kind: 'نوع الوجهة', target_id: 'الوجهة', reason: 'السبب', person_name_ar: 'اسم الشخص',
  line_manager_id: 'مدير المورد', seasonal: 'موسمي', month_start: 'من شهر', month_end: 'إلى شهر', pct: 'النسبة', applied: 'طُبّق الآن',
  employee_capacity_pct: 'الطاقة السارية', decision_note: 'ملاحظة القرار', requested_by: 'طلبه', reviewer_user_id: 'المراجع', need_id: 'الاحتياج',
};
const AUDIT_KEY_SKIP = new Set(['id', 'employee_id', 'updated_at', 'created_at', 'deleted_at', 'created_by', 'baseline_version_id', 'idempotency_key', 'expected_fingerprint', 'approval_request_id', 'applied_allocation_id', 'allocation_id', 'department_id_prev']);
const ID_KEYS = { department_id: 'department', sector_id: 'sector', project_id: 'project', user_id: 'user', link_user_id: 'user', reviewed_by: 'user', line_manager_id: 'employee', requested_by: 'user', reviewer_user_id: 'user' };
const arabicSafe = (s) => typeof s === 'string' && /[؀-ۿ]/.test(s) && !/[A-Za-z_{}[\]"<>]/.test(s);
const MONTH_MAP_AR = (obj, fraction) => {
  const parts = [];
  for (let m = 1; m <= 12; m++) { const v = obj[m] ?? obj[String(m)]; if (v == null || v === '' || !N(v)) continue; parts.push(`${MONTHS_AR[m - 1]} <span class="tnum">${Math.round(fraction ? N(v) * 100 : N(v))}%</span>`); }
  return parts.length ? parts.join(' · ') : 'بلا نسب';
};
const REQ_KIND_AR = { new: 'تسكين جديد', adjust: 'تعديل تسكين', remove: 'إزالة تسكين' };
const REQ_STATUS_AR = { draft: 'مسودة', pending: 'بانتظار الاعتماد', approved: 'معتمد', returned: 'مُعاد', rejected: 'مرفوض', withdrawn: 'مسحوب', applied: 'مطبَّق' };

function auditValue(key, v, row, lookups) {
  if (v == null || v === '') return DASH;
  if (typeof v === 'object') {
    if (key === 'monthly_json') return MONTH_MAP_AR(v, true);
    if (key === 'months_json') return MONTH_MAP_AR(v, false);
    return null;
  }
  const s = String(v);
  if (key === 'monthly_json' || key === 'months_json') { try { return MONTH_MAP_AR(JSON.parse(s), key === 'monthly_json'); } catch { return null; } }
  if (key === 'active' || key === 'billable' || key === 'seasonal' || key === 'applied') return (v === true || Number(v) === 1) ? 'نعم' : 'لا';
  if (key === 'capacity_pct' || key === 'pct' || key === 'employee_capacity_pct') return pctHtml(v);
  if (key === 'resource_type') return esc(RESOURCE_TYPE_AR[s] || s);
  if (key === 'level') return esc(SKILL_LEVEL_AR[s] || (arabicSafe(s) ? s : 'مستوى آخر'));
  if (key === 'source') return esc(SOURCE_AR[s] || (arabicSafe(s) ? s : 'مصدر آخر'));
  if (key === 'evidence_kind') return esc(EVIDENCE_KIND_AR[s] || 'شاهد آخر');
  if (key === 'kind') return esc(CAPABILITY_KIND_AR[s] || REQ_KIND_AR[s] || (arabicSafe(s) ? s : 'نوع آخر'));
  if (key === 'target_kind') return s === 'project' ? 'مشروع' : s === 'bucket' ? 'بند داخلي' : 'وجهة أخرى';
  if (key === 'alloc_status') return esc(ALLOC_STATUS_AR[s] || 'نوع آخر');
  if (key === 'status') return esc(ALLOC_STATUS_AR[s] || GOAL_STATUS_AR[s] || REQ_STATUS_AR[s] || (arabicSafe(s) ? s : 'حالة أخرى'));
  if (key === 'work_bucket') return esc(workBucketLabel(s) || 'بند داخلي');
  if (key === 'target_id') return esc(row.after?.target_kind === 'bucket' || row.before?.target_kind === 'bucket' ? (workBucketLabel(s) || 'بند داخلي') : (lookups.project.get(s) || 'مشروع'));
  if (key === 'evidence_ref') { const ek = row.after?.evidence_kind || row.before?.evidence_kind; return ek === 'project' ? esc(lookups.project.get(s) || 'مشروع') : ek === 'bucket' ? esc(workBucketLabel(s) || 'بند داخلي') : (arabicSafe(s) ? esc(s) : 'مرجع مستند'); }
  if (ID_KEYS[key]) { const name = lookups[ID_KEYS[key]]?.get(s); return name ? esc(name) : '<span class="tm-profile-sub">سجل غير متاح</span>'; }
  if (/_date$|_from$|_to$|_at$/.test(key) && /^\d{4}-\d{2}-\d{2}/.test(s)) return dayAr(s) || esc(s);
  if (/^-?\d+(\.\d+)?$/.test(s)) return `<span class="tnum">${esc(s)}</span>`;
  return arabicSafe(s) ? esc(s) : null;
}
function auditDiffRows(row, lookups) {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const before = isObj(row.before) ? row.before : {}; const after = isObj(row.after) ? row.after : {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const rows = [];
  for (const k of keys) {
    if (AUDIT_KEY_SKIP.has(k) || /salary/i.test(k)) continue;
    const label = AUDIT_KEY_AR[k] || (arabicSafe(k) ? k : null);
    if (!label) continue;
    const b = k in before ? auditValue(k, before[k], row, lookups) : DASH;
    const a = k in after ? auditValue(k, after[k], row, lookups) : DASH;
    if (b === null && a === null) continue;
    rows.push({ label, before: b === null ? DASH : b, after: a === null ? DASH : a });
  }
  return rows;
}
async function auditLookups(rows) {
  const want = { department: new Set(), sector: new Set(), project: new Set(), user: new Set(), employee: new Set() };
  const add = (obj) => { if (!obj || typeof obj !== 'object') return; for (const [k, v] of Object.entries(obj)) { if (v == null || v === '') continue; if (ID_KEYS[k]) want[ID_KEYS[k]].add(String(v)); if (k === 'target_id' || k === 'evidence_ref') want.project.add(String(v)); } };
  for (const r of rows) { add(r.before); add(r.after); }
  const ph = (arr) => arr.map(() => '?').join(',');
  const fetch = async (table, ids) => (ids.length ? new Map((await all(`SELECT id, name_ar FROM ${table} WHERE id IN (${ph(ids)})`, ids)).map((x) => [x.id, x.name_ar])) : new Map());
  const [department, sector, project, employee] = await Promise.all([
    fetch('department', [...want.department]), fetch('sector', [...want.sector]), fetch('project', [...want.project]), fetch('employee', [...want.employee])]);
  return { department, sector, project, employee, user: await namesByIds([...want.user]) };
}
async function auditHtml(user, p, { link, filter, base }) {
  const flt = AUDIT_FILTERS.some(([k]) => k === String(filter || '')) ? String(filter) : 'all';
  const a = await resourceAudit(user, p.resource.id, { filter: flt });
  const rows = a.rows || [];
  const lookups = await auditLookups(rows);
  const chips = `<div class="tm-profile-chips">${AUDIT_FILTERS.map(([k, label]) => `<a class="chip${flt === k ? ' on' : ''}" href="${esc(link({ tab: 'audit', filter: k === 'all' ? null : k }))}"${flt === k ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>`;
  const kindTone = { profile: 'blue', capacity: 'violet', allocation: 'green', request: 'amber', capability: 'slate' };
  const effectiveOf = (r) => {
    if (r.kind === 'capacity') return r.after?.effective_from || r.before?.effective_from || null;
    if (r.kind === 'profile') return r.after?.end_date || r.after?.hire_date || null;
    return null;
  };
  const refOf = (r) => {
    const k = r.ref?.kind; const id = r.ref?.id;
    if (k === 'allocation') {
      const yr = r.after?.year || r.before?.year || null; let mk = null;
      const mj = r.after?.monthly_json || r.before?.monthly_json;
      try { const o = typeof mj === 'string' ? JSON.parse(mj) : mj; if (o && yr) for (let m = 1; m <= 12; m++) if (N(o[m] ?? o[String(m)])) { mk = `${yr}-${pad2(m)}`; break; } } catch { mk = null; }
      return { href: `/app/team/planning?employee=${encodeURIComponent(p.resource.id)}${mk ? `&month=${mk}` : ''}`, label: 'فتح التسكين' };
    }
    if (k === 'allocation_request') return { href: `/app/team/requests/${encodeURIComponent(id)}`, label: 'فتح الطلب' };
    if (k === 'capacity_version') return { href: link({ tab: 'engagement', filter: null }), label: 'الطاقة' };
    if (k === 'resource_capability') return { href: link({ tab: 'skills', filter: null }), label: 'القدرات' };
    return { href: link({ tab: 'overview', filter: null }), label: 'الملف' };
  };
  const templates = [];
  const trs = rows.map((r, i) => {
    const diff = auditDiffRows(r, lookups);
    const changedOnly = !diff.length && Array.isArray(r.changed) && r.changed.length ? r.changed.map((k) => AUDIT_KEY_AR[k] || (arabicSafe(k) ? k : null)).filter(Boolean) : [];
    const ddKey = `audit-${i}`;
    if (diff.length || changedOnly.length) {
      templates.push(`<template id="dd-${ddKey}"><div class="modal-head"><div><div style="font-weight:800;font-size:var(--fs-title)">${esc(r.action_ar)}</div><div class="tm-profile-sub">${stampAr(r.at) || ''} · ${esc(r.actor?.name || 'النظام')}</div></div><button type="button" class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>
        <div class="modal-body">${diff.length ? `<div class="tm-profile-diff"><div><h4>قبل التعديل</h4>${diff.map((d) => `<div class="r"><span>${esc(d.label)}</span><span>${d.before}</span></div>`).join('')}</div><div><h4>بعد التعديل</h4>${diff.map((d) => `<div class="r"><span>${esc(d.label)}</span><span>${d.after}</span></div>`).join('')}</div></div>`
    : `<div class="tm-info">الحقول المتغيّرة: ${changedOnly.map(esc).join('، ')} — بلا قيمٍ محفوظة لهذا السطر.</div>`}
        ${r.reason ? `<div class="tm-sec" style="margin-top:.8rem"><div class="sh">سبب التعديل</div>${esc(r.reason)}</div>` : ''}
        <div class="tm-profile-note">${icon('info')} السجل للعرض فقط — لا يُعدَّل ولا يُحذف.</div></div></template>`);
    }
    const ref = refOf(r); const eff = effectiveOf(r);
    return `<tr>
      <td><div style="font-weight:700;color:var(--ink2)">${esc(r.action_ar)}</div><div>${pill(esc(r.kind_ar), kindTone[r.kind] || 'slate')}</div></td>
      <td>${esc(r.actor?.name || 'النظام')}</td>
      <td>${stampAr(r.at) || DASH}</td>
      <td>${eff ? dayAr(eff) || DASH : DASH}</td>
      <td>${r.reason ? esc(r.reason) : DASH}</td>
      <td><a class="btn btn-ghost btn-sm" href="${esc(ref.href)}">${ref.label}</a></td>
      <td>${diff.length || changedOnly.length ? `<button type="button" class="btn btn-sm" data-action="audit-diff" data-dd="${ddKey}">${esc(G.beforeAfter)}</button>` : DASH}</td>
    </tr>`;
  });
  return `<div class="tm-card tm-profile-sec">
    <div class="tm-card-h"><div><div class="tm-card-t">${esc(p.tabs.audit?.label_ar || 'سجل التغييرات')}</div><div class="tm-card-s">تاريخ واضح للتعديلات والاعتمادات — <span class="tnum">${esc(countAr(rows.length, { one: 'سطر واحد', two: 'سطران', few: 'أسطر', many: 'سطراً', zero: 'لا أسطر' }))}</span></div></div>${chips}</div>
    ${rows.length ? `<div class="tblwrap"><table class="tm-tbl keep-all"><thead><tr><th>التغيير</th><th>الفاعل</th><th>${esc(G.recordedAt)}</th><th>${esc(G.effectiveFrom)}</th><th>السبب</th><th>المرجع</th><th>${esc(G.beforeAfter)}</th></tr></thead><tbody>${trs.join('')}</tbody></table></div>`
    : emptyState('لا تغييرات مسجَّلة', flt === 'all' ? 'كل تعديلٍ على هذا المورد يُسجَّل هنا بوقته وفاعله.' : 'لا تغييرات ضمن هذا المرشّح — جرّب «الكل».')}
    <div class="tm-card-b tm-note">${icon('audit')} السجل للقراءة — لا يقبل تعديلاً ولا حذفاً، والتفاصيل المالية المحجوبة لا تظهر فيه.</div>
  </div>${templates.join('')}`;
}

export { AUDIT_KEY_AR };
