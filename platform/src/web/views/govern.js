// Governance pages: approvals queue, users & roles, audit log, reports & mail.
import { layout, card, pill, hbars } from '../layout.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { myApprovalQueue } from '../../modules/workflow/engine.js';
import { canControlSchedules } from '../../core/reports/engine.js';
import {
  buildPeriodReport, comparePreviousSnapshot, listPeriodSnapshots, lensOptions,
  periodChoices, PERIOD_KINDS, PERIOD_LABELS_AR,
} from '../../core/reports/periods.js';
import { ROLE_LABELS } from '../../core/rbac/matrix.js';
import { resourceLabel, mailStatusLabel, mailStatusTone, auditActionLabel, reportName } from '../i18n/glossary.js';
import { esc, statMini } from './_shared.js';

export async function approvalsPage(user) {
  const q = await myApprovalQueue(user);
  const list = q.map((a) => `<tr class="border-b border-line">
    <td class="py-2.5 px-3 text-[13px]">${esc(a.workflow_name || '')}</td>
    <td class="px-3 text-[12px] text-muted">${esc(resourceLabel(a.resource))} · <span class="tnum">${esc(a.resource_id || '')}</span></td>
    <td class="px-3 text-[13px] tabular-nums">${fmtSar(a.amount_halalas)}</td>
    <td class="px-3">${pill('الخطوة ' + a.current_step, 'amber')}</td>
    <td class="px-3">
      <button onclick="Sanad.approve('${a.id}','approve')" class="text-[12px] text-green-700 font-bold">اعتماد</button>
      <button onclick="Sanad.approve('${a.id}','reject')" class="text-[12px] text-red-600 font-bold mr-2">رفض</button></td></tr>`).join('');
  const totalAmt = q.reduce((a, x) => a + (x.amount_halalas || 0), 0);
  const byRes = {}; for (const x of q) byRes[x.resource] = (byRes[x.resource] || 0) + 1;
  const resBreak = Object.entries(byRes).map(([r, n]) => `${resourceLabel(r)}: ${n}`).join(' · ') || '—';
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${statMini('بانتظار اعتمادك', q.length, 'طلب')}
    ${statMini('إجمالي المبالغ', fmtSar(totalAmt), 'قيمة قيد الاعتماد', 'brand')}
    ${statMini('حسب النوع', Object.keys(byRes).length, resBreak)}</div>`;
  const body = strip + card(`<div class="p-4 border-b border-line font-bold text-sm">طلبات بانتظار اعتمادك (${q.length})</div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">المسار</th><th class="px-3 font-medium">المورد</th><th class="px-3 font-medium">المبلغ</th>
      <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">إجراء</th></tr></thead>
      <tbody>${list || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا طلبات بانتظارك</td></tr>'}</tbody></table>`);
  return layout({ user, active: 'approvals', title: 'الاعتمادات', body });
}

// شاشة إدارة الهوية. كانت جدول قراءةٍ بلا زرّ واحد بينما يقول دليل التشغيل «أنشئ الحسابات من
// شاشة إدارة المستخدمين» — فكان على من يريد إضافة موظف أن يفتح سكربتاً ويشغّله على الخادم.
export async function usersPage(user) {
  // اسم القطاع بالعربية بدل رمزه المخزَّن (كان يظهر SOLUTIONS/CONSULTING للمستخدم).
  // القطاع المحذوف يبقى اسمه ظاهراً للسجلات التاريخية — لا فلترة deleted_at على وصلة التسمية.
  const rows = await all(`SELECT u.*, r.name_ar role_name, s.name_ar sector_name, e.name_ar employee_name
    FROM app_user u
    LEFT JOIN role r ON r.id = u.role_id
    LEFT JOIN sector s ON s.id = u.sector_id
    LEFT JOIN employee e ON e.id = u.employee_id
    WHERE u.deleted_at IS NULL
    ORDER BY CASE WHEN u.active = 0 AND u.last_login_at IS NULL THEN 0 WHEN u.active = 1 THEN 1 ELSE 2 END,
             u.role_id, u.name_ar LIMIT 300`);
  const sectors = await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL ORDER BY name_ar');

  // الدعوة المعلّقة تتصدّر الترتيب: هي أهم صفٍّ في الشاشة — شخصٌ يُفترض أنه يعمل على المنصة
  // وهو خارجها، ولا شيء آخر ينبّه إليه. وترتيبُها في القاع بين ثلاثمئة صف يخفيها تماماً.
  const roleAr = (u) => u.role_name || (ROLE_LABELS[u.role_id] || {}).ar || 'دور غير معروف';
  const list = rows.map((u) => {
    const isSelf = u.id === user.id;
    const pending = !u.active && !u.last_login_at;
    return `<tr class="border-b border-line" data-uid="${esc(u.id)}">
    <td class="py-2 px-3 text-[13px]">${esc(u.name_ar || '')}
      ${u.email
        ? `<div class="text-[11px] text-muted" dir="ltr" style="text-align:right">${esc(u.email)}</div>`
        : '<div class="text-[11px]" style="color:var(--red);font-weight:700">بلا بريد — لا يستطيع الدخول</div>'}</td>
    <td class="px-3">${pill(esc(roleAr(u)), 'blue')}</td>
    <td class="px-3 text-[12px]">${esc(u.sector_name || (u.sector_id ? 'قطاع غير معروف' : '—'))}</td>
    <td class="px-3">${pending ? pill('دعوة معلّقة', 'amber') : u.active ? pill('نشط', 'green') : pill('معطّل', 'red')}</td>
    <td class="px-3 text-[11px] text-muted tnum" style="white-space:nowrap">${u.last_login_at ? u.last_login_at.slice(0, 10) : 'لم يدخل بعد'}</td>
    <td class="px-3" style="white-space:nowrap">
      <button class="btn btn-sm" data-action="idn-edit" data-id="${esc(u.id)}">تعديل</button>
      <button class="btn btn-sm" data-action="idn-logins" data-id="${esc(u.id)}" title="سجل دخول هذا الحساب">السجل</button>
      ${u.email ? `<button class="btn btn-sm" data-action="idn-resend" data-id="${esc(u.id)}" title="${pending ? 'إعادة إرسال رمز التفعيل' : 'إرسال رمز دخول جديد'}">${pending ? 'إعادة الدعوة' : 'إرسال رمز'}</button>` : ''}
      ${isSelf
        ? '<span class="text-[11px] text-muted" style="padding:0 .4rem">حسابك</span>'
        : `<button class="btn btn-sm" data-action="idn-toggle" data-id="${esc(u.id)}" data-to="${u.active ? '0' : '1'}"
             style="color:${u.active ? '#b91c1c' : '#047857'}">${u.active ? 'تعطيل' : 'تفعيل'}</button>`}
    </td></tr>`;
  }).join('');

  const activeN = rows.filter((u) => u.active).length;
  const neverIn = rows.filter((u) => !u.last_login_at).length;
  const pendingN = rows.filter((u) => !u.active && !u.last_login_at).length;
  // البريد صار هوية الدخول، فحسابٌ بلا بريد ليس «ناقص بيانات» بل **عاجزٌ عن الدخول**.
  // يُعدّ صراحةً كي لا يُكتشف ذلك يوم يقف الموظف أمام شاشة لا تقبله.
  const noEmailN = rows.filter((u) => !u.email).length;
  const byRole = {}; for (const u of rows) { const r = roleAr(u); byRole[r] = (byRole[r] || 0) + 1; }
  const roleItems = Object.entries(byRole).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r, n], i) => ({ label: esc(r), value: n, color: ['var(--brand)', 'var(--brand2)', '#0891b2', '#059669', '#d97706', '#db2777'][i % 6] }));
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:.9rem">
    ${statMini('إجمالي المستخدمين', rows.length, `${Object.keys(byRole).length} دور`)}
    ${statMini('نشط', activeN, 'حسابات مفعّلة', 'good')}
    ${statMini('دعوة معلّقة', pendingN, 'أُنشئت ولم تُفعَّل', pendingN ? 'warn' : '')}
    ${statMini('بلا بريد', noEmailN, 'لا تستطيع الدخول', noEmailN ? 'bad' : '')}
    ${statMini('لم يسجّل دخولاً', neverIn, 'حسابات خاملة', neverIn ? 'warn' : '')}</div>`;

  const body = `${strip}
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:.9rem">
      ${card(`<div class="p-4 border-b border-line" style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
        <div class="font-bold text-sm" style="flex:1">حسابات الدخول (${rows.length})</div>
        <input class="input" id="idn-q" placeholder="ابحث بالاسم أو البريد" style="max-width:220px;font-size:12px">
        <button class="btn btn-primary btn-sm" data-action="idn-invite">دعوة موظف</button>
      </div>
      <div style="max-height:520px;overflow-x:auto;overflow-y:auto"><table class="w-full"><thead><tr class="text-[11px] text-muted text-right" style="position:sticky;top:0;background:var(--surface)">
        <th class="py-2 px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الدور</th><th class="px-3 font-medium">القطاع</th>
        <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">آخر دخول</th><th class="px-3 font-medium">الإجراءات</th></tr></thead>
        <tbody id="idn-rows">${list}</tbody></table></div>`)}
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">التوزيع حسب الدور</div><div style="padding:.7rem 1rem">${hbars(roleItems, { fmt: (v) => v + '' })}</div>`)}
    </div>
    <div class="mt-3 text-[11px] text-muted">التفويض يُنفَّذ على الخادم. تعطيل حسابك أو خفض دورك بنفسك ممنوع خادمياً، ولا يبقى النظام بلا مدير نظام نشط. والتعطيل يُنهي جلسات صاحبه فوراً.</div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      idnRoles:${JSON.stringify(Object.entries(ROLE_LABELS).map(([id, l]) => ({ id, ar: l.ar }))).replace(/</g, '\\u003c')},
      idnSectors:${JSON.stringify(sectors.map((s) => ({ id: s.id, ar: s.name_ar }))).replace(/</g, '\\u003c')},
      idnUsers:${JSON.stringify(Object.fromEntries(rows.map((u) => [u.id, {
        id: u.id, name_ar: u.name_ar, email: u.email, role_id: u.role_id, sector_id: u.sector_id, scope: u.scope, active: !!u.active,
      }]))).replace(/</g, '\\u003c')}});</script>`;
  return layout({ user, active: 'users', title: 'المستخدمون والصلاحيات', body, scripts: ['/static/pages/identity.js'] });
}

export async function auditPage(user) {
  const rows = await all('SELECT * FROM audit_log ORDER BY at DESC LIMIT 200');
  const today = new Date().toISOString().slice(0, 10);
  const todayN = rows.filter((a) => (a.at || '').slice(0, 10) === today).length;
  const distinctUsers = new Set(rows.map((a) => a.username || a.user_id).filter(Boolean)).size;
  const byAction = {}; for (const a of rows) { const k = a.action || '—'; byAction[k] = (byAction[k] || 0) + 1; }
  const actItems = Object.entries(byAction).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n], i) => ({ label: esc(auditActionLabel(k)), value: n, color: ['var(--brand)', 'var(--brand2)', '#059669', '#d97706', '#dc2626', '#0891b2'][i % 6] }));
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:.9rem">
    ${statMini('أحداث (آخر 200)', rows.length, 'مسجّلة')}
    ${statMini('اليوم', todayN, 'حدث اليوم', 'brand')}
    ${statMini('مستخدمون نشطون', distinctUsers, 'في السجل')}
    ${statMini('أنواع الإجراءات', Object.keys(byAction).length, 'مختلفة')}</div>`;
  const list = rows.map((a) => `<tr class="border-b border-line">
    <td class="py-1.5 px-3 text-[11px] text-muted tabular-nums">${a.at.slice(0, 19).replace('T', ' ')}</td>
    <td class="px-3 text-[12px]">${esc(a.username || a.user_id || '—')}</td>
    <td class="px-3">${pill(esc(auditActionLabel(a.action)), a.action === 'delete' ? 'red' : a.action === 'create' ? 'green' : 'slate')}</td>
    <td class="px-3 text-[12px]">${esc(resourceLabel(a.resource))} ${a.resource_id ? '· <span class="tnum">' + esc(a.resource_id) + '</span>' : ''}</td></tr>`).join('');
  const body = `${strip}
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:.9rem">
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">سجل التدقيق (آخر 200)</div>
      <div style="max-height:540px;overflow-y:auto"><table class="w-full"><thead><tr class="text-[11px] text-muted text-right" style="position:sticky;top:0;background:var(--surface)">
        <th class="py-2 px-3 font-medium">الوقت</th><th class="px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الإجراء</th>
        <th class="px-3 font-medium">المورد</th></tr></thead><tbody>${list}</tbody></table></div>`)}
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">التوزيع حسب نوع الإجراء</div><div style="padding:.7rem 1rem">${hbars(actItems, { fmt: (v) => v + '' })}</div>`)}
    </div>`;
  return layout({ user, active: 'audit', title: 'سجل التدقيق', body });
}

// أيام الأسبوع كما تُخزَّن في الجدولة (0 = الأحد) — تُعرض مع وقت الإرسال حتى يعرف المستخدم متى يصله التقرير.
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
function sendWhen(s) {
  const time = /^\d{1,2}:\d{2}$/.test(String(s.send_time || '')) ? s.send_time : '08:00';
  if (s.frequency === 'weekly' || s.frequency === 'biweekly') {
    const d = Number(s.day_of_week);
    return (Number.isInteger(d) && d >= 0 && d <= 6 ? DAYS_AR[d] + ' · ' : '') + time;
  }
  if (s.frequency === 'monthly' || s.frequency === 'quarterly' || s.frequency === 'yearly') {
    const d = Number(s.day_of_month);
    return (Number.isInteger(d) && d >= 1 && d <= 31 ? 'يوم ' + d + ' · ' : '') + time;
  }
  return time;
}
const whenText = (iso) => (iso ? `${iso.slice(0, 10)} · ${iso.slice(11, 16)}` : '—');

// ══════════════════ تقرير الفترة: اختر فترة وجهة، فيظهر التقرير فوراً ══════════════════
// قرار العرض المحوري: **الغياب لا يُرسم رقماً**. كل قيمة لا أساس لها تُعرض نصاً في إطار متقطّع
// ورمادي، وكل قيمة مقيسة تُعرض رقماً بلون واضح — كي لا يقرأ المالك «0» فيظنه قياساً وهو فراغ.
const TONE_VAR = { good: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)', '': 'var(--ink2)' };

function figureChip(f) {
  if (f.display == null) {
    return `<div style="min-width:150px;flex:1 1 150px;padding:.5rem .7rem;border:1px dashed var(--line);border-radius:10px;background:#fbfcfe">
      <div style="font-size:var(--fs-micro);color:var(--muted);font-weight:700">${esc(f.label_ar)}</div>
      <div style="font-size:var(--fs-meta);color:var(--faint);line-height:1.7;margin-top:.15rem">${esc(f.absence_ar || 'لا قياس متاح')}</div></div>`;
  }
  return `<div style="min-width:150px;flex:1 1 150px;padding:.5rem .7rem;border:1px solid var(--line);border-radius:10px;background:#fff">
    <div style="font-size:var(--fs-micro);color:var(--muted);font-weight:700">${esc(f.label_ar)}</div>
    <div class="tnum" style="font-size:var(--fs-num-sm);font-weight:800;color:${TONE_VAR[f.tone || ''] || TONE_VAR['']}">${esc(f.display)}</div></div>`;
}

function sectionCard(s) {
  if (s.state === 'absent') {
    return card(`<div class="empty-state" style="padding:1.3rem 1rem">
      <div class="t">${esc(s.title_ar)} — ${esc(s.absence_ar)}</div>
      ${s.hint_ar ? `<div class="s">${esc(s.hint_ar)}</div>` : ''}</div>`);
  }
  const rows = (s.rows || []).length ? `<div style="margin-top:.7rem;border-top:1px dashed var(--line);padding-top:.5rem">
    <div style="font-size:var(--fs-micro);color:var(--muted);font-weight:700;margin-bottom:.35rem">${esc(s.rows_title_ar || '')}</div>
    ${s.rows.map((r) => `<div style="display:flex;gap:.6rem;justify-content:space-between;align-items:baseline;padding:.28rem 0;font-size:var(--fs-body)">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${esc(r.title)}</b>${r.sub ? ` <span style="color:var(--muted)">· ${esc(r.sub)}</span>` : ''}</span>
      <span style="flex:none;color:${TONE_VAR[r.tone || ''] || TONE_VAR['']};font-size:var(--fs-meta);font-weight:700">${esc(r.meta || '')}</span></div>`).join('')}
  </div>` : '';
  return card(`<div style="padding:.8rem 1rem">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:.6rem;margin-bottom:.5rem">
      <span style="font-weight:800;font-size:var(--fs-title)">${esc(s.title_ar)}</span>
      ${s.basis_ar ? `<span style="font-size:var(--fs-micro);color:var(--faint);text-align:end">${esc(s.basis_ar)}</span>` : ''}
    </div>
    <div style="display:flex;gap:.45rem;flex-wrap:wrap">${s.figures.map(figureChip).join('')}</div>
    ${rows}
    ${s.note_ar ? `<div style="font-size:var(--fs-micro);color:var(--muted);margin-top:.55rem">${esc(s.note_ar)}</div>` : ''}
  </div>`);
}

// «الجهة» قائمة واحدة تجمع العدسات الست: قرار واحد بدل قائمتين متتاليتين.
function scopeSelect(options, selected) {
  const grp = (label, items, lens) => (items.length
    ? `<optgroup label="${esc(label)}">${items.map((i) => {
      const v = `${lens}:${i.id}`;
      return `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(i.name_ar || '')}${i.sector_name ? ` — ${esc(i.sector_name)}` : ''}</option>`;
    }).join('')}</optgroup>`
    : '');
  return `<select id="rp-scope" name="scope" class="input" aria-label="جهة التقرير" style="min-width:230px">
    ${options.company ? `<option value="company:"${selected === 'company:' ? ' selected' : ''}>الشركة كاملة</option>` : ''}
    ${grp('القطاعات', options.sectors, 'sector')}
    ${grp('الإدارات', options.departments, 'department')}
    ${grp('الأشخاص', options.people, 'person')}
    ${grp('المشاريع', options.projects, 'project')}
    ${grp('الفرص', options.opportunities, 'opportunity')}
  </select>`;
}

async function periodReportBlock(user, opts = {}) {
  const options = await lensOptions(user);
  const kind = PERIOD_KINDS.includes(String(opts.period)) ? String(opts.period) : 'week';
  const choices = periodChoices(kind, new Date(), 8);
  const anchor = choices.some((c) => c.anchor === opts.anchor) ? opts.anchor : choices[0].anchor;

  // الجهة الافتراضية تأتي محسوبة من نفس شروط الفتح (لا اجتهاد ثانٍ هنا).
  const scope = typeof opts.scope === 'string' && opts.scope.includes(':') ? opts.scope : options.defaultScope;
  const [lens, rawTarget] = scope.split(':');
  const targetId = rawTarget || null;

  const toolbar = `<form id="rp-form" method="get" action="/app/reports" class="toolbar" style="margin-bottom:.8rem;gap:.5rem">
    ${scopeSelect(options, scope)}
    <select id="rp-kind" name="period" class="input" aria-label="نوع الفترة">
      ${PERIOD_KINDS.map((k) => `<option value="${k}"${k === kind ? ' selected' : ''}>${esc(PERIOD_LABELS_AR[k])}</option>`).join('')}
    </select>
    <select id="rp-anchor" name="anchor" class="input" aria-label="الفترة" style="min-width:200px">
      ${choices.map((c) => `<option value="${esc(c.anchor)}"${c.anchor === anchor ? ' selected' : ''}>${esc(c.label_ar)}${c.current ? ' — الحالية' : ''}</option>`).join('')}
    </select>
    <button type="submit" class="btn btn-primary">اعرض التقرير</button>
  </form>`;

  let report;
  try {
    report = await buildPeriodReport(user, { period: kind, anchor, lens, targetId });
  } catch (e) {
    return toolbar + card(`<div class="empty-state" style="padding:1.6rem 1rem">
      <div class="t">تعذّر عرض هذا التقرير</div>
      <div class="s">${esc(e.message || 'اختر جهة أخرى من القائمة.')}</div></div>`);
  }

  const [snapshots, cmp] = await Promise.all([
    listPeriodSnapshots(user, { lens, targetId }).catch(() => []),
    comparePreviousSnapshot(user, report).catch(() => ({ available: false, message_ar: '' })),
  ]);

  const q = `period=${encodeURIComponent(kind)}&anchor=${encodeURIComponent(anchor)}&lens=${encodeURIComponent(lens)}&targetId=${encodeURIComponent(targetId || '')}`;
  const stateChip = report.period.future ? pill('لم تبدأ بعد', 'slate')
    : report.period.partial ? pill('فترة جارية — حتى تاريخه', 'amber') : pill('فترة مكتملة', 'green');

  const head = card(`<div style="padding:.9rem 1.1rem">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;flex-wrap:wrap">
      <div>
        <div style="font-weight:800;font-size:var(--fs-page)">${esc(report.title_ar)}</div>
        <div style="font-size:var(--fs-body);color:var(--muted);margin-top:.15rem">${esc(report.period.label_ar)} · ${esc(report.target.kind_ar)}${report.target.parent_ar ? ` · ${esc(report.target.parent_ar)}` : ''}</div>
        <div style="margin-top:.4rem">${stateChip}</div>
      </div>
      <div style="display:flex;gap:.45rem;flex-wrap:wrap">
        <a class="btn btn-sm" target="_blank" rel="noopener" href="/api/reports/period/print?${q}">طباعة</a>
        <form method="post" action="/api/reports/period/issue" target="_blank" style="display:inline">
          <input type="hidden" name="period" value="${esc(kind)}"><input type="hidden" name="anchor" value="${esc(anchor)}">
          <input type="hidden" name="lens" value="${esc(lens)}"><input type="hidden" name="targetId" value="${esc(targetId || '')}">
          <button type="submit" class="btn btn-sm btn-primary">إصدار وحفظ نسخة</button>
        </form>
      </div>
    </div>
    ${report.context.length ? `<div style="display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.7rem;padding-top:.6rem;border-top:1px dashed var(--line)">
      <div style="width:100%;font-size:var(--fs-micro);color:var(--faint);font-weight:700;margin-bottom:.2rem">سياق منذ بداية السنة — خارج حدود الفترة</div>
      ${report.context.map((c) => `<div style="min-width:140px;padding:.4rem .6rem;border:1px solid var(--line);border-radius:10px">
        <div style="font-size:var(--fs-micro);color:var(--muted)">${esc(c.label_ar)}</div>
        <div class="tnum" style="font-size:var(--fs-ui);font-weight:800;color:var(--ink2)">${esc(c.display)}</div></div>`).join('')}
    </div>` : ''}
  </div>`);

  const compare = card(`<div style="padding:.8rem 1rem">
    <div style="font-weight:800;font-size:var(--fs-title);margin-bottom:.4rem">مقارنة بالفترة السابقة</div>
    ${cmp.available
    ? (cmp.deltas || []).length
      ? cmp.deltas.map((d) => `<div style="display:flex;justify-content:space-between;gap:.6rem;font-size:var(--fs-body);padding:.22rem 0">
          <span style="color:var(--muted)">${esc(d.section_ar)} · ${esc(d.label_ar)}</span>
          <span class="tnum" style="font-weight:700">${esc(d.before)} ← ${esc(d.after)}</span></div>`).join('')
      : `<div style="font-size:var(--fs-body);color:var(--muted)">لا فرق بين ${esc(cmp.period_label)} وهذه الفترة في الأرقام المحفوظة.</div>`
    : `<div style="font-size:var(--fs-body);color:var(--muted)">${esc(cmp.message_ar || 'لا نسخة محفوظة للفترة السابقة.')}</div>`}
  </div>`);

  const saved = card(`<div style="padding:.8rem 1rem">
    <div style="font-weight:800;font-size:var(--fs-title);margin-bottom:.4rem">النسخ المحفوظة لهذه الجهة</div>
    ${snapshots.length
    ? snapshots.slice(0, 8).map((s) => `<div style="display:flex;justify-content:space-between;gap:.6rem;font-size:var(--fs-body);padding:.22rem 0">
        <a target="_blank" rel="noopener" href="/api/reports/period/snapshot/${esc(s.id)}" style="color:var(--brand);font-weight:700">${esc(s.period_label || '')}</a>
        <span style="color:var(--muted);font-size:var(--fs-meta)" class="tnum">${esc(String(s.created_at || '').slice(0, 10))}${s.created_by_name ? ` · ${esc(s.created_by_name)}` : ''}</span></div>`).join('')
    : '<div style="font-size:var(--fs-body);color:var(--muted)">لا نسخ محفوظة بعد — «إصدار وحفظ نسخة» يحفظ صورة الفترة كما هي اليوم لتُقارن لاحقاً.</div>'}
  </div>`);

  return `${toolbar}${head}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:.7rem;margin-top:.7rem">
      ${report.sections.map(sectionCard).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.7rem">${compare}${saved}</div>`;
}

export async function reportsPage(user, opts = {}) {
  const defs = await all('SELECT * FROM report_definition WHERE active = 1 ORDER BY id');
  const groups = await all('SELECT * FROM recipient_group ORDER BY name_ar');
  const schedules = await all('SELECT rs.*, rd.name_ar rname, rd.key rkey, rg.name_ar gname FROM report_schedule rs JOIN report_definition rd ON rd.id = rs.report_id LEFT JOIN recipient_group rg ON rg.id = rs.recipient_group_id ORDER BY rs.created_at DESC LIMIT 50');
  const outbox = await all('SELECT * FROM email_queue ORDER BY created_at DESC LIMIT 15');
  const freqAr = { daily: 'يومي', weekly: 'أسبوعي', biweekly: 'كل أسبوعين', monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي' };
  // من لا يملك التحكم في الجدولة لا يرى أزراراً لا تعمل معه — والقرار نفسه يُفحص في الخدمة على الخادم.
  const mayControl = canControlSchedules(user);

  const reportCards = defs.map((d) => card(`<div style="padding:.9rem 1rem">
    <div style="font-weight:700;font-size:var(--fs-ui);margin-bottom:.5rem">${esc(reportName(d.key, d.name_ar))}</div>
    <div style="display:flex;gap:.4rem">
      <button onclick="Sanad.previewReport('${d.key}')" class="text-white" style="border:none;cursor:pointer;font-size:11px;padding:.35rem .6rem;border-radius:8px;background:var(--brand-grad)">معاينة</button>
      <button onclick="Sanad.testSend('${d.key}')" style="border:1px solid var(--line);cursor:pointer;font-size:11px;padding:.35rem .6rem;border-radius:8px;background:#fff">إرسال تجريبي</button>
    </div></div>`, 'card-h')).join('');

  const schedList = schedules.map((s) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:var(--fs-ui)">${esc(reportName(s.rkey, s.rname))}</td>
    <td style="padding:.5rem .75rem;font-size:12px">${esc(freqAr[s.frequency] || s.frequency || '')}
      <div style="font-size:11px;color:var(--muted)" class="tnum">${esc(sendWhen(s))}</div></td>
    <td style="padding:.5rem .75rem;font-size:12px;color:var(--muted)">${esc(s.gname || '—')}</td>
    <td style="padding:.5rem .75rem">${s.active ? pill('مفعّل', 'green') : pill('موقوف', 'slate')}</td>
    <td style="padding:.5rem .75rem;font-size:11px;color:var(--muted)" class="tnum">${esc(s.active ? whenText(s.next_run_at) : '—')}</td>
    <td style="padding:.5rem .75rem">${mayControl ? `<button type="button" data-schedule="${esc(s.id)}" data-turn="${s.active ? '0' : '1'}"
        title="${s.active ? 'إيقاف الإرسال لهذه الجدولة' : 'إعادة تفعيل الإرسال لهذه الجدولة'}"
        style="border:1px solid var(--line);cursor:pointer;font-size:11px;padding:.3rem .6rem;border-radius:8px;background:#fff;color:${s.active ? '#b91c1c' : '#047857'}">${s.active ? 'إيقاف' : 'تفعيل'}</button>` : '<span style="font-size:11px;color:var(--muted)">—</span>'}</td></tr>`).join('');
  const outList = outbox.map((q) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:12px">${esc(q.subject || '')}</td>
    <td style="padding:.5rem .75rem">${pill(esc(mailStatusLabel(q.status)), mailStatusTone(q.status))}</td>
    <td style="padding:.5rem .75rem;font-size:11px;color:var(--muted)">${q.created_at.slice(0, 16).replace('T', ' ')}</td></tr>`).join('');

  const body = `
    <div style="font-weight:800;font-size:var(--fs-page);margin-bottom:.5rem">تقرير الفترة</div>
    ${await periodReportBlock(user, opts)}
    <div style="height:1px;background:var(--line);margin:1.6rem 0 1.1rem"></div>
    <div style="font-weight:800;font-size:var(--fs-title);margin-bottom:.5rem">التقارير المتاحة</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.25rem">${reportCards}</div>
    ${!mayControl ? card(`<div style="padding:1rem;font-size:var(--fs-ui);color:var(--muted)">جدولة التقارير تتطلب صلاحية إدارية. تستطيع هنا معاينة أي تقرير أو إرسال نسخة تجريبية إلى بريدك.</div>`)
    : card(`<div style="padding:1rem"><div style="font-weight:800;font-size:var(--fs-title);margin-bottom:.6rem">جدولة تقرير جديد</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
        <select id="sch-report" aria-label="التقرير" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;font-size:var(--fs-ui)">${defs.map((d) => `<option value="${esc(d.id)}">${esc(reportName(d.key, d.name_ar))}</option>`).join('')}</select>
        <select id="sch-freq" aria-label="تكرار الإرسال" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;font-size:var(--fs-ui)">${Object.entries(freqAr).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select id="sch-group" aria-label="مجموعة المستلمين" style="border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;font-size:var(--fs-ui)"><option value="">— مجموعة مستلمين —</option>${groups.map((g) => `<option value="${g.id}">${g.name_ar}</option>`).join('')}</select>
        <input id="sch-time" type="time" value="08:00" aria-label="وقت الإرسال" style="border:1px solid var(--line);border-radius:8px;padding:.35rem .5rem;font-size:var(--fs-ui)">
        <button onclick="Sanad.addSchedule()" class="text-white" style="border:none;cursor:pointer;font-size:var(--fs-ui);padding:.45rem 1rem;border-radius:8px;background:var(--brand-grad)">جدولة</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:.5rem">الصلاحيات تُنفَّذ لكل مستلم وقت الإرسال — لا تُرسَل الأرقام الحساسة لمن لا يملك صلاحيتها.</div></div>`)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1.25rem">
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:var(--fs-ui)">التقارير المجدولة</div>
        <div id="sched-list"><table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">التقرير</th><th style="padding:.4rem .75rem">التكرار</th><th style="padding:.4rem .75rem">المستلمون</th><th style="padding:.4rem .75rem">الحالة</th><th style="padding:.4rem .75rem">التالي</th><th style="padding:.4rem .75rem">إجراء</th></tr></thead><tbody>${schedList || '<tr><td style="padding:1rem;color:var(--muted);font-size:var(--fs-ui)" colspan="6">لا جداول بعد</td></tr>'}</tbody></table></div>
        <div id="sched-msg" role="alert" style="display:none;margin:0 1rem .8rem;padding:.5rem .7rem;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:12px"></div>
        ${mayControl ? '<div style="padding:0 1rem 1rem;font-size:11px;color:var(--muted)">الإيقاف يمنع أي إرسال قادم لهذه الجدولة، والتفعيل يعيدها بموعدها القادم حسب وقت الإرسال المحدد.</div>' : ''}`)}
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:var(--fs-ui)">سجل الرسائل الصادرة</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">الموضوع</th><th style="padding:.4rem .75rem">الحالة</th><th style="padding:.4rem .75rem">الوقت</th></tr></thead><tbody>${outList || '<tr><td style="padding:1rem;color:var(--muted);font-size:var(--fs-ui)" colspan="3">لا رسائل بعد</td></tr>'}</tbody></table>`)}
    </div>
    <div id="report-preview" style="margin-top:1rem"></div>
    <script>
    (function () {
      var box = document.getElementById('sched-list');
      var msg = document.getElementById('sched-msg');
      if (!box) return;
      function fail(text) { if (msg) { msg.textContent = text; msg.style.display = 'block'; } }
      box.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-schedule]') : null;
        if (!btn) return;
        var turn = btn.getAttribute('data-turn') === '1' ? 1 : 0;
        btn.disabled = true;
        if (msg) { msg.style.display = 'none'; }
        fetch('/app/reports/schedule/' + encodeURIComponent(btn.getAttribute('data-schedule')) + '/active', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{"active":' + turn + '}',
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) throw new Error((j && j.error && j.error.message) || 'تعذّر تنفيذ الإجراء الآن. حدّث الصفحة وحاول مجدداً.');
            location.reload();
          });
        }).catch(function (e) {
          btn.disabled = false;
          fail(e && e.message ? e.message : 'تعذّر تنفيذ الإجراء الآن. حدّث الصفحة وحاول مجدداً.');
        });
      });
    })();
    </script>`;
  return layout({ user, active: 'reports', title: 'التقارير والبريد',
    subtitle: 'تقرير أسبوعي أو شهري أو ربعي يظهر فوراً · مع جدولة الإرسال الدوري',
    body, scripts: ['/static/pages/reports-period.js'] });
}
