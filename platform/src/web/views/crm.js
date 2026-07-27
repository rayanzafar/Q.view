// CRM pages (v2.1): opportunity pipeline with saved views + rot/next-action discipline,
// and the personal pipeline (فرصي) run as a priority work queue (stalled → no-next-step → on-track).
// Patterns: benchmarks §1 (stage dictionary popovers via stageInfo, default win % → weighted value,
// rot as a first-class visual state, next-action selling). Page JS: /static/pages/opps.js.
import { layout, card, pill } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all } from '../../core/db/index.js';
import { config } from '../../core/config.js';
import { listOpportunities, ROT_THRESHOLDS } from '../../modules/crm/opportunities.js';
import { stageInfo } from '../../core/i18n/stages.js';
import { listViews } from '../../modules/views/views.js';
import { can } from '../../core/rbac/index.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { sarShort, pct, esc, statMini, ddWrap, ddRows } from './_shared.js';
import { G } from '../i18n/glossary.js';
import { countAr, dayWord } from '../../core/i18n/plural.js';

// معنى كل مرحلة + معيار الدخول إليها — يظهر كتلميح على رأس العمود (نمط Lightning Path).
const STAGE_TIPS = {
  LEAD: 'فرصة أولية: جهة أبدت اهتماماً ولم يُتحقق بعد من الميزانية وصاحب القرار',
  QUALIFIED: 'مؤهلة: تم التحقق من الميزانية وصاحب القرار والحاجة الفعلية',
  PROPOSAL: 'قُدِّم العرض: العرض الفني والمالي لدى العميل وبانتظار رده',
  NEGOTIATION: 'تفاوض: نقاش نهائي على النطاق والسعر قبل الترسية',
  WON: 'مكسوبة: تمت الترسية ووُقِّع الاتفاق — تتحول إلى مشروع',
  LOST: 'مفقودة: حُسمت لصالح جهة أخرى أو أُلغيت — توثَّق أسبابها',
  ON_HOLD: 'مؤجلة: متوقفة مؤقتاً بقرار من العميل أو منا — تُراجع دورياً',
};
export function stageTip(s) {
  const base = STAGE_TIPS[s.id] || `مرحلة «${s.name_ar}» ضمن مسار الفرصة`;
  return s.default_win_pct == null ? base : `${base} — احتمال افتراضي ${Math.round(s.default_win_pct)}%`;
}

const STALLED_HINT = 'فرصة متوقفة — حرّكها أو حدّث خطوتها التالية';
const weightedOf = (o) => (o.value_halalas || 0) * ((o.win_pct || 0) / 100);

// ── نظام ألوان المراحل ──────────────────────────────────────────────────────
// كل مرحلة بلونها الحقيقي من قاعدة البيانات (stage.color) ويُستعمل بوضوح: شريط علوي
// للعمود + خلفية خفيفة لرأسه + حدّ جانبي للبطاقة. لوحة احتياطية تضمن التمايز لو غاب
// اللون أو جاء بصيغة غير صالحة. الأخضر=فائزة والأحمر=خسارة دائماً (دلالة ثابتة لا تتبدّل).
const STAGE_FALLBACK = { LEAD: '#64748b', QUALIFIED: '#2563eb', PROPOSAL: '#d97706', NEGOTIATION: '#C9A227', ON_HOLD: '#8b5cf6', WON: '#059669', LOST: '#dc2626' };
const hex6 = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);
function stageColor(s) {
  if (!s) return '#64748b';
  if (s.is_won) return '#059669';
  if (s.is_lost) return '#dc2626';
  return hex6(s.color) || STAGE_FALLBACK[s.id] || '#64748b';
}
// خلفية خفيفة من لون المرحلة (شفافية بصيغة hex من رقمين: 1f≈12% · 24≈14%).
const tint = (color, aa) => `${color}${aa || '1f'}`;

// شارة عمر المرحلة: تتدرج (هادئ → كهرماني > نصف العتبة → أحمر > العتبة).
// compact: نسخة البطاقة النحيفة — بلا أيقونة وبحشوة أصغر كي يتسع السطر الثاني كاملاً.
function ageChip(o, compact = false) {
  const n = o.stage_age_days;
  if (n == null) return '';
  const th = ROT_THRESHOLDS[o.stage_id];
  const tone = th && n > th ? 'red' : th && n > th / 2 ? 'amber' : 'slate';
  const c = { red: 'background:#fee2e2;color:#b91c1c', amber: 'background:#fef3c7;color:#92400e', slate: 'background:#f1f5f9;color:#475569' }[tone];
  const title = th && n > th ? STALLED_HINT : G.stageAge(n);
  return `<span class="pill tnum" style="${c}${compact ? ';padding:.12rem .38rem' : ''}" title="${esc(title)}">${compact ? '' : icon('clock') + ' '}${dayWord(n)}</span>`;
}
// كهرماني لا أحمر: «بلا خطوة» تنبيه انضباط واسع الانتشار، والأحمر محجوز للمتوقفة فعلاً
const naChip = (compact = false) => `<span class="pill" style="background:#fef3c7;color:#92400e${compact ? ';padding:.12rem .38rem' : ''}" title="كل فرصة مفتوحة تحتاج خطوة تالية مؤرّخة — أضفها من صفحة الفرصة">${compact ? '' : '● '}${G.noNextAction}</span>`;

// نافذة «شرح المرحلة» — سبعة أسطر ثابتة من قاموس المراحل (stageInfo)، تُفتح من زر «؟» برأس العمود.
function stageInfoTpl(s) {
  const i = stageInfo(s);
  return `<template id="stage-info-${s.id}">
    <div class="modal-head"><div style="font-weight:800;font-size:15px">مرحلة «${esc(i.name_ar)}»</div>
      <button class="btn btn-ghost btn-sm" data-action="modal-close" aria-label="إغلاق">✕</button></div>
    <div class="modal-body" style="font-size:13.5px;line-height:1.95;color:var(--ink2)">${esc(i.meaning || '—')}</div></template>`;
}

export async function opportunitiesPage(user, opts = {}) {
  const sectorFilter = opts.sector || '';
  const fiscalYear = config.fiscalYear;
  const allRows = await listOpportunities(user, sectorFilter ? { sector: sectorFilter } : {});
  // السنة عاملُ تصفيةٍ علويّ (بدل حشرها داخل أعمدة الحسم كما كان): الافتراضي السنة المالية
  // الحالية، و«الكل» يعرض كل السنوات معاً (بما فيها فرص بلا سنة مسجّلة). قائمة السنوات من كل الفرص.
  const years = [...new Set(allRows.map((o) => o.year).filter(Boolean))].sort((a, b) => b - a);
  const yearFilter = opts.year === 'all' ? 'all' : (opts.year ? Number(opts.year) : fiscalYear);
  const rows = yearFilter === 'all' ? allRows : allRows.filter((o) => o.year === yearFilter);
  const stages = await all('SELECT id,name_ar,color,default_win_pct,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));
  const users = Object.fromEntries((await all('SELECT id,name_ar,username FROM app_user')).map((u) => [u.id, u.name_ar || u.username]));
  // قطاعات التسليم وحدها: هذه القائمة تخدم ثلاثة أشياء كلها «قطاع» بالمعنى التجاري — شرائح
  // تصفية خط الفرص، وخانة القطاع في نافذة «فرصة جديدة»، ووجهات نقل الفرصة بين القطاعات.
  // الفرصة إيراد قادم، ووحدة المساندة بلا خط فرص ولا هدف مبيعات، فنقل فرصة إليها يُخرجها من
  // مقارنة القطاعات ومن مستهدف الشركة بلا أي رسالة تفسّر الاختفاء (والخدمة ترفضه أيضاً).
  const sectors = await all(`SELECT id,name_ar FROM sector WHERE active=1 AND ${DELIVERY_SECTOR_SQL} ORDER BY name_ar`);
  const savedViews = await listViews(user, 'opportunities');
  const canCreate = can(user, 'create', 'opportunity');
  const canEdit = can(user, 'update', 'opportunity');
  // مرحلتا الحسم (فائزة/خاسرة) — تُستدعيان من قائمة إجراءات البطاقة «نقل إلى فائزة/مفقودة».
  const wonStage = stages.find((s) => s.is_won) || null;
  const lostStage = stages.find((s) => s.is_lost) || null;
  // النقل بين القطاعات = مناولة الفرصة لقطاع آخر؛ متاح لمن يملك صلاحية تعديل الفرصة (canEdit).
  // الوجهات = كل القطاعات النشطة (يستبعد المتصفّح القطاعَ الحالي للبطاقة)، والخادم يدقّق نهائياً.
  const moveTargets = sectors;

  const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const isOpen = (o) => { const s = stById[o.stage_id]; return s && !s.is_won && !s.is_lost; };
  const open = rows.filter(isOpen);
  const wonAll = rows.filter((o) => stById[o.stage_id]?.is_won);
  const lostAll = rows.filter((o) => stById[o.stage_id]?.is_lost);
  const stalled = open.filter((o) => o.rot);
  // المشاريع الناتجة عن الفرص الفائزة (WON «تتحول إلى مشروع») — ربط عبر project.source_opp_id
  const PRJ_LABEL = { IN_PROGRESS: ['قيد التنفيذ', 'blue'], ON_HOLD: ['متوقّف مؤقتًا', 'amber'], COMPLETED: ['مكتمل', 'green'], NOT_STARTED: ['لم يبدأ', 'slate'], CANCELLED: ['ملغى', 'slate'] };
  const projByOpp = {};
  const wonIds = wonAll.map((o) => o.id);
  if (wonIds.length) {
    for (const p of await all(`SELECT id, name_ar, status, source_opp_id FROM project WHERE source_opp_id IN (${wonIds.map(() => '?').join(',')}) AND deleted_at IS NULL`, wonIds))
      projByOpp[p.source_opp_id] = p;
  }
  const wonProjectCount = Object.keys(projByOpp).length;
  const prjCell = (o) => { const pr = projByOpp[o.id]; const L = pr ? (PRJ_LABEL[pr.status] || [pr.status, 'slate']) : null;
    return `<td style="padding:.55rem .7rem;font-size:12px">${pr ? `<a href="/app/project/${pr.id}" style="font-weight:700;color:var(--brand)">${esc(pr.name_ar)}</a> ${pill(L[0], L[1])}` : '<span style="color:var(--faint)">— لم يُنشأ مشروع بعد</span>'}</td>`; };
  const total = open.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const weighted = Math.round(open.reduce((a, o) => a + weightedOf(o), 0));
  const decided = wonAll.length + lostAll.length;
  const winRate = decided ? Math.round((wonAll.length / decided) * 100) : 0;

  // ── عرض الجدول للمحسومة (?view=table&stage=WON|LOST): قائمة كاملة بدل بطاقات مكدسة ──
  const tblStage = String(opts.stage || '');
  const tblStageRow = stById[tblStage];
  if (opts.view === 'table' && tblStageRow && (tblStageRow.is_won || tblStageRow.is_lost)) {
    const list = rows.filter((o) => o.stage_id === tblStage);
    // سبب الحسم = ملاحظة آخر انتقال إلى هذه المرحلة (إن وُثِّقت)
    const reasonBy = {};
    for (const h of await all(
      'SELECT opportunity_id, note, changed_at FROM opportunity_stage_history WHERE to_stage_id = ? AND note IS NOT NULL ORDER BY changed_at',
      [tblStage])) reasonBy[h.opportunity_id] = h.note;
    const sumV = list.reduce((a, o) => a + (o.value_halalas || 0), 0);
    const backHref = '/app/opportunities' + (sectorFilter ? '?sector=' + encodeURIComponent(sectorFilter) : '');
    const listRows = list.map((o) => `<tr style="border-bottom:1px solid var(--line)">
        <td style="padding:.55rem .7rem;min-width:200px"><a href="/app/opportunity/${o.id}" title="${esc(o.title_ar)}" style="font-size:12.5px;font-weight:700;color:var(--ink2)">${esc(o.title_ar)}</a></td>
        <td style="padding:.55rem .7rem;font-size:12px;color:var(--muted)">${esc(clients[o.client_id] || '—')}</td>
        <td class="tnum" style="padding:.55rem .7rem;text-align:left;font-weight:800;font-size:12.5px;white-space:nowrap">${fmtSar(o.value_halalas)}</td>
        ${tblStageRow.is_won ? prjCell(o) : ''}
        <td style="padding:.55rem .7rem;text-align:center;white-space:nowrap"><span class="tnum" style="font-size:12px">${o.year || '—'}</span> ${o.exclude_from_sales ? pill('تاريخي', 'slate') : ''}</td>
        <td style="padding:.55rem .7rem;font-size:11.5px;color:var(--muted);max-width:260px">${esc(reasonBy[o.id] || '—')}</td>
      </tr>`).join('');
    const body = `
      <div class="toolbar">
        <a class="btn" href="${backHref}">${icon('kanban')} عودة إلى اللوحة</a>
        <div class="spacer"></div>
        <span style="font-size:11.5px;color:var(--muted)">الفرص التاريخية لا تدخل في مؤشرات المبيعات</span>
      </div>
      ${card(`<div style="padding:.8rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.55rem;flex-wrap:wrap">
        <span class="kcol-dot" style="background:${tblStageRow.color || '#cbd5e1'};width:10px;height:10px;border-radius:50%"></span>
        <div style="font-weight:800;font-size:13.5px">كل الفرص في مرحلة «${esc(tblStageRow.name_ar)}»</div>
        <span style="font-size:11.5px;color:var(--muted)"><span class="tnum" style="font-weight:800">${list.length}</span> فرصة بقيمة <span class="tnum" style="font-weight:800">${fmtSar(sumV)}</span></span></div>
      ${list.length ? `<div class="tblwrap"><table style="width:100%;border-collapse:collapse;min-width:680px">
        <thead><tr style="font-size:10.5px;color:var(--muted);text-align:right">
          <th style="padding:.45rem .7rem;font-weight:700">العنوان</th><th style="padding:.45rem .7rem;font-weight:700">العميل</th>
          <th style="padding:.45rem .7rem;font-weight:700;text-align:left">القيمة</th>${tblStageRow.is_won ? '<th style="padding:.45rem .7rem;font-weight:700">المشروع الناتج</th>' : ''}<th style="padding:.45rem .7rem;font-weight:700;text-align:center">السنة</th>
          <th style="padding:.45rem .7rem;font-weight:700">السبب</th></tr></thead>
        <tbody>${listRows}</tbody></table></div>`
      : `<div class="empty-state">${icon('opportunity')}<div class="t">لا فرص في مرحلة «${esc(tblStageRow.name_ar)}» بعد</div>
        <div class="s">عندما تُحسم فرصة إلى هذه المرحلة ستظهر هنا بقيمتها وسببها.</div>
        <a class="btn" href="${backHref}">عودة إلى اللوحة</a></div>`}`)}`;
    return layout({
      user, active: 'opportunities', title: 'الفرص والمبيعات',
      subtitle: `مرحلة «${esc(tblStageRow.name_ar)}» · ${list.length} فرصة`, body,
      scripts: ['/static/pages/opps.js'],
    });
  }

  const byStage = {}; for (const s of stages) byStage[s.id] = [];
  for (const o of rows) (byStage[o.stage_id] ||= []).push(o);

  // ── بطاقة كانبان نحيفة (سطران): العنوان·العميل ثم القيمة·الاحتمال·العمر·المالك ──
  // حالة «متوقفة» = حدّ أيمن أحمر بدل شارة إضافية (اللون معنى لا زينة).
  const opCard = (o) => {
    const st = stById[o.stage_id] || {};
    const openRow = isOpen(o);
    const cl = clients[o.client_id]; const ow = users[o.owner_user_id];
    const hay = `${o.title_ar} ${cl || ''} ${ow || ''}`.toLowerCase();
    const dnd = canEdit ? 'draggable="true" ondragstart="Sanad.kStart(event)" ondragend="Sanad.kEnd(event)"' : '';
    const rot = openRow && o.rot;
    // الحدّ الجانبي للبطاقة = لون المرحلة (أو الأحمر إن كانت متوقفة) — أوضح إشارة لونية على مستوى البطاقة.
    const accent = rot ? 'var(--red)' : stageColor(st);
    const showMenu = openRow && canEdit; // زرّ الإجراءات «⋯»: فائزة/مفقودة/نقل قطاع — للمحرّرين فقط
    const menuBtn = showMenu
      ? `<button data-action="opp-menu" data-id="${o.id}" data-title="${esc(o.title_ar)}" data-sector="${o.sector_id || ''}" class="kmenu-btn" aria-label="إجراءات الفرصة" title="نقل الفرصة (فائزة · مفقودة · قطاع آخر)" style="position:absolute;top:.26rem;inset-inline-end:.3rem;width:20px;height:20px;border:none;background:transparent;color:var(--faint);cursor:pointer;border-radius:6px;font-size:16px;line-height:1;padding:0;display:inline-flex;align-items:center;justify-content:center;z-index:2">⋯</button>`
      : '';
    return `<div class="kcard" ${dnd} data-action="open-opp" data-id="${o.id}" data-sector="${o.sector_id || ''}" data-hay="${esc(hay).replace(/"/g, '')}" style="--_c:${accent};cursor:pointer;padding:.5rem .6rem;position:relative" role="link" tabindex="0" aria-label="فتح الفرصة ${esc(o.title_ar)}">
      ${menuBtn}
      <div style="${showMenu ? 'padding-inline-end:18px' : ''}">
        <div style="font-weight:700;font-size:12.5px;color:var(--ink2);line-height:1.4;word-break:break-word">${esc(o.title_ar)}</div>
        ${cl ? `<div style="font-size:10.5px;color:var(--muted);line-height:1.4;margin-top:.1rem;word-break:break-word">${esc(cl)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:.35rem;margin-top:.3rem;flex-wrap:wrap;font-size:11px;color:var(--muted);${ow ? 'padding-inline-end:20px' : ''}">
        <b class="tnum" style="font-size:12.5px;color:var(--ink2)">${sarShort(o.value_halalas)}</b>
        <span class="tnum">${pct(o.win_pct)}</span>
        ${openRow ? ageChip(o, true) : ''}
        ${openRow && o.no_next_action ? naChip(true) : ''}
      </div>
      ${st.is_won && projByOpp[o.id] ? `<div style="margin-top:.35rem;padding-top:.3rem;border-top:1px solid var(--line);font-size:10px;color:var(--muted);word-break:break-word">▸ المشروع: <a href="/app/project/${projByOpp[o.id].id}" style="color:var(--brand);font-weight:700">${esc(projByOpp[o.id].name_ar)}</a></div>` : ''}
      ${ow ? `<span class="kav" title="مالك الفرصة: ${esc(ow)}" style="width:17px;height:17px;font-size:8.5px;position:absolute;inset-inline-end:.45rem;bottom:.45rem">${esc((ow || '؟').trim().charAt(0))}</span>` : ''}
    </div>`;
  };

  // ── عمود كانبان موحّد لكل المراحل (مفتوحة ومحسومة على نفس البنية — إزالةً للتفاوت الذي رصده
  // المالك): رأس (نقطة اللون · الاسم · «؟» شرح · العدد · القيمة) ثم بطاقات. المحسومة تعرض مشروعها
  // الناتج على البطاقة نفسها، والسنة صارت تصفيةً علوية فلا أرقام سنوات مبعثرة داخل الأعمدة.
  const colEmpty = (s) => `<div class="empty-state" style="padding:.9rem .4rem;gap:.3rem">${icon('opportunity')}<div class="s">${s.is_won ? 'لا صفقات فائزة' : s.is_lost ? 'لا صفقات خاسرة' : 'لا فرص في هذه المرحلة'}${yearFilter === 'all' ? '' : ' لهذه السنة'}</div></div>`;
  const renderColumn = (s, items) => {
    const isDecided = !!(s.is_won || s.is_lost);
    const c = stageColor(s); // لون المرحلة: شريط علوي + رأس مُظلَّل + حدّ البطاقات الجانبي
    const drop = canEdit ? 'ondragover="Sanad.kOver(event)" ondragleave="Sanad.kLeave(event)" ondrop="Sanad.kDrop(event)"' : '';
    const colTotal = items.reduce((a, o) => a + (o.value_halalas || 0), 0);
    const colWeighted = Math.round(items.reduce((a, o) => a + weightedOf(o), 0));
    return `<div class="kcol" data-stage="${s.id}" ${drop} style="box-shadow:inset 0 3px 0 0 ${c}">
      <div class="kcol-head" style="background:${tint(c, '24')};border-radius:10px">
        <span class="kcol-dot" style="background:${c};width:10px;height:10px"></span>
        <span class="t" data-tip="${esc(stageTip(s))}" tabindex="0">${esc(s.name_ar)}</span>
        <button data-action="stage-info" data-stage="${s.id}" aria-label="شرح المرحلة" title="شرح المرحلة" style="width:16px;height:16px;border-radius:50%;border:1px solid var(--line);background:#fff;color:var(--muted);font-size:10px;font-weight:800;line-height:1;cursor:pointer;padding:0;flex:none;display:inline-flex;align-items:center;justify-content:center">؟</button>
        <span class="n" data-count>${items.length}</span>
        <span class="v tnum" data-total>${sarShort(colTotal)}</span></div>
      ${isDecided ? '' : `<div style="padding:0 .55rem .5rem;font-size:10.5px;color:var(--muted)">${G.weighted}: <span class="tnum" style="font-weight:800" data-weighted>${sarShort(colWeighted)}</span></div>`}
      <div class="kcol-body">${items.map(opCard).join('') || colEmpty(s)}</div>
    </div>`;
  };
  const columns = stages.map((s) => renderColumn(s, byStage[s.id] || [])).join('');

  // ── التصفية العلوية: القطاع + السنة (بدل حشر السنة داخل الأعمدة) — كل شريحة تحفظ الأخرى ──
  const navHref = ({ sector = sectorFilter, year = yearFilter } = {}) => {
    const p = new URLSearchParams();
    if (sector) p.set('sector', sector);
    if (year !== fiscalYear) p.set('year', year === 'all' ? 'all' : String(year));
    const q = p.toString();
    return '/app/opportunities' + (q ? '?' + q : '');
  };
  const sectorChips = `<div class="chips" style="margin-bottom:.55rem"><span class="lbl">${G.filter}</span>
    <a class="chip ${!sectorFilter ? 'on' : ''}" href="${navHref({ sector: '' })}">كل القطاعات</a>
    ${sectors.map((s) => `<a class="chip ${sectorFilter === s.id ? 'on' : ''}" href="${navHref({ sector: s.id })}"><span class="dot" style="background:var(--brand)"></span>${esc(s.name_ar)}</a>`).join('')}</div>`;
  const yearChips = `<div class="chips" style="margin-bottom:.6rem"><span class="lbl">السنة</span>
    <a class="chip ${yearFilter === 'all' ? 'on' : ''}" href="${navHref({ year: 'all' })}">${G.all}</a>
    ${years.map((y) => `<a class="chip ${yearFilter === y ? 'on' : ''}" href="${navHref({ year: y })}"><span class="tnum">${y}</span></a>`).join('')}</div>`;

  // ── شريط العروض المحفوظة: الكل + عروض المستخدم + حفظ العرض ──
  const viewQs = (pj) => {
    try { const o = JSON.parse(pj); return new URLSearchParams(o).toString(); }
    catch { return String(pj || ''); }
  };
  const viewChips = savedViews.map((v) => `<span class="chip" style="gap:.3rem;padding-inline-end:.4rem">
      <a href="/app/opportunities?${esc(viewQs(v.params_json))}" title="تطبيق هذا العرض">${v.is_default ? '★ ' : ''}${esc(v.name_ar)}</a>
      ${v.is_default ? '' : `<button data-action="view-default" data-id="${v.id}" title="تعيينه العرض الافتراضي" aria-label="تعيين ${esc(v.name_ar)} افتراضياً" style="border:none;background:none;cursor:pointer;color:var(--faint);font-size:12px;padding:0">☆</button>`}
      <button data-action="view-del" data-id="${v.id}" title="حذف هذا العرض" aria-label="حذف ${esc(v.name_ar)}" style="border:none;background:none;cursor:pointer;color:var(--faint);font-size:11px;padding:0">✕</button>
    </span>`).join('');
  const viewsBar = `<div class="chips" style="margin-bottom:.9rem"><span class="lbl">${G.savedViews}</span>
    <a class="chip ${!sectorFilter ? 'on' : ''}" href="/app/opportunities">${G.all}</a>
    ${viewChips}
    <button class="btn btn-sm" data-action="view-save">${icon('plus')} ${G.saveView}</button></div>`;

  // ── شريط التحليلات: 4 بطاقات قابلة للنقر تفتح تفصيلاً ──
  const tile = (key, label, value, sub, color) => `
    <div class="card cardclick" data-dd="${key}" role="button" tabindex="0" style="padding:.65rem .95rem;min-width:150px;flex:1">
      <div style="font-size:11px;color:var(--muted);font-weight:700;display:flex;align-items:center;gap:.3rem">${label}<span class="dd-hint" style="color:var(--faint)">⌄</span></div>
      <div class="tnum" style="font-size:1.3rem;font-weight:800;letter-spacing:-.02em;color:${color || 'var(--ink2)'}">${value}</div>
      <div style="font-size:10.5px;color:var(--faint)">${sub}</div></div>`;
  const strip = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${tile('raw', G.raw, fmtSar(total), countAr(open.length, { one: 'فرصة واحدة قيد المتابعة', two: 'فرصتان قيد المتابعة', few: 'فرص قيد المتابعة', many: 'فرصة قيد المتابعة' }))}
    ${tile('weighted', G.weighted, fmtSar(weighted), 'القيمة × احتمال الفوز', 'var(--brand2)')}
    ${tile('winrate', `نسبة الفوز · ${yearFilter === 'all' ? 'كل السنوات' : `<span class="tnum">${yearFilter}</span>`}`, winRate + '%', `${wonAll.length} ${G.won} · ${lostAll.length} ${G.lost}`, winRate >= 50 ? 'var(--green)' : '')}
    ${tile('stalled', 'فرص متوقفة', stalled.length, stalled.length ? 'تجاوزت مدة مرحلتها — تحتاج تحريكاً' : 'لا فرص متجاوزة لمدتها', stalled.length ? 'var(--amber)' : 'var(--green)')}
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
    ddWrap('winrate', 'نسبة الفوز', `${winRate}% من ${decided} فرصة محسومة`,
      ddRows([
        ...topN(wonAll, 15).map((o) => oppRowDD(o, `${pill(G.won, 'green')} <span class="tnum">${fmtSar(o.value_halalas)}</span>`)),
        ...topN(lostAll, 15).map((o) => oppRowDD(o, `${pill(G.lost, 'red')} <span class="tnum">${fmtSar(o.value_halalas)}</span>`)),
      ])),
    ddWrap('stalled', 'فرص متوقفة', STALLED_HINT,
      ddRows(stalled.slice().sort((a, b) => (b.stage_age_days || 0) - (a.stage_age_days || 0))
        .map((o) => oppRowDD(o, `${esc((stById[o.stage_id] || {}).name_ar || '')} · <span class="tnum">منذ ${dayWord(o.stage_age_days)}</span>`)))),
  ].join('');

  // نوافذ شرح المراحل المفتوحة (قوالب خاملة تُفتح من «؟»)
  const stageTpls = stages.map(stageInfoTpl).join('');

  // ── الجدول (تبديل العرض) ──
  // جدول تقريري كامل (كل الفرص، لا الفائزة/الخاسرة فقط) — كل عمود قابل للترتيب تصاعدياً/
  // تنازلياً (نقرة على الرأس، بنفس نمط جدول المشاريع تماماً — opps.js يطبّق sortBy()) كي يُبنى
  // منه تقرير: الأقدم/الأحدث إنشاءً، الأطول ركوداً في مرحلته (إشارة الخطر الملوّنة في الكانبان
  // نفسها)، آخر تحديث. data-v على كل خلية يضمن ترتيباً رقمياً/تاريخياً صحيحاً بصرف النظر عن
  // تنسيق العرض (فواصل الآلاف والعملة تكسر Number() الساذج).
  const oth = (label, title) => `<th data-sort role="button" tabindex="0" title="${title ? esc(title) : 'اضغط للترتيب'}" class="px-3 font-medium" style="cursor:pointer;white-space:nowrap">${label} <span style="color:var(--faint)">⇅</span></th>`;
  const dateCell = (iso) => iso ? `<span class="tnum" style="white-space:nowrap">${esc(String(iso).slice(0, 10))}</span>` : '<span style="color:var(--faint)">—</span>';
  const tableRows = rows.slice(0, 200).map((o) => {
    const st = stById[o.stage_id] || {};
    const openRow = isOpen(o);
    const age = o.stage_age_days;
    const updated = o.updated_at || o.created_at;
    return `<tr class="border-b border-line" data-action="open-opp" data-id="${o.id}" data-hay="${esc(`${o.title_ar} ${clients[o.client_id] || ''}`.toLowerCase()).replace(/"/g, '')}" data-sector="${o.sector_id || ''}" style="cursor:pointer">
      <td data-label="العنوان" class="py-2.5 px-3 text-[13px]">${esc(o.title_ar)}</td>
      <td data-label="العميل" class="px-3 text-[12px]" data-v="${esc(clients[o.client_id] || '')}">${esc(clients[o.client_id] || '—')}</td>
      <td data-label="${G.stage}" class="px-3" data-v="${st.sort_order ?? 0}">${pill(esc(st.name_ar || o.stage_id), 'blue')}</td>
      <td data-label="العمر في المرحلة" class="px-3 text-[12px]" data-v="${age ?? -1}">${openRow ? (ageChip(o) || '<span style="color:var(--faint)">—</span>') : '<span class="text-faint">—</span>'}</td>
      <td data-label="القيمة" class="px-3 text-[13px] tnum" data-v="${o.value_halalas || 0}">${fmtSar(o.value_halalas)}</td>
      <td data-label="${G.probability}" class="px-3 text-[12px] text-muted tnum" data-v="${o.win_pct || 0}">${pct(o.win_pct)}</td>
      <td data-label="تاريخ الإنشاء" class="px-3 text-[12px]" data-v="${esc(o.created_at || '')}">${dateCell(o.created_at)}</td>
      <td data-label="آخر تحديث" class="px-3 text-[12px]" data-v="${esc(updated || '')}">${dateCell(updated)}</td>
      <td data-label="${G.nextAction}" class="px-3 text-[11.5px] text-muted">${o.no_next_action ? (openRow ? naChip() : '—') : esc(o.next_action)}</td></tr>`;
  }).join('');

  const emptyAll = rows.length === 0;
  const boardArea = emptyAll
    ? `<div class="card"><div class="empty-state">${icon('opportunity')}
        <div class="t">لا توجد فرص ضمن نطاقك بعد</div>
        <div class="s">كل فرصة تحمل قيمة ومرحلة وخطوة تالية — أنشئ الأولى لتبدأ متابعة خط المبيعات.</div>
        ${canCreate ? `<button class="btn btn-primary" data-action="opp-add">${icon('plus')} فرصة جديدة</button>` : ''}</div></div>`
    : `<div id="opp-kanban" class="kanban" tabindex="0" role="region" aria-label="لوحة الفرص">${columns}</div>
      <div id="opp-table" class="card" style="display:none;overflow-x:auto">
        <table class="rtbl w-full" style="min-width:980px"><thead><tr class="text-[11px] text-muted text-right">
          ${oth('العنوان')}${oth('العميل')}${oth(G.stage)}${oth('العمر في المرحلة', 'اضغط للترتيب — الأخطر (الأطول ركوداً) أولاً')}
          ${oth('القيمة')}${oth(G.probability)}${oth('تاريخ الإنشاء')}${oth('آخر تحديث')}${oth(G.nextAction)}</tr></thead>
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
    ${yearChips}
    ${strip}
    <style>.kmenu-btn{opacity:.45;transition:opacity .15s,background .15s,color .15s}.kcard:hover .kmenu-btn,.kmenu-btn:focus-visible{opacity:1}.kmenu-btn:hover{background:#eef1f7;color:var(--ink2)}</style>
    ${boardArea}
    ${dds}
    ${stageTpls}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{
      stages:${JSON.stringify(stages.map((s) => ({ id: s.id, name_ar: s.name_ar, color: s.color }))).replace(/</g, '\\u003c')},
      sectors:${JSON.stringify(sectors.map((s) => ({ id: s.id, name_ar: s.name_ar }))).replace(/</g, '\\u003c')},
      moveSectors:${JSON.stringify(moveTargets.map((s) => ({ id: s.id, name_ar: s.name_ar }))).replace(/</g, '\\u003c')},
      wonStage:${JSON.stringify(wonStage ? wonStage.id : null)},
      lostStage:${JSON.stringify(lostStage ? lostStage.id : null)},
      canCreateOpp:${canCreate ? 'true' : 'false'},
      canEditOpp:${canEdit ? 'true' : 'false'},
      viewsPage:'opportunities'
    });</script>`;
  return layout({
    user, active: 'opportunities', title: 'الفرص والمبيعات',
    subtitle: `${yearFilter === 'all' ? 'كل السنوات' : `سنة ${yearFilter}`} · ${rows.length} فرصة · ${G.weighted} ${fmtSar(weighted)}`, body,
    scripts: ['/static/pages/opps.js'],
  });
}

// ── فرصي — مساحة عمل شخصية: طوابير مرتبة بالأولوية (متوقفة ← بلا خطوة ← على المسار) ──
export async function myOpportunitiesPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const scoped = await listOpportunities(user);
  const rows = scoped.filter((o) => o.owner_user_id === user.id);
  const stages = await all('SELECT id,name_ar,color,default_win_pct,sort_order,is_won,is_lost FROM stage ORDER BY sort_order');
  const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));
  // فريق الفرصة: عدّ الأعضاء باستعلام مجمّع واحد (نفس جدول العضويات الذي تعرضه صفحة الفرصة)
  const teamCounts = Object.fromEntries((await all(
    "SELECT group_id, COUNT(*) AS n FROM membership WHERE group_kind = 'opportunity' AND deleted_at IS NULL GROUP BY group_id"
  )).map((r) => [r.group_id, r.n]));

  const isOpen = (o) => { const s = stById[o.stage_id]; return s && !s.is_won && !s.is_lost; };
  const open = rows.filter(isOpen);
  const noAction = (o) => o.no_next_action || ['-', '—'].includes(String(o.next_action || '').trim());
  const stalled = open.filter((o) => o.rot);
  const onHold = open.filter((o) => !o.rot && o.stage_id === 'ON_HOLD');
  const noStep = open.filter((o) => !o.rot && o.stage_id !== 'ON_HOLD' && noAction(o));
  const onTrack = open.filter((o) => !o.rot && o.stage_id !== 'ON_HOLD' && !noAction(o));
  const naAll = open.filter((o) => o.no_next_action).length;
  const total = open.reduce((a, o) => a + (o.value_halalas || 0), 0);
  const weighted = Math.round(open.reduce((a, o) => a + weightedOf(o), 0));
  const hasTeams = open.some((o) => teamCounts[o.id]);

  const stagePill = (o) => {
    const st = stById[o.stage_id] || {};
    return `<span class="pill" style="background:${st.color || '#cbd5e1'}22;color:var(--ink2)"><span style="width:7px;height:7px;border-radius:50%;background:${st.color || '#cbd5e1'}"></span>${esc(st.name_ar || o.stage_id)}</span>`;
  };
  const headRow = `<thead><tr style="font-size:10.5px;color:var(--muted);text-align:right">
      <th style="padding:.45rem .7rem;font-weight:700">الفرصة</th>
      <th style="padding:.45rem .7rem;font-weight:700;text-align:center">${G.stage}</th>
      <th style="padding:.45rem .7rem;font-weight:700;text-align:center">العمر في المرحلة</th>
      ${hasTeams ? `<th style="padding:.45rem .7rem;font-weight:700;text-align:center">${G.oppTeam}</th>` : ''}
      <th style="padding:.45rem .7rem;font-weight:700">${G.nextAction}</th>
      <th style="padding:.45rem .7rem;font-weight:700;text-align:left">القيمة</th></tr></thead>`;

  const rowHtml = (o, accent) => {
    const rowEdit = can(user, 'update', 'opportunity', o);
    const team = teamCounts[o.id] || 0;
    const naCell = rowEdit
      ? `<span class="editable" data-action="na-edit" data-id="${o.id}" data-value="${esc(o.next_action || '')}" role="button" tabindex="0" title="انقر لتعديل الخطوة التالية" style="font-size:12px;${o.no_next_action ? 'color:var(--red);font-weight:700' : ''}">${o.no_next_action ? '● أضف الخطوة التالية' : esc(o.next_action)}</span>`
      : `<span style="font-size:12px;color:var(--muted)">${o.no_next_action ? G.noNextAction : esc(o.next_action)}</span>`;
    return `<tr style="border-bottom:1px solid var(--line)${accent ? ';background:' + accent : ''}">
      <td style="padding:.55rem .7rem;min-width:190px;max-width:320px">
        <a href="/app/opportunity/${o.id}" title="${esc(o.title_ar)}" style="display:block;font-size:12.5px;font-weight:700;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.title_ar)}</a>
        <div style="font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(clients[o.client_id] || 'بدون عميل')}</div></td>
      <td style="padding:.55rem .7rem;text-align:center;white-space:nowrap">${stagePill(o)}</td>
      <td style="padding:.55rem .7rem;text-align:center;white-space:nowrap">${ageChip(o) || '<span style="color:var(--faint)">—</span>'}</td>
      ${hasTeams ? `<td style="padding:.55rem .7rem;text-align:center">${team ? `<span class="pill tnum" style="background:#eef1f7;color:#475569" title="${team} في فريق الفرصة">${icon('team')} ${team}</span>` : '<span style="color:var(--faint)">—</span>'}</td>` : ''}
      <td style="padding:.55rem .7rem;min-width:170px">${naCell}</td>
      <td class="tnum" style="padding:.55rem .7rem;text-align:left;font-weight:800;font-size:12.5px;white-space:nowrap">${fmtSar(o.value_halalas)}
        <div style="font-weight:600;font-size:10px;color:var(--muted)">مرجّح ${fmtSar(Math.round(weightedOf(o)))}</div></td>
    </tr>`;
  };

  // قسم = بطاقة بعدّاد، لا يُعرض إلا حين يحوي صفوفاً
  const section = (iconName, tones, title, sub, trs) => trs.length ? card(`
    <div style="padding:.7rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.6rem">
      <span style="width:28px;height:28px;border-radius:9px;background:${tones.bg};color:${tones.fg};display:inline-flex;align-items:center;justify-content:center;flex:none">${icon(iconName)}</span>
      <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:13.5px">${title} <span class="tnum" style="color:${tones.fg}">${trs.length}</span></div>
        <div style="font-size:10.5px;color:var(--muted)">${sub}</div></div>
    </div>
    <div class="tblwrap"><table style="width:100%;border-collapse:collapse;min-width:${hasTeams ? 760 : 680}px">${headRow}<tbody>${trs.join('')}</tbody></table></div>`, '') + '<div style="height:.9rem"></div>' : '';

  const stalledRows = stalled.slice().sort((a, b) => (b.stage_age_days || 0) - (a.stage_age_days || 0)).map((o) => rowHtml(o, '#fffbeb'));
  const noStepRows = noStep.slice().sort((a, b) => (b.value_halalas || 0) - (a.value_halalas || 0)).map((o) => rowHtml(o, ''));
  const onTrackRows = onTrack.slice().sort((a, b) => (b.value_halalas || 0) - (a.value_halalas || 0)).map((o) => rowHtml(o, ''));
  const onHoldRows = onHold.slice().sort((a, b) => (b.value_halalas || 0) - (a.value_halalas || 0)).map((o) => rowHtml(o, ''));

  const empty = rows.length === 0;
  const body = empty
    ? `<div class="card"><div class="empty-state">${icon('flag')}
        <div class="t">لا فرص باسمك بعد</div>
        <div class="s">عندما تُسند إليك فرصة كمالك ستظهر هنا كقائمة عمل: المتوقف أولاً، ولكل فرصة خطوتها التالية.</div>
        <a class="btn" href="/app/opportunities">تصفّح كل الفرص</a></div></div>`
    : `
    <div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
      ${statMini('قيمتي المفتوحة', fmtSar(total), `${countAr(open.length, { one: 'فرصة واحدة', two: 'فرصتان', few: 'فرص', many: 'فرصة' })} · ${G.weighted} ${fmtSar(weighted)}`, 'brand')}
      ${statMini('متوقفة', stalled.length, stalled.length ? 'تجاوزت مدة مرحلتها — ابدأ بها' : 'لا شيء متوقف', stalled.length ? 'warn' : 'good')}
      ${statMini(G.noNextAction, naAll, naAll ? (naAll > noStepRows.length ? `منها ${naAll - noStepRows.length} ضمن المتوقفة — حدّد خطوة لكل فرصة` : 'حدّد خطوة مؤرّخة لكل فرصة') : 'لكل فرصة خطوة واضحة', naAll ? 'bad' : 'good')}
    </div>
    ${open.length === 0 ? `<div class="card"><div class="empty-state">${icon('check')}
        <div class="t">كل فرصك محسومة</div>
        <div class="s">لا فرص مفتوحة باسمك الآن — كل ما لديك إما ${G.won} أو ${G.lost}. اطلب فرصاً جديدة أو أنشئها من لوحة الفرص.</div>
        <a class="btn" href="/app/opportunities">لوحة الفرص</a></div></div>`
    : section('clock', { bg: '#fef3c7', fg: 'var(--amber)' }, 'متوقفة — حرّكها',
        'تجاوزت المدة المقبولة لمرحلتها. حرّك مرحلتها من صفحة الفرصة أو حدّث خطوتها التالية.', stalledRows)
      + section('flag', { bg: '#fee2e2', fg: 'var(--red)' }, G.noNextAction,
        'فرص تتحرك ضمن مدتها لكن دون خطوة قادمة — أضفها هنا مباشرة قبل أن تتوقف.', noStepRows)
      + section('check', { bg: '#dcfce7', fg: 'var(--green)' }, 'على المسار',
        'ضمن مدتها المقبولة وبخطوة تالية واضحة — تابعها في وقتها.', onTrackRows)
      + (onHoldRows.length ? section('clock', { bg: '#ede9fe', fg: 'var(--brand2)' }, 'معلّقة بقرار',
        'مؤجلة بقرار من العميل أو منا — ليست «على المسار» ولا متوقفة إهمالاً؛ تُراجع دورياً.', onHoldRows) : '')}`;
  return layout({
    user, active: 'my-opportunities', title: 'فرصي',
    subtitle: `قائمة عملي حسب الأولوية · ${esc(user.name_ar || user.username || '')} · ${year}`, body,
    scripts: ['/static/pages/opps.js'],
  });
}
