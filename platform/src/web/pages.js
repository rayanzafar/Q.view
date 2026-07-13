import { layout, card, pill } from './layout.js';
import { fmtSar } from '../core/util/ids.js';
import { all, get } from '../core/db/index.js';
import { companyOverview, sectorDashboard, projectKpis } from '../core/reports/metrics.js';
import { listOpportunities, pipelineSummary } from '../modules/crm/opportunities.js';
import { listProjects } from '../modules/pmo/projects.js';
import { myTasks } from '../modules/pmo/tasks.js';
import { myEntries } from '../modules/timesheets/timesheets.js';
import { myApprovalQueue } from '../modules/workflow/engine.js';
import { canSeeSensitive } from '../core/rbac/index.js';

const pct = (n) => `${Math.round(n || 0)}%`;
const bar = (p, color = '#2563eb') => `<div class="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
  <div style="width:${Math.min(100, Math.max(0, p))}%;background:${color}" class="h-full rounded-full"></div></div>`;

export function loginPage(err) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>دخول — سند</title>
<script src="/static/tailwind.js"></script></head>
<body class="min-h-screen flex items-center justify-center p-4" style="background:linear-gradient(168deg,#11295c,#1c2a63 42%,#3a1660);font-family:'Segoe UI',Tahoma,sans-serif">
<form method="post" action="/auth/login-web" class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
  <div class="text-center mb-6">
    <div class="text-2xl font-extrabold" style="background:linear-gradient(120deg,#2563eb,#9333ea);-webkit-background-clip:text;background-clip:text;color:transparent">EVC · سند</div>
    <div class="text-sm font-bold text-slate-700 mt-2">منصة إدارة الأعمال المؤسسية</div>
    <div class="text-xs text-slate-400 mt-0.5">رؤية الخبراء الاستشارية</div>
  </div>
  ${err ? `<div class="text-xs text-red-600 mb-3 text-center bg-red-50 rounded-lg py-2">${err}</div>` : ''}
  <label class="block text-xs text-slate-500 mb-1">اسم المستخدم</label>
  <input name="username" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 mb-3 text-sm" placeholder="firstname.lastname" autofocus>
  <label class="block text-xs text-slate-500 mb-1">كلمة المرور</label>
  <input name="password" type="password" class="w-full px-3 py-2.5 rounded-lg border border-slate-200 mb-4 text-sm">
  <button class="w-full py-2.5 rounded-lg text-white font-semibold text-sm" style="background:linear-gradient(120deg,#2563eb,#9333ea)">دخول</button>
</form></body></html>`;
}

export function ceoPage(user) {
  const ov = companyOverview(user);
  const t = ov.totals;
  const heroKpi = (label, val, target, p, color) => `
    <div class="text-white/70 text-[13px]">${label}</div>
    <div class="text-3xl font-extrabold text-white mt-1">${fmtSar(val)}</div>
    <div class="text-white/60 text-[12px]">من ${fmtSar(target)}</div>
    ${bar(p, color)}<div class="text-white/80 text-xs mt-1">${pct(p)}</div>`;
  const sectorCards = ov.sectors.map((s) => card(`
    <div class="p-4">
      <div class="flex items-center justify-between">
        <div><div class="font-bold text-[15px]">${s.name_ar}</div><div class="text-[11px] text-muted">${s.name_en || ''}</div></div>
        ${s.placeholder ? pill('بانتظار التفعيل', 'amber') : pill(`${s.opp_count} فرصة`, 'blue')}
      </div>
      <div class="grid grid-cols-2 gap-3 mt-3">
        <div><div class="text-[11px] text-muted">الإيراد ${pct(s.revenue_pct)}</div>
          <div class="text-sm font-bold">${fmtSar(s.revenue_halalas)}</div>${bar(s.revenue_pct, '#059669')}</div>
        <div><div class="text-[11px] text-muted">المبيعات ${pct(s.sales_pct)}</div>
          <div class="text-sm font-bold">${fmtSar(s.sales_halalas)}</div>${bar(s.sales_pct, s.color || '#2563eb')}</div>
      </div>
    </div>`, 'hover:shadow-md transition')).join('');
  const body = `
    <div class="rounded-2xl p-6 mb-5 text-white" style="background:linear-gradient(135deg,#11295c,#1c2a63,#3a1660)">
      <div class="text-white/60 text-xs mb-1">لوحة الرئيس التنفيذي · السنة المالية ${ov.fiscalYear}</div>
      <div class="text-2xl font-extrabold mb-4">الأداء على مستوى الشركة</div>
      <div class="grid grid-cols-2 gap-6">
        <div>${heroKpi('إجمالي الإيرادات المحققة', t.revenue, t.target_revenue, t.target_revenue ? t.revenue / t.target_revenue * 100 : 0, '#34d399')}</div>
        <div>${heroKpi('إجمالي المبيعات المحققة', t.sales, t.target_sales, t.target_sales ? t.sales / t.target_sales * 100 : 0, '#c07bff')}</div>
      </div>
    </div>
    <div class="text-sm font-bold mb-2">أداء القطاعات</div>
    <div class="grid grid-cols-2 gap-4 mb-5">${sectorCards}</div>
    ${card(`<div class="p-4 flex items-center justify-between">
      <div><div class="text-[13px] text-muted">إجمالي خط الفرص على مستوى الشركة</div>
        <div class="text-2xl font-extrabold">${fmtSar(ov.pipeline_halalas)}</div></div>
      <div class="text-left"><div class="text-[11px] text-muted">مستهدف المبيعات</div>
        <div class="text-sm font-bold">${fmtSar(t.target_sales)}</div></div></div>`)}`;
  return layout({ user, active: 'ceo', title: 'لوحة الرئيس التنفيذي', body });
}

export function sectorPage(user) {
  const sectorId = user.sector_id || 'SOLUTIONS';
  const sd = sectorDashboard(user, sectorId);
  const pipe = pipelineSummary(user);
  if (!sd) return layout({ user, active: 'sector', title: 'مركز القطاع', body: '<div class="text-muted">لا يوجد قطاع مرتبط</div>' });
  const stat = (label, val) => card(`<div class="p-4"><div class="text-[11px] text-muted">${label}</div><div class="text-2xl font-extrabold mt-1">${val}</div></div>`);
  const pipeRow = pipe.map((s) => `<div class="flex items-center gap-2 text-[13px] py-1">
    <span class="w-2 h-2 rounded-full" style="background:${s.color}"></span>
    <span class="flex-1">${s.name_ar}</span><span class="font-bold">${s.count}</span>
    <span class="text-muted text-[11px]">${fmtSar(s.value_halalas)}</span></div>`).join('');
  const body = `
    <div class="grid grid-cols-4 gap-4 mb-5">
      ${stat('إيراد القطاع', fmtSar(sd.revenue_halalas))}
      ${stat('مشاريع قائمة', sd.projects.IN_PROGRESS || 0)}
      ${stat('مخاطر مفتوحة', sd.openRisks)}
      ${stat('مخرجات مسلّمة', sd.deliverables.DELIVERED || 0)}
    </div>
    <div class="grid grid-cols-2 gap-4">
      ${card(`<div class="p-4"><div class="font-bold text-sm mb-2">خط الفرص</div>${pipeRow}</div>`)}
      ${card(`<div class="p-4"><div class="font-bold text-sm mb-2">حالة المشاريع (RAG)</div>
        <div class="flex gap-3 mt-2">
          ${pill('أخضر ' + (sd.rag.GREEN || 0), 'green')}
          ${pill('أصفر ' + (sd.rag.AMBER || 0), 'amber')}
          ${pill('أحمر ' + (sd.rag.RED || 0), 'red')}
        </div></div>`)}
    </div>`;
  return layout({ user, active: 'sector', title: `مركز القطاع — ${sd.sector.name_ar}`, body });
}

export function opportunitiesPage(user) {
  const rows = listOpportunities(user);
  const stages = Object.fromEntries(all('SELECT id,name_ar,color FROM stage').map((s) => [s.id, s]));
  const list = rows.slice(0, 100).map((o) => {
    const st = stages[o.stage_id] || {};
    return `<tr class="border-b border-line hover:bg-slate-50">
      <td class="py-2.5 px-3 text-[13px]">${o.title_ar}</td>
      <td class="px-3">${pill(st.name_ar || o.stage_id, 'blue')}</td>
      <td class="px-3 text-[13px] tabular-nums">${fmtSar(o.value_halalas)}</td>
      <td class="px-3 text-[12px] text-muted">${pct(o.win_pct)}</td></tr>`;
  }).join('');
  const body = `${card(`
    <div class="p-4 flex items-center justify-between border-b border-line">
      <div class="font-bold text-sm">الفرص (${rows.length})</div>
      <button onclick="Sanad.quickOpp()" class="text-white text-[12px] px-3 py-1.5 rounded-lg" style="background:linear-gradient(120deg,#2563eb,#9333ea)">+ فرصة جديدة</button>
    </div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">العنوان</th><th class="px-3 font-medium">المرحلة</th>
      <th class="px-3 font-medium">القيمة</th><th class="px-3 font-medium">الاحتمالية</th></tr></thead>
      <tbody>${list || '<tr><td class="p-4 text-muted text-sm" colspan="4">لا توجد فرص ضمن نطاقك</td></tr>'}</tbody></table>`)}`;
  return layout({ user, active: 'opportunities', title: 'الفرص', body });
}

export function projectsPage(user) {
  const rows = listProjects(user);
  const canCost = canSeeSensitive(user, 'cost');
  const ragColor = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
  const list = rows.slice(0, 100).map((p) => `<tr class="border-b border-line hover:bg-slate-50">
    <td class="py-2.5 px-3 text-[13px]">${p.name_ar}</td>
    <td class="px-3">${pill(p.status, p.status === 'COMPLETED' ? 'green' : 'blue')}</td>
    <td class="px-3">${pill(p.rag, ragColor[p.rag] || 'slate')}</td>
    <td class="px-3 text-[13px] tabular-nums">${fmtSar(p.contract_value_halalas)}</td>
    <td class="px-3 text-[12px]">${canCost && !p._redacted_actual_spend_halalas ? fmtSar(p.actual_spend_halalas) : '<span class="text-slate-300">•••</span>'}</td>
    <td class="px-3 text-[12px] text-muted">${pct(p.progress_pct)}</td></tr>`).join('');
  const body = `${card(`
    <div class="p-4 flex items-center justify-between border-b border-line">
      <div class="font-bold text-sm">المشاريع (${rows.length})</div>
      ${canCost ? pill('ترى التكلفة الفعلية', 'green') : pill('التكلفة محجوبة عنك', 'slate')}
    </div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">المشروع</th><th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">RAG</th>
      <th class="px-3 font-medium">قيمة العقد</th><th class="px-3 font-medium">الصرف الفعلي</th><th class="px-3 font-medium">الإنجاز</th></tr></thead>
      <tbody>${list || '<tr><td class="p-4 text-muted text-sm" colspan="6">لا مشاريع ضمن نطاقك</td></tr>'}</tbody></table>`)}`;
  return layout({ user, active: 'projects', title: 'المشاريع', body });
}

export function tasksPage(user) {
  const rows = myTasks(user);
  const stColor = { TODO: 'slate', IN_PROGRESS: 'blue', BLOCKED: 'red', IN_REVIEW: 'amber', DONE: 'green' };
  const list = rows.map((t) => `<tr class="border-b border-line hover:bg-slate-50" data-task="${t.id}">
    <td class="py-2.5 px-3 text-[13px]">${t.title}</td>
    <td class="px-3">${pill(t.priority, t.priority === 'P0' ? 'red' : t.priority === 'P1' ? 'amber' : 'slate')}</td>
    <td class="px-3">${pill(t.status, stColor[t.status])}</td>
    <td class="px-3 text-[12px] text-muted">${t.due_date || '—'}</td>
    <td class="px-3"><select onchange="Sanad.setTaskStatus('${t.id}',this.value)" class="text-[12px] border border-line rounded px-1 py-0.5">
      ${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}
    </select></td></tr>`).join('');
  const body = `
    ${card(`<div class="p-4 border-b border-line">
      <div class="font-bold text-sm mb-2">إضافة سريعة</div>
      <div class="flex gap-2">
        <input id="qa-title" placeholder="عنوان المهمة…" class="flex-1 border border-line rounded-lg px-3 py-2 text-sm">
        <select id="qa-priority" class="border border-line rounded-lg px-2 text-sm"><option>P2</option><option>P0</option><option>P1</option><option>P3</option></select>
        <input id="qa-due" type="date" class="border border-line rounded-lg px-2 text-sm">
        <button onclick="Sanad.quickTask()" class="text-white text-[12px] px-4 rounded-lg" style="background:linear-gradient(120deg,#2563eb,#9333ea)">إضافة</button>
      </div></div>
      <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
        <th class="py-2 px-3 font-medium">المهمة</th><th class="px-3 font-medium">الأولوية</th><th class="px-3 font-medium">الحالة</th>
        <th class="px-3 font-medium">الاستحقاق</th><th class="px-3 font-medium">تحديث</th></tr></thead>
        <tbody id="task-rows">${list || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا مهام — أضف واحدة بالأعلى</td></tr>'}</tbody></table>`)}`;
  return layout({ user, active: 'tasks', title: 'مهامي', body });
}

export function timesheetPage(user) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const rows = myEntries(user, { from, to });
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
        <input id="ts-date" type="date" value="${to}" class="border border-line rounded-lg px-2 py-2 text-sm">
        <input id="ts-hours" type="number" step="0.5" min="0" max="16" placeholder="ساعات" class="border border-line rounded-lg px-3 py-2 text-sm w-24">
        <select id="ts-kind" class="border border-line rounded-lg px-2 text-sm">
          ${['project', 'opportunity', 'proposal', 'product', 'internal', 'leave', 'training', 'bd'].map((k) => `<option>${k}</option>`).join('')}
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

export function approvalsPage(user) {
  const q = myApprovalQueue(user);
  const list = q.map((a) => `<tr class="border-b border-line">
    <td class="py-2.5 px-3 text-[13px]">${a.workflow_name}</td>
    <td class="px-3 text-[12px] text-muted">${a.resource} · ${a.resource_id}</td>
    <td class="px-3 text-[13px] tabular-nums">${fmtSar(a.amount_halalas)}</td>
    <td class="px-3">${pill('الخطوة ' + a.current_step, 'amber')}</td>
    <td class="px-3">
      <button onclick="Sanad.approve('${a.id}','approve')" class="text-[12px] text-green-700 font-bold">اعتماد</button>
      <button onclick="Sanad.approve('${a.id}','reject')" class="text-[12px] text-red-600 font-bold mr-2">رفض</button></td></tr>`).join('');
  const body = card(`<div class="p-4 border-b border-line font-bold text-sm">طلبات بانتظار اعتمادك (${q.length})</div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">المسار</th><th class="px-3 font-medium">المورد</th><th class="px-3 font-medium">المبلغ</th>
      <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">إجراء</th></tr></thead>
      <tbody>${list || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا طلبات بانتظارك</td></tr>'}</tbody></table>`);
  return layout({ user, active: 'approvals', title: 'الاعتمادات', body });
}

export function teamPage(user) {
  const canSalary = canSeeSensitive(user, 'salary');
  const rows = all("SELECT * FROM employee WHERE deleted_at IS NULL " +
    (user.scope === 'company' ? '' : 'AND sector_id = ?') + ' ORDER BY name_ar LIMIT 200',
    user.scope === 'company' ? [] : [user.sector_id]);
  const totalSalary = canSalary ? rows.reduce((a, r) => a + (r.salary_halalas || 0), 0) : null;
  const list = rows.map((e) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[13px]">${e.name_ar}</td>
    <td class="px-3 text-[12px] text-muted">${e.job_title || ''}</td>
    <td class="px-3 text-[12px]">${e.employment_type || ''}</td>
    <td class="px-3 text-[13px] tabular-nums">${canSalary ? fmtSar(e.salary_halalas) : '<span class="text-slate-300">••• محجوب</span>'}</td></tr>`).join('');
  const body = `
    ${canSalary ? card(`<div class="p-4 mb-4"><div class="text-[11px] text-muted">إجمالي فاتورة الرواتب الشهرية (${rows.length} عضو)</div>
      <div class="text-2xl font-extrabold">${fmtSar(totalSalary)}</div></div>`) : `<div class="mb-4">${pill('الرواتب محجوبة عن دورك — تظهر لمدير النظام والموارد البشرية فقط', 'slate')}</div>`}
    ${card(`<table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">الاسم</th><th class="px-3 font-medium">المسمى</th><th class="px-3 font-medium">النوع</th>
      <th class="px-3 font-medium">الراتب</th></tr></thead><tbody>${list}</tbody></table>`)}`;
  return layout({ user, active: 'team', title: 'الفريق', body });
}

export function usersPage(user) {
  const rows = all(`SELECT u.*, r.name_ar role_name FROM app_user u LEFT JOIN role r ON r.id = u.role_id
    WHERE u.deleted_at IS NULL ORDER BY u.role_id, u.name_ar LIMIT 300`);
  const list = rows.map((u) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[13px]">${u.name_ar || ''}<div class="text-[11px] text-muted">${u.username || '— بلا دخول'}</div></td>
    <td class="px-3">${pill(u.role_name || u.role_id, 'blue')}</td>
    <td class="px-3 text-[12px]">${u.sector_id || '—'}</td>
    <td class="px-3">${u.active ? pill('نشط', 'green') : pill('معطّل', 'red')}</td>
    <td class="px-3 text-[11px] text-muted">${u.last_login_at ? u.last_login_at.slice(0, 10) : 'لم يدخل'}</td></tr>`).join('');
  const body = `${card(`<div class="p-4 border-b border-line font-bold text-sm">المستخدمون والصلاحيات (${rows.length})</div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الدور</th><th class="px-3 font-medium">القطاع</th>
      <th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">آخر دخول</th></tr></thead><tbody>${list}</tbody></table>`)}
    <div class="mt-3 text-[11px] text-muted">التفويض يُنفَّذ على الخادم. تعطيل حسابك أو خفض دورك بنفسك ممنوع خادميًا. الرواتب وعناوين IP محجوبة عن غير المصرّح لهم.</div>`;
  return layout({ user, active: 'users', title: 'المستخدمون والصلاحيات', body });
}

export function auditPage(user) {
  const rows = all('SELECT * FROM audit_log ORDER BY at DESC LIMIT 200');
  const list = rows.map((a) => `<tr class="border-b border-line">
    <td class="py-1.5 px-3 text-[11px] text-muted tabular-nums">${a.at.slice(0, 19).replace('T', ' ')}</td>
    <td class="px-3 text-[12px]">${a.username || a.user_id || '—'}</td>
    <td class="px-3">${pill(a.action, 'slate')}</td>
    <td class="px-3 text-[12px]">${a.resource || ''} ${a.resource_id ? '· ' + a.resource_id : ''}</td></tr>`).join('');
  const body = card(`<div class="p-4 border-b border-line font-bold text-sm">سجل التدقيق (آخر 200)</div>
    <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
      <th class="py-2 px-3 font-medium">الوقت</th><th class="px-3 font-medium">المستخدم</th><th class="px-3 font-medium">الإجراء</th>
      <th class="px-3 font-medium">المورد</th></tr></thead><tbody>${list}</tbody></table>`);
  return layout({ user, active: 'audit', title: 'سجل التدقيق', body });
}

export function reportsPage(user) {
  const schedules = all('SELECT rs.*, rd.name_ar rname FROM report_schedule rs JOIN report_definition rd ON rd.id = rs.report_id LIMIT 50');
  const outbox = all("SELECT * FROM email_queue ORDER BY created_at DESC LIMIT 20");
  const schedList = schedules.map((s) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[13px]">${s.rname}</td><td class="px-3 text-[12px]">${s.frequency}</td>
    <td class="px-3">${s.active ? pill('مفعّل', 'green') : pill('موقوف', 'slate')}</td></tr>`).join('');
  const outList = outbox.map((q) => `<tr class="border-b border-line">
    <td class="py-2 px-3 text-[12px]">${q.subject || ''}</td>
    <td class="px-3">${pill(q.status, q.status === 'SENT' ? 'green' : q.status === 'FAILED' ? 'red' : 'amber')}</td>
    <td class="px-3 text-[11px] text-muted">${q.created_at.slice(0, 16).replace('T', ' ')}</td></tr>`).join('');
  const body = `
    <div class="flex gap-2 mb-4">
      <button onclick="Sanad.previewReport('weekly_exec_brief')" class="text-white text-[12px] px-3 py-2 rounded-lg" style="background:linear-gradient(120deg,#2563eb,#9333ea)">معاينة: الموجز التنفيذي الأسبوعي</button>
      <button onclick="Sanad.testSend('weekly_exec_brief')" class="text-[12px] px-3 py-2 rounded-lg border border-line">إرسال نسخة اختبار (معاينة)</button>
    </div>
    <div class="grid grid-cols-2 gap-4">
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">التقارير المجدولة</div>
        <table class="w-full"><thead><tr class="text-[11px] text-muted text-right"><th class="py-2 px-3">التقرير</th><th class="px-3">التكرار</th><th class="px-3">الحالة</th></tr></thead>
        <tbody>${schedList || '<tr><td class="p-4 text-muted text-sm" colspan="3">لا جداول بعد</td></tr>'}</tbody></table>`)}
      ${card(`<div class="p-4 border-b border-line font-bold text-sm">سجل الإرسال (Outbox)</div>
        <table class="w-full"><thead><tr class="text-[11px] text-muted text-right"><th class="py-2 px-3">الموضوع</th><th class="px-3">الحالة</th><th class="px-3">الوقت</th></tr></thead>
        <tbody>${outList || '<tr><td class="p-4 text-muted text-sm" colspan="3">لا رسائل بعد</td></tr>'}</tbody></table>`)}
    </div>
    <div id="report-preview" class="mt-4"></div>`;
  return layout({ user, active: 'reports', title: 'التقارير والبريد', body });
}

export function portfolioPage(user) {
  const rows = listProjects(user);
  const bySector = {};
  for (const p of rows) (bySector[p.sector_id] ||= []).push(p);
  const groups = Object.entries(bySector).map(([sid, ps]) => card(`<div class="p-4">
    <div class="font-bold text-sm mb-2">${sid} · ${ps.length} مشروع</div>
    ${ps.slice(0, 8).map((p) => `<div class="flex items-center gap-2 py-1 text-[13px]">
      ${pill(p.rag, p.rag === 'RED' ? 'red' : p.rag === 'AMBER' ? 'amber' : 'green')}
      <span class="flex-1">${p.name_ar}</span><span class="text-muted text-[11px]">${pct(p.progress_pct)}</span></div>`).join('')}
  </div>`)).join('');
  return layout({ user, active: 'portfolio', title: 'محفظة المشاريع', body: `<div class="grid grid-cols-2 gap-4">${groups}</div>` });
}
