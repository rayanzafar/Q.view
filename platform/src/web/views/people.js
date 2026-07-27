// People pages: my timesheet, team & staffing (span board v2.1), org structure.
import { layout, card, pill } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { myEntries } from '../../modules/timesheets/timesheets.js';
import { orgTree, staffingRoster, identityLinks } from '../../modules/org/org.js';
import { canSeeSensitive, can } from '../../core/rbac/index.js';
import { ROLE_LABELS } from '../../core/rbac/matrix.js';
import { isDelivery } from '../../core/org/kind.js';
import { G } from '../i18n/glossary.js';
import { esc, ddWrap, ddRows } from './_shared.js';
import { MONTHS_AR, monthLabelDual, currentMonthIndex, nowDot } from '../../core/i18n/time.js';
import { countAr } from '../../core/i18n/plural.js';

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
      ${card(`<div class="p-4"><div class="text-[11px] text-muted">نسبة القابل للفوترة</div><div class="text-2xl font-extrabold">${total ? Math.round(billable / total * 100) : 0}%</div></div>`)}
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
        <button onclick="Sanad.addTime()" class="text-white text-[12px] px-4 rounded-lg" style="background:linear-gradient(120deg,var(--brand),var(--brand2))">تسجيل</button>
      </div></div>
      <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
        <th class="py-2 px-3 font-medium">التاريخ</th><th class="px-3 font-medium">النوع</th><th class="px-3 font-medium">ساعات</th>
        <th class="px-3 font-medium">الفوترة</th><th class="px-3 font-medium">ملاحظة</th></tr></thead>
        <tbody id="ts-rows">${list || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا سجلات هذا الأسبوع — سجّل وقتك من النموذج بالأعلى</td></tr>'}</tbody></table>`)}`;
  return layout({ user, active: 'timesheet', title: 'سجل الوقت', body });
}

// دالة نقية: تدمج الأشهر المتتالية المتساوية النسبة في امتدادات — بدل 12 خلية متطابقة.
// months: مصفوفة 12 قيمة (نِسَب صحيحة، 100 = طاقة كاملة) ⟵ [{ m0 (صفري), len, v }] ومجموع len = 12.
export function spansOf(months) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const v = Math.round(Number(months[i]) || 0);
    const last = out[out.length - 1];
    if (last && last.v === v) last.len++;
    else out.push({ m0: i, len: 1, v });
  }
  return out;
}
// تدرج المعنى الموحد للامتدادات: >110 تجاوز · 70–110 صحي · 1–69 جزئي ·
// صفر لعضو قطاع = «تسكين قطاعي» (بنفسجي رفيع) · صفر بلا قطاع = مسار شفاف.
export const spanTone = (v, sectorMember) => v > 110 ? 'over' : v >= 70 ? 'ok' : v > 0 ? 'low' : sectorMember ? 'park' : 'off';

// Span board v2.1 — decision-story order: (1) summary band → (2) staffing decisions →
// (3) span board grouped by urgency (merged month spans, sector-parking baseline) →
// (4) expandable per-employee details (projects + opportunity soft loads).
// ─────────────────────────────────────────────────────────────────────────────
// «الفريق» — دليل الأشخاص البسيط: من هم، إضافة/تعديل/حذف. لا نِسَب ولا شبكات شهرية هنا —
// تلك مساحة عمل مختلفة تماماً («التسكين» أدناه). فُصلت الصفحتان بناءً على ملاحظة مباشرة من
// المالك: دمجهما في صفحة واحدة كان يُبهظ الواجهة بمفاهيم لا علاقة لها بإدارة سجل الموظفين.
// ─────────────────────────────────────────────────────────────────────────────
export async function teamPage(user, opts = {}) {
  const canSalary = canSeeSensitive(user, 'salary');
  const canManage = can(user, 'create', 'employee') || can(user, 'update', 'employee');
  const canCreate = can(user, 'create', 'employee');
  const canDelete = can(user, 'delete', 'employee'); // offboarding — HR/admin only (matrix)
  // وحدتان من القائمة نفسها، لأن للصفحة استعمالين لا استعمالاً واحداً:
  //   • allSec (كل الوحدات: قطاعات تسليم + وحدات مساندة) ⟵ تسمية قطاع كل موظف في الجدول،
  //     وخانة «القطاع» في نافذة إضافة/تعديل موظف. ترشيح النوع هنا كان سيُخفي «الخدمات المشتركة»
  //     من نافذة الإضافة فيستحيل تسكين أحد فيها أصلاً، ويعرض موظفيها القائمين بقطاع فارغ «—».
  //   • deliverySec (قطاعات التسليم وحدها) ⟵ شرائح التصفية أعلى الصفحة، وهي محوّل قطاع يقرأه
  //     المستخدم قائمةً بالقطاعات: أربعة لا خامس لها.
  // `kind` مذكور في القراءة عمداً: isDelivery يقرأ الخانة الفارغة «قطاع تسليم» (وهو الصحيح لصف
  // أقدم من الترحيلة)، فعمودٌ غير مقروء أصلاً يجعل **كل** وحدة تمرّ — بلا خطأ يُنبّه أحداً.
  const allSec = await all('SELECT id, name_ar, color, kind FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const deliverySec = allSec.filter(isDelivery);
  const sectorNames = Object.fromEntries(allSec.map((s) => [s.id, s.name_ar]));
  const sector = (opts.sector || '').toString().trim();
  const { roster } = await staffingRoster(user, { sector });
  // حالة ربط كل موظف بحساب دخوله — العمود الفقري للصلاحيات: من لا حساب له لا تصله مهمة
  // ولا إشعار ولا يظهر لمدير المشروع. القائمة القابلة للربط تُبنى في الخدمة حسب صلاحية القارئ.
  const { byEmployee: links, freeAccounts, unlinkedCount, canLink } = await identityLinks(user, { sector });
  // نشط أولاً ثم أبجدي — دليل أشخاص، لا ترتيب حسب الحمل (ذاك في صفحة التسكين)
  const sorted = roster.slice().sort((a, b) => (b.active - a.active) || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'));
  const activeCount = roster.filter((e) => e.active !== 0).length;

  // خلية «حساب الدخول»: شارة الحالة + إجراء الربط/فك الربط من الصف نفسه لمن يملك الصلاحية
  const acctCell = (e) => {
    const l = links[e.id] || null;
    const label = l ? esc(l.name_ar || l.username || 'حساب مربوط') : '';
    const badge = l
      ? `<span class="pill" style="background:#dcfce7;color:#059669" title="مربوط بحساب ${label}">✓ ${label}</span>`
      : `<span class="pill" style="background:#fef3c7;color:#92400e" title="لا يملك حساب دخول — لن تصله المهام ولا الإشعارات">بلا حساب</span>`;
    const btn = !canLink ? ''
      : l ? `<button class="btn btn-sm btn-ghost" data-action="emp-unlink" data-emp="${e.id}" style="color:var(--muted)">فك الربط</button>`
        : `<button class="btn btn-sm btn-ghost" data-action="emp-link" data-emp="${e.id}" style="color:var(--brand)">ربط بحساب</button>`;
    return `<div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">${badge}${btn}</div>`;
  };

  const rowTpl = (e) => `<tr data-emp="${e.id}" data-hay="${esc(`${e.name_ar} ${e.job_title || ''}`.toLowerCase())}" style="border-bottom:1px solid var(--line)">
    <td data-label="الاسم" style="padding:.6rem .7rem">
      <div style="font-weight:700;font-size:13px;color:var(--ink2)">${esc(e.name_ar)}${e.active === 0 ? ' ' + pill('غير نشط', 'slate') : ''}</div>
      ${e.job_title ? `<div style="font-size:11px;color:var(--muted)">${esc(e.job_title)}</div>` : ''}</td>
    <td data-label="القطاع" style="padding:.6rem .7rem;font-size:12px;color:var(--muted)">${esc(sectorNames[e.sector_id] || '—')}</td>
    <td data-label="نوع التوظيف" style="padding:.6rem .7rem;font-size:12px;color:var(--muted)">${esc(e.employment_type || '—')}</td>
    <td data-label="تاريخ التعيين" style="padding:.6rem .7rem;font-size:12px" class="tnum">${e.hire_date ? esc(e.hire_date) : '<span style="color:var(--faint)">—</span>'}</td>
    <td data-label="حساب الدخول" style="padding:.6rem .7rem;font-size:12px">${acctCell(e)}</td>
    ${canSalary ? `<td data-label="الراتب الشهري" style="padding:.6rem .7rem;font-size:12px" class="tnum emp-sal">${e.salary_halalas ? fmtSar(e.salary_halalas) : '<span style="color:var(--faint)">—</span>'}</td>` : ''}
    <td data-label="" style="padding:.6rem .7rem;text-align:left;white-space:nowrap">
      ${canManage ? `<button class="btn btn-sm btn-ghost" data-action="emp-edit" data-emp="${e.id}">✎ تعديل</button>` : ''}
      ${canDelete ? `<button class="btn btn-sm btn-ghost" data-action="emp-delete" data-emp="${e.id}" style="color:var(--red)">حذف</button>` : ''}
    </td></tr>`;

  const secChips = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    <a href="/app/team" class="chip ${sector ? '' : 'on'}">${G.all}</a>
    ${deliverySec.map((s) => `<a href="/app/team?sector=${s.id}" class="chip ${sector === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || 'var(--brand)'}"></span>${esc(s.name_ar)}</a>`).join('')}
  </div>` : '';

  const table = card(`<div class="tblwrap"><table class="rtbl" id="team-rows" style="width:100%;border-collapse:collapse;min-width:820px">
    <thead><tr style="font-size:10.5px;color:var(--muted);text-align:right">
      <th style="padding:.5rem .7rem;font-weight:700">الاسم</th><th style="padding:.5rem .7rem;font-weight:700">القطاع</th>
      <th style="padding:.5rem .7rem;font-weight:700">نوع التوظيف</th><th style="padding:.5rem .7rem;font-weight:700">تاريخ التعيين</th>
      <th style="padding:.5rem .7rem;font-weight:700">حساب الدخول</th>
      ${canSalary ? '<th style="padding:.5rem .7rem;font-weight:700">الراتب الشهري</th>' : ''}
      <th style="padding:.5rem .7rem"></th></tr></thead>
    <tbody>${sorted.map(rowTpl).join('')}</tbody></table>
    ${sorted.length ? '' : `<div class="empty-state">${icon('team')}<div class="t">لا أعضاء ضمن نطاقك</div><div class="s">أضِف موظفين من زر «إضافة موظف» بالأعلى.</div></div>`}</div>`);

  // تنبيه جودة البيانات: فجوة الهوية. يظهر فقط لمن يملك الربط، ويقول ماذا حدث وما الخطوة.
  const acctCount = (n) => countAr(n, { one: 'حساب واحد متاح', two: 'حسابان متاحان', few: 'حسابات متاحة', many: 'حساباً متاحاً' });
  const gapNote = canLink && unlinkedCount ? `<div class="alert warn" style="margin-bottom:.8rem">
      <span aria-hidden="true">⚠</span>
      <span><b>${countAr(unlinkedCount, { one: 'موظف واحد بلا حساب مستخدم', two: 'موظفان بلا حساب مستخدم', few: 'موظفين بلا حساب مستخدم', many: 'موظفاً بلا حساب مستخدم' })}</b>
        — لا تصلهم المهام ولا الإشعارات، ولا يظهرون في قوائم مديري المشاريع، وصلاحيات الإدارة والفريق تبقى معطّلة عنهم.
        اربط كل واحد بحسابه من عمود «حساب الدخول».
        ${freeAccounts.length ? `${acctCount(freeAccounts.length)} في انتظار الربط.` : 'لا حسابات متاحة للربط حالياً — تُنشأ الحسابات من صفحة المستخدمين والصلاحيات.'}</span>
    </div>` : '';

  const body = `
    ${secChips}
    ${gapNote}
    <div class="toolbar" style="margin-bottom:.8rem">
      <div class="search">${icon('search')}<input class="input" id="team-q" aria-label="بحث بالاسم أو المسمى" placeholder="ابحث بالاسم أو المسمى…"></div>
      <div class="spacer"></div>
      ${canManage ? pill('لديك صلاحية إدارة الفريق', 'green') : pill('عرض فقط', 'slate')}
      ${canCreate ? `<button class="btn btn-primary" data-action="emp-add">${icon('plus')} إضافة موظف</button>` : ''}
    </div>
    ${table}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      emps:${JSON.stringify(Object.fromEntries(roster.map((e) => [e.id, {
        name_ar: e.name_ar, job_title: e.job_title, employment_type: e.employment_type,
        active: e.active, sector_id: e.sector_id, hire_date: e.hire_date || '',
        salary_sar: canSalary ? Math.round((e.salary_halalas || 0) / 100) : null,
      }]))).replace(/</g, '\\u003c')},
      empLinks:${JSON.stringify(Object.fromEntries(sorted.map((e) => [e.id, links[e.id]
        ? { label: links[e.id].name_ar || links[e.id].username || 'حساب مربوط' } : null]))).replace(/</g, '\\u003c')},
      freeAccounts:${JSON.stringify(freeAccounts.map((a) => ({ id: a.id,
        label: a.name_ar || a.username || 'حساب بلا اسم',
        role: (ROLE_LABELS[a.role_id] || {}).ar || '' }))).replace(/</g, '\\u003c')},
      teamSectors:${JSON.stringify(allSec.map((s) => ({ id: s.id, name_ar: s.name_ar }))).replace(/</g, '\\u003c')},
      canSalary:${canSalary}, canManage:${canManage}, canCreate:${canCreate}, canDelete:${canDelete}, canLink:${canLink},
      teamSectorLocked:${JSON.stringify(sector || (user.scope !== 'company' ? user.sector_id : null))}});</script>`;
  return layout({
    user, active: 'team', title: 'الفريق',
    subtitle: `${countAr(activeCount, { one: 'عضو نشط واحد', two: 'عضوان نشطان', few: 'أعضاء نشطون', many: 'عضواً نشطاً' })}${roster.length > activeCount ? ` · +${roster.length - activeCount} غير نشط` : ''}`,
    body, scripts: ['/static/pages/team-manage.js'],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// «التسكين» — مساحة قرارات الطاقة: من محمَّل فوق طاقته، من متاح، ومسار الأشهر لكل عضو. لا إضافة
// ولا حذف ولا تعديل بيانات موظف هنا (تلك في «الفريق») — فقط قرارات التسكين على المشاريع.
// ─────────────────────────────────────────────────────────────────────────────
export async function staffingPage(user, opts = {}) {
  const canManage = can(user, 'create', 'employee') || can(user, 'update', 'employee'); // يحكم زر «تسكين على مشروع» — كما كان في الصفحة المدمجة سابقاً
  const canStaff = can(user, 'update', 'project'); // span editing goes through project staffing rights
  // نفس الفصل الذي في صفحة «الفريق»: الأسماء من الوحدات كلها (موظف الخدمات المشتركة يُسمّى
  // باسم وحدته لا «خارج القطاعات»)، والشرائح من قطاعات التسليم وحدها.
  const allSec = await all('SELECT id, name_ar, color, kind FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const deliverySec = allSec.filter(isDelivery); // ‹kind› مقروء أعلاه — بدونه يمرّ كل شيء (انظر صفحة الفريق)
  const sectorNames = Object.fromEntries(allSec.map((s) => [s.id, s.name_ar]));
  const { year, sector, currentMonth, roster, summary } = await staffingRoster(user, { sector: opts.sector });
  const nowIdx = currentMonthIndex(year); // 0-based; -1 when viewing another year (no «now» marker)
  const curName = currentMonth ? MONTHS_AR[currentMonth - 1] : 'الشهر الحالي';
  const projects = await all(`SELECT id, name_ar, sector_id FROM project WHERE deleted_at IS NULL AND status IN ('IN_PROGRESS','PLANNED')
     ${sector ? 'AND sector_id = ?' : ''} ORDER BY name_ar`, sector ? [sector] : []);

  const activeR = roster.filter((e) => e.active !== 0);
  const uTone = (u) => u > 110 ? 'var(--red)' : u >= 70 ? 'var(--green)' : u > 0 ? 'var(--amber)' : 'var(--faint)';
  const fte = (v) => String(Math.round((v || 0) * 100) / 100);
  const pctAssigned = summary.capacityFte ? Math.round((summary.assignedNowFte / summary.capacityFte) * 100) : 0;

  // التجميع حسب إلحاح القرار (يُحسب مبكراً كي تتطابق أرقام البطاقات مع أقسام اللوحة حرفياً):
  // تجاوز → سعة متاحة → مستقر (مطوي) → تعاون خارجي بلا تسكين (مطوي)
  const isExternal = (e) => !e.sector_id && e.projectCount === 0 && e.peak === 0;
  const groups = { over: [], avail: [], stable: [], external: [] };
  for (const e of roster) {
    if (isExternal(e)) groups.external.push(e);
    else if (e.active === 0) groups.stable.push(e); // غير النشط ليس قرار طاقة — يبقى في «مستقر»
    else if (e.peak > 110) groups.over.push(e);
    else if (e.currentUtil < 70) groups.avail.push(e);
    else groups.stable.push(e);
  }
  // «سعة متاحة»: الأكثر تفرغاً الآن أولاً — هذا ترتيب اتخاذ قرار التسكين
  groups.avail.sort((a, b) => (a.currentUtil - b.currentUtil) || (a.peak - b.peak) || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'));

  // ── (1) summary band: 5 tiles + drill-downs ──
  const tile = (label, val, sub, o = {}) => card(`<div ${o.dd ? `role="button" tabindex="0" data-dd="${o.dd}" onkeydown="if(event.key==='Enter'||event.key===' ')Sanad.openDD('${o.dd}')"` : ''} style="padding:.8rem 1rem;${o.dd ? 'cursor:pointer' : ''}" class="${o.dd ? 'cardclick' : ''}">
    <div style="font-size:11px;color:var(--muted)">${label}${o.dd ? ' <span style="color:var(--faint)">⊕</span>' : ''}</div>
    <div class="metric tnum" style="font-size:1.35rem;${o.tone ? 'color:' + o.tone : ''}">${val}</div>
    ${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const nameRow = (e, right) => `<div class="dd-row"><span>${esc(e.name_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(e.job_title || '—')}</span></span><b class="tnum">${right}</b></div>`;
  const dds = [
    ddWrap('bench', G.onBench, `${curName} — بلا أي تسكين أو فرصة`, ddRows(activeR.filter((e) => e.currentUtil === 0).map((e) => nameRow(e, '0%')))),
    ddWrap('over', G.overloaded, `${curName} — تجاوز 110% من الطاقة`, ddRows(activeR.filter((e) => e.currentUtil > 110).map((e) => nameRow(e, e.currentUtil + '%')))),
    ddWrap('under', G.underused, `${G.utilization} في ${curName} أقل من 70% — الأكثر تفرغاً أولاً`, ddRows(groups.avail.map((e) => nameRow(e, e.currentUtil + '%')))),
  ].join('');
  const band = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem;margin-bottom:1rem">
    ${tile(G.capacity, summary.capacityFte, 'موظف نشط')}
    ${tile('مُسكَّن الآن', pctAssigned + '%', `${fte(summary.assignedNowFte)} من ${summary.capacityFte} طاقة كاملة · ${curName}`, { tone: uTone(pctAssigned) })}
    ${tile(G.onBench, summary.benchNow, `بلا تسكين في ${curName}`, { dd: 'bench', tone: summary.benchNow ? 'var(--amber)' : 'var(--green)' })}
    ${tile(G.overloaded, summary.overloadedNow, `تجاوز 110% في ${curName}`, { dd: 'over', tone: summary.overloadedNow ? 'var(--red)' : 'var(--green)' })}
    ${tile(G.underused, groups.avail.length, `${G.utilization} في ${curName} أقل من 70%`, { dd: 'under', tone: groups.avail.length ? 'var(--amber)' : 'var(--green)' })}
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
      <span class="pill" style="background:${needs.length ? '#fef3c7;color:#b45309' : '#dcfce7;color:#059669'}">${needs.length || 'صفر'}</span>
      <span style="margin-inline-start:auto;font-size:var(--fs-micro);color:var(--faint)">الأعلى أولوية: من تجاوز طاقته ثم من بلا تسكين — حتى 6 أسماء</span></div>
    <div style="padding:.7rem 1rem;display:flex;flex-direction:column;gap:.5rem">
      ${needs.map(needRow).join('') || `<div class="alert ok">✓ ${G.nothingNeedsYou} — الطاقة موزّعة ضمن الحدود هذا الشهر</div>`}
    </div>`);

  // ── (3) span board: merged month spans instead of 12 repeated cells; grouped by urgency ──
  const rangeLabel = (months) => {
    const ks = Object.keys(months).map(Number).filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
    if (!ks.length) return 'بلا أشهر مجدولة';
    const pcts = [...new Set(ks.map((m) => Math.round((Number(months[m]) || 0) * 100)))];
    const span = ks.length === 1 ? MONTHS_AR[ks[0] - 1] : `${MONTHS_AR[ks[0] - 1]} – ${MONTHS_AR[ks[ks.length - 1] - 1]}`;
    return `${span} · ${ks.length} شهر · ${pcts.length === 1 ? `<span class="tnum">${pcts[0]}%</span>` : `<span class="tnum">${Math.min(...pcts)}–${Math.max(...pcts)}%</span>`}`;
  };
  // مسار 12 شهراً — خلية مستقلة بنسبتها الظاهرة لكل شهر (لا امتدادات مدموجة، بناءً على طلب
  // مباشر: كانت النسبة تظهر فقط على الامتداد فيلزم ربطها ذهنياً بعمودي «الآن»/«الذروة»).
  const trackOf = (e) => `<div class="btrack"><div class="mtrack">${MONTHS_AR.map((mn, i) => {
    const v = Math.round(Number(e.months[i]) || 0);
    const tone = spanTone(v, !!e.sector_id);
    const full = tone === 'park'
      ? `${G.sectorParking} — ${mn}: وقت ${e.name_ar} محجوز لقطاعه افتراضياً حتى يُسكَّن على مشروع`
      : `${e.name_ar} — ${mn}: ${v}%${v > 110 ? ` (${G.overloaded})` : ''}`;
    return `<button type="button" class="hg-cell ${tone}" data-emp="${e.id}" data-m="${i + 1}" data-v="${v}"
      title="${esc(full)}" aria-label="${esc(full)}"><span class="tnum">${v}%</span></button>`;
  }).join('')}</div></div>`;
  const boardRow = (e) => {
    const detailProjects = e.projects.map((p) => `<div class="dd-row">
        <span>${p.projectId ? `<a href="/app/project/${p.projectId}" style="color:var(--brand2);font-weight:700">${esc(p.name)}</a>` : esc(p.name)}
          ${pill(p.type === 'lead' ? 'قائد' : p.type === 'advisor' ? 'مستشار' : 'عضو', p.type === 'lead' ? 'blue' : 'slate')}</span>
        <b style="font-weight:600;color:var(--muted);font-size:11.5px">${rangeLabel(p.months)}</b></div>`).join('');
    const detailOpps = e.opportunities.map((o) => `<div class="dd-row">
        <span>${esc(o.name)} ${pill(o.label, 'violet')}</span>
        <b style="font-weight:600;color:var(--muted);font-size:11.5px">${curName} · <span class="tnum">${o.pct}%</span> (حمل مبدئي)</b></div>`).join('');
    return `<div class="brd-row" data-emp="${e.id}" data-name="${esc(String(e.name_ar || '').toLowerCase())} ${esc(String(e.job_title || '').toLowerCase())}">
      <div class="brd-meta"><b>${esc(e.name_ar)}</b>${e.active === 0 ? ' ' + pill('غير نشط', 'slate') : ''}
        <div class="sub">${esc(e.job_title || '—')}${sector ? '' : ' · ' + esc(sectorNames[e.sector_id] || 'خارج القطاعات')}</div></div>
      <div class="brd-peak tnum" data-peak title="${G.peak} — أعلى شهر هذه السنة" style="color:${e.peak > 110 ? 'var(--red)' : 'var(--ink2)'}">${e.peak}%</div>
      <div class="brd-now tnum" data-now title="${G.utilization} ${esc(curName)}" style="color:${uTone(e.currentUtil)}">${e.currentUtil}%</div>
      ${trackOf(e)}
      <div class="brd-x"><button type="button" class="btn btn-ghost btn-sm" data-action="expand" data-emp="${e.id}" aria-expanded="false" aria-label="تفاصيل ${esc(e.name_ar)}">⌄</button></div>
    </div>
    <div class="hg-detail" data-detail="${e.id}" hidden>
      <div style="font-size:11px;font-weight:800;color:var(--muted);margin-bottom:.3rem">تسكين ${esc(e.name_ar)} — ${e.projectCount} مشروع${e.opportunities.length ? ` + ${e.opportunities.length} ${G.opportunity}` : ''}</div>
      ${detailProjects || `<div style="color:var(--faint);font-size:12px;padding:.2rem 0">لا مشاريع مُسكَّنة هذه السنة${e.sector_id ? ` — وقته كله «${G.sectorParking}»` : ''}</div>`}
      ${detailOpps}
      <div class="dd-row"><span>تاريخ التعيين</span><b class="tnum">${e.hire_date ? esc(e.hire_date) : '—'}</b>
        <a href="/app/team?highlight=${e.id}" style="font-size:10.5px;color:var(--brand);margin-inline-start:.5rem">تعديل بيانات الموظف ←</a></div>
      ${canManage ? `<div style="display:flex;gap:.4rem;margin-top:.5rem;flex-wrap:wrap">
        <button class="btn btn-sm" data-action="assign" data-emp="${e.id}">${icon('userplus')} تسكين على مشروع</button></div>` : ''}
    </div>`;
  };

  const bsec = (key, title, sub, pillStyle, open, rows, emptyLine) => {
    if (!rows.length && !emptyLine) return '';
    return `<details class="bsec ${key}" ${open ? 'open' : ''} data-default-open="${open ? 1 : 0}">
      <summary><span class="car" aria-hidden="true">◂</span>
        <span class="bsec-t">${title}</span>
        <span class="pill tnum" style="${pillStyle}">${rows.length || 'صفر'}</span>
        <span class="bsec-s">${sub}</span></summary>
      ${rows.map(boardRow).join('') || `<div class="bsec-empty">${emptyLine}</div>`}
    </details>`;
  };
  const sections =
    bsec('over', G.overloaded, 'شهر واحد على الأقل فوق 110% من الطاقة', 'background:#fee2e2;color:#b91c1c', true, groups.over,
      `✓ لا أحد يتجاوز طاقته هذه السنة — راقب «${G.underused}» لتوزيع العمل القادم`) +
    bsec('avail', G.underused, `${G.utilization} في ${esc(curName)} أقل من 70% — مرشحون للتسكين`, 'background:#fef3c7;color:#92400e', true, groups.avail,
      `الجميع مُسكَّن بنسبة 70% فأكثر في ${esc(curName)} — إن احتجت سعة راجع «مستقر»`) +
    bsec('stable', 'مستقر أو غير نشط', `${G.utilization} صحي ضمن الحدود (70–110%) أو موظف غير نشط`, 'background:#dcfce7;color:#059669', false, groups.stable, '') +
    bsec('external', 'غير مُسكَّن (تعاون خارجي)', 'بلا قطاع وبلا أي تسكين هذه السنة', 'background:#f1f5f9;color:#475569', false, groups.external, '');

  // رأس الأشهر: عناوين مزدوجة (عربي كامل/Jan على الضيق) + النقطة الذهبية «نحن هنا» على الشهر الحالي
  const headTrack = `<div class="btrack"><div class="mtrack" style="align-items:center">${Array.from({ length: 12 }, (_, i) =>
    `<span class="brd-mh"><span class="dotslot">${i === nowIdx ? nowDot(`${curName} — نحن هنا`) : ''}</span>${monthLabelDual(i)}</span>`).join('')}</div></div>`;
  const boardHead = `<div class="brd-row brd-head">
    <div>الموظف</div><div class="brd-peak">${G.peak}</div><div class="brd-now" title="${G.utilization} ${esc(curName)}">الآن</div>
    ${headTrack}<div></div></div>`;
  const legend = `<div class="blegend">
    <span><i style="background:#dc2626"></i>${G.overloaded} — فوق 110%</span>
    <span><i style="background:#a7f3d0"></i>صحي 70–110%</span>
    <span><i style="background:#fde68a"></i>جزئي 1–69%</span>
    <span><i style="background:rgba(131,71,152,.3);border:1px dashed rgba(131,71,152,.5)"></i>${G.sectorParking} — وقت محجوز للقطاع لم يُوجَّه لمشروع بعد</span>
    <span><i style="border:1px dashed var(--line)"></i>بلا تسكين (خارج القطاعات)</span>
    <span>${nowDot()} ${esc(curName)} — نحن هنا</span>
  </div>`;
  const boardCard = card(`
    <div class="bhead">
      <span style="font-weight:800;font-size:13px">${G.monthlyStaffing} — ${year}</span>
      <div class="search">${icon('search')}<input class="input" id="staff-q" aria-label="بحث بالاسم أو الدور" placeholder="ابحث بالاسم أو الدور…"></div>
      <div class="spacer"></div>
      ${canStaff ? `<span style="font-size:10.5px;color:var(--muted)">انقر أي فترة لتعديل تسكين شهرها</span>` : ''}
    </div>
    <div class="tblwrap"><div class="brd" id="brd">
      ${boardHead}
      ${roster.length ? sections : `<div class="empty-state">${icon('team')}<div class="t">لا أعضاء ضمن نطاقك</div><div class="s">أضِف موظفين من صفحة «الفريق» أو راجع صلاحياتك.</div></div>`}
    </div></div>
    <div class="bleg-wrap">${legend}</div>`);

  const secChips = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    <a href="/app/staffing" class="chip ${sector ? '' : 'on'}">${G.all}</a>
    ${deliverySec.map((s) => `<a href="/app/staffing?sector=${s.id}" class="chip ${sector === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || 'var(--brand)'}"></span>${esc(s.name_ar)}</a>`).join('')}
  </div>` : '';

  const style = `<style>
    .brd{min-width:900px;--bcols:200px 52px 62px minmax(430px,1fr) 36px}
    .brd-row{display:grid;grid-template-columns:var(--bcols);align-items:center;gap:.55rem;padding:.32rem 1rem}
    .brd-row[data-emp]{border-bottom:1px solid var(--line)}
    .brd-row.brd-head{font-size:10.5px;color:var(--muted);font-weight:700;padding-block:.5rem;border-bottom:1px solid var(--line);background:var(--surface)}
    .brd-meta{min-width:0}
    .brd-meta b{font-size:12.5px}
    .brd-meta .sub{font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .brd-peak{font-size:11.5px;font-weight:700}
    .brd-now{font-weight:800;font-size:13px}
    .brd-mh{display:flex;flex-direction:column;align-items:center;gap:1px;text-align:center;font-weight:700;font-size:10px}
    .dotslot{height:9px;display:flex;align-items:center}
    .btrack .mtrack{background:linear-gradient(var(--line),var(--line)) center/100% 1px no-repeat;min-height:24px;align-items:end}
    .hg-cell{border:none;height:24px;border-radius:6px;cursor:pointer;padding:0 .3rem;font-family:inherit;font-size:10px;font-weight:700;
      overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0;transition:filter .12s,transform .1s}
    .hg-cell:hover{filter:brightness(.95);transform:translateY(-1px)}
    .hg-cell:focus-visible{outline:2px solid var(--brand);outline-offset:1px;z-index:1;position:relative}
    .hg-cell.over{background:#dc2626;color:#fff}
    .hg-cell.ok{background:#a7f3d0;color:#065f46}
    .hg-cell.low{background:#fde68a;color:#78350f}
    .hg-cell.park{background:rgba(131,71,152,.13);color:#6d3a80;border:1px dashed rgba(131,71,152,.4)}
    .hg-cell.off{background:transparent}
    .hg-cell.off:hover{background:#eef1f7;outline:1px dashed #c9d3e8}
    .bsec>summary{list-style:none;display:flex;align-items:center;gap:.55rem;padding:.55rem 1rem;cursor:pointer;background:#fafbfe;
      border-bottom:1px solid var(--line);font-size:12.5px;border-inline-start:3px solid transparent}
    .bsec>summary::-webkit-details-marker{display:none}
    .bsec>summary::marker{content:''}
    .bsec .car{font-size:9px;color:var(--muted);transition:transform .15s}
    .bsec[open] .car{transform:rotate(-90deg)}
    .bsec-t{font-weight:800}
    .bsec-s{font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bsec.over>summary{border-inline-start-color:var(--red)}
    .bsec.avail>summary{border-inline-start-color:var(--amber)}
    .bsec.stable>summary{border-inline-start-color:#c9d3e8}
    .bsec.external>summary{border-inline-start-color:#cbd5e1;color:var(--muted)}
    .bsec-empty{padding:.6rem 1rem;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line)}
    .bhead{padding:.8rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}
    .bleg-wrap{padding:.55rem 1rem;border-top:1px solid var(--line)}
    .blegend{display:flex;gap:.85rem;flex-wrap:wrap;font-size:10.5px;color:var(--muted);align-items:center}
    .blegend>span{display:inline-flex;align-items:center;gap:.3rem}
    .blegend i{width:14px;height:9px;border-radius:3px;flex:none}
    .hg-detail{padding:.6rem 1.2rem .8rem;background:var(--bg);border-bottom:1px solid var(--line)}
    .hg-pop{position:absolute;z-index:70;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh);width:300px;max-width:92vw}
  </style>`;

  const body = `
    ${style}${secChips}
    <div class="toolbar" style="margin-bottom:.8rem">
      <div style="font-weight:800;font-size:14px">${sector ? esc(sectorNames[sector]) : 'كل القطاعات'} · ${countAr(activeR.length, { one: 'عضو نشط واحد', two: 'عضوان نشطان', few: 'أعضاء نشطين', many: 'عضواً نشطاً' })}${roster.length > activeR.length ? ` <span style="color:var(--faint);font-weight:400">(+${roster.length - activeR.length} غير نشط)</span>` : ''}</div>
      <div class="spacer"></div>
      <a class="btn btn-sm" href="/app/team">${icon('team')} إدارة الفريق</a>
    </div>
    ${band}
    <div style="margin-bottom:1rem">${needsCard}</div>
    ${boardCard}
    <div style="font-size:10.5px;color:var(--faint);margin-top:.55rem">المصدر: نموذج التسكين المخطط (وليس ساعات فعلية). «${G.utilization}» = نسبة الوقت المحجوز من طاقة الشهر. عضو القطاع وقته كله «${G.sectorParking}» افتراضياً، والتسكين على مشروع يقتطع من هذا الحجز — فالمسار البنفسجي الرفيع يعني سعة قطاع لم تُوجَّه لمشروع بعد. «${G.opportunity}» = حمل مبدئي من فريق فرصة مفتوحة يُحتسب على ${curName} فقط.</div>
    ${dds}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      emps:${JSON.stringify(Object.fromEntries(roster.map((e) => [e.id, {
        name_ar: e.name_ar, job_title: e.job_title, sector_id: e.sector_id,
        months: e.months, currentUtil: e.currentUtil,
        projects: e.projects.map((p) => ({ allocId: p.allocId, name: p.name, projectId: p.projectId,
          months: Object.fromEntries(Object.entries(p.months).map(([m, f]) => [m, Math.round((Number(f) || 0) * 100)])) })),
        opps: e.opportunities.map((o) => ({ name: o.name, pct: o.pct })),
      }]))).replace(/</g, '\\u003c')},
      teamProjects:${JSON.stringify(projects.map((p) => ({ id: p.id, name_ar: p.name_ar, sector_id: p.sector_id }))).replace(/</g, '\\u003c')},
      canManage:${canManage}, canStaff:${canStaff}, currentMonth:${currentMonth},
      monthNames:${JSON.stringify(MONTHS_AR)}, teamSectorLocked:${JSON.stringify(sector)}});</script>`;
  return layout({
    user, active: 'staffing', title: 'التسكين', subtitle: `مساحة قرارات الطاقة · ${curName} ${year}`, body,
    scripts: ['/static/pages/staffing.js'],
  });
}

export async function orgPage(user) {
  const tree = await orgTree(user);
  const sectorBlocks = tree.map((s) => card(`<div style="padding:1rem">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:.5rem">
        <span style="width:11px;height:11px;border-radius:3px;background:${s.color || 'var(--brand)'}"></span>
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
