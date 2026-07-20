// PMO pages: projects board, my tasks, project detail.
import { layout, card, pill, tr, utilStrip } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all, get } from '../../core/db/index.js';
import { projectKpis } from '../../core/reports/metrics.js';
import { listProjects } from '../../modules/pmo/projects.js';
import { myTasks } from '../../modules/pmo/tasks.js';
import { canSeeSensitive, redact, can } from '../../core/rbac/index.js';
import { sarShort, esc, bar, statMini, noticeCard } from './_shared.js';

const PRJ_STATUS = [
  { id: 'NOT_STARTED', color: '#94a3b8' }, { id: 'IN_PROGRESS', color: '#2563eb' },
  { id: 'ON_HOLD', color: '#d97706' }, { id: 'COMPLETED', color: '#059669' }, { id: 'CANCELLED', color: '#dc2626' },
];
const ragHex = { GREEN: '#059669', AMBER: '#d97706', RED: '#dc2626' };

export async function projectsPage(user, opts = {}) {
  let rows = await listProjects(user);
  const canCost = canSeeSensitive(user, 'cost');
  const canEdit = can(user, 'update', 'project');
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));
  const sectors = Object.fromEntries((await all('SELECT id,name_ar FROM sector')).map((s) => [s.id, s.name_ar]));
  const ragTone = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
  // Owner lens: filter the board by sector (?sector=). Company-scope only; others already scoped.
  const allSec = await all('SELECT id, name_ar, color FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const secFilter = user.scope === 'company' && opts.sector && allSec.some((s) => s.id === opts.sector) ? opts.sector : null;
  if (secFilter) rows = rows.filter((p) => p.sector_id === secFilter);
  // The legacy source has progress_pct=0 for 37/43 projects and no contract value for 20/43 —
  // present the truth USEFULLY: derive progress from deliverable states (amount-weighted) when the
  // stored figure is 0, and fall back through PO → budget → realized revenue for the money figure.
  const dlv = await all(`SELECT project_id, COUNT(*) n, COALESCE(SUM(amount_halalas),0) tot,
      SUM(CASE WHEN status IN ('DELIVERED','ACCEPTED','INVOICED','PAID') THEN 1 ELSE 0 END) dn,
      COALESCE(SUM(CASE WHEN status IN ('DELIVERED','ACCEPTED','INVOICED','PAID') THEN amount_halalas ELSE 0 END),0) done
      FROM deliverable WHERE deleted_at IS NULL GROUP BY project_id`);
  const dprog = Object.fromEntries(dlv.map((d) => [d.project_id,
    d.tot > 0 ? Math.round((d.done / d.tot) * 100) : (d.n ? Math.round((d.dn / d.n) * 100) : null)]));
  const effProg = (p) => {
    const own = Number(p.progress_pct) || 0;
    if (own > 0) return { v: own, derived: false };
    const dv = p.status === 'COMPLETED' ? 100 : dprog[p.id];
    return dv != null ? { v: dv, derived: true } : { v: 0, derived: false };
  };
  const bestVal = (p) =>
    p.contract_value_halalas ? { v: p.contract_value_halalas, l: 'عقد' } :
    p.po_value_halalas ? { v: p.po_value_halalas, l: 'أمر شراء' } :
    p.budget_halalas ? { v: p.budget_halalas, l: 'ميزانية' } :
    p.revenue_halalas ? { v: p.revenue_halalas, l: 'إيراد محقق' } : { v: 0, l: null };

  // build columns from the standard ladder + any extra statuses present
  const present = [...new Set(rows.map((p) => p.status || 'IN_PROGRESS'))];
  const cols = [...PRJ_STATUS.filter((c) => present.includes(c.id)),
    ...present.filter((s) => !PRJ_STATUS.some((c) => c.id === s)).map((s) => ({ id: s, color: '#64748b' }))];
  if (!cols.length) cols.push({ id: 'IN_PROGRESS', color: '#2563eb' });
  const byStatus = {}; for (const c of cols) byStatus[c.id] = [];
  for (const p of rows) (byStatus[p.status || 'IN_PROGRESS'] ||= []).push(p);

  const prjCard = (p) => {
    const cl = clients[p.client_id] || sectors[p.sector_id] || '';
    const spend = canCost && !p._redacted_actual_spend_halalas ? p.actual_spend_halalas : null;
    const dnd = canEdit ? 'draggable="true" ondragstart="Sanad.kStart(event)" ondragend="Sanad.kEnd(event)"' : '';
    const hay = `${p.name_ar} ${cl}`.toLowerCase().replace(/"/g, '');
    return `<div class="kcard" ${dnd} data-id="${p.id}" data-sector="${p.sector_id || ''}" data-hay="${esc(hay)}" style="--_c:${ragHex[p.rag] || '#cbd5e1'};cursor:pointer" onclick="Sanad.projOpen('${p.id}')">
      <div class="kt">${esc(p.name_ar)}</div>
      <div class="km">${cl ? `<span style="display:inline-flex;align-items:center;gap:.25rem">${icon('building')}${esc(cl)}</span>` : ''}
        ${p.rag ? pill(tr(p.rag), ragTone[p.rag] || 'slate') : ''}</div>
      <div class="km">${(() => { const bv = bestVal(p); const e = effProg(p); return `
        ${bv.l ? `<span class="kv tnum">${fmtSar(bv.v)}</span><span style="font-size:9.5px;font-weight:700;color:var(--faint);background:#eef1f7;border-radius:6px;padding:.1rem .35rem">${bv.l}</span>`
               : '<span style="color:var(--faint);font-size:11px">بلا قيمة مسجلة</span>'}
        <span class="tnum" style="margin-inline-start:auto" ${e.derived ? 'title="محسوبة من حالة المخرجات (المصدر بلا نسبة إنجاز)"' : ''}>${e.v}%${e.derived ? '<span style="color:var(--faint);font-size:9.5px"> ⁎</span>' : ''}</span>`; })()}</div>
      <div class="bar" style="margin-top:.5rem"><span style="width:${Math.min(100, effProg(p).v)}%;background:${ragHex[p.rag] || '#2563eb'}"></span></div>
    </div>`;
  };
  const columns = cols.map((c) => {
    const items = byStatus[c.id] || [];
    const val = items.reduce((a, p) => a + bestVal(p).v, 0);
    const drop = canEdit ? 'ondragover="Sanad.kOver(event)" ondragleave="Sanad.kLeave(event)" ondrop="Sanad.kDrop(event)"' : '';
    return `<div class="kcol" data-stage="${c.id}" ${drop}>
      <div class="kcol-head"><span class="kcol-dot" style="background:${c.color}"></span>
        <span class="t">${tr(c.id)}</span><span class="n" data-count>${items.length}</span>
        <span class="v tnum" data-total>${sarShort(val)}</span></div>
      <div class="kcol-body">${items.map(prjCard).join('') || '<div style="text-align:center;color:var(--faint);font-size:11px;padding:1rem 0">—</div>'}</div>
    </div>`;
  }).join('');

  const tableRows = rows.slice(0, 200).map((p) => `<tr class="border-b border-line" style="cursor:pointer" onclick="Sanad.projOpen('${p.id}')">
    <td class="py-2.5 px-3 text-[13px]">${esc(p.name_ar)}</td>
    <td class="px-3">${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : 'blue')}</td>
    <td class="px-3">${pill(tr(p.rag), ragTone[p.rag] || 'slate')}</td>
    <td class="px-3 text-[13px] tnum">${(() => { const bv = bestVal(p); return bv.l ? `${fmtSar(bv.v)} <span class="text-[10px] text-faint">(${bv.l})</span>` : '—'; })()}</td>
    <td class="px-3 text-[12px] tnum">${canCost && !p._redacted_actual_spend_halalas ? fmtSar(p.actual_spend_halalas) : '<span class="text-slate-300">•••</span>'}</td>
    <td class="px-3 text-[12px] text-muted tnum">${(() => { const e = effProg(p); return `${e.v}%${e.derived ? ' ⁎' : ''}`; })()}</td></tr>`).join('');

  const secChips = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    <a href="/app/projects" class="chip ${secFilter ? '' : 'on'}">الكل</a>
    ${allSec.map((s) => `<a href="/app/projects?sector=${s.id}" class="chip ${secFilter === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || '#2563eb'}"></span>${esc(s.name_ar)}</a>`).join('')}
  </div>` : '';
  const body = `
    ${secChips}
    <div class="toolbar">
      <div class="seg"><button class="on" data-view="kanban" onclick="Sanad.pmoView('prj','kanban')">${icon('kanban')} كانبان</button>
        <button data-view="table" onclick="Sanad.pmoView('prj','table')">${icon('list')} جدول</button></div>
      <div class="search">${icon('search')}<input class="input" id="prj-q" aria-label="بحث في المشاريع" oninput="Sanad.prjFilter()" placeholder="ابحث في المشاريع…"></div>
      <div class="spacer"></div>
      ${canCost ? pill('ترى التكلفة الفعلية', 'green') : pill('التكلفة محجوبة عنك', 'slate')}
      ${canEdit ? `<button class="btn btn-primary" onclick="Sanad.projAdd()">${icon('plus')} مشروع جديد</button>` : ''}
    </div>
    <div style="font-size:10.5px;color:var(--faint);margin:-.5rem 0 .6rem">⁎ نسبة إنجاز محسوبة من حالة المخرجات — المصدر القديم بلا نسبة مسجلة · شارة القيمة توضح أساسها (عقد / أمر شراء / ميزانية / إيراد محقق)</div>
    <div id="prj-kanban" class="kanban" data-kind="prj">${columns}</div>
    <div id="prj-table" class="card" style="display:none;overflow-x:auto">
      <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
        <th class="py-2 px-3 font-medium">المشروع</th><th class="px-3 font-medium">الحالة</th><th class="px-3 font-medium">RAG</th>
        <th class="px-3 font-medium">قيمة العقد</th><th class="px-3 font-medium">الصرف الفعلي</th><th class="px-3 font-medium">الإنجاز</th></tr></thead>
      <tbody>${tableRows || '<tr><td class="p-4 text-muted text-sm" colspan="6">لا مشاريع ضمن نطاقك</td></tr>'}</tbody></table></div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{sectors:${JSON.stringify(await all('SELECT id,name_ar FROM sector WHERE active=1 ORDER BY name_ar'))},canEditPrj:${canEdit}});</script>`;
  return layout({ user, active: 'projects', title: 'المشاريع', subtitle: 'PMO · لوحة الحالة', body });
}

export async function tasksPage(user) {
  const rows = await myTasks(user);
  const stColor = { TODO: 'slate', IN_PROGRESS: 'blue', BLOCKED: 'red', IN_REVIEW: 'amber', DONE: 'green' };
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const openT = rows.filter((t) => t.status !== 'DONE');
  const overdue = openT.filter((t) => t.due_date && t.due_date < today).length;
  const dueSoon = openT.filter((t) => t.due_date && t.due_date >= today && t.due_date <= soon).length;
  const blocked = rows.filter((t) => t.status === 'BLOCKED').length;
  const inprog = rows.filter((t) => t.status === 'IN_PROGRESS').length;
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${statMini('مفتوحة', openT.length, 'قيد العمل')}
    ${statMini('قيد التنفيذ', inprog, 'جارية', 'brand')}
    ${statMini('متأخرة', overdue, 'تجاوزت الاستحقاق', overdue ? 'bad' : '')}
    ${statMini('تستحق هذا الأسبوع', dueSoon, 'خلال 7 أيام')}
    ${statMini('معلّقة', blocked, 'محجوبة', blocked ? 'bad' : '')}</div>`;
  const list = rows.map((t) => `<tr class="border-b border-line hover:bg-slate-50" data-task="${t.id}">
    <td class="py-2.5 px-3 text-[13px]">${esc(t.title)}</td>
    <td class="px-3">${pill(tr(t.priority), t.priority === 'P0' ? 'red' : t.priority === 'P1' ? 'amber' : 'slate')}</td>
    <td class="px-3">${pill(tr(t.status), stColor[t.status])}</td>
    <td class="px-3 text-[12px] text-muted">${t.due_date || '—'}</td>
    <td class="px-3"><select onchange="Sanad.setTaskStatus('${t.id}',this.value)" aria-label="تغيير حالة المهمة" class="text-[12px] border border-line rounded px-1 py-0.5">
      ${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${tr(s)}</option>`).join('')}
    </select></td></tr>`).join('');
  const body = `
    ${strip}
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

export async function projectDetailPage(user, projectId) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('المشروع غير موجود', 'ربما حُذف المشروع أو أن الرابط غير صحيح.', '/app/projects', 'العودة للمشاريع') });
  if (!can(user, 'read', 'project', p)) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('لا تملك صلاحية الوصول', 'هذا المشروع خارج نطاق صلاحياتك الحالية — تواصل مع مدير النظام إن كنت تحتاج الوصول.', '/app/projects', 'العودة للمشاريع') });
  const row = redact(user, 'project', p);
  const k = await projectKpis(p.id);
  const canCost = canSeeSensitive(user, 'cost');
  const canEdit = can(user, 'update', 'project', p);
  const tasks = await all("SELECT status, COUNT(*) n FROM task WHERE project_id=? AND deleted_at IS NULL GROUP BY status", [p.id]);
  const tmap = Object.fromEntries(tasks.map((t) => [t.status, t.n]));
  const dlv = await all("SELECT name_ar, amount_halalas, status, month FROM deliverable WHERE project_id=? AND deleted_at IS NULL ORDER BY month LIMIT 24", [p.id]);
  const risks = await all("SELECT title, impact, status FROM risk WHERE project_id=? AND status!='CLOSED' LIMIT 10", [p.id]);
  const client = await get('SELECT id, name_ar FROM client WHERE id=?', [p.client_id]);
  const owner = p.owner_user_id ? await get('SELECT name_ar, username FROM app_user WHERE id=?', [p.owner_user_id]) : null;
  const srcOpp = p.source_opp_id ? await get('SELECT id, title_ar FROM opportunity WHERE id=? AND deleted_at IS NULL', [p.source_opp_id]) : null;
  const contract = await get("SELECT id, code, value_halalas, status FROM contract WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [p.id]);
  // Team assigned to this project (from the allocation model), with each member's month-coverage on THIS project.
  const staff = await all(`SELECT a.person_name_ar, a.type, a.monthly_json, e.job_title
     FROM allocation a LEFT JOIN employee e ON e.id=a.employee_id
     WHERE a.project_id=? AND a.deleted_at IS NULL ORDER BY (a.type='lead') DESC, a.person_name_ar`, [p.id]);

  // ── Financials ──
  const contractVal = p.contract_value_halalas || (contract && contract.value_halalas) || 0;
  const headlineVal = contractVal || p.po_value_halalas || p.budget_halalas || 0;
  const spend = p.actual_spend_halalas || 0;
  const revenue = p.revenue_halalas || 0;
  const showCost = canCost && !row._redacted_actual_spend_halalas;
  const marginPct = p.margin_pct != null ? p.margin_pct : (revenue > 0 ? Math.round((revenue - spend) / revenue * 100) : null);
  const burnPct = p.budget_halalas ? Math.round(spend / p.budget_halalas * 100) : null;

  // ── Timeline / schedule health ──
  const sd = p.start_date ? new Date(p.start_date) : null;
  const ed = p.end_date ? new Date(p.end_date) : null;
  const today = new Date();
  let durTxt = '—', schedulePct = null, scheduleTone = 'var(--muted)', scheduleNote = '';
  if (sd && ed && ed > sd) {
    const totalD = Math.round((ed - sd) / 86400000);
    const elapsed = Math.min(totalD, Math.max(0, Math.round((today - sd) / 86400000)));
    const remain = Math.max(0, Math.round((ed - today) / 86400000));
    schedulePct = Math.round(elapsed / totalD * 100);
    durTxt = `${totalD} يوم · مضى ${elapsed} · متبقٍّ ${remain}`;
    const prog = Math.round(p.progress_pct || 0);
    const gap = prog - schedulePct;
    scheduleTone = gap < -12 ? 'var(--red)' : gap < -4 ? 'var(--amber)' : 'var(--green)';
    scheduleNote = gap < -12 ? 'متأخر عن الجدول' : gap < -4 ? 'قريب من الجدول' : (today > ed ? 'تجاوز تاريخ الانتهاء' : 'ضمن الجدول');
    if (today > ed && prog < 100) { scheduleTone = 'var(--red)'; scheduleNote = 'تجاوز تاريخ الانتهاء'; }
  }

  const stat = (l, v, c, sub) => card(`<div style="padding:.7rem .9rem"><div style="font-size:10.5px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.2rem;${c ? 'color:' + c : ''}">${v}</div>${sub ? `<div style="font-size:10px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const ragColor = p.rag === 'RED' ? 'red' : p.rag === 'AMBER' ? 'amber' : 'green';
  const MONTHS = ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
  const dlvRows = dlv.map((d) => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:.4rem .75rem;font-size:12.5px">${esc(d.name_ar)}${d.month ? `<span style="color:var(--faint);font-size:10px;margin-inline-start:.35rem">${MONTHS[(d.month - 1) % 12] || ''}</span>` : ''}</td>
    <td style="padding:.4rem .75rem;font-size:12.5px;text-align:center" class="tnum">${fmtSar(d.amount_halalas)}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(tr(d.status), ['PAID', 'INVOICED', 'ACCEPTED'].includes(d.status) ? 'green' : d.status === 'DELIVERED' ? 'blue' : 'slate')}</td></tr>`).join('');
  const riskRows = risks.map((r) => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:.4rem .75rem;font-size:12.5px">${esc(r.title)}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(tr(r.impact) || '—', r.impact === 'high' ? 'red' : r.impact === 'medium' ? 'amber' : 'slate')}</td></tr>`).join('');
  // staffing rows: parse each member's monthly_json into a 12-cell coverage strip on this project
  const staffRows = staff.map((s) => {
    let mj = {}; try { mj = JSON.parse(s.monthly_json || '{}'); } catch { mj = {}; }
    const months = Array.from({ length: 12 }, (_, i) => Math.round((Number(mj[i + 1]) || 0) * 100));
    return `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:.4rem .75rem;font-size:12.5px">${esc(s.person_name_ar || '—')}<div style="font-size:10px;color:var(--muted)">${esc(s.job_title || '')}</div></td>
      <td style="padding:.4rem .75rem;text-align:center">${pill(s.type === 'lead' ? 'قائد' : 'عضو', s.type === 'lead' ? 'blue' : 'slate')}</td>
      <td style="padding:.4rem .75rem;width:160px">${utilStrip(months)}</td></tr>`;
  }).join('');

  const financeCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المالية</div>
    <div style="padding:.5rem 1rem">
      ${[['قيمة العقد', fmtSar(headlineVal), 'var(--ink2)'],
    ['الإيراد المُثبت', fmtSar(revenue), 'var(--green)'],
    ['الصرف الفعلي', showCost ? fmtSar(spend) : '••• محجوب', showCost ? 'var(--ink2)' : 'var(--faint)'],
    ['الهامش', marginPct != null && showCost ? marginPct + '%' : (marginPct != null && !canCost ? '••• محجوب' : '—'), (marginPct != null && marginPct < 10) ? 'var(--red)' : 'var(--ink2)']]
    .map(([l, v, c]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:.3rem 0;border-bottom:1px dashed var(--line)"><span style="font-size:12px;color:var(--muted)">${l}</span><span class="tnum" style="font-weight:800;font-size:13px;color:${c}">${v}</span></div>`).join('')}
      ${showCost && burnPct != null ? `<div style="margin-top:.55rem"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>استهلاك الميزانية</span><span class="tnum">${burnPct}%</span></div>${bar(burnPct, burnPct > 90 ? '#dc2626' : burnPct > 70 ? '#d97706' : '#059669')}</div>` : ''}
      ${contract ? `<a href="/app/contract/${contract.id}" style="display:block;margin-top:.6rem;font-size:12px;color:var(--brand2);text-decoration:none">↳ فتح العقد ${esc(contract.code || '')} · ${fmtSar(contract.value_halalas)}</a>` : ''}
    </div>`);

  const timelineCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:800;font-size:13px">الجدول الزمني</div>${schedulePct != null ? `<span style="font-size:11px;font-weight:700;color:${scheduleTone}">${scheduleNote}</span>` : ''}</div>
    <div style="padding:.85rem 1rem">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>${p.start_date || '—'}</span><span>${p.end_date || '—'}</span></div>
      <div style="position:relative;height:10px;background:var(--surface2, #f1f5f9);border-radius:6px;margin:.45rem 0;overflow:hidden">
        <div style="position:absolute;inset-inline-start:0;top:0;height:100%;width:${Math.min(100, Math.round(p.progress_pct || 0))}%;background:linear-gradient(90deg,#2563eb,#7c3aed)"></div>
        ${schedulePct != null ? `<div title="موضع اليوم على الجدول" style="position:absolute;top:-2px;height:14px;width:2px;background:#0f172a;inset-inline-start:${schedulePct}%"></div>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:var(--muted)">الإنجاز <b class="tnum" style="color:var(--ink2)">${Math.round(p.progress_pct || 0)}%</b></span><span style="color:var(--muted)">${schedulePct != null ? `الزمن المنقضي <b class="tnum">${schedulePct}%</b>` : ''}</span></div>
      <div style="font-size:11px;color:var(--faint);margin-top:.4rem">${durTxt}</div>
      <div style="display:flex;gap:1.2rem;margin-top:.65rem;padding-top:.55rem;border-top:1px solid var(--line);font-size:11.5px">
        <div><span style="color:var(--muted)">مدير المشروع</span><div style="font-weight:700">${esc(p.pm_name || owner?.name_ar || owner?.username || '—')}</div></div>
        ${srcOpp ? `<div><span style="color:var(--muted)">الفرصة المصدر</span><div><a href="/app/opportunities" style="color:var(--brand2);text-decoration:none;font-weight:700">${esc(srcOpp.title_ar).slice(0, 26)}</a></div></div>` : ''}
      </div>
    </div>`);

  const body = `
    <a href="/app/projects" style="font-size:12px;color:var(--muted)">← المشاريع</a>
    <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin:.6rem 0 1rem">
      <h2 style="font-size:18px;margin:0">${esc(p.name_ar)}</h2>${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : p.status === 'ON_HOLD' ? 'amber' : 'blue')}${pill('RAG ' + tr(p.rag), ragColor)}
      ${p.kind ? pill(p.kind === 'external' ? 'خارجي' : 'داخلي', 'slate') : ''}
      <span style="font-size:12px;color:var(--muted)">${client ? esc(client.name_ar) : ''} · ${esc(p.code || '')}${p.financial_code ? ' · مالي ' + esc(p.financial_code) : ''}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:.65rem;margin-bottom:1rem">
      ${stat('الإنجاز', Math.round(p.progress_pct || 0) + '%')}
      ${stat('إنجاز المهام', k.taskCompletionRate + '%', '', `${tmap.DONE || 0}/${k.totalTasks}`)}
      ${stat('مهام متأخرة', k.lateTasks, k.lateTasks ? 'var(--red)' : '')}
      ${stat('قبول المخرجات', k.deliverableAcceptanceRate + '%', '', `${dlv.length} مخرج`)}
      ${stat('الفريق المُسكَّن', staff.length, '', staff.length ? 'موظف' : 'لا تسكين')}
      ${stat('المخاطر', risks.length, risks.length ? 'var(--amber)' : '', 'مفتوحة')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${timelineCard}
      ${financeCard}
    </div>
    <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;font-size:13px">التسكين — فريق المشروع (${staff.length})</div>
        ${canEdit ? `<button class="btn btn-sm" style="font-size:11px;padding:.25rem .6rem" onclick="Sanad.projOpen('${p.id}')">${icon('users')} إدارة التسكين</button>` : ''}</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10.5px;color:var(--muted);text-align:right"><th style="padding:.35rem .75rem">الموظف</th><th style="padding:.35rem .75rem;text-align:center">الدور</th><th style="padding:.35rem .75rem;text-align:center">التغطية الشهرية</th></tr></thead>
        <tbody>${staffRows || '<tr><td colspan="3" style="padding:1rem;color:var(--muted);font-size:12.5px">لا يوجد فريق مُسكَّن على هذا المشروع بعد' + (canEdit ? ' — استخدم «إدارة التسكين»' : '') + '</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المخرجات (${dlv.length})</div>
        <div style="max-height:260px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><tbody>${dlvRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:12.5px">لا مخرجات</td></tr>'}</tbody></table></div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem">
      ${card(`<div style="padding:.85rem 1rem"><div style="font-weight:800;font-size:13px;margin-bottom:.5rem">توزيع المهام (${k.totalTasks})</div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => pill(`${tr(s)}: ${tmap[s] || 0}`, s === 'DONE' ? 'green' : s === 'BLOCKED' ? 'red' : 'slate')).join(' ')}</div></div>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المخاطر المفتوحة (${risks.length})</div>
        <table style="width:100%;border-collapse:collapse"><tbody>${riskRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:12.5px">لا مخاطر مفتوحة</td></tr>'}</tbody></table>`)}
    </div>`;
  return layout({ user, active: 'projects', title: esc(p.name_ar), subtitle: 'تفاصيل المشروع', body });
}
