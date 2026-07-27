// مركز القيادة (v4) — صفحة قائد القطاع كقصة قرار من أعلى لأسفل:
// (1) عدسة الفترة يوم/أسبوع/شهر/ربع → (2) «ما تغيّر» سجلات حقيقية مؤرّخة → (3) يحتاج انتباهك الآن
// → (4) الإيقاع مقابل الخطة (مقياس الشريط = المستهدف فقط) → (5) قمع الفرص وأعمارها
// → (6) التحصيل والمستخلص المتأخر → (7) صحة المشاريع → (8) الطاقة → (9) العملاء
// → (10) القرارات والاعتمادات → (11) المقارنات والتقارير. كل رقم يفتح تفصيلاً؛ لا أرقام بلا مصدر.
import { layout, card, pill, tr } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all, get } from '../../core/db/index.js';
import { sectorDashboard, sectorStaffing, sectorClients, sectorWins, quarterlyRevenue, quarterlyBookings, pipelineCoverage, monthlyRevenue, revenueForecast, pipelineAging, yearElapsedPct } from '../../core/reports/metrics.js';
import { attentionFeed, RESOURCE_AR } from '../../core/reports/attention.js';
import { changesSince, sinceForWindow } from '../../core/reports/changes.js';
import { arAging } from '../../modules/finance/finance.js';
import { can } from '../../core/rbac/index.js';
import { config } from '../../core/config.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { G } from '../i18n/glossary.js';
import { monthLabel, monthLabelDual, quarterLabel, nowDot, currentMonthIndex, MONTHS_AR } from '../../core/i18n/time.js';
import { countAr, dayWord } from '../../core/i18n/plural.js';
import { esc, ddWrap, attain, ddRows, paceCard, sarShort } from './_shared.js';

const TONE = { brand: 'var(--brand)', green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };

// عدسة الفترة: قيمة ?win + نص الصدى في عناوين الأقسام
const WINS = [
  ['day', 'اليوم', 'منذ أمس'], ['week', 'الأسبوع', 'منذ أسبوع'],
  ['month', 'الشهر', 'منذ شهر'], ['quarter', 'الربع', 'منذ ربع سنة'],
];

// أيقونة ولون كل نوع في «ما تغيّر»
const CHG_IC = { stage: 'trend', invoice: 'money', collection: 'check', activity: 'mail', created: 'plus' };
const CHG_TONE = {
  stage: ['rgba(36,74,153,.1)', 'var(--brand)'], invoice: ['#dbeafe', 'var(--brand)'],
  collection: ['#dcfce7', 'var(--green)'], activity: ['#f1f5f9', 'var(--muted)'],
  created: ['#ede9fe', 'var(--brand2)'],
};

const CSS = `<style>
.sec-grid{display:grid;gap:var(--gap);margin-bottom:var(--gap);grid-template-columns:1.35fr 1fr}
.sec-grid.even{grid-template-columns:1fr 1fr}
@media(max-width:980px){.sec-grid,.sec-grid.even{grid-template-columns:1fr}}
.sec-col{display:flex;flex-direction:column;gap:var(--gap);min-width:0}
.card-head{padding:var(--pad-card-h);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.card-head .t{font-weight:800;font-size:var(--fs-title)}
.card-head .aux{margin-inline-start:auto;display:flex;gap:.35rem;align-items:center}
.chg{display:flex;align-items:center;gap:.6rem;padding:.4rem .55rem;border-radius:10px;border:1px solid transparent;border-inline-start:3px solid transparent}
.chg:hover{background:#fbfcfe;border-color:var(--line)}
.chg .ic{width:26px;height:26px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center}
.chg .ic svg{width:14px;height:14px}
.chg .tx{flex:1;min-width:0}
.chg .h{display:block;font-size:var(--fs-body);font-weight:700;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chg .s{display:block;font-size:var(--fs-micro);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chg .meta{flex:none;text-align:left}
.chg .amt{display:block;font-size:var(--fs-body);font-weight:800;color:var(--ink2)}
.chg .d{display:block;font-size:10px;color:var(--faint)}
.chg.won{border-inline-start-color:var(--green);background:#f0fdf4}
.chg.lost{border-inline-start-color:var(--red);background:#fef2f2}
/* على الضيّق: عناوين الانتباه تلتف بدل قصّ أول أرقام المبلغ (قصّ «600,000» إلى «00,000» مضلل) */
@media(max-width:640px){.attn .tx .h{white-space:normal;overflow:visible;line-height:1.5}}
.fnl-lbl{font-size:var(--fs-meta);display:flex;justify-content:center;gap:.45rem;align-items:baseline;margin-bottom:.18rem}
.fnl-bar{height:16px;border-radius:8px;margin:0 auto;opacity:.92}
.fnl-conv{text-align:center;font-size:10px;color:var(--faint);line-height:1.6;padding:.1rem 0}
</style>`;

export async function sectorPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const win = WINS.some((w) => w[0] === opts.win) ? opts.win : 'week';
  const winEcho = WINS.find((w) => w[0] === win)[2];
  // محوّل القطاع: قطاعات التسليم وحدها — الأربعة لا خامس لها. وحدة المساندة لا مركز قيادة
  // تجاري لها (بلا هدف ولا خط فرص)، ووضعها في المحوّل يجعلها قطاعاً في عين كل من يستعمله.
  // ملاحظة: القائمة تحكم أيضاً ما يُقبل من ?sector= — فطلب وحدة مساندة يعود إلى قطاع المستخدم.
  const allSectors = await all(`SELECT id, name_ar, color FROM sector
     WHERE active = 1 AND deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL} ORDER BY sort_order`);
  const requested = opts.sector && allSectors.some((s) => s.id === opts.sector) ? opts.sector : null;
  const sectorId = user.scope === 'company'
    ? (requested || user.sector_id || allSectors[0]?.id || 'SOLUTIONS')
    : (user.sector_id || 'SOLUTIONS');

  const sd = await sectorDashboard(user, sectorId, { year });
  if (!sd) return layout({ user, active: 'sector', title: G.commandCenter, body: `<div class="empty-state"><div class="t">لا يوجد قطاع مرتبط بحسابك</div><div class="s">اطلب من مدير النظام ربطك بقطاع لعرض مركز قيادته.</div></div>` });

  const canInvoices = can(user, 'read', 'invoice');
  const canContracts = can(user, 'read', 'contract');
  const [chg, attn, fc, monthly, qRev, qBook, aging, cover, staff, clients, wins] = await Promise.all([
    changesSince(user, sectorId, sinceForWindow(win, now)),
    attentionFeed(user, sectorId, { year, today }),
    revenueForecast(sectorId, year),
    monthlyRevenue(sectorId, year),
    quarterlyRevenue(sectorId, year),
    quarterlyBookings(sectorId, year),
    pipelineAging(sectorId, today),
    pipelineCoverage(sectorId, year),
    sectorStaffing(sectorId, year),
    sectorClients(sectorId),
    sectorWins(sectorId, year),
  ]);
  const pipe = await all(`SELECT st.id, st.name_ar, st.color, COUNT(*) AS "count", COALESCE(SUM(o.value_halalas),0) value_halalas,
      COALESCE(SUM(o.value_halalas * o.win_pct / 100.0),0) weighted
     FROM opportunity o JOIN stage st ON st.id = o.stage_id
     WHERE st.is_won = 0 AND st.is_lost = 0 AND o.deleted_at IS NULL AND o.sector_id = ?
     GROUP BY st.id, st.name_ar, st.color, st.sort_order ORDER BY st.sort_order`, [sectorId]);
  const activeC = canContracts ? await get(`SELECT COUNT(*) n, COALESCE(SUM(value_halalas),0) v FROM contract
     WHERE sector_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'`, [sectorId]) : null;
  const secContracts = canContracts ? await all(`SELECT c.id, c.code, c.value_halalas, c.status, c.start_date, cl.name_ar client,
     (SELECT COALESCE(SUM(i.amount_halalas),0) FROM invoice i WHERE i.contract_id = c.id AND i.status != 'DRAFT' AND i.deleted_at IS NULL) invoiced
     FROM contract c LEFT JOIN client cl ON cl.id = c.client_id
     WHERE c.sector_id = ? AND c.deleted_at IS NULL ORDER BY c.value_halalas DESC LIMIT 10`, [sectorId]) : [];
  const revByProject = await all(`SELECT p.id, p.name_ar, p.status, p.rag, p.progress_pct,
       COALESCE(NULLIF(p.contract_value_halalas,0), NULLIF(p.budget_halalas,0), NULLIF(p.po_value_halalas,0)) cv,
       CASE WHEN COALESCE(p.contract_value_halalas,0)>0 THEN 'عقد' WHEN COALESCE(p.budget_halalas,0)>0 THEN 'ميزانية'
            WHEN COALESCE(p.po_value_halalas,0)>0 THEN 'أمر شراء' ELSE NULL END cvbasis,
       COALESCE(SUM(rl.amount_halalas),0) rev
     FROM revenue_line rl LEFT JOIN project p ON p.id = rl.project_id
     WHERE rl.sector_id = ? AND rl.year = ? GROUP BY p.id, p.name_ar, p.status, p.rag, p.progress_pct, p.contract_value_halalas, p.budget_halalas, p.po_value_halalas
     ORDER BY rev DESC LIMIT 12`, [sectorId, year]);
  const secWon = await all(`SELECT o.title_ar, o.value_halalas, c.name_ar client FROM opportunity o
     JOIN stage st ON st.id = o.stage_id LEFT JOIN client c ON c.id = o.client_id
     WHERE o.sector_id = ? AND o.year = ? AND st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL
     ORDER BY o.value_halalas DESC LIMIT 8`, [sectorId, year]);
  const recentDecisions = await all(`SELECT d.title, d.decided_by, substr(d.decided_at,1,10) dat, p.name_ar project
     FROM decision d LEFT JOIN project p ON p.id = d.project_id
     WHERE (p.sector_id = ? OR d.project_id IS NULL) AND d.deleted_at IS NULL ORDER BY d.decided_at DESC LIMIT 5`, [sectorId]);
  const pendingApprovals = await all(`SELECT ar.resource, ar.amount_halalas, ar.created_at FROM approval_request ar
     WHERE ar.sector_id = ? AND ar.status = 'PENDING' ORDER BY ar.created_at DESC LIMIT 6`, [sectorId]);

  // ── (1) عدسة الفترة — حالة واحدة تقود «ما تغيّر» وصدى عناوينه ──
  const lens = `<div class="seg" role="group" aria-label="عدسة الفترة">${WINS.map(([k, l]) =>
    `<button type="button" class="${k === win ? 'on' : ''}" onclick="const p=new URLSearchParams(location.search);p.set('win','${k}');location.search=p.toString()">${l}</button>`).join('')}</div>`;

  // ── (2) «ما تغيّر» — سجلات حقيقية مؤرّخة فقط ──
  const relDay = (at) => {
    const d = Math.floor((Date.parse(today) - Date.parse(String(at).slice(0, 10))) / 86400000);
    if (!Number.isFinite(d) || d < 0) return String(at).slice(0, 10);
    if (d === 0) return 'اليوم';
    if (d === 1) return 'أمس';
    if (d === 2) return 'قبل يومين';
    if (d <= 10) return `قبل ${d} أيام`;
    return String(at).slice(0, 10);
  };
  // شارات الأنواع — النوعان الماليان يظهران فقط لمن يقرأ الفواتير (لا «فواتير 0» مضللة لغيرهم)
  const chipDefs = [['stage', 'حركات مراحل'], ['invoice', 'فواتير'], ['collection', 'تحصيل'], ['activity', 'تواصل'], ['created', 'سجلات جديدة']]
    .filter(([k]) => canInvoices || (k !== 'invoice' && k !== 'collection'));
  const chgChips = chipDefs.map(([k, l]) => `<span class="pill" style="${chg.counts[k] ? 'background:#eef2fb;color:var(--brand)' : 'background:#f1f5f9;color:var(--faint)'}">${l} <b class="tnum">${chg.counts[k]}</b></span>`).join('');
  const chgRows = chg.items.map((it) => {
    const [bg, fg] = it.won ? ['#dcfce7', 'var(--green)'] : it.lost ? ['#fee2e2', 'var(--red)'] : (CHG_TONE[it.kind] || CHG_TONE.activity);
    return `<a class="chg${it.won ? ' won' : ''}${it.lost ? ' lost' : ''}" href="${esc(it.href)}">
      <span class="ic" style="background:${bg};color:${fg}">${icon(CHG_IC[it.kind] || 'history')}</span>
      <span class="tx"><span class="h">${esc(it.title)}</span>${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}</span>
      <span class="meta">${it.amount_halalas ? `<span class="amt tnum">${fmtSar(it.amount_halalas)}</span>` : ''}<span class="d tnum">${relDay(it.at)}</span></span>
    </a>`;
  }).join('');
  const changesCard = card(`
    <div class="card-head"><span class="t">${G.whatChanged} ${winEcho}</span>
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)">سجلات مؤرّخة فقط — لا تقدير</span></div>
    <div style="padding:.5rem .8rem;display:flex;gap:.3rem;flex-wrap:wrap;border-bottom:1px dashed var(--line)">${chgChips}</div>
    <div style="padding:.45rem .5rem;display:flex;flex-direction:column;gap:2px;max-height:430px;overflow-y:auto">
      ${chgRows || `<div class="empty-state" style="padding:1.2rem 1rem">${icon('history')}<div class="t">لا تغييرات مسجلة خلال هذه الفترة</div><div class="s">وسّع العدسة أعلاه إلى الشهر أو الربع لرؤية حركة أقدم</div></div>`}
    </div>`);

  // ── (3) يحتاج انتباهك الآن ──
  const toneBg = { brand: 'rgba(36,74,153,.1)', green: '#dcfce7', amber: '#fef3c7', red: '#fee2e2' };
  const attnItems = attn.map((a) => `
    <div class="attn">
      <span class="ic" style="background:${toneBg[a.tone] || '#f1f5f9'};color:${TONE[a.tone] || 'var(--ink2)'}">${icon(a.icon)}</span>
      <span class="tx"><span class="h">${esc(a.title)}</span>${a.sub ? `<div class="s">${esc(a.sub)}</div>` : ''}</span>
      ${a.dd ? `<button class="btn btn-sm go" onclick="Sanad.openDD('${a.dd}')">${esc(a.action)}</button>`
        : `<a class="btn btn-sm go" href="${a.href}${a.href.includes('?') ? '&' : '?'}year=${year}${user.scope === 'company' ? '&sector=' + sectorId : ''}">${esc(a.action)}</a>`}
    </div>`).join('');
  const attnCard = card(`
    <div class="card-head">
      <span class="t">${G.attention}</span>
      ${attn.length ? `<span class="pill" style="background:#fee2e2;color:#991b1b">${attn.length}</span>` : ''}
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)">مرتبة حسب أثر القرار</span>
    </div>
    <div style="padding:.6rem .7rem;display:flex;flex-direction:column;gap:.45rem">
      ${attnItems || `<div class="alert ok" style="justify-content:center">${icon('approvals')} ${G.nothingNeedsYou} — ${G.allGood}</div>`}
    </div>`);

  // ── (4) الإيقاع مقابل الخطة — مقياس الشريط = المستهدف السنوي فقط (لا تشويه بالمتوقع) ──
  const elapsed = yearElapsedPct(now, year);
  const mMax = Math.max(1, ...monthly);
  const nowM = currentMonthIndex(year);
  const monthlyBars = `<div class="mtrack" style="gap:4px">${monthly.map((v, i) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0" title="${monthLabel(i)}: ${fmtSar(v)}">
      <div style="height:9px;display:flex;align-items:center">${i === nowM ? nowDot() : ''}</div>
      <div style="width:100%;border-radius:4px 4px 0 0;background:${i === nowM ? 'var(--brand2)' : 'var(--brand)'};opacity:${v ? 1 : .18};height:${Math.max(3, Math.round((v / mMax) * 46))}px"></div>
      <span style="font-size:8.5px;color:var(--faint);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${monthLabelDual(i)}</span>
    </div>`).join('')}</div>`;
  const paceSection = card(`
    <div class="card-head"><span class="t">الإيقاع مقابل الخطة</span>
      <span class="aux" style="font-size:var(--fs-micro);color:var(--faint)" data-tip="مقياس الشريط هو المستهدف السنوي: 100% = الهدف. النقطة الذهبية = أين يجب أن نكون اليوم">كيف يُقرأ؟ ⓘ</span></div>
    <div style="padding:var(--pad-card-b);display:grid;gap:.55rem">
      ${paceCard({ label: `${G.revenue} ${year}`, actual: sd.revenue_halalas, target: sd.target_revenue_halalas, forecast: fc.forecast, weightedOpen: fc.weightedOpen, today: now, year, color: 'var(--green)', dd: 'secrev' })}
      ${paceCard({ label: `${G.sales} ${year}`, actual: sd.sales_halalas, target: sd.target_sales_halalas, today: now, year, color: 'var(--brand2)', dd: 'secwins' })}
      <div style="display:flex;justify-content:center">
        <span class="pill" style="background:#fdf6e3;color:#8a6d1a;gap:.4rem">${nowDot('')} ${G.yearElapsed(elapsed)}</span>
      </div>
      <div style="padding:.5rem .7rem .4rem;border:1px solid var(--line);border-radius:12px;background:#fff">
        <div style="font-size:var(--fs-micro);color:var(--muted);font-weight:700;margin-bottom:.35rem">${G.revenue} الشهري ${year} — توزيع، لا مقارنة بهدف</div>
        ${monthlyBars}
      </div>
    </div>`);

  // ── (5) قمع الفرص: عرض كل مرحلة ∝ قيمتها + نسبة الانتقال بين المراحل (من الأعداد الحالية) ──
  const openTotal = pipe.reduce((a, b) => a + b.value_halalas, 0);
  const weightedTotal = Math.round(pipe.reduce((a, b) => a + b.weighted, 0));
  // «معلّقة» قرار تأجيل لا مرحلة بيع — تخرج من مسار القمع وتُعرض جانباً كي لا يقرأ
  // «93% تنتقل» نحو التعليق وكأنه تقدم
  const funnelStages = pipe.filter((st) => st.id !== 'ON_HOLD');
  const onHoldStage = pipe.find((st) => st.id === 'ON_HOLD');
  const maxPipe = Math.max(1, ...funnelStages.map((s) => s.value_halalas));
  const funnelRows = funnelStages.map((s, i) => {
    const w = Math.max(12, Math.round((s.value_halalas / maxPipe) * 100));
    const next = funnelStages[i + 1];
    const conv = next && s.count > 0 ? Math.round((next.count / s.count) * 100) : null;
    return `<div title="${esc(s.name_ar)}: ${s.count} فرصة بقيمة ${fmtSar(s.value_halalas)}">
      <div class="fnl-lbl">
        <span style="font-weight:700">${esc(s.name_ar)}</span>
        <b class="tnum">${s.count}</b>
        <span class="tnum" style="color:var(--muted);font-size:var(--fs-micro)">${sarShort(s.value_halalas)}</span>
      </div>
      <div class="fnl-bar" style="width:${w}%;background:${s.color || 'var(--brand)'}"></div>
    </div>
    ${conv != null ? `<div class="fnl-conv">↓ <b class="tnum">${conv}%</b> تنتقل</div>` : ''}`;
  }).join('');
  const agingMax = Math.max(1, ...aging.map((b) => b.v));
  const agingRows = aging.map((b, i) => `<div style="display:flex;align-items:center;gap:.5rem;font-size:var(--fs-meta);padding:.2rem 0">
      <span style="flex:0 0 96px;color:var(--muted)">${b.label}</span>
      <div class="bar" style="flex:1"><span style="width:${Math.round((b.v / agingMax) * 100)}%;background:${i >= 2 ? 'var(--amber)' : 'var(--brand)'}"></span></div>
      <span class="tnum" style="flex:none;font-weight:700">${b.n}</span>
      <span class="tnum" style="flex:none;color:var(--muted);font-size:var(--fs-micro)">${fmtSar(b.v)}</span>
    </div>`).join('');
  const funnelCard = card(`
    <div class="card-head">
      <span class="t">${G.funnel}</span>
      <span class="aux"><a class="btn btn-sm" href="/app/opportunities?year=${year}${user.scope === 'company' ? '&sector=' + sectorId : ''}">اللوحة الكاملة</a></span></div>
    <div style="padding:.6rem 1rem;display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;border-bottom:1px dashed var(--line)">
      <div><div style="font-size:10px;color:var(--muted)">${G.raw}</div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm)">${fmtSar(openTotal)}</div></div>
      <div data-tip="مجموع (قيمة الفرصة × ${G.probability}) لكل الفرص المفتوحة"><div style="font-size:10px;color:var(--muted)">${G.weighted} ⓘ</div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:var(--brand)">${fmtSar(weightedTotal)}</div></div>
      <div data-tip="المكسوبة ÷ المحسومة (فوز + خسارة) لسنة ${year} — التاريخي مستثنى"><div style="font-size:10px;color:var(--muted)">${G.winRate} ${year} ⓘ</div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:var(--green)">${wins.winRate}%</div></div>
      <div data-tip="${G.raw} من الفرص المفتوحة ÷ المتبقي من هدف المبيعات — أقل من ×1 يعني الحاجة لفرص جديدة"><div style="font-size:10px;color:var(--muted)">التغطية ⓘ</div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:${(cover?.coverage ?? 1) < 1 ? 'var(--amber)' : 'var(--ink2)'}">${cover?.coverage != null ? '×' + cover.coverage : '—'}</div></div>
    </div>
    <div style="padding:.6rem 1rem .5rem">${funnelRows || `<div class="empty-state" style="padding:1rem"><div class="s">${G.emptyList}</div></div>`}
      ${onHoldStage && onHoldStage.count ? `<div style="font-size:var(--fs-micro);color:var(--muted);border-top:1px dashed var(--line);padding-top:.4rem;margin-top:.2rem">خارج القمع: <b class="tnum">${countAr(onHoldStage.count, { one: 'فرصة واحدة معلّقة', two: 'فرصتان معلّقتان', few: 'فرص معلّقة', many: 'فرصة معلّقة' })}</b> بقيمة <b class="tnum">${sarShort(onHoldStage.value_halalas)}</b> — بقرار تأجيل يُراجع دورياً</div>` : ''}</div>
    <div style="padding:.5rem 1rem .6rem;border-top:1px dashed var(--line)">
      <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted);margin-bottom:.2rem">عمر الفرص في مرحلتها الحالية</div>${agingRows}
    </div>`);

  // ── (6) التحصيل — يظهر فقط لمن يقرأ الفواتير (لا تسريب مالي لبقية الأدوار) ──
  let collectCard = '', collectDD = '';
  if (canInvoices) {
    const buckets = await arAging(user, year, { sector: sectorId });
    const odRaw = await all(`SELECT i.id, i.code, i.amount_halalas, i.retention_halalas, i.due_date, cl.name_ar client, p.name_ar project,
        (SELECT COALESCE(SUM(col.amount_halalas),0) FROM collection col WHERE col.invoice_id = i.id) collected
      FROM invoice i LEFT JOIN project p ON p.id = i.project_id LEFT JOIN client cl ON cl.id = i.client_id
      WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL
        AND i.status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')
        AND (i.status = 'OVERDUE' OR (i.due_date IS NOT NULL AND substr(i.due_date,1,10) < ?))
      ORDER BY i.due_date LIMIT 12`, [sectorId, today]);
    const odRows = odRaw.map((r) => ({
      ...r,
      out: Math.max(0, (r.amount_halalas || 0) - (r.retention_halalas || 0) - (r.collected || 0)),
      days: r.due_date ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(String(r.due_date).slice(0, 10))) / 86400000)) : null,
    })).filter((r) => r.out > 0);
    const BUCKETS = [['0-30', 'حتى شهر من الإصدار'], ['31-60', 'شهر إلى شهرين'], ['61-90', 'شهران إلى ثلاثة'], ['90+', 'أكثر من ثلاثة أشهر']];
    const arTotal = BUCKETS.reduce((a, [k]) => a + (buckets[k] || 0), 0);
    const bMax = Math.max(1, ...BUCKETS.map(([k]) => buckets[k] || 0));
    const bucketRows = BUCKETS.map(([k, l], i) => `<div style="display:flex;align-items:center;gap:.5rem;font-size:var(--fs-meta);padding:.2rem 0">
        <span style="flex:0 0 128px;color:var(--muted)">${l}</span>
        <div class="bar" style="flex:1"><span style="width:${Math.round(((buckets[k] || 0) / bMax) * 100)}%;background:${i >= 2 ? 'var(--red)' : i === 1 ? 'var(--amber)' : 'var(--brand)'}"></span></div>
        <span class="tnum" style="flex:none;font-weight:700;font-size:var(--fs-micro)">${fmtSar(buckets[k] || 0)}</span>
      </div>`).join('');
    const lateRows = odRows.slice(0, 3).map((r) => `<div class="cardclick" role="button" tabindex="0" onclick="Sanad.openDD('seccollect')" style="display:flex;justify-content:space-between;gap:.6rem;align-items:baseline;padding:.32rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body)">
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.client || r.project || 'فاتورة')}${r.code ? ` <span style="color:var(--faint);font-size:var(--fs-micro)"><bdi>${esc(r.code)}</bdi></span>` : ''}</span>
        <span style="flex:none;display:flex;gap:.5rem;align-items:baseline">
          <b class="tnum">${fmtSar(r.out)}</b>
          ${r.days != null ? `<span class="pill" style="background:#fee2e2;color:#991b1b">متأخر <b class="tnum">${r.days}</b> ${r.days >= 3 && r.days <= 10 ? 'أيام' : 'يوماً'}</span>` : ''}
        </span>
      </div>`).join('');
    collectCard = card(`
      <div class="card-head">
        <span class="t">التحصيل</span>
        <span class="aux"><a class="btn btn-sm" href="/app/finance?year=${year}">المالية والعقود</a></span></div>
      ${arTotal || odRows.length ? `
      <div class="cardclick" role="button" tabindex="0" onclick="Sanad.openDD('seccollect')" style="padding:.55rem 1rem;display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px dashed var(--line)">
        <span style="font-size:var(--fs-micro);color:var(--muted)">${G.outstanding} للقطاع · ${year} <span style="color:var(--faint)">⊕</span></span>
        <b class="tnum" style="font-size:var(--fs-num-sm);color:${arTotal ? 'var(--amber)' : 'var(--ink2)'}">${fmtSar(arTotal)}</b></div>
      <div style="padding:.45rem 1rem .3rem">
        <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted);margin-bottom:.15rem">أعمار المستحقات منذ إصدار الفاتورة</div>${bucketRows}
      </div>
      <div style="padding:.35rem 1rem .6rem">
        <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted)">${G.lateClaim}${odRows.length > 3 ? ` — الأكثر تأخراً (3 من ${odRows.length})` : ''}</div>
        ${lateRows || `<div style="font-size:var(--fs-meta);color:var(--faint);padding:.3rem 0">لا فواتير متأخرة السداد — التحصيل منضبط</div>`}
        ${odRows.length > 3 ? `<button class="btn btn-ghost btn-sm" onclick="Sanad.openDD('seccollect')" style="margin-top:.2rem">+${odRows.length - 3} أخرى — الكل ⊕</button>` : ''}
      </div>`
      : `<div class="empty-state" style="padding:1.2rem 1rem">${icon('money')}<div class="t">لا مستحقات قائمة لهذا القطاع · ${year}</div><div class="s">كل الفواتير الصادرة لهذه السنة حُصّلت، أو لم تصدر فواتير بعد</div></div>`}`);
    collectDD = ddWrap('seccollect', `${G.lateClaim} — ${esc(sd.sector.name_ar)}`, `فواتير قائمة تجاوزت تاريخ استحقاقها · حتى ${today}`, `
      <div class="dd-kpi"><span class="v tnum" style="color:var(--amber)">${fmtSar(odRows.reduce((a, b) => a + b.out, 0))}</span><span style="font-size:12px;color:var(--muted)">${odRows.length ? `على ${countAr(odRows.length, { one: 'فاتورة واحدة', two: 'فاتورتين', few: 'فواتير', many: 'فاتورة' })}` : 'لا فواتير متأخرة'}</span></div>
      <div class="dd-sec">حسب تاريخ الاستحقاق</div>
      <div>${ddRows(odRows.map((r) => `<div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.client || r.project || 'فاتورة')}${r.code ? ` <span style="color:var(--faint);font-size:10.5px"><bdi>${esc(r.code)}</bdi></span>` : ''}</span>
          <b class="tnum" style="flex:none">${fmtSar(r.out)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted)">
          <span>يستحق ${r.due_date ? String(r.due_date).slice(0, 10) : '—'}</span>${r.days != null ? `<span class="tnum" style="color:var(--red);font-weight:800">متأخر ${dayWord(r.days)}</span>` : ''}</div>
      </div>`))}</div>`);
  }

  // ── (7) صحة المشاريع والانحرافات ──
  const ragColor = { GREEN: 'var(--green)', AMBER: 'var(--amber)', RED: 'var(--red)' };
  const projRows = revByProject.filter((r) => r.id).slice(0, 8).map((r) => {
    const pcv = r.cv ? Math.round((r.rev / r.cv) * 100) : null;
    return `<a href="/app/project/${r.id}" style="display:block;padding:.42rem 0;border-bottom:1px dashed var(--line)">
      <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:var(--fs-body);align-items:center">
        <span style="display:flex;align-items:center;gap:.45rem;min-width:0"><span style="width:8px;height:8px;border-radius:50%;background:${ragColor[r.rag] || 'var(--faint)'};flex:none"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name_ar)}</span></span>
        <b class="tnum" style="flex:none">${fmtSar(r.rev)}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:var(--fs-micro);color:var(--muted);margin-top:.12rem">
        <span>${tr(r.status)}${pcv != null ? '' : ' · بلا قيمة مسجلة'}</span>${pcv != null ? `<span class="tnum">حقّق ${pcv}% من قيمته</span>` : ''}</div>
      ${pcv != null ? `<div class="bar" style="margin-top:.2rem;height:4px"><span style="width:${Math.min(100, pcv)}%;background:var(--green)"></span></div>` : ''}
    </a>`;
  }).join('') || `<div class="empty-state" style="padding:1rem"><div class="s">لا مشاريع مولّدة للإيراد هذه السنة حتى الآن</div></div>`;
  const ragPills = [['GREEN', G.hOnTrack, 'green'], ['AMBER', G.hAtRisk, 'amber'], ['RED', G.hCritical, 'red']]
    .filter(([k]) => sd.rag[k]).map(([k, l, c]) => pill(`${l} ${sd.rag[k]}`, c)).join('');
  const projectsCard = card(`
    <div class="card-head">
      <span class="t">صحة ${G.projects}</span>
      <span class="aux">
        ${ragPills}
        ${sd.openRisks ? pill(`${G.risks} ${sd.openRisks}`, 'red') : ''}
        <a class="btn btn-sm" href="/app/projects?year=${year}${user.scope === 'company' ? '&sector=' + sectorId : ''}">الكل</a>
      </span></div>
    <div style="padding:.45rem 1rem .6rem">${projRows}</div>`);

  // ── (8) الطاقة (ملخص يقود إلى مساحة التسكين) ──
  const over = (staff.employees || []).filter((e) => e.current > 110);
  const bench = (staff.employees || []).filter((e) => e.current === 0);
  const capCard = card(`
    <div class="card-head">
      <span class="t">${G.capacity}</span>
      <span class="aux"><a class="btn btn-sm" href="/app/staffing?year=${year}${user.scope === 'company' ? '&sector=' + sectorId : ''}">مساحة التسكين</a></span></div>
    <div style="padding:var(--pad-card-b);display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">
      <div><div style="font-size:10px;color:var(--muted)">${G.utilization} الآن</div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:${(staff.teamCurrent ?? 0) > 100 ? 'var(--red)' : 'var(--ink2)'}">${staff.teamCurrent ?? staff.teamUtil}%</div><div style="font-size:9.5px;color:var(--faint)">سنوياً ${staff.teamUtil}% · ${countAr(staff.headcount, { one: 'موظف واحد', two: 'موظفان', few: 'موظفين', many: 'موظفاً' })}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">${G.overloaded}</div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:${over.length ? 'var(--red)' : 'var(--ink2)'}">${over.length}</div>${over.length ? `<div style="font-size:9.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(over.slice(0, 2).map((e) => e.name).join('، '))}</div>` : ''}</div>
      <div><div style="font-size:10px;color:var(--muted)">${G.onBench}</div><div class="tnum" style="font-weight:800;font-size:var(--fs-num-sm);color:${bench.length ? 'var(--amber)' : 'var(--ink2)'}">${bench.length}</div>${bench.length ? `<div style="font-size:9.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(bench.slice(0, 2).map((e) => e.name).join('، '))}</div>` : ''}</div>
    </div>`);

  // ── (9) العملاء ──
  const clientRows = clients.slice(0, 8).map((c) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:var(--pad-cell);font-size:var(--fs-body)">${esc(c.name_ar)}</td>
    <td style="padding:var(--pad-cell);text-align:center;font-size:12px" class="tnum">${c.opps}</td>
    <td style="padding:var(--pad-cell);text-align:center;font-size:12px" class="tnum">${c.projects}</td>
    <td style="padding:var(--pad-cell);text-align:left;font-size:12px;font-weight:700" class="tnum">${fmtSar(c.pipeline_halalas)}</td></tr>`).join('')
    || `<tr><td colspan="4"><div class="empty-state" style="padding:1rem"><div class="s">${G.emptyList}</div></div></td></tr>`;
  const th = (t) => `<th style="padding:var(--pad-cell);font-size:var(--fs-micro);color:var(--muted);font-weight:700;text-align:${t.a || 'right'}">${t.t}</th>`;
  const clientsCard = card(`
    <div class="card-head"><span class="t">${G.clients}</span></div>
    <div class="tblwrap"><table style="width:100%;border-collapse:collapse"><thead><tr>${th({ t: G.client })}${th({ t: 'فرص', a: 'center' })}${th({ t: 'مشاريع', a: 'center' })}${th({ t: G.pipeline, a: 'left' })}</tr></thead><tbody>${clientRows}</tbody></table></div>`);

  // ── (10) القرارات والاعتمادات ──
  const decRows = recentDecisions.map((d) => `<div style="padding:.35rem 0;border-bottom:1px dashed var(--line);font-size:12px">
      <div style="font-weight:700">${esc(d.title)}</div>
      <div style="font-size:var(--fs-micro);color:var(--muted)">${esc(d.project || '')}${d.decided_by ? ' · ' + esc(d.decided_by) : ''}${d.dat ? ' · ' + d.dat : ''}</div>
    </div>`).join('') || `<div style="font-size:var(--fs-meta);color:var(--faint);padding:.35rem 0">لا قرارات مسجلة بعد — تُسجَّل القرارات من صفحة المشروع</div>`;
  const apRows = pendingApprovals.map((a) => `<div style="display:flex;justify-content:space-between;gap:.6rem;padding:.3rem 0;border-bottom:1px dashed var(--line);font-size:12px">
      <span>${esc(RESOURCE_AR[a.resource] || tr(a.resource) || 'طلب')}</span>
      <b class="tnum" style="flex:none">${a.amount_halalas ? fmtSar(a.amount_halalas) : ''}</b>
    </div>`).join('') || `<div style="font-size:var(--fs-meta);color:var(--faint);padding:.3rem 0">لا طلبات معلقة</div>`;
  const decisionsCard = card(`
    <div class="card-head">
      <span class="t">${G.decisions} والاعتمادات</span>
      <span class="aux"><a class="btn btn-sm" href="/app/approvals">${G.needsDecision}</a></span></div>
    <div style="padding:.5rem 1rem .6rem">
      <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted)">طلبات معلقة في القطاع</div>${apRows}
      <div style="font-size:var(--fs-micro);font-weight:700;color:var(--muted);margin-top:.5rem">آخر القرارات</div>${decRows}
    </div>`);

  // ── (11) المقارنات والتقارير — أرباع بأسمائها الكاملة، يُقرأ زمنياً كما يُقرأ النص (RTL) ──
  const qRevN = (qRev || []).map((r) => (typeof r === 'number' ? r : r.revenue_halalas || 0));
  const qBookN = (qBook || []).map((r) => (typeof r === 'number' ? r : r.sales_halalas || 0));
  const qMax = Math.max(1, ...qRevN, ...qBookN);
  const nowQ = year === now.getUTCFullYear() ? Math.floor(now.getUTCMonth() / 3) : -1;
  const qBars = `<div style="display:grid;grid-template-columns:repeat(4,1fr);direction:rtl;gap:.5rem">${[0, 1, 2, 3].map((i) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="height:9px;display:flex;align-items:center">${i === nowQ ? nowDot('الربع الحالي') : ''}</div>
      <div style="display:flex;gap:3px;align-items:flex-end;height:52px">
        <div title="${G.revenue}: ${fmtSar(qRevN[i])}" style="width:14px;border-radius:3px 3px 0 0;background:var(--green);height:${Math.max(3, Math.round((qRevN[i] / qMax) * 48))}px"></div>
        <div title="${G.bookings}: ${fmtSar(qBookN[i])}" style="width:14px;border-radius:3px 3px 0 0;background:var(--brand2);height:${Math.max(3, Math.round((qBookN[i] / qMax) * 48))}px"></div>
      </div><span style="font-size:9.5px;color:var(--faint);white-space:nowrap">${quarterLabel(i)}</span></div>`).join('')}</div>`;
  const qDelta = nowQ > 0 && qRevN[nowQ - 1] ? Math.round(((qRevN[nowQ] - qRevN[nowQ - 1]) / qRevN[nowQ - 1]) * 100) : null;
  const reportsCard = card(`
    <div class="card-head"><span class="t">المقارنات والتقارير</span></div>
    <div style="padding:var(--pad-card-b)">
      ${qBars}
      <div style="display:flex;gap:.8rem;font-size:10px;color:var(--muted);justify-content:center;margin-top:.3rem">
        <span><span style="display:inline-block;width:8px;height:8px;background:var(--green);border-radius:2px"></span> ${G.revenue}</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:var(--brand2);border-radius:2px"></span> ${G.bookings}</span></div>
      ${qDelta != null ? `<div style="font-size:var(--fs-meta);color:var(--muted);margin-top:.4rem">إيراد الربع الحالي ${qDelta >= 0 ? 'أعلى' : 'أدنى'} من الربع السابق بنسبة <b class="tnum" style="color:${qDelta >= 0 ? 'var(--green)' : 'var(--red)'}">${Math.abs(qDelta)}%</b></div>` : ''}
      <div style="display:flex;gap:.5rem;margin-top:.6rem;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="Sanad.previewReport('sector_weekly_status')">التقرير الأسبوعي</button>
        <button class="btn btn-sm" onclick="Sanad.previewReport('monthly_sector_performance')">التقرير الشهري</button>
        <button class="btn btn-sm" onclick="Sanad.testSend('sector_weekly_status')">أرسله لي الآن</button>
        <a class="btn btn-sm" href="/app/reports">جدولة دورية</a>
      </div>
    </div>`);

  // ── العقود (بطاقة موجزة تفتح التفصيل) — لمن يقرأ العقود فقط ──
  const contractsCard = canContracts ? card(`<div class="cardclick" role="button" tabindex="0" onclick="Sanad.openDD('seccontracts')" style="padding:.7rem 1rem">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:var(--fs-body);font-weight:700">العقود النشطة <span style="color:var(--faint)">⊕</span></span>
      <b class="tnum" style="font-size:var(--fs-num-sm)">${fmtSar(activeC.v)}</b></div>
    <div style="font-size:var(--fs-micro);color:var(--muted);margin-top:.15rem">${countAr(activeC.n, { one: 'عقد نشط واحد', two: 'عقدان نشطان', few: 'عقود نشطة', many: 'عقداً نشطاً' })} · موقّع ${year}: ${sd.contracts_count} (${fmtSar(sd.contracts_halalas)})</div>
  </div>`, 'card-h') : '';

  // ── drill-down templates ──
  const lateDlv = (attn.find((a) => a.dd === 'att-late-dlv')?.ddRowsData) || [];
  const DD = `
  ${ddWrap('secrev', `${G.revenue} حسب المشروع · ${year}`, `${esc(sd.sector.name_ar)} · المحقق مقابل قيمة كل مشروع`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--green)">${fmtSar(sd.revenue_halalas)}</span><span style="font-size:12px;color:var(--muted)">إجمالي المحقق ${year} · ${G.forecast}: ${fmtSar(fc.forecast)}</span></div>
    ${attain(sd.revenue_halalas, sd.target_revenue_halalas, 'var(--green)')}
    <div class="dd-sec">المشاريع المولِّدة للإيراد</div>
    <div>${ddRows(revByProject.map((r) => { const pcv = r.cv ? Math.round((r.rev / r.cv) * 100) : null; return `
      <div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.id ? esc(r.name_ar) : 'إيراد غير مرتبط بمشروع'}</span>
          <b class="tnum" style="flex:none">${fmtSar(r.rev)}</b></div>
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:10.5px;color:var(--muted)">
          <span>${r.cv ? 'قيمة المشروع (' + (r.cvbasis || '') + ') ' + fmtSar(r.cv) : 'بلا قيمة مسجلة'}</span>${pcv != null ? `<span class="tnum" style="font-weight:800">حقّق ${pcv}%</span>` : ''}</div>
        ${pcv != null ? `<div class="bar" style="margin-top:.25rem;height:5px"><span style="width:${Math.min(100, pcv)}%;background:var(--green)"></span></div>` : ''}
      </div>`; }))}</div>`)}
  ${canContracts ? ddWrap('seccontracts', 'سجل عقود القطاع', `${esc(sd.sector.name_ar)} · النشطة + الموقّعة حسب السنة`, `
    <div class="dd-kpi"><span class="v tnum">${fmtSar(activeC.v)}</span><span style="font-size:12px;color:var(--muted)">${countAr(activeC.n, { one: 'عقد نشط واحد', two: 'عقدان نشطان', few: 'عقود نشطة', many: 'عقداً نشطاً' })} · موقّع ${year}: ${sd.contracts_count} (${fmtSar(sd.contracts_halalas)})</span></div>
    <div class="dd-sec">أكبر العقود</div>
    <div>${ddRows(secContracts.map((c) => { const ip = c.value_halalas ? Math.min(100, Math.round(((c.invoiced || 0) / c.value_halalas) * 100)) : 0; return `
      <div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/app/contract/${c.id}" style="color:var(--brand)">${esc(c.client || c.code || 'عقد')}</a>${c.code ? ` <span style="color:var(--faint);font-size:10.5px"><bdi>${esc(c.code)}</bdi></span>` : ''}</span>
          <b class="tnum" style="flex:none">${fmtSar(c.value_halalas)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted)"><span>${tr(c.status)}${c.start_date ? ' · ' + String(c.start_date).slice(0, 10) : ''}</span><span class="tnum">فُوتر ${ip}%</span></div>
        <div class="bar" style="margin-top:.25rem;height:5px"><span style="width:${ip}%;background:var(--blue)"></span></div>
      </div>`; }))}</div>`) : ''}
  ${ddWrap('secwins', `${G.sales} والفوز · ${year}`, `${esc(sd.sector.name_ar)} · مقابل هدف المبيعات`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--brand2)">${fmtSar(sd.sales_halalas)}</span><span style="font-size:12px;color:var(--muted)">${countAr(wins.won, { one: 'صفقة واحدة مكسوبة', two: 'صفقتان مكسوبتان', few: 'صفقات مكسوبة', many: 'صفقة مكسوبة' })} · ${G.winRate} ${wins.winRate}%</span></div>
    ${attain(sd.sales_halalas, sd.target_sales_halalas, 'var(--brand2)')}
    <div class="dd-sec">الصفقات المكسوبة</div>
    <div>${ddRows(secWon.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(d.client || '—')}</span></span><b class="tnum" style="flex:none">${fmtSar(d.value_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('att-late-dlv', 'مخرجات تحتاج متابعة', `${esc(sd.sector.name_ar)} · أشهر سابقة لم تصل للفوترة`, `
    <div>${ddRows(lateDlv.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.project || '')} · ${esc(d.name_ar)} <span style="color:var(--faint);font-size:10.5px">${MONTHS_AR[(d.month - 1) % 12] || ''}</span></span><b class="tnum" style="flex:none">${fmtSar(d.amount_halalas || 0)}</b></div>`))}</div>`)}
  ${collectDD}`;

  const switcher = user.scope === 'company' ? `<div class="chips" style="margin-bottom:.6rem"><span class="lbl">القطاع:</span>
    ${allSectors.map((s) => `<a href="/app/sector?year=${year}&sector=${s.id}&win=${win}" class="chip ${s.id === sectorId ? 'on' : ''}"><span class="dot" style="background:${s.color || '#244A99'}"></span>${esc(s.name_ar)}</a>`).join('')}
    <a class="btn btn-sm" style="margin-inline-start:.3rem" href="/app/ceo?year=${year}&sector=${sectorId}">لوحة القيادة</a>
  </div>` : '';

  const finCol = [collectCard, contractsCard].filter(Boolean).join('');
  const row2 = finCol
    ? `<div class="sec-grid even"><div class="sec-col">${finCol}</div><div class="sec-col">${projectsCard}</div></div>`
    : `<div class="sec-grid" style="grid-template-columns:1fr"><div class="sec-col">${projectsCard}</div></div>`;

  const body = `${CSS}
    ${switcher}
    <div class="toolbar" style="margin-bottom:var(--gap)">
      ${lens}
      <span style="font-size:var(--fs-micro);color:var(--muted)">عدسة الفترة — تضبط نافذة «${G.whatChanged}»</span>
    </div>
    <div class="sec-grid">
      <div class="sec-col">${changesCard}${paceSection}</div>
      <div class="sec-col">${attnCard}${funnelCard}</div>
    </div>
    ${row2}
    <div class="sec-grid even">
      <div class="sec-col">${capCard}${decisionsCard}</div>
      <div class="sec-col">${clientsCard}${reportsCard}</div>
    </div>
    ${DD}`;
  return layout({ user, active: 'sector', title: `مركز قيادة ${esc(sd.sector.name_ar)}`, subtitle: `ما تغيّر، ما يحتاجك، وأين نقف مقابل الخطة · ${year}`, body, year });
}
