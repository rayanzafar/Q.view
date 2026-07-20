// CRM pages: opportunity pipeline (kanban/table) + personal pipeline.
import { layout, card, pill, tr, hbars } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { config } from '../../core/config.js';
import { listOpportunities, pipelineSummary } from '../../modules/crm/opportunities.js';
import { can } from '../../core/rbac/index.js';
import { sarShort, pct, esc, statMini, noticeCard } from './_shared.js';

export async function opportunitiesPage(user) {
  const rows = await listOpportunities(user);
  const stages = await all('SELECT id,name_ar,color,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));
  const users = Object.fromEntries((await all('SELECT id,name_ar,username FROM app_user')).map((u) => [u.id, u.name_ar || u.username]));
  const sectors = await all('SELECT id,name_ar FROM sector WHERE active=1 ORDER BY name_ar');
  const canCreate = can(user, 'create', 'opportunity');
  const canEdit = can(user, 'update', 'opportunity');

  const total = rows.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const weighted = rows.reduce((a, o) => a + (o.value_halalas || 0) * ((o.win_pct || 0) / 100), 0);
  const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const won = rows.filter((o) => stById[o.stage_id]?.is_won).length;
  const openN = rows.filter((o) => { const s = stById[o.stage_id]; return s && !s.is_won && !s.is_lost; }).length;

  const byStage = {}; for (const s of stages) byStage[s.id] = [];
  for (const o of rows) (byStage[o.stage_id] ||= []).push(o);

  const opCard = (o) => {
    const st = stById[o.stage_id] || {};
    const cl = clients[o.client_id]; const ow = users[o.owner_user_id];
    const prTone = o.priority === 'P0' ? 'red' : o.priority === 'P1' ? 'amber' : 'slate';
    const hay = `${o.title_ar} ${cl || ''} ${ow || ''}`.toLowerCase();
    const dnd = canEdit ? 'draggable="true" ondragstart="Sanad.kStart(event)" ondragend="Sanad.kEnd(event)"' : '';
    return `<div class="kcard" ${dnd} data-id="${o.id}" data-sector="${o.sector_id || ''}" data-hay="${esc(hay).replace(/"/g, '')}" style="--_c:${st.color || '#cbd5e1'}${canEdit ? '' : ';cursor:pointer'}"
       onclick="Sanad.oppOpen('${o.id}')">
      <div class="kt">${esc(o.title_ar)}</div>
      <div class="km">${cl ? `<span style="display:inline-flex;align-items:center;gap:.25rem">${icon('building')}${esc(cl)}</span>` : '<span style="color:var(--faint)">—</span>'}
        ${o.priority ? pill(tr(o.priority), prTone) : ''}</div>
      <div class="km"><span class="kv tnum">${fmtSar(o.value_halalas)}</span>
        <span class="tnum" style="margin-inline-start:auto">${pct(o.win_pct)}</span>
        ${ow ? `<span class="kav" title="${ow}">${(ow || '?').trim().charAt(0)}</span>` : ''}</div>
    </div>`;
  };

  const columns = stages.map((s) => {
    const items = byStage[s.id] || [];
    const colTotal = items.reduce((a, o) => a + (o.value_halalas || 0), 0);
    const drop = canEdit ? 'ondragover="Sanad.kOver(event)" ondragleave="Sanad.kLeave(event)" ondrop="Sanad.kDrop(event)"' : '';
    return `<div class="kcol" data-stage="${s.id}" ${drop}>
      <div class="kcol-head"><span class="kcol-dot" style="background:${s.color}"></span>
        <span class="t">${esc(s.name_ar)}</span><span class="n" data-count>${items.length}</span>
        <span class="v tnum" data-total>${sarShort(colTotal)}</span></div>
      <div class="kcol-body">${items.map(opCard).join('') || '<div style="text-align:center;color:var(--faint);font-size:11px;padding:1rem 0">—</div>'}</div>
    </div>`;
  }).join('');

  const tableRows = rows.slice(0, 200).map((o) => {
    const st = stById[o.stage_id] || {};
    return `<tr class="border-b border-line" style="cursor:pointer" onclick="Sanad.oppOpen('${o.id}')">
      <td class="py-2.5 px-3 text-[13px]">${esc(o.title_ar)}</td>
      <td class="px-3 text-[12px]">${esc(clients[o.client_id] || '—')}</td>
      <td class="px-3">${pill(st.name_ar || o.stage_id, 'blue')}</td>
      <td class="px-3 text-[13px] tnum">${fmtSar(o.value_halalas)}</td>
      <td class="px-3 text-[12px] text-muted tnum">${pct(o.win_pct)}</td></tr>`;
  }).join('');

  const body = `
    <div class="toolbar">
      <div class="seg"><button class="on" data-view="kanban" onclick="Sanad.pmoView('opp','kanban')">${icon('kanban')} كانبان</button>
        <button data-view="table" onclick="Sanad.pmoView('opp','table')">${icon('list')} جدول</button></div>
      <div class="search">${icon('search')}<input class="input" id="opp-q" aria-label="بحث في الفرص" oninput="Sanad.oppFilter()" placeholder="ابحث بالعنوان أو العميل…"></div>
      <select class="input" id="opp-sector" aria-label="تصفية حسب القطاع" onchange="Sanad.oppFilter()"><option value="">كل القطاعات</option>${sectors.map((s) => `<option value="${s.id}">${esc(s.name_ar)}</option>`).join('')}</select>
      <div class="spacer"></div>
      ${canCreate ? `<button class="btn btn-primary" onclick="Sanad.oppAdd()">${icon('plus')} فرصة جديدة</button>` : ''}
    </div>
    <div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1.1rem">
      ${statMini('إجمالي الخط', fmtSar(total), rows.length + ' فرصة')}
      ${statMini('المرجّح', fmtSar(weighted), 'حسب الاحتمالية', 'brand')}
      ${statMini('مفتوحة', openN, 'قيد التنفيذ')}
      ${statMini('فائزة', won, 'مُغلقة رابحة', 'good')}
    </div>
    <div id="opp-kanban" class="kanban">${columns}</div>
    <div id="opp-table" class="card" style="display:none;overflow-x:auto">
      <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
        <th class="py-2 px-3 font-medium">العنوان</th><th class="px-3 font-medium">العميل</th><th class="px-3 font-medium">المرحلة</th>
        <th class="px-3 font-medium">القيمة</th><th class="px-3 font-medium">الاحتمالية</th></tr></thead>
      <tbody>${tableRows || '<tr><td class="p-4 text-muted text-sm" colspan="5">لا توجد فرص ضمن نطاقك</td></tr>'}</tbody></table></div>
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      stages:${JSON.stringify(stages.map((s) => ({ id: s.id, name_ar: s.name_ar, color: s.color })))},
      sectors:${JSON.stringify(sectors)},
      canCreateOpp:${canCreate}
    });</script>`;
  return layout({ user, active: 'opportunities', title: 'الفرص والمبيعات', subtitle: 'خط الفرص · PMO', body });
}

// Personal pipeline — an individual's OWN opportunities (owner = the signed-in user).
export async function myOpportunitiesPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const scoped = await listOpportunities(user);
  const rows = scoped.filter((o) => o.owner_user_id === user.id);
  const stages = await all('SELECT id,name_ar,color,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));

  const isOpen = (o) => { const s = stById[o.stage_id]; return s && !s.is_won && !s.is_lost; };
  const open = rows.filter(isOpen);
  const wonAll = rows.filter((o) => stById[o.stage_id]?.is_won);
  const lostAll = rows.filter((o) => stById[o.stage_id]?.is_lost);
  const wonYear = wonAll.filter((o) => o.year === year);
  const total = open.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const weighted = open.reduce((a, o) => a + (o.value_halalas || 0) * ((o.win_pct || 0) / 100), 0);
  const wonValue = wonYear.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const decided = wonAll.length + lostAll.length;
  const winRatePct = decided ? Math.round(wonAll.length / decided * 100) : 0;

  // pipeline by stage (open opps only) for the comparison chart
  const openStages = stages.filter((s) => !s.is_won && !s.is_lost);
  const stageItems = openStages.map((s) => {
    const items = open.filter((o) => o.stage_id === s.id);
    return { label: esc(s.name_ar), value: items.reduce((a, o) => a + (o.value_halalas || 0), 0), n: items.length, sub: items.length + ' فرصة', color: s.color };
  }).filter((x) => x.n > 0);

  // next actions — open opps with a next_action, soonest by win% desc (closest to closing first)
  const actions = open.filter((o) => o.next_action).sort((a, b) => (b.win_pct || 0) - (a.win_pct || 0)).slice(0, 8);

  const statMy = (l, v, sub, tone) => card(`<div style="padding:.75rem .95rem"><div style="font-size:11px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.35rem;${tone ? 'color:' + tone : ''}">${v}</div>${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`);

  // ranked list of my open pipeline (highest value first), with stage + win% + client + next action
  const oppRows = open.slice().sort((a, b) => (b.value_halalas || 0) - (a.value_halalas || 0)).slice(0, 60).map((o) => {
    const st = stById[o.stage_id] || {};
    const prTone = o.priority === 'P0' ? 'red' : o.priority === 'P1' ? 'amber' : 'slate';
    return `<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="Sanad.oppOpen('${o.id}')">
      <td style="padding:.45rem .7rem;font-size:12.5px">${esc(o.title_ar)}${o.priority ? ' ' + pill(tr(o.priority), prTone) : ''}<div style="font-size:10.5px;color:var(--muted)">${esc(clients[o.client_id] || '—')}</div></td>
      <td style="padding:.45rem .7rem;text-align:center"><span style="display:inline-flex;align-items:center;gap:.3rem;font-size:11.5px"><span style="width:8px;height:8px;border-radius:2px;background:${st.color || '#cbd5e1'}"></span>${esc(st.name_ar || o.stage_id)}</span></td>
      <td style="padding:.45rem .7rem;text-align:left;font-weight:800;font-size:12.5px" class="tnum">${fmtSar(o.value_halalas)}</td>
      <td style="padding:.45rem .7rem;text-align:center;font-size:12px;color:var(--muted)" class="tnum">${pct(o.win_pct)}</td>
      <td style="padding:.45rem .7rem;font-size:11px;color:var(--muted)">${esc(o.next_action || '—')}</td></tr>`;
  }).join('');

  const actionRows = actions.map((o) => `<div style="display:flex;align-items:flex-start;gap:.5rem;padding:.45rem 0;border-bottom:1px dashed var(--line)">
    <span style="width:7px;height:7px;border-radius:99px;margin-top:.35rem;flex:0 0 auto;background:${(stById[o.stage_id] || {}).color || '#cbd5e1'}"></span>
    <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:var(--ink2)">${esc(o.next_action)}</div>
      <div style="font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.title_ar)} · ${esc(clients[o.client_id] || '')}</div></div>
    <span class="tnum" style="font-size:11px;color:var(--muted);flex:0 0 auto">${pct(o.win_pct)}</span></div>`).join('') || '<div style="color:var(--faint);font-size:12px;padding:.5rem 0">لا إجراءات تالية مسجّلة</div>';

  const empty = rows.length === 0;
  const body = empty
    ? noticeCard('لا فرص باسمك بعد', 'لا توجد فرص مملوكة لك حاليًا. عندما تُسند إليك فرصة كمالك ستظهر هنا مع خط أنابيبك الشخصي وإجراءاتك التالية ونسبة فوزك.', '/app/opportunities', 'تصفّح كل الفرص')
    : `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:.75rem;margin-bottom:.9rem">
      ${statMy('خط أنابيبي', fmtSar(total), open.length + ' فرصة مفتوحة')}
      ${statMy('المرجّح', fmtSar(weighted), 'حسب الاحتمالية', 'var(--brand2)')}
      ${statMy('فزت ' + year, wonYear.length, fmtSar(wonValue), 'var(--green)')}
      ${statMy('نسبة فوزي', winRatePct + '%', `${wonAll.length} فوز · ${lostAll.length} خسارة`, winRatePct >= 50 ? 'var(--green)' : 'var(--amber)')}
      ${statMy('إجمالي فرصي', rows.length, 'كل الحالات')}
    </div>
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:.9rem">
      ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;font-size:13.5px">خط أنابيبي — مرتّب حسب القيمة</div><span style="font-size:11px;color:var(--muted)">${open.length} فرصة</span></div>
        <div style="max-height:520px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10.5px;color:var(--muted);text-align:right;position:sticky;top:0;background:var(--surface)">
          <th style="padding:.4rem .7rem">الفرصة</th><th style="padding:.4rem .7rem;text-align:center">المرحلة</th><th style="padding:.4rem .7rem;text-align:left">القيمة</th><th style="padding:.4rem .7rem;text-align:center">الاحتمالية</th><th style="padding:.4rem .7rem">الإجراء التالي</th></tr></thead>
          <tbody>${oppRows || '<tr><td colspan="5" style="padding:1rem;color:var(--muted);font-size:12.5px">لا فرص مفتوحة — كل فرصك مُغلقة</td></tr>'}</tbody></table></div>`)}
      <div style="display:flex;flex-direction:column;gap:.9rem">
        ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">خطي حسب المرحلة</div>
          <div style="padding:.7rem 1rem">${stageItems.length ? hbars(stageItems, { fmt: fmtSar }) : '<div style="color:var(--faint);font-size:12px">لا فرص مفتوحة</div>'}</div>`)}
        ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">إجراءاتي التالية</div>
          <div style="padding:.4rem 1rem .7rem">${actionRows}</div>`)}
      </div>
    </div>`;
  return layout({ user, active: 'my-opportunities', title: 'فرصي', subtitle: `خط الفرص الخاص بي · ${esc(user.name_ar || user.username || '')}`, body });
}
