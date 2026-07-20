// Executive pages: CEO command dashboard + portfolio health.
import { layout, card, pill, miniBars, gauge, hbars } from '../layout.js';
import { fmtSar } from '../../core/util/ids.js';
import { all, get } from '../../core/db/index.js';
import { companyOverview, multiYearTrend, winRate,
  quarterlyRevenue, quarterlyBookings, backlog, pipelineCoverage, bookToBill, grossMargin } from '../../core/reports/metrics.js';
import { config } from '../../core/config.js';
import { listProjects } from '../../modules/pmo/projects.js';
import { sarShort, pct, esc, ddWrap, attain, ddRows } from './_shared.js';

export async function ceoPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const ov = await companyOverview(user, { year });
  // Owner flexibility: ?sector=ID filters the ENTIRE dashboard to one sector (chips below switch it);
  // every metric call takes the same scope (null = whole company), so the view stays coherent.
  const sec = opts.sector && ov.sectors.some((s) => s.id === opts.sector) ? opts.sector : null;
  const secObj = sec ? ov.sectors.find((s) => s.id === sec) : null;
  const scopeLabel = sec ? secObj.name_ar : 'الشركة كاملة';
  const t = sec
    ? { revenue: secObj.revenue_halalas, target_revenue: secObj.target_revenue_halalas,
        sales: secObj.sales_halalas, target_sales: secObj.target_sales_halalas }
    : ov.totals;
  const wr = await winRate(sec, year);
  const trend = await multiYearTrend(sec, 4);
  const qRev = await quarterlyRevenue(sec, year);
  const qBook = await quarterlyBookings(sec, year);
  const bk = await backlog(sec);
  const cov = await pipelineCoverage(sec, year);
  const b2b = await bookToBill(sec, year);
  const pipelineVal = sec
    ? (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
        WHERE st.is_won=0 AND st.is_lost=0 AND o.deleted_at IS NULL AND o.sector_id=?`, [sec])).v
    : ov.pipeline_halalas;
  // ── Drill-down datasets (KPI popups). Same filter as the page; embedded as inert <template>s. ──
  const spO = sec ? 'AND o.sector_id = ?' : '';
  const revLines = await all(`SELECT rl.amount_halalas, rl.month, rl.label, p.name_ar project, s.name_ar sector
     FROM revenue_line rl LEFT JOIN project p ON p.id=rl.project_id LEFT JOIN sector s ON s.id=rl.sector_id
     WHERE rl.year=? ${sec ? 'AND rl.sector_id = ?' : ''} ORDER BY rl.amount_halalas DESC LIMIT 8`, sec ? [year, sec] : [year]);
  const wonDeals = await all(`SELECT o.title_ar, o.value_halalas, c.name_ar client, s.name_ar sector
     FROM opportunity o JOIN stage st ON st.id=o.stage_id LEFT JOIN client c ON c.id=o.client_id LEFT JOIN sector s ON s.id=o.sector_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? AND o.deleted_at IS NULL ${spO}
     ORDER BY o.value_halalas DESC LIMIT 8`, sec ? [year, sec] : [year]);
  const pipeStages = await all(`SELECT st.id, st.name_ar, st.color, COUNT(*) n, COALESCE(SUM(o.value_halalas),0) v
     FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=0 AND st.is_lost=0 AND o.deleted_at IS NULL ${spO}
     GROUP BY st.id, st.name_ar, st.color, st.sort_order ORDER BY st.sort_order`, sec ? [sec] : []);
  const topContracts = await all(`SELECT c.code, c.value_halalas, cl.name_ar client, s.name_ar sector
     FROM contract c LEFT JOIN client cl ON cl.id=c.client_id LEFT JOIN sector s ON s.id=c.sector_id
     WHERE c.deleted_at IS NULL ${sec ? 'AND c.sector_id = ?' : ''} ORDER BY c.value_halalas DESC LIMIT 6`, sec ? [sec] : []);
  // Bookings reconciliation: the annual figure (won in THIS fiscal year, vs the annual target) vs the
  // cumulative book (all won deals ever — what the legacy platform showed as one headline number).
  const bookAll = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v, COUNT(*) n FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.deleted_at IS NULL ${spO}`, sec ? [sec] : []));
  const bookByYear = await all(`SELECT o.year, COALESCE(SUM(o.value_halalas),0) v, COUNT(*) n FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.deleted_at IS NULL ${spO} GROUP BY o.year ORDER BY o.year`, sec ? [sec] : []);
  const margins = ov.canSeeMargin
    ? await Promise.all(ov.sectors.map(async (s) => ({ id: s.id, name_ar: s.name_ar, color: s.color, margin: (await grossMargin(s.id, year)).margin_pct })))
    : [];
  const marginVals = margins.filter((m) => m.margin != null);
  const avgMargin = marginVals.length ? Math.round(marginVals.reduce((a, m) => a + m.margin, 0) / marginVals.length) : null;
  const revYoy = trend.length >= 2 ? (() => { const cur = trend[trend.length - 1].revenue_halalas, prev = trend[trend.length - 2].revenue_halalas; return prev ? Math.round((cur - prev) / prev * 100) : null; })() : null;
  const bookYoy = trend.length >= 2 ? (() => { const cur = trend[trend.length - 1].contracts_halalas, prev = trend[trend.length - 2].contracts_halalas; return prev ? Math.round((cur - prev) / prev * 100) : null; })() : null;
  const yoyBadge = (v) => v == null ? '' : `<span style="font-size:11px;font-weight:700;color:${v >= 0 ? '#34d399' : '#fca5a5'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}% سنويًا</span>`;
  // Book-to-Bill risk banner (Tier-1 insight): bookings vs revenue recognition.
  const riskBanner = (b2b.ratio != null && b2b.ratio < 1) ? `
    <div style="border-radius:12px;padding:.85rem 1.1rem;margin-bottom:1rem;background:linear-gradient(90deg,#7f1d1d,#b91c1c);color:#fff;display:flex;align-items:center;gap:.75rem">
      <span style="font-size:20px">⚠</span>
      <div style="flex:1"><b>تنبيه استراتيجي — نسبة الحجز إلى الفوترة ${b2b.ratio}×</b>
      <div style="font-size:12px;opacity:.9">الحجوزات الجديدة (${fmtSar(b2b.bookings_halalas)}) أقل من الإيراد المحقق (${fmtSar(b2b.revenue_halalas)}) لعام ${year} — الشركة تستهلك الأعمال المتعاقدة أسرع من تعويضها. يلزم تكثيف تطوير الأعمال.</div></div>
    </div>` : '';
  const revPct = t.target_revenue ? t.revenue / t.target_revenue * 100 : 0;
  const salesPct = t.target_sales ? t.sales / t.target_sales * 100 : 0;
  // Hero KPI block — clickable: opens the matching drill-down popup (keyboard accessible).
  const heroBlock = (label, val, target, p, color, extra, dd) => `
    <div class="hclick" role="button" tabindex="0" aria-label="${label} — انقر للتفاصيل"
      onclick="Sanad.openDD('${dd}')" onkeydown="if(event.key==='Enter'||event.key===' ')Sanad.openDD('${dd}')"
      style="display:flex;align-items:center;gap:1.15rem;flex:1;min-width:290px;padding:.5rem .65rem;margin:-.5rem -.65rem">
      <div style="flex:0 0 auto">${gauge(p, { color, size: 118, sw: 11, center: pct(p), centerSize: 25, sub: 'من الهدف' })}</div>
      <div style="min-width:0">
        <div style="color:rgba(255,255,255,.72);font-size:12.5px;font-weight:600">${label}</div>
        <div class="metric tnum" style="color:#fff;margin-top:.2rem;font-size:1.85rem">${fmtSar(val)}</div>
        <div style="color:rgba(255,255,255,.55);font-size:11.5px" class="tnum">الهدف ${fmtSar(target)}</div>
        <div style="margin-top:.45rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">${extra || ''}<span class="dd-hint">⊕ التفاصيل</span></div>
      </div>
    </div>`;
  // Per-sector cards. Each card carries its own actions: filter THIS dashboard to the sector, or
  // open the sector command center. The active-filter card gets a visible ring.
  const marginBySector = Object.fromEntries(margins.map((m) => [m.id, m.margin]));
  const sectorCards = ov.sectors.map((s) => {
    const gm = ov.canSeeMargin ? marginBySector[s.id] : undefined;
    const active = sec === s.id;
    return card(`
    <div style="padding:.8rem .9rem${active ? ';box-shadow:inset 0 0 0 2px ' + (s.color || '#2563eb') + ';border-radius:var(--r)' : ''}">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:.5rem">
          <span style="width:9px;height:9px;border-radius:3px;background:${s.color || '#2563eb'}"></span>
          <div><div style="font-weight:800;font-size:14px">${esc(s.name_ar)}</div><div style="font-size:10.5px;color:var(--muted)">${esc(s.name_en || '')}</div></div>
        </div>
        ${s.placeholder ? pill('بانتظار التفعيل', 'amber') : pill(`${s.opp_count} فرصة`, 'blue')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.7rem">
        <div><div style="font-size:11px;color:var(--muted)">الإيراد · ${pct(s.revenue_pct)}</div>
          <div style="font-weight:800" class="tnum">${fmtSar(s.revenue_halalas)}</div>
          <div class="bar" style="margin-top:.35rem"><span style="width:${Math.min(100, s.revenue_pct)}%;background:var(--green)"></span></div></div>
        <div><div style="font-size:11px;color:var(--muted)">المبيعات · ${pct(s.sales_pct)}</div>
          <div style="font-weight:800" class="tnum">${fmtSar(s.sales_halalas)}</div>
          <div class="bar" style="margin-top:.35rem"><span style="width:${Math.min(100, s.sales_pct)}%;background:${s.color || 'var(--brand)'}"></span></div></div>
      </div>
      <div style="margin-top:.7rem;padding-top:.6rem;border-top:1px solid var(--line);font-size:11px;color:var(--muted);display:flex;justify-content:space-between">
        <span>عقود ${year}: <b class="tnum" style="color:var(--ink2)">${fmtSar(s.contracts_halalas)}</b> (${s.contracts_count})</span>
        ${gm != null ? `<span>هامش: <b style="color:${gm >= 20 ? 'var(--green)' : gm >= 10 ? 'var(--amber)' : 'var(--red)'}">${gm}%</b></span>` : ''}
      </div>
      <div style="margin-top:.55rem;display:flex;gap:.4rem">
        ${active
          ? `<a class="btn btn-sm" href="/app/ceo?year=${year}">إلغاء التصفية</a>`
          : `<a class="btn btn-sm" href="/app/ceo?year=${year}&sector=${s.id}">تصفية اللوحة</a>`}
        <a class="btn btn-sm btn-ghost" href="/app/sector?year=${year}&sector=${s.id}">مركز القطاع ←</a>
      </div>
    </div>`, 'card-h');
  }).join('');
  // sector achievement (revenue) comparison, sorted, colored by sector — the "how much each achieved" chart
  const sectorAchv = [...ov.sectors].map((s) => ({ label: esc(s.name_ar), value: s.revenue_halalas || 0, color: s.color || '#2563eb', sub: pct(s.revenue_pct) })).sort((a, b) => b.value - a.value);
  // dense secondary metric inside the hero — clickable when a drill-down key is given
  const hm = (label, val, sub, dd) => `<div ${dd ? `class="hclick" role="button" tabindex="0" aria-label="${label} — التفاصيل" onclick="Sanad.openDD('${dd}')" onkeydown="if(event.key==='Enter'||event.key===' ')Sanad.openDD('${dd}')"` : ''} style="flex:1;min-width:118px;max-width:220px;overflow:hidden;padding:.3rem .45rem;margin:-.3rem -.45rem"><div style="color:rgba(255,255,255,.58);font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}${dd ? ' <span style="opacity:.55">⊕</span>' : ''}</div><div class="tnum" style="color:#fff;font-weight:800;font-size:1.02rem;margin-top:.12rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${val}</div>${sub ? `<div style="color:rgba(255,255,255,.42);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" class="tnum">${sub}</div>` : ''}</div>`;

  // ── Sector filter chips (the owner's per-sector lens) ──
  const chips = `<div class="chips"><span class="lbl">عرض:</span>
    <a href="/app/ceo?year=${year}" class="chip ${sec ? '' : 'on'}">الشركة كاملة</a>
    ${ov.sectors.map((s) => `<a href="/app/ceo?year=${year}&sector=${s.id}" class="chip ${sec === s.id ? 'on' : ''}"><span class="dot" style="background:${s.color || '#2563eb'}"></span>${esc(s.name_ar)}</a>`).join('')}
    ${sec ? `<a class="btn btn-sm" style="margin-inline-start:.3rem" href="/app/sector?year=${year}&sector=${sec}">فتح مركز القطاع ←</a>` : ''}
  </div>`;

  // ── Drill-down popup datasets → templates (shared ddWrap/attain/ddRows at module scope) ──
  const secHbars = (key, pctKey) => hbars([...ov.sectors].map((s) => ({ label: esc(s.name_ar), value: s[key] || 0, color: s.color || '#2563eb', sub: pct(s[pctKey]) })).sort((a, b) => b.value - a.value), { fmt: fmtSar });
  const maxStage = Math.max(1, ...pipeStages.map((s) => s.v || 0));
  const ddTemplates = `
  ${ddWrap('revenue', `الإيرادات المحققة · ${year}`, `${scopeLabel} · مقابل الهدف`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--green)">${fmtSar(t.revenue)}</span><span style="font-size:12px;color:var(--muted)">إيراد ${scopeLabel}</span></div>
    ${attain(t.revenue, t.target_revenue, 'var(--green)')}
    ${sec ? '' : `<div class="dd-sec">حسب القطاع</div>${secHbars('revenue_halalas', 'revenue_pct')}`}
    <div class="dd-sec">حسب الربع (ر.س)</div>
    ${miniBars(qRev.map((q) => ({ year: q.quarter, v: q.revenue_halalas })), 'v', { fmt: sarShort, h: 118 })}
    <div class="dd-sec">أكبر بنود الإيراد</div>
    <div>${ddRows(revLines.map((r) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.project || r.label || 'بند إيراد')}<span style="color:var(--faint);font-size:10.5px">${r.month ? ' · شهر ' + r.month : ''}${!sec && r.sector ? ' · ' + esc(r.sector) : ''}</span></span><b class="tnum" style="flex:none">${fmtSar(r.amount_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('sales', `المبيعات (الحجوزات) · ${year}`, `${scopeLabel} · مقابل الهدف`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--brand2)">${fmtSar(t.sales)}</span><span style="font-size:12px;color:var(--muted)">مبيعات ${scopeLabel}</span></div>
    ${attain(t.sales, t.target_sales, 'var(--brand2)')}
    <div style="display:flex;gap:.6rem;margin-top:.2rem">
      <div style="flex:1;background:var(--bg,#f6f7fb);border-radius:10px;padding:.55rem .7rem">
        <div style="font-size:10.5px;color:var(--muted)">مبيعات السنة (${year}) · مقابل الهدف</div>
        <div class="tnum" style="font-weight:800;font-size:15px;color:var(--brand2)">${fmtSar(t.sales)}</div></div>
      <div style="flex:1;background:var(--bg,#f6f7fb);border-radius:10px;padding:.55rem .7rem">
        <div style="font-size:10.5px;color:var(--muted)">إجمالي الحجوزات التراكمية · ${bookAll.n} صفقة</div>
        <div class="tnum" style="font-weight:800;font-size:15px">${fmtSar(bookAll.v)}</div></div>
    </div>
    <div style="font-size:10.5px;color:var(--faint);line-height:1.6">«مبيعات السنة» تحسب الصفقات المكسوبة في ${year} فقط (الأساس الصحيح مقابل الهدف السنوي)؛ «التراكمي» يجمع كل السنوات (كما كانت تعرضه المنصة السابقة كرقم واحد).</div>
    ${bookByYear.length > 1 ? `<div class="dd-sec">الحجوزات حسب سنة الفوز</div>
      <div>${ddRows(bookByYear.map((b) => `<div class="dd-row"><span>${b.year || 'بدون سنة'}<span style="color:var(--faint);font-size:10.5px"> · ${b.n} صفقة</span></span><b class="tnum" style="flex:none${String(b.year) === String(year) ? ';color:var(--brand2)' : ''}">${fmtSar(b.v)}</b></div>`))}</div>` : ''}
    ${sec ? '' : `<div class="dd-sec">حسب القطاع (السنة)</div>${secHbars('sales_halalas', 'sales_pct')}`}
    <div class="dd-sec">حسب الربع (ر.س)</div>
    ${miniBars(qBook.map((q) => ({ year: q.quarter, v: q.sales_halalas })), 'v', { fmt: sarShort, h: 118 })}
    <div class="dd-sec">أكبر الصفقات المكسوبة (${year})</div>
    <div>${ddRows(wonDeals.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(d.client || '—')}${!sec && d.sector ? ' · ' + esc(d.sector) : ''}</span></span><b class="tnum" style="flex:none">${fmtSar(d.value_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('pipeline', 'خط الفرص المفتوح', `${scopeLabel} · حسب المرحلة`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--blue)">${fmtSar(pipelineVal)}</span><span style="font-size:12px;color:var(--muted)">القيمة المرجّحة ${fmtSar(cov.weighted_halalas)} · تغطية ${cov.coverage != null ? cov.coverage + '×' : '—'}</span></div>
    <div class="dd-sec">حسب المرحلة</div>
    <div>${ddRows(pipeStages.map((s) => `<div style="padding:.32rem 0">
      <div style="display:flex;align-items:center;gap:.5rem;font-size:12.5px"><span style="width:9px;height:9px;border-radius:3px;background:${s.color || '#64748b'};flex:none"></span><span style="flex:1">${esc(s.name_ar)}</span><span class="tnum" style="font-weight:800">${s.n}</span><span class="tnum" style="color:var(--muted);font-size:11px">${fmtSar(s.v)}</span></div>
      <div class="bar" style="margin-top:.22rem"><span style="width:${Math.round((s.v / maxStage) * 100)}%;background:${s.color || '#64748b'}"></span></div></div>`))}</div>`)}
  ${ddWrap('winrate', `معدل الفوز · ${year}`, scopeLabel, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--green)">${pct(wr.rate)}</span><span style="font-size:12px;color:var(--muted)">فوز ${wr.won} · خسارة ${wr.lost}</span></div>
    <div class="bar" style="height:8px"><span style="width:${Math.min(100, wr.rate || 0)}%;background:var(--green)"></span></div>
    <div class="dd-sec">الصفقات المكسوبة الأعلى</div>
    <div>${ddRows(wonDeals.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(d.client || '—')}</span></span><b class="tnum" style="flex:none">${fmtSar(d.value_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('backlog', 'الأعمال المتعاقدة (Backlog)', `${scopeLabel} · المتبقي للتحقيق`, `
    <div class="dd-kpi"><span class="v tnum">${fmtSar(bk.backlog_halalas)}</span><span style="font-size:12px;color:var(--muted)">قيمة متعاقدة لم تُحقَّق بعد</span></div>
    <div class="dd-sec">أكبر العقود</div>
    <div>${ddRows(topContracts.map((c) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.client || c.code || 'عقد')}<span style="color:var(--faint);font-size:10.5px">${c.code ? ' · ' + esc(c.code) : ''}${!sec && c.sector ? ' · ' + esc(c.sector) : ''}</span></span><b class="tnum" style="flex:none">${fmtSar(c.value_halalas)}</b></div>`))}</div>`)}
  ${ov.canSeeMargin ? ddWrap('margin', `هامش الربح الإجمالي · ${year}`, 'حسب القطاعات · بيانات حساسة (مالية/قيادة فقط)', `
    ${avgMargin != null ? `<div class="dd-kpi"><span class="v tnum" style="color:${avgMargin >= 20 ? 'var(--green)' : avgMargin >= 10 ? 'var(--amber)' : 'var(--red)'}">${avgMargin}%</span><span style="font-size:12px;color:var(--muted)">متوسط الهامش عبر القطاعات</span></div>` : ''}
    <div>${ddRows(margins.map((m) => `<div class="dd-row"><span style="display:flex;align-items:center;gap:.45rem;min-width:0"><span style="width:9px;height:9px;border-radius:2px;background:${m.color || '#2563eb'};flex:none"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name_ar)}</span></span><b class="tnum" style="flex:none;color:${m.margin == null ? 'var(--faint)' : m.margin >= 20 ? 'var(--green)' : m.margin >= 10 ? 'var(--amber)' : 'var(--red)'}">${m.margin == null ? '—' : m.margin + '%'}</b></div>`))}</div>`) : ''}`;
  const body = `
    ${chips}
    ${riskBanner}
    <div style="border-radius:18px;padding:1.25rem 1.5rem;margin-bottom:.9rem;color:#fff;background:linear-gradient(135deg,#0f2350,#182a5e 55%,#3a1660);box-shadow:0 16px 34px -18px rgba(58,22,96,.6);position:relative;overflow:hidden">
      <div style="position:absolute;inset-inline-end:-40px;top:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(124,58,237,.32),transparent 70%);pointer-events:none"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.9rem;position:relative">
        <div style="color:rgba(255,255,255,.62);font-size:12px;font-weight:600">الأداء · ${esc(scopeLabel)} · السنة المالية ${ov.fiscalYear}</div>
        ${b2b.ratio != null ? `<span style="font-size:11.5px;font-weight:700;background:rgba(255,255,255,.12);padding:.3rem .7rem;border-radius:999px">Book-to-Bill ${b2b.ratio}×</span>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:1.25rem;align-items:center;position:relative">
        ${heroBlock(sec ? 'إيرادات القطاع المحققة' : 'إجمالي الإيرادات المحققة', t.revenue, t.target_revenue, revPct, '#34d399', yoyBadge(revYoy), 'revenue')}
        <div style="width:1px;align-self:stretch;background:rgba(255,255,255,.12)"></div>
        ${heroBlock(sec ? 'مبيعات القطاع (حجوزات)' : 'إجمالي المبيعات (حجوزات)', t.sales, t.target_sales, salesPct, '#c07bff', yoyBadge(bookYoy), 'sales')}
      </div>
      <div style="display:flex;gap:1.1rem;flex-wrap:wrap;margin-top:.95rem;padding-top:.85rem;border-top:1px solid rgba(255,255,255,.1);position:relative">
        ${hm('خط الفرص المفتوح', fmtSar(pipelineVal), 'مرجّح ' + fmtSar(cov.weighted_halalas), 'pipeline')}
        ${hm('معدل الفوز', pct(wr.rate), `فوز ${wr.won} · خسارة ${wr.lost}`, 'winrate')}
        ${hm('الأعمال المتعاقدة', fmtSar(bk.backlog_halalas), 'Backlog لم يُحقَّق', 'backlog')}
        ${hm('تحقيق الإيراد', pct(revPct), 'من ' + fmtSar(t.target_revenue), 'revenue')}
        ${hm('تحقيق المبيعات', pct(salesPct), 'من ' + fmtSar(t.target_sales), 'sales')}
        ${avgMargin != null ? hm('متوسط هامش الربح', avgMargin + '%', 'حسب القطاعات', 'margin') : ''}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1.35fr 1fr;gap:.9rem;margin-bottom:.9rem">
      <div><div style="font-weight:800;font-size:13.5px;margin-bottom:.5rem">أداء القطاعات · ${year}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">${sectorCards}</div></div>
      ${card(`<div style="padding:.9rem 1rem;height:100%;display:flex;flex-direction:column">
        <div style="font-weight:800;font-size:13.5px">تحقيق القطاعات · الإيراد المحقق</div>
        <div style="font-size:11px;color:var(--muted);margin:.1rem 0 .85rem">مقارنة القطاعات لعام ${year} (ر.س. · % من الهدف)</div>
        ${hbars(sectorAchv, { fmt: fmtSar })}</div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem">
      ${card(`<div style="padding:.9rem 1rem"><div style="font-weight:800;font-size:13.5px">الإيراد المحقق حسب الربع · ${year}</div>
        <div style="font-size:11px;color:var(--muted);margin:.1rem 0 .4rem">مليون ر.س.</div>
        ${miniBars(qRev.map((q) => ({ year: q.quarter, revenue_halalas: q.revenue_halalas })), 'revenue_halalas', { fmt: sarShort })}</div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-weight:800;font-size:13.5px">المبيعات (الحجوزات) حسب الربع · ${year}</div>
        <div style="font-size:11px;color:var(--muted);margin:.1rem 0 .4rem">مليون ر.س.</div>
        ${miniBars(qBook.map((q) => ({ year: q.quarter, sales_halalas: q.sales_halalas })), 'sales_halalas', { fmt: sarShort })}</div>`)}
    </div>
    ${ddTemplates}`;
  return layout({ user, active: 'ceo', title: `لوحة القيادة${sec ? ' — ' + esc(secObj.name_ar) : ''}`,
    subtitle: `نظرة تنفيذية · ${esc(scopeLabel)} · السنة المالية ${year}`, body, year });
}

export async function portfolioPage(user) {
  const rows = await listProjects(user);
  const sectorNames = Object.fromEntries((await all('SELECT id,name_ar FROM sector')).map((s) => [s.id, s.name_ar]));
  const val = (p) => p.contract_value_halalas || p.budget_halalas || 0;
  const isActive = (p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED';
  const ragC = { GREEN: 0, AMBER: 0, RED: 0 };
  for (const p of rows) if (isActive(p)) ragC[p.rag] = (ragC[p.rag] || 0) + 1;
  const totalVal = rows.reduce((a, p) => a + val(p), 0);
  const active = rows.filter(isActive);
  const completed = rows.filter((p) => p.status === 'COMPLETED').length;
  const avgProg = active.length ? Math.round(active.reduce((a, p) => a + (p.progress_pct || 0), 0) / active.length) : 0;
  const ragTone = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
  const ragHexP = { GREEN: '#059669', AMBER: '#d97706', RED: '#dc2626' };

  const bySector = {};
  for (const p of rows) (bySector[p.sector_id] ||= []).push(p);
  // richest sectors first
  const sectorEntries = Object.entries(bySector).sort((a, b) => b[1].reduce((x, p) => x + val(p), 0) - a[1].reduce((x, p) => x + val(p), 0));

  const groups = sectorEntries.map(([sid, ps]) => {
    const sVal = ps.reduce((a, p) => a + val(p), 0);
    const sActive = ps.filter(isActive);
    const sAvg = sActive.length ? Math.round(sActive.reduce((a, p) => a + (p.progress_pct || 0), 0) / sActive.length) : 0;
    const sRag = { GREEN: 0, AMBER: 0, RED: 0 }; for (const p of sActive) sRag[p.rag] = (sRag[p.rag] || 0) + 1;
    const ragDots = ['GREEN', 'AMBER', 'RED'].filter((r) => sRag[r]).map((r) => `<span style="display:inline-flex;align-items:center;gap:.2rem;font-size:11px"><span style="width:8px;height:8px;border-radius:99px;background:${ragHexP[r]}"></span><span class="tnum">${sRag[r]}</span></span>`).join('<span style="color:var(--faint);margin:0 .15rem"></span>');
    const top = ps.slice().sort((a, b) => val(b) - val(a)).slice(0, 7);
    return card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:800;font-size:13.5px">${esc(sectorNames[sid] || sid || '—')}</div><span class="tnum" style="font-size:12.5px;font-weight:800">${fmtSar(sVal)}</span></div>
        <div style="display:flex;align-items:center;gap:.8rem;margin-top:.35rem;font-size:11px;color:var(--muted)"><span>${ps.length} مشروع</span><span style="display:flex;gap:.5rem">${ragDots || '—'}</span><span style="margin-inline-start:auto">إنجاز ${sAvg}%</span></div>
        <div class="bar" style="margin-top:.3rem"><span style="width:${sAvg}%;background:var(--brand-grad)"></span></div></div>
      <div style="padding:.4rem .5rem">${top.map((p) => `<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem .5rem;font-size:12px">
        <span style="width:8px;height:8px;border-radius:99px;flex:none;background:${ragHexP[p.rag] || '#94a3b8'}"></span>
        <a href="/app/project/${p.id}" style="flex:1;color:var(--ink2);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name_ar)}</a>
        <span class="tnum" style="color:var(--faint);font-size:10.5px;flex:none">${sarShort(val(p))}</span>
        <span class="tnum" style="color:var(--muted);font-size:11px;width:34px;text-align:left;flex:none">${pct(p.progress_pct)}</span></div>`).join('')}
        ${ps.length > 7 ? `<div style="padding:.3rem .5rem;font-size:11px;color:var(--faint)">+${ps.length - 7} مشروع آخر</div>` : ''}</div>`);
  }).join('');

  const kpi = (l, v, sub, tone) => card(`<div style="padding:.75rem .95rem"><div style="font-size:11px;color:var(--muted)">${l}</div><div class="metric tnum" style="font-size:1.35rem;${tone ? 'color:' + tone : ''}">${v}</div>${sub ? `<div style="font-size:10.5px;color:var(--faint)">${sub}</div>` : ''}</div>`);
  const body = `
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:.7rem;margin-bottom:1rem">
      ${kpi('إجمالي المشاريع', rows.length, `${active.length} قائم · ${completed} مكتمل`)}
      ${kpi('قيمة المحفظة', fmtSar(totalVal), 'قيمة العقود')}
      ${kpi('سليمة (أخضر)', ragC.GREEN, 'ضمن المسار', 'var(--green)')}
      ${kpi('تحذير (أصفر)', ragC.AMBER, 'تحتاج متابعة', 'var(--amber)')}
      ${kpi('متعثرة (أحمر)', ragC.RED, 'تدخّل عاجل', ragC.RED ? 'var(--red)' : '')}
      ${kpi('متوسط الإنجاز', avgProg + '%', 'للمشاريع القائمة')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:.9rem;align-items:start">${groups || '<div style="color:var(--muted);font-size:13px">لا مشاريع ضمن نطاقك</div>'}</div>`;
  return layout({ user, active: 'portfolio', title: 'محفظة المشاريع', subtitle: 'نظرة تنفيذية على صحة المحفظة', body });
}
