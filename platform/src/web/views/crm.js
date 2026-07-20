// CRM pages (v2): opportunity pipeline with saved views + rot/next-action discipline,
// and the personal pipeline (فرصي) run as a next-action work queue.
// Patterns: benchmarks §1 (stage tooltips with entry criteria, default win % → weighted value,
// rot as a first-class visual state, next-action selling). Page JS: /static/pages/opps.js.
import { layout, card, pill, tr } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { config } from '../../core/config.js';
import { listOpportunities, ROT_THRESHOLDS } from '../../modules/crm/opportunities.js';
import { listViews } from '../../modules/views/views.js';
import { can } from '../../core/rbac/index.js';
import { sarShort, pct, esc, statMini, ddWrap, ddRows } from './_shared.js';
import { G } from '../i18n/glossary.js';

// معنى كل مرحلة + معيار الدخول إليها — يظهر كتلميح على رأس العمود (نمط Lightning Path).
const STAGE_TIPS = {
  LEAD: 'فرصة أولية: جهة أبدت اهتمامًا ولم يُتحقق بعد من الميزانية وصاحب القرار',
  QUALIFIED: 'مؤهلة: تم التحقق من الميزانية وصاحب القرار والحاجة الفعلية',
  PROPOSAL: 'قُدِّم العرض: العرض الفني والمالي لدى العميل وبانتظار رده',
  NEGOTIATION: 'تفاوض: نقاش نهائي على النطاق والسعر قبل الترسية',
  WON: 'مكسوبة: تمت الترسية ووُقِّع الاتفاق — تتحول إلى مشروع',
  LOST: 'مفقودة: حُسمت لصالح جهة أخرى أو أُلغيت — توثَّق أسبابها',
  ON_HOLD: 'مؤجلة: متوقفة مؤقتًا بقرار من العميل أو منا — تُراجع دوريًا',
};
export function stageTip(s) {
  const base = STAGE_TIPS[s.id] || `مرحلة «${s.name_ar}» ضمن مسار الفرصة`;
  return s.default_win_pct == null ? base : `${base} — احتمال افتراضي ${Math.round(s.default_win_pct)}%`;
}

const STALLED_HINT = 'فرصة متوقفة — حرّكها أو حدّث خطوتها التالية';
const weightedOf = (o) => (o.value_halalas || 0) * ((o.win_pct || 0) / 100);

// شارة عمر المرحلة: تتدرج (هادئ → كهرماني > نصف العتبة → أحمر > العتبة).
function ageChip(o) {
  const n = o.stage_age_days;
  if (n == null) return '';
  const th = ROT_THRESHOLDS[o.stage_id];
  const tone = th && n > th ? 'red' : th && n > th / 2 ? 'amber' : 'slate';
  const c = { red: 'background:#fee2e2;color:#dc2626', amber: 'background:#fef3c7;color:#b45309', slate: 'background:#f1f5f9;color:#64748b' }[tone];
  const title = th && n > th ? STALLED_HINT : G.stageAge(n);
  return `<span class="pill tnum" style="${c}" title="${esc(title)}">${icon('clock')} منذ ${n} يوماً</span>`;
}
const naChip = () => `<span class="pill" style="background:#fee2e2;color:#dc2626" title="كل فرصة مفتوحة تحتاج خطوة تالية مؤرّخة — أضفها من صفحة الفرصة">● ${G.noNextAction}</span>`;

export async function opportunitiesPage(user, opts = {}) {
  const sectorFilter = opts.sector || '';
  const rows = await listOpportunities(user, sectorFilter ? { sector: sectorFilter } : {});
  const stages = await all('SELECT id,name_ar,color,default_win_pct,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));
  const users = Object.fromEntries((await all('SELECT id,name_ar,username FROM app_user')).map((u) => [u.id, u.name_ar || u.username]));
  const sectors = await all('SELECT id,name_ar FROM sector WHERE active=1 ORDER BY name_ar');
  const savedViews = await listViews(user, 'opportunities');
  const canCreate = can(user, 'create', 'opportunity');
  const canEdit = can(user, 'update', 'opportunity');

  const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const isOpen = (o) => { const s = stById[o.stage_id]; return s && !s.is_won && !s.is_lost; };
  const open = rows.filter(isOpen);
  const wonAll = rows.filter((o) => stById[o.stage_id]?.is_won);
  const lostAll = rows.filter((o) => stById[o.stage_id]?.is_lost);
  const stalled = open.filter((o) => o.rot);
  const total = open.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const weighted = Math.round(open.reduce((a, o) => a + weightedOf(o), 0));
  const decided = wonAll.length + lostAll.length;
  const winRate = decided ? Math.round((wonAll.length / decided) * 100) : 0;

  const byStage = {}; for (const s of stages) byStage[s.id] = [];
  for (const o of rows) (byStage[o.stage_id] ||= []).push(o);

  // ── بطاقة كانبان ──
  const opCard = (o) => {
    const st = stById[o.stage_id] || {};
    const openRow = isOpen(o);
    const cl = clients[o.client_id]; const ow = users[o.owner_user_id];
    const hay = `${o.title_ar} ${cl || ''} ${ow || ''}`.toLowerCase();
    const dnd = canEdit ? 'draggable="true" ondragstart="Sanad.kStart(event)" ondragend="Sanad.kEnd(event)"' : '';
    const prTone = o.priority === 'P0' ? 'red' : o.priority === 'P1' ? 'amber' : 'slate';
    const chips = [
      o.priority ? pill(tr(o.priority), prTone) : '',
      openRow ? ageChip(o) : '',
      openRow && o.no_next_action ? naChip() : '',
    ].filter(Boolean).join(' ');
    return `<div class="kcard" ${dnd} data-action="open-opp" data-id="${o.id}" data-sector="${o.sector_id || ''}" data-hay="${esc(hay).replace(/"/g, '')}" style="--_c:${st.color || '#cbd5e1'};cursor:pointer" role="link" tabindex="0" aria-label="فتح الفرصة ${esc(o.title_ar)}">
      <div class="kt">${esc(o.title_ar)}</div>
      <div class="km">${cl ? `<span style="display:inline-flex;align-items:center;gap:.25rem;min-width:0;overflow:hidden;text-overflow:ellipsis">${icon('building')}${esc(cl)}</span>` : '<span style="color:var(--faint)">بدون عميل</span>'}</div>
      ${chips ? `<div class="km">${chips}</div>` : ''}
      <div class="km"><span class="kv tnum">${fmtSar(o.value_halalas)}</span>
        <span class="tnum" style="margin-inline-start:auto;color:var(--muted)">${pct(o.win_pct)}</span>
        ${ow ? `<span class="kav" title="${esc(ow)}">${esc((ow || '؟').trim().charAt(0))}</span>` : ''}</div>
    </div>`;
  };

  // ── أعمدة كانبان: اسم + تلميح معنى المرحلة + عدد + إجمالي + مرجّح ──
  const columns = stages.map((s) => {
    const items = byStage[s.id] || [];
    const colTotal = items.reduce((a, o) => a + (o.value_halalas || 0), 0);
    const colWeighted = Math.round(items.reduce((a, o) => a + weightedOf(o), 0));
    const drop = canEdit ? 'ondragover="Sanad.kOver(event)" ondragleave="Sanad.kLeave(event)" ondrop="Sanad.kDrop(event)"' : '';
    return `<div class="kcol" data-stage="${s.id}" ${drop}>
      <div class="kcol-head"><span class="kcol-dot" style="background:${s.color || '#cbd5e1'}"></span>
        <span class="t" data-tip="${esc(stageTip(s))}" tabindex="0">${esc(s.name_ar)}</span><span class="n" data-count>${items.length}</span>
        <span class="v tnum" data-total>${sarShort(colTotal)}</span></div>
      <div style="padding:0 .55rem .5rem;font-size:10.5px;color:var(--muted)">${G.weighted}: <span class="tnum" style="font-weight:800" data-weighted>${sarShort(colWeighted)}</span></div>
      <div class="kcol-body">${items.map(opCard).join('') || `<div class="empty-state" style="padding:1.1rem .4rem">${icon('opportunity')}<div class="s">لا فرص في هذه المرحلة</div></div>`}</div>
    </div>`;
  }).join('');

  // ── شرائح القطاعات (تصفية من الخادم) — تحافظ على بقية معاملات الرابط ──
  const chipHref = (sector) => {
    const p = new URLSearchParams();
    if (sector) p.set('sector', sector);
    if (opts.year) p.set('year', opts.year);
    const q = p.toString();
    return '/app/opportunities' + (q ? '?' + q : '');
  };
  const sectorChips = `<div class="chips" style="margin-bottom:.6rem"><span class="lbl">${G.filter}</span>
    <a class="chip ${!sectorFilter ? 'on' : ''}" href="${chipHref('')}">كل القطاعات</a>
    ${sectors.map((s) => `<a class="chip ${sectorFilter === s.id ? 'on' : ''}" href="${chipHref(s.id)}"><span class="dot" style="background:var(--brand)"></span>${esc(s.name_ar)}</a>`).join('')}</div>`;

  // ── شريط العروض المحفوظة: الكل + عروض المستخدم + حفظ العرض ──
  const viewQs = (pj) => {
    try { const o = JSON.parse(pj); return new URLSearchParams(o).toString(); }
    catch { return String(pj || ''); }
  };
  const viewChips = savedViews.map((v) => `<span class="chip" style="gap:.3rem;padding-inline-end:.4rem">
      <a href="/app/opportunities?${esc(viewQs(v.params_json))}" title="تطبيق هذا العرض">${v.is_default ? '★ ' : ''}${esc(v.name_ar)}</a>
      ${v.is_default ? '' : `<button data-action="view-default" data-id="${v.id}" title="تعيينه العرض الافتراضي" aria-label="تعيين ${esc(v.name_ar)} افتراضيًا" style="border:none;background:none;cursor:pointer;color:var(--faint);font-size:12px;padding:0">☆</button>`}
      <button data-action="view-del" data-id="${v.id}" title="حذف هذا العرض" aria-label="حذف ${esc(v.name_ar)}" style="border:none;background:none;cursor:pointer;color:var(--faint);font-size:11px;padding:0">✕</button>
    </span>`).join('');
  const viewsBar = `<div class="chips" style="margin-bottom:.9rem"><span class="lbl">${G.savedViews}</span>
    <a class="chip ${!sectorFilter ? 'on' : ''}" href="/app/opportunities">${G.all}</a>
    ${viewChips}
    <button class="btn btn-sm" data-action="view-save">${icon('plus')} ${G.saveView}</button></div>`;

  // ── شريط التحليلات: 4 بطاقات قابلة للنقر تفتح تفصيلًا ──
  const tile = (key, label, value, sub, color) => `
    <div class="card cardclick" data-dd="${key}" role="button" tabindex="0" style="padding:.65rem .95rem;min-width:150px;flex:1">
      <div style="font-size:11px;color:var(--muted);font-weight:700;display:flex;align-items:center;gap:.3rem">${label}<span class="dd-hint" style="color:var(--faint)">⌄</span></div>
      <div class="tnum" style="font-size:1.3rem;font-weight:800;letter-spacing:-.02em;color:${color || 'var(--ink2)'}">${value}</div>
      <div style="font-size:10.5px;color:var(--faint)">${sub}</div></div>`;
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${tile('raw', G.raw, fmtSar(total), open.length + ' فرصة قيد المتابعة')}
    ${tile('weighted', G.weighted, fmtSar(weighted), 'القيمة × احتمال الفوز', 'var(--brand2)')}
    ${tile('winrate', 'معدل الفوز', winRate + '%', `${wonAll.length} ${G.won} · ${lostAll.length} ${G.lost}`, winRate >= 50 ? 'var(--green)' : '')}
    ${tile('stalled', 'فرص متوقفة', stalled.length, stalled.length ? 'تجاوزت مدة مرحلتها — تحتاج تحريكًا' : 'لا فرص متجاوزة لمدتها', stalled.length ? 'var(--amber)' : 'var(--green)')}
  </div>`;

  // drill-downs (server-rendered inert templates; same scope as the page)
  const oppRowDD = (o, val) => `<a class="dd-row" href="/app/opportunity/${o.id}" style="color:inherit">
    <span>${esc(o.title_ar)}${clients[o.client_id] ? ` · ${esc(clients[o.client_id])}` : ''}</span><b class="tnum">${val}</b></a>`;
  const topN = (arr, n) => arr.slice(0, n);
  const more = (arr, n) => (arr.length > n ? `<div style="font-size:11px;color:var(--faint);padding-top:.4rem">و${arr.length - n} فرصة أخرى…</div>` : '');
  const byVal = open.slice().sort((a, b) => (b.value_halalas || 0) - (a.value_halalas || 0));
  const dds = [
    ddWrap('raw', G.raw, `${open.length} فرصة مفتوحة بقيمة ${fmtSar(total)}`,
      ddRows(topN(byVal, 30).map((o) => oppRowDD(o, fmtSar(o.value_halalas)))) + more(byVal, 30)),
    ddWrap('weighted', G.weighted, `الإجمالي المرجّح ${fmtSar(weighted)} — كل فرصة بقيمتها × احتمالها`,
      ddRows(topN(byVal.slice().sort((a, b) => weightedOf(b) - weightedOf(a)), 30)
        .map((o) => oppRowDD(o, `${fmtSar(Math.round(weightedOf(o)))} <span style="color:var(--faint);font-weight:600">(${pct(o.win_pct)})</span>`))) + more(byVal, 30)),
    ddWrap('winrate', 'معدل الفوز', `${winRate}% من ${decided} فرصة محسومة`,
      ddRows([
        ...topN(wonAll, 15).map((o) => oppRowDD(o, `${pill(G.won, 'green')} <span class="tnum">${fmtSar(o.value_halalas)}</span>`)),
        ...topN(lostAll, 15).map((o) => oppRowDD(o, `${pill(G.lost, 'red')} <span class="tnum">${fmtSar(o.value_halalas)}</span>`)),
      ])),
    ddWrap('stalled', 'فرص متوقفة', STALLED_HINT,
      ddRows(stalled.slice().sort((a, b) => (b.stage_age_days || 0) - (a.stage_age_days || 0))
        .map((o) => oppRowDD(o, `${esc((stById[o.stage_id] || {}).name_ar || '')} · <span class="tnum">منذ ${o.stage_age_days} يوماً</span>`)))),
  ].join('');

  // ── الجدول (تبديل العرض) ──
  const tableRows = rows.slice(0, 200).map((o) => {
    const st = stById[o.stage_id] || {};
    return `<tr class="border-b border-line" data-action="open-opp" data-id="${o.id}" data-hay="${esc(`${o.title_ar} ${clients[o.client_id] || ''}`.toLowerCase()).replace(/"/g, '')}" data-sector="${o.sector_id || ''}" style="cursor:pointer">
      <td class="py-2.5 px-3 text-[13px]">${esc(o.title_ar)}</td>
      <td class="px-3 text-[12px]">${esc(clients[o.client_id] || '—')}</td>
      <td class="px-3">${pill(esc(st.name_ar || o.stage_id), 'blue')}</td>
      <td class="px-3 text-[13px] tnum">${fmtSar(o.value_halalas)}</td>
      <td class="px-3 text-[12px] text-muted tnum">${pct(o.win_pct)}</td>
      <td class="px-3 text-[12px]">${isOpen(o) ? ageChip(o) : '<span class="text-faint">—</span>'}</td>
      <td class="px-3 text-[11.5px] text-muted">${o.no_next_action ? (isOpen(o) ? naChip() : '—') : esc(o.next_action)}</td></tr>`;
  }).join('');

  const emptyAll = rows.length === 0;
  const boardArea = emptyAll
    ? `<div class="card"><div class="empty-state">${icon('opportunity')}
        <div class="t">لا توجد فرص ضمن نطاقك بعد</div>
        <div class="s">كل فرصة تحمل قيمة ومرحلة وخطوة تالية — أنشئ الأولى لتبدأ متابعة خط المبيعات.</div>
        ${canCreate ? `<button class="btn btn-primary" data-action="opp-add">${icon('plus')} فرصة جديدة</button>` : ''}</div></div>`
    : `<div id="opp-kanban" class="kanban">${columns}</div>
      <div id="opp-table" class="card" style="display:none;overflow-x:auto">
        <table class="w-full"><thead><tr class="text-[11px] text-muted text-right">
          <th class="py-2 px-3 font-medium">العنوان</th><th class="px-3 font-medium">العميل</th><th class="px-3 font-medium">${G.stage}</th>
          <th class="px-3 font-medium">القيمة</th><th class="px-3 font-medium">${G.probability}</th>
          <th class="px-3 font-medium">العمر في المرحلة</th><th class="px-3 font-medium">${G.nextAction}</th></tr></thead>
        <tbody>${tableRows}</tbody></table></div>`;

  const body = `
    <div class="toolbar">
      <div class="seg"><button class="on" data-view="kanban" onclick="Sanad.pmoView('opp','kanban')">${icon('kanban')} كانبان</button>
        <button data-view="table" onclick="Sanad.pmoView('opp','table')">${icon('list')} جدول</button></div>
      <div class="search">${icon('search')}<input class="input" id="opp-q" aria-label="بحث في الفرص" placeholder="ابحث بالعنوان أو العميل…"></div>
      <div class="spacer"></div>
      ${canCreate ? `<button class="btn btn-primary" data-action="opp-add">${icon('plus')} فرصة جديدة</button>` : ''}
    </div>
    ${viewsBar}
    ${sectorChips}
    ${strip}
    ${boardArea}
    ${dds}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      stages:${JSON.stringify(stages.map((s) => ({ id: s.id, name_ar: s.name_ar, color: s.color }))).replace(/</g, '\\u003c')},
      sectors:${JSON.stringify(sectors.map((s) => ({ id: s.id, name_ar: s.name_ar }))).replace(/</g, '\\u003c')},
      canCreateOpp:${canCreate ? 'true' : 'false'},
      viewsPage:'opportunities'
    });</script>`;
  return layout({
    user, active: 'opportunities', title: 'الفرص والمبيعات',
    subtitle: `${rows.length} فرصة · ${G.weighted} ${fmtSar(weighted)}`, body,
    scripts: ['/static/pages/opps.js'],
  });
}

// ── فرصي — الانضباط الشخصي: قائمة عمل مرتّبة بالأولوية (المتوقف أولًا ثم الأقدم) ──
export async function myOpportunitiesPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const scoped = await listOpportunities(user);
  const rows = scoped.filter((o) => o.owner_user_id === user.id);
  const stages = await all('SELECT id,name_ar,color,default_win_pct,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));

  const isOpen = (o) => { const s = stById[o.stage_id]; return s && !s.is_won && !s.is_lost; };
  const open = rows.filter(isOpen);
  const wonAll = rows.filter((o) => stById[o.stage_id]?.is_won);
  const lostAll = rows.filter((o) => stById[o.stage_id]?.is_lost);
  const stalled = open.filter((o) => o.rot);
  const total = open.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const weighted = Math.round(open.reduce((a, o) => a + weightedOf(o), 0));
  const decided = wonAll.length + lostAll.length;
  const winRate = decided ? Math.round((wonAll.length / decided) * 100) : 0;

  // المتوقف أولًا، ثم الأطول بقاءً في مرحلته
  const sorted = open.slice().sort((a, b) =>
    ((b.rot ? 1 : 0) - (a.rot ? 1 : 0)) || ((b.stage_age_days || 0) - (a.stage_age_days || 0)));

  const stageOptions = (cur) => stages.map((s) =>
    `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.name_ar)}</option>`).join('');

  const listRows = sorted.map((o) => {
    const st = stById[o.stage_id] || {};
    const rowEdit = can(user, 'update', 'opportunity', o);
    const naCell = rowEdit
      ? `<span class="editable" data-action="na-edit" data-id="${o.id}" data-value="${esc(o.next_action || '')}" role="button" tabindex="0" title="انقر لتعديل الخطوة التالية" style="font-size:12px;${o.no_next_action ? 'color:var(--red);font-weight:700' : ''}">${o.no_next_action ? '● ' + G.noNextAction + ' — أضفها' : esc(o.next_action)}</span>`
      : `<span style="font-size:12px;color:var(--muted)">${o.no_next_action ? G.noNextAction : esc(o.next_action)}</span>`;
    return `<tr style="border-bottom:1px solid var(--line);${o.rot ? 'background:#fffbeb' : ''}">
      <td style="padding:.5rem .7rem;min-width:180px"><a href="/app/opportunity/${o.id}" style="font-size:12.5px;font-weight:700;color:var(--ink2)">${esc(o.title_ar)}</a>
        <div style="font-size:10.5px;color:var(--muted)">${esc(clients[o.client_id] || 'بدون عميل')}</div></td>
      <td style="padding:.5rem .7rem;text-align:center">${rowEdit
        ? `<select class="input" data-stage-move data-id="${o.id}" aria-label="نقل مرحلة ${esc(o.title_ar)}" style="font-size:11.5px;padding:.25rem .4rem;border-color:${st.color || 'var(--line)'}55">${stageOptions(o.stage_id)}</select>`
        : `<span class="pill" style="background:${st.color || '#cbd5e1'}22;color:var(--ink2)">${esc(st.name_ar || o.stage_id)}</span>`}</td>
      <td style="padding:.5rem .7rem;text-align:center">${ageChip(o)}</td>
      <td style="padding:.5rem .7rem">${naCell}</td>
      <td style="padding:.5rem .7rem;text-align:left;font-weight:800;font-size:12.5px" class="tnum">${fmtSar(o.value_halalas)}
        <div style="font-weight:600;font-size:10px;color:var(--muted)">مرجّح ${fmtSar(Math.round(weightedOf(o)))}</div></td>
    </tr>`;
  }).join('');

  const empty = rows.length === 0;
  const body = empty
    ? `<div class="card"><div class="empty-state">${icon('flag')}
        <div class="t">لا فرص باسمك بعد</div>
        <div class="s">عندما تُسند إليك فرصة كمالك ستظهر هنا كقائمة عمل: المتوقف أولًا، ولكل فرصة خطوتها التالية.</div>
        <a class="btn" href="/app/opportunities">تصفّح كل الفرص</a></div></div>`
    : `
    <div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
      ${statMini('عدد فرصي', open.length, `${rows.length} إجمالًا بكل الحالات`)}
      ${statMini('قيمتها', fmtSar(total), 'الفرص المفتوحة')}
      ${statMini('مرجّحها', fmtSar(weighted), 'القيمة × الاحتمال', 'brand')}
      ${statMini('معدل فوزي', winRate + '%', `${wonAll.length} ${G.won} · ${lostAll.length} ${G.lost}`, winRate >= 50 ? 'good' : 'warn')}
      ${statMini('متوقفة', stalled.length, stalled.length ? 'تجاوزت مدة مرحلتها' : 'لا شيء متوقف', stalled.length ? 'warn' : 'good')}
    </div>
    ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:.6rem">
      <div style="font-weight:800;font-size:13.5px">قائمة عملي — المتوقف أولًا ثم الأقدم في مرحلته</div>
      <span style="font-size:11px;color:var(--muted)">${open.length} فرصة مفتوحة</span></div>
      <div class="tblwrap"><table style="width:100%;border-collapse:collapse;min-width:680px">
        <thead><tr style="font-size:10.5px;color:var(--muted);text-align:right">
          <th style="padding:.45rem .7rem">الفرصة</th><th style="padding:.45rem .7rem;text-align:center">${G.stage}</th>
          <th style="padding:.45rem .7rem;text-align:center">العمر في المرحلة</th>
          <th style="padding:.45rem .7rem">${G.nextAction}</th><th style="padding:.45rem .7rem;text-align:left">القيمة</th></tr></thead>
        <tbody>${listRows || `<tr><td colspan="5"><div class="empty-state">${icon('check')}<div class="t">كل فرصك محسومة</div><div class="s">لا فرص مفتوحة الآن — كل ما لديك إما ${G.won} أو ${G.lost}.</div></div></td></tr>`}</tbody>
      </table></div>`)}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      stages:${JSON.stringify(stages.map((s) => ({ id: s.id, name_ar: s.name_ar, color: s.color }))).replace(/</g, '\\u003c')}
    });</script>`;
  return layout({
    user, active: 'my-opportunities', title: 'فرصي',
    subtitle: `خط الفرص الخاص بي · ${esc(user.name_ar || user.username || '')} · ${year}`, body,
    scripts: ['/static/pages/opps.js'],
  });
}
