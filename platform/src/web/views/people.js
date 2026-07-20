// People pages: my timesheet, team & staffing (capacity workspace v3), org structure.
import { layout, card, pill } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { myEntries } from '../../modules/timesheets/timesheets.js';
import { orgTree, staffingRoster } from '../../modules/org/org.js';
import { canSeeSensitive, can } from '../../core/rbac/index.js';
import { G } from '../i18n/glossary.js';
import { esc, ddWrap, ddRows } from './_shared.js';

export async function timesheetPage(user) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const rows = await myEntries(user, { from, to });
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
        <input id="ts-date" type="date" value="${to}" aria-label="التاريخ" class="border border-line rounded-lg px-2 py-2 text-sm">
        <input id="ts-hours" type="number" step="0.5" min="0" max="16" placeholder="ساعات" aria-label="عدد الساعات" class="border border-line rounded-lg px-3 py-2 text-sm w-24">
        <select id="ts-kind" aria-label="نوع العمل" class="border border-line rounded-lg px-2 text-sm">
          ${[['project', 'مشروع'], ['opportunity', 'فرصة'], ['proposal', 'عرض'], ['product', 'منتج'], ['internal', 'داخلي'], ['leave', 'إجازة'], ['training', 'تدريب'], ['bd', 'تطوير أعمال']].map(([k, ar]) => `<option value="${k}">${ar}</option>`).join('')}
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

// Capacity workspace v3 — decision-story order: (1) summary band → (2) staffing decisions →
// (3) heat grid (scan layer + cell-edit layer) → (4) expandable per-employee details.
export async function teamPage(user, opts = {}) {
  const canSalary = canSeeSensitive(user, 'salary');
  const canManage = can(user, 'create', 'employee') || can(user, 'update', 'employee');
  const canCreate = can(user, 'create', 'employee');
  const canStaff = can(user, 'update', 'project'); // cell editing goes through project staffing rights
  const allSec = await all('SELECT id, name_ar, color FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const sectorNames = Object.fromEntries(allSec.map((s) => [s.id, s.name_ar]));
  const { year, sector, currentMonth, roster, summary } = await staffingRoster(user, { sector: opts.sector });
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const MSHORT = ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
  const curName = currentMonth ? MONTHS[currentMonth - 1] : 'الشهر الحالي';
  const prevName = currentMonth > 1 ? MONTHS[currentMonth - 2] : 'الشهر الماضي';
  const projects = await all(`SELECT id, name_ar, sector_id FROM project WHERE deleted_at IS NULL AND status IN ('IN_PROGRESS','PLANNED')
     ${sector ? 'AND sector_id = ?' : ''} ORDER BY name_ar`, sector ? [sector] : []);

  const activeR = roster.filter((e) => e.active !== 0);
  const cellBg = (v) => v === 0 ? '#eef1f7' : v > 105 ? '#dc2626' : v >= 80 ? '#059669' : v >= 40 ? '#f59e0b' : '#bfdbfe';
  const cellFg = (v) => v === 0 ? '#94a3b8' : v > 105 || v >= 80 ? '#fff' : v >= 40 ? '#7c2d12' : '#1e40af';
  const uTone = (u) => u > 105 ? 'var(--red)' : u >= 80 ? 'var(--green)' : u >= 40 ? 'var(--amber)' : u > 0 ? 'var(--blue)' : 'var(--faint)';
  const fte = (v) => String(Math.round((v || 0) * 100) / 100);
  const pctAssigned = summary.capacityFte ? Math.round((summary.assignedNowFte / summary.capacityFte) * 100) : 0;

  // ── (1) summary band: 5 tiles + drill-downs ──
  const tile = (label, val, sub, o = {}) => card(`<div ${o.dd ? `role="button" tabindex="0" data-dd="${o.dd}" onkeydown="if(event.key==='Enter'||event.key===' ')Sanad.openDD('${o.dd}')"` : ''} style="padding:.8rem 1rem;${o.dd ? 'cursor:pointer' : ''}" class="${o.dd ? 'cardclick' : ''}">
    <div style="font-size:11px;color:var(--muted)">${label}${o.dd ? ' <span style="color:var(--faint)">⊕</span>' : ''}</div>
    <div class="metric tnum" style="font-size:1.35rem;${o.tone ? 'color:' + o.tone : ''}">${val}</div>
    ${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const nameRow = (e, right) => `<div class="dd-row"><span>${esc(e.name_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(e.job_title || '—')}</span></span><b class="tnum">${right}</b></div>`;
  const dds = [
    ddWrap('bench', G.onBench, `${curName} — بلا أي تسكين أو فرصة`, ddRows(activeR.filter((e) => e.currentUtil === 0).map((e) => nameRow(e, '0%')))),
    ddWrap('over', G.overloaded, `${curName} — تجاوز 110% من الطاقة`, ddRows(activeR.filter((e) => e.currentUtil > 110).map((e) => nameRow(e, e.currentUtil + '%')))),
    ddWrap('under', G.underused, `${curName} — أقل من 40% من الطاقة`, ddRows(activeR.filter((e) => e.currentUtil > 0 && e.currentUtil < 40).map((e) => nameRow(e, e.currentUtil + '%')))),
  ].join('');
  const band = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem;margin-bottom:1rem">
    ${tile(G.capacity, summary.capacityFte, 'موظف نشط')}
    ${tile('مُسكَّن الآن', pctAssigned + '%', `${fte(summary.assignedNowFte)} من ${summary.capacityFte} طاقة كاملة · ${curName}`, { tone: uTone(pctAssigned) })}
    ${tile(G.onBench, summary.benchNow, `بلا تسكين في ${curName}`, { dd: 'bench', tone: summary.benchNow ? 'var(--amber)' : 'var(--green)' })}
    ${tile(G.overloaded, summary.overloadedNow, `تجاوز 110% في ${curName}`, { dd: 'over', tone: summary.overloadedNow ? 'var(--red)' : 'var(--green)' })}
    ${tile(G.underused, summary.underusedNow, `1–39% في ${curName}`, { dd: 'under', tone: summary.underusedNow ? 'var(--blue)' : 'var(--green)' })}
  </div>`;

  // ── (2) staffing decisions needed (≤6): overloaded first, then bench — each with an action ──
  const needs = [
    ...activeR.filter((e) => e.currentUtil > 110).map((e) => ({ kind: 'over', e })),
    ...activeR.filter((e) => e.currentUtil === 0).map((e) => ({ kind: 'bench', e })),
  ].slice(0, 6);
  const needRow = ({ kind, e }) => {
    const projTxt = e.projects.filter((p) => Math.round((Number(p.months[currentMonth]) || 0) * 100) > 0)
      .map((p) => `${esc(p.name)} <span class="tnum">${Math.round((Number(p.months[currentMonth]) || 0) * 100)}%</span>`).join(' · ');
    const oppTxt = e.opportunities.map((o) => `${esc(o.name)} <span class="tnum">${o.pct}%</span> (${G.opportunity})`).join(' · ');
    const detail = kind === 'over'
      ? [projTxt, oppTxt].filter(Boolean).join(' · ') || 'تسكين متراكم'
      : 'اقتراح: خصّصه على مشروع نشط';
    return `<div class="attn">
      <span class="ic" style="background:${kind === 'over' ? '#fee2e2;color:#dc2626' : '#fef3c7;color:#b45309'}">${kind === 'over' ? '⚠' : '◔'}</span>
      <span class="tx"><span class="h">${esc(e.name_ar)} — <span class="tnum">${e.currentUtil}%</span> ${kind === 'over' ? G.overloaded : G.onBench}</span>
      <span class="s" style="display:block">${detail}</span></span>
      ${canManage ? `<span class="go"><button class="btn btn-sm" data-action="assign" data-emp="${e.id}">${kind === 'over' ? 'أعد التوزيع' : 'خصص الآن'}</button></span>` : ''}
    </div>`;
  };
  const needsCard = card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.5rem">
      <span style="font-weight:800;font-size:13px">يحتاج قرار تسكين</span>
      <span class="pill" style="background:${needs.length ? '#fef3c7;color:#b45309' : '#dcfce7;color:#059669'}">${needs.length || 'صفر'}</span></div>
    <div style="padding:.7rem 1rem;display:flex;flex-direction:column;gap:.5rem">
      ${needs.map(needRow).join('') || `<div class="alert ok">✓ ${G.nothingNeedsYou} — الطاقة موزّعة ضمن الحدود هذا الشهر</div>`}
    </div>`);

  // ── (3) heat grid: rows = employees (busiest now first), columns = 12 months LTR ──
  const gridCols = `260px ${canSalary ? '110px ' : ''}64px 64px minmax(430px,1fr) 40px`;
  const headMonths = MSHORT.map((m, i) => `<span class="hg-mh tnum ${i + 1 === currentMonth ? 'cur' : ''}" data-m="${i + 1}">${m}</span>`).join('');
  const deltaHtml = (d) => d > 0 ? `<span class="tnum" style="color:var(--ink2);font-weight:700" title="زاد عن ${esc(prevName)}">▲${d}</span>`
    : d < 0 ? `<span class="tnum" style="color:var(--muted);font-weight:700" title="انخفض عن ${esc(prevName)}">▼${-d}</span>`
    : '<span style="color:var(--faint)">—</span>';
  const rangeLabel = (months) => {
    const ks = Object.keys(months).map(Number).filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
    if (!ks.length) return 'بلا أشهر مجدولة';
    const pcts = [...new Set(ks.map((m) => Math.round((Number(months[m]) || 0) * 100)))];
    const span = ks.length === 1 ? MONTHS[ks[0] - 1] : `${MONTHS[ks[0] - 1]} – ${MONTHS[ks[ks.length - 1] - 1]}`;
    return `${span} · ${ks.length} شهر · ${pcts.length === 1 ? `<span class="tnum">${pcts[0]}%</span>` : `<span class="tnum">${Math.min(...pcts)}–${Math.max(...pcts)}%</span>`}`;
  };
  const gridRows = roster.map((e) => {
    const cells = e.months.map((v, i) => {
      const m = i + 1; const over = v > 105;
      return `<button type="button" class="hg-cell tnum ${m === currentMonth ? 'cur' : ''}" data-emp="${e.id}" data-m="${m}" data-v="${v}"
        style="background:${cellBg(v)};color:${cellFg(v)}" aria-label="${esc(e.name_ar)} — ${MONTHS[i]}: ${v}%${over ? ' فوق الطاقة' : ''}">${v > 0 ? v : ''}${over ? '<span class="w" aria-hidden="true">⚠</span>' : ''}</button>`;
    }).join('');
    const detailProjects = e.projects.map((p) => `<div class="dd-row">
        <span>${p.projectId ? `<a href="/app/project/${p.projectId}" style="color:var(--brand2);font-weight:700">${esc(p.name)}</a>` : esc(p.name)}
          ${pill(p.type === 'lead' ? 'قائد' : p.type === 'advisor' ? 'مستشار' : 'عضو', p.type === 'lead' ? 'blue' : 'slate')}</span>
        <b style="font-weight:600;color:var(--muted);font-size:11.5px">${rangeLabel(p.months)}</b></div>`).join('');
    const detailOpps = e.opportunities.map((o) => `<div class="dd-row">
        <span>${esc(o.name)} ${pill(o.label, 'violet')}</span>
        <b style="font-weight:600;color:var(--muted);font-size:11.5px">${curName} · <span class="tnum">${o.pct}%</span> (حمل مبدئي)</b></div>`).join('');
    return `<div class="hg-row" data-emp="${e.id}" data-name="${esc(String(e.name_ar || '').toLowerCase())} ${esc(String(e.job_title || '').toLowerCase())}">
      <div class="hg-meta"><b>${esc(e.name_ar)}</b>${e.active === 0 ? ' ' + pill('غير نشط', 'slate') : ''}
        <div class="sub">${esc(e.job_title || '—')}${sector ? '' : ' · ' + esc(sectorNames[e.sector_id] || '—')}</div></div>
      ${canSalary ? `<div class="emp-sal tnum">${e.salary_halalas ? fmtSar(e.salary_halalas) : '<span style="color:var(--faint)">—</span>'}</div>` : ''}
      <div class="hg-now tnum" style="color:${uTone(e.currentUtil)}" title="إشغال ${esc(curName)}">${e.currentUtil}%</div>
      <div class="hg-delta">${deltaHtml(e.monthDelta)}</div>
      <div class="hg-months">${cells}</div>
      <div class="hg-x"><button type="button" class="btn btn-ghost btn-sm" data-action="expand" data-emp="${e.id}" aria-expanded="false" aria-label="تفاصيل ${esc(e.name_ar)}">⌄</button></div>
    </div>
    <div class="hg-detail" data-detail="${e.id}" hidden>
      <div style="font-size:11px;font-weight:800;color:var(--muted);margin-bottom:.3rem">تسكين ${esc(e.name_ar)} — ${e.projectCount} مشروع${e.opportunities.length ? ` + ${e.opportunities.length} ${G.opportunity}` : ''}</div>
      ${detailProjects || `<div style="color:var(--faint);font-size:12px;padding:.2rem 0">لا مشاريع مُسكَّنة هذه السنة</div>`}
      ${detailOpps}
      ${canManage ? `<div style="display:flex;gap:.4rem;margin-top:.5rem">
        <button class="btn btn-sm" data-action="assign" data-emp="${e.id}">${icon('userplus')} تسكين على مشروع</button>
        <button class="btn btn-sm btn-ghost" data-action="edit-emp" data-emp="${e.id}">✎ تعديل الموظف</button></div>` : ''}
    </div>`;
  }).join('');
  const legend = `<div style="display:flex;gap:.85rem;flex-wrap:wrap;font-size:10.5px;color:var(--muted);align-items:center">
    ${[['#eef1f7', 'بلا تسكين 0%'], ['#bfdbfe', 'منخفض 1–39%'], ['#f59e0b', 'متوسط 40–79%'], ['#059669', 'صحي 80–105%'], ['#dc2626', 'فوق الطاقة >105% ⚠']]
    .map(([c, l]) => `<span style="display:inline-flex;align-items:center;gap:.3rem"><span style="width:10px;height:10px;border-radius:3px;background:${c}"></span>${l}</span>`).join('')}
    <span style="display:inline-flex;align-items:center;gap:.3rem"><span style="width:10px;height:10px;border-radius:3px;background:#fff;box-shadow:0 0 0 2px var(--ink2)"></span>${curName} (الحالي)</span>
  </div>`;
  const qBtn = (q, lbl) => `<button data-action="zoom" data-q="${q}" class="${q === 0 ? 'on' : ''}">${lbl}</button>`;
  const gridCard = card(`
    <div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
      <span style="font-weight:800;font-size:13px">خريطة الطاقة الشهرية — ${year}</span>
      <div class="seg" role="group" aria-label="نطاق العرض">${qBtn(0, 'السنة')}${qBtn(1, 'ر1')}${qBtn(2, 'ر2')}${qBtn(3, 'ر3')}${qBtn(4, 'ر4')}</div>
      <div class="search">${icon('search')}<input class="input" id="staff-q" aria-label="بحث بالاسم أو الدور" placeholder="ابحث بالاسم أو الدور…"></div>
      <div class="spacer"></div>
      ${canStaff ? `<span style="font-size:10.5px;color:var(--muted)">انقر أي خلية لتعديل تسكين ذلك الشهر</span>` : ''}
    </div>
    <div style="padding:.55rem 1rem;border-bottom:1px solid var(--line)">${legend}</div>
    <div class="tblwrap"><div class="hg" id="hg" data-zoom="0" style="--cols:${gridCols}">
      <div class="hg-row hg-head">
        <div class="hg-meta">الموظف</div>
        ${canSalary ? '<div class="emp-sal">الراتب</div>' : ''}
        <div class="hg-now" title="إشغال ${esc(curName)}">الآن</div>
        <div class="hg-delta" title="التغير عن ${esc(prevName)}">التغير</div>
        <div class="hg-months">${headMonths}</div>
        <div class="hg-x"></div>
      </div>
      ${gridRows || `<div class="empty-state">${icon('team')}<div class="t">لا أعضاء ضمن نطاقك</div><div class="s">أضِف موظفين من زر «إضافة موظف» بالأعلى أو راجع صلاحياتك.</div></div>`}
    </div></div>`);

  const secChips = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    <a href="/app/team" class="chip ${sector ? '' : 'on'}">${G.all}</a>
    ${allSec.map((s) => `<a href="/app/team?sector=${s.id}" class="chip ${sector === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || '#2563eb'}"></span>${esc(s.name_ar)}</a>`).join('')}
  </div>` : '';

  const style = `<style>
    .hg{min-width:860px}
    .hg-row{display:grid;grid-template-columns:var(--cols);align-items:center;gap:.6rem;padding:.4rem 1rem;border-bottom:1px solid var(--line)}
    .hg-row.hg-head{position:sticky;top:0;background:var(--surface);z-index:2;font-size:10.5px;color:var(--muted);font-weight:700;padding-block:.45rem}
    .hg-meta b{font-size:13px}
    .hg-meta .sub{font-size:10.5px;color:var(--muted)}
    ${canSalary ? '.emp-sal{font-size:12px}' : ''}
    .hg-now{font-weight:800;font-size:13.5px}
    .hg-delta{font-size:11.5px}
    .hg-months{display:grid;grid-template-columns:repeat(12,1fr);gap:3px;direction:ltr}
    .hg-mh{text-align:center;font-weight:700}
    .hg-mh.cur{color:var(--ink2);text-decoration:underline}
    .hg-cell{position:relative;border:none;height:26px;border-radius:5px;font-size:10.5px;font-weight:700;cursor:pointer;padding:0;font-family:inherit;transition:transform .1s}
    .hg-cell:hover{transform:scale(1.06);z-index:1;box-shadow:var(--sh)}
    .hg-cell:focus-visible{outline:2px solid var(--brand);outline-offset:1px;z-index:1}
    .hg-cell.cur{box-shadow:0 0 0 2px var(--ink2)}
    .hg-cell .w{font-size:8.5px;position:absolute;top:1px;inset-inline-end:2px}
    .hg[data-zoom]:not([data-zoom="0"]) .hg-cell{height:40px;font-size:13px}
    .hg[data-zoom]:not([data-zoom="0"]) .hg-months{grid-template-columns:repeat(3,1fr)}
    .hg-detail{padding:.6rem 1.2rem .8rem;background:var(--bg);border-bottom:1px solid var(--line)}
    .hg-pop{position:absolute;z-index:70;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh);width:300px;max-width:92vw}
  </style>`;

  const body = `
    ${style}${secChips}
    <div class="toolbar" style="margin-bottom:.8rem">
      <div style="font-weight:800;font-size:14px">${sector ? esc(sectorNames[sector]) : 'كل القطاعات'} · ${roster.length} عضو</div>
      <div class="spacer"></div>
      ${canManage ? pill('لديك صلاحية إدارة الفريق', 'green') : pill('عرض فقط', 'slate')}
      ${canCreate ? `<button class="btn btn-primary" onclick="Sanad.empAdd()">${icon('plus')} إضافة موظف</button>` : ''}
    </div>
    ${band}
    <div style="margin-bottom:1rem">${needsCard}</div>
    ${gridCard}
    <div style="font-size:10.5px;color:var(--faint);margin-top:.55rem">المصدر: نموذج التسكين المخطط (وليس ساعات فعلية). «${G.opportunity}» = حمل مبدئي من فريق فرصة مفتوحة يُحتسب على ${curName} فقط. «التغير» = فرق إشغال ${curName} عن ${prevName}. الترتيب: الأكثر إشغالًا الآن أولًا.</div>
    ${dds}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      emps:${JSON.stringify(Object.fromEntries(roster.map((e) => [e.id, {
        name_ar: e.name_ar, job_title: e.job_title, employment_type: e.employment_type, status: e.status,
        active: e.active, sector_id: e.sector_id, salary_sar: canSalary ? Math.round((e.salary_halalas || 0) / 100) : null,
        months: e.months, currentUtil: e.currentUtil,
        projects: e.projects.map((p) => ({ allocId: p.allocId, name: p.name, projectId: p.projectId,
          months: Object.fromEntries(Object.entries(p.months).map(([m, f]) => [m, Math.round((Number(f) || 0) * 100)])) })),
        opps: e.opportunities.map((o) => ({ name: o.name, pct: o.pct })),
      }]))).replace(/</g, '\\u003c')},
      teamSectors:${JSON.stringify(allSec.map((s) => ({ id: s.id, name_ar: s.name_ar }))).replace(/</g, '\\u003c')},
      teamProjects:${JSON.stringify(projects.map((p) => ({ id: p.id, name_ar: p.name_ar, sector_id: p.sector_id }))).replace(/</g, '\\u003c')},
      canSalary:${canSalary}, canManage:${canManage}, canStaff:${canStaff}, currentMonth:${currentMonth},
      monthNames:${JSON.stringify(MONTHS)}, teamSectorLocked:${JSON.stringify(sector)}});</script>`;
  return layout({ user, active: 'team', title: 'الفريق والتسكين', subtitle: `مساحة قرارات الطاقة والتسكين · ${curName} ${year}`, body,
    scripts: ['/static/pages/staffing.js'] });
}

export async function orgPage(user) {
  const tree = await orgTree(user);
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
