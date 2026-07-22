// PMO pages: projects portfolio (comparison-first table + kanban toggle), my tasks, project detail.
import { layout, card, pill, tr, utilStrip } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all, get } from '../../core/db/index.js';
import { projectKpis } from '../../core/reports/metrics.js';
import { listProjects, nextMilestones } from '../../modules/pmo/projects.js';
import { projectGovernance } from '../../modules/pmo/governance.js';
import { myTasks } from '../../modules/pmo/tasks.js';
import { listViews } from '../../modules/views/views.js';
import { canSeeSensitive, redact, can } from '../../core/rbac/index.js';
import { G } from '../i18n/glossary.js';
import { sarShort, esc, bar, statMini, noticeCard } from './_shared.js';
import { MONTHS_AR, currentMonthIndex } from '../../core/i18n/time.js';
import { countAr, dayWord } from '../../core/i18n/plural.js';

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
  const sectors = Object.fromEntries((await all('SELECT id,name_ar FROM sector')).map((s) => [s.id, s.name_ar]));
  const ragTone = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
  // Owner lens: filter the board by sector (?sector=). Company-scope only; others already scoped.
  const allSec = await all('SELECT id, name_ar, color FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
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
  const bestVal = (p) =>
    p.contract_value_halalas ? { v: p.contract_value_halalas, l: 'عقد' } :
    p.po_value_halalas ? { v: p.po_value_halalas, l: 'أمر شراء' } :
    p.budget_halalas ? { v: p.budget_halalas, l: 'ميزانية' } :
    p.revenue_halalas ? { v: p.revenue_halalas, l: 'إيراد محقق' } : { v: 0, l: null };
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
  // إيراد السنة لكل مشروع (استعلام مجمّع واحد) — لبطاقة «الإيراد المحقق للسنة»
  const revYear = year || nowY;
  const revYearBy = Object.fromEntries((await all(`SELECT project_id, COALESCE(SUM(amount_halalas),0) v
      FROM revenue_line WHERE year = ? AND project_id IS NOT NULL GROUP BY project_id`, [revYear]))
    .map((r) => [r.project_id, r.v]));
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
    if (p.rag === 'RED') parts.push('حالتها حمراء — تحتاج قراراً');
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
    const rev = p.revenue_halalas || 0;
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
        ${p.rag ? pill(tr(p.rag), ragTone[p.rag] || 'slate') : ''}</div>
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
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{sectors:${JSON.stringify(await all('SELECT id,name_ar FROM sector WHERE active=1 ORDER BY name_ar')).replace(/</g, '\\u003c')},canEditPrj:${canEdit},viewsPage:'projects'});</script>`;
  return layout({ user, active: 'projects', title: 'المشاريع', subtitle: `المحفظة · ${rows.length} مشروع${statusFilter ? ` · ${tr(statusFilter)}` : ''}${year ? ` · سنة ${year}` : ''}`,
    body, year: year || undefined, scripts: ['/static/pages/projects.js'] });
}

// صفحة «مهامي» — طابور عمل شخصي مرتّب حسب الإلحاح (متأخرة → اليوم → الأسبوع → لاحقاً → مكتملة)
// لا جدول مسطّح: كل قسم يظهر فقط إن كان فيه مهام، وكل مهمة صف نظيف بزر إنجاز فوري وسياق
// المشروع/الفرصة وموعد نسبي («متأخرة ٣ أيام» / «اليوم» / «غداً»). التفاعل عبر tasks.js (تفويض).
export async function tasksPage(user) {
  const rows = await myTasks(user);
  const today = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(today + 'T00:00:00Z').getTime();
  const dnum = (d) => Math.round((new Date(String(d).slice(0, 10) + 'T00:00:00Z').getTime() - todayMs) / 86400000);

  // سياق المهمة: اسم المشروع/الفرصة المرتبطة — بحث مجمّع واحد لكل نوع (لا استعلام لكل صف)
  const prjIds = [...new Set(rows.map((t) => t.project_id).filter(Boolean))];
  const oppIds = [...new Set(rows.map((t) => t.opportunity_id).filter(Boolean))];
  const prjName = {}; const oppName = {};
  if (prjIds.length) for (const p of await all(`SELECT id, name_ar FROM project WHERE id IN (${prjIds.map(() => '?').join(',')}) AND deleted_at IS NULL`, prjIds)) prjName[p.id] = p.name_ar;
  if (oppIds.length) for (const o of await all(`SELECT id, title_ar FROM opportunity WHERE id IN (${oppIds.map(() => '?').join(',')}) AND deleted_at IS NULL`, oppIds)) oppName[o.id] = o.title_ar;

  // تصنيف حسب الإلحاح
  const openT = rows.filter((t) => t.status !== 'DONE');
  const done = rows.filter((t) => t.status === 'DONE');
  const overdue = openT.filter((t) => t.due_date && dnum(t.due_date) < 0);
  const dueToday = openT.filter((t) => t.due_date && dnum(t.due_date) === 0);
  const thisWeek = openT.filter((t) => t.due_date && dnum(t.due_date) >= 1 && dnum(t.due_date) <= 7);
  const later = openT.filter((t) => !t.due_date || dnum(t.due_date) > 7);
  const blocked = openT.filter((t) => t.status === 'BLOCKED').length;

  const prRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const sortT = (arr) => arr.slice().sort((a, b) =>
    (prRank[a.priority] ?? 9) - (prRank[b.priority] ?? 9)
    || (a.due_date ? a.due_date.slice(0, 10) : '9999').localeCompare(b.due_date ? b.due_date.slice(0, 10) : '9999')
    || String(a.title).localeCompare(String(b.title), 'ar'));

  const strip = `<div class="statgrid" style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
    ${statMini('متأخرة', overdue.length, 'تجاوزت موعدها', overdue.length ? 'bad' : '')}
    ${statMini('تستحق اليوم', dueToday.length, 'موعدها اليوم', dueToday.length ? 'warn' : '')}
    ${statMini('هذا الأسبوع', thisWeek.length, 'خلال 7 أيام', 'brand')}
    ${statMini('مفتوحة', openT.length, blocked ? `منها ${blocked} معلّقة` : 'قيد العمل')}
    ${statMini('أُنجزت', done.length, 'مكتملة', done.length ? 'good' : '')}</div>`;

  const quickAdd = `<div class="card" style="padding:.85rem 1rem;margin-bottom:1.15rem">
    <div style="display:flex;gap:.55rem;align-items:center;flex-wrap:wrap">
      <input id="qa-title" class="input" placeholder="أضِف مهمة جديدة…" aria-label="عنوان المهمة" style="flex:1;min-width:190px">
      <select id="qa-priority" class="input" aria-label="الأولوية" style="width:auto"><option value="P2">أولوية متوسطة</option><option value="P0">حرجة</option><option value="P1">عالية</option><option value="P3">منخفضة</option></select>
      <input id="qa-due" type="date" class="input" aria-label="تاريخ الاستحقاق" style="width:auto">
      <button class="btn btn-primary" data-action="task-add">${icon('plus')} إضافة</button>
    </div></div>`;

  const dueLabel = (t) => {
    if (!t.due_date) return { text: 'بلا موعد', color: 'var(--faint)', bold: false };
    const n = dnum(t.due_date);
    if (n < 0) return { text: `متأخرة ${dayWord(-n)}`, color: 'var(--red)', bold: true };
    if (n === 0) return { text: 'تستحق اليوم', color: 'var(--amber)', bold: true };
    if (n === 1) return { text: 'غداً', color: 'var(--amber)', bold: false };
    if (n <= 7) return { text: `خلال ${dayWord(n)}`, color: 'var(--muted)', bold: false };
    const d = new Date(String(t.due_date).slice(0, 10) + 'T00:00:00Z');
    return { text: `<span class="tnum">${d.getUTCDate()}</span> ${MONTHS_AR[d.getUTCMonth()]}`, color: 'var(--muted)', bold: false };
  };
  const prPill = (p) => p === 'P0' ? pill('حرجة', 'red') : p === 'P1' ? pill('عالية', 'amber') : '';
  const ctxOf = (t) => t.project_id && prjName[t.project_id]
    ? `<a href="/app/project/${t.project_id}" class="tk-ctx">${icon('projects')} ${esc(prjName[t.project_id])}</a>`
    : t.opportunity_id && oppName[t.opportunity_id]
      ? `<a href="/app/opportunity/${t.opportunity_id}" class="tk-ctx">${icon('opportunity')} ${esc(oppName[t.opportunity_id])}</a>` : '';

  const taskRow = (t) => {
    const isDone = t.status === 'DONE';
    const dl = dueLabel(t);
    const ctx = ctxOf(t);
    return `<div class="tk-row" data-task="${t.id}">
      <button class="tk-check${isDone ? ' done' : ''}" ${isDone ? 'disabled' : `data-action="task-done" data-id="${t.id}"`} aria-label="${isDone ? 'مهمة منجزة' : 'وضع كمنجزة'}" title="${isDone ? 'منجزة' : 'وضع كمنجزة'}">${isDone ? '✓' : ''}</button>
      <div class="tk-body">
        <div class="tk-title"${isDone ? ' style="text-decoration:line-through;color:var(--faint);font-weight:500"' : ''}>${esc(t.title)}</div>
        <div class="tk-meta">
          ${!isDone ? `<span style="color:${dl.color}${dl.bold ? ';font-weight:700' : ''}">${dl.text}</span>` : ''}
          ${ctx}
          ${t.status === 'BLOCKED' && t.blocked_reason ? `<span style="color:var(--red)">⚠ ${esc(t.blocked_reason)}</span>` : ''}
        </div>
      </div>
      <div class="tk-side">
        ${!isDone ? prPill(t.priority) : ''}
        <select class="tk-status" data-action="task-status" data-id="${t.id}" aria-label="تغيير حالة المهمة">
          ${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => `<option value="${s}"${s === t.status ? ' selected' : ''}>${tr(s)}</option>`).join('')}
        </select>
      </div></div>`;
  };

  const section = (title, items, accent) => items.length ? `<div class="tk-sec">
    <div class="tk-sec-head"><span class="tk-dot" style="background:${accent}"></span><span class="tk-sec-title">${title}</span><span class="tk-sec-count tnum">${items.length}</span></div>
    <div class="tk-list">${sortT(items).map(taskRow).join('')}</div></div>` : '';

  const openSections = section('متأخرة', overdue, 'var(--red)')
    + section('تستحق اليوم', dueToday, 'var(--amber)')
    + section('هذا الأسبوع', thisWeek, 'var(--brand)')
    + section('لاحقاً', later, '#94a3b8');

  const doneSorted = done.slice().sort((a, b) => String(b.completed_at || b.updated_at || '').localeCompare(String(a.completed_at || a.updated_at || '')));
  const DONE_CAP = 25;
  const doneBlock = done.length ? `<details class="tk-done"${openT.length ? '' : ' open'}>
    <summary class="tk-sec-head"><span class="tk-dot" style="background:var(--green)"></span><span class="tk-sec-title">مكتملة</span><span class="tk-sec-count tnum">${done.length}</span><span style="margin-inline-start:auto;font-size:11px;color:var(--faint)">إظهار / إخفاء</span></summary>
    <div class="tk-list" style="margin-top:.3rem">${doneSorted.slice(0, DONE_CAP).map(taskRow).join('')}</div>
    ${done.length > DONE_CAP ? `<div style="font-size:11px;color:var(--faint);padding:.5rem .2rem">و${countAr(done.length - DONE_CAP, { one: 'مهمة أخرى منجزة', two: 'مهمتان أخريان', few: 'مهام أخرى', many: 'مهمة أخرى' })}</div>` : ''}
  </details>` : '';

  const listArea = openT.length
    ? openSections + doneBlock
    : (done.length
      ? `<div class="card" style="text-align:center;padding:1.8rem 1rem;margin-bottom:1rem"><div style="font-size:22px">🎉</div><div style="font-weight:800;color:var(--ink2);margin-top:.3rem">أنجزت كل مهامك</div><div style="font-size:12px;color:var(--muted);margin-top:.25rem">لا مهام مفتوحة الآن — أضِف واحدة من الأعلى متى شئت.</div></div>${doneBlock}`
      : `<div class="card" style="text-align:center;padding:2.6rem 1rem"><div style="font-size:26px;color:var(--brand)">${icon('tasks')}</div><div style="font-weight:800;color:var(--ink2);margin-top:.5rem">لا مهام بعد</div><div style="font-size:12.5px;color:var(--muted);margin-top:.3rem;line-height:1.8">أضِف أول مهمة من الشريط أعلاه — ستظهر هنا مرتّبةً حسب الأقرب موعداً،<br>والأكثر إلحاحاً في الأعلى دائماً.</div></div>`);

  const styles = `<style>
    .tk-sec{margin-bottom:1.15rem}
    .tk-sec-head{display:flex;align-items:center;gap:.5rem;margin:0 0 .4rem;padding:0 .15rem}
    .tk-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .tk-sec-title{font-weight:800;font-size:12.5px;color:var(--ink2)}
    .tk-sec-count{font-size:11px;color:var(--muted);background:#f1f5f9;border-radius:20px;padding:.05rem .5rem;font-weight:700;min-width:20px;text-align:center}
    .tk-list{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
    .tk-row{display:flex;gap:.7rem;align-items:flex-start;padding:.7rem .85rem;border-bottom:1px solid var(--line);transition:background .12s}
    .tk-row:last-child{border-bottom:none}
    .tk-row:hover{background:#f8fafc}
    .tk-check{flex-shrink:0;width:20px;height:20px;margin-top:1px;border:2px solid #cbd5e1;border-radius:50%;background:#fff;color:#fff;font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:all .12s}
    .tk-check:hover:not(.done){border-color:var(--green);background:#f0fdf4}
    .tk-check.done{border-color:var(--green);background:var(--green);cursor:default}
    .tk-body{flex:1;min-width:0}
    .tk-title{font-weight:600;font-size:13px;color:var(--ink2);line-height:1.5;word-break:break-word}
    .tk-meta{display:flex;gap:.35rem .9rem;flex-wrap:wrap;align-items:center;margin-top:.2rem;font-size:11px;color:var(--muted)}
    .tk-ctx{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.2rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tk-ctx:hover{color:var(--brand)}
    .tk-ctx svg{width:12px;height:12px;opacity:.7}
    .tk-side{display:flex;gap:.45rem;align-items:center;flex-shrink:0}
    .tk-status{font-size:11.5px;border:1px solid var(--line);border-radius:8px;padding:.22rem .4rem;background:#fff;color:var(--ink2);cursor:pointer}
    .tk-done{margin-top:.2rem}
    .tk-done>summary{cursor:pointer;list-style:none}
    .tk-done>summary::-webkit-details-marker{display:none}
    @media(max-width:640px){.tk-side{flex-direction:column;align-items:flex-end;gap:.3rem}.tk-ctx{max-width:150px}}
  </style>`;

  const body = `${styles}${strip}${quickAdd}${listArea}`;
  return layout({ user, active: 'tasks', title: 'مهامي', subtitle: openT.length ? `${countAr(openT.length, { one: 'مهمة مفتوحة', two: 'مهمتان مفتوحتان', few: 'مهام مفتوحة', many: 'مهمة مفتوحة' })}${overdue.length ? ` · ${overdue.length} متأخرة` : ''}` : 'كل المهام منجزة', body, scripts: ['/static/pages/tasks.js'] });
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
  // Governance registers (WP17): the five project registers + write flag under the same RBAC.
  const gov = await projectGovernance(user, p.id);
  const canGov = gov.canEdit;
  const invSum = (await get(`SELECT COALESCE(SUM(amount_halalas),0) v FROM invoice
     WHERE project_id=? AND deleted_at IS NULL AND status NOT IN ('DRAFT','CANCELLED')`, [p.id])).v;
  const users = await all(`SELECT id, COALESCE(name_ar, username) AS "name" FROM app_user
     WHERE active=1 AND deleted_at IS NULL ORDER BY name_ar, username LIMIT 200`);
  const userName = Object.fromEntries(users.map((u) => [u.id, u.name]));

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
    durTxt = `${dayWord(totalD)} · مضى ${elapsed} · متبقٍّ ${remain}`;
    const prog = Math.round(p.progress_pct || 0);
    const gap = prog - schedulePct;
    scheduleTone = gap < -12 ? 'var(--red)' : gap < -4 ? 'var(--amber)' : 'var(--green)';
    scheduleNote = gap < -12 ? 'متأخر عن الجدول' : gap < -4 ? 'متأخر قليلاً عن الجدول' : (today > ed ? 'تجاوز تاريخ الانتهاء' : 'ضمن الجدول');
    if (today > ed && prog < 100) { scheduleTone = 'var(--red)'; scheduleNote = 'تجاوز تاريخ الانتهاء'; }
  }

  const stat = (l, v, c, sub) => card(`<div style="padding:.7rem .9rem"><div style="font-size:10.5px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.2rem;${c ? 'color:' + c : ''}">${v}</div>${sub ? `<div style="font-size:10px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const ragColor = p.rag === 'RED' ? 'red' : p.rag === 'AMBER' ? 'amber' : 'green';
  const dlvRows = dlv.map((d) => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:.4rem .75rem;font-size:12.5px">${esc(d.name_ar)}${d.month ? `<span style="color:var(--faint);font-size:10px;margin-inline-start:.35rem">${MONTHS_AR[(d.month - 1) % 12] || ''}</span>` : ''}</td>
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
      <h2 style="font-size:18px;margin:0">${esc(p.name_ar)}</h2>${pill(tr(p.status), p.status === 'COMPLETED' ? 'green' : p.status === 'ON_HOLD' ? 'amber' : 'blue')}${pill(tr(p.rag), ragColor)}
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
    <div style="margin-bottom:.9rem">${pvaCard}</div>
    <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;font-size:13px">التسكين — فريق المشروع (${staff.length})</div>
        ${canEdit ? `<button class="btn btn-sm" style="font-size:11px;padding:.25rem .6rem" onclick="Sanad.projOpen('${p.id}')">${icon('users')} إدارة التسكين</button>` : ''}</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10.5px;color:var(--muted);text-align:right"><th style="padding:.35rem .75rem">الموظف</th><th style="padding:.35rem .75rem;text-align:center">الدور</th><th style="padding:.35rem .75rem;text-align:center">التغطية الشهرية</th></tr></thead>
        <tbody>${staffRows || '<tr><td colspan="3" style="padding:1rem;color:var(--muted);font-size:12.5px">لا يوجد فريق مُسكَّن على هذا المشروع بعد' + (canEdit ? ' — استخدم «إدارة التسكين»' : '') + '</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المخرجات (${dlv.length})</div>
        <div style="max-height:260px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><tbody>${dlvRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:12.5px">لا مخرجات</td></tr>'}</tbody></table></div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.85rem 1rem"><div style="font-weight:800;font-size:13px;margin-bottom:.5rem">توزيع المهام (${k.totalTasks})</div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">${['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'].map((s) => pill(`${tr(s)}: ${tmap[s] || 0}`, s === 'DONE' ? 'green' : s === 'BLOCKED' ? 'red' : 'slate')).join(' ')}</div></div>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13px">المخاطر المفتوحة (${risks.length})</div>
        <table style="width:100%;border-collapse:collapse"><tbody>${riskRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:12.5px">لا مخاطر مفتوحة</td></tr>'}</tbody></table>`)}
    </div>
    ${govCard}
    <script>window.__SANAD=Object.assign(window.__SANAD||{},{gov:{projectId:${JSON.stringify(p.id)},canEdit:${canGov}}});</script>`;
  return layout({ user, active: 'projects', title: esc(p.name_ar), subtitle: 'تفاصيل المشروع', body,
    scripts: ['/static/pages/project-governance.js'] });
}
