// ── S16 طلبات التسكين والاعتماد: القائمة (يميناً) ولوحة مراجعة الطلب المحدَّد (يساراً) ────────────
//
// «قائمة طلبات مع «كل الطلبات» و«بانتظار قراري» والبحث والتاريخ؛ مراجعة الطلب المحدد تعرض
//  الوجهة والمورد والفترة والنسبة والأثر والموافقات… قيمة «إدارة المورد» تُعرض كإدارة، و«مدير
//  المورد» كشخص» — الموجّه S16. القراءة من `listRequests`/`getRequest` وحدهما؛ القرار والسحب من
// عميل الصفحة (public/pages/team-requests.js) عبر `/api/team/allocations/requests/:id/...`.
// الأزرار تُظهرها حقوق الخدمة (`canDecide`/`canWithdraw`) لا فحصٌ هنا، والحكم الفعلي في الخدمة.
import { get } from '../../../core/db/index.js';
import { G } from '../../i18n/glossary.js';
import { parseMonthKey } from '../../../modules/team/capacity-model.js';
import { listRequests, getRequest } from '../../../modules/team/allocations.js';
import { PLAN_CHANGED_AR } from '../../../modules/team/allocation-settle.js';
import { teamLayout, esc, icon, person, pill, emptyState, monthLabel, kv } from './_shell.js';
import { pagePlanningRights } from './planning.js';

const N = (v) => Number(v) || 0;
const FILTERS = [['all', G.allRequests], ['mine', G.myRequests], ['pending_my_decision', G.pendingMyDecision]];
const STATUS_TONE = { draft: 'slate', pending: 'amber', approved: 'green', applied: 'green', returned: 'amber', rejected: 'red', withdrawn: 'slate' };
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

// ── فترة الطلب ونسبته من خريطة أشهره (نصٌّ للعرض — لا حساب) ───────────────────────────────
function monthsOf(r) {
  return Object.entries(r.months || {}).filter(([, p]) => N(p) > 0 || r.kind !== 'new').sort((a, b) => a[0].localeCompare(b[0]));
}
function periodText(r) {
  const ms = monthsOf(r);
  if (!ms.length) return '—';
  const a = monthLabel(ms[0][0]); const b = monthLabel(ms[ms.length - 1][0]);
  return a === b ? a : `${a} – ${b}`;
}
function pctText(r) {
  const vals = [...new Set(monthsOf(r).map(([, p]) => Math.round(N(p))))];
  if (!vals.length) return '—';
  if (vals.length === 1) return `<span class="tnum">${vals[0]}%</span>`;
  return `<span class="tnum">${Math.min(...vals)}–${Math.max(...vals)}%</span>`;
}
const statusPill = (r) => pill(esc(r.status_ar || r.status || '—'), STATUS_TONE[r.status] || 'slate');
const allocPill = (r) => pill(esc(r.allocStatus_ar || (r.allocStatus === 'tentative' ? G.tentativeAlloc : G.confirmedAlloc)), r.allocStatus === 'tentative' ? 'violet' : 'blue');
const planChanged = (r) => r.status === 'returned' && String(r.reason || '').includes(PLAN_CHANGED_AR);

// رابط إعادة الطلب من S14 بسياقه — بعد «تغيّرت الخطة منذ المعاينة».
function repreviewHref(r) {
  const ms = monthsOf(r);
  const p = new URLSearchParams({ new: '1', employee: r.employee?.id || '', target: `${r.target?.kind || 'project'}:${r.target?.id || ''}` });
  if (ms.length) { p.set('from', ms[0][0]); p.set('to', ms[ms.length - 1][0]); }
  if (r.needId) p.set('need', r.needId);
  return `/app/team/planning?${p.toString()}`;
}

// ── لوحة مراجعة الطلب المحدَّد ──────────────────────────────────────────────────────────────
async function managerOfDepartment(departmentId) {
  if (!departmentId) return null;
  const row = await get(`SELECT u.id, u.name_ar, u.username FROM department d JOIN app_user u ON u.id = d.manager_user_id
      WHERE d.id = ? AND d.deleted_at IS NULL AND u.deleted_at IS NULL`, [departmentId]);
  return row ? { id: row.id, name: row.name_ar || row.username } : null;
}

function effectTable(effect) {
  const rows = (effect || []).filter((m) => m && m.touched !== false);
  if (!rows.length) return `<div class="tm-note">لا أثر محسوب لهذا الطلب بعد قراره.</div>`;
  const cell = (v) => (v == null ? '<span style="color:var(--faint)">—</span>' : `<span class="tnum">${Math.round(N(v))}%</span>`);
  return `<div class="tm-pl-tblwrap"><table class="tm-tbl keep-all" style="font-size:var(--fs-body)"><thead><tr><th>الشهر</th><th>قبل</th><th>بعد الاعتماد</th><th>المتاح بعد</th><th></th></tr></thead><tbody>
    ${rows.map((m) => `<tr${m.conflict ? ' style="background:#fdeaea"' : ''}><td>${esc(m.label_ar || monthLabel(m.key))}</td><td>${cell(m.current)}</td><td>${cell(m.after)}</td><td>${cell(m.availableAfter)}</td>
      <td style="font-size:var(--fs-micro);color:${m.conflict ? '#8a1c1c' : m.outOfEngagement ? 'var(--faint)' : 'var(--green)'}">${m.outOfEngagement ? esc(G.outOfEngagementShort) : m.conflict ? 'سيتجاوز 100%' : 'ضمن الطاقة'}</td></tr>`).join('')}
  </tbody></table></div>`;
}

const ACTION_AR = { approve: 'اعتُمد', reject: 'رُدّ', return: 'أُعيد', cancel: 'أُلغي' };
function approvalsList(r) {
  const steps = [];
  if (r.approval) {
    for (const a of r.approval.actions || []) steps.push({ who: a.actor || '—', what: ACTION_AR[a.action] || a.action, at: a.acted_at, note: a.comment });
    if (r.approval.status === 'PENDING' && r.approval.assignee) steps.push({ who: r.approval.assignee.name || '—', what: 'بانتظار قراره', at: null, note: null, wait: true });
  } else if (r.status === 'pending') {
    steps.push({ who: r.reviewer?.name || 'من يملك أمر المورد', what: 'بانتظار قراره', at: null, note: r.reviewer ? null : (r.note || null), wait: true });
  }
  if (r.decidedBy && !steps.some((s) => s.at === r.decided_at)) steps.push({ who: r.decidedBy.name || '—', what: r.status_ar || r.status, at: r.decided_at, note: r.decision_note || r.reason || null });
  if (!steps.length) return `<div class="tm-note">${r.status === 'draft' ? 'مسودة لم تُرسل بعد — لا موافقات.' : r.status === 'applied' ? 'طُبّق مباشرةً بصلاحية صاحبه.' : 'لا خطوات اعتماد مسجَّلة.'}</div>`;
  return `<div class="tm-list">${steps.map((s) => `<div class="tm-li${s.wait ? '' : ''}"><span><b>${esc(s.who)}</b> — ${esc(s.what)}${s.note ? `<div class="m">${esc(s.note)}</div>` : ''}</span><span class="m tnum" dir="ltr">${esc(day(s.at))}</span></div>`).join('')}</div>`;
}

async function panelHtml(user, r) {
  const manager = await managerOfDepartment(r.employee?.department_id);
  const changed = planChanged(r);
  const target = r.target?.label || '—';
  const targetHref = r.target?.kind === 'project' && r.target?.id ? `/app/project/${encodeURIComponent(r.target.id)}` : null;
  const rows = [
    ['نوع الطلب', esc(r.kind_ar || r.kind || '—')],
    ['الوجهة', `${targetHref ? `<a href="${esc(targetHref)}" style="color:var(--brand)">${esc(target)}</a>` : esc(target)} <span style="color:var(--muted);font-size:var(--fs-micro)">· ${r.target?.kind === 'bucket' ? 'عمل داخلي' : 'مشروع'}</span>`],
    ['المورد', person(r.employee?.name || '—', null, { href: r.employee?.id ? `/app/team/resources/${encodeURIComponent(r.employee.id)}` : null, small: true })],
    [G.resourceDepartment, esc(r.employee?.department_name || 'بلا إدارة مسجَّلة')],
    [G.resourceManager, manager ? esc(manager.name) : '<span style="color:var(--muted)">لا مدير مسجَّل للإدارة</span>'],
    ['الفترة', esc(periodText(r))],
    ['النسبة من طاقة المورد', pctText(r)],
    [G.allocTypeWanted, allocPill(r)],
    ['التصنيف التجاري', r.billable == null ? 'بحسب الوجهة' : r.billable ? 'قابل للفوترة' : 'غير قابل للفوترة'],
    ['الطالب', esc(r.requestedBy?.name || '—')],
    ['المراجع', r.reviewer ? esc(r.reviewer.name || '—') : '<span style="color:var(--muted)">لم يُوجَّه إلى مراجع بعينه</span>'],
    ['تاريخ الطلب', `<span class="tnum" dir="ltr">${esc(day(r.created_at))}</span>`],
  ];
  const notes = [];
  if (changed) notes.push(`<div class="tm-warn" style="margin-bottom:.6rem"><b>${esc(G.planChangedRepreview)}</b><div style="margin-top:.3rem">${esc(r.reason || '')}</div>
    ${r.requestedBy?.id === user.id ? `<div style="margin-top:.4rem"><a class="btn btn-sm" href="${esc(repreviewHref(r))}">أعد المعاينة</a></div>` : ''}</div>`);
  else if (r.reason) notes.push(`<div class="${r.status === 'rejected' ? 'tm-danger' : 'tm-info'}" style="margin-bottom:.6rem"><b>${r.status === 'rejected' ? 'سبب الرفض' : r.status === 'returned' ? 'سبب الإعادة' : 'ملاحظة القرار'}:</b> ${esc(r.reason)}</div>`);
  if (r.note && !changed) notes.push(`<div class="tm-warn" style="margin-bottom:.6rem">${esc(r.note)}</div>`);
  const conflicts = (r.effect || []).filter((m) => m.touched !== false && m.conflict);
  const effectNote = r.effect && r.effect.length
    ? (conflicts.length ? `<div class="tm-danger" style="margin-top:.5rem">تجاوز الطاقة في ${esc(conflicts.map((m) => m.label_ar || monthLabel(m.key)).join('، '))} — يُعرض للمراجع ولا يُعتمد تلقائياً.</div>`
      : `<div class="tm-ok" style="margin-top:.5rem">ضمن الطاقة · لا يوجد تعارض</div>`) : '';
  const actions = [];
  if (r.canDecide) {
    actions.push(`<div class="field" style="margin-top:.8rem"><label for="rq-note">تعليق المراجع</label><textarea id="rq-note" class="input" rows="2" placeholder="يصل التعليق إلى صاحب الطلب"></textarea>
      <div class="tm-note">سبب الإعادة أو الرفض مطلوب — يصل إلى صاحب الطلب ليصحّح.</div></div>
      <div class="tm-actions" style="margin-top:.6rem"><button type="button" class="btn btn-primary" data-action="rq-approve" data-id="${esc(r.id)}">${esc(G.approveBtn)}</button>
      <button type="button" class="btn" data-action="rq-return" data-id="${esc(r.id)}">${esc(G.returnForEdit)}</button>
      <button type="button" class="btn" style="color:var(--red)" data-action="rq-reject" data-id="${esc(r.id)}">${esc(G.rejectBtn)}</button></div>`);
  }
  if (r.canWithdraw) actions.push(`<div class="tm-actions" style="margin-top:.6rem"><button type="button" class="btn" data-action="rq-withdraw" data-id="${esc(r.id)}">${esc(G.withdrawRequest)}</button><span class="tm-note">قبل القرار فقط</span></div>`);
  if (!actions.length && r.status === 'pending') actions.push(`<div class="tm-note" style="margin-top:.6rem">القرار لمن وُجِّه إليه الطلب.</div>`);
  return `<div class="tm-card" id="rq-panel"><div class="tm-card-h"><div><div class="tm-card-t">مراجعة طلب ${esc(r.employee?.name || '')}</div><div class="tm-card-s">${esc(r.kind_ar || '')} · ${statusPill(r)}</div></div></div>
    <div class="tm-card-b">${notes.join('')}${kv(rows)}
      <div style="font-weight:800;color:var(--ink2);margin:.9rem 0 .3rem">الأثر بعد الاعتماد</div>${effectTable(r.effect)}${effectNote}
      <div style="font-weight:800;color:var(--ink2);margin:.9rem 0 .3rem">الموافقات</div>${approvalsList(r)}
      ${actions.join('')}<div id="rq-msg" aria-live="polite" style="margin-top:.5rem"></div></div></div>`;
}

const STYLE = `<style>
  .tm-rq-grid{display:grid;grid-template-columns:3fr 2fr;gap:1rem;align-items:start}
  @media (max-width:960px){.tm-rq-grid{grid-template-columns:1fr}}
  .tm-rq-filters{display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end;padding:.8rem 1rem;border-bottom:1px solid var(--line)}
  .tm-rq-filters .field{display:grid;gap:.25rem}.tm-rq-filters .field>label{font-size:var(--fs-micro);color:var(--muted);font-weight:700}
  .tm-rq-filters .input{padding:.45rem .6rem}.tm-rq-filters .grow{flex:1 1 180px}
  .tm-rq-chips{display:flex;gap:.4rem;flex-wrap:wrap;padding:.8rem 1rem 0}
  .tm-rq-chips a{border:1px solid var(--line);border-radius:999px;padding:.3rem .8rem;font-size:var(--fs-body);color:var(--ink2);text-decoration:none;background:var(--surface)}
  .tm-rq-chips a.on{background:var(--brand);border-color:transparent;color:#fff;font-weight:700}
  .tm-rq-chips a .n{display:inline-block;min-width:1.4em;text-align:center;border-radius:999px;background:#fff4e0;color:var(--amber);font-weight:800;font-size:var(--fs-micro);padding:0 .35rem;margin-inline-start:.3rem}
  .tm-rq-chips a.on .n{background:rgba(255,255,255,.25);color:#fff}
  .tm-rq-wrap{overflow-x:auto}
  .tm-rq-wrap .tm-tbl td,.tm-rq-wrap .tm-tbl th{white-space:nowrap}
  .tm-rq-wrap .tm-tbl td.who{white-space:normal;min-width:180px}
  .tm-rq-wrap .tm-tbl a.row-link{color:inherit;text-decoration:none;display:block}
  .tm-rq-foot{padding:.6rem 1rem;font-size:var(--fs-micro);color:var(--muted);border-top:1px solid var(--line)}
</style>`;

export async function requestsPage(user, opts = {}) {
  const filter = FILTERS.some(([k]) => k === opts.filter) ? opts.filter : 'all';
  const q = String(opts.q || '').trim();
  const from = parseMonthKey(opts.from) ? String(opts.from).trim() : '';
  const to = parseMonthKey(opts.to) ? String(opts.to).trim() : '';
  const selectedId = String(opts.id || '').trim();
  const crumbs = [{ label: G.requestsTab, href: '/app/team/requests' }];
  const subtitle = 'مراجعة واعتماد طلبات التسكين على موارد الفريق.';

  let list; let denied = null;
  try { list = await listRequests(user, { filter, q, from: from || undefined, to: to || undefined }); } catch (e) { if (e && e.status === 403) denied = e.message; else throw e; }
  if (denied) {
    return teamLayout({ user, path: 'planning', section: 'requests', title: G.requestsTab, subtitle, crumbs, year: opts.year,
      body: `<div class="tm-card">${emptyState('لا تملك صلاحية عرض طلبات التسكين', denied)}</div>` });
  }
  const pendingCount = filter === 'pending_my_decision' ? list.total : (await listRequests(user, { filter: 'pending_my_decision' })).total;

  let selected = null; let selectedErr = null;
  if (selectedId) {
    try { selected = await getRequest(user, selectedId); } catch (e) { if (e && (e.status === 403 || e.status === 404)) selectedErr = e.message; else throw e; }
  }

  const qs = (extra = {}) => {
    const p = new URLSearchParams();
    const f = extra.filter ?? filter; if (f && f !== 'all') p.set('filter', f);
    if (q) p.set('q', q); if (from) p.set('from', from); if (to) p.set('to', to);
    const s = p.toString(); return s ? `?${s}` : '';
  };
  const chips = `<div class="tm-rq-chips" role="tablist" aria-label="تصفية الطلبات">${FILTERS.map(([k, label]) => `<a role="tab" href="/app/team/requests${qs({ filter: k })}" class="${k === filter ? 'on' : ''}"${k === filter ? ' aria-current="page"' : ''}>${esc(label)}${k === 'pending_my_decision' ? ` <span class="n tnum">(${pendingCount})</span>` : ''}</a>`).join('')}</div>`;
  const filtersForm = `<form class="tm-rq-filters" id="rq-filters" method="get" action="/app/team/requests" role="search" aria-label="بحث الطلبات">
    ${filter !== 'all' ? `<input type="hidden" name="filter" value="${esc(filter)}">` : ''}
    <div class="field grow"><label for="rq-q">بحث</label><input class="input" type="search" id="rq-q" name="q" value="${esc(q)}" placeholder="اسم المورد أو المشروع…"></div>
    <div class="field"><label for="rq-from">من شهر</label><input class="input" type="month" id="rq-from" name="from" value="${esc(from)}"></div>
    <div class="field"><label for="rq-to">إلى شهر</label><input class="input" type="month" id="rq-to" name="to" value="${esc(to)}"></div>
    <noscript><button type="submit" class="btn">بحث</button></noscript>
  </form>`;

  const rows = list.rows || [];
  const rowHtml = (r) => {
    const href = `/app/team/requests/${encodeURIComponent(r.id)}${qs()}`;
    return `<tr class="tm-row-click${r.id === selectedId ? ' is-sel' : ''}" data-action="rq-open" data-href="${esc(href)}" tabindex="0">
      <td class="who"><a class="row-link" href="${esc(href)}">${person(r.employee?.name || '—', r.employee?.department_name || null, { small: true })}</a></td>
      <td>${esc(r.target?.label || '—')}<div style="font-size:var(--fs-micro);color:var(--muted)">${esc(r.kind_ar || '')}</div></td>
      <td>${esc(periodText(r))}</td><td>${pctText(r)}</td><td>${allocPill(r)}</td><td>${statusPill(r)}</td>
      <td style="font-size:var(--fs-meta)">${esc(r.requestedBy?.name || '—')}</td><td style="font-size:var(--fs-meta)">${esc(r.reviewer?.name || '—')}</td></tr>`;
  };
  const emptyList = filter === 'pending_my_decision'
    ? emptyState('لا طلبات بانتظار قرارك', 'كل ما وُجِّه إليك بُتّ فيه — الطلبات الجديدة تصلك هنا وفي التنبيهات.')
    : q || from || to ? emptyState('لا طلبات تطابق البحث', 'جرّب اسماً آخر أو وسّع الفترة.')
      : filter === 'mine' ? emptyState('لم ترفع طلبات بعد', 'يبدأ الطلب من مصفوفة التسكين: اختر مورداً وشهراً ثم عاين الأثر.')
        : emptyState('لا طلبات تسكين ضمن نطاقك', 'يبدأ الطلب من مصفوفة التسكين: اختر مورداً وشهراً ثم عاين الأثر.');
  const table = rows.length
    ? `<div class="tm-rq-wrap"><table class="tm-tbl keep-all" aria-label="طلبات التسكين"><thead><tr><th>المورد</th><th>الوجهة</th><th>الفترة</th><th>النسبة</th><th>النوع</th><th>الحالة</th><th>الطالب</th><th>المراجع</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>
       <div class="tm-rq-foot"><span class="tnum">${rows.length}</span> من الطلبات · الطلبات غير المعتمدة لا تغيّر التسكين المؤكد.</div>`
    : `${emptyList}${filter === 'all' && !q && !from && !to && pagePlanningRights(user).request ? `<div style="text-align:center;padding-bottom:1.2rem"><a class="btn btn-primary" href="/app/team/planning?new=1">${esc(G.newAllocation)}</a></div>` : ''}`;
  const listCard = `<div class="tm-card">${chips}${filtersForm}${table}</div>`;

  let panel;
  if (selected) panel = await panelHtml(user, selected);
  else if (selectedErr) panel = `<div class="tm-card">${emptyState('تعذّر فتح الطلب', selectedErr)}</div>`;
  else panel = `<div class="tm-card">${emptyState('اختر طلباً من القائمة', rows.length ? 'تظهر هنا تفاصيله وأثره على طاقة المورد وخطوات اعتماده.' : 'لا طلبات لعرضها بعد.')}</div>`;

  const actions = pagePlanningRights(user).request ? `<a class="btn btn-primary" href="/app/team/planning?new=1">${icon('userplus')} ${esc(G.newAllocation)}</a>` : '';
  const body = `${STYLE}<div class="tm-rq-grid">${listCard}${panel}</div>`;
  return teamLayout({ user, path: 'planning', section: 'requests', title: G.requestsTab, subtitle, crumbs, actions, body, year: opts.year,
    scripts: ['/static/pages/team-requests.js'] });
}

export async function requestDetailPage(user, requestId, opts = {}) {
  return requestsPage(user, { ...opts, id: requestId });
}
