// ── S12 — العمل والالتزامات على مستوى الفريق ─────────────────────────────────────────────────────
//
// «عرض حسب العمل وعرض حسب المورد، مع فترة وإدارة. يُجمّع المشروع أو المنتج أو الفرصة مع الفريق
//  والتسكين والالتزام القادم والعوائق… عدّ المهمة على مستوى الفريق مرة واحدة» — الموجّه S12.
//
// الأرقام كلها من `teamCommitments` (T23: المهمة مرةً واحدة — لها مسؤولٌ واحد وجهةٌ واحدة؛ ولا مال).
// شريط الملخص يُحسب هنا من الصفوف المعروضة نفسها، فما يُقرأ في الأعلى هو ما يُعدّ في الأسفل تحت
// التصفية ذاتها. التصفية (السنة، الشهر، الإدارة، وجه العرض) تُقرأ من الرابط وتُكتب إليه؛ وتوسيع
// العمل بـ<details> الأصلية يعمل بلا جافاسكربت. «لا مهام مسجلة» تُقال باسمها ولا تُقرأ عبئاً منخفضاً.
import { all } from '../../../core/db/index.js';
import { teamCommitments } from '../../../modules/team/commitments.js';
import { resourceScopeSql } from '../../../modules/team/access.js';
import { bandOf, monthKey } from '../../../modules/team/capacity-model.js';
import { MONTHS_AR } from '../../../core/i18n/time.js';
import { countAr } from '../../../core/i18n/plural.js';
import { G } from '../../i18n/glossary.js';
import { teamLayout, person, avatar, pctChip, emptyState, esc, pill, icon } from './_shell.js';

const N = (v) => Number(v) || 0;
const ph = (arr) => arr.map(() => '?').join(',');
// نوع العمل بالعربية دائماً — والمفتاح الذي لا نعرفه لا يُطبع خاماً.
const KIND_AR = { project: 'مشروع', bucket: 'عمل داخلي', opportunity: 'فرصة', internal: 'مهام بلا جهة', other: 'عمل غير مصنَّف' };
const KIND_ICON = { project: 'projects', bucket: 'list', opportunity: 'opportunity', internal: 'tasks', other: 'tasks' };
const kindAr = (k) => KIND_AR[k] || 'عمل';
// مفتاح العمل كما تبنيه الخدمة — به تتصالح أعداد الوجهين.
const workKey = (w) => (w && w.kind === 'internal' ? 'internal:' : `${(w && w.kind) || 'other'}:${(w && w.id) || ''}`);
const PROJECT_TONE = { IN_PROGRESS: 'blue', ACTIVE: 'blue', ON_HOLD: 'amber', COMPLETED: 'green', CLOSED: 'green', CANCELLED: 'slate', NOT_STARTED: 'slate', PLANNED: 'slate' };
const TASK_TONE = { BLOCKED: 'red', IN_PROGRESS: 'blue', IN_REVIEW: 'violet', TODO: 'slate' };
const TASKS = { one: 'مهمة واحدة', two: 'مهمتان', few: 'مهام', many: 'مهمة', zero: 'لا مهام' };
const BLOCKERS = { one: 'عائق واحد', two: 'عائقان', few: 'عوائق', many: 'عائقاً', zero: 'لا عوائق' };
const RES = { one: 'مورد واحد', two: 'موردان', few: 'موارد', many: 'مورداً', zero: 'لا موارد' };
const countTnum = (n, forms) => {
  const s = countAr(N(n), forms);
  const m = s.match(/^(\d+)\s+([\s\S]*)$/);
  return m ? `<span class="tnum">${m[1]}</span> ${esc(m[2])}` : esc(s);
};
const addMonths = (key, n) => {
  const [y, m] = String(key).split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
};
// «8 سبتمبر» — والسنة تُذكر حين تخالف سنة الفترة المعروضة.
const dayLabel = (iso, year) => {
  if (!iso) return '';
  const y = Number(String(iso).slice(0, 4)); const m = Number(String(iso).slice(5, 7)); const d = Number(String(iso).slice(8, 10));
  return `<span class="tnum">${d}</span> ${esc(MONTHS_AR[m - 1] || '')}${y !== year ? ` <span class="tnum">${y}</span>` : ''}`;
};
const profileHref = (id) => `/app/team/resources/${encodeURIComponent(id)}`;

// إدارات التصفية = إدارات نطاق القارئ نفسه (الشرط الذي تبني به الخدمة صفوفها) — لا خيارٌ سيُرفض.
async function departmentOptions(user) {
  const sc = resourceScopeSql(user, 'e');
  if (sc.clause === '1=0') return [];
  const where = ['d.deleted_at IS NULL']; const params = [];
  if (sc.sector) { where.push('d.sector_id = ?'); params.push(sc.sector); }
  if (sc.departments && sc.departments.length) { where.push(`d.id IN (${ph(sc.departments)})`); params.push(...sc.departments); }
  return all(`SELECT d.id, d.name_ar, s.name_ar sector_name FROM department d JOIN sector s ON s.id = d.sector_id
      WHERE ${where.join(' AND ')} ORDER BY s.sort_order, s.name_ar, d.name_ar`, params);
}

// ── الملخص من الصفوف المعروضة نفسها ─────────────────────────────────────────────────────────────
function summarize(data) {
  const rows = data.rows || [];
  const works = new Set(); const engaged = new Set();
  let tasks = 0; let blocked = 0; let late = 0;
  const tally = (t) => { tasks++; if (t.blocked) blocked++; if (t.late) late++; };
  if (data.by === 'work') {
    for (const r of rows) {
      works.add(workKey(r.work));
      for (const m of r.team || []) engaged.add(m.employeeId);
      for (const t of r.tasks || []) { tally(t); if (t.assignee && t.assignee.employeeId) engaged.add(t.assignee.employeeId); }
    }
  } else {
    for (const r of rows) {
      for (const w of r.works || []) works.add(workKey(w));
      for (const t of r.tasks || []) { tally(t); works.add(workKey(t.work)); }
      if ((r.works || []).length || (r.tasks || []).length) engaged.add(r.resource.employeeId);
    }
  }
  return { works: works.size, engaged: engaged.size, resources: N(data.counts && data.counts.resources), tasks, blocked, late };
}

function kpis(s, periodLabel) {
  const k = (label, v, sub, key, tone = '') => `<div class="tm-kpi"><div class="l">${esc(label)}</div><div class="v tnum${tone}" data-kpi="${key}">${v}</div><div class="s">${sub}</div></div>`;
  return `<div class="tm-kpis" aria-label="ملخص ${esc(periodLabel)}">
    ${k('الأعمال', s.works, 'مشاريع وبنود وفرص لها فريق أو مهام', 'works')}
    ${k('الموارد ضمن النطاق', s.resources, `منهم <span class="tnum">${s.engaged}</span> على عمل أو مهمة هذا الشهر`, 'resources')}
    ${k(G.openTasks, s.tasks, s.tasks ? (s.late ? `منها <span class="tnum">${s.late}</span> متأخرة عن موعدها` : 'لا تأخير عن المواعيد') : esc(G.noTasksRecorded), 'tasks', s.late ? ' is-warn' : '')}
    ${k(G.blockedTasks, s.blocked, s.blocked ? 'تحتاج متابعة' : 'لا عوائق مسجلة', 'blocked', s.blocked ? ' is-bad' : '')}
  </div>`;
}

// ── التصفية: كلها في الرابط ─────────────────────────────────────────────────────────────────────
function filters({ period, by, department, deps }) {
  const years = [...new Set([period.year - 1, period.year, period.year + 1, new Date().getUTCFullYear()])].sort((a, b) => a - b);
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const viewHref = (b) => {
    const p = new URLSearchParams();
    p.set('year', String(period.year)); p.set('month', String(period.month));
    if (department) p.set('department', department);
    p.set('by', b);
    return `/app/team/work?${p.toString()}`;
  };
  const seg = (b, label) => `<a href="${esc(viewHref(b))}" class="${by === b ? 'on' : ''}"${by === b ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  return `<form id="tm-work-filters" class="tm-work-filters" method="get" action="/app/team/work">
    <input type="hidden" name="by" value="${esc(by)}">
    <label class="tm-work-f"><span>السنة</span><select class="input" name="year" data-auto="1">${years.map((y) => opt(y, `سنة ${y}`, y === period.year)).join('')}</select></label>
    <label class="tm-work-f"><span>الشهر</span><select class="input" name="month" data-auto="1">${MONTHS_AR.map((m, i) => opt(i + 1, m, i + 1 === period.month)).join('')}</select></label>
    <label class="tm-work-f"><span>الإدارة</span><select class="input" name="department" data-auto="1"><option value=""${department ? '' : ' selected'}>كل الإدارات</option>${deps.map((d) => opt(d.id, `${d.name_ar} — ${d.sector_name}`, d.id === department)).join('')}</select></label>
    <button class="btn btn-sm" type="submit" id="tm-work-apply">تطبيق</button>
    <span class="tm-work-sp"></span>
    <div class="seg tm-work-seg" role="group" aria-label="وجه العرض">${seg('work', G.byWork)}${seg('resource', G.byResource)}</div>
  </form>`;
}

// ── خلايا مشتركة ─────────────────────────────────────────────────────────────────────────────────
function teamCell(team) {
  if (!team.length) return '<span class="tm-work-muted">بلا تسكين هذا الشهر</span>';
  const shown = team.slice(0, 5); const rest = team.length - shown.length;
  return `<div class="tm-work-team">${shown.map((m) => `<span class="tm-work-av" role="img" aria-label="${esc(m.name)}" title="${esc(`${m.name} — ${Math.round(N(m.pct))}% ${m.status_ar || ''}`)}">${avatar(m.name, { small: true })}</span>`).join('')}${rest > 0 ? `<span class="tm-work-avmore">+<span class="tnum">${rest}</span></span>` : ''}<span class="tm-work-teamn">${countTnum(team.length, RES)}</span></div>`;
}
// «130% = 1.3 دوام كامل»: النسبة مجموعُ نسب طاقة الأعضاء، والدوام الكامل من الخدمة يراعي طاقة كل مورد.
function allocCell(r) {
  const c = N(r.confirmedPct); const t = N(r.tentativePct);
  if (!c && !t) return '<span class="tm-work-muted">بلا تسكين مؤكد</span>';
  return `<div><b class="tnum">${Math.round(c)}%</b> <span class="m">= <span class="tnum">${N(r.confirmedFte)}</span> دوام كامل</span>${t ? `<div class="m">+ <span class="tnum">${Math.round(t)}%</span> مبدئي</div>` : ''}</div>`;
}
function nextCell(nc, year) {
  if (!nc || !nc.due) return '<span class="tm-work-muted">لا التزام مؤرَّخ</span>';
  return `<div class="tm-work-next">${icon('clock')}<span>${dayLabel(nc.due, year)} · ${esc(nc.title || '')}${nc.late ? ` ${pill('متأخر', 'red')}` : ''}</span></div>`;
}
function followCell(r, { hasAccount = true } = {}) {
  const b = (r.blockers || []).length; const n = N(r.taskCount); const late = N(r.lateCount);
  if (b) return pill(`${countTnum(b, BLOCKERS)} — تحتاج متابعة`, 'red');
  if (!n) return `<span class="tm-work-muted">${esc(hasAccount ? G.noTasksRecorded : G.noAccountNoTasks)}</span>`;
  if (late) return pill(`<span class="tnum">${late}</span> متأخرة من <span class="tnum">${n}</span>`, 'amber');
  return pill(`${countTnum(n, TASKS)} جارية`, 'blue');
}
function taskRows(tasks, { showWork, year }) {
  return tasks.map((t) => {
    const a = t.assignee || {};
    const who = a.employeeId
      ? person(a.name || 'مورد بلا اسم', '', { href: profileHref(a.employeeId), small: true })
      : person(a.name || 'حساب بلا مورد', '', { small: true });
    const work = t.work || {};
    return `<tr class="tm-work-task" data-task="${esc(t.id)}">
      <td><a class="tm-work-tlink" href="/app/tasks?open=${encodeURIComponent(t.id)}">${esc(t.title || 'مهمة بلا عنوان')}</a>${t.next_step ? `<div class="m">الخطوة التالية: ${esc(t.next_step)}</div>` : ''}</td>
      ${showWork ? `<td>${esc(work.label || kindAr(work.kind))}<div class="m">${esc(kindAr(work.kind))}</div></td>` : `<td>${who}</td>`}
      <td>${t.due ? `${dayLabel(t.due, year)}${t.late ? ` ${pill('متأخرة', 'red')}` : ''}` : '<span class="tm-work-muted">بلا موعد</span>'}</td>
      <td>${pill(esc(t.status_ar || ''), TASK_TONE[String(t.status || '').toUpperCase()] || 'slate')}</td>
      <td>${t.blocked ? pill(esc(t.blocked_reason || 'متعطلة بلا سبب مكتوب'), 'amber') : pill('لا يوجد', 'green')}</td>
    </tr>`;
  }).join('');
}
function tasksTable(tasks, opts) {
  return `<div class="tblwrap"><table class="tm-tbl keep-all tm-work-tasks">
    <thead><tr><th>المهمة</th><th>${opts.showWork ? 'العمل' : 'المسؤول'}</th><th>الاستحقاق</th><th>الحالة</th><th>العائق</th></tr></thead>
    <tbody>${taskRows(tasks, opts)}</tbody></table></div>`;
}
const noTasks = (text) => `<div class="tm-work-notasks">${icon('tasks')}<span>${text}</span></div>`;

// ── الوجه الأول: حسب العمل ──────────────────────────────────────────────────────────────────────
function workActions(w, period) {
  const from = period.key; const to = addMonths(period.key, 2);
  const out = [];
  if (w.kind === 'project' || w.kind === 'bucket') {
    out.push(`<a class="btn btn-sm" href="/app/team/planning?target=${encodeURIComponent(w.kind)}:${encodeURIComponent(w.id)}&amp;from=${from}&amp;to=${to}">${icon('team')} ${esc(G.showDistribution)}</a>`);
  }
  if (w.kind === 'project') out.push(`<a class="btn btn-sm" href="/app/project/${encodeURIComponent(w.id)}">${esc(G.openSourceRecord)}</a>`);
  else if (w.kind === 'opportunity') out.push(`<a class="btn btn-sm" href="/app/opportunity/${encodeURIComponent(w.id)}">${esc(G.openSourceRecord)}</a>`);
  else if (w.kind === 'bucket') out.push(`<span class="tm-work-muted">بند داخلي «${esc(w.label || '')}» — لا سجل مستقل له</span>`);
  else out.push('<a class="btn btn-sm" href="/app/tasks">لوحة المهام</a>');
  return `<div class="tm-work-acts">${out.join('')}</div>`;
}
function workItem(r, period) {
  const w = r.work || {};
  const st = String(w.status || '').toUpperCase();
  const statusPill = w.kind === 'project'
    ? pill(esc(w.status_ar || 'حالة غير محدَّدة'), PROJECT_TONE[st] || 'slate')
    : pill(esc(w.status_ar && w.status_ar !== '—' ? w.status_ar : kindAr(w.kind)), 'slate');
  return `<details class="tm-work-item" data-work="${esc(workKey(w))}">
    <summary class="tm-work-sum">
      <div class="tm-work-grid">
        <div class="c-work"><span class="tm-work-ic k-${esc(w.kind || 'other')}">${icon(KIND_ICON[w.kind] || 'tasks')}</span><div class="min0"><div class="n">${esc(w.label || 'عمل بلا اسم')}</div><div class="m">${esc(kindAr(w.kind))}${w.code ? ` · <span class="tnum">${esc(w.code)}</span>` : ''} · ${statusPill}</div></div></div>
        <div class="c-team" data-label="${esc(G.linkedTeam)}">${teamCell(r.team || [])}</div>
        <div class="c-alloc" data-label="${esc(G.confirmedAllocTotal)}">${allocCell(r)}</div>
        <div class="c-next" data-label="${esc(G.nextCommitment)}">${nextCell(r.nextCommitment, period.year)}</div>
        <div class="c-follow" data-label="${esc(G.followUp)}">${followCell(r)}</div>
        <span class="tm-work-chev" aria-hidden="true">◂</span>
      </div>
    </summary>
    <div class="tm-work-body">
      <div class="tm-work-bh"><b>المهام</b> <span class="m">${countTnum(r.taskCount, TASKS)}${N(r.lateCount) ? ` · <span class="tnum">${N(r.lateCount)}</span> متأخرة` : ''}</span></div>
      ${(r.tasks || []).length ? tasksTable(r.tasks, { showWork: false, year: period.year })
    : noTasks(`${esc(G.noTasksRecorded)} على هذا العمل في المنصة — قد يكون جارياً بمهام لم تُكتب بعد.`)}
      ${workActions(w, period)}
    </div>
  </details>`;
}

// ── الوجه الثاني: حسب المورد (مقلوب: الشخص ⇐ أعماله ومهامه) ───────────────────────────────────
function resourceItem(r, period) {
  const res = r.resource || {};
  const out = r.engagement === 'out' || r.confirmedPct == null;
  const alloc = out
    ? `${pctChip(null)} <span class="m">${esc(G.outOfEngagement)}</span>`
    : `${pctChip(r.confirmedPct, bandOf(r.confirmedPct))} <span class="m">مؤكد · متاح <span class="tnum">${Math.round(N(r.availablePct))}%</span>${N(r.tentativePct) ? ` · مبدئي <span class="tnum">${Math.round(N(r.tentativePct))}%</span>` : ''}</span>`;
  const works = r.works || [];
  const worksCell = works.length
    ? `<ul class="tm-work-wl">${works.map((w) => `<li><span class="n">${esc(w.label || kindAr(w.kind))}</span> <b class="tnum">${Math.round(N(w.pct))}%</b>${w.status === 'tentative' ? ` ${pill('مبدئي', 'violet')}` : ''}<span class="m"> · ${esc(kindAr(w.kind))}</span></li>`).join('')}</ul>`
    : '<span class="tm-work-muted">بلا تسكين هذا الشهر</span>';
  const from = period.key; const to = addMonths(period.key, 2);
  const job = [res.job_title, res.department_name].filter(Boolean).join(' · ');
  return `<details class="tm-work-item" data-resource="${esc(res.employeeId)}">
    <summary class="tm-work-sum">
      <div class="tm-work-grid">
        <div class="c-work">${person(res.name || 'مورد بلا اسم', job)}</div>
        <div class="c-alloc" data-label="التسكين المؤكد">${alloc}</div>
        <div class="c-team" data-label="الأعمال">${worksCell}</div>
        <div class="c-next" data-label="${esc(G.nextCommitment)}">${nextCell(r.nextCommitment, period.year)}</div>
        <div class="c-follow" data-label="${esc(G.followUp)}">${followCell(r, { hasAccount: !!r.hasAccount })}</div>
        <span class="tm-work-chev" aria-hidden="true">◂</span>
      </div>
    </summary>
    <div class="tm-work-body">
      <div class="tm-work-bh"><b>المهام</b> <span class="m">${countTnum(r.taskCount, TASKS)}${N(r.lateCount) ? ` · <span class="tnum">${N(r.lateCount)}</span> متأخرة` : ''}</span></div>
      ${(r.tasks || []).length ? tasksTable(r.tasks, { showWork: true, year: period.year })
    : noTasks(r.hasAccount
      ? `${esc(G.noTasksRecorded)} لهذا المورد في المنصة — وليس ذلك دليلاً على انخفاض حِمل المهام.`
      : `${esc(G.noAccountNoTasks)} — المهام تُسند إلى حسابات الدخول، فاربط حسابه من نموذج المورد إن كان له حساب.`)}
      <div class="tm-work-acts">
        <a class="btn btn-sm" href="${esc(profileHref(res.employeeId))}">${esc(G.openFullProfile)}</a>
        <a class="btn btn-sm" href="/app/team/planning?q=${encodeURIComponent(res.name || '')}&amp;from=${from}&amp;to=${to}">${icon('team')} ${esc(G.showDistribution)}</a>
      </div>
    </div>
  </details>`;
}

const headRow = (cells) => `<div class="tm-work-head" aria-hidden="true"><div class="tm-work-grid">${cells.map((c) => `<div>${esc(c)}</div>`).join('')}<span></span></div></div>`;

const PAGE_CSS = `
  .tm-work-filters{display:flex;gap:.6rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1rem}
  .tm-work-f{display:flex;flex-direction:column;gap:.2rem;font-size:var(--fs-micro);color:var(--muted);font-weight:700}
  .tm-work-f .input{min-width:150px;font-size:var(--fs-body);padding:.4rem .6rem}
  .tm-work-sp{flex:1}
  .tm-work-seg a{display:inline-flex;padding:.38rem .85rem;border-radius:8px;font-size:12px;font-weight:700;color:var(--muted);text-decoration:none}
  .tm-work-seg a.on{background:#fff;color:var(--ink2);box-shadow:var(--sh-sm)}
  .tm-work-seg a:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
  .tm-kpi .v.is-warn{color:var(--amber)}.tm-kpi .v.is-bad{color:var(--red)}
  .tm-work-list{overflow:hidden}
  .tm-work-grid{display:grid;grid-template-columns:2.2fr 1.5fr 1.4fr 1.6fr 1.2fr 24px;gap:.8rem;align-items:center;padding:.8rem 1rem}
  .tm-work-head{background:var(--bg);border-bottom:1px solid var(--line);font-size:var(--fs-meta);font-weight:700;color:var(--muted)}
  .tm-work-head .tm-work-grid{padding:.55rem 1rem}
  .tm-work-item{border-bottom:1px solid var(--line)}.tm-work-item:last-child{border-bottom:0}
  .tm-work-sum{list-style:none;cursor:pointer}.tm-work-sum::-webkit-details-marker{display:none}
  .tm-work-sum:hover{background:#fafbfe}.tm-work-sum:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
  .tm-work-grid .n{font-weight:800;color:var(--ink2);font-size:var(--fs-body)}
  .tm-work-grid .m,.tm-work-body .m{font-size:var(--fs-micro);color:var(--muted)}
  .tm-work-grid .min0{min-width:0}
  .c-work{display:flex;gap:.6rem;align-items:center;min-width:0}
  .tm-work-ic{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex:none;background:#eef2fb;color:var(--brand)}
  .tm-work-ic.k-opportunity{background:#f3edfb;color:var(--brand2)}.tm-work-ic.k-bucket{background:#e6f7f1;color:#0f766e}
  .tm-work-ic.k-internal,.tm-work-ic.k-other{background:var(--bg);color:var(--muted)}
  .tm-work-ic svg{width:20px;height:20px}
  .tm-work-team{display:flex;align-items:center;gap:.25rem;flex-wrap:wrap}
  .tm-work-av{display:inline-flex}.tm-work-avmore{font-size:var(--fs-micro);color:var(--muted);font-weight:700}
  .tm-work-teamn{font-size:var(--fs-micro);color:var(--muted);margin-inline-start:.3rem}
  .tm-work-muted{color:var(--faint);font-size:var(--fs-meta)}
  .tm-work-next{display:flex;gap:.4rem;align-items:center;font-size:var(--fs-body)}.tm-work-next svg{width:15px;height:15px;color:var(--faint);flex:none}
  .tm-work-chev{color:var(--faint);font-size:11px;transition:transform .15s;justify-self:center}
  .tm-work-item[open]>.tm-work-sum .tm-work-chev{transform:rotate(-90deg)}
  .tm-work-body{background:var(--bg);padding:.8rem 1rem 1rem;border-top:1px dashed var(--line)}
  .tm-work-bh{font-size:var(--fs-body);color:var(--ink2);margin-bottom:.5rem}
  .tm-work-tasks{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .tm-work-tasks .pill{white-space:normal;text-align:right}
  .tm-work-tlink{color:var(--brand);font-weight:700;text-decoration:none}
  .tm-work-notasks{display:flex;gap:.5rem;align-items:center;color:var(--muted);font-size:var(--fs-body);padding:.4rem 0}
  .tm-work-notasks svg{width:16px;height:16px;color:var(--faint);flex:none}
  .tm-work-acts{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.7rem;align-items:center}
  .tm-work-wl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.15rem;font-size:var(--fs-meta)}
  .tm-work-cta{display:flex;justify-content:center;gap:.5rem;flex-wrap:wrap;padding:0 1rem 1.2rem}
  .tm-work-foot{margin-top:.6rem}
  @media (max-width:900px){
    .tm-work-head{display:none}
    .tm-work-grid{grid-template-columns:1fr 24px;gap:.45rem}
    .tm-work-grid>div{grid-column:1}
    .tm-work-grid>div[data-label]{display:flex;gap:.3rem;align-items:center;flex-wrap:wrap}
    .tm-work-grid>div[data-label]::before{content:attr(data-label) ':';font-size:var(--fs-micro);color:var(--muted);font-weight:700}
    .tm-work-chev{grid-column:2;grid-row:1}
  }
`;

export async function teamWorkPage(user, opts = {}) {
  const by = String(opts.by || 'work').trim().toLowerCase();
  const department = String(opts.department || '').trim();
  // الخدمة هي البوابة: رفضها (نطاق، إدارة خارجه، فترة غير صحيحة) يصعد كما هو.
  const data = await teamCommitments(user, { year: opts.year, month: opts.month, department: department || null, by });
  const deps = await departmentOptions(user);
  const period = data.period;
  const view = data.by;
  const s = summarize(data);
  const rows = data.rows || [];
  const from = period.key; const to = addMonths(period.key, 2);

  let list;
  if (!rows.length) {
    list = view === 'work'
      ? `<div class="tm-card">${s.resources
        ? emptyState(`لا تسكين ولا مهام جارية في ${period.label_ar}`, 'الموارد ضمن النطاق بلا تسكين لهذا الشهر وبلا مهام جارية مسندة إليهم — أضف تسكيناً من التخطيط، أو مهاماً من سجلات الأعمال.')
        : emptyState('لا موارد ضمن هذا النطاق', 'اختر إدارةً أخرى من التصفية أو راجع سجل الموارد.')}
        <div class="tm-work-cta">${s.resources
    ? `<a class="btn btn-primary btn-sm" href="/app/team/planning?from=${from}&amp;to=${to}${department ? `&amp;department=${encodeURIComponent(department)}` : ''}">${esc(G.planningTab)}</a>`
    : `<a class="btn btn-sm" href="/app/team/resources">${esc(G.resourcesRegistry)}</a>`}</div></div>`
      : `<div class="tm-card">${emptyState('لا موارد ضمن هذا النطاق', 'اختر إدارةً أخرى من التصفية أو راجع سجل الموارد.')}<div class="tm-work-cta"><a class="btn btn-sm" href="/app/team/resources">${esc(G.resourcesRegistry)}</a></div></div>`;
  } else {
    const head = view === 'work'
      ? headRow(['العمل', G.linkedTeam, G.confirmedAllocTotal, G.nextCommitment, G.followUp])
      : headRow(['المورد', 'التسكين المؤكد', 'الأعمال', G.nextCommitment, G.followUp]);
    list = `<div class="tm-card tm-work-list" id="tm-work-list">${head}${rows.map((r) => (view === 'work' ? workItem(r, period) : resourceItem(r, period))).join('')}</div>`;
  }

  const actions = `<button class="btn" type="button" data-action="tm-work-expand" data-open="0" aria-expanded="false" hidden>توسيع الكل</button>
    <a class="btn btn-primary" href="/app/tasks">${icon('tasks')} ${esc(G.viewTasks)}</a>`;
  const body = `<style>${PAGE_CSS}</style>
    ${filters({ period, by: view, department, deps })}
    ${kpis(s, period.label_ar)}
    ${list}
    <div class="tm-info" style="margin-top:1rem">تُعرض المهام من سجلاتها الأصلية في المشاريع والفرص — هذه الشاشة لا تنشئ مهاماً ولا تعدّلها، وتعدّ كل مهمة مرةً واحدة.</div>
    <div class="tm-note tm-work-foot"><span>${esc(data.basis_ar || '')}</span></div>
    <div class="tm-note"><span>${esc(G.confirmedAllocTotal)}: مجموع نسب طاقة أعضاء الفريق في الشهر — <span class="tnum">130%</span> تعني <span class="tnum">1.3</span> دوام كامل عند طاقةٍ كاملة، ورقم الدوام الكامل يراعي طاقة كل مورد.</span></div>`;
  return teamLayout({
    user, path: 'work', title: G.pathWork,
    subtitle: 'ما الذي ينجزه الفريق، وما الذي يحتاج متابعة؟',
    crumbs: [{ label: G.pathWork, href: '/app/team/work' }],
    actions, body, scripts: ['/static/pages/team-work.js'],
    // سنة الرأس تتبع اختيار المستخدم فقط — لا تُفرض على روابط القائمة حين لم يختر شيئاً.
    year: opts.year ? period.year : undefined,
  });
}
