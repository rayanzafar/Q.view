// PMO pages: projects portfolio (comparison-first table + kanban toggle), my tasks, project detail.
import { layout, card, pill, tr, utilStrip } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all, get } from '../../core/db/index.js';
import { projectKpis } from '../../core/reports/metrics.js';
import { listProjects, nextMilestones, projectKind, projectRevenue } from '../../modules/pmo/projects.js';
import { projectGovernance, DELIVERABLE_MANUAL_STATUSES, DELIVERABLE_SYSTEM_STATUSES } from '../../modules/pmo/governance.js';
import { projectMoney } from '../../modules/finance/finance.js';
import { EXPENSE_STATUS_AR, OPEN_STATUSES, SETTLED_STATUSES } from '../../modules/finance/expenses.js';
import { myTasks, teamTasks } from '../../modules/pmo/tasks.js';
import { listViews } from '../../modules/views/views.js';
import { canSeeSensitive, redact, can, effectiveScope } from '../../core/rbac/index.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { G, projectKindLabel, projectKindTip } from '../i18n/glossary.js';
import { sarShort, esc, bar, statMini, noticeCard } from './_shared.js';
import { MONTHS_AR, MONTHS_EN3, currentMonthIndex, monthLabelDual } from '../../core/i18n/time.js';
import { countAr, dayWord } from '../../core/i18n/plural.js';
// ── مركز العمل اليومي (صفحة المهام) — الوارد الخاص بها وحدها، مفصولاً كي لا يختلط بوارد المحفظة ──
import { completionTrend, addDays, teamTasksAccess } from '../../modules/pmo/tasks.js';
import { listOpportunities } from '../../modules/crm/opportunities.js';
import { nowDot } from '../../core/i18n/time.js';
import { WEEKDAYS_AR, weekdayLabel, workKindLabel, deliverableStatusLabel, DELIVERABLE_NEXT } from '../i18n/glossary.js';

// لون لكل حالة (هوية EVC الهادئة: خط لوني رفيع + خلفية بتشبّع ~12٪). الحالة تُلوِّن أعمدة
// الكانبان وحدّ البطاقة الأيسر؛ الصحة (RAG) تبقى في الوسم وشريط الإنجاز. الملغى رماديّ
// مائل (لا أحمر) لأن اللون الأحمر يعني «تدخّل الآن» لا «مُغلق».
const PRJ_STATUS = [
  { id: 'NOT_STARTED', color: '#94a3b8', tint: '#eef2f7', ink: '#475569' },
  { id: 'IN_PROGRESS', color: '#244A99', tint: '#e9f0fb', ink: '#244A99' },
  { id: 'ON_HOLD', color: '#d97706', tint: '#fdf2e2', ink: '#b45309' },
  { id: 'COMPLETED', color: '#059669', tint: '#e6f6ef', ink: '#047857' },
  { id: 'CANCELLED', color: '#64748b', tint: '#e9edf2', ink: '#475569' },
];
const STATUS_UI = Object.fromEntries(PRJ_STATUS.map((s) => [s.id, s]));
const statusUi = (id) => STATUS_UI[id] || { id, color: '#64748b', tint: '#e9edf2', ink: '#475569' };
// ترتيب شرائح المرشّح كما يقرأها المالك: العمل الجاري أولاً ثم المعلّق فالمكتمل فما لم يبدأ فالملغى.
const STATUS_FILTER_ORDER = ['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'NOT_STARTED', 'CANCELLED'];
const ragHex = { GREEN: '#059669', AMBER: '#d97706', RED: '#dc2626' };
// حالة الصحة بمعناها لا باسم لونها التقني — «أحمر» جرجون؛ «حرج» قرار. مصدر واحد يُستخدم في
// الكانبان والجدول وصفحة التفاصيل معاً (كانت صفحة التفاصيل تعرض اسم اللون بدل المعنى).
const RAG_LABEL = { GREEN: 'على المسار', AMBER: 'في خطر', RED: 'حرج' };
// شارة الفرصة المصدر: أيقونة مصغّرة داخل الرابط (الأيقونة الافتراضية 18px أكبر من اللازم هنا).
const oppGlyph = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>';

// ── صحة المشروع (مشتقة للمقارنة، لا تُخزَّن): تُدخل الجدولَ الزمني في الحكم كي لا يقرأ
// المستخدم «على المسار» فوق مشروع متأخر — حرج: RAG أحمر أو الصرف يسبق الإنجاز بـ15+ نقطة
// أو تجاوز الانتهاء بأكثر من 30 يوماً؛ في خطر: RAG أصفر أو تباعد 10+ أو أي تجاوز للانتهاء
// أو متوقف مؤقتاً؛ وإلا على المسار.
const HEALTH = [
  { k: 'crit', label: G.hCritical, color: '#dc2626', rank: 0 },
  { k: 'risk', label: G.hAtRisk, color: '#d97706', rank: 1 },
  { k: 'ok', label: G.hOnTrack, color: '#059669', rank: 2 },
];
function healthOf(p, dev, lateDays) {
  if (p.rag === 'RED' || (dev != null && dev > 15) || (lateDays != null && lateDays > 30)) return HEALTH[0];
  if (p.rag === 'AMBER' || (dev != null && dev > 10) || lateDays != null || p.status === 'ON_HOLD') return HEALTH[1];
  return HEALTH[2];
}

// ── الشريط المزدوج (صرف٪ فوقه إنجاز٪) — مسار واحد ~110px: شبح الصرف بنفسجي شفاف تحت شريط
// الإنجاز الصلب (أخضر إن غطّى الإنجازُ الصرفَ، كهرماني إن سبقه الصرف). من لا يرى التكلفة
// يرى شريط الإنجاز وحده بلا شبح. الرقمان بجانبه «صرف٪·إنجاز٪».
function twinBar(spendPct, progPct, tip) {
  const p = Math.max(0, Math.min(100, Math.round(progPct || 0)));
  const track = (inner) => `<div style="position:relative;width:100px;height:9px;background:#eef1f7;border-radius:5px;overflow:hidden;flex:none">${inner}</div>`;
  const progSpan = (color) => `<span style="position:absolute;inset-inline-start:0;top:0;bottom:0;width:${p}%;background:${color};border-radius:5px"></span>`;
  if (spendPct == null) {
    return `<div style="display:flex;align-items:center;gap:.4rem" data-tip="${esc(tip || `${G.progressPct} فقط — التكلفة محجوبة عن دورك`)}">
      ${track(progSpan('var(--green)'))}
      <span class="tnum" style="font-size:11.5px;font-weight:700;color:var(--muted)">${p}%</span></div>`;
  }
  const s = Math.round(spendPct);
  const ahead = s > p; // الصرف يسبق الإنجاز
  return `<div style="display:flex;align-items:center;gap:.4rem" data-tip="${esc(tip || `${G.spendPct} مقابل ${G.progressPct}`)}">
    ${track(`<span style="position:absolute;inset-inline-start:0;top:0;bottom:0;width:${Math.max(0, Math.min(100, s))}%;background:rgba(131,71,152,.35)"></span>${progSpan(ahead ? '#d97706' : 'var(--green)')}`)}
    <span class="tnum" style="font-size:11px;font-weight:700;color:${ahead ? '#b45309' : 'var(--ink2)'}">${s}%·${p}%</span></div>`;
}

export async function projectsPage(user, opts = {}) {
  const nowY = new Date().getUTCFullYear();
  const yearsAvail = []; for (let y = 2024; y <= nowY + 1; y++) yearsAvail.push(y);
  const year = yearsAvail.includes(Number(opts.year)) ? Number(opts.year) : null;
  const view = opts.view === 'kanban' ? 'kanban' : 'table';
  let rows = await listProjects(user, year ? { year } : {});
  const canCost = canSeeSensitive(user, 'cost');
  const canEdit = can(user, 'update', 'project');
  const clients = Object.fromEntries((await all('SELECT id,name_ar FROM client')).map((c) => [c.id, c.name_ar]));
  // جدول أسماء لا قائمة اختيار: يُستعمل لتسمية قطاع المشروع حين لا عميل له. يشمل كل الوحدات
  // عمداً (حتى المحذوفة وغير النشطة، كما كان) — لأن مشروعاً مسجَّلاً على وحدة مساندة يبقى ظاهراً
  // في الجدول، وترشيح هذا الجدول لا يمنع ظهوره بل يمحو اسمه فقط فيقرأ المسؤول سطراً بلا نسبة.
  const sectors = Object.fromEntries((await all('SELECT id,name_ar FROM sector')).map((s) => [s.id, s.name_ar]));
  const ragTone = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
  // Owner lens: filter the board by sector (?sector=). Company-scope only; others already scoped.
  // شرائح القطاع = قطاعات التسليم وحدها (هي «محوّل قطاع» بكل معنى الكلمة).
  const allSec = await all(`SELECT id, name_ar, color FROM sector
     WHERE active = 1 AND deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL} ORDER BY sort_order`);
  const secFilter = user.scope === 'company' && opts.sector && allSec.some((s) => s.id === opts.sector) ? opts.sector : null;
  if (secFilter) rows = rows.filter((p) => p.sector_id === secFilter);
  // ── مرشّح الحالة (?status=): العدّ يُحسب قبل التصفية كي تُظهر كل شريحة عددَها ضمن نطاق
  // القطاع/السنة الحالي؛ المشروع بلا حالة يُعدّ «قيد التنفيذ» تماماً كما يُجمَّع في الكانبان. ──
  const normStatus = (p) => p.status || 'IN_PROGRESS';
  const statusCount = {}; for (const p of rows) statusCount[normStatus(p)] = (statusCount[normStatus(p)] || 0) + 1;
  const totalCount = rows.length;
  const statusFilter = STATUS_FILTER_ORDER.includes(opts.status) ? opts.status : null;
  if (statusFilter) rows = rows.filter((p) => normStatus(p) === statusFilter);
  const savedViews = await listViews(user, 'projects');
  const userName = Object.fromEntries((await all('SELECT id, name_ar, username FROM app_user')).map((u) => [u.id, u.name_ar || u.username]));
  // The legacy source has progress_pct=0 for 37/43 projects and no contract value for 20/43 —
  // present the truth USEFULLY: derive progress from deliverable states (amount-weighted) when the
  // stored figure is 0, and fall back through PO → budget → realized revenue for the money figure.
  const dlv = await all(`SELECT project_id, COUNT(*) n, COALESCE(SUM(amount_halalas),0) tot,
      SUM(CASE WHEN status IN ('DELIVERED','ACCEPTED','INVOICED','PAID') THEN 1 ELSE 0 END) dn,
      SUM(CASE WHEN status IN ('INVOICED','PAID') THEN 1 ELSE 0 END) inv,
      COALESCE(SUM(CASE WHEN status IN ('DELIVERED','ACCEPTED','INVOICED','PAID') THEN amount_halalas ELSE 0 END),0) done
      FROM deliverable WHERE deleted_at IS NULL GROUP BY project_id`);
  const dlvBy = Object.fromEntries(dlv.map((d) => [d.project_id, d]));
  const dprog = Object.fromEntries(dlv.map((d) => [d.project_id,
    d.tot > 0 ? Math.round((d.done / d.tot) * 100) : (d.n ? Math.round((d.dn / d.n) * 100) : null)]));
  const effProg = (p) => {
    const own = Number(p.progress_pct) || 0;
    if (own > 0) return { v: own, derived: false };
    const dv = p.status === 'COMPLETED' ? 100 : dprog[p.id];
    return dv != null ? { v: dv, derived: true } : { v: 0, derived: false };
  };
  // الإيراد المحقق لكل مشروع — من بنود الإيراد باستعلامين مجمّعين لا استعلام لكل صف: كل ما
  // سُجِّل للمشروع (عمود «الإيراد المحقق» وأساس القيمة الأخير)، وإيراد السنة المعروضة وحدها
  // (بطاقة الملخص). خانة الإيراد على صف المشروع لا يكتبها شيء في المنتج — رقم جامد من الترحيل
  // لا يتحرّك مهما سُجِّل إيراد جديد — فلا تُقرأ هنا بعد اليوم.
  const revYear = year || nowY;
  const prjIds = rows.map((p) => p.id);
  const revAllBy = Object.fromEntries((await projectRevenue(prjIds)).map((r) => [r.project_id, r.revenue_halalas]));
  const revYearBy = Object.fromEntries((await projectRevenue(prjIds, revYear)).map((r) => [r.project_id, r.revenue_halalas]));
  const bestVal = (p) =>
    p.contract_value_halalas ? { v: p.contract_value_halalas, l: 'عقد' } :
    p.po_value_halalas ? { v: p.po_value_halalas, l: 'أمر شراء' } :
    p.budget_halalas ? { v: p.budget_halalas, l: 'ميزانية' } :
    revAllBy[p.id] ? { v: revAllBy[p.id], l: 'إيراد محقق' } : { v: 0, l: null };
  // المفوتر لكل مشروع (استعلام مجمّع واحد) — أساس بديل لقياس الصرف عند غياب الميزانية،
  // بنفس سلّم صفحة تفاصيل المشروع: الصرف الفعلي من الميزانية ← المفوتر من قيمة العقد.
  const invBy = Object.fromEntries((await all(`SELECT project_id, COALESCE(SUM(amount_halalas),0) v FROM invoice
      WHERE project_id IS NOT NULL AND deleted_at IS NULL AND status NOT IN ('DRAFT','CANCELLED') GROUP BY project_id`))
    .map((r) => [r.project_id, r.v]));
  const burnOf = (p) => {
    const showCost = canCost && !p._redacted_actual_spend_halalas;
    if (showCost && p.budget_halalas > 0)
      return { v: Math.round((p.actual_spend_halalas || 0) / p.budget_halalas * 100), basis: 'الصرف الفعلي من الميزانية' };
    const headline = p.contract_value_halalas || p.po_value_halalas || p.budget_halalas || 0;
    if (headline > 0) return { v: Math.round((invBy[p.id] || 0) / headline * 100), basis: 'المفوتر من قيمة المشروع' };
    return null;
  };
  const nmBy = Object.fromEntries((await nextMilestones(rows.map((p) => p.id))).map((m) => [m.project_id, m]));
  // الفرصة المصدر: العمود project.source_opp_id مفتاح حقيقي في المخطط (يُملأ من الترحيل). استعلام
  // مجمّع واحد لعناوين الفرص التي انبثقت منها مشاريع هذا العرض — نُظهر الرابط فقط حين توجد الفرصة.
  const srcOppIds = [...new Set(rows.map((p) => p.source_opp_id).filter(Boolean))];
  const srcOppBy = srcOppIds.length
    ? Object.fromEntries((await all(`SELECT id, title_ar FROM opportunity WHERE id IN (${srcOppIds.map(() => '?').join(',')}) AND deleted_at IS NULL`, srcOppIds)).map((o) => [o.id, o.title_ar]))
    : {};

  // ── الاشتقاقات لكل صف: إنجاز، صرف، تباعد، صحة، تأخر ──
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const derived = {};
  for (const p of rows) {
    const prog = effProg(p);
    const burn = burnOf(p);
    const dev = burn ? burn.v - prog.v : null;
    const lateDays = p.end_date && p.end_date < todayStr && prog.v < 100 && !['COMPLETED', 'CANCELLED'].includes(p.status)
      ? Math.max(1, Math.round((today - new Date(p.end_date)) / 86400000)) : null;
    derived[p.id] = { prog, burn, dev, lateDays, health: healthOf(p, dev, lateDays) };
  }

  // روابط تحافظ على بقية المرشحات (قطاع/سنة/حالة/عرض) عند تبديل أي منها
  const qs = (over = {}) => {
    const cur = { sector: secFilter, year, status: statusFilter, view: view === 'kanban' ? 'kanban' : null, ...over };
    const sp = new URLSearchParams();
    if (cur.sector) sp.set('sector', cur.sector);
    if (cur.year) sp.set('year', String(cur.year));
    if (cur.status) sp.set('status', cur.status);
    if (cur.view) sp.set('view', cur.view);
    const s = sp.toString();
    return '/app/projects' + (s ? '?' + s : '');
  };

  // ── (1) شرائح القطاع + شرائح السنوات + البحث ──
  const secChips = user.scope === 'company' ? `<div class="chips" style="margin-bottom:.5rem"><span class="lbl">القطاع:</span>
    <a href="${qs({ sector: null })}" class="chip ${secFilter ? '' : 'on'}">الكل</a>
    ${allSec.map((s) => `<a href="${qs({ sector: s.id })}" class="chip ${secFilter === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || 'var(--brand)'}"></span>${esc(s.name_ar)}</a>`).join('')}
  </div>` : '';
  const yearPills = `<div class="chips" style="margin-bottom:.6rem"><span class="lbl">السنة:</span>
    <a href="${qs({ year: null })}" class="chip ${year ? '' : 'on'}">كل السنوات</a>
    ${yearsAvail.map((y) => `<a href="${qs({ year: y })}" class="chip ${year === y ? 'on' : ''}"><span class="tnum">${y}</span></a>`).join('')}
  </div>`;
  // ── شرائح مرشّح الحالة (?status=) — كل شريحة تحمل عددها؛ تُركّب مع القطاع والسنة والبحث ──
  const statusChipN = (on, n) => `<span class="tnum" style="font-weight:800;color:${on ? 'rgba(255,255,255,.85)' : 'var(--faint)'}">${n}</span>`;
  const statusChips = `<div class="chips" style="margin-bottom:.6rem"><span class="lbl">الحالة:</span>
    <a href="${qs({ status: null })}" class="chip ${statusFilter ? '' : 'on'}">الكل ${statusChipN(!statusFilter, totalCount)}</a>
    ${STATUS_FILTER_ORDER.map((s) => { const on = statusFilter === s; return `<a href="${qs({ status: s })}" class="chip ${on ? 'on' : ''}"><span class="dot" style="background:${statusUi(s).color}"></span>${tr(s)} ${statusChipN(on, statusCount[s] || 0)}</a>`; }).join('')}
  </div>`;

  // ── (2) «يحتاج انتباهك الآن» — فقط: أحمر / صرف يسبق الإنجاز بـ10+ نقاط / تجاوز الانتهاء ──
  const attnItems = [];
  for (const p of rows) {
    const d = derived[p.id];
    const parts = [];
    if (p.rag === 'RED') parts.push(`حالتها ${RAG_LABEL.RED} — تحتاج قراراً`);
    if (d.lateDays != null) parts.push(`تجاوزت تاريخ الانتهاء بـ${dayWord(d.lateDays)} والإنجاز <span class="tnum">${d.prog.v}%</span>`);
    if (d.dev != null && d.dev > 10) parts.push(`الصرف يسبق الإنجاز بـ<span class="tnum">${d.dev}</span> ${d.dev >= 3 && d.dev <= 10 ? 'نقاط' : 'نقطة'}`);
    if (parts.length) attnItems.push({ p, d, reason: parts.slice(0, 2).join(' · '), rank: p.rag === 'RED' ? 0 : d.lateDays != null ? 1 : 2 });
  }
  attnItems.sort((a, b) => a.rank - b.rank || (Math.abs(b.d.dev ?? 0) - Math.abs(a.d.dev ?? 0)));
  const attnStrip = `<div style="margin-bottom:1rem">
    <div style="font-weight:800;font-size:13px;margin-bottom:.45rem;display:flex;align-items:center;gap:.4rem">${G.attention}
      ${attnItems.length ? `<span class="tnum" style="color:var(--red);font-size:12px">${attnItems.length}</span>` : ''}</div>
    ${attnItems.length ? `<div style="display:flex;gap:.6rem;flex-wrap:wrap">${attnItems.map(({ p, reason }) => `
      <a class="card card-h" href="/app/project/${p.id}" style="flex:0 1 auto;min-width:200px;max-width:280px;padding:.55rem .75rem;border-inline-start:3px solid ${p.rag === 'RED' ? '#dc2626' : '#d97706'};display:block">
        <div style="font-weight:700;font-size:12.5px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name_ar)}</div>
        <div style="font-size:11px;color:${p.rag === 'RED' ? 'var(--red)' : '#b45309'};font-weight:700;margin-top:.15rem;line-height:1.7">${reason}</div>
        <div style="font-size:10.5px;color:var(--faint);margin-top:.1rem">${esc(clients[p.client_id] || sectors[p.sector_id] || '')}</div>
      </a>`).join('')}</div>`
    : `<div style="display:flex;align-items:center;gap:.45rem;font-size:12.5px;color:var(--muted);border:1px solid var(--line);border-radius:12px;background:#fff;padding:.55rem .8rem"><span style="width:8px;height:8px;border-radius:50%;background:var(--green);flex:none"></span>لا مشاريع تحتاج تدخلاً الآن</div>`}
  </div>`;

  // ── (3) بطاقات الملخص التنفيذي ──
  const isActive = (p) => !['COMPLETED', 'CANCELLED'].includes(p.status);
  const activeN = rows.filter(isActive).length;
  const totalVal = rows.reduce((a, p) => a + bestVal(p).v, 0);
  const revSum = rows.reduce((a, p) => a + (revYearBy[p.id] || 0), 0);
  const critN = rows.filter((p) => derived[p.id].health.rank === 0).length;
  const summary = `<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${statMini('نشطة', `<span class="tnum">${activeN}</span>`, `من أصل ${rows.length} في هذا العرض`)}
    ${statMini('قيمة المحفظة', fmtSar(totalVal), 'بأفضل أساس مسجّل لكل مشروع', 'brand')}
    ${statMini(`الإيراد المحقق <span class="tnum">${revYear}</span>`, fmtSar(revSum), 'من بنود الإيراد المسجّلة', revSum ? 'good' : '')}
    ${statMini(G.hCritical, `<span class="tnum">${critN}</span>`, critN ? 'تتصدر الجدول أدناه' : 'لا مشاريع حرجة', critN ? 'bad' : 'good')}
  </div>`;

  // ── (4) تبديل العرض + العروض المحفوظة ──
  const seg = `<div class="seg">
    <button ${view === 'table' ? 'class="on"' : ''} data-action="go" data-href="${qs({ view: null })}">${icon('list')} جدول المحفظة</button>
    <button ${view === 'kanban' ? 'class="on"' : ''} data-action="go" data-href="${qs({ view: 'kanban' })}">${icon('kanban')} كانبان</button>
  </div>`;
  const viewQs = (pj) => { try { return new URLSearchParams(JSON.parse(pj)).toString(); } catch { return String(pj || ''); } };
  const viewsBar = `<div class="chips" style="margin-bottom:.6rem"><span class="lbl">${G.savedViews}</span>
    <a class="chip ${!secFilter && !year && !statusFilter && view === 'table' ? 'on' : ''}" href="/app/projects">${G.all}</a>
    ${savedViews.map((v) => `<span class="chip" style="gap:.3rem;padding-inline-end:.4rem">
      <a href="/app/projects?${esc(viewQs(v.params_json))}" title="تطبيق هذا العرض">${v.is_default ? '★ ' : ''}${esc(v.name_ar)}</a>
      ${v.is_default ? '' : `<button data-action="view-default" data-id="${v.id}" title="تعيينه العرض الافتراضي" aria-label="تعيين ${esc(v.name_ar)} افتراضياً" style="border:none;background:none;cursor:pointer;color:var(--faint);font-size:12px;padding:0">☆</button>`}
      <button data-action="view-del" data-id="${v.id}" title="حذف هذا العرض" aria-label="حذف ${esc(v.name_ar)}" style="border:none;background:none;cursor:pointer;color:var(--faint);font-size:11px;padding:0">✕</button>
    </span>`).join('')}
    <button class="btn btn-sm" data-action="view-save">${icon('plus')} ${G.saveView}</button></div>`;

  // ── (5) جدول المحفظة — المقارنة أولاً، الأسوأ أولاً ──
  const sorted = rows.slice().sort((a, b) => {
    const da = derived[a.id], db = derived[b.id];
    return da.health.rank - db.health.rank || (Math.abs(db.dev ?? -1) - Math.abs(da.dev ?? -1));
  });
  const th = (label, sortable, extra = '') => `<th ${sortable ? 'data-sort role="button" tabindex="0" title="اضغط للترتيب"' : ''} style="padding:.5rem .55rem;font-size:10.5px;color:var(--muted);font-weight:700;text-align:right;white-space:nowrap;${sortable ? 'cursor:pointer;' : ''}${extra}">${label}${sortable ? ' <span style="color:var(--faint)">⇅</span>' : ''}</th>`;
  const rowOf = (p) => {
    const { prog, burn, dev, lateDays, health } = derived[p.id];
    const bv = bestVal(p);
    const rev = revAllBy[p.id] || 0;
    const d = dlvBy[p.id];
    const nm = nmBy[p.id];
    const pmName = p.pm_name || userName[p.owner_user_id] || '';
    const cl = clients[p.client_id] || sectors[p.sector_id] || '';
    const srcOppTitle = p.source_opp_id ? srcOppBy[p.source_opp_id] : null;
    const hay = esc(`${p.name_ar} ${cl} ${pmName} ${health.label}${srcOppTitle ? ' من فرصة' : ''}`.toLowerCase().replace(/"/g, ''));
    const startY = p.start_date ? p.start_date.slice(0, 4) : null;
    // عمر المشروع بالأشهر: من البداية حتى اليوم — والمكتمل/الملغى يتوقف عمره عند تاريخ انتهائه
    const ageEnd = ['COMPLETED', 'CANCELLED'].includes(p.status) && p.end_date ? new Date(p.end_date) : today;
    const ageMonths = p.start_date ? Math.max(0, Math.round((ageEnd - new Date(p.start_date)) / (30.44 * 86400000))) : null;
    const notYet = p.start_date && p.start_date > todayStr;
    const durHtml = lateDays != null
      ? `${startY ? `<div class="tnum" style="color:var(--faint);font-size:10.5px">${startY}</div>` : ''}<div style="color:var(--red);font-weight:700;white-space:nowrap">متأخر <span class="tnum">${lateDays}</span> ${lateDays >= 3 && lateDays <= 10 ? 'أيام' : 'يوماً'}</div>`
      : notYet ? `يبدأ <span class="tnum">${startY}</span>`
      : startY ? `<div class="tnum" style="color:var(--faint);font-size:10.5px">${startY}</div><div style="white-space:nowrap">العمر <span class="tnum">${ageMonths}</span> ${ageMonths >= 3 && ageMonths <= 10 ? 'أشهر' : ageMonths === 2 ? 'شهرين' : ageMonths === 1 ? 'شهر' : 'شهراً'}</div>` : '—';
    const twinTip = burn
      ? `${G.spendPct} مقابل ${G.progressPct} — ${burn.basis}${dev != null && dev > 10 ? ` · الصرف يسبق الإنجاز بـ${dev} ${dev >= 3 && dev <= 10 ? 'نقاط' : 'نقطة'}` : ''}`
      : canCost ? `${G.progressPct} فقط — لا أساس مالي مسجّل لقياس الصرف` : null;
    const nmOverdue = nm && nm.due_date && nm.due_date < todayStr;
    return `<tr data-action="open-prj" data-id="${p.id}" data-hay="${hay}" style="border-bottom:1px solid var(--line);cursor:pointer">
      <td style="padding:.5rem .55rem"><div style="width:168px">
        <a href="/app/project/${p.id}" title="${esc(p.name_ar)}" style="font-size:12.5px;font-weight:700;color:var(--ink2);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name_ar)}</a>
        <div style="font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cl) || '—'}</div>
        ${srcOppTitle ? `<a href="/app/opportunity/${esc(p.source_opp_id)}" title="نشأ من الفرصة: ${esc(srcOppTitle)}" style="display:inline-flex;align-items:center;gap:.22rem;margin-top:.2rem;font-size:9.5px;font-weight:800;color:var(--brand2);background:#f3eef7;border-radius:6px;padding:.08rem .34rem;line-height:1.5;white-space:nowrap">${oppGlyph}<span>من فرصة</span></a>` : ''}</div></td>
      <td data-label="الحالة" style="padding:.5rem .55rem;text-align:center">${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : p.status === 'ON_HOLD' ? 'amber' : p.status === 'CANCELLED' ? 'slate' : 'blue')}</td>
      <td data-label="الصحة" style="padding:.5rem .55rem;white-space:nowrap" data-v="${health.rank}"><span style="display:inline-flex;align-items:center;gap:.35rem;font-size:12px;font-weight:700;color:${health.color}"><span style="width:9px;height:9px;border-radius:50%;background:${health.color};flex:none"></span>${health.label}</span></td>
      <td data-label="${G.spendPct}·${G.progressPct}" class="rtbl-hm" style="padding:.5rem .55rem" data-v="${prog.v}"><div style="display:flex;align-items:center;gap:.2rem">${twinBar(canCost ? (burn ? burn.v : null) : null, prog.v, twinTip)}${prog.derived ? '<span style="color:var(--faint);font-size:9.5px">⁎</span>' : ''}</div></td>
      <td data-label="المدة" class="rtbl-hm" style="padding:.5rem .55rem;font-size:11.5px;color:var(--muted)" data-v="${lateDays != null ? 100000 + lateDays : (ageMonths ?? -1)}">${durHtml}</td>
      <td data-label="القيمة" style="padding:.5rem .55rem" data-v="${bv.v}">${bv.l
        ? `<div class="tnum" style="font-size:12px;font-weight:800;white-space:nowrap">${fmtSar(bv.v)}</div><span style="font-size:9.5px;font-weight:700;color:var(--faint);background:#eef1f7;border-radius:6px;padding:.1rem .35rem;white-space:nowrap">${bv.l}</span>`
        : '<span style="color:var(--faint);font-size:11px;white-space:nowrap">بلا قيمة مسجلة</span>'}</td>
      <td data-label="الإيراد" style="padding:.5rem .55rem" data-v="${rev}"><div class="tnum" style="font-size:12px;font-weight:700;white-space:nowrap;color:${rev ? 'var(--green)' : 'var(--faint)'}">${rev ? fmtSar(rev) : '—'}</div>${rev && bv.v ? `<div class="tnum" style="font-size:10px;color:var(--muted);white-space:nowrap" ${rev > bv.v ? 'data-tip="الإيراد المُثبت يتجاوز قيمة المشروع المسجلة — راجع القيمة أو بنود الإيراد"' : ''}>${Math.min(999, Math.round(rev / bv.v * 100))}% من القيمة${rev > bv.v ? ' ⚠' : ''}</div>` : ''}</td>
      <td data-label="${G.deliverables}" class="rtbl-hm" style="padding:.5rem .55rem;font-size:11.5px;color:var(--muted)">${d && d.n
        ? `<div style="white-space:nowrap"><span class="tnum" style="font-weight:700;color:var(--ink2)">${d.dn}</span> ${G.delivered}</div><div style="white-space:nowrap"><span class="tnum" style="font-weight:700;color:var(--ink2)">${d.inv}</span> ${G.invoicedShort}</div>`
        : '—'}</td>
      <td data-label="م. المشروع" style="padding:.5rem .55rem;font-size:11.5px;color:var(--muted)"><div title="${esc(pmName)}" style="width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pmName) || '—'}</div></td>
      <td data-label="المعلم القادم" style="padding:.5rem .55rem;font-size:11.5px" data-v="${nm && nm.due_date ? esc(nm.due_date) : '9999-12-31'}">${nm
        ? `<div style="width:140px"><div title="${esc(nm.title)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink2)">${esc(nm.title)}</div><div class="tnum" style="font-size:10.5px;color:${nmOverdue ? 'var(--red)' : 'var(--faint)'}">${nm.due_date || 'بلا تاريخ'}${nmOverdue ? ' · متأخر' : ''}</div></div>`
        : '<span style="color:var(--faint)">—</span>'}</td>
    </tr>`;
  };
  // فصل الضوضاء: مشروع بلا قيمة ولا إنجاز ولا إيراد ولا صرف = سجل ناقص البيانات، لا يزاحم
  // المقارنة الفعلية — يُطوى في قسم خاص كي يبقى الجدول الرئيسي كله إشارة
  const isQuiet = (p) => { const d = derived[p.id]; return !bestVal(p).v && d.prog.v === 0 && !(revYearBy[p.id] || 0) && (!d.burn || d.burn.v === 0) && d.health.rank === 2; };
  const mainRows = sorted.filter((p) => !isQuiet(p));
  const quietRows = sorted.filter(isQuiet);
  const tbl = (rws, id) => `<div class="tblwrap"><table class="rtbl" ${id ? `id="${id}"` : ''} style="width:100%;border-collapse:collapse;min-width:1040px">
    <thead><tr>
      ${th('المشروع')}${th('الحالة')}${th('الصحة', true)}${th(`${G.spendPct}·${G.progressPct}`, true)}${th('المدة', true)}
      ${th('قيمة المشروع', true)}${th('الإيراد المحقق', true)}${th(G.deliverables)}${th('مدير المشروع')}${th('المعلم القادم', true)}
    </tr></thead>
    <tbody ${id ? 'id="prj-rows"' : ''}>${rws.map(rowOf).join('')}</tbody></table></div>`;
  const tableView = `<div class="card">${tbl(mainRows.length ? mainRows : sorted, 'prj-table')}</div>
    ${mainRows.length && quietRows.length ? `<details class="card" style="margin-top:.7rem"><summary style="padding:.6rem 1rem;cursor:pointer;font-size:var(--fs-body);font-weight:700;color:var(--muted)">مشاريع ناقصة البيانات (${quietRows.length}) — بلا قيمة أو إنجاز أو إيراد مسجّل<span style="font-weight:400;color:var(--faint)"> · أكمل بياناتها من صفحة كل مشروع لتدخل المقارنة</span></summary>${tbl(quietRows)}</details>` : ''}`;

  // ── كانبان (تبديل ثانوي — كما كان تماماً) ──
  const present = [...new Set(rows.map((p) => p.status || 'IN_PROGRESS'))];
  const cols = [...PRJ_STATUS.filter((c) => present.includes(c.id)),
    ...present.filter((s) => !PRJ_STATUS.some((c) => c.id === s)).map((s) => ({ id: s, color: '#64748b' }))];
  if (!cols.length) cols.push({ id: 'IN_PROGRESS', color: 'var(--brand)' });
  const byStatus = {}; for (const c of cols) byStatus[c.id] = [];
  for (const p of rows) (byStatus[p.status || 'IN_PROGRESS'] ||= []).push(p);

  const prjCard = (p) => {
    const cl = clients[p.client_id] || sectors[p.sector_id] || '';
    const dnd = canEdit ? 'draggable="true" ondragstart="Sanad.kStart(event)" ondragend="Sanad.kEnd(event)"' : '';
    const hay = `${p.name_ar} ${cl}`.toLowerCase().replace(/"/g, '');
    // حدّ البطاقة الأيسر بلون الحالة (يعزّز لون العمود عند التمرير)؛ الصحة تبقى في الوسم وشريط الإنجاز.
    const ui = statusUi(p.status || 'IN_PROGRESS');
    return `<div class="kcard" ${dnd} data-id="${p.id}" data-sector="${p.sector_id || ''}" data-hay="${esc(hay)}" style="--_c:${ui.color};cursor:pointer" onclick="Sanad.projOpen('${p.id}')">
      <div class="kt">${esc(p.name_ar)}</div>
      <div class="km">${cl ? `<span style="display:inline-flex;align-items:center;gap:.25rem">${icon('building')}${esc(cl)}</span>` : ''}
        ${p.rag ? pill(RAG_LABEL[p.rag] || RAG_LABEL.GREEN, ragTone[p.rag] || 'slate') : ''}</div>
      <div class="km">${(() => { const bv = bestVal(p); const e = effProg(p); return `
        ${bv.l ? `<span class="kv tnum">${fmtSar(bv.v)}</span><span style="font-size:9.5px;font-weight:700;color:var(--faint);background:#eef1f7;border-radius:6px;padding:.1rem .35rem">${bv.l}</span>`
               : '<span style="color:var(--faint);font-size:11px">بلا قيمة مسجلة</span>'}
        <span class="tnum" style="margin-inline-start:auto" ${e.derived ? 'title="محسوبة من حالة المخرجات (المصدر بلا نسبة إنجاز)"' : ''}>${e.v}%${e.derived ? '<span style="color:var(--faint);font-size:9.5px"> ⁎</span>' : ''}</span>`; })()}</div>
      <div class="bar" style="margin-top:.5rem"><span style="width:${Math.min(100, effProg(p).v)}%;background:${ragHex[p.rag] || 'var(--brand)'}"></span></div>
    </div>`;
  };
  const columns = cols.map((c) => {
    const items = byStatus[c.id] || [];
    const val = items.reduce((a, p) => a + bestVal(p).v, 0);
    const drop = canEdit ? 'ondragover="Sanad.kOver(event)" ondragleave="Sanad.kLeave(event)" ondrop="Sanad.kDrop(event)"' : '';
    // شريط رأس ملوّن بالحالة: خلفية بتشبّع خفيف + خط علوي صلب + عنوان بلون الحالة = تمييز فوري.
    const ui = statusUi(c.id);
    return `<div class="kcol" data-stage="${c.id}" ${drop}>
      <div class="kcol-head" style="background:${ui.tint};border-top:3px solid ${ui.color};border-radius:10px;padding:.5rem .55rem;margin-bottom:.55rem">
        <span class="kcol-dot" style="background:${ui.color}"></span>
        <span class="t" style="color:${ui.ink}">${tr(c.id)}</span><span class="n" data-count>${items.length}</span>
        <span class="v tnum" data-total style="color:${ui.ink};margin-inline-start:auto">${sarShort(val)}</span></div>
      <div class="kcol-body">${items.map(prjCard).join('') || '<div style="text-align:center;color:var(--faint);font-size:11px;padding:1rem 0">—</div>'}</div>
    </div>`;
  }).join('');
  const kanbanView = `<div id="prj-kanban" class="kanban" data-kind="prj" tabindex="0" role="region" aria-label="لوحة المشاريع">${columns}</div>`;

  // ── (6) حالات فارغة مصممة ──
  const emptyView = `<div class="card"><div class="empty-state">${icon('projects')}
    <div class="t">${statusFilter ? `لا مشاريع بحالة «${tr(statusFilter)}» في هذا العرض`
      : year ? `لا مشاريع في سنة <span class="tnum">${year}</span> ضمن نطاقك` : 'لا مشاريع ضمن نطاقك بعد'}</div>
    <div class="s">${statusFilter ? 'اختر حالة أخرى من الأعلى أو اعرض كل الحالات لرؤية المحفظة كاملة.'
      : year ? 'قد تكون مشاريعك في سنوات أخرى — بدّل السنة من الأعلى أو اعرض كل السنوات.'
      : (canEdit ? 'أنشئ أول مشروع لتبدأ متابعة المحفظة ومقارنة مشاريعها.' : 'عندما يُسند إليك مشروع سيظهر هنا للمقارنة والمتابعة.')}</div>
    ${statusFilter ? `<a class="btn" href="${qs({ status: null })}">عرض كل الحالات</a>`
      : year ? `<a class="btn" href="${qs({ year: null })}">عرض كل السنوات</a>`
      : (canEdit ? `<button class="btn btn-primary" data-action="prj-add">${icon('plus')} مشروع جديد</button>` : '')}
  </div></div>`;

  const content = !rows.length ? emptyView : (view === 'kanban' ? kanbanView : tableView);
  // قائمة القطاعات المُسلَّمة للمتصفّح تملأ خانة «القطاع» في نافذة «مشروع جديد» — قطاعات تسليم
  // وحدها: المشروع عمل يُنسب إلى قطاع له هدف وإيراد، لا إلى وحدة مساندة تُعير أشخاصها للمشاريع.
  const body = `
    ${secChips}
    ${yearPills}
    ${statusChips}
    <div class="toolbar" style="margin-bottom:.8rem">
      <div class="search">${icon('search')}<input class="input" id="prj-q" aria-label="بحث في المشاريع" placeholder="ابحث في المشاريع…"></div>
      <div class="spacer"></div>
      ${canCost ? pill('ترى التكلفة الفعلية', 'green') : pill('التكلفة محجوبة عنك', 'slate')}
      ${canEdit ? `<button class="btn btn-primary" data-action="prj-add">${icon('plus')} مشروع جديد</button>` : ''}
    </div>
    ${rows.length ? attnStrip : ''}
    ${rows.length ? summary : ''}
    <div class="toolbar" style="margin-bottom:.5rem">${seg}</div>
    ${viewsBar}
    ${rows.length ? `<div style="font-size:10.5px;color:var(--faint);margin:0 0 .6rem">⁎ نسبة إنجاز محسوبة من حالة المخرجات — المنصة السابقة بلا نسبة مسجلة · شارة القيمة توضح أساسها (عقد / أمر شراء / ميزانية / إيراد محقق)</div>` : ''}
    ${content}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{sectors:${JSON.stringify(await all(`SELECT id,name_ar FROM sector WHERE active=1 AND ${DELIVERY_SECTOR_SQL} ORDER BY name_ar`)).replace(/</g, '\\u003c')},canEditPrj:${canEdit},viewsPage:'projects',prjSectorLocked:${JSON.stringify(user.scope === 'company' ? null : user.sector_id)}});</script>`;
  return layout({ user, active: 'projects', title: 'المشاريع', subtitle: `المحفظة · ${rows.length} مشروع${statusFilter ? ` · ${tr(statusFilter)}` : ''}${year ? ` · سنة ${year}` : ''}`,
    body, year: year || undefined, scripts: ['/static/pages/projects.js'] });
}

// ── مركز العمل اليومي («مهامي») ───────────────────────────────────────────────
// أُعيد بناء الشاشة كاملة بعد حكم المالك على سابقتها: قائمة مسطّحة بلا مرشّح واحد، ولا لوح،
// ولا تقويم، و«مهام فريقي» مطويّة في أسفل الصفحة. المرجع الكامل لما بُني ولماذا في
// docs/benchmarks.md (جولة 2026-07-27) — وهذه خلاصته التنفيذية:
//   • **اليوم منتهٍ**: العرض الافتراضي نافذة اليوم (متأخر + مستحق اليوم + ما بدأتَه أو تعطّل)،
//     وما بعدها عدّادات مضغوطة قابلة للنقر لا قائمة لا نهائية تُلقى على العين (تدرّج الهدف).
//   • **التقدّم مرئي بأرقام حقيقية**: «أنجزت N من M اليوم» من `completed_at` المسجَّل، وأثر
//     سبعة أيام من العدّ الفعلي. لا نقاط ولا سلاسل ولا أوسمة — قرار صريح مُوثَّق.
//   • **العائق كيان أول**: يُكتب ويُوجَّه ويُعدّ، لا صف أحمر يُتجاوز بالتمرير (مبدأ التقدّم:
//     رفعُ العوائق يسبق كل مكافأة).
//   • **ثلاث عدسات على بيانات واحدة**: قائمة · لوح · تقويم — حالة العرض في الرابط، والمرشّح
//     نفسه يعمل في العدسات الثلاث.
//   • **«مهام فريقي» عدسة أولى** بسؤال «من يحتاج مساعدة» لا «من الأفضل»، ونطاقها يُشتقّ من
//     `effectiveScope(user,'update','task')` بلا توسعة حرف واحد.
const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'];
const TASK_STATUS_COLOR = { TODO: '#64748b', IN_PROGRESS: '#244A99', BLOCKED: '#dc2626', IN_REVIEW: '#834798', DONE: '#047857' };
// الأولوية إشارة صغيرة لا لافتة: اللون يرافقه دائماً اسمها (قاعدة «ليس لوناً فقط»).
const TASK_PRIORITY = { P0: { ar: 'حرجة', tone: 'red' }, P1: { ar: 'عالية', tone: 'amber' }, P2: { ar: 'متوسطة', tone: 'slate' }, P3: { ar: 'منخفضة', tone: 'slate' } };
const TASK_WINDOWS = ['today', 'week', 'overdue', 'nodate', 'all'];

export async function tasksPage(user, opts = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(today + 'T00:00:00Z');
  const dnum = (d) => Math.round((Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') - todayMs) / 86400000);

  // ── العدسة والعرض والمرشّحات: كلها في الرابط، فالحالة قابلة للمشاركة والرجوع ──
  // الرؤية من منح القراءة، والإسناد من منح التعديل — مصدرٌ واحد للفصل في الخدمة نفسها،
  // فمن يقرأ عمل فريقه ولا يعدّله يرى اللوحة للاطّلاع بدل باب مغلق.
  const access = teamTasksAccess(user);
  const teamScope = access.scope;
  const canTeam = access.canRead;
  const canAssign = access.canWrite;
  const who = canTeam && opts.who === 'team' ? 'team' : 'me';
  // عدسة الفريق بلا صلاحية تعديل = عرض للاطّلاع: تُنزع أدوات الكتابة كلها بدل أن تُعرض ثم تُرفض.
  const readOnly = who === 'team' && !canAssign;
  const view = ['board', 'calendar'].includes(opts.view) ? opts.view : 'list';
  const winParam = TASK_WINDOWS.includes(opts.win) ? opts.win : null;
  const win = winParam || (view === 'list' ? 'today' : 'all');
  const fStatus = TASK_STATUSES.includes(opts.status) ? opts.status : null;
  const fPriority = TASK_PRIORITY[opts.priority] ? opts.priority : null;
  const fKind = ['project', 'opportunity', 'internal'].includes(opts.kind) ? opts.kind : null;
  const fFlag = ['nostep', 'blocked', 'noparent'].includes(opts.flag) ? opts.flag : null;
  const fq = String(opts.q || '').trim().slice(0, 80);
  const fAssignee = who === 'team' && opts.assignee ? String(opts.assignee).slice(0, 64) : null;

  // شهر التقويم (?m=YYYY-MM) — يُحسب في JS ويُربَط كنص، لا دوال تواريخ في الاستعلام
  const mParam = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(opts.m || '')) ? String(opts.m) : today.slice(0, 7);
  const calY = Number(mParam.slice(0, 4)); const calM = Number(mParam.slice(5, 7)) - 1;
  const monthStart = `${mParam}-01`;
  const monthDays = new Date(Date.UTC(calY, calM + 1, 0)).getUTCDate();
  const monthEnd = `${mParam}-${String(monthDays).padStart(2, '0')}`;
  const shiftMonth = (n) => { const d = new Date(Date.UTC(calY, calM + n, 1)); return d.toISOString().slice(0, 7); };

  // ── قراءة واحدة تخدم العدسات الثلاث: كل المفتوح + المنجَز القريب، والنافذة تُطبَّق للعرض ──
  const baseFilters = {
    status: fStatus, priority: fPriority, kind: fKind, flag: fFlag, q: fq || null,
    todayDate: today, doneSince: view === 'calendar' ? monthStart : addDays(today, -14), limit: 500,
  };
  let flat = []; let board = [];
  if (who === 'team') {
    board = await teamTasks(user, { ...baseFilters, assignee: fAssignee, includeDone: true });
    flat = board.flatMap((b) => b.tasks);
  } else {
    flat = await myTasks(user, baseFilters);
  }
  flat = flat.filter((t) => t.status !== 'CANCELLED');

  // ── التصنيف حسب الإلحاح (مجموعات لا تتقاطع: كل مهمة في نطاق واحد) ──
  const isDone = (t) => t.status === 'DONE';
  const openT = flat.filter((t) => !isDone(t));
  const doneRows = flat.filter(isDone);
  const overdue = openT.filter((t) => t.due_date && dnum(t.due_date) < 0);
  const dueToday = openT.filter((t) => t.due_date && dnum(t.due_date) === 0);
  const started = openT.filter((t) => (!t.due_date || dnum(t.due_date) > 0) && ['IN_PROGRESS', 'BLOCKED'].includes(t.status));
  const todayBand = [...overdue, ...dueToday, ...started];
  const todayIds = new Set(todayBand.map((t) => t.id));
  const weekBand = openT.filter((t) => !todayIds.has(t.id) && t.due_date && dnum(t.due_date) >= 1 && dnum(t.due_date) <= 7);
  const laterBand = openT.filter((t) => !todayIds.has(t.id) && t.due_date && dnum(t.due_date) > 7);
  const nodateBand = openT.filter((t) => !todayIds.has(t.id) && !t.due_date);
  const blockedCount = openT.filter((t) => t.status === 'BLOCKED' || t.blocked_reason).length;
  const noStepCount = openT.filter((t) => !String(t.next_step || '').trim()).length;
  const doneTodayList = doneRows.filter((t) => String(t.completed_at || '').slice(0, 10) === today);

  // ── نافذة العرض ──
  const weekIds = new Set(weekBand.map((t) => t.id));
  const overdueIds = new Set(overdue.map((t) => t.id));
  const inWindow = (t) => {
    if (win === 'all') return true;
    if (win === 'today') return todayIds.has(t.id) || (isDone(t) && String(t.completed_at || '').slice(0, 10) === today);
    if (win === 'week') return todayIds.has(t.id) || weekIds.has(t.id);
    if (win === 'overdue') return overdueIds.has(t.id);
    if (win === 'nodate') return !t.due_date;
    return true;
  };
  const visible = flat.filter(inWindow);
  const visIds = new Set(visible.map((t) => t.id));

  // ── قوائم الاختيار (نطاق صحيح من الخدمات نفسها، لا استعلام مواز) ──
  const prjOptions = (await listProjects(user)).slice(0, 200);
  const canReadOpp = can(user, 'read', 'opportunity');
  const allOpps = canReadOpp ? await listOpportunities(user, {}, { today }) : [];
  const oppOptions = allOpps.slice(0, 200);
  let people = [];
  if (canAssign) {
    if (teamScope === 'company') {
      people = await all('SELECT id, COALESCE(name_ar, username) AS "name" FROM app_user WHERE active=1 AND deleted_at IS NULL ORDER BY name_ar, username LIMIT 300');
    } else if (teamScope === 'department' && user.department_id) {
      people = await all(`SELECT u.id, COALESCE(u.name_ar, u.username) AS "name" FROM app_user u
        JOIN employee e ON e.id = u.employee_id AND e.deleted_at IS NULL
        WHERE u.active=1 AND u.deleted_at IS NULL AND e.department_id = ? ORDER BY u.name_ar, u.username LIMIT 300`, [user.department_id]);
    } else if (user.sector_id) {
      people = await all('SELECT id, COALESCE(name_ar, username) AS "name" FROM app_user WHERE active=1 AND deleted_at IS NULL AND sector_id = ? ORDER BY name_ar, username LIMIT 300', [user.sector_id]);
    }
  }
  const depts = await all(`SELECT id, name_ar FROM department WHERE active=1 AND deleted_at IS NULL
    ${user.scope === 'company' ? '' : 'AND sector_id = ?'} ORDER BY name_ar LIMIT 200`, user.scope === 'company' ? [] : [user.sector_id || '']);

  // ── الروابط: كل شريحة تحافظ على بقية المعاملات ──
  const qp = (over = {}) => {
    const cur = {
      who: who === 'team' ? 'team' : null, view: view !== 'list' ? view : null, win: winParam,
      status: fStatus, priority: fPriority, kind: fKind, flag: fFlag, q: fq || null,
      assignee: fAssignee, m: mParam !== today.slice(0, 7) ? mParam : null, ...over,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) if (v != null && v !== '') p.set(k, String(v));
    const s = p.toString();
    return '/app/tasks' + (s ? `?${s}` : '');
  };
  const hasFilter = !!(fStatus || fPriority || fKind || fFlag || fq || fAssignee || winParam);

  // ── لبنات العرض ──
  const dueLabel = (t) => {
    if (!t.due_date) return { text: G.noDueDate, color: 'var(--muted)', bold: false };
    const n = dnum(t.due_date);
    if (n < 0) return { text: `متأخرة ${dayWord(-n)}`, color: 'var(--red)', bold: true };
    if (n === 0) return { text: 'تستحق اليوم', color: '#a16207', bold: true };
    if (n === 1) return { text: 'غداً', color: '#a16207', bold: false };
    if (n <= 7) return { text: `خلال ${dayWord(n)}`, color: 'var(--muted)', bold: false };
    const d = new Date(String(t.due_date).slice(0, 10) + 'T00:00:00Z');
    return { text: `<span class="tnum">${d.getUTCDate()}</span> ${MONTHS_AR[d.getUTCMonth()]}`, color: 'var(--muted)', bold: false };
  };
  const parentOf = (t) => {
    if (t.project_id && t.project_name) return { href: `/app/project/${encodeURIComponent(t.project_id)}`, ic: 'projects', label: esc(t.project_name), kind: 'مشروع' };
    if (t.opportunity_id && t.opportunity_name) return { href: `/app/opportunity/${encodeURIComponent(t.opportunity_id)}`, ic: 'opportunity', label: esc(t.opportunity_name), kind: G.opportunity };
    if (t.project_id || t.opportunity_id) return { href: null, ic: 'projects', label: 'جهة خارج نطاقك', kind: '' };
    return null;
  };
  const parentChip = (t) => {
    const p = parentOf(t);
    if (!p) return `<span class="tk-parent tk-parent-none">${icon('clock')} ${workKindLabel(t.work_kind) === 'مشروع' ? G.noParentLink : workKindLabel(t.work_kind)}</span>`;
    return p.href
      ? `<a class="tk-parent" href="${p.href}" title="${p.kind}: ${p.label}">${icon(p.ic)} ${p.label}</a>`
      : `<span class="tk-parent tk-parent-none">${icon(p.ic)} ${p.label}</span>`;
  };
  // بيانات الصف تُحمَل على الحاوية نفسها فيقرأها المحرِّر واللوح والتقويم من مصدر واحد.
  const dataAttrs = (t) => `data-task="${esc(t.id)}" data-title="${esc(t.title)}" data-status="${esc(t.status || 'TODO')}"
    data-priority="${esc(t.priority || 'P2')}" data-due="${esc(String(t.due_date || '').slice(0, 10))}"
    data-progress="${Math.max(0, Math.min(100, Math.round(Number(t.progress_pct) || 0)))}"
    data-next="${esc(t.next_step || '')}" data-blocked="${esc(t.blocked_reason || '')}"
    data-project="${esc(t.project_id || '')}" data-opp="${esc(t.opportunity_id || '')}"
    data-assignee="${esc(t.assignee_user_id || '')}" data-dept="${esc(t.department_id || '')}"
    data-desc="${esc(t.description || '')}"`;
  const progChip = (t) => {
    const p = Math.max(0, Math.min(100, Math.round(Number(t.progress_pct) || 0)));
    if (p <= 0) return readOnly ? `<span style="color:var(--muted)">${G.noProgressYet}</span>`
      : `<button type="button" class="tk-link" data-action="task-open" data-focus="progress">${G.noProgressYet}</button>`;
    return `<span class="tk-prog" title="${G.taskProgress}"><span class="tk-progbar"><span style="width:${p}%"></span></span><span class="tnum">${p}%</span></span>`;
  };
  const stepChip = (t) => (String(t.next_step || '').trim()
    ? `<span class="tk-step" title="${G.nextStep}">${icon('flag')} ${esc(t.next_step)}</span>`
    : (readOnly ? `<span style="color:var(--muted)">${G.noNextAction}</span>`
      : `<button type="button" class="tk-link" data-action="task-open" data-focus="next">${G.setNextStep}</button>`));
  const blockBand = (t) => {
    if (t.status !== 'BLOCKED' && !t.blocked_reason) return '';
    const why = String(t.blocked_reason || '').trim();
    return `<div class="tk-block">${icon('risk')}<span>${why ? esc(why) : 'مُعطَّلة بلا سبب مكتوب — اكتبه ليصل إلى من يرفعه'}</span>
      ${readOnly ? '' : `<button type="button" class="tk-link" data-action="task-open" data-focus="blocked">${why ? 'تحديث العائق' : G.setBlocker}</button>`}</div>`;
  };

  const taskRow = (t) => {
    const done = isDone(t);
    const dl = dueLabel(t);
    const pr = TASK_PRIORITY[t.priority] || TASK_PRIORITY.P2;
    return `<div class="tk-row${done ? ' is-done' : ''}" ${dataAttrs(t)}>
      ${readOnly ? '' : `<input type="checkbox" class="tk-sel" value="${esc(t.id)}" aria-label="تحديد المهمة للتغيير الجماعي">`}
      <button type="button" class="tk-check${done ? ' done' : ''}" ${done || readOnly ? 'disabled' : 'data-action="task-done"'}
        aria-label="${done ? 'مهمة منجزة' : 'وضع كمنجزة'}" title="${done ? 'منجزة' : readOnly ? 'عرض للاطّلاع' : 'وضع كمنجزة'}">${done ? '✓' : ''}</button>
      <div class="tk-body">
        <div class="tk-title">${esc(t.title)}</div>
        <div class="tk-meta">
          ${done ? `<span style="color:var(--green);font-weight:700">أُنجزت${t.completed_at ? ` <span class="tnum">${esc(String(t.completed_at).slice(0, 10))}</span>` : ''}</span>`
            : `<span style="color:${dl.color}${dl.bold ? ';font-weight:700' : ''}">${dl.text}</span>`}
          ${parentChip(t)}
          ${who === 'team' ? `<span class="tk-who">${icon('team')} ${esc(t.assignee_name || t.assignee_username || G.unassigned)}</span>` : ''}
          ${t.department_name ? `<span class="tk-who">${esc(t.department_name)}</span>` : ''}
        </div>
        ${done ? '' : `<div class="tk-meta tk-meta2">${progChip(t)}${stepChip(t)}</div>`}
        ${done ? '' : blockBand(t)}
      </div>
      <div class="tk-side">
        ${done ? '' : `<span class="pill" style="background:${pr.tone === 'red' ? '#fee2e2' : pr.tone === 'amber' ? '#fef3c7' : '#f1f5f9'};color:${pr.tone === 'red' ? '#b91c1c' : pr.tone === 'amber' ? '#92400e' : '#475569'}">${pr.ar}</span>`}
        ${readOnly ? `<span class="pill" style="background:#f1f5f9;color:#475569">${tr(t.status)}</span>`
          : `<select class="tk-status" data-action="task-status" aria-label="حالة المهمة">
          ${TASK_STATUSES.map((s) => `<option value="${s}"${s === t.status ? ' selected' : ''}>${tr(s)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" data-action="task-open">${G.details}</button>`}
      </div></div>`;
  };

  const section = (title, items, accent, hint) => (items.length ? `<section class="tk-sec">
    <div class="tk-sec-head"><span class="tk-dot" style="background:${accent}"></span><span class="tk-sec-title">${title}</span>
      <span class="tk-sec-count tnum">${items.length}</span>
      ${hint ? `<span class="tk-sec-hint">${hint}</span>` : ''}</div>
    <div class="tk-list">${items.map(taskRow).join('')}</div></section>` : '');

  // ── ١) رأس اليوم: تقدّم حقيقي + أثر سبعة أيام (عدسة «مهامي» وحدها) ──
  const trend = who === 'me' ? await completionTrend(user, { days: 7, today }) : [];
  const weekDone = trend.reduce((a, d) => a + d.done, 0);
  const plate = todayBand.length + doneTodayList.length;
  const donePct = plate ? Math.round((doneTodayList.length / plate) * 100) : 0;
  const trendMax = Math.max(1, ...trend.map((d) => d.done));
  const dObj = new Date(today + 'T00:00:00Z');
  const dateLine = `${weekdayLabel(dObj.getUTCDay())} <span class="tnum">${dObj.getUTCDate()}</span> ${MONTHS_AR[dObj.getUTCMonth()]} <span class="tnum">${dObj.getUTCFullYear()}</span>`;
  const trendStrip = trend.length ? `<div class="wc-trend" role="img" aria-label="ما أُنجز في كل يوم من آخر سبعة أيام">
    ${trend.map((d) => {
      const dd = new Date(d.day + 'T00:00:00Z');
      const isToday = d.day === today;
      const h = d.done ? Math.max(6, Math.round((d.done / trendMax) * 34)) : 3;
      return `<div class="wc-tcell${isToday ? ' on' : ''}" title="${weekdayLabel(dd.getUTCDay())} ${dd.getUTCDate()} ${MONTHS_AR[dd.getUTCMonth()]} — أنجزت ${d.done}">
        <span class="wc-tbar" style="height:${h}px;background:${d.done ? 'var(--brand)' : '#dfe4ee'}"></span>
        <span class="wc-tnum tnum">${dd.getUTCDate()}</span>
        ${isToday ? nowDot('اليوم') : ''}</div>`;
    }).join('')}</div>` : '';
  const dayCard = who === 'me' ? `<section class="card wc-day">
    <div class="wc-day-l">
      <div class="wc-day-h">${G.dayPlan}</div>
      <div class="wc-day-date">${dateLine}</div>
      ${plate ? `
        <div class="wc-bar" role="img" aria-label="أنجزت ${doneTodayList.length} من ${plate} على طاولة اليوم"><span style="width:${donePct}%"></span></div>
        <div class="wc-day-num"><b class="tnum">${doneTodayList.length}</b> من <b class="tnum">${plate}</b> ${todayBand.length === 0 ? '· يومك مُغلق ✓' : `· بقيت <b class="tnum">${todayBand.length}</b>`}</div>`
        : `<div class="wc-day-empty">${G.nothingScheduled} — ${weekBand.length ? `لديك <b class="tnum">${weekBand.length}</b> خلال الأسبوع` : 'ابدأ بإضافة مهمة من الشريط أدناه'}
            <a class="tk-link" href="${qp({ win: weekBand.length ? 'week' : 'all', view: null })}">${weekBand.length ? G.winWeek : G.winAll}</a></div>`}
    </div>
    <div class="wc-day-r">
      <div class="wc-day-h">${G.doneThisWeek}</div>
      <div class="wc-day-week"><b class="tnum">${weekDone}</b> ${countAr(weekDone, { one: 'مهمة', two: 'مهمتان', few: 'مهام', many: 'مهمة', zero: 'مهمة' })}</div>
      ${trendStrip}
      ${weekDone === 0 ? '<div class="wc-day-note">لا إنجاز مسجَّل في آخر سبعة أيام — أول مهمة تُنجزها تظهر هنا.</div>' : ''}
    </div>
  </section>` : '';

  // ── ٢) عدّادات التركيز: كل واحدة مرشّح لا زينة ──
  const statLink = (label, n, sub, tone, href) => `<a class="wc-stat${n ? ` t-${tone}` : ''}" href="${href}">
    <span class="wc-stat-l">${label}</span><span class="wc-stat-n tnum">${n}</span><span class="wc-stat-s">${sub}</span></a>`;
  const stats = `<div class="wc-stats">
    ${statLink(G.winOverdue, overdue.length, overdue.length ? 'ابدأ بها أو امنحها موعداً' : 'لا شيء متأخر', 'bad', qp({ win: 'overdue', view: 'list', flag: null }))}
    ${statLink('تستحق اليوم', dueToday.length, dueToday.length ? 'موعدها اليوم' : 'لا شيء يستحق اليوم', 'warn', qp({ win: 'today', view: 'list', flag: null }))}
    ${statLink('مُعطَّلة', blockedCount, blockedCount ? 'تحتاج من يرفع العائق' : G.noBlocker, 'bad', qp({ win: 'all', flag: 'blocked', view: 'list' }))}
    ${statLink(G.noNextAction, noStepCount, noStepCount ? 'حدّد خطوة واضحة لكل مهمة' : 'لكل مهمة خطوتها', 'warn', qp({ win: 'all', flag: 'nostep', view: 'list' }))}
  </div>`;

  // ── ٣) العدسة + العرض + المرشّحات ──
  const lens = `<nav class="wc-lens" aria-label="عدسة العرض">
    <a class="wc-tab${who === 'me' ? ' on' : ''}" href="${qp({ who: null, assignee: null })}"${who === 'me' ? ' aria-current="page"' : ''}>${icon('tasks')} ${G.myWork}${who === 'me' ? ` <span class="tnum">${openT.length}</span>` : ''}</a>
    ${canTeam ? `<a class="wc-tab${who === 'team' ? ' on' : ''}" href="${qp({ who: 'team' })}"${who === 'team' ? ' aria-current="page"' : ''}>${icon('team')} ${G.teamWork}${who === 'team' ? ` <span class="tnum">${openT.length}</span>` : ''}</a>` : ''}
  </nav>`;
  const viewSeg = `<div class="wc-seg" role="group" aria-label="طريقة العرض">
    <a class="${view === 'list' ? 'on' : ''}" href="${qp({ view: null })}">${icon('list')} ${G.viewList}</a>
    <a class="${view === 'board' ? 'on' : ''}" href="${qp({ view: 'board' })}">${icon('kanban')} ${G.viewBoard}</a>
    <a class="${view === 'calendar' ? 'on' : ''}" href="${qp({ view: 'calendar' })}">${icon('clock')} ${G.viewCalendar}</a>
  </div>`;
  const chip = (label, on, href, n) => `<a class="chip${on ? ' on' : ''}" href="${href}">${label}${n != null ? ` <span class="tnum">${n}</span>` : ''}</a>`;
  const winChips = `<div class="chips">
    <span class="lbl">${G.window}</span>
    ${chip(G.winToday, win === 'today', qp({ win: 'today' }), todayBand.length)}
    ${chip(G.winWeek, win === 'week', qp({ win: 'week' }), todayBand.length + weekBand.length)}
    ${chip(G.winOverdue, win === 'overdue', qp({ win: 'overdue' }), overdue.length)}
    ${chip(G.noDueDate, win === 'nodate', qp({ win: 'nodate' }), nodateBand.length)}
    ${chip(G.winAll, win === 'all', qp({ win: 'all' }), openT.length)}
  </div>`;
  const moreChips = `<div class="chips">
    <span class="lbl">${G.filter}</span>
    ${TASK_STATUSES.map((s) => chip(tr(s), fStatus === s, qp({ status: fStatus === s ? null : s }))).join('')}
    ${Object.entries(TASK_PRIORITY).slice(0, 2).map(([k, v]) => chip(v.ar, fPriority === k, qp({ priority: fPriority === k ? null : k }))).join('')}
    ${chip('على مشروع', fKind === 'project', qp({ kind: fKind === 'project' ? null : 'project' }))}
    ${chip('على فرصة', fKind === 'opportunity', qp({ kind: fKind === 'opportunity' ? null : 'opportunity' }))}
    ${chip(G.internalWork, fKind === 'internal', qp({ kind: fKind === 'internal' ? null : 'internal' }))}
    ${hasFilter ? `<a class="chip" href="/app/tasks${who === 'team' ? '?who=team' : ''}">مسح المرشحات</a>` : ''}
  </div>`;
  const hidden = (k, v) => (v ? `<input type="hidden" name="${k}" value="${esc(v)}">` : '');
  const searchForm = `<form method="get" action="/app/tasks" class="wc-search">
    ${hidden('who', who === 'team' ? 'team' : '')}${hidden('view', view !== 'list' ? view : '')}${hidden('win', winParam || '')}
    ${hidden('status', fStatus)}${hidden('priority', fPriority)}${hidden('kind', fKind)}${hidden('flag', fFlag)}${hidden('assignee', fAssignee)}
    <div class="search">${icon('search')}<input class="input" type="search" name="q" value="${esc(fq)}" placeholder="ابحث في عناوين المهام…" aria-label="بحث في عناوين المهام"></div>
    <button class="btn btn-sm" type="submit">${G.search}</button>
  </form>`;

  // ── ٤) الإضافة السريعة: عنوان + جهة + مسؤول + موعد + أولوية في بطاقة واحدة ──
  const parentSelect = (idAttr, label) => `<select id="${idAttr}" class="input" aria-label="${label}">
    <option value="">${G.internalWork}</option>
    ${prjOptions.length ? `<optgroup label="${G.projects}">${prjOptions.map((p) => `<option value="p:${esc(p.id)}">${esc(p.name_ar)}</option>`).join('')}</optgroup>` : ''}
    ${oppOptions.length ? `<optgroup label="${G.opportunities}">${oppOptions.map((o) => `<option value="o:${esc(o.id)}">${esc(o.title_ar)}</option>`).join('')}</optgroup>` : ''}
  </select>`;
  const quickAdd = `<section class="card wc-add">
    <div class="wc-add-row">
      <input id="qa-title" class="input" placeholder="ما الذي ستنجزه؟ اكتبه هنا…" aria-label="عنوان المهمة">
      <button class="btn btn-primary" data-action="task-add">${icon('plus')} ${G.add}</button>
    </div>
    <div class="wc-add-row2">
      ${parentSelect('qa-parent', G.parentLink)}
      ${canAssign && people.length ? `<select id="qa-assignee" class="input" aria-label="${G.assignee}">
        <option value="">${G.assignee}: أنا</option>
        ${people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>` : ''}
      <input id="qa-due" type="date" class="input" dir="ltr" aria-label="تاريخ الاستحقاق" title="تاريخ الاستحقاق">
      <select id="qa-priority" class="input" aria-label="${G.priority}">
        <option value="P2">${TASK_PRIORITY.P2.ar}</option><option value="P0">${TASK_PRIORITY.P0.ar}</option>
        <option value="P1">${TASK_PRIORITY.P1.ar}</option><option value="P3">${TASK_PRIORITY.P3.ar}</option>
      </select>
      <input id="qa-next" class="input wc-add-next" placeholder="${G.nextStep} (اختياري)" aria-label="${G.nextStep}">
    </div>
  </section>`;

  // ── ٥) عرض القائمة ──
  const vis = (arr) => arr.filter((t) => visIds.has(t.id));
  const doneVisible = doneRows.filter((t) => visIds.has(t.id))
    .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || ''))).slice(0, 25);
  const emptyList = () => {
    if (openT.length === 0 && doneRows.length === 0) {
      return `<div class="card"><div class="empty-state">${icon('tasks')}
        <div class="t">لا مهام ${who === 'team' ? 'على فريقك الآن' : 'باسمك بعد'}</div>
        <div class="s">${who === 'team' ? 'لا مهمة مفتوحة على أحد ضمن نطاقك. حين يُسنَد عمل لأحدهم سيظهر هنا مرتّباً بالأكثر تأخراً.' : 'اكتب أول مهمة في الشريط أعلاه — ستظهر هنا مرتّبةً بالأقرب موعداً، والأكثر إلحاحاً في الأعلى.'}</div>
        ${who === 'team' ? `<a class="btn" href="${qp({ who: null })}">${G.myWork}</a>` : ''}</div></div>`;
    }
    if (win === 'today' && todayBand.length === 0) {
      return `<div class="card"><div class="empty-state">${icon('check')}
        <div class="t">${G.dayClear}</div>
        <div class="s">${doneTodayList.length ? `أنجزت اليوم ${countAr(doneTodayList.length, { one: 'مهمة واحدة', two: 'مهمتين', few: 'مهام', many: 'مهمة' })}. ` : ''}لا شيء متأخر ولا مستحق اليوم${weekBand.length ? ` — و${countAr(weekBand.length, { one: 'مهمة واحدة', two: 'مهمتان', few: 'مهام', many: 'مهمة' })} خلال الأسبوع.` : '.'}</div>
        <a class="btn" href="${qp({ win: weekBand.length ? 'week' : 'all' })}">${weekBand.length ? G.winWeek : G.winAll}</a></div></div>`;
    }
    return `<div class="card"><div class="empty-state">${icon('search')}
      <div class="t">لا مهمة تطابق هذه المرشحات</div>
      <div class="s">جرّب توسيع النافذة الزمنية أو مسح المرشحات لترى بقية عملك.</div>
      <a class="btn" href="/app/tasks${who === 'team' ? '?who=team' : ''}">مسح المرشحات</a></div>`;
  };
  const listBody = (vis(todayBand).length + vis(weekBand).length + vis(laterBand).length + vis(nodateBand).length + doneVisible.length) === 0
    ? emptyList()
    : section(`${G.winToday} — طاولتك الآن`, vis(todayBand), 'var(--brand)', 'المتأخر والمستحق اليوم وما بدأتَه فعلاً')
      + section(G.winWeek, vis(weekBand), '#a16207', '')
      + section(G.winLater, vis(laterBand), '#64748b', '')
      + section(G.noDueDate, vis(nodateBand), '#64748b', 'امنحها موعداً أو أغلقها — القائمة الميتة تخفي المهم')
      + (doneVisible.length ? `<details class="tk-fold"${vis(todayBand).length ? '' : ' open'}>
          <summary class="tk-sec-head"><span class="tk-dot" style="background:var(--green)"></span>
            <span class="tk-sec-title">أنجزتها مؤخراً</span>
            <span class="tk-sec-count tnum">${doneVisible.length}</span>
            <span class="tk-sec-hint">إظهار / إخفاء</span></summary>
          <div class="tk-list" style="margin-top:.35rem">${doneVisible.map(taskRow).join('')}</div></details>` : '');
  // شريط «ما بعد اليوم»: المتراكم مُعترَف به لا مُلقى — عدّادات مضغوطة لا قائمة مسرودة
  const beyond = (win === 'today' && (weekBand.length || laterBand.length || nodateBand.length))
    ? `<div class="wc-beyond">بعد اليوم:
        ${weekBand.length ? `<a href="${qp({ win: 'week' })}">${G.winWeek} <b class="tnum">${weekBand.length}</b></a>` : ''}
        ${laterBand.length ? `<a href="${qp({ win: 'all' })}">${G.winLater} <b class="tnum">${laterBand.length}</b></a>` : ''}
        ${nodateBand.length ? `<a href="${qp({ win: 'nodate' })}">${G.noDueDate} <b class="tnum">${nodateBand.length}</b></a>` : ''}
      </div>` : '';

  // ── ٦) عرض اللوح ──
  const boardCard = (t) => {
    const dl = dueLabel(t);
    const pr = TASK_PRIORITY[t.priority] || TASK_PRIORITY.P2;
    const p = Math.max(0, Math.min(100, Math.round(Number(t.progress_pct) || 0)));
    return `<article class="kcard tk-card" draggable="${readOnly ? 'false' : 'true'}" ${dataAttrs(t)} style="--_c:${TASK_STATUS_COLOR[t.status] || '#cbd5e1'}${readOnly ? ';cursor:default' : ''}">
      ${readOnly ? `<div class="tk-card-t">${esc(t.title)}</div>` : `<button type="button" class="tk-card-t" data-action="task-open">${esc(t.title)}</button>`}
      <div class="km">
        <span style="color:${dl.color}${dl.bold ? ';font-weight:700' : ''}">${dl.text}</span>
        <span class="pill" style="background:${pr.tone === 'red' ? '#fee2e2' : pr.tone === 'amber' ? '#fef3c7' : '#f1f5f9'};color:${pr.tone === 'red' ? '#b91c1c' : pr.tone === 'amber' ? '#92400e' : '#475569'}">${pr.ar}</span>
      </div>
      <div class="km">${parentChip(t)}${who === 'team' ? `<span class="tk-who">${esc(t.assignee_name || t.assignee_username || G.unassigned)}</span>` : ''}</div>
      ${p > 0 ? `<div class="tk-progbar" style="margin-top:.4rem"><span style="width:${p}%"></span></div>` : ''}
      ${t.blocked_reason ? `<div class="tk-card-block">${esc(t.blocked_reason)}</div>` : ''}
    </article>`;
  };
  const boardView = `<div class="kanban" id="tk-board" tabindex="0" role="region" aria-label="لوح المهام حسب الحالة — اسحب البطاقة إلى عمود آخر لتغيير حالتها">
    ${TASK_STATUSES.map((s) => {
      const items = visible.filter((t) => (t.status || 'TODO') === s);
      return `<div class="kcol" data-status="${s}">
        <div class="kcol-head"><span class="kcol-dot" style="background:${TASK_STATUS_COLOR[s]}"></span>
          <span class="t">${tr(s)}</span><span class="n tnum">${items.length}</span></div>
        <div class="kcol-body">${items.length ? items.map(boardCard).join('')
          : '<div class="tk-kempty">لا مهام في هذه الحالة</div>'}</div></div>`;
    }).join('')}</div>
    <div class="wc-hint">${readOnly ? 'عرض للاطّلاع: تعديل مهام فريقك يتطلب صلاحية إدارية على المهام.' : 'اسحب أي بطاقة إلى عمود آخر لتغيير حالتها — أو افتح تفاصيلها بالنقر على عنوانها.'}</div>`;

  // ── ٧) عرض التقويم — أول تقويم في المنصة، بالنموذج الزمني الموحد ──
  const monthTasks = flat.filter((t) => t.due_date && String(t.due_date).slice(0, 10) >= monthStart && String(t.due_date).slice(0, 10) <= monthEnd);
  const byDay = {};
  for (const t of monthTasks) (byDay[String(t.due_date).slice(0, 10)] ||= []).push(t);
  const doneByDay = {};
  for (const t of doneRows) { const d = String(t.completed_at || '').slice(0, 10); if (d >= monthStart && d <= monthEnd) doneByDay[d] = (doneByDay[d] || 0) + 1; }
  const firstDow = new Date(monthStart + 'T00:00:00Z').getUTCDay();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<div class="cal-cell cal-blank" aria-hidden="true"></div>');
  for (let d = 1; d <= monthDays; d++) {
    const iso = `${mParam}-${String(d).padStart(2, '0')}`;
    const items = (byDay[iso] || []).filter((t) => !isDone(t));
    const doneN = doneByDay[iso] || 0;
    const isToday = iso === today;
    const late = iso < today;
    const chips = items.slice(0, 2).map((t) => {
      const c = t.status === 'BLOCKED' ? '#dc2626' : late ? '#dc2626' : TASK_STATUS_COLOR[t.status] || '#64748b';
      return readOnly
        ? `<span class="cal-chip" style="--_c:${c};cursor:default" title="${esc(t.title)}">${esc(t.title)}</span>`
        : `<button type="button" class="cal-chip" data-action="task-open" ${dataAttrs(t)} style="--_c:${c}" title="${esc(t.title)}">${esc(t.title)}</button>`;
    }).join('');
    const dots = items.slice(0, 4).map((t) => `<span class="cal-dot" style="background:${t.status === 'BLOCKED' || late ? '#dc2626' : TASK_STATUS_COLOR[t.status] || '#64748b'}"></span>`).join('');
    cells.push(`<div class="cal-cell${isToday ? ' on' : ''}">
      <div class="cal-d"><span class="tnum">${d}</span>${isToday ? nowDot('اليوم') : ''}</div>
      <div class="cal-items">${chips}${items.length > 2 ? `<span class="cal-more">و<span class="tnum">${items.length - 2}</span> غيرها</span>` : ''}</div>
      <div class="cal-dots" aria-hidden="true">${dots}</div>
      ${doneN ? `<div class="cal-done">✓ <span class="tnum">${doneN}</span></div>` : ''}</div>`);
  }
  while (cells.length % 7) cells.push('<div class="cal-cell cal-blank" aria-hidden="true"></div>');
  const calNoDate = nodateBand.slice(0, 12);
  const calendarView = `<section class="card cal">
    <div class="cal-head">
      <a class="btn btn-sm" href="${qp({ m: shiftMonth(-1) })}" aria-label="الشهر السابق: ${MONTHS_AR[(calM + 11) % 12]}">${MONTHS_AR[(calM + 11) % 12]}</a>
      <div class="cal-title">${MONTHS_AR[calM]} <span class="tnum">${calY}</span></div>
      <a class="btn btn-sm" href="${qp({ m: shiftMonth(1) })}" aria-label="الشهر التالي: ${MONTHS_AR[(calM + 1) % 12]}">${MONTHS_AR[(calM + 1) % 12]}</a>
    </div>
    <div class="cal-grid cal-dow">${WEEKDAYS_AR.map((w) => `<div>${w}</div>`).join('')}</div>
    <div class="cal-grid cal-days">${cells.join('')}</div>
    ${monthTasks.length === 0 ? `<div class="empty-state" style="padding:1.4rem 1rem">
      <div class="t">لا مهمة لها موعد في هذا الشهر</div>
      <div class="s">المهام بلا موعد لا تظهر على الشبكة — امنحها موعداً لتدخل تقويمك.</div></div>` : ''}
    <div class="cal-legend">
      <span><span class="cal-dot" style="background:#dc2626"></span> متأخرة أو مُعطَّلة</span>
      <span><span class="cal-dot" style="background:#244A99"></span> قيد التنفيذ</span>
      <span><span class="cal-dot" style="background:#64748b"></span> بانتظار البدء</span>
      <span>✓ ما أُنجز في ذلك اليوم</span>
    </div>
  </section>
  ${calNoDate.length ? `<section class="card wc-tray">
    <div class="wc-tray-h">${G.noDueDate} <span class="tnum">${nodateBand.length}</span></div>
    <div class="wc-tray-s">لا تظهر على الشبكة لأنها بلا تاريخ — افتح المهمة وامنحها موعداً فتدخل تقويمك.</div>
    <div class="tk-list">${calNoDate.map(taskRow).join('')}</div></section>` : ''}`;

  // ── ٨) لوحة الفريق: «من يحتاج مساعدة» لا «من الأفضل» ──
  const teamBoard = who === 'team' ? (board.length ? `<section class="wc-team">
    <div class="tk-sec-head"><span class="tk-dot" style="background:var(--brand2)"></span>
      <span class="tk-sec-title">من يحتاج مساعدة</span>
      <span class="tk-sec-hint">الترتيب بالمتأخر ثم بحجم العمل — لا مقارنة بين الأشخاص</span></div>
    <div class="wc-team-grid">${board.map((b) => `<a class="wc-person${b.overdue ? ' hot' : ''}" href="${qp({ assignee: b.userId || null })}">
      <div class="wc-person-h"><span class="wc-person-n">${esc(b.name)}</span><span class="tk-sec-count tnum">${b.tasks.filter((t) => t.status !== 'DONE').length}</span></div>
      <div class="wc-person-f">
        ${b.overdue ? `<span style="color:var(--red);font-weight:700">${countAr(b.overdue, { one: 'مهمة متأخرة', two: 'مهمتان متأخرتان', few: 'مهام متأخرة', many: 'مهمة متأخرة' })}</span>` : ''}
        ${b.blocked ? `<span style="color:#a16207">${countAr(b.blocked, { one: 'مهمة مُعطَّلة', two: 'مهمتان مُعطَّلتان', few: 'مهام مُعطَّلة', many: 'مهمة مُعطَّلة' })}</span>` : ''}
        ${b.noStep ? `<span style="color:var(--muted)">${countAr(b.noStep, { one: 'بلا خطوة تالية', two: 'بلا خطوة تالية', few: 'بلا خطوة تالية', many: 'بلا خطوة تالية' })}</span>` : ''}
        ${!b.overdue && !b.blocked && !b.noStep ? '<span style="color:var(--green);font-weight:700">لا شيء عالق</span>' : ''}
      </div></a>`).join('')}</div></section>`
    : `<div class="card"><div class="empty-state">${icon('team')}
        <div class="t">لا مهام مفتوحة على فريقك</div>
        <div class="s">ضمن نطاقك لا توجد مهمة مفتوحة على أحد الآن. أسنِد عملاً من شريط الإضافة أعلاه ليظهر هنا.</div></div></div>`) : '';

  // ── ٩) «الفرص اللي عليّ» — من خدمة الفرص نفسها، لا استعلام مواز ──
  const myOpps = who === 'me' && canReadOpp ? allOpps.filter((o) => o.owner_user_id === user.id) : [];
  let oppsBlock = '';
  if (who === 'me' && canReadOpp) {
    const stages = await all('SELECT id, name_ar, color, is_won, is_lost FROM stage ORDER BY sort_order');
    const stById = Object.fromEntries(stages.map((s) => [s.id, s]));
    const openOpps = myOpps.filter((o) => { const s = stById[o.stage_id]; return s && !s.is_won && !s.is_lost; });
    const clientName = Object.fromEntries((await all('SELECT id, name_ar FROM client')).map((c) => [c.id, c.name_ar]));
    const shown = openOpps.slice().sort((a, b) => (Number(b.rot) - Number(a.rot)) || ((b.value_halalas || 0) - (a.value_halalas || 0))).slice(0, 5);
    oppsBlock = `<section class="card wc-opps">
      <div class="wc-opps-h">
        <div><div class="wc-opps-t">${G.myOpenOpportunities}</div>
          <div class="wc-opps-s">${openOpps.length ? 'الفرص المفتوحة المسجَّلة باسمك — المتوقفة أولاً' : 'لا فرصة مفتوحة مسجَّلة باسمك الآن'}</div></div>
        <a class="btn btn-sm" href="/app/my-opportunities">كل فرصي</a>
      </div>
      ${shown.length ? `<div class="wc-opps-list">${shown.map((o) => `<a class="wc-opp" href="/app/opportunity/${encodeURIComponent(o.id)}">
        <span class="wc-opp-t">${esc(o.title_ar)}<span class="wc-opp-c">${esc(clientName[o.client_id] || 'بدون عميل')}</span></span>
        <span class="wc-opp-m">
          <span class="pill" style="background:${esc(stById[o.stage_id]?.color || '#cbd5e1')}22;color:var(--ink2)">${esc(stById[o.stage_id]?.name_ar || '')}</span>
          ${o.rot ? '<span style="color:#a16207;font-weight:700">متوقفة</span>' : ''}
          ${o.no_next_action ? `<span style="color:var(--red);font-weight:700">${G.noNextAction}</span>` : ''}
        </span>
        <span class="wc-opp-v tnum">${fmtSar(o.value_halalas)}</span></a>`).join('')}</div>`
      : `<div class="empty-state" style="padding:1.3rem 1rem">
          <div class="t">لا فرص باسمك بعد</div>
          <div class="s">حين تُسنَد إليك فرصة كمالك ستظهر هنا بجانب مهامك، ومعها خطوتها التالية.</div>
          <a class="btn" href="/app/opportunities">${G.opportunities}</a></div>`}
    </section>`;
  }

  // ── ١٠) شريط التغيير الجماعي + محرِّر المهمة (قالب واحد يُستنسخ) ──
  const bulkBar = readOnly ? '' : `<div class="wc-bulk" id="tk-bulk" hidden>
    <span class="wc-bulk-n"><b class="tnum" id="tk-bulk-n">0</b> ${G.bulkSelected}</span>
    <select id="bk-status" class="input" aria-label="تغيير الحالة">
      <option value="">${G.taskStatus}…</option>
      ${TASK_STATUSES.filter((s) => s !== 'BLOCKED').map((s) => `<option value="${s}">${tr(s)}</option>`).join('')}
    </select>
    <select id="bk-priority" class="input" aria-label="تغيير الأولوية">
      <option value="">${G.priority}…</option>
      ${Object.entries(TASK_PRIORITY).map(([k, v]) => `<option value="${k}">${v.ar}</option>`).join('')}
    </select>
    <input id="bk-due" type="date" class="input" dir="ltr" aria-label="تغيير تاريخ الاستحقاق" title="تغيير تاريخ الاستحقاق">
    ${canAssign && people.length ? `<select id="bk-assignee" class="input" aria-label="تغيير المسؤول">
      <option value="">${G.assignee}…</option>${people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>` : ''}
    <button class="btn btn-primary btn-sm" data-action="task-bulk">${G.bulkApply}</button>
    <button class="btn btn-sm" data-action="task-bulk-clear">${G.bulkClear}</button>
    <span class="wc-bulk-note">التعطيل يحتاج سبباً مكتوباً — غيّره من تفاصيل المهمة</span>
  </div>`;
  const editorTpl = readOnly ? '' : `<template id="tk-editor">
    <div class="drawer-head">
      <div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--muted);font-weight:700">${G.task}</div>
        <h3 style="font-size:16px;margin-top:.2rem" data-f="heading"></h3></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="task-close" aria-label="إغلاق">✕</button>
    </div>
    <div class="drawer-body">
      <div class="field"><label for="tf-title">عنوان المهمة</label><input id="tf-title" class="input" data-f="title"></div>
      <div class="grid2">
        <div class="field"><label for="tf-status">${G.taskStatus}</label>
          <select id="tf-status" data-f="status">${TASK_STATUSES.map((s) => `<option value="${s}">${tr(s)}</option>`).join('')}</select></div>
        <div class="field"><label for="tf-priority">${G.priority}</label>
          <select id="tf-priority" data-f="priority">${Object.entries(TASK_PRIORITY).map(([k, v]) => `<option value="${k}">${v.ar}</option>`).join('')}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="tf-due">${G.dueDate}</label><input id="tf-due" type="date" dir="ltr" data-f="due"></div>
        <div class="field"><label for="tf-progress">${G.taskProgress} <b class="tnum" data-f="progress-out">0%</b></label>
          <input id="tf-progress" type="range" min="0" max="100" step="5" data-f="progress"></div>
      </div>
      <div class="field"><label for="tf-next">${G.nextStep}</label>
        <input id="tf-next" class="input" data-f="next" placeholder="ما الفعل التالي المحدَّد الذي يحرّك هذه المهمة؟"></div>
      <div class="field"><label for="tf-blocked">${G.blocker}</label>
        <input id="tf-blocked" class="input" data-f="blocked" placeholder="ما الذي يوقفها ومَن يستطيع رفعه؟">
        <div class="wc-fieldnote">اختيار «مُعطَّلة» يتطلب سبباً مكتوباً — بلا سبب لا تصل إلى أحد.</div></div>
      <div class="field"><label for="tf-parent">${G.parentLink}</label>${parentSelect('tf-parent', G.parentLink).replace('id="tf-parent" class="input"', 'id="tf-parent" class="input" data-f="parent"')}</div>
      ${canAssign && people.length ? `<div class="field"><label for="tf-assignee">${G.assignee}</label>
        <select id="tf-assignee" data-f="assignee"><option value="">${G.unassigned}</option>${people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>` : ''}
      ${depts.length ? `<div class="field"><label for="tf-dept">الإدارة المسؤولة</label>
        <select id="tf-dept" data-f="dept"><option value="">غير محدَّدة</option>${depts.map((d) => `<option value="${esc(d.id)}">${esc(d.name_ar)}</option>`).join('')}</select></div>` : ''}
      <div class="wc-fieldnote" data-f="error" hidden></div>
    </div>
    <div class="drawer-foot">
      <button type="button" class="btn btn-primary" data-action="task-save">${G.save}</button>
      <button type="button" class="btn" data-action="task-close">${G.cancel}</button>
    </div>
  </template>`;

  const styles = `<style>
    .wc-day{display:flex;gap:1.2rem;flex-wrap:wrap;padding:.9rem 1.05rem;margin-bottom:.9rem;align-items:stretch}
    .wc-day-l{flex:1 1 260px;min-width:0}
    .wc-day-r{flex:0 1 260px;min-width:0;border-inline-start:1px solid var(--line);padding-inline-start:1.1rem}
    .wc-day-h{font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.02em}
    .wc-day-date{font-size:15px;font-weight:800;color:var(--ink2);margin:.15rem 0 .55rem}
    .wc-bar{height:9px;background:#eef1f7;border-radius:999px;overflow:hidden;max-width:340px}
    .wc-bar>span{display:block;height:100%;border-radius:999px;background:var(--brand);transition:width .4s}
    .wc-day-num{font-size:12.5px;color:var(--muted);margin-top:.35rem}
    .wc-day-num b{color:var(--ink2);font-size:14px}
    .wc-day-empty{font-size:12.5px;color:var(--muted);line-height:1.9}
    .wc-day-week{font-size:13px;color:var(--muted);margin:.15rem 0 .4rem}
    .wc-day-week b{font-size:1.35rem;color:var(--ink2);font-weight:800}
    .wc-day-note{font-size:11px;color:var(--muted);margin-top:.35rem;line-height:1.7}
    .wc-trend{display:grid;grid-template-columns:repeat(7,1fr);direction:rtl;gap:4px;align-items:end;height:56px}
    .wc-tcell{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;position:relative}
    .wc-tbar{display:block;width:100%;max-width:22px;border-radius:3px}
    .wc-tnum{font-size:9.5px;color:var(--muted)}
    .wc-tcell.on .wc-tnum{color:var(--ink2);font-weight:800}
    .wc-tcell .now-dot{position:absolute;top:-2px}
    .wc-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:.6rem;margin-bottom:.9rem}
    .wc-stat{display:block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:.55rem .8rem;transition:border-color .15s,box-shadow .15s}
    .wc-stat:hover{border-color:#c9d3e8;box-shadow:var(--sh-sm)}
    .wc-stat-l{display:block;font-size:11px;font-weight:700;color:var(--muted)}
    .wc-stat-n{display:block;font-size:1.3rem;font-weight:800;color:var(--ink2);line-height:1.25}
    .wc-stat-s{display:block;font-size:10.5px;color:var(--muted)}
    .wc-stat.t-bad .wc-stat-n{color:var(--red)}
    .wc-stat.t-warn .wc-stat-n{color:#a16207}
    .wc-lens{display:flex;gap:.4rem;border-bottom:1px solid var(--line);margin-bottom:.75rem;flex-wrap:wrap}
    .wc-tab{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem .85rem;font-size:13px;font-weight:700;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px}
    .wc-tab:hover{color:var(--ink2)}
    .wc-tab.on{color:var(--brand);border-bottom-color:var(--brand)}
    .wc-tab svg{width:15px;height:15px}
    .wc-seg{display:inline-flex;background:#eef1f7;border-radius:10px;padding:3px;gap:2px}
    .wc-seg a{display:inline-flex;align-items:center;gap:.35rem;font-size:12px;font-weight:700;color:var(--muted);padding:.35rem .7rem;border-radius:8px}
    .wc-seg a.on{background:#fff;color:var(--ink2);box-shadow:var(--sh-sm)}
    .wc-seg svg{width:14px;height:14px}
    .wc-bartop{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.7rem}
    .wc-search{display:flex;gap:.4rem;align-items:center;margin-inline-start:auto}
    .wc-search .search input{min-width:180px}
    .wc-add{padding:.75rem .9rem;margin-bottom:1rem;display:flex;flex-direction:column;gap:.5rem}
    .wc-add-row{display:flex;gap:.5rem;align-items:center}
    .wc-add-row #qa-title{flex:1;min-width:0}
    .wc-add-row2{display:flex;gap:.45rem;flex-wrap:wrap;align-items:center}
    .wc-add-row2 .input{font-size:12px;padding:.4rem .55rem;max-width:100%}
    .wc-add-row2 select{max-width:190px;min-width:0}
    .wc-add-next{flex:1;min-width:150px}
    .tk-sec{margin-bottom:1.05rem}
    .tk-sec-head{display:flex;align-items:center;gap:.5rem;margin:0 0 .4rem;padding:0 .15rem;flex-wrap:wrap}
    .tk-dot{width:8px;height:8px;border-radius:50%;flex:none}
    .tk-sec-title{font-weight:800;font-size:12.5px;color:var(--ink2)}
    .tk-sec-count{font-size:11px;color:var(--muted);background:#f1f5f9;border-radius:20px;padding:.05rem .5rem;font-weight:700;min-width:20px;text-align:center}
    .tk-sec-hint{font-size:10.5px;color:var(--muted);margin-inline-start:auto}
    .tk-list{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
    .tk-row{display:flex;gap:.6rem;align-items:flex-start;padding:.65rem .8rem;border-bottom:1px solid var(--line);transition:background .12s;flex-wrap:wrap}
    .tk-row:last-child{border-bottom:none}
    .tk-row:hover{background:#f8fafc}
    .tk-row.sel{background:#eef4ff}
    .tk-sel{flex:none;margin-top:3px;width:15px;height:15px;accent-color:var(--brand);cursor:pointer;opacity:.45}
    .tk-row:hover .tk-sel,.tk-sel:checked,.tk-sel:focus-visible{opacity:1}
    .tk-check{flex:none;width:20px;height:20px;margin-top:1px;border:2px solid #a8b3c4;border-radius:50%;background:#fff;color:#fff;font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:all .12s}
    .tk-check:hover:not(.done){border-color:var(--green);background:#f0fdf4}
    .tk-check.done{border-color:var(--green);background:var(--green);cursor:default}
    .tk-body{flex:1 1 240px;min-width:0}
    .tk-title{font-weight:600;font-size:13px;color:var(--ink2);line-height:1.55;word-break:break-word}
    .tk-row.is-done .tk-title{text-decoration:line-through;color:var(--muted);font-weight:500}
    .tk-meta{display:flex;gap:.3rem .8rem;flex-wrap:wrap;align-items:center;margin-top:.2rem;font-size:11px;color:var(--muted)}
    .tk-meta2{margin-top:.3rem}
    .tk-parent{color:var(--muted);display:inline-flex;align-items:center;gap:.25rem;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    a.tk-parent:hover{color:var(--brand)}
    .tk-parent svg{width:12px;height:12px;opacity:.75;flex:none}
    .tk-parent-none{color:var(--muted);font-style:normal}
    .tk-who{display:inline-flex;align-items:center;gap:.25rem;color:var(--muted)}
    .tk-who svg{width:12px;height:12px;opacity:.75}
    .tk-prog{display:inline-flex;align-items:center;gap:.35rem;color:var(--muted);font-weight:700}
    .tk-progbar{display:block;width:70px;height:6px;background:#eef1f7;border-radius:999px;overflow:hidden;flex:none}
    .tk-progbar>span{display:block;height:100%;background:var(--brand);border-radius:999px}
    .tk-step{display:inline-flex;align-items:center;gap:.25rem;color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tk-step svg{width:11px;height:11px;opacity:.8;flex:none}
    .tk-link{background:none;border:none;padding:0;font:inherit;font-size:11px;color:var(--muted);cursor:pointer;
      text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}
    .tk-link:hover,.tk-link:focus-visible{color:var(--brand);text-decoration-style:solid}
    .tk-block{display:flex;align-items:center;gap:.4rem;margin-top:.35rem;padding:.3rem .5rem;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:11px;color:#991b1b}
    .tk-block svg{width:13px;height:13px;flex:none}
    .tk-block span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tk-block .tk-link{color:#991b1b}
    .tk-side{display:flex;gap:.4rem;align-items:center;flex:none;margin-inline-start:auto}
    .tk-status{font-size:11.5px;border:1px solid var(--line);border-radius:8px;padding:.22rem .4rem;background:#fff;color:var(--ink2);cursor:pointer;font-family:inherit}
    .tk-fold>summary{cursor:pointer;list-style:none}
    .tk-fold>summary::-webkit-details-marker{display:none}
    .wc-beyond{display:flex;gap:.8rem;flex-wrap:wrap;font-size:11.5px;color:var(--muted);padding:.5rem .2rem 1rem}
    .wc-beyond a{color:var(--brand);font-weight:700}
    .wc-hint{font-size:11px;color:var(--muted);margin-top:.5rem}
    .tk-kempty{font-size:11.5px;color:var(--muted);text-align:center;padding:1rem .5rem}
    .tk-card-t{background:none;border:none;padding:0;font:inherit;text-align:start;font-weight:700;font-size:12.5px;color:var(--ink2);line-height:1.45;cursor:pointer;display:block;width:100%}
    .tk-card-t:hover{color:var(--brand)}
    .tk-card-block{margin-top:.4rem;font-size:10.5px;color:#991b1b;background:#fef2f2;border-radius:6px;padding:.2rem .4rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cal{padding:.8rem .9rem;margin-bottom:.9rem}
    .cal-head{display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap}
    .cal-title{font-weight:800;font-size:15px;color:var(--ink2)}
    .cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));direction:rtl;gap:4px}
    .cal-dow>div{font-size:10.5px;font-weight:800;color:var(--muted);text-align:center;padding:.2rem 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cal-cell{min-height:76px;border:1px solid var(--line);border-radius:9px;padding:.28rem .3rem;background:#fff;display:flex;flex-direction:column;gap:2px;min-width:0}
    .cal-cell.cal-blank{background:#fafbfd;border-style:dashed}
    .cal-cell.on{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold)}
    .cal-d{display:flex;align-items:center;justify-content:space-between;gap:2px;font-size:11px;font-weight:700;color:var(--ink2)}
    .cal-items{display:flex;flex-direction:column;gap:2px;min-width:0}
    .cal-chip{display:block;width:100%;text-align:start;font:inherit;font-size:10.5px;line-height:1.45;color:var(--ink2);background:#f4f6fb;border:none;border-inline-start:2.5px solid var(--_c,#64748b);border-radius:4px;padding:.1rem .25rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cal-chip:hover{background:#e8edf8}
    .cal-more{font-size:9px;color:var(--muted)}
    .cal-dots{display:none;gap:2px;flex-wrap:wrap}
    .cal-dot{display:inline-block;width:6px;height:6px;border-radius:50%;flex:none}
    .cal-done{font-size:9.5px;color:var(--green);font-weight:700;margin-top:auto}
    .cal-legend{display:flex;gap:.8rem;flex-wrap:wrap;font-size:10.5px;color:var(--muted);margin-top:.6rem;align-items:center}
    .cal-legend span{display:inline-flex;align-items:center;gap:.25rem}
    .wc-tray{padding:.8rem .9rem;margin-bottom:.9rem}
    .wc-tray-h{font-weight:800;font-size:12.5px;color:var(--ink2)}
    .wc-tray-s{font-size:11px;color:var(--muted);margin:.15rem 0 .5rem}
    .wc-team{margin-bottom:1rem}
    .wc-team-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:.6rem;margin-top:.45rem}
    .wc-person{display:block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:.6rem .75rem;transition:border-color .15s,box-shadow .15s}
    .wc-person:hover{border-color:#c9d3e8;box-shadow:var(--sh-sm)}
    .wc-person.hot{border-color:#fecaca}
    .wc-person-h{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
    .wc-person-n{font-weight:800;font-size:12.5px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wc-person-f{display:flex;gap:.5rem;flex-wrap:wrap;font-size:10.5px;margin-top:.25rem}
    .wc-opps{padding:.8rem .9rem;margin-bottom:.9rem}
    .wc-opps-h{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem;flex-wrap:wrap}
    .wc-opps-t{font-weight:800;font-size:13px;color:var(--ink2)}
    .wc-opps-s{font-size:11px;color:var(--muted)}
    .wc-opps-list{margin-top:.5rem;border-top:1px solid var(--line)}
    .wc-opp{display:flex;align-items:center;gap:.6rem;padding:.45rem 0;border-bottom:1px dashed var(--line);flex-wrap:wrap}
    .wc-opp:last-child{border-bottom:none}
    .wc-opp-t{flex:1 1 190px;min-width:0;font-size:12.5px;font-weight:700;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wc-opp-c{display:block;font-size:10.5px;font-weight:400;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wc-opp-m{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;font-size:10.5px}
    .wc-opp-v{flex:none;font-size:12px;font-weight:800;color:var(--ink2);margin-inline-start:auto}
    .wc-bulk{position:fixed;bottom:14px;left:76px;right:14px;z-index:45;display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;
      background:var(--ink);color:#fff;border-radius:14px;padding:.55rem .8rem;box-shadow:0 14px 40px rgba(15,23,42,.35)}
    .wc-bulk[hidden]{display:none}
    .wc-bulk-n{font-size:12px;font-weight:700}
    .wc-bulk .input{font-size:11.5px;padding:.3rem .5rem;background:#fff;color:var(--ink2);border:none;max-width:150px;min-width:0}
    .wc-bulk-note{font-size:10px;color:rgba(255,255,255,.6);margin-inline-start:auto}
    .wc-fieldnote{font-size:10.5px;color:var(--muted);line-height:1.7}
    .wc-fieldnote[hidden]{display:none}
    .wc-fieldnote.err{color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:.4rem .55rem}
    @media(max-width:900px){
      .wc-stats{grid-template-columns:repeat(2,1fr)}
      .wc-day-r{border-inline-start:none;border-top:1px solid var(--line);padding-inline-start:0;padding-top:.7rem;flex-basis:100%}
    }
    @media(max-width:640px){
      .tk-side{margin-inline-start:0;flex-basis:100%;justify-content:flex-end}
      .tk-parent,.tk-step{max-width:150px}
      .wc-search{margin-inline-start:0;flex-basis:100%}
      .wc-search .search input{min-width:0;width:100%}
      .wc-search .search{flex:1}
      .cal-cell{min-height:52px}
      .cal-items,.cal-more{display:none}
      .cal-dots{display:flex}
      .cal-legend{font-size:9.5px}
      .wc-bulk{left:12px;right:12px;bottom:72px}
      .wc-bulk-note{display:none}
      .wc-add-row2 select,.wc-add-row2 .input{max-width:none;flex:1 1 130px}
    }
  </style>`;

  const content = view === 'board' ? boardView : view === 'calendar' ? calendarView : (listBody + beyond);
  const body = `${styles}${dayCard}${stats}${lens}
    <div class="wc-bartop">${viewSeg}${searchForm}</div>
    ${winChips}${moreChips}
    ${quickAdd}
    ${readOnly ? `<div class="alert info" style="margin-bottom:.8rem">${icon('team')}<span>عرض للاطّلاع على عمل فريقك. تعديل مهام غيرك يتطلب صلاحية إدارية على المهام — اطلبها من مدير النظام.</span></div>` : ''}
    ${who === 'team' ? teamBoard : ''}
    ${fAssignee ? `<div class="wc-beyond">تعرض مهام شخص واحد — <a href="${qp({ assignee: null })}">أعِد كل الفريق</a></div>` : ''}
    ${content}
    ${oppsBlock}
    ${bulkBar}${editorTpl}`;

  const subtitle = who === 'team'
    ? `${G.teamWork} · ${countAr(openT.length, { one: 'مهمة مفتوحة', two: 'مهمتان مفتوحتان', few: 'مهام مفتوحة', many: 'مهمة مفتوحة' })}${overdue.length ? ` · ${overdue.length} متأخرة` : ''}`
    : (todayBand.length
      ? `${countAr(todayBand.length, { one: 'مهمة على طاولتك اليوم', two: 'مهمتان على طاولتك اليوم', few: 'مهام على طاولتك اليوم', many: 'مهمة على طاولتك اليوم' })}${overdue.length ? ` · ${overdue.length} متأخرة` : ''}`
      : (openT.length ? `لا شيء مستحق اليوم · ${countAr(openT.length, { one: 'مهمة مفتوحة', two: 'مهمتان مفتوحتان', few: 'مهام مفتوحة', many: 'مهمة مفتوحة' })}` : 'لا مهام مفتوحة'));

  return layout({ user, active: 'tasks', title: who === 'team' ? G.teamWork : G.myWork, subtitle, body, scripts: ['/static/pages/tasks.js'] });
}

// ═══ حركة المال على المشروع ══════════════════════════════════════════════════════════════════
// طلب المالك بلغته: «عشان يبين الكاش إن والكاش آوت والمصروفات والتسكين على المشروع ونسبتهم حسب
// الشهر، والمصاريف إذا كانت فواتير أو الاشتراكات أو الموردين». كل رقم هنا يأتي جاهزاً من
// `projectMoney` في وحدة المالية — الشاشة لا تجمع ضلعاً ولا تشتق كلفة ولا تقدّر ما لم يُسجَّل.
//
// القاعدة التي يقوم عليها كل سطر أدناه — **الغياب والتقييد والصفر ثلاث حالات لا تتشابه**:
//   • غياب: لا تسجيل أصلاً (`recorded:false`) ⟵ «غير مُسجَّل» وجملة تقول ما الذي لم يُدخَل. لا «٠ ريال».
//   • تقييد: مسجَّل ولا يراه الدور (`permitted:false` أو `amounts_visible:false`) ⟵ «مقيَّد» وسببه.
//   • صفر: قياس حقيقي داخل شريط لا يُرسم أصلاً إلا حين يوجد تسجيل — شهرٌ بلا حركة في مشروع له حركة.
const M_YEARS_MAX = 3;   // السنة المعروضة + سنتان أخريان بحركة؛ ما زاد يُذكر نصاً لا لوحاً
const M_ROWS_MAX = 40;   // أحدث المصروفات المعروضة صفاً صفاً (التجميع حسب الوصف يغطي الباقي)

const mNo = (txt) => `<span style="color:var(--faint);font-weight:700;font-size:var(--fs-meta)">${esc(txt || G.notRecorded)}</span>`;
const mLock = (why) => `<span class="pill" style="background:#fef3c7;color:#92400e" title="${esc(why || G.restrictedAmounts)}">${G.restricted}</span>`;
const mSar = (v, color) => `<span class="tnum" style="font-weight:800${color ? `;color:${color}` : ''}">${fmtSar(v)}</span>`;
const mNum = (v, color) => `<span class="tnum" style="font-weight:800${color ? `;color:${color}` : ''}">${Math.round(Number(v) || 0)}</span>`;
const mPct = (v) => `<span class="tnum" style="font-weight:800">${Math.round(Number(v) || 0)}%</span>`;
// المبلغ: رقمٌ إن سُجِّل ورآه الدور، وإلا كلمة الغياب أو كلمة التقييد — ولا صفر مكان أيٍّ منهما.
const mAmount = (v, { locked = false, why = '', absent = '', color = '' } = {}) =>
  (v == null ? (locked ? mLock(why) : mNo(absent)) : mSar(v, color));
const mRestricted = (reason) => `<div class="alert warn"><span style="font-weight:800;flex:0 0 auto">${G.restricted}</span><span>${esc(reason || G.restrictedAmounts)}</span></div>`;
const mEmpty = (title, detail, action = '') => `<div class="empty-state" style="padding:1.15rem 1rem">${icon('inbox')}
  <div class="t">${esc(title)}</div><div class="s">${esc(detail)}</div>${action}</div>`;
const mHead = (title, sub) => `<div style="display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">
  <div style="font-weight:800;font-size:12.5px;color:var(--ink2)">${title}</div>
  ${sub ? `<div style="font-size:10.5px;color:var(--muted);flex:1;min-width:0">${sub}</div>` : ''}</div>`;
const mBlock = (inner) => `<div style="padding:.85rem 1rem;border-top:1px solid var(--line)">${inner}</div>`;
// «YYYY-MM» ⟵ «يناير 2026». ما لا شهر له يُقال عنه ذلك، ولا يُنسب إلى شهر تخميناً.
const mYm = (key) => {
  const g = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  return g ? `${MONTHS_AR[Number(g[2]) - 1] || ''} <span class="tnum">${esc(g[1])}</span>` : G.undatedRows;
};
const mMonthYear = (month, year) => (Number.isInteger(Number(month)) && Number(month) >= 1 && Number(month) <= 12
  ? `${MONTHS_AR[Number(month) - 1]}${Number.isInteger(Number(year)) ? ` <span class="tnum">${esc(String(year))}</span>` : ''}`
  : G.undatedRows);
// حالة الفاتورة بمعناها؛ وما لا تسمية له لا تُطبع قيمته المخزَّنة أبداً.
const mInvStatus = (s) => { const t = String(tr(s) ?? ''); return /^[A-Z_]+$/.test(t) || !t ? 'حالة أخرى' : t; };
const mSep = '<span aria-hidden="true" style="align-self:center;flex:0 0 auto;font-size:10px;font-weight:800;color:var(--faint)">ثم</span>';

// شريط 12 شهراً — يناير يميناً وديسمبر يساراً (النموذج الزمني الواحد للمنصة، فئة .mtrack).
// «نحن هنا» يُعلَّم على اسم الشهر بالذهبي لا بحلقة حول العمود: حلقةٌ حول عمودٍ ارتفاعه صفر
// تُقرأ خطاً ذهبياً طائراً لا مؤشراً — والسابقة المتبعة في المنصة (miniBars) تلوّن التسمية.
const mBars = (cells, { color, max }) => `<div class="mtrack" style="height:34px;gap:2px">${cells.map((c) => {
  const v = Number(c.value) || 0;
  const h = v <= 0 ? 2 : Math.max(3, Math.round((v / Math.max(1, max)) * 32));
  return `<span title="${esc(c.title)}" style="height:${h}px;border-radius:3px;background:${v > 0 ? color : '#eef1f7'}"></span>`;
}).join('')}</div>`;
const mMonthLabels = (now = -1) => `<div class="mtrack" style="gap:2px;margin-top:.3rem">${MONTHS_AR.map((_, i) =>
  `<span style="font-size:9px;line-height:1.3;text-align:center;overflow:hidden;color:${i === now ? '#a3821c' : 'var(--faint)'};font-weight:${i === now ? '800' : '400'}">${monthLabelDual(i)}</span>`).join('')}</div>`;
const mTrackRow = ({ title, sub, tone, body }) => `<div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.55rem">
  <div style="flex:0 0 130px;min-width:120px">
    <div style="display:flex;align-items:center;gap:.35rem;font-size:11.5px;font-weight:700;color:var(--ink2)">
      <span style="width:9px;height:9px;border-radius:3px;background:${tone};flex:none"></span>${title}</div>
    <div style="font-size:10.5px;color:var(--muted);line-height:1.6">${sub}</div>
  </div>
  <div style="flex:1 1 200px;min-width:0">${body}</div></div>`;
const mStage = (n, label, value, note) => `<div style="flex:1 1 134px;min-width:120px;border:1px solid var(--line);border-radius:12px;padding:.5rem .6rem;background:#fff">
  <div style="font-size:9.5px;font-weight:800;color:var(--faint)">${G.moneyStage} <span class="tnum">${n}</span> من <span class="tnum">5</span></div>
  <div style="font-size:11px;font-weight:700;color:var(--muted);margin-top:.1rem">${label}</div>
  <div style="font-size:var(--fs-num-sm);margin-top:.1rem">${value}</div>
  <div style="font-size:10px;color:var(--faint);line-height:1.6">${note || ''}</div></div>`;
// سنوات أخرى فيها حركة — تُقال بدل أن تُقرأ السنةُ المعروضة فراغاً.
const mOther = (years) => (years && years.length
  ? `<div style="font-size:10.5px;color:var(--amber);font-weight:700;margin-top:.25rem">${G.otherYearsMovement}: <span class="tnum">${years.map((y) => esc(String(y))).join('، ')}</span></div>` : '');

// ── لوح سنة واحدة: الجسر · الحركة الشهرية · الخارج النقدي · التسكين · الكلفة · ما ينقص ──
function mYearPanel(m, { active }) {
  const now = currentMonthIndex(m.year);            // -1 على سنة ليست الجارية: لا مؤشر «نحن هنا»
  const b = m.bridge;
  const yr = `<span class="tnum">${esc(String(m.year))}</span>`;
  const billLock = b.permitted === false;

  // ① الجسر: خمس مراحل متتابعة لا تُجمع — الترتيب والفواصل والملاحظة تمنع قراءتها مجموعاً.
  const revNote = b.revenue.permitted === false ? esc(b.revenue.reason_ar || '')
    : b.revenue.in_year_halalas != null ? `منها في ${yr}: <span class="tnum">${fmtSar(b.revenue.in_year_halalas)}</span>` : '';
  const invNote = [b.draft_invoiced_halalas != null ? `${G.draftInvoices}: <span class="tnum">${fmtSar(b.draft_invoiced_halalas)}</span>` : '',
    b.retention_halalas != null ? `${G.retentionHeld}: <span class="tnum">${fmtSar(b.retention_halalas)}</span>` : ''].filter(Boolean).join(' · ');
  const stages = [
    mStage(1, G.contracted, mAmount(b.contract_halalas, { absent: G.notRecordedF }),
      b.client_po_halalas != null ? `${G.clientPo}: <span class="tnum">${fmtSar(b.client_po_halalas)}</span>` : 'قيمة الاتفاق مع العميل'),
    mStage(2, G.revenueRecognised,
      b.revenue.permitted === false ? mLock(b.revenue.reason_ar) : mAmount(b.revenue.total_halalas), revNote),
    mStage(3, G.invoiced, mAmount(b.invoiced_halalas, { locked: billLock, why: b.reason_ar, absent: 'لا فواتير صادرة' }),
      invNote || 'ما صدرت به فاتورة للعميل'),
    mStage(4, G.collected, mAmount(b.collected_halalas, { locked: billLock, why: b.reason_ar, absent: 'لم يُسجَّل تحصيل', color: 'var(--green)' }),
      'نقدٌ دخل فعلاً — وهو وحده الداخل النقدي'),
    mStage(5, G.outstanding, mAmount(b.outstanding_halalas, { locked: billLock, why: b.reason_ar, absent: 'لا مستحق محسوب', color: 'var(--amber)' }),
      'المفوتر ناقص المحتجز ناقص المحصَّل'),
  ].join(mSep);
  const statusPills = (b.by_status || []).length
    ? `<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">${b.by_status.map((s) => `<span class="pill" style="background:#f1f5f9;color:#475569"
        title="${esc(mInvStatus(s.status))}: ${esc(fmtSar(s.amount_halalas))}">${esc(mInvStatus(s.status))} <b class="tnum">${Math.round(Number(s.count) || 0)}</b></span>`).join('')}</div>` : '';
  const bridgeBlock = mBlock(`${mHead(`${G.moneyBridge} — ${G.moneyStage}ٌ بعد أخرى`, 'خمس مراحل متتابعة، كلٌّ من جدولها')}
    <div style="display:flex;gap:.35rem;flex-wrap:wrap;align-items:stretch">${stages}</div>
    ${statusPills}
    <div class="alert info" style="margin-top:.55rem;font-size:11px">${esc(b.note_ar)}</div>
    ${billLock ? `<div style="margin-top:.5rem">${mRestricted(b.reason_ar)}</div>` : ''}`);

  // ② الحركة الشهرية: المفوتر بجوار المحصَّل عمداً — الرقمان ليسا رقماً واحداً.
  const invM = b.invoiced_monthly; const colM = m.cashIn.monthly;
  const paid = m.cashOut.paid; const paidM = paid ? paid.monthly : null;
  const amountsHidden = m.cashOut.permitted === true && m.cashOut.amounts_visible === false;
  const amtsOf = (rows) => (rows || []).map((r) => Number(r.amount_halalas) || 0);
  const max = Math.max(1, ...amtsOf(invM), ...amtsOf(colM), ...(amountsHidden ? [] : amtsOf(paidM)));
  const cells = (rows, key) => rows.map((r, i) => {
    const v = Number(r[key]) || 0;
    const unit = key === 'count' ? `${Math.round(v)} حركة` : fmtSar(v);
    return { value: v, title: `${MONTHS_AR[i]} ${m.year}: ${v > 0 ? unit : 'لا حركة مسجّلة'}` };
  });
  const invTotal = invM ? invM.reduce((a, r) => a + (Number(r.amount_halalas) || 0), 0) : null;
  const rowInvoiced = mTrackRow({ title: G.invoiced, tone: '#834798',
    sub: billLock ? '' : invM ? `في ${yr}: <span class="tnum">${fmtSar(invTotal)}</span>` : '',
    body: billLock ? mLock(b.reason_ar) : invM ? mBars(cells(invM, 'amount_halalas'), { color: '#834798', max })
      : mNo('لا فواتير صادرة على هذا المشروع') });
  const rowCollected = mTrackRow({ title: `${G.collected} — ${G.cashIn}`, tone: 'var(--green)',
    sub: m.cashIn.permitted === false ? '' : m.cashIn.in_year_halalas != null ? `في ${yr}: <span class="tnum">${fmtSar(m.cashIn.in_year_halalas)}</span>` : '',
    // سنةٌ بلا تحصيل في مشروعٍ له تحصيل مسجَّل تُقرأ صفراً حقيقياً — فتُذكر سنواتُ الحركة معها
    // كي لا يُقرأ اللوحُ فارغاً، ويُعرف أن الحركة في سنة أخرى لا أن التحصيل معدوم.
    body: m.cashIn.permitted === false ? mLock(m.cashIn.reason_ar)
      : `${colM ? mBars(cells(colM, 'amount_halalas'), { color: 'var(--green)', max })
        : mNo('لم يُسجَّل أي تحصيل على فواتير هذا المشروع')}${mOther(m.cashIn.other_years)}` });
  const outMax = amountsHidden && paidM ? Math.max(1, ...paidM.map((r) => Number(r.count) || 0)) : max;
  const rowPaid = mTrackRow({ title: `${G.paidOut} — ${G.cashOut}`, tone: '#b45309',
    sub: m.cashOut.permitted === false ? ''
      : paid && paid.in_year_halalas != null ? `في ${yr}: <span class="tnum">${fmtSar(paid.in_year_halalas)}</span>`
        : paid && amountsHidden ? `في ${yr}: <span class="tnum">${Math.round(paid.in_year_count || 0)}</span> حركة` : '',
    body: m.cashOut.permitted === false ? mLock(m.cashOut.reason_ar)
      : `${paidM ? mBars(cells(paidM, amountsHidden ? 'count' : 'amount_halalas'), { color: '#b45309', max: outMax })
        : m.cashOut.recorded ? mNo('المسجَّل من المصروفات لم يُصرف بعد') : mNo('لا مصروفات مسجّلة على هذا المشروع')}${mOther(m.cashOut.other_years)}` });
  const undated = [
    m.cashIn.undated ? `تحصيلات ${G.undatedRows}: <span class="tnum">${Math.round(m.cashIn.undated.count)}</span> بمبلغ <span class="tnum">${fmtSar(m.cashIn.undated.amount_halalas)}</span>` : '',
    paid && paid.undated ? `مصروفات مدفوعة ${G.undatedRows}: <span class="tnum">${Math.round(paid.undated.count)}</span>${paid.undated.amount_halalas != null ? ` بمبلغ <span class="tnum">${fmtSar(paid.undated.amount_halalas)}</span>` : ''}` : '',
  ].filter(Boolean);
  const movement = mBlock(`${mHead(`${G.monthlyMovement} في سنة ${m.year}`, 'المفوتر بجوار المحصَّل عمداً: ما صدرت به فاتورة شيء، وما دخل الحساب شيء آخر')}
    ${rowInvoiced}${rowCollected}${rowPaid}${mMonthLabels(now)}
    ${amountsHidden ? `<div style="font-size:10.5px;color:var(--amber);font-weight:700;margin-top:.4rem">${esc(m.cashOut.amounts_reason_ar || G.restrictedAmounts)} — أعمدة الخارج النقدي تمثل عدد الحركات لا مبالغها.</div>` : ''}
    ${undated.length ? `<div style="font-size:10.5px;color:var(--muted);margin-top:.4rem">${undated.join(' · ')} — محسوبة في المجموع وخارج الشريط الشهري حتى يُسجَّل تاريخها.</div>` : ''}
    <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.55rem">
      <button type="button" class="btn btn-sm" data-action="money-dd" data-dd="money-months-${esc(String(m.year))}">${icon('list')} ${G.monthDetails}</button>
      <span style="font-size:10.5px;color:var(--faint)">${esc(m.cashIn.note_ar)}</span>
    </div>`);

  // نافذة تفصيل الأشهر: الأرقام الثلاثة صفاً لكل شهر (خادميّة بالكامل، بنفس صلاحية الصفحة).
  const ddRowsHtml = MONTHS_AR.map((mn, i) => `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:.4rem .6rem;font-size:12px">${mn}${i === now ? ` ${nowDot('الشهر الحالي')}` : ''}</td>
      <td style="padding:.4rem .6rem;text-align:center;font-size:12px">${billLock ? mLock(b.reason_ar) : invM ? `<span class="tnum">${fmtSar(invM[i].amount_halalas)}</span>` : mNo()}</td>
      <td style="padding:.4rem .6rem;text-align:center;font-size:12px">${m.cashIn.permitted === false ? mLock(m.cashIn.reason_ar) : colM ? `<span class="tnum">${fmtSar(colM[i].amount_halalas)}</span>` : mNo()}</td>
      <td style="padding:.4rem .6rem;text-align:center;font-size:12px">${m.cashOut.permitted === false ? mLock(m.cashOut.reason_ar)
    : paidM ? (paidM[i].amount_halalas != null ? `<span class="tnum">${fmtSar(paidM[i].amount_halalas)}</span>` : `<span class="tnum">${Math.round(paidM[i].count || 0)}</span> حركة`) : mNo()}</td>
    </tr>`).join('');
  const ddTpl = `<template id="dd-money-months-${esc(String(m.year))}">
    <div class="modal-head"><div><div style="font-weight:800;font-size:15px">${G.monthlyMovement} — سنة ${esc(String(m.year))}</div>
      <div style="font-size:11.5px;color:var(--muted)">${esc(m.project.name_ar)}</div></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="money-close" aria-label="إغلاق">✕</button></div>
    <div class="modal-body"><div class="tblwrap"><table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:10.5px;color:var(--muted);text-align:right">
        <th style="padding:.35rem .6rem">الشهر</th><th style="padding:.35rem .6rem;text-align:center">${G.invoiced}</th>
        <th style="padding:.35rem .6rem;text-align:center">${G.collected}</th><th style="padding:.35rem .6rem;text-align:center">${G.paidOut}</th></tr></thead>
      <tbody>${ddRowsHtml}</tbody></table></div>
      <div style="font-size:11px;color:var(--muted);margin-top:.6rem;line-height:1.9">${esc(b.note_ar)}</div></div></template>`;

  // ③ الخارج النقدي: المدفوع وحده نقد، والباقي التزامات وطلبات بجانبه لا داخله.
  const co = m.cashOut;
  const coCell = (label, count, amount, color) => `<div style="flex:1 1 132px;min-width:120px;border:1px solid var(--line);border-radius:12px;padding:.5rem .6rem">
    <div style="font-size:11px;color:var(--muted);font-weight:700">${label}</div>
    <div style="font-size:var(--fs-num-sm)">${amount === undefined ? mNum(count, color)
    : amount != null ? mSar(amount, color) : (co.amounts_visible === false ? mLock(co.amounts_reason_ar) : mNo())}</div>
    <div style="font-size:10px;color:var(--faint)"><span class="tnum">${Math.round(Number(count) || 0)}</span> حركة مسجّلة</div></div>`;
  const cashOutBlock = mBlock(co.permitted === false ? `${mHead(G.cashOut)}${mRestricted(co.reason_ar)}`
    : `${mHead(G.cashOut, esc(co.note_ar))}
      ${co.recorded ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap">
        ${coCell(G.paidOut, co.paid.count, co.paid.total_halalas, 'var(--ink2)')}
        ${coCell(G.committedNotPaid, co.committed.count, co.committed.total_halalas, 'var(--amber)')}
        ${coCell(G.requestedNotApproved, co.requested.count, co.requested.total_halalas, 'var(--muted)')}
        ${coCell(G.rejectedExpenses, co.rejected.count, undefined, 'var(--faint)')}
      </div>
      <div style="font-size:10.5px;color:var(--faint);margin-top:.5rem">${esc(co.sources_ar)}</div>`
    : mEmpty(G.notRecorded + ' — لا خارج نقدي على هذا المشروع', m.expenses.empty_ar,
      `<a href="#money-expenses" style="font-size:12px;color:var(--brand2);font-weight:700">${G.addExpense} من سجل المصروفات ↓</a>`)}`);

  // ④ التسكين بالنسب الشهرية — النسبة حصة الشخص من شهر عمل كامل على هذا المشروع.
  const st = m.staffing;
  const shareCell = (v, mn) => {
    const pctv = Math.max(0, Math.round(Number(v) || 0));
    const op = pctv <= 0 ? 0 : Math.max(0.16, Math.min(1, pctv / 100));
    return `<span title="${esc(mn)}: ${pctv}%" style="height:14px;border-radius:3px;background:${pctv > 0 ? `rgba(36,74,153,${op.toFixed(2)})` : '#eef1f7'}"></span>`;
  };
  const shareStrip = (months) => `<div class="mtrack" style="gap:2px">${months.map((v, i) => shareCell(v, MONTHS_AR[i])).join('')}</div>`;
  const staffRowsM = (st.people || []).map((e) => `<tr style="border-bottom:1px solid var(--line)">
      <td data-label="الشخص" style="padding:.4rem .7rem;font-size:12.5px">${esc(e.name)}
        <div style="font-size:10px;color:var(--muted)">${esc(e.job_title || 'المسمى غير مسجَّل')}</div></td>
      <td data-label="${G.monthsStaffed}" style="padding:.4rem .7rem;text-align:center">${mNum(e.months_staffed)}</td>
      <td data-label="${G.peak}" style="padding:.4rem .7rem;text-align:center">${mPct(e.peak_pct)}</td>
      <td data-label="${G.averageShare}" style="padding:.4rem .7rem;text-align:center">${mPct(e.average_pct)}</td>
      <td data-label="${G.yearShare}" class="rtbl-hm" style="padding:.4rem .7rem;text-align:center">${mPct(e.year_share_pct)}</td>
      <td data-label="${G.allMonths}" style="padding:.4rem .7rem;min-width:150px">${shareStrip(e.monthly)}</td></tr>`).join('');
  const staffingBlock = mBlock(`${mHead(`${G.staffingShare} في سنة ${m.year}`, esc(st.note_ar))}
    ${st.recorded ? `<div class="tblwrap"><table class="rtbl" style="width:100%;border-collapse:collapse;min-width:520px">
        <thead><tr style="font-size:10.5px;color:var(--muted);text-align:right">
          <th style="padding:.35rem .7rem">الشخص</th><th style="padding:.35rem .7rem;text-align:center">${G.monthsStaffed}</th>
          <th style="padding:.35rem .7rem;text-align:center">${G.peak}</th><th style="padding:.35rem .7rem;text-align:center">${G.averageShare}</th>
          <th style="padding:.35rem .7rem;text-align:center">${G.yearShare}</th>
          <th style="padding:.35rem .7rem;text-align:center">${G.allMonths}${mMonthLabels(now)}</th></tr></thead>
        <tbody>${staffRowsM}</tbody></table></div>
      <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:.55rem">
        <div style="flex:0 0 130px;font-size:11.5px;font-weight:700;color:var(--ink2)">${G.monthlyTotalShare}</div>
        <div style="flex:1 1 200px;min-width:0">${shareStrip((st.monthly_total_pct || []).map((v) => Math.min(100, v)))}
          <div style="font-size:10px;color:var(--faint);margin-top:.2rem">${(st.monthly_total_pct || []).map((v, i) => (v > 0 ? `${MONTHS_AR[i]} <span class="tnum">${Math.round(v)}%</span>` : '')).filter(Boolean).join(' · ') || 'لا نِسَب مسجّلة في أشهر هذه السنة'}</div></div>
      </div>
      <div style="font-size:10.5px;color:var(--muted);margin-top:.35rem">${esc(st.total_note_ar)}</div>`
    : mEmpty(st.empty_ar, st.other_years && st.other_years.length
      ? `للمشروع تسكين مسجَّل في سنوات أخرى — بدّل سنة العرض أعلاه لرؤيته.`
      : 'لم يُسكَّن أحد على هذا المشروع في أي سنة. التسكين يُسجَّل من شاشة التسكين.',
    `<a href="/app/staffing" style="font-size:12px;color:var(--brand2);font-weight:700">فتح شاشة التسكين</a>`)}
    ${mOther(st.other_years)}
    <div class="alert warn" style="margin-top:.5rem;font-size:11px"><span style="font-weight:800;flex:0 0 auto">${G.staffingCostLine}</span><span>${esc(st.cost.reason_ar)}</span></div>
    ${st.undated_count ? `<div style="font-size:10.5px;color:var(--muted);margin-top:.35rem">تسكين بلا سنة مسجَّلة: <span class="tnum">${Math.round(st.undated_count)}</span> — لا يظهر على أي شريط شهري حتى تُسجَّل سنته.</div>` : ''}`);

  // ⑤ الكلفة المسجَّلة: اعترافٌ بكلفة لا حركة صرف — تبقى خارج الخارج النقدي عمداً.
  const c = m.cost;
  const costBlock = mBlock(c.permitted === false ? `${mHead(G.recordedCost)}${mRestricted(c.reason_ar)}`
    : `${mHead(G.recordedCost, esc(c.note_ar))}
      ${c.recorded ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:stretch">
          <div style="flex:1 1 150px;min-width:130px;border:1px solid var(--line);border-radius:12px;padding:.5rem .6rem">
            <div style="font-size:11px;color:var(--muted);font-weight:700">منذ بداية المشروع</div><div style="font-size:var(--fs-num-sm)">${mSar(c.total_halalas)}</div></div>
          <div style="flex:1 1 150px;min-width:130px;border:1px solid var(--line);border-radius:12px;padding:.5rem .6rem">
            <div style="font-size:11px;color:var(--muted);font-weight:700">في سنة ${esc(String(m.year))}</div><div style="font-size:var(--fs-num-sm)">${mSar(c.in_year_halalas)}</div></div>
          ${c.project_actual_spend_halalas != null ? `<div style="flex:1 1 150px;min-width:130px;border:1px solid var(--line);border-radius:12px;padding:.5rem .6rem">
            <div style="font-size:11px;color:var(--muted);font-weight:700">${G.actualSpendField}</div><div style="font-size:var(--fs-num-sm)">${mSar(c.project_actual_spend_halalas)}</div>
            <div style="font-size:10px;color:var(--faint)">خانة مستقلة على صف المشروع — لا تُجمع إلى بنود الكلفة</div></div>` : ''}
        </div>
        ${(c.by_type || []).length ? `<div style="margin-top:.5rem;border:1px solid var(--line);border-radius:12px;padding:.15rem .7rem">
          ${c.by_type.slice(0, 6).map((t) => `<div class="dd-row">
            <span>${esc(t.type || 'بلا وصف مسجَّل')} · <span class="tnum">${Math.round(t.count)}</span> بند</span><b>${fmtSar(t.total_halalas)}</b></div>`).join('')}</div>` : ''}`
    : mEmpty(c.empty_ar, 'بنود الكلفة تصل من الترحيل أو من المالية — غيابها لا يعني أن الكلفة صفر.')}`);

  // ⑥ ما ينقص الصورة: يُقال صراحةً بدل أن يُقرأ صفراً
  const gapsBlock = mBlock(`${mHead(G.whatIsMissing, 'ما لم يُسجَّل بعد — يُقال هنا كي لا يُقرأ صفراً في مكان آخر')}
    ${(m.gaps || []).length ? `<div style="display:grid;gap:.4rem">${m.gaps.map((g) => `<div class="attn">
        <span class="ic" style="background:#fffbeb;color:#b45309">${icon('flag')}</span>
        <span class="tx"><span class="h">${esc(g.title_ar)}</span><span class="s">${esc(g.detail_ar)}</span></span></div>`).join('')}</div>`
    : `<div class="alert ok">${G.pictureComplete}</div>`}`);

  return `<div class="money-panel" data-money-year="${esc(String(m.year))}"${active ? '' : ' hidden'}>
    ${bridgeBlock}${movement}${cashOutBlock}${staffingBlock}${costBlock}${gapsBlock}${ddTpl}</div>`;
}

// ── سجل المصروفات: قائمة وتجميع حسب الوصف وتسجيل وتعديل وحذف — كلٌّ خلف ما تسمح به الخدمة ──
// السجل نفسه غير مسنَّن (يعرض كل ما سُجِّل بأي سنة)، فيُقال ذلك في عنوانه بدل أن يُظن سنوياً.
function mExpensesBlock(m, { projectId, years, defaultYear }) {
  const ex = m.expenses;
  if (ex.permitted === false) return mBlock(`${mHead(G.expenseRegister)}${mRestricted(ex.reason_ar)}`);
  const hidden = ex.amounts_visible === false;
  const amt = (v) => (v == null ? (hidden ? mLock(m.cashOut.amounts_reason_ar) : mNo()) : mSar(v));
  const canEdit = ex.can_add === true;      // منح الإنشاء والتعديل يسيران معاً في مصفوفة الصلاحيات
  const canApprove = ex.can_approve === true;
  const periodOpts = (sel) => years.flatMap((y) => MONTHS_AR.map((mn, i) => {
    const v = `${y}-${String(i + 1).padStart(2, '0')}`;
    return `<option value="${v}"${v === sel ? ' selected' : ''}>${mn} ${y}</option>`;
  })).join('');
  const nowM = new Date().getUTCMonth() + 1;
  const defSel = `${years.includes(defaultYear) ? defaultYear : years[years.length - 1]}-${String(nowM).padStart(2, '0')}`;
  const statusOpts = (list, sel) => list.map((s) => `<option value="${s}"${s === sel ? ' selected' : ''}>${EXPENSE_STATUS_AR[s]}</option>`).join('');

  const typeRows = (ex.by_type || []).map((t) => `<tr style="border-bottom:1px solid var(--line)">
      <td data-label="${G.expenseDesc}" style="padding:.4rem .7rem;font-size:12.5px">${esc(t.type || 'بلا وصف مسجَّل')}
        <div style="font-size:10px;color:var(--muted)">${t.statuses.map((s) => esc(s.status_ar)).join(' · ')}</div></td>
      <td data-label="عدد المصروفات" style="padding:.4rem .7rem;text-align:center">${mNum(t.count)}</td>
      <td data-label="عدد الأشهر" style="padding:.4rem .7rem;text-align:center">${mNum(t.months)}</td>
      <td data-label="من أول شهر إلى آخره" class="rtbl-hm" style="padding:.4rem .7rem;text-align:center;font-size:11.5px">${t.first_month ? `${mYm(t.first_month)}${t.last_month && t.last_month !== t.first_month ? ` ← ${mYm(t.last_month)}` : ''}` : G.undatedRows}</td>
      <td data-label="المجموع" style="padding:.4rem .7rem;text-align:center">${amt(t.total_halalas)}</td></tr>`).join('');

  const rows = (ex.rows || []).slice(0, M_ROWS_MAX);
  const rowHtml = rows.map((r) => {
    const settled = SETTLED_STATUSES.includes(String(r.status).toUpperCase());
    const editable = canEdit && !settled;
    const deletable = canEdit && !['APPROVED', 'PAID'].includes(String(r.status).toUpperCase());
    const per = Number.isInteger(Number(r.month)) && Number.isInteger(Number(r.year))
      ? `${r.year}-${String(r.month).padStart(2, '0')}` : '';
    const view = `<tr data-exp-row="${esc(r.id)}" style="border-bottom:1px solid var(--line)">
      <td data-label="${G.expenseDesc}" style="padding:.4rem .7rem;font-size:12.5px">${esc(r.type || 'بلا وصف مسجَّل')}
        <div style="font-size:10px;color:var(--muted)">${G.expenseWho}: ${esc(r.requested_by_name || 'غير مسجَّل')}</div></td>
      <td data-label="${G.expenseMonth}" style="padding:.4rem .7rem;text-align:center;font-size:11.5px">${mMonthYear(r.month, r.year)}</td>
      <td data-label="${G.expenseAmount}" style="padding:.4rem .7rem;text-align:center">${r.amount_restricted ? mLock(m.cashOut.amounts_reason_ar) : amt(r.amount_halalas)}</td>
      <td data-label="حالة المصروف" style="padding:.4rem .7rem;text-align:center">${canApprove
      ? `<select class="input" style="font-size:11px;padding:.2rem .3rem;width:auto" aria-label="حالة المصروف"
            data-action-change="exp-status" data-id="${esc(r.id)}">${statusOpts(Object.keys(EXPENSE_STATUS_AR), String(r.status).toUpperCase())}</select>`
      : pill(esc(r.status_ar), r.status === 'PAID' ? 'green' : r.status === 'APPROVED' ? 'blue' : r.status === 'REJECTED' ? 'red' : 'slate')}</td>
      <td data-label="إجراء" style="padding:.4rem .7rem;text-align:center;white-space:nowrap">
        ${editable ? `<button type="button" class="btn btn-ghost btn-sm" data-action="exp-edit" data-id="${esc(r.id)}" title="${G.edit}" aria-label="${G.edit}">${icon('edit')}</button>` : ''}
        ${deletable ? `<button type="button" class="btn btn-ghost btn-sm" data-action="exp-del" data-id="${esc(r.id)}" title="${G.delete}" aria-label="${G.delete}">✕</button>` : ''}
        ${!editable && canEdit && settled ? `<span style="font-size:10px;color:var(--faint)">بعد الحسم لا تُعدَّل بياناته</span>` : ''}</td></tr>`;
    const edit = editable ? `<tr data-exp-edit="${esc(r.id)}" hidden style="border-bottom:1px solid var(--line);background:#f8fafc">
      <td colspan="5" style="padding:.5rem .7rem">
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
          <input class="input" data-f="type" value="${esc(r.type || '')}" aria-label="${G.expenseDesc}" style="flex:1;min-width:130px;font-size:12px">
          <input class="input" data-f="amount" type="number" min="0" step="1" dir="ltr" value="${r.amount_halalas != null ? Math.round(r.amount_halalas) / 100 : ''}" aria-label="${G.expenseAmount}" style="width:110px;font-size:12px">
          <select class="input" data-f="period" aria-label="${G.expenseMonth}" style="width:auto;max-width:150px;font-size:12px">${periodOpts(per)}</select>
          <button type="button" class="btn btn-sm btn-primary" data-action="exp-save" data-id="${esc(r.id)}">${G.saveExpense}</button>
          <button type="button" class="btn btn-sm" data-action="exp-cancel" data-id="${esc(r.id)}">${G.cancel}</button>
        </div></td></tr>` : '';
    return view + edit;
  }).join('');

  const addBar = ex.can_add ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;padding:.6rem .75rem;border-top:1px dashed var(--line);background:var(--bg)">
      <input class="input" id="m-exp-type" list="m-exp-types" placeholder="${G.expenseDesc}…" aria-label="${G.expenseDesc}" style="flex:1;min-width:140px;font-size:12.5px">
      <datalist id="m-exp-types">${(ex.type_suggestions || []).map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>
      <input class="input" id="m-exp-amount" type="number" min="0" step="1" dir="ltr" placeholder="${G.expenseAmount}" aria-label="${G.expenseAmount}" style="width:120px;font-size:12.5px">
      <select class="input" id="m-exp-period" aria-label="${G.expenseMonth}" style="width:auto;max-width:160px;font-size:12px">${periodOpts(defSel)}</select>
      <select class="input" id="m-exp-status" aria-label="حالة المصروف عند التسجيل" style="width:auto;font-size:12px">${statusOpts(OPEN_STATUSES, 'DRAFT')}</select>
      <button type="button" class="btn btn-sm btn-primary" data-action="exp-add" data-project="${esc(projectId)}">${icon('plus')} ${G.addExpense}</button>
    </div>` : '';

  // العدد يُذكر حين يوجد تسجيل؛ ولا يُكتب «٠» فوق سجل فارغ — الفراغ له جملته لا رقمه.
  return mBlock(`${mHead(`${G.expenseRegister}${ex.recorded ? ` (<span class="tnum">${Math.round(ex.count || 0)}</span>)` : ''}`,
    `${esc(ex.note_ar)} — السجل يعرض كل ما سُجِّل في كل السنوات، والشريط الشهري أعلاه للسنة المعروضة وحدها`)}
    <div id="money-expenses"></div>
    ${hidden ? `<div style="margin-bottom:.5rem">${mRestricted(m.cashOut.amounts_reason_ar)}</div>` : ''}
    ${ex.recorded ? `
      <div style="font-size:11px;font-weight:800;color:var(--muted);margin:.2rem 0 .3rem">${G.expenseByType}</div>
      <div class="tblwrap"><table class="rtbl" style="width:100%;border-collapse:collapse;min-width:480px">
        <thead><tr style="font-size:10.5px;color:var(--muted);text-align:right">
          <th style="padding:.35rem .7rem">${G.expenseDesc}</th><th style="padding:.35rem .7rem;text-align:center">عدد المصروفات</th>
          <th style="padding:.35rem .7rem;text-align:center">عدد الأشهر</th><th style="padding:.35rem .7rem;text-align:center">من أول شهر إلى آخره</th>
          <th style="padding:.35rem .7rem;text-align:center">المجموع</th></tr></thead><tbody>${typeRows}</tbody></table></div>
      <div style="font-size:11px;font-weight:800;color:var(--muted);margin:.7rem 0 .3rem">أحدث المصروفات المسجّلة</div>
      <div class="tblwrap" style="max-height:340px;overflow-y:auto"><table class="rtbl" style="width:100%;border-collapse:collapse;min-width:520px">
        <thead><tr style="font-size:10.5px;color:var(--muted);text-align:right">
          <th style="padding:.35rem .7rem">${G.expenseDesc}</th><th style="padding:.35rem .7rem;text-align:center">${G.expenseMonth}</th>
          <th style="padding:.35rem .7rem;text-align:center">${G.expenseAmount}</th><th style="padding:.35rem .7rem;text-align:center">حالة المصروف</th>
          <th style="padding:.35rem .7rem;text-align:center">إجراء</th></tr></thead><tbody>${rowHtml}</tbody></table></div>
      ${ex.count > rows.length ? `<div style="font-size:10.5px;color:var(--faint);margin-top:.35rem">يُعرض أحدث <span class="tnum">${rows.length}</span> مصروفاً من <span class="tnum">${Math.round(ex.count)}</span> مسجَّلاً — والتجميع حسب الوصف أعلاه يشمل كل المسجَّل.</div>` : ''}
      ${ex.undated_count ? `<div style="font-size:10.5px;color:var(--amber);font-weight:700;margin-top:.35rem">مصروفات ${G.undatedRows}: <span class="tnum">${Math.round(ex.undated_count)}</span> — لا تظهر على الشريط الشهري حتى يُسجَّل شهر صرفها.</div>` : ''}`
    : mEmpty(G.notRecorded + ' — لا مصروفات على هذا المشروع', ex.empty_ar,
      ex.can_add ? '<div class="s" style="color:var(--brand2);font-weight:700">سجّل أول مصروف من الشريط أدناه</div>' : '<div class="s">تسجيل المصروفات يتم من المالية أو قيادة القطاع.</div>')}
    ${addBar}`);
}

// ── الموردون والاشتراكات والمتكرر: ما لا مسار لتسجيله يُقال صراحةً، ولا يُخترع له رقم ──
function mGapCard(title, state, note, needs, workaround, extra = '') {
  return `<div style="flex:1 1 260px;min-width:0;border:1px solid var(--line);border-radius:12px;padding:.65rem .75rem;background:#fff">
    <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.35rem">
      <span style="font-weight:800;font-size:12.5px">${title}</span>${pill(state, 'amber')}</div>
    <div style="font-size:11px;color:var(--muted);line-height:1.9">${esc(note)}</div>
    ${extra}
    ${needs && needs.length ? `<div style="font-size:10.5px;font-weight:800;color:var(--ink2);margin-top:.5rem">${G.whatItNeeds}</div>
      <ul style="margin:.2rem 0 0;padding-inline-start:1.1rem;list-style:disc;font-size:11px;color:var(--muted);line-height:1.9">
        ${needs.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${workaround ? `<div class="alert info" style="margin-top:.5rem;font-size:11px"><span style="font-weight:800;flex:0 0 auto">${G.workaroundNow}</span><span>${esc(workaround)}</span></div>` : ''}</div>`;
}

function mSourcesBlock(m) {
  const s = m.suppliers; const sub = m.subscriptions; const rec = m.recurring;
  const supExtra = s.permitted === false ? `<div style="margin-top:.45rem">${mRestricted(s.reason_ar)}</div>`
    : s.recorded ? `<div style="margin-top:.45rem">${(s.rows || []).slice(0, 6).map((r) => `<div class="dd-row">
        <span>${esc(r.supplier_name || 'مورد غير مسمّى')}${r.code ? ` · ${esc(r.code)}` : ''}</span>
        <b>${r.amount_halalas != null ? fmtSar(r.amount_halalas) : ''}</b></div>`).join('')}</div>`
      : `<div style="font-size:11px;color:var(--faint);margin-top:.45rem">${esc(s.empty_ar)}</div>`;
  const recBody = rec.permitted === false ? mRestricted('سجل المصروفات خارج صلاحيات دورك، ومنه يُقرأ ما تكرر.')
    : rec.recorded ? `<div style="margin-top:.45rem">${rec.rows.map((t) => `<div class="dd-row">
        <span>${esc(t.type || 'بلا وصف مسجَّل')} · <span class="tnum">${Math.round(t.months)}</span> أشهر · ${mYm(t.first_month)} ← ${mYm(t.last_month)}</span>
        <b>${t.total_halalas != null ? fmtSar(t.total_halalas) : ''}</b></div>`).join('')}</div>`
      : `<div style="font-size:11px;color:var(--faint);margin-top:.45rem">${esc(rec.empty_ar)}</div>`;
  return mBlock(`${mHead('من أين يخرج المال: موردون · اشتراكات · متكرر', 'ما لا مسار لتسجيله في المنصة يُقال هنا صراحةً — وغيابه ليس صفراً')}
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:stretch">
      ${mGapCard(G.suppliers, G.noWritePathYet, s.note_ar, s.needs_ar, s.workaround_ar, supExtra)}
      ${mGapCard(G.subscriptions, G.notTrackedYet, sub.note_ar, sub.needs_ar, sub.workaround_ar)}
      ${mGapCard(G.recurringExpenses, 'وصفٌ للمسجَّل', rec.note_ar, null, null, recBody)}
    </div>`);
}

// ── القسم كاملاً: يُبنى على الخادم لكل سنة فيها حركة، والتبديل بينها في المتصفح بلا طلب جديد ──
export async function projectMoneySection(user, project, opts = {}) {
  let primary;
  try {
    primary = await projectMoney(user, project.id, { year: opts.year });
  } catch (e) {
    const why = e && e.status && e.status < 500 ? e.message : 'تعذّر تجهيز الأرقام الآن. حدّث الصفحة، وإن تكرر فأبلغ مدير النظام.';
    return card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">${G.moneyOnProject}</div>
      ${mEmpty(G.moneyLoadFailed, why)}`, 'money-section');
  }
  const others = [...new Set([...(primary.cashIn.other_years || []), ...(primary.cashOut.other_years || []),
    ...(primary.staffing.other_years || [])])].filter((y) => y !== primary.year).sort((a, b) => b - a);
  const shown = others.slice(0, M_YEARS_MAX - 1);
  const extra = [];
  for (const y of shown) {
    try { extra.push(await projectMoney(user, project.id, { year: y })); } catch { /* سنة تعذّرت قراءتها لا تُسقط القسم */ }
  }
  const panels = [primary, ...extra].sort((a, b) => b.year - a.year);
  const chips = panels.length > 1
    ? `<div class="chips" style="margin:0" role="group" aria-label="${G.showYear}"><span class="lbl">${G.showYear}</span>
      ${panels.map((p) => `<button type="button" class="chip${p.year === primary.year ? ' on' : ''}" style="font-family:inherit"
        data-action="money-year" data-year="${esc(String(p.year))}" aria-pressed="${p.year === primary.year}">سنة <span class="tnum">${esc(String(p.year))}</span></button>`).join('')}</div>`
    : `<span class="pill" style="background:#f1f5f9;color:#475569">${G.showYear}: <span class="tnum">${esc(String(primary.year))}</span></span>`;
  // سنوات المصروف في نموذج التسجيل: من بداية المشروع إلى نهايته، وتشمل السنة الجارية دائماً.
  const cy = new Date().getUTCFullYear();
  const sy = Number(String(project.start_date || '').slice(0, 4));
  const ey = Number(String(project.end_date || '').slice(0, 4));
  const from = Math.min(Number.isFinite(sy) && sy > 2000 ? sy : cy, cy, primary.year);
  const to = Math.max(Number.isFinite(ey) && ey > 2000 ? ey : cy, cy, primary.year);
  const years = []; for (let y = from; y <= to; y++) years.push(y);

  return card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
      <span style="color:var(--brand);display:flex">${icon('money')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:13px">${G.moneyOnProject}</div>
        <div style="font-size:10.5px;color:var(--muted)">${G.moneyOnProjectSub}</div>
      </div>${chips}</div>
    ${panels.map((p) => mYearPanel(p, { active: p.year === primary.year })).join('')}
    ${mExpensesBlock(primary, { projectId: project.id, years, defaultYear: primary.year })}
    ${mSourcesBlock(primary)}`, 'money-section');
}

export async function projectDetailPage(user, projectId, opts = {}) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('المشروع غير موجود', 'ربما حُذف المشروع أو أن الرابط غير صحيح.', '/app/projects', 'العودة للمشاريع') });
  if (!can(user, 'read', 'project', p)) return layout({ user, active: 'projects', title: 'المشروع', body: noticeCard('لا تملك صلاحية الوصول', 'هذا المشروع خارج نطاق صلاحياتك الحالية — تواصل مع مدير النظام إن كنت تحتاج الوصول.', '/app/projects', 'العودة للمشاريع') });
  const row = redact(user, 'project', p);
  const k = await projectKpis(p.id);
  const canCost = canSeeSensitive(user, 'cost');
  const canEdit = can(user, 'update', 'project', p);
  const tasks = await all("SELECT status, COUNT(*) n FROM task WHERE project_id=? AND deleted_at IS NULL GROUP BY status", [p.id]);
  const tmap = Object.fromEntries(tasks.map((t) => [t.status, t.n]));
  const risks = await all("SELECT title, impact, status FROM risk WHERE project_id=? AND status!='CLOSED' LIMIT 10", [p.id]);
  // نوع العميل يُقرأ مع اسمه لأن التصنيف يفرّق بين عميل حقيقي والعميل الذي هو الشركة نفسها.
  const client = await get('SELECT id, name_ar, type FROM client WHERE id=?', [p.client_id]);
  const owner = p.owner_user_id ? await get('SELECT name_ar, username FROM app_user WHERE id=?', [p.owner_user_id]) : null;
  const srcOpp = p.source_opp_id ? await get('SELECT id, title_ar FROM opportunity WHERE id=? AND deleted_at IS NULL', [p.source_opp_id]) : null;
  const contract = await get("SELECT id, code, value_halalas, status FROM contract WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [p.id]);
  // Team assigned to this project (from the allocation model), with each member's month-coverage on THIS project.
  const staff = await all(`SELECT a.person_name_ar, a.type, a.monthly_json, e.job_title
     FROM allocation a LEFT JOIN employee e ON e.id=a.employee_id
     WHERE a.project_id=? AND a.deleted_at IS NULL ORDER BY (a.type='lead') DESC, a.person_name_ar`, [p.id]);
  // Governance registers (WP17): the project registers + write flag under the same RBAC.
  // المخرجات صارت أحدها — تُقرأ من الحمولة نفسها لا باستعلام موازٍ، فالكتابة والقراءة على
  // مصدر واحد وتحت الحارس نفسه.
  const gov = await projectGovernance(user, p.id);
  const canGov = gov.canEdit;
  const dlv = gov.deliverables || [];
  // حركة المال على المشروع — قسم كامل خلف بواباته، والسنة تأتي من الرابط إن مُرِّرت.
  const moneyCard = await projectMoneySection(user, p, { year: opts.year });
  const invSum = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM invoice
     WHERE project_id=? AND deleted_at IS NULL AND status NOT IN ('DRAFT','CANCELLED')`, [p.id])).v;
  const users = await all(`SELECT id, COALESCE(name_ar, username) AS "name" FROM app_user
     WHERE active=1 AND deleted_at IS NULL ORDER BY name_ar, username LIMIT 200`);
  const userName = Object.fromEntries(users.map((u) => [u.id, u.name]));

  // ── Financials ──
  const contractVal = p.contract_value_halalas || (contract && contract.value_halalas) || 0;
  const headlineVal = contractVal || p.po_value_halalas || p.budget_halalas || 0;
  const spend = p.actual_spend_halalas || 0;
  // الإيراد المُثبت من بنود الإيراد — نفس مصدر كل أرقام الإيراد في المنصة، لا الخانة الجامدة
  // على صف المشروع التي لا يكتبها شيء في المنتج (فتبقى على رقم الترحيل مهما سُجِّل إيراد جديد).
  const revenue = (await projectRevenue([p.id]))[0]?.revenue_halalas || 0;
  const showCost = canCost && !row._redacted_actual_spend_halalas;
  const marginPct = p.margin_pct != null ? p.margin_pct : (revenue > 0 ? Math.round((revenue - spend) / revenue * 100) : null);
  const burnPct = p.budget_halalas ? Math.round(spend / p.budget_halalas * 100) : null;
  // تصنيف المشروع مشتقّ من قرائن صفّه (عميل ونوعه · قيمة تعاقدية · أمر شراء · إيراد محقق ·
  // فرصة مصدر) لا من الخانة المخزَّنة التي بقيت «داخلي» على 27 مشروع عميل منذ نقل المنصة.
  // القاعدة كلها في خدمة المشاريع، والكلمة في المعجم، والتلميح يقول السبب ويكشف التناقض.
  const kindTag = projectKind(p, { clientType: client?.type, revenueHalalas: revenue });

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
    durTxt = `${dayWord(totalD)} · مضى ${elapsed} · متبقٍّ ${remain}`;
    const prog = Math.round(p.progress_pct || 0);
    const gap = prog - schedulePct;
    scheduleTone = gap < -12 ? 'var(--red)' : gap < -4 ? 'var(--amber)' : 'var(--green)';
    scheduleNote = gap < -12 ? 'متأخر عن الجدول' : gap < -4 ? 'متأخر قليلاً عن الجدول' : (today > ed ? 'تجاوز تاريخ الانتهاء' : 'ضمن الجدول');
    if (today > ed && prog < 100) { scheduleTone = 'var(--red)'; scheduleNote = 'تجاوز تاريخ الانتهاء'; }
  }

  const stat = (l, v, c, sub) => card(`<div style="padding:.7rem .9rem"><div style="font-size:10.5px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.2rem;${c ? 'color:' + c : ''}">${v}</div>${sub ? `<div style="font-size:10px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const ragColor = p.rag === 'RED' ? 'red' : p.rag === 'AMBER' ? 'amber' : 'green';
  // حالة الصحة قابلة للتعديل المباشر ممن يملك تعديل المشروع (المفروض تقدر تغيّرها بنفسك، لا
  // تنتظر حسابها فقط). ملاحظة نزاهة: قد تبقى «حرج/في خطر» رغم اختيارك «على المسار» إن كان
  // الانحراف الفعلي (الصرف مقابل الإنجاز) أو التأخر الزمني يتجاوز الحدود — كي لا تُخفي مشكلة حقيقية.
  const ragTip = 'يمكنك تغييرها يدوياً في أي وقت — قد تبقى «حرج» أو «في خطر» رغم اختيارك لون أهدأ إن كان الانحراف المالي أو الزمني الفعلي كبيراً، حتى لا تُخفى مشكلة حقيقية';
  const ragBadge = canEdit
    ? `<select data-action-change="prj-rag-sel" data-id="${p.id}" aria-label="حالة صحة المشروع" title="${esc(ragTip)}"
        style="font-size:11.5px;font-weight:700;padding:.22rem .55rem;border-radius:999px;border:1px solid transparent;cursor:pointer;background:${ragColor === 'red' ? '#fee2e2' : ragColor === 'amber' ? '#fef3c7' : '#dcfce7'};color:${ragColor === 'red' ? '#b91c1c' : ragColor === 'amber' ? '#92400e' : '#059669'}">
        ${['GREEN', 'AMBER', 'RED'].map((v) => `<option value="${v}" ${p.rag === v ? 'selected' : ''}>${RAG_LABEL[v]}</option>`).join('')}
      </select>`
    : `<span title="${esc(ragTip)}">${pill(RAG_LABEL[p.rag] || RAG_LABEL.GREEN, ragColor)}</span>`;
  // ── المخرجات: صفٌّ قابل للعمل، لا سطر قراءة ────────────────────────────────────
  // القيمة غير المسجَّلة تُكتب «غير محدَّدة» لا صفراً — الصفر يُقرأ اتفاقاً على لا شيء بينما
  // الحقيقة أنه لم يُتفق بعد، والفرق بينهما هو الفرق بين مطالبةٍ صحيحة وأخرى ناقصة.
  const dlvTone = (s) => (['PAID', 'INVOICED'].includes(s) ? 'violet' : s === 'ACCEPTED' ? 'green' : s === 'DELIVERED' ? 'blue' : s === 'REJECTED' ? 'red' : 'slate');
  const dlvRows = dlv.map((d) => {
    const sys = DELIVERABLE_SYSTEM_STATUSES.includes(d.status);
    const next = DELIVERABLE_NEXT[d.status];
    const monthTxt = d.month ? `${MONTHS_AR[(d.month - 1) % 12] || ''}${d.year ? ` <span class="tnum">${d.year}</span>` : ''}` : G.monthUnset;
    return `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:.45rem .7rem;font-size:12.5px">${esc(d.name_ar)}
        <div style="font-size:10px;color:var(--muted)">${monthTxt}${d.delivered_at ? ` · سُلِّم <span class="tnum">${esc(String(d.delivered_at).slice(0, 10))}</span>` : ''}${d.accepted_at ? ` · قُبل <span class="tnum">${esc(String(d.accepted_at).slice(0, 10))}</span>` : ''}</div></td>
      <td style="padding:.45rem .7rem;font-size:12px;text-align:center;white-space:nowrap" class="${d.amount_halalas == null ? '' : 'tnum'}">${d.amount_halalas == null ? `<span style="color:var(--muted)">${G.amountUnset}</span>` : fmtSar(d.amount_halalas)}</td>
      <td style="padding:.45rem .7rem;text-align:center;white-space:nowrap">${pill(deliverableStatusLabel(d.status), dlvTone(d.status))}</td>
      <td style="padding:.45rem .7rem;text-align:center;white-space:nowrap">${!canGov ? ''
        : sys ? `<span style="font-size:10.5px;color:var(--muted)" title="حالة «${deliverableStatusLabel(d.status)}» تنتج عن مسار الفوترة والتحصيل — تُعالَج من صفحة المالية">${G.financeOwned}</span>`
          : `<div style="display:inline-flex;gap:.3rem;align-items:center">
              ${next ? `<button class="btn btn-sm" data-action="gov-status" data-kind="deliverable" data-id="${esc(d.id)}" data-status="${next.to}">${next.ar}</button>` : ''}
              <select class="input" style="font-size:11px;padding:.2rem .35rem;width:auto" aria-label="حالة المخرج"
                data-action-change="gov-status-sel" data-kind="deliverable" data-id="${esc(d.id)}">
                ${DELIVERABLE_MANUAL_STATUSES.map((s) => `<option value="${s}"${s === d.status ? ' selected' : ''}>${deliverableStatusLabel(s)}</option>`).join('')}
              </select>
              <button class="btn btn-ghost btn-sm" data-action="gov-del" data-kind="deliverable" data-id="${esc(d.id)}" aria-label="حذف المخرج" title="حذف المخرج">✕</button>
            </div>`}</td></tr>`;
  }).join('');
  // شريط إضافة مخرج — شهر الاستحقاق قائمة واحدة (شهر وسنة معاً) فلا يُخزَّن شهرٌ بلا سنته.
  const dlvYears = (() => {
    const ys = new Set();
    const sy = Number(String(p.start_date || '').slice(0, 4)); const ey = Number(String(p.end_date || '').slice(0, 4));
    const cy = new Date().getUTCFullYear();
    const from = Number.isFinite(sy) && sy > 2000 ? sy : cy;
    const to = Number.isFinite(ey) && ey > 2000 ? ey : cy + 1;
    for (let y = Math.min(from, cy); y <= Math.max(to, cy); y++) ys.add(y);
    return [...ys].sort();
  })();
  const dlvAddBar = canGov ? `<div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;padding:.55rem .9rem;border-top:1px dashed var(--line)">
    <input id="g-dlv-name" class="input" placeholder="${G.deliverableName}…" aria-label="${G.deliverableName}" style="flex:1;min-width:140px;font-size:12.5px">
    <select id="g-dlv-period" class="input" aria-label="${G.deliverableMonth}" style="width:auto;font-size:12px;max-width:150px">
      <option value="">${G.monthUnset}</option>
      ${dlvYears.flatMap((y) => MONTHS_AR.map((mn, i) => `<option value="${y}-${String(i + 1).padStart(2, '0')}">${mn} ${y}</option>`)).join('')}
    </select>
    <input id="g-dlv-amount" class="input" type="number" min="0" step="1" dir="ltr" placeholder="${G.deliverableAmount}" aria-label="${G.deliverableAmount} بالريال" style="width:110px;font-size:12.5px">
    <button class="btn btn-sm btn-primary" data-action="gov-add" data-kind="deliverable">${icon('plus')} ${G.add}</button>
  </div>` : '';
  const riskRows = risks.map((r) => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:.4rem .75rem;font-size:12.5px">${esc(r.title)}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(tr(r.impact) || '—', r.impact === 'high' ? 'red' : r.impact === 'medium' ? 'amber' : 'slate')}</td></tr>`).join('');
  // شريط تذكير بالأشهر فوق أعمدة التغطية — بلا هذا الشريط يظهر صف مربعات ملوّنة بلا معنى (لا يُعرف
  // أيها يناير وأيها ديسمبر إلا بتمرير الفأرة فوق كل مربع)؛ عمود ضيّق فاختصارات إنجليزية Jan..Dec
  // حسب قاعدة النموذج الزمني الموحّد (لا اختصارات عربية في الشبكات الضيقة أبداً).
  const monthTicks = `<div class="mtrack" style="gap:2px;margin-top:.2rem">${MONTHS_EN3.map((m) => `<span style="font-size:7.5px;font-weight:400;color:var(--faint);text-align:center;line-height:1">${m}</span>`).join('')}</div>`;
  // staffing rows: parse each member's monthly_json into a 12-cell coverage strip on this project
  const staffRows = staff.map((s) => {
    let mj = {}; try { mj = JSON.parse(s.monthly_json || '{}'); } catch { mj = {}; }
    const months = Array.from({ length: 12 }, (_, i) => Math.round((Number(mj[i + 1]) || 0) * 100));
    return `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:.4rem .75rem;font-size:12.5px">${esc(s.person_name_ar || '—')}<div style="font-size:10px;color:var(--muted)">${esc(s.job_title || '')}</div></td>
      <td style="padding:.4rem .75rem;text-align:center">${pill(s.type === 'lead' ? 'قائد' : 'عضو', s.type === 'lead' ? 'blue' : 'slate')}</td>
      <td style="padding:.4rem .75rem;width:160px">${utilStrip(months, currentMonthIndex(p.year || new Date().getUTCFullYear()) + 1)}</td></tr>`;
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
        <div style="position:absolute;inset-inline-start:0;top:0;height:100%;width:${Math.min(100, Math.round(p.progress_pct || 0))}%;background:linear-gradient(90deg,var(--brand),var(--brand2))"></div>
        ${schedulePct != null ? `<div title="موضع اليوم على الجدول" style="position:absolute;top:-2px;height:14px;width:2px;background:#0f172a;inset-inline-start:${schedulePct}%"></div>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:var(--muted)">الإنجاز <b class="tnum" style="color:var(--ink2)">${Math.round(p.progress_pct || 0)}%</b></span><span style="color:var(--muted)">${schedulePct != null ? `الزمن المنقضي <b class="tnum">${schedulePct}%</b>` : ''}</span></div>
      <div style="font-size:11px;color:var(--faint);margin-top:.4rem">${durTxt}</div>
      <div style="display:flex;gap:1.2rem;margin-top:.65rem;padding-top:.55rem;border-top:1px solid var(--line);font-size:11.5px">
        <div><span style="color:var(--muted)">مدير المشروع</span><div style="font-weight:700">${esc(p.pm_name || owner?.name_ar || owner?.username || '—')}</div></div>
        ${srcOpp ? `<div><span style="color:var(--muted)">الفرصة المصدر</span><div><a href="/app/opportunity/${esc(srcOpp.id)}" style="color:var(--brand2);text-decoration:none;font-weight:700">${esc(srcOpp.title_ar).slice(0, 26)}</a></div></div>` : ''}
      </div>
    </div>`);

  // ── خطة مقابل فعلي: burn vs delivery — two bars + Arabic deviation narrative when |Δ|>10 ──
  const progPct = Math.round(p.progress_pct || 0);
  let burnV = null, burnBasis = '';
  if (showCost && p.budget_halalas > 0) { burnV = Math.round(spend / p.budget_halalas * 100); burnBasis = 'الصرف الفعلي من الميزانية'; }
  else if (headlineVal > 0) { burnV = Math.round(invSum / headlineVal * 100); burnBasis = 'المفوتر من قيمة العقد'; }
  let devTone = 'var(--green)', devNote = 'الصرف والإنجاز متوازنان';
  if (burnV != null) {
    const dev = burnV - progPct;
    if (dev > 10) { devTone = 'var(--red)'; devNote = `الصرف يسبق الإنجاز بـ${dev} ${dev >= 3 && dev <= 10 ? 'نقاط' : 'نقطة'} — راجع نطاق العمل`; }
    else if (dev < -10) { devTone = 'var(--amber)'; devNote = `الإنجاز يسبق الصرف بـ${-dev} ${-dev >= 3 && -dev <= 10 ? 'نقاط' : 'نقطة'} — تحقق من الفوترة في موعدها`; }
  }
  const pvaCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:.6rem">
      <div style="font-weight:800;font-size:13px">${G.planVsActual}</div>
      ${burnV != null ? `<span style="font-size:11px;font-weight:700;color:${devTone}">${devNote}</span>` : ''}</div>
    <div style="padding:.85rem 1rem">
      ${burnV == null ? `<div class="empty-state" style="padding:1rem"><div class="t">لا أساس مالي للقياس بعد</div><div class="s">سجِّل ميزانية أو قيمة عقد للمشروع كي يُقارن الصرف بالإنجاز.</div></div>` : `
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted)"><span>${burnBasis}</span><b class="tnum" style="color:${burnV > 100 ? 'var(--red)' : 'var(--ink2)'}">${burnV}%</b></div>
      ${bar(Math.min(100, burnV), burnV > progPct + 10 ? '#dc2626' : '#834798')}
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:.55rem"><span>${G.progress}</span><b class="tnum">${progPct}%</b></div>
      ${bar(progPct, '#244A99')}
      <div style="font-size:10.5px;color:var(--faint);margin-top:.55rem">${G.burnVsDelivery}: الشريط الأول ${burnBasis} والثاني نسبة الإنجاز — التباعد فوق 10 نقاط يستدعي قراراً.</div>`}
    </div>`);

  // ── governance tab strip (WP17): server renders ALL panels; the page script only switches ──
  const trg = (v) => ({ OPEN: 'مفتوح', MITIGATING: 'قيد المعالجة', CLOSED: 'مغلق', REQUESTED: 'قيد الطلب',
    APPROVED: 'معتمد', REJECTED: 'مرفوض', PENDING: 'قادم', MET: 'محقق', MISSED: 'لم يُحقَّق',
    low: 'منخفض', med: 'متوسط', medium: 'متوسط', high: 'مرتفع' }[v] || v || '—');
  const lvlPill = (v) => v ? pill(trg(v), v === 'high' ? 'red' : (v === 'med' || v === 'medium') ? 'amber' : 'slate') : '<span style="color:var(--faint)">—</span>';
  const stPill = (v, map) => pill(trg(v), map[v] || 'slate');
  const dStr = today.toISOString().slice(0, 10);
  const soonStr = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const thG = (t, w) => `<th style="padding:.4rem .75rem;font-size:10.5px;color:var(--muted);font-weight:700;text-align:right;${w ? 'width:' + w : ''}">${t}</th>`;
  const tdG = (c, extra = '') => `<td style="padding:.45rem .75rem;font-size:12.5px;${extra}">${c}</td>`;
  const delBtn = (kind, id) => canGov ? `<button class="btn btn-ghost btn-sm" data-action="gov-del" data-kind="${kind}" data-id="${id}" title="${G.delete}" aria-label="${G.delete}">✕</button>` : '';
  const emptyPanel = (msg, cta) => `<div class="empty-state">${icon('inbox')}<div class="t">${msg}</div>${canGov ? `<div class="s">${cta}</div>` : ''}</div>`;
  const govField = (id, ph, type = 'text') => `<input class="input" id="${id}" type="${type}" placeholder="${ph}" style="font-size:12px;padding:.4rem .55rem">`;
  const lvlSelect = (id, label) => `<select id="${id}" class="input" aria-label="${label}" style="font-size:12px;padding:.4rem .45rem"><option value="">${label}</option><option value="low">منخفض</option><option value="med">متوسط</option><option value="high">مرتفع</option></select>`;
  const ownerSelect = (id) => `<select id="${id}" class="input" aria-label="المالك" style="font-size:12px;padding:.4rem .45rem;max-width:150px"><option value="">— المالك —</option>${users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>`;
  const addBar = (kind, fields) => canGov ? `<div style="display:flex;gap:.45rem;flex-wrap:wrap;align-items:center;padding:.6rem .75rem;border-top:1px solid var(--line);background:var(--bg)">
      ${fields}<button class="btn btn-primary btn-sm" data-action="gov-add" data-kind="${kind}">${G.add}</button></div>` : '';

  const msRows = gov.milestones.map((m) => {
    const overdueMs = m.status === 'PENDING' && m.due_date && m.due_date < dStr;
    const upcoming = m.status === 'PENDING' && m.due_date && m.due_date >= dStr && m.due_date <= soonStr;
    return `<tr style="border-bottom:1px solid var(--line);${overdueMs ? 'background:#fef2f2' : upcoming ? 'background:#fffbeb' : ''}">
      ${tdG(esc(m.name_ar) + (upcoming ? ' ' + pill('قريب', 'amber') : '') + (overdueMs ? ' ' + pill('متأخر', 'red') : ''))}
      ${tdG(`<span class="tnum">${m.due_date || '—'}</span>`, 'text-align:center')}
      ${tdG(stPill(m.status, { PENDING: 'blue', MET: 'green', MISSED: 'red' }), 'text-align:center')}
      ${canGov ? tdG(`<div style="display:flex;gap:.25rem;justify-content:center">${m.status !== 'MET' ? `<button class="btn btn-sm" data-action="gov-status" data-kind="milestone" data-id="${m.id}" data-status="MET">محقق</button>` : ''}
        ${m.status !== 'MISSED' ? `<button class="btn btn-sm" data-action="gov-status" data-kind="milestone" data-id="${m.id}" data-status="MISSED">لم يُحقَّق</button>` : ''}${delBtn('milestone', m.id)}</div>`, 'text-align:center') : ''}
    </tr>`;
  }).join('');
  const msPanel = `${gov.milestones.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr>${thG('المعلم')}${thG('الاستحقاق', '110px')}${thG('الحالة', '90px')}${canGov ? thG('إجراء', '190px') : ''}</tr></thead><tbody>${msRows}</tbody></table>`
    : emptyPanel('لا معالم مسجّلة بعد', 'أضِف أول معلم من الشريط أدناه — المعالم القادمة خلال 30 يوماً تُميَّز تلقائياً.')}
    ${addBar('milestone', `${govField('g-mls-name', 'اسم المعلم…')}${govField('g-mls-due', '', 'date')}`)}`;

  const rkRows = gov.risks.map((r) => `<tr style="border-bottom:1px solid var(--line)">
      ${tdG(esc(r.title) + (r.mitigation ? `<div style="font-size:10.5px;color:var(--muted)">التخفيف: ${esc(r.mitigation)}</div>` : ''))}
      ${tdG(lvlPill(r.probability), 'text-align:center')}${tdG(lvlPill(r.impact), 'text-align:center')}
      ${tdG(r.exposure ? pill(esc(r.exposure), r.exposure === 'مرتفع' ? 'red' : r.exposure === 'متوسط' ? 'amber' : 'slate') : '<span style="color:var(--faint)">—</span>', 'text-align:center')}
      ${tdG(esc(userName[r.owner_user_id] || '—'), 'text-align:center;font-size:11.5px')}
      ${tdG(canGov ? `<select class="input" data-action-change="gov-status-sel" data-kind="risk" data-id="${r.id}" aria-label="حالة الخطر" style="font-size:11.5px;padding:.25rem .4rem">
          ${['OPEN', 'MITIGATING', 'CLOSED'].map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${trg(s)}</option>`).join('')}</select>`
    : stPill(r.status, { OPEN: 'amber', MITIGATING: 'blue', CLOSED: 'green' }), 'text-align:center')}
      ${canGov ? tdG(delBtn('risk', r.id), 'text-align:center') : ''}
    </tr>`).join('');
  const rkPanel = `${gov.risks.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr>${thG('الخطر')}${thG('الاحتمال', '80px')}${thG('الأثر', '80px')}${thG('التعرض', '80px')}${thG('المالك', '110px')}${thG('الحالة', '110px')}${canGov ? thG('', '46px') : ''}</tr></thead><tbody>${rkRows}</tbody></table>`
    : emptyPanel('لا مخاطر مسجّلة بعد', 'سجِّل المخاطر مبكراً مع احتمالها وأثرها — التعرض يُحسب تلقائياً.')}
    ${addBar('risk', `${govField('g-rsk-title', 'عنوان الخطر…')}${lvlSelect('g-rsk-prob', 'الاحتمال')}${lvlSelect('g-rsk-impact', 'الأثر')}${govField('g-rsk-mit', 'خطة التخفيف…')}${ownerSelect('g-rsk-owner')}`)}`;

  const openIss = gov.issues.filter((i) => i.status !== 'CLOSED'), closedIss = gov.issues.filter((i) => i.status === 'CLOSED');
  const issRow = (i) => `<tr style="border-bottom:1px solid var(--line);${i.status === 'CLOSED' ? 'opacity:.65' : ''}">
      ${tdG(esc(i.title))}${tdG(lvlPill(i.severity), 'text-align:center')}
      ${tdG(esc(userName[i.owner_user_id] || '—'), 'text-align:center;font-size:11.5px')}
      ${tdG(stPill(i.status, { OPEN: 'red', CLOSED: 'green' }), 'text-align:center')}
      ${tdG(`<span class="tnum" style="font-size:11px;color:var(--muted)">${(i.opened_at || '').slice(0, 10)}</span>`, 'text-align:center')}
      ${canGov ? tdG(`<div style="display:flex;gap:.25rem;justify-content:center"><button class="btn btn-sm" data-action="gov-status" data-kind="issue" data-id="${i.id}" data-status="${i.status === 'CLOSED' ? 'OPEN' : 'CLOSED'}">${i.status === 'CLOSED' ? 'إعادة فتح' : 'إغلاق'}</button>${delBtn('issue', i.id)}</div>`, 'text-align:center') : ''}
    </tr>`;
  const issPanel = `${gov.issues.length ? `<div style="padding:.5rem .75rem;font-size:11px;color:var(--muted)">مفتوحة <b class="tnum">${openIss.length}</b> · مغلقة <b class="tnum">${closedIss.length}</b></div>
    <table style="width:100%;border-collapse:collapse"><thead><tr>${thG('المعوق')}${thG('الشدة', '80px')}${thG('المالك', '110px')}${thG('الحالة', '80px')}${thG('فُتح في', '95px')}${canGov ? thG('إجراء', '130px') : ''}</tr></thead><tbody>${[...openIss, ...closedIss].map(issRow).join('')}</tbody></table>`
    : emptyPanel('لا معوقات مسجّلة', 'سجِّل ما يعطّل التقدم فعلياً الآن ليُتابَع حتى الإغلاق.')}
    ${addBar('issue', `${govField('g-iss-title', 'وصف المعوق…')}${lvlSelect('g-iss-sev', 'الشدة')}${ownerSelect('g-iss-owner')}`)}`;

  const decRows = gov.decisions.map((d) => `<div class="dd-row" style="align-items:flex-start">
      <span><b style="font-size:12.5px">${esc(d.title)}</b>${d.detail ? `<div style="font-size:11.5px;color:var(--muted)">${esc(d.detail)}</div>` : ''}
        <div style="font-size:10.5px;color:var(--faint)">قرَّر: ${esc(d.decided_by || '—')} · <span class="tnum">${(d.decided_at || '').slice(0, 10) || '—'}</span></div></span>
      <b>${delBtn('decision', d.id)}</b></div>`).join('');
  const decPanel = `${gov.decisions.length ? `<div style="padding:.35rem .9rem">${decRows}</div>`
    : emptyPanel('لا قرارات موثقة بعد', 'وثِّق قرارات اللجان والاجتماعات هنا لتبقى مرجعاً مُلزِماً.')}
    ${addBar('decision', `${govField('g-dec-title', 'نص القرار…')}${govField('g-dec-detail', 'التفاصيل (اختياري)…')}${govField('g-dec-by', 'مَن قرَّر…')}${govField('g-dec-at', '', 'date')}`)}`;

  const chgRows = gov.changes.map((c) => `<tr style="border-bottom:1px solid var(--line)">
      ${tdG(esc(c.title) + (c.impact ? `<div style="font-size:10.5px;color:var(--muted)">الأثر: ${esc(c.impact)}</div>` : ''))}
      ${tdG(stPill(c.status, { REQUESTED: 'amber', APPROVED: 'green', REJECTED: 'slate' }), 'text-align:center')}
      ${canGov ? tdG(`<div style="display:flex;gap:.25rem;justify-content:center">${c.status === 'REQUESTED' ? `<button class="btn btn-sm" data-action="gov-status" data-kind="change" data-id="${c.id}" data-status="APPROVED">اعتماد</button>
        <button class="btn btn-sm" data-action="gov-status" data-kind="change" data-id="${c.id}" data-status="REJECTED">رفض</button>` : ''}${delBtn('change', c.id)}</div>`, 'text-align:center') : ''}
    </tr>`).join('');
  const chgPanel = `${gov.changes.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr>${thG('طلب التغيير')}${thG('الحالة', '95px')}${canGov ? thG('إجراء', '170px') : ''}</tr></thead><tbody>${chgRows}</tbody></table>`
    : emptyPanel('لا طلبات تغيير', 'أي توسّع في النطاق يبدأ هنا: سجِّل الطلب وأثره ثم قرار الاعتماد أو الرفض.')}
    ${addBar('change', `${govField('g-chg-title', 'عنوان التغيير…')}${govField('g-chg-impact', 'أثره على النطاق/الوقت/الكلفة…')}`)}`;

  const TABS = [
    ['milestones', G.milestones, gov.milestones.length, msPanel],
    ['risks', G.risks, gov.risks.length, rkPanel],
    ['issues', G.issues, openIss.length, issPanel],
    ['decisions', G.decisions, gov.decisions.length, decPanel],
    ['changes', G.changes, gov.changes.filter((c) => c.status === 'REQUESTED').length, chgPanel],
  ];
  const govCard = card(`
    <div style="padding:.6rem .9rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
      <span style="font-weight:800;font-size:13px">حوكمة المشروع</span>
      <div class="seg" role="tablist" aria-label="سجلات الحوكمة">${TABS.map(([k, l, n], i) => `<button role="tab" aria-selected="${i === 0}" class="${i === 0 ? 'on' : ''}" data-action="gov-tab" data-tab="${k}">${l} <span class="tnum" style="font-weight:800;color:${n ? 'var(--brand2)' : 'var(--faint)'}">${n}</span></button>`).join('')}</div>
      <div class="spacer"></div>
      ${canGov ? pill('لديك صلاحية التحرير', 'green') : pill('عرض فقط', 'slate')}
    </div>
    ${TABS.map(([k, , , panel], i) => `<div class="gov-panel" data-panel="${k}" ${i === 0 ? '' : 'hidden'}><div class="tblwrap">${panel}</div></div>`).join('')}`);

  const body = `
    <a href="/app/projects" style="font-size:12px;color:var(--muted)">← المشاريع</a>
    <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin:.6rem 0 1rem">
      <h2 style="font-size:18px;margin:0">${esc(p.name_ar)}</h2>${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : p.status === 'ON_HOLD' ? 'amber' : 'blue')}${ragBadge}
      <span title="${esc(projectKindTip(kindTag))}">${pill(esc(projectKindLabel(kindTag.key)), 'slate')}</span>
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
    <div style="margin-bottom:.9rem">${pvaCard}</div>
    <div id="money" style="margin-bottom:.9rem">${moneyCard}</div>
    <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;font-size:13px">التسكين — فريق المشروع (${staff.length})</div>
        ${canEdit ? `<button class="btn btn-sm" style="font-size:11px;padding:.25rem .6rem" onclick="Sanad.projOpen('${p.id}')">${icon('users')} إدارة التسكين</button>` : ''}</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10.5px;color:var(--muted);text-align:right"><th style="padding:.35rem .75rem">الموظف</th><th style="padding:.35rem .75rem;text-align:center">الدور</th><th style="padding:.35rem .75rem .15rem;width:160px;text-align:center">التغطية الشهرية${monthTicks}</th></tr></thead>
        <tbody>${staffRows || '<tr><td colspan="3" style="padding:1rem;color:var(--muted);font-size:12.5px">لا يوجد فريق مُسكَّن على هذا المشروع بعد' + (canEdit ? ' — استخدم «إدارة التسكين»' : '') + '</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap">
        <div style="font-weight:800;font-size:13px">${G.deliverables} (<span class="tnum">${dlv.length}</span>)</div>
        <div style="font-size:10.5px;color:var(--muted)">${canGov ? 'سلّم أو اقبل بنقرة — والمفوتر يُضبط من المالية' : 'للقراءة فقط بدورك الحالي'}</div></div>
        <div class="tblwrap" style="max-height:260px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;min-width:${canGov ? 460 : 300}px"><tbody>${dlvRows
          || `<tr><td colspan="4"><div class="empty-state" style="padding:1.4rem 1rem">
              <div class="t">لا مخرجات مسجَّلة على هذا المشروع</div>
              <div class="s">${canGov ? 'المخرَج هو ما يُسلَّم للعميل ويُبنى عليه المستخلص — أضِف أول مخرَج من الشريط أدناه.' : 'لم يُسجَّل أي مخرَج بعد. مدير المشروع هو من يضيفها.'}</div></div></td></tr>`}</tbody></table></div>
        ${dlvAddBar}`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.85rem 1rem"><div style="font-weight:800;font-size:13px;margin-bottom:.5rem">توزيع المهام (${k.totalTasks})</div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.7rem">${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => pill(`${tr(s)}: ${tmap[s] || 0}`, s === 'DONE' ? 'green' : s === 'BLOCKED' ? 'red' : 'slate')).join(' ')}</div>
        <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;padding-top:.6rem;border-top:1px dashed var(--line)">
          <input id="prj-task-title" class="input" placeholder="أضِف مهمة على هذا المشروع…" aria-label="عنوان المهمة" style="flex:1;min-width:150px;font-size:12.5px">
          <select id="prj-task-priority" class="input" aria-label="${G.priority}" style="width:auto;font-size:12.5px"><option value="P2">متوسطة</option><option value="P0">حرجة</option><option value="P1">عالية</option><option value="P3">منخفضة</option></select>
          <input id="prj-task-due" type="date" dir="ltr" class="input" aria-label="تاريخ الاستحقاق" title="تاريخ الاستحقاق" style="width:auto;font-size:12.5px">
          ${users.length ? `<select id="prj-task-assignee" class="input" aria-label="${G.assignee}" style="width:auto;max-width:150px;font-size:12.5px">
            <option value="">${G.assignee}: أنا</option>
            ${users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select>` : ''}
          <button class="btn btn-sm btn-primary" data-action="prj-task-add" data-project="${p.id}">${icon('plus')} ${G.add}</button>
        </div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:.4rem">تُسجَّل المهمة على هذا المشروع مباشرة وتظهر في «${G.myWork}» لدى مَن أُسنِدت إليه.</div></div>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المخاطر المفتوحة (${risks.length})</div>
        <table style="width:100%;border-collapse:collapse"><tbody>${riskRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:12.5px">لا مخاطر مفتوحة</td></tr>'}</tbody></table>`)}
    </div>
    ${govCard}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{gov:{projectId:${JSON.stringify(p.id).replace(/</g, '\\u003c')},canEdit:${canGov}},
      money:{projectId:${JSON.stringify(p.id).replace(/</g, '\\u003c')}}});</script>`;
  return layout({ user, active: 'projects', title: esc(p.name_ar), subtitle: 'تفاصيل المشروع', body,
    scripts: ['/static/pages/project-governance.js', '/static/pages/project-money.js'] });
}
