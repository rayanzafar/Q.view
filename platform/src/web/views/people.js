// People pages: my timesheet, team directory, org structure. («التسكين» في views/staffing.js
// منذ v5.26 — تُعاد تصديرها أدناه حفاظاً على عقد الاستيراد من هذا الملف.)
import { layout, card, pill } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { myEntries } from '../../modules/timesheets/timesheets.js';
import { orgTree, staffingRoster, identityLinks } from '../../modules/org/org.js';
import { teamTasksAccess } from '../../modules/pmo/tasks.js';
import { canSeeSensitive, can } from '../../core/rbac/index.js';
import { ROLE_LABELS } from '../../core/rbac/matrix.js';
import { isDelivery } from '../../core/org/kind.js';
import { G, workKindLabel } from '../i18n/glossary.js';
import { esc } from './_shared.js';
import { countAr } from '../../core/i18n/plural.js';

export async function timesheetPage(user) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const rows = await myEntries(user, { from, to });
  const total = rows.reduce((a, r) => a + r.hours, 0);
  const billable = rows.filter((r) => r.billable).reduce((a, r) => a + r.hours, 0);
  // ثلاثة حقول يكتبها المستخدم كانت تُحقَن في الصفحة بلا تهريب — الاستثناء الوحيد في هذه الصفحة.
  // اليوم ذاتيّ الضرر لأن كلاً يرى سجلّه وحده، لكنه يصير مخزَّناً على غيره لحظة ما ترى أول شاشة
  // إدارية سجلات الفريق — وهي بالضبط الشاشة المطلوبة في الموجة القادمة. يُغلَق قبلها لا بعدها.
  // ونوع العمل يمرّ على المعجم: كان يُطبَع كما هو مخزَّناً بالإنجليزية أمام المستخدم.
  const list = rows.map((e) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[13px]">${esc(e.entry_date)}</td>
    <td class="px-3 text-[13px]">${esc(workKindLabel(e.work_kind))}</td>
    <td class="px-3 text-[13px] tabular-nums">${esc(e.hours)}</td>
    <td class="px-3">${e.billable ? pill('قابلة للفوترة', 'green') : pill('غير قابلة', 'slate')}</td>
    <td class="px-3 text-[12px] text-muted">${esc(e.note || '')}</td></tr>`).join('');
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
      ? `<span class="pill" style="background:#dcfce7;color:#166534" title="مربوط بحساب ${label}">✓ ${label}</span>`
      : `<span class="pill" style="background:#fef3c7;color:#92400e" title="لا يملك حساب دخول — لن تصله المهام ولا الإشعارات">بلا حساب</span>`;
    const btn = !canLink ? ''
      : l ? `<button class="btn btn-sm btn-ghost" data-action="emp-unlink" data-emp="${e.id}" style="color:var(--muted)">فك الربط</button>`
        : `<button class="btn btn-sm btn-ghost" data-action="emp-link" data-emp="${e.id}" style="color:var(--brand)">ربط بحساب</button>`;
    return `<div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">${badge}${btn}</div>`;
  };

  // ── الاسم يُنقر فيفتح ملف صاحبه ─────────────────────────────────────────────
  // «كل مدير يقدر يشوف موظفينه، ولو ضغط على كل موظف يطلع شغال على شي» — بلسان المالك. وصفحة
  // الشخص موجودة منذ الموجة الماضية، ويصلها المدير من لوحة الفريق في «مهامي» ومن شجرة الهيكل —
  // **ولا يصلها من الشاشة المسمّاة «الفريق»**، وهي أول ما يفتحه من يسأل «من عندي». فالاسم فيها
  // نصٌّ جامد بجانب صفٍّ كامل من أزرار الإدارة: يُقرأ عطلاً لا قراراً.
  //
  // والرابط مشروطٌ بشرطين، وكلاهما يمنع «باباً مفتوحاً على غرفة مغلقة»:
  //   • حسابُ دخولٍ مربوط — صفحة الشخص تُفتح بمعرّف **الحساب** لا الموظف، ومن لا حساب له لا
  //     صفحة له أصلاً (وعمود «حساب الدخول» في الصف نفسه يقول ذلك ويعرض زرّ الربط).
  //   • أن يكون القارئ ممن يفتح ملفات الناس (`teamTasksAccess`) — نفس بوابة الخدمة حرفاً بحرف،
  //     لا شرطٌ موازٍ يتباعد عنها. فالموارد البشرية مثلاً تُدير الكشف ولا تقرأ مهام أحد، فلا
  //     يُعرض لها رابطٌ يُردّ.
  // ونطاق الكشف نفسه هو نطاق الملف (`peopleScope` ⟵ `departmentScope`)، فما يظهر في الجدول
  // يُفتح فعلاً — لا اسمَ يُنقر فيُقال لصاحبه «هذا الشخص خارج إدارتك».
  const canOpenPerson = teamTasksAccess(user).canRead;
  const nameCell = (e) => {
    const uid = links[e.id]?.user_id || null;
    const inner = `${esc(e.name_ar)}${e.active === 0 ? ' ' + pill('غير نشط', 'slate') : ''}`;
    return canOpenPerson && uid
      ? `<a href="/app/person/${encodeURIComponent(uid)}" style="font-weight:700;font-size:13px;color:var(--brand2);text-decoration:none" title="افتح ملف ${esc(e.name_ar)} — مهامه ومشاريعه وفرصه">${inner}</a>`
      : `<div style="font-weight:700;font-size:13px;color:var(--ink2)">${inner}</div>`;
  };

  const rowTpl = (e) => `<tr data-emp="${e.id}" data-hay="${esc(`${e.name_ar} ${e.job_title || ''}`.toLowerCase())}" style="border-bottom:1px solid var(--line)">
    <td data-label="الاسم" style="padding:.6rem .7rem">
      ${nameCell(e)}
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
        ${freeAccounts.length ? `${acctCount(freeAccounts.length)} في انتظار الربط.`
          : 'لا حسابات متاحة للربط حالياً — <a href="/app/users" style="color:inherit;font-weight:700">ادعُ الموظف من شاشة المستخدمين والصلاحيات</a> ويصله رمز التفعيل على بريده.'}</span>
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
      teamSectorLocked:${JSON.stringify(sector || (user.scope !== 'company' ? user.sector_id : null)).replace(/</g, '\\u003c')}});</script>`;
  return layout({
    user, active: 'team', title: 'الفريق',
    subtitle: `${countAr(activeCount, { one: 'عضو نشط واحد', two: 'عضوان نشطان', few: 'أعضاء نشطون', many: 'عضواً نشطاً' })}${roster.length > activeCount ? ` · +${roster.length - activeCount} غير نشط` : ''}`,
    body, scripts: ['/static/pages/team-manage.js'],
  });
}

// «التسكين» (v5.26): مساحة العمل انتقلت إلى ملفها المستقل views/staffing.js — مصفوفة مسطّحة
// بأدراج وتحديد متعدد ودفعة ذرّية. تبقى مصدَّرة من هنا لأن أربعة اختبارات قائمة تستوردها من هذا
// الملف بالاسم، وbarrel pages.js يمرّرها عبره (ولا يُضاف staffing.js إلى الbarrel — ازدواج
// export * يُسقط الاسم كله بصمت).
export { staffingPage } from './staffing.js';

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
        <button onclick="Sanad.addSector()" style="color:#fff;border:none;cursor:pointer;padding:0 1rem;border-radius:8px;font-size:13px;background:var(--brand-grad)">+ قطاع</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:.5rem">الهيكل مرن بالكامل — تُضاف القطاعات/الإدارات من هنا دون تعديل الكود.</div></div>`)}
    <div style="font-weight:800;font-size:14px;margin:1.25rem 0 .5rem">الهيكل التنظيمي</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem">${sectorBlocks}</div>`;
  return layout({ user, active: 'org', title: 'الهيكل التنظيمي', subtitle: 'الشركة ← القطاع ← الإدارة ← الوحدة ← الفريق ← الموظف', body });
}
