// ── تحليل الاستخدام وفحص الحالة — S17/S18 (وحدة الفريق والموارد، ADR-0016) ─────────────────
//
// «الإشارة سؤالٌ يُطرح على المدير مع أدلته، لا حكمٌ على الموظف» (الموجّه §7.2). الصفحتان
// تعرضان ما تعيده خدمة `modules/team/analysis.js` حرفاً: ثلاثة أرقام لا تُخلط (التسكين المؤكد،
// القابل للفوترة بالمقام نفسه، وحِمل المهام بمستواه وأساسه)، والتغطية المالية للفرد «غير متاحة»
// دائماً (C8 في EXECUTION-LOG) — تُقال بسببها ولا تُخترع لها أرقام. لا ترتيب أداء بين الأفراد:
// الصفوف بترتيب الاسم كما تعيدها الخدمة. لا كتابة هنا: المتابعة والإغلاق من عميل الصفحة
// (public/pages/team-analysis.js) عبر /api/team/analysis/… والخدمة هي البوابة.
import { teamLayout, person, pctChip, typePill, emptyState, monthLabel, esc, pill, icon } from './_shell.js';
import { all } from '../../../core/db/index.js';
import { effectiveScope } from '../../../core/rbac/index.js';
import { departmentScope, departmentInSql } from '../../../core/rbac/departments.js';
import { MONTHS_AR } from '../../../core/i18n/time.js';
import { countAr } from '../../../core/i18n/plural.js';
import { G } from '../../i18n/glossary.js';
import { utilizationTable, caseDetail } from '../../../modules/team/analysis.js';
import { bandOf } from '../../../modules/team/capacity-model.js';
import { peopleScope } from '../../../modules/org/org.js';
import { namesByIds, pickablePeople, seesDemoAccounts } from '../../../modules/org/people.js';
import { ownsEmployee } from '../../../modules/org/confirm.js';

const N = (v) => Number(v) || 0;
// ما يُحقن للعميل بلا `null` (يُسقَط المفتاح بدل قيمة فارغة) وبلا `<` خام.
const json = (x) => JSON.stringify(x, (k, v) => (v === null ? undefined : v)).replace(/</g, '\\u003c');
const num = (v) => `<span class="tnum">${esc(v)}</span>`;
const fmtDate = (iso) => {
  const s = String(iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s ? esc(s) : '—';
  return `<span class="tnum">${Number(m[3])} ${esc(MONTHS_AR[Number(m[2]) - 1] || '')} ${m[1]}</span>`;
};
const fmtStamp = (iso) => {
  const s = String(iso || '');
  if (!s) return '—';
  return `${fmtDate(s)}${s.length > 10 ? ` <span class="tnum">${esc(s.slice(11, 16))}</span>` : ''}`;
};
const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && String(v) !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const CSS = `
  .tm-an-filters{display:flex;gap:.6rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1rem}
  .tm-an-filters .field label{display:block;font-size:var(--fs-meta);color:var(--muted);margin-bottom:.25rem}
  .tm-an-filters select,.tm-an-filters input{min-width:140px}
  .tm-an-tbl{min-width:900px}
  .tm-an-load{display:flex;flex-direction:column;gap:.1rem}
  .tm-an-load .lv{display:inline-flex;align-items:center;gap:.35rem;font-weight:700;color:var(--ink2)}
  .tm-an-load .lv i{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
  .tm-an-load .bs{font-size:var(--fs-micro);color:var(--muted)}
  .tm-an-cov{display:inline-flex;align-items:center;gap:.3rem;color:var(--muted);font-weight:700;cursor:help}
  .tm-an-cov svg{width:14px;height:14px;color:var(--faint)}
  .tm-an-sig{display:flex;flex-direction:column;gap:.25rem;align-items:flex-start}
  .tm-an-defs ol{padding-inline-start:1.2rem;margin:0;display:flex;flex-direction:column;gap:.5rem;font-size:var(--fs-body);line-height:1.8}
  .tm-an-evid td:first-child{font-weight:700;color:var(--ink2);white-space:nowrap}
  .tm-an-q{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.45rem}
  .tm-an-q li{display:flex;gap:.5rem;align-items:flex-start;font-size:var(--fs-body);line-height:1.7}
  .tm-an-q li svg{width:15px;height:15px;color:var(--amber);flex:none;margin-top:.2rem}
  .tm-an-head{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem}
  .tm-an-head .meta{font-size:var(--fs-meta);color:var(--muted);margin-top:.2rem}
  .tm-an-case .tm-form{display:flex;flex-direction:column;gap:.7rem}
  .tm-an-case textarea,.tm-an-case select,.tm-an-case input{width:100%}
  .tm-an-actions{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
  .tm-an-closed{border-inline-start:3px solid var(--line);padding-inline-start:.7rem;color:var(--muted);font-size:var(--fs-body)}
  @media (max-width:640px){.tm-an-filters{flex-direction:column;align-items:stretch}.tm-an-filters select,.tm-an-filters input{width:100%}}
`;

// ── إدارات مرشِّح «الإدارة» بنفس حدود الصفوف (peopleScope) — لا وعدٌ بإدارةٍ يردّها الخادم ──
async function scopedDepartments(user) {
  const sc = peopleScope(user);
  if (sc.blind) return [];
  const where = ['d.active = 1', 'd.deleted_at IS NULL'];
  const params = [];
  if (sc.sector) { where.push('d.sector_id = ?'); params.push(sc.sector); }
  if (sc.departments.length) { const q = departmentInSql('d.id', sc.departments); where.push(q.clause); params.push(...q.params); }
  return await all(`SELECT d.id, d.name_ar, d.sector_id FROM department d WHERE ${where.join(' AND ')} ORDER BY d.name_ar`, params);
}

// ── من يجوز أن يُسنَد إليه إجراء المتابعة — مرآة قائمة الإسناد في «مهامي» (views/pmo.js) ──
async function assignablePeople(user) {
  const scope = effectiveScope(user, 'create', 'task');
  let people = [];
  if (user.role_id === 'admin' || scope === 'company') people = await pickablePeople({ viewer: user });
  else if (scope === 'department') {
    const inDeps = departmentInSql('e.department_id', departmentScope(user));
    people = await all(`SELECT u.id, COALESCE(u.name_ar, u.username) AS "name" FROM app_user u
        JOIN employee e ON e.id = u.employee_id AND e.deleted_at IS NULL
       WHERE u.active = 1 AND u.deleted_at IS NULL
         ${seesDemoAccounts(user) ? '' : "AND COALESCE(u.username,'') NOT LIKE 'demo.%'"}
         AND ${inDeps.clause} ORDER BY u.name_ar, u.username LIMIT 300`, inDeps.params);
  } else if ((scope === 'sector') && user.sector_id) people = await pickablePeople({ sectorId: user.sector_id, viewer: user });
  const me = { id: user.id, name: user.name_ar || user.username || 'أنا' };
  if (!people.some((p) => p.id === user.id)) people = [me, ...people];
  return people.map((p) => ({ id: p.id, name: p.name || p.id }));
}

const LOAD_TONE = { low: 'var(--brand)', medium: 'var(--amber)', high: 'var(--red)', unmeasured: 'var(--faint)' };
const TASK_WORDS = { one: 'مهمة مفتوحة واحدة', two: 'مهمتين مفتوحتين', few: 'مهام مفتوحة', many: 'مهمة مفتوحة' };
const UNSIZED_WORDS = { one: 'واحدة بلا نسبة مقدَّرة', two: 'اثنتان بلا نسبة مقدَّرة', few: 'بلا نسبة مقدَّرة', many: 'بلا نسبة مقدَّرة' };

function loadDetail(r) {
  const load = r.taskLoad || {};
  if (!r.userId) return 'لا حساب دخول مرتبط';
  if (!N(load.open)) return 'لا مهام مفتوحة';
  return `${N(load.pct)}% من ${countAr(N(load.open), TASK_WORDS)}${N(load.unsized) ? `، ${countAr(N(load.unsized), UNSIZED_WORDS)}` : ''}`;
}
const loadCell = (r) => {
  const load = r.taskLoad || {};
  const level = load.level || 'unmeasured';
  const label = level === 'unmeasured' ? G.unmeasured : (load.level_ar || '—');
  return `<div class="tm-an-load" title="${esc(load.basis_ar || '')}">
    <span class="lv"><i style="background:${LOAD_TONE[level] || LOAD_TONE.unmeasured}"></i>${esc(label)}</span>
    <span class="bs tnum">${esc(loadDetail(r))}</span></div>`;
};
const coverageCell = (c) => `<span class="tm-an-cov" title="${esc(c?.note_ar || '')}">${esc(c?.state_ar || G.unavailable)}${icon('info')}</span>`;
const signalPill = (s) => pill(esc(s?.label_ar || ''), 'slate');

// ── S17: جدول الاستخدام ──────────────────────────────────────────────────────────────
function utilRow(r, period) {
  const out = r.engagement === 'out';
  const href = `/app/team/analysis/${encodeURIComponent(r.employeeId)}${qs({ year: period.year, month: period.month })}`;
  return `<tr data-emp="${esc(r.employeeId)}">
    <td>${person(r.name, r.job_title, { href: `/app/team/resources/${encodeURIComponent(r.employeeId)}` })}
      <div style="margin-top:.3rem;display:flex;gap:.3rem;flex-wrap:wrap">${typePill(r.resourceType, r.resourceType_ar)}${r.department_name ? `<span class="tm-note">${esc(r.department_name)}</span>` : ''}</div></td>
    <td>${out ? pctChip(null) : pctChip(r.confirmedPct, bandOf(r.confirmedPct))}</td>
    <td>${out ? `<span style="color:var(--faint)">—</span>` : `${num(`${N(r.billablePct)}%`)} <span class="tm-note" style="display:inline">من الطاقة</span>`}</td>
    <td>${loadCell(r)}</td>
    <td>${coverageCell(r.coverage)}</td>
    <td><div class="tm-an-sig" title="${esc(r.signal?.rule_ar || '')}">${signalPill(r.signal)}${r.hasCase ? pill('متابعة قائمة', 'blue') : ''}</div></td>
    <td><a class="btn btn-sm" href="${esc(href)}">${G.checkCase}</a></td>
  </tr>`;
}

function filterBar({ period, depts, dept, sig, signals, action }) {
  const nowYear = new Date().getUTCFullYear();
  const years = [...new Set([period.year - 1, period.year, period.year + 1, nowYear])].sort((a, b) => a - b);
  const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  return `<form class="tm-an-filters" method="get" action="${esc(action)}" data-autosubmit>
    <div class="field"><label for="an-year">السنة</label><select id="an-year" name="year" class="input">${years.map((y) => opt(y, String(y), y === period.year)).join('')}</select></div>
    <div class="field"><label for="an-month">الشهر</label><select id="an-month" name="month" class="input">${MONTHS_AR.map((m, i) => opt(i + 1, m, i + 1 === period.month)).join('')}</select></div>
    <div class="field"><label for="an-dept">الإدارة</label><select id="an-dept" name="department" class="input">${opt('', 'كل الإدارات', !dept)}${depts.map((d) => opt(d.id, d.name_ar, d.id === dept)).join('')}</select></div>
    <div class="field"><label for="an-signal">${G.reviewSignal}</label><select id="an-signal" name="signal" class="input">${opt('', 'كل الإشارات', !sig)}${signals.map((s) => opt(s.key, `${s.label_ar} (${s.count})`, s.key === sig)).join('')}</select></div>
    <button class="btn" type="submit">تطبيق</button>
  </form>`;
}

/** S17 — /app/team/analysis?year=&month=&department=&signal= */
export async function analysisPage(user, opts = {}) {
  const dept = String(opts.department || '').trim();
  const sig = String(opts.signal || '').trim();
  const data = await utilizationTable(user, { year: opts.year, month: opts.month, department: dept, signal: sig, sector: opts.sector });
  const { period, rows, counts, signals, definitions_ar, basis_ar, asOf } = data;
  const depts = await scopedDepartments(user);
  const base = `/app/team/analysis`;
  const clearHref = base + qs({ year: period.year, month: period.month });

  let table;
  if (!counts.resources) {
    table = emptyState('لا موارد ضمن نطاقك في هذا الشهر', 'اختر شهراً آخر، أو اطلب توسيع نطاقك من مدير النظام.');
  } else if (!rows.length) {
    table = `${emptyState('لا نتائج لهذه المرشّحات', 'غيّر الإشارة أو الإدارة لعرض الموارد.')}
      <div style="text-align:center;padding-bottom:1rem"><a class="btn btn-sm" href="${esc(clearHref)}">عرض الكل</a></div>`;
  } else {
    table = `<div class="tblwrap"><table class="tm-tbl keep-all tm-an-tbl">
      <thead><tr><th>المورد</th><th>التسكين المؤكد</th><th>${G.billableOfCapacity}</th><th>${G.taskLoad}</th><th>${G.authorizedCoverage}</th><th>${G.reviewSignal}</th><th></th></tr></thead>
      <tbody>${rows.map((r) => utilRow(r, period)).join('')}</tbody></table></div>
      <div class="tm-pager"><span>${countAr(rows.length, { one: 'مورد واحد', two: 'موردان', few: 'موارد', many: 'مورداً' })} من ${num(counts.resources)} في ${esc(period.label_ar)} · بترتيب الاسم — لا ترتيب أداء بين الأفراد</span></div>`;
  }

  const defs = `<template id="dd-analysis-definitions"><div class="tm-an-defs">
      <div class="tm-note" style="margin-bottom:.7rem">${icon('clock')} آخر تحديث: ${fmtStamp(asOf)}</div>
      <ol>${(definitions_ar || []).map((d) => `<li>${esc(d)}</li>`).join('')}</ol>
      <div class="tm-info" style="margin-top:.9rem">${esc(basis_ar || '')}</div>
    </div></template>`;

  const body = `<style>${CSS}</style>
    <div class="tm-info" style="margin-bottom:1rem;display:flex;justify-content:space-between;gap:.8rem;flex-wrap:wrap;align-items:center">
      <span>${icon('info')} ${G.authorizedCoverage} للفرد: ${esc(G.unavailable)} — ${esc(data.rows[0]?.coverage?.note_ar || 'لا يوجد منهج معتمد من المالية لتغطية الفرد في هذه النسخة')}.</span>
      <button type="button" class="btn btn-sm" data-action="definitions" aria-haspopup="dialog">${icon('list')} ${G.defineIndicators}</button>
    </div>
    ${filterBar({ period, depts, dept, sig, signals, action: base })}
    <div class="tm-card">${table}</div>
    <div class="tm-foot">${esc(basis_ar || '')} · آخر تحديث ${fmtStamp(asOf)}</div>
    ${defs}
    <div class="tm-scrim" id="tm-scrim" data-action="drawer-close"></div>
    <aside class="tm-drawer" id="tm-drawer" role="dialog" aria-modal="true" aria-labelledby="tm-drawer-title" aria-hidden="true">
      <div class="dh"><div><div class="tm-card-t" id="tm-drawer-title">${G.defineIndicators}</div><div class="tm-card-s">الوحدة والمصدر وتوقيت التحديث والمنهج</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="drawer-close" aria-label="إغلاق">✕</button></div>
      <div class="db" id="tm-drawer-body"></div>
    </aside>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{teamAnalysis:${json({ period: { year: period.year, month: period.month, key: period.key }, total: rows.length })}});</script>`;

  return teamLayout({
    user, path: 'analysis', section: 'utilization', title: G.pathAnalysis,
    subtitle: `${period.label_ar} · اقرأ التسكين وعبء العمل والتغطية كلاً على حدة`,
    crumbs: [{ label: G.utilizationTab, href: base }],
    body, scripts: ['/static/pages/team-analysis.js'], year: opts.year,
  });
}

// ── S18: فحص الحالة وإجراء المتابعة ────────────────────────────────────────────────────
const FOLLOWUP_ACTIONS = [
  'مراجعة عبء العمل مع مدير المشروع',
  'تحديث التسكين ليعكس العمل الفعلي',
  'تأكيد الاحتياج الفعلي قبل تغيير التسكين',
  'استكمال بيانات المورد وطاقته',
  'مراجعة الأولويات الداخلية والميزانية',
  'التحقق من الطلب القادم مع صاحبه',
];

function caseCard(c, names) {
  if (!c) return '';
  const owner = names.get(c.ownerUserId) || (c.ownerUserId ? 'مسؤول المتابعة' : '—');
  const task = c.task;
  const statusTone = c.status === 'closed' ? 'slate' : c.status === 'explained' ? 'blue' : 'amber';
  return `<div class="tm-sec">
    <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:center;flex-wrap:wrap">
      <div class="sh" style="margin:0">${esc(task?.title || 'متابعة')}</div>${pill(esc(c.status_ar || ''), statusTone)}</div>
    <div class="tm-note" style="margin-top:.4rem;flex-wrap:wrap">
      <span>المسؤول: <b>${esc(owner)}</b></span>${c.due_date ? `<span>· الموعد ${fmtDate(c.due_date)}</span>` : ''}${task ? `<span>· حالة المهمة: ${esc(task.status_ar || '')}${task.deleted ? ' (حُذفت)' : ''}</span>` : ''}
    </div>
    ${c.note && c.status !== 'closed' ? `<div style="font-size:var(--fs-body);margin-top:.4rem">${esc(c.note)}</div>` : ''}
    ${c.status === 'closed' ? `<div class="tm-an-closed" style="margin-top:.5rem">أُغلقت بواسطة <b>${esc(c.closedByName || names.get(c.closedBy) || 'المسؤول')}</b>${c.closedAt ? ` في ${fmtStamp(c.closedAt)}` : ''}${c.note ? ` — التفسير: ${esc(c.note)}` : ''}</div>` : ''}
    <div class="tm-an-actions" style="margin-top:.6rem">${c.ownerUserId ? `<a class="btn btn-sm" href="/app/person/${encodeURIComponent(c.ownerUserId)}">مهام المسؤول</a>` : ''}
      <span class="tm-note">فُتحت ${fmtStamp(c.created_at)}</span></div>
  </div>`;
}

function followupForm({ employeeId, period, signal, owners, user, reopen }) {
  const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  return `<form class="tm-form" data-form="followup" data-employee="${esc(employeeId)}" data-year="${period.year}" data-month="${period.month}" data-signal="${esc(signal.key)}" novalidate>
    ${reopen ? `<div class="tm-info">الحالة السابقة مغلقة — حفظ متابعة جديدة يعيد فتحها بمهمة جديدة.</div>` : ''}
    <div class="field"><label class="req" for="fu-action">الإجراء</label>
      <select id="fu-action" name="action_ar" class="input">${FOLLOWUP_ACTIONS.map((a, i) => opt(a, a, i === 0)).join('')}${opt('__other', 'إجراء آخر…', false)}</select></div>
    <div class="field" data-other hidden><label for="fu-other">وصف الإجراء</label><input id="fu-other" name="action_other" class="input" maxlength="80" placeholder="اكتب الإجراء المطلوب"></div>
    <div class="field"><label class="req" for="fu-owner">المسؤول عن المتابعة</label>
      <select id="fu-owner" name="owner" class="input">${owners.map((o) => opt(o.id, o.name, o.id === user.id)).join('')}</select></div>
    <div class="field"><label for="fu-due">الموعد</label><input id="fu-due" type="date" name="due" class="input"></div>
    <div class="field"><label for="fu-note">ملاحظة</label><textarea id="fu-note" name="note" class="input" rows="3" maxlength="1000" placeholder="ما الذي يجب التحقق منه قبل أي تغيير؟"></textarea></div>
    <div class="tm-danger" data-err hidden role="alert"></div>
    <div class="tm-an-actions"><button class="btn btn-primary" type="submit" data-submit>حفظ المتابعة</button>
      <span class="tm-note">تُسجَّل كمهمة حقيقية في «مهامي» للمسؤول.</span></div>
  </form>`;
}

function closeForm(c) {
  return `<form class="tm-form" data-form="close-case" data-case="${esc(c.id)}" style="margin-top:.8rem" novalidate>
    <div class="sh" style="font-weight:800;color:var(--ink2)">تأكيد التفسير وإغلاق الحالة</div>
    <div class="field"><label class="req" for="cc-expl">التفسير</label><textarea id="cc-expl" name="explanation" class="input" rows="3" maxlength="1000" placeholder="ما الذي تبيّن، وما القرار؟"></textarea></div>
    <div class="tm-danger" data-err hidden role="alert"></div>
    <div class="tm-an-actions"><button class="btn btn-primary" type="submit" data-submit>تأكيد وإغلاق</button>
      <span class="tm-note">يُسجَّل المسؤول والسبب في الأثر؛ المهمة تبقى لصاحبها.</span></div>
  </form>`;
}

/** S18 — /app/team/analysis/:employeeId?year=&month= */
export async function analysisCasePage(user, employeeId, opts = {}) {
  const d = await caseDetail(user, employeeId, { year: opts.year, month: opts.month });
  const { resource, period, signal, figures, taskLoad, coverage, evidence, questions_ar, followup, otherCases, rights, asOf } = d;
  const ids = [followup?.ownerUserId, followup?.closedBy, ...(otherCases || []).flatMap((c) => [c.ownerUserId, c.closedBy])].filter(Boolean);
  const [names, owners] = await Promise.all([namesByIds(ids), rights.followup ? assignablePeople(user) : []]);
  const open = followup && followup.status !== 'closed';
  const canClose = !!open && (user.role_id === 'admin' || followup.ownerUserId === user.id || followup.created_by === user.id || await ownsEmployee(user, resource.id));
  const out = figures.engagement === 'out';
  const listHref = `/app/team/analysis${qs({ year: period.year, month: period.month })}`;
  const fixHref = `/app/team/planning?fix=1&employee=${encodeURIComponent(resource.id)}&month=${encodeURIComponent(period.key)}`;
  const profileHref = `/app/team/resources/${encodeURIComponent(resource.id)}`;

  const facts = `<div class="tm-kpis">
    <div class="tm-kpi"><div class="l">التسكين المؤكد</div><div class="v">${out ? esc(G.outOfEngagement) : num(`${N(figures.confirmedPct)}%`)}</div><div class="s">${out ? 'الشهر خارج فترة الارتباط' : 'من طاقته التعاقدية المسجلة'}</div></div>
    <div class="tm-kpi"><div class="l">${G.billableOfCapacity}</div><div class="v">${out ? '—' : num(`${N(figures.billablePct)}%`)}</div><div class="s">من الطاقة — المقام نفسه</div></div>
    <div class="tm-kpi"><div class="l">${G.taskLoad}</div><div class="v">${esc(taskLoad?.level === 'unmeasured' ? G.unmeasured : (taskLoad?.level_ar || '—'))}</div><div class="s tnum">${esc(loadDetail({ taskLoad, userId: resource.userId }))}</div></div>
    <div class="tm-kpi"><div class="l">التغطية المالية</div><div class="v" style="color:var(--muted)">${esc(coverage?.state_ar || G.unavailable)}</div><div class="s">${esc(coverage?.note_ar || '')}</div></div>
  </div>`;

  const evidenceRows = (evidence || []).map((e) => `<tr>
      <td>${esc(e.title_ar)}</td>
      <td class="tnum">${esc(e.value_ar)}</td>
      <td>${e.source?.href ? `<a href="${esc(e.source.href)}" style="color:var(--brand)">${esc(e.source.label_ar || 'المصدر')}</a>` : `<span class="tm-note" style="display:inline">${esc(e.source?.label_ar || '—')}</span>`}</td>
      <td class="tnum" style="white-space:nowrap">${fmtStamp(e.asOf)}</td></tr>`).join('');

  let followupBody;
  if (open) {
    followupBody = `${caseCard(followup, names)}
      ${canClose ? closeForm(followup) : `<div class="tm-note">إغلاق الحالة لصاحب المتابعة أو لمن يدير المورد.</div>`}`;
  } else if (followup && followup.status === 'closed') {
    followupBody = `${caseCard(followup, names)}
      ${rights.followup ? followupForm({ employeeId: resource.id, period, signal, owners, user, reopen: true }) : ''}`;
  } else if (rights.followup) {
    followupBody = followupForm({ employeeId: resource.id, period, signal, owners, user, reopen: false });
  } else {
    followupBody = `<div class="tm-info">فتح متابعة يتطلب صلاحية إنشاء المهام — اطلبها من مدير النظام أو أبلغ مدير المورد.</div>`;
  }

  const others = (otherCases || []).length ? `<div class="tm-card" style="margin-top:1rem"><div class="tm-card-h"><div class="tm-card-t">متابعات أخرى في ${esc(period.label_ar)}</div></div>
      <div class="tm-card-b">${otherCases.map((c) => `<div style="margin-bottom:.6rem"><div class="tm-note" style="margin-bottom:.3rem">${esc(c.signal?.label_ar || '')}</div>${caseCard(c, names)}</div>`).join('')}</div></div>` : '';

  const body = `<style>${CSS}</style>
    <div class="tm-an-head">
      <div>${person(resource.name_ar, `${resource.job_title || ''}${resource.resourceType_ar ? ` · ${resource.resourceType_ar}` : ''}`, { href: profileHref })}
        <div class="meta">${[resource.department_name, resource.sector_name].filter(Boolean).map(esc).join(' · ')}${resource.department_name || resource.sector_name ? ' · ' : ''}${esc(period.label_ar)}</div></div>
      <div class="tm-an-sig" style="align-items:flex-end">${signalPill(signal)}<span class="tm-note">${esc(signal.rule_ar || '')}</span></div>
    </div>
    ${facts}
    <div class="tm-grid2">
      <div>
        <div class="tm-card" style="margin-bottom:1rem"><div class="tm-card-h"><div><div class="tm-card-t">سبب الإشارة</div><div class="tm-card-s">القاعدة المنطبقة وما قرأته المنصة</div></div></div>
          <div class="tm-card-b"><div style="font-weight:800;color:var(--ink2);margin-bottom:.3rem">${esc(signal.label_ar || '')}</div>
            <div style="font-size:var(--fs-body)">${esc(signal.rule_ar || '')}</div>
            ${signal.why_ar ? `<div class="tm-note tnum" style="margin-top:.4rem">${esc(signal.why_ar)}</div>` : ''}</div></div>
        <div class="tm-card" style="margin-bottom:1rem"><div class="tm-card-h"><div><div class="tm-card-t">الأدلة</div><div class="tm-card-s">معلومات حالية من المصادر المرتبطة بهذه الحالة</div></div></div>
          <div class="tblwrap"><table class="tm-tbl keep-all tm-an-evid"><thead><tr><th>الدليل</th><th>القيمة</th><th>المصدر</th><th>آخر تحديث</th></tr></thead>
            <tbody>${evidenceRows || `<tr><td colspan="4">${emptyState('لا أدلة مسجلة لهذا الشهر', '')}</td></tr>`}</tbody></table></div></div>
        <div class="tm-card"><div class="tm-card-h"><div><div class="tm-card-t">أسئلة للتحقق</div><div class="tm-card-s">تحقق منها قبل اتخاذ أي إجراء على التسكين</div></div></div>
          <div class="tm-card-b"><ul class="tm-an-q">${(questions_ar || []).map((q) => `<li>${icon('flag')}<span>${esc(q)}</span></li>`).join('')}</ul></div></div>
      </div>
      <div class="tm-an-case">
        <div class="tm-card"><div class="tm-card-h"><div><div class="tm-card-t">المتابعة</div><div class="tm-card-s">حدد الإجراء المناسب لمتابعة هذه الحالة</div></div></div>
          <div class="tm-card-b">
            ${followupBody}
            <div class="tm-an-actions" style="margin-top:1rem"><a class="btn" href="${esc(fixHref)}">${icon('edit')} اقتراح تعديل التسكين</a><span class="tm-note">يفتح التخطيط بسياق المورد والشهر — لا يطبّق تعديلاً بنفسه.</span></div>
            <div class="tm-info" style="margin-top:.8rem">${icon('info')} ${esc(G.signalNotAvailability)}</div>
          </div></div>
        ${others}
      </div>
    </div>
    <div class="tm-foot">الإشارة الأولى المنطبقة بترتيب القواعد · آخر تحديث ${fmtStamp(asOf)} · <a href="${esc(listHref)}" style="color:var(--brand)">العودة إلى الجدول</a></div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{teamCase:${json({
    employeeId: resource.id, year: period.year, month: period.month, key: period.key, signal: signal.key,
    owners, caseId: followup?.id || '', caseStatus: followup?.status || '',
  })}});</script>`;

  return teamLayout({
    user, path: 'analysis', section: 'utilization', title: G.pathAnalysis,
    subtitle: `${G.checkCase} · ${resource.name_ar} · ${period.label_ar}`,
    crumbs: [{ label: G.utilizationTab, href: listHref }, { label: G.checkCase, href: '#' }],
    actions: `<a class="btn" href="${esc(profileHref)}">${icon('users')} فتح ملف المورد</a>`,
    body, scripts: ['/static/pages/team-analysis.js'], year: opts.year,
  });
}
