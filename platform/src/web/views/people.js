// People pages: my timesheet, team & staffing, org structure.
import { layout, card, pill, hbars, utilStrip } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { myEntries } from '../../modules/timesheets/timesheets.js';
import { orgTree, staffingRoster } from '../../modules/org/org.js';
import { canSeeSensitive, can } from '../../core/rbac/index.js';
import { esc } from './_shared.js';

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

export async function teamPage(user, opts = {}) {
  const canSalary = canSeeSensitive(user, 'salary');
  const canManage = can(user, 'create', 'employee') || can(user, 'update', 'employee');
  const canCreate = can(user, 'create', 'employee');
  const allSec = await all('SELECT id, name_ar, color FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const sectorNames = Object.fromEntries(allSec.map((s) => [s.id, s.name_ar]));
  const { year, sector, currentMonth, roster } = await staffingRoster(user, { sector: opts.sector });
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const curName = currentMonth ? MONTHS[currentMonth - 1] : '';
  const projects = await all(`SELECT id, name_ar, sector_id FROM project WHERE deleted_at IS NULL AND status IN ('IN_PROGRESS','PLANNED')
     ${sector ? 'AND sector_id = ?' : ''} ORDER BY name_ar`, sector ? [sector] : []);

  const activeN = roster.filter((e) => e.active !== 0).length;
  const avgCurrent = roster.length ? Math.round(roster.reduce((a, e) => a + e.currentUtil, 0) / roster.length) : 0;
  const avgAnnual = roster.length ? Math.round(roster.reduce((a, e) => a + e.annualUtil, 0) / roster.length) : 0;
  const overNow = roster.filter((e) => e.currentUtil > 100).length;
  const benchNow = roster.filter((e) => e.active !== 0 && e.currentUtil === 0).length;
  const totalSalary = canSalary ? roster.reduce((a, e) => a + (e.salary_halalas || 0), 0) : null;
  const avgSalary = canSalary && roster.length ? Math.round(totalSalary / roster.length) : null;
  const uTone = (u) => u > 100 ? 'var(--red)' : u >= 70 ? 'var(--green)' : u >= 40 ? 'var(--amber)' : u > 0 ? 'var(--blue)' : 'var(--faint)';

  const byType = {}; for (const e of roster) { const t = e.employment_type || 'غير محدد'; byType[t] = (byType[t] || 0) + 1; }
  const typeItems = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n], i) => ({ label: esc(t), value: n, color: ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706'][i % 5] }));
  // Distribution of THIS MONTH's load (the actionable "now" view).
  const buckets = [
    { label: 'على المقعد (0%)', test: (u) => u === 0, color: '#94a3b8' },
    { label: 'منخفض (<40%)', test: (u) => u > 0 && u < 40, color: '#2563eb' },
    { label: 'صحي (40–70%)', test: (u) => u >= 40 && u < 70, color: '#0891b2' },
    { label: 'عالٍ (70–100%)', test: (u) => u >= 70 && u <= 100, color: '#059669' },
    { label: 'فوق الطاقة (>100%)', test: (u) => u > 100, color: '#dc2626' },
  ].map((b) => ({ label: b.label, value: roster.filter((e) => e.active !== 0 && b.test(e.currentUtil)).length, color: b.color }));

  const rowsHtml = roster.map((e) => {
    const projTip = e.projects.map((p) => esc(p.name)).join('، ') || 'بلا تسكين';
    return `<tr class="border-b border-line" style="vertical-align:middle">
    <td class="py-2 px-3 text-[13px]">${esc(e.name_ar)}${e.active === 0 ? ' ' + pill('غير نشط', 'slate') : ''}
      <div style="font-size:10.5px;color:var(--muted)">${esc(e.job_title || '—')}${sector ? '' : ' · ' + esc(sectorNames[e.sector_id] || '—')}</div></td>
    <td class="px-3 text-[12px]">${esc(e.employment_type || '—')}</td>
    <td class="px-3" style="min-width:215px">
      <div style="display:flex;align-items:center;gap:.5rem">
        <span class="tnum" style="font-weight:800;font-size:14px;color:${uTone(e.currentUtil)};min-width:40px" title="إشغال ${curName}">${e.currentUtil}%</span>
        <div style="flex:1">${utilStrip(e.months, currentMonth)}</div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:.15rem">${curName ? curName + ' · ' : ''}سنويًا ${e.annualUtil}% · مُسكّن ${e.staffedMonths}/12${e.overMonths ? ` · <span style="color:var(--red);font-weight:700">تجاوز ${e.overMonths} شهر</span>` : ''}</div></td>
    <td class="px-3 text-[12px] tnum" title="${projTip}">${e.projectCount ? `<span class="pill" style="background:#dbeafe;color:#2563eb">${e.projectCount} مشروع</span>` : '<span style="color:var(--faint)">—</span>'}</td>
    ${canSalary ? `<td class="px-3 text-[13px] tabular-nums">${e.salary_halalas ? fmtSar(e.salary_halalas) : '<span style="color:var(--faint)">—</span>'}</td>` : ''}
    ${canManage ? `<td class="px-3"><div style="display:flex;gap:.3rem">
      <button class="btn btn-sm btn-ghost" onclick="Sanad.empEdit('${e.id}')" title="تعديل">✎</button>
      <button class="btn btn-sm btn-ghost" onclick="Sanad.empAssign('${e.id}')" title="تسكين على مشروع">＋مشروع</button></div></td>` : ''}
  </tr>`; }).join('');

  const th = (t, a) => `<th class="px-3 py-2 font-medium" style="text-align:${a || 'right'}">${t}</th>`;
  const kpi = (l, v, sub, tone) => card(`<div style="padding:.75rem .95rem"><div style="font-size:11px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.3rem;${tone ? 'color:' + tone : ''}">${v}</div>${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const secChips = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    <a href="/app/team" class="chip ${sector ? '' : 'on'}">الكل</a>
    ${allSec.map((s) => `<a href="/app/team?sector=${s.id}" class="chip ${sector === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || '#2563eb'}"></span>${esc(s.name_ar)}</a>`).join('')}
  </div>` : '';

  const body = `
    ${secChips}
    <div class="toolbar" style="margin-bottom:.8rem">
      <div style="font-weight:800;font-size:14px">${sector ? esc(sectorNames[sector]) : 'كل القطاعات'} · ${roster.length} عضو</div>
      <div class="spacer"></div>
      ${canManage ? pill('لديك صلاحية إدارة الفريق', 'green') : pill('عرض فقط', 'slate')}
      ${canCreate ? `<button class="btn btn-primary" onclick="Sanad.empAdd()">${icon('plus')} إضافة موظف</button>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem;margin-bottom:.9rem">
      ${kpi('إجمالي الأعضاء', roster.length, `${activeN} نشط`)}
      ${kpi(`إشغال ${curName || year} (متوسط)`, avgCurrent + '%', `متوسط السنة ${avgAnnual}%`, uTone(avgCurrent))}
      ${kpi('على المقعد الآن', benchNow, `بلا تسكين في ${curName || 'الفترة'}`, benchNow ? 'var(--amber)' : 'var(--green)')}
      ${kpi('فوق الطاقة الآن', overNow, `> 100% في ${curName || 'الفترة'}`, overNow ? 'var(--red)' : 'var(--green)')}
      ${canSalary ? kpi('فاتورة الرواتب', totalSalary ? fmtSar(totalSalary) : '—', totalSalary ? `متوسط ${fmtSar(avgSalary)}` : 'غير مسجّلة في بيانات العرض', 'var(--brand2)') : ''}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">توزيع الإشغال — ${curName || year}</div><div style="padding:.7rem 1rem">${hbars(buckets, { fmt: (v) => v + ' موظف' })}</div>`)}
      ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">حسب نوع التوظيف</div><div style="padding:.7rem 1rem">${hbars(typeItems, { fmt: (v) => v + ' عضو' })}</div>`)}
    </div>
    <div style="font-size:10.5px;color:var(--faint);margin-bottom:.55rem">الرقم الكبير = <b>إشغال ${curName || 'الشهر الحالي'}</b> (تسكين الموظف هذا الشهر)؛ «سنويًا» = متوسط تسكينه عبر أشهر ${year}. الشريط يعرض الاثني عشر شهرًا (يناير→ديسمبر) والشهر الحالي مُحاط بإطار — أخضر ≥80% · أصفر · أزرق منخفض · أحمر تجاوز الطاقة · رمادي بلا تسكين. المصدر نموذج التسكين (allocation) وليس ساعات فعلية. الترتيب حسب الأكثر إشغالًا الآن.</div>
    ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">أعضاء الفريق والإشغال</div>
      <div style="overflow-x:auto"><table class="w-full" style="border-collapse:collapse"><thead><tr class="text-[11px] text-muted">
      ${th('الموظف')}${th('النوع')}${th(`الإشغال (${curName || 'الحالي'} · السنوي)`)}${th('المشاريع', 'center')}${canSalary ? th('الراتب') : ''}${canManage ? th('إجراءات', 'center') : ''}
      </tr></thead><tbody>${rowsHtml || `<tr><td colspan="6" style="padding:1.2rem;color:var(--muted);text-align:center">لا أعضاء ضمن نطاقك</td></tr>`}</tbody></table></div>`)}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      emps:${JSON.stringify(Object.fromEntries(roster.map((e) => [e.id, { name_ar: e.name_ar, job_title: e.job_title, employment_type: e.employment_type, status: e.status, active: e.active, sector_id: e.sector_id, salary_sar: canSalary ? Math.round((e.salary_halalas || 0) / 100) : null, projects: e.projects.map((p) => ({ allocId: p.allocId, name: p.name, projectId: p.projectId })) }])))},
      teamSectors:${JSON.stringify(allSec.map((s) => ({ id: s.id, name_ar: s.name_ar })))},
      teamProjects:${JSON.stringify(projects.map((p) => ({ id: p.id, name_ar: p.name_ar, sector_id: p.sector_id })))},
      canSalary:${canSalary}, canManage:${canManage}, teamSectorLocked:${JSON.stringify(sector)}});</script>`;
  return layout({ user, active: 'team', title: 'الفريق والتسكين', subtitle: `الموارد البشرية · الإشغال والتسكين · ${curName || ''} ${year}`, body });
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
