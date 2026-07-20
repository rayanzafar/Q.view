// مركز القطاع v3 — مساحة عمل مدير القطاع كقصة قرار:
// (1) يحتاج انتباهك الآن → (2) المستهدف/المحقق/المتوقع → (3) الفرص وأعمارها → (4) صحة المشاريع
// → (5) ملخص الطاقة → (6) العملاء والتركّز → (7) القرارات → (8) المقارنات والتقارير.
// كل رقم مجمّع يفتح تفصيلاً؛ لا مكافآت هنا؛ الأخضر يُضغط والاستثناء يتصدّر.
import { layout, card, pill, tr } from '../layout.js';
import { icon } from '../icons.js';
import { fmtSar } from '../../core/util/ids.js';
import { all, get } from '../../core/db/index.js';
import { sectorDashboard, sectorStaffing, sectorClients, sectorWins, quarterlyRevenue, quarterlyBookings, pipelineCoverage, monthlyRevenue, revenueForecast, pipelineAging } from '../../core/reports/metrics.js';
import { attentionFeed } from '../../core/reports/attention.js';
import { config } from '../../core/config.js';
import { G } from '../i18n/glossary.js';
import { esc, ddWrap, attain, ddRows } from './_shared.js';

const TONE = { brand: 'var(--brand)', green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };

export async function sectorPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const today = new Date().toISOString().slice(0, 10);
  const allSectors = await all('SELECT id, name_ar, color FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const requested = opts.sector && allSectors.some((s) => s.id === opts.sector) ? opts.sector : null;
  const sectorId = user.scope === 'company'
    ? (requested || user.sector_id || allSectors[0]?.id || 'SOLUTIONS')
    : (user.sector_id || 'SOLUTIONS');

  const sd = await sectorDashboard(user, sectorId, { year });
  if (!sd) return layout({ user, active: 'sector', title: 'مركز القطاع', body: `<div class="empty-state"><div class="t">لا يوجد قطاع مرتبط بحسابك</div><div class="s">اطلب من مدير النظام ربطك بقطاع لعرض مركزه.</div></div>` });

  const [attn, fc, monthly, qRev, qBook, aging, cover, staff, clients, wins] = await Promise.all([
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
  const activeC = await get(`SELECT COUNT(*) n, COALESCE(SUM(value_halalas),0) v FROM contract
     WHERE sector_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'`, [sectorId]);
  const secContracts = await all(`SELECT c.id, c.code, c.value_halalas, c.status, c.start_date, cl.name_ar client,
     (SELECT COALESCE(SUM(i.amount_halalas),0) FROM invoice i WHERE i.contract_id = c.id AND i.status != 'DRAFT' AND i.deleted_at IS NULL) invoiced
     FROM contract c LEFT JOIN client cl ON cl.id = c.client_id
     WHERE c.sector_id = ? AND c.deleted_at IS NULL ORDER BY c.value_halalas DESC LIMIT 10`, [sectorId]);
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

  // ── (1) يحتاج انتباهك الآن ──
  const toneBg = { brand: 'rgba(36,74,153,.1)', green: '#dcfce7', amber: '#fef3c7', red: '#fee2e2' };
  const attnItems = attn.map((a) => `
    <div class="attn">
      <span class="ic" style="background:${toneBg[a.tone] || '#f1f5f9'};color:${TONE[a.tone] || 'var(--ink2)'}">${icon(a.icon)}</span>
      <span class="tx"><span class="h">${esc(a.title)}</span>${a.sub ? `<div class="s">${esc(a.sub)}</div>` : ''}</span>
      ${a.dd ? `<button class="btn btn-sm go" onclick="Sanad.openDD('${a.dd}')">${esc(a.action)}</button>`
        : `<a class="btn btn-sm go" href="${a.href}${a.href.includes('?') ? '&' : '?'}year=${year}${user.scope === 'company' ? '&sector=' + sectorId : ''}">${esc(a.action)}</a>`}
    </div>`).join('');
  const attnCard = card(`
    <div style="padding:.9rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.5rem">
      <div style="font-weight:800;font-size:14px">${G.attention}</div>
      ${attn.length ? `<span class="pill" style="background:#fee2e2;color:#991b1b">${attn.length}</span>` : ''}
      <span style="margin-inline-start:auto;font-size:10.5px;color:var(--faint)">مرتبة حسب أثر القرار</span>
    </div>
    <div style="padding:.7rem .8rem;display:flex;flex-direction:column;gap:.5rem">
      ${attnItems || `<div class="alert ok" style="justify-content:center">${icon('approvals')} ${G.nothingNeedsYou} — ${G.allGood}</div>`}
    </div>`);

  // ── (2) المستهدف / المحقق / المتوقع (bullet graphs) ──
  const bullet = (label, actual, target, forecast, color, ddKey) => {
    const scale = Math.max(actual, target || 0, forecast || 0, 1);
    const w = (v) => Math.min(100, Math.round((v / scale) * 100));
    const pct = target ? Math.round((actual / target) * 100) : null;
    const fpct = target && forecast ? Math.round((forecast / target) * 100) : null;
    return `<div ${ddKey ? `class="cardclick" role="button" tabindex="0" onclick="Sanad.openDD('${ddKey}')"` : ''} style="padding:.65rem .85rem;border:1px solid var(--line);border-radius:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:.6rem;margin-bottom:.35rem">
        <span style="font-size:12.5px;font-weight:700">${label} ${ddKey ? '<span style="color:var(--faint)">⊕</span>' : ''}</span>
        <span class="tnum" style="font-weight:800;font-size:15px;color:${color}">${fmtSar(actual)}</span>
      </div>
      <div class="bullet"><span class="fill" style="width:${w(actual)}%;background:${color}"></span>
        ${target ? `<span class="tgt" style="inset-inline-start:${w(target)}%" title="${G.target}: ${fmtSar(target)}"></span>` : ''}
        ${forecast ? `<span class="fc" style="inset-inline-start:${w(forecast)}%" title="${G.forecast}: ${fmtSar(forecast)}"></span>` : ''}</div>
      <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);margin-top:.3rem">
        <span>${target ? `${G.target} ${fmtSar(target)}${pct != null ? ` · ${G.attainment} <b class="tnum">${pct}%</b>` : ''}` : 'لا هدف مسجّل لهذه السنة'}</span>
        ${forecast ? `<span data-tip="${G.forecast} = المحقق حتى الآن + ${G.weighted} من الفرص المفتوحة لهذه السنة">${G.forecast} <b class="tnum">${fmtSar(forecast)}</b>${fpct != null && fpct <= 300 ? ` (${fpct}%)` : fpct != null ? ' — أعلى من الهدف بكثير' : ''} ⓘ</span>` : ''}
      </div></div>`;
  };
  const mMax = Math.max(1, ...monthly);
  const AR_M = ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
  const nowM = new Date().getUTCMonth();
  const monthlyBars = `<div style="display:flex;gap:3px;align-items:flex-end;height:64px;direction:ltr">${monthly.map((v, i) => `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px" title="${AR_M[i]}: ${fmtSar(v)}">
      <div style="width:100%;border-radius:4px 4px 0 0;background:${i === nowM && year === new Date().getUTCFullYear() ? 'var(--brand2)' : 'var(--brand)'};opacity:${v ? 1 : .18};height:${Math.max(3, Math.round((v / mMax) * 52))}px"></div>
      <span style="font-size:8.5px;color:var(--faint)">${AR_M[i]}</span></div>`).join('')}</div>`;
  const targetsCard = card(`
    <div style="padding:.9rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:14px">${G.target} · ${G.actual} · ${G.forecast}</div>
    <div style="padding:.8rem .9rem;display:grid;gap:.6rem">
      ${bullet(`${G.revenue} ${year}`, sd.revenue_halalas, sd.target_revenue_halalas, fc.forecast, 'var(--green)', 'secrev')}
      ${bullet(`${G.sales} ${year}`, sd.sales_halalas, sd.target_sales_halalas, null, 'var(--brand2)', 'secwins')}
      <div style="padding:.55rem .85rem;border:1px solid var(--line);border-radius:12px;background:#fff">
        <div style="font-size:11px;color:var(--muted);margin-bottom:.3rem">${G.revenue} الشهري ${year}</div>${monthlyBars}
      </div>
    </div>`);

  // ── (3) الفرص: مرجّح/تغطية/أعمار ──
  const openTotal = pipe.reduce((a, b) => a + b.value_halalas, 0);
  const weightedTotal = Math.round(pipe.reduce((a, b) => a + b.weighted, 0));
  const maxPipe = Math.max(1, ...pipe.map((s) => s.value_halalas));
  const pipeRows = pipe.filter((s) => s.count > 0).map((s) => `<div style="padding:.3rem 0">
    <div style="display:flex;align-items:center;gap:.5rem;font-size:12.5px">
      <span style="width:9px;height:9px;border-radius:3px;background:${s.color};flex:none"></span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name_ar)}</span>
      <span style="font-weight:800" class="tnum">${s.count}</span>
      <span style="color:var(--muted);font-size:11px" class="tnum">${fmtSar(s.value_halalas)}</span></div>
    <div class="bar" style="margin-top:.22rem"><span style="width:${Math.round(s.value_halalas / maxPipe * 100)}%;background:${s.color}"></span></div>
  </div>`).join('') || `<div class="empty-state" style="padding:1rem"><div class="s">${G.emptyList}</div></div>`;
  const agingMax = Math.max(1, ...aging.map((b) => b.v));
  const agingRows = aging.map((b, i) => `<div style="display:flex;align-items:center;gap:.5rem;font-size:11.5px;padding:.22rem 0">
      <span style="flex:0 0 96px;color:var(--muted)">${b.label}</span>
      <div class="bar" style="flex:1"><span style="width:${Math.round((b.v / agingMax) * 100)}%;background:${i >= 2 ? 'var(--amber)' : 'var(--brand)'}"></span></div>
      <span class="tnum" style="flex:none;font-weight:700">${b.n}</span>
      <span class="tnum" style="flex:none;color:var(--muted);font-size:10.5px">${fmtSar(b.v)}</span>
    </div>`).join('');
  const oppsCard = card(`
    <div style="padding:.9rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
      <div style="font-weight:800;font-size:14px">${G.opportunities}</div>
      <a class="btn btn-sm" href="/app/opportunities?year=${year}${user.scope === 'company' ? '&sector=' + sectorId : ''}">اللوحة الكاملة</a></div>
    <div style="padding:.7rem 1rem;display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;border-bottom:1px dashed var(--line)">
      <div><div style="font-size:10px;color:var(--muted)">${G.raw}</div><div class="tnum" style="font-weight:800;font-size:14.5px">${fmtSar(openTotal)}</div></div>
      <div data-tip="مجموع (قيمة الفرصة × ${G.probability}) لكل الفرص المفتوحة"><div style="font-size:10px;color:var(--muted)">${G.weighted} ⓘ</div><div class="tnum" style="font-weight:800;font-size:14.5px;color:var(--brand)">${fmtSar(weightedTotal)}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">${G.winRate}</div><div class="tnum" style="font-weight:800;font-size:14.5px;color:var(--green)">${wins.winRate}%</div></div>
      <div data-tip="${G.raw} من الفرص المفتوحة ÷ المتبقي من هدف المبيعات — أقل من ×1 يعني الحاجة لفرص جديدة"><div style="font-size:10px;color:var(--muted)">التغطية ⓘ</div><div class="tnum" style="font-weight:800;font-size:14.5px;color:${(cover?.coverage ?? 1) < 1 ? 'var(--amber)' : 'var(--ink2)'}">${cover?.coverage != null ? '×' + cover.coverage : '—'}</div></div>
    </div>
    <div style="padding:.6rem 1rem">${pipeRows}</div>
    <div style="padding:.6rem 1rem;border-top:1px dashed var(--line)">
      <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:.2rem">عمر الفرص في مرحلتها الحالية</div>${agingRows}
    </div>`);

  // ── (4) صحة المشاريع والانحرافات ──
  const ragColor = { GREEN: 'var(--green)', AMBER: 'var(--amber)', RED: 'var(--red)' };
  const projRows = revByProject.filter((r) => r.id).slice(0, 8).map((r) => {
    const pcv = r.cv ? Math.round((r.rev / r.cv) * 100) : null;
    return `<a href="/app/project/${r.id}" style="display:block;padding:.45rem 0;border-bottom:1px dashed var(--line)">
      <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:center">
        <span style="display:flex;align-items:center;gap:.45rem;min-width:0"><span style="width:8px;height:8px;border-radius:50%;background:${ragColor[r.rag] || 'var(--faint)'};flex:none"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name_ar)}</span></span>
        <b class="tnum" style="flex:none">${fmtSar(r.rev)}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);margin-top:.15rem">
        <span>${tr(r.status)}${pcv != null ? '' : ' · بلا قيمة مسجلة'}</span>${pcv != null ? `<span class="tnum">حقّق ${pcv}% من قيمته</span>` : ''}</div>
      ${pcv != null ? `<div class="bar" style="margin-top:.22rem;height:4px"><span style="width:${Math.min(100, pcv)}%;background:var(--green)"></span></div>` : ''}
    </a>`;
  }).join('') || `<div class="empty-state" style="padding:1rem"><div class="s">لا مشاريع مولّدة للإيراد بعد هذه السنة</div></div>`;
  const stCount = sd.projects || {};
  const projectsCard = card(`
    <div style="padding:.9rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
      <div style="font-weight:800;font-size:14px">${G.projects}</div>
      <div style="display:flex;gap:.35rem;align-items:center">
        ${['IN_PROGRESS', 'ON_HOLD', 'COMPLETED'].filter((k) => stCount[k]).map((k) => pill(`${tr(k)} ${stCount[k]}`, k === 'ON_HOLD' ? 'amber' : k === 'COMPLETED' ? 'green' : 'blue')).join('')}
        ${sd.openRisks ? pill(`${G.risks} ${sd.openRisks}`, 'red') : ''}
        <a class="btn btn-sm" href="/app/projects?year=${year}${user.scope === 'company' ? '&sector=' + sectorId : ''}">الكل</a>
      </div></div>
    <div style="padding:.5rem 1rem .7rem">${projRows}</div>`);

  // ── (5) الطاقة (ملخص يقود إلى مساحة العمل) ──
  const over = (staff.employees || []).filter((e) => e.current > 110);
  const bench = (staff.employees || []).filter((e) => e.current === 0);
  const capCard = card(`
    <div style="padding:.9rem 1rem;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
      <div style="font-weight:800;font-size:14px">${G.capacity}</div>
      <a class="btn btn-sm" href="/app/team?year=${year}${user.scope === 'company' ? '&sector=' + sectorId : ''}">مساحة التسكين</a></div>
    <div style="padding:.7rem 1rem;display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">
      <div><div style="font-size:10px;color:var(--muted)">${G.utilization} الآن</div><div class="tnum" style="font-weight:800;font-size:15px;color:${(staff.teamCurrent ?? 0) > 100 ? 'var(--red)' : 'var(--ink2)'}">${staff.teamCurrent ?? staff.teamUtil}%</div><div style="font-size:9.5px;color:var(--faint)">سنويًا ${staff.teamUtil}% · ${staff.headcount} موظف</div></div>
      <div><div style="font-size:10px;color:var(--muted)">${G.overloaded}</div><div class="tnum" style="font-weight:800;font-size:15px;color:${over.length ? 'var(--red)' : 'var(--ink2)'}">${over.length}</div>${over.length ? `<div style="font-size:9.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(over.slice(0, 2).map((e) => e.name).join('، '))}</div>` : ''}</div>
      <div><div style="font-size:10px;color:var(--muted)">${G.onBench}</div><div class="tnum" style="font-weight:800;font-size:15px;color:${bench.length ? 'var(--amber)' : 'var(--ink2)'}">${bench.length}</div>${bench.length ? `<div style="font-size:9.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(bench.slice(0, 2).map((e) => e.name).join('، '))}</div>` : ''}</div>
    </div>`);

  // ── (6) العملاء ──
  const clientRows = clients.slice(0, 8).map((c) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .6rem;font-size:12.5px">${esc(c.name_ar)}</td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:12px" class="tnum">${c.opps}</td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:12px" class="tnum">${c.projects}</td>
    <td style="padding:.4rem .6rem;text-align:left;font-size:12px;font-weight:700" class="tnum">${fmtSar(c.pipeline_halalas)}</td></tr>`).join('')
    || `<tr><td colspan="4"><div class="empty-state" style="padding:1rem"><div class="s">${G.emptyList}</div></div></td></tr>`;
  const th = (t) => `<th style="padding:.4rem .6rem;font-size:10.5px;color:var(--muted);font-weight:700;text-align:${t.a || 'right'}">${t.t}</th>`;
  const clientsCard = card(`
    <div style="padding:.9rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:14px">${G.clients}</div>
    <div class="tblwrap"><table style="width:100%;border-collapse:collapse"><thead><tr>${th({ t: G.client })}${th({ t: 'فرص', a: 'center' })}${th({ t: 'مشاريع', a: 'center' })}${th({ t: G.pipeline, a: 'left' })}</tr></thead><tbody>${clientRows}</tbody></table></div>`);

  // ── (7) القرارات والاعتمادات ──
  const decRows = recentDecisions.map((d) => `<div style="padding:.4rem 0;border-bottom:1px dashed var(--line);font-size:12px">
      <div style="font-weight:700">${esc(d.title)}</div>
      <div style="font-size:10.5px;color:var(--muted)">${esc(d.project || '')}${d.decided_by ? ' · ' + esc(d.decided_by) : ''}${d.dat ? ' · ' + d.dat : ''}</div>
    </div>`).join('') || `<div style="font-size:11.5px;color:var(--faint);padding:.4rem 0">لا قرارات مسجلة بعد — تُسجَّل القرارات من صفحة المشروع</div>`;
  const apRows = pendingApprovals.map((a) => `<div style="display:flex;justify-content:space-between;gap:.6rem;padding:.35rem 0;border-bottom:1px dashed var(--line);font-size:12px">
      <span>${a.resource === 'timesheet' ? 'سجل وقت' : esc(tr(a.resource) || a.resource)}</span>
      <b class="tnum" style="flex:none">${a.amount_halalas ? fmtSar(a.amount_halalas) : ''}</b>
    </div>`).join('') || `<div style="font-size:11.5px;color:var(--faint);padding:.4rem 0">لا طلبات معلقة</div>`;
  const decisionsCard = card(`
    <div style="padding:.9rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:800;font-size:14px">${G.decisions} والاعتمادات</div>
      <a class="btn btn-sm" href="/app/approvals">${G.needsDecision}</a></div>
    <div style="padding:.6rem 1rem">
      <div style="font-size:11px;font-weight:700;color:var(--muted)">طلبات معلقة في القطاع</div>${apRows}
      <div style="font-size:11px;font-weight:700;color:var(--muted);margin-top:.6rem">آخر القرارات</div>${decRows}
    </div>`);

  // ── (8) المقارنات والتقارير ──
  // quarterlyRevenue/Bookings تُرجعان كائنات {quarter, *_halalas} — نطبّعها لأرقام قبل أي حساب
  const qRevN = (qRev || []).map((r) => (typeof r === 'number' ? r : r.revenue_halalas || 0));
  const qBookN = (qBook || []).map((r) => (typeof r === 'number' ? r : r.sales_halalas || 0));
  const qMax = Math.max(1, ...qRevN, ...qBookN);
  const qBars = [0, 1, 2, 3].map((i) => `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="display:flex;gap:3px;align-items:flex-end;height:56px">
        <div title="${G.revenue}" style="width:14px;border-radius:3px 3px 0 0;background:var(--green);height:${Math.max(3, Math.round((qRevN[i] / qMax) * 52))}px"></div>
        <div title="${G.bookings}" style="width:14px;border-radius:3px 3px 0 0;background:var(--brand2);height:${Math.max(3, Math.round((qBookN[i] / qMax) * 52))}px"></div>
      </div><span style="font-size:9.5px;color:var(--faint)">ر${i + 1}</span></div>`).join('');
  const nowQ = Math.floor(nowM / 3);
  const qDelta = nowQ > 0 && qRevN[nowQ - 1] ? Math.round(((qRevN[nowQ] - qRevN[nowQ - 1]) / qRevN[nowQ - 1]) * 100) : null;
  const reportsCard = card(`
    <div style="padding:.9rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:14px">المقارنات والتقارير</div>
    <div style="padding:.7rem 1rem">
      <div style="display:flex;direction:ltr;gap:.4rem">${qBars}</div>
      <div style="display:flex;gap:.8rem;font-size:10px;color:var(--muted);justify-content:center;margin-top:.3rem">
        <span><span style="display:inline-block;width:8px;height:8px;background:var(--green);border-radius:2px"></span> ${G.revenue}</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:var(--brand2);border-radius:2px"></span> ${G.bookings}</span></div>
      ${qDelta != null ? `<div style="font-size:11.5px;color:var(--muted);margin-top:.45rem">إيراد الربع الحالي ${qDelta >= 0 ? 'أعلى' : 'أدنى'} من الربع السابق بنسبة <b class="tnum" style="color:${qDelta >= 0 ? 'var(--green)' : 'var(--red)'}">${Math.abs(qDelta)}%</b></div>` : ''}
      <div style="display:flex;gap:.5rem;margin-top:.7rem;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="Sanad.previewReport('sector_weekly_status')">التقرير الأسبوعي</button>
        <button class="btn btn-sm" onclick="Sanad.previewReport('monthly_sector_performance')">التقرير الشهري</button>
        <button class="btn btn-sm" onclick="Sanad.testSend('sector_weekly_status')">أرسله لي الآن</button>
        <a class="btn btn-sm" href="/app/reports">جدولة دورية</a>
      </div>
    </div>`);

  // ── العقود (بطاقة موجزة تفتح التفصيل) ──
  const contractsCard = card(`<div class="cardclick" role="button" tabindex="0" onclick="Sanad.openDD('seccontracts')" style="padding:.8rem 1rem">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:12.5px;font-weight:700">العقود النشطة <span style="color:var(--faint)">⊕</span></span>
      <b class="tnum" style="font-size:15px">${fmtSar(activeC.v)}</b></div>
    <div style="font-size:10.5px;color:var(--muted);margin-top:.2rem">${activeC.n} عقد نشط · موقّع ${year}: ${sd.contracts_count} (${fmtSar(sd.contracts_halalas)})</div>
  </div>`, 'card-h');

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
  ${ddWrap('seccontracts', 'سجل عقود القطاع', `${esc(sd.sector.name_ar)} · النشطة + الموقّعة حسب السنة`, `
    <div class="dd-kpi"><span class="v tnum">${fmtSar(activeC.v)}</span><span style="font-size:12px;color:var(--muted)">${activeC.n} عقد نشط · موقّع ${year}: ${sd.contracts_count} (${fmtSar(sd.contracts_halalas)})</span></div>
    <div class="dd-sec">أكبر العقود</div>
    <div>${ddRows(secContracts.map((c) => { const ip = c.value_halalas ? Math.min(100, Math.round(((c.invoiced || 0) / c.value_halalas) * 100)) : 0; return `
      <div style="padding:.4rem 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between;gap:.7rem;font-size:12.5px;align-items:baseline">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="/app/contract/${c.id}" style="color:var(--brand)">${esc(c.client || c.code || 'عقد')}</a>${c.code ? ` <span style="color:var(--faint);font-size:10.5px">${esc(c.code)}</span>` : ''}</span>
          <b class="tnum" style="flex:none">${fmtSar(c.value_halalas)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted)"><span>${tr(c.status)}${c.start_date ? ' · ' + String(c.start_date).slice(0, 10) : ''}</span><span class="tnum">فُوتر ${ip}%</span></div>
        <div class="bar" style="margin-top:.25rem;height:5px"><span style="width:${ip}%;background:var(--blue)"></span></div>
      </div>`; }))}</div>`)}
  ${ddWrap('secwins', `${G.sales} والفوز · ${year}`, `${esc(sd.sector.name_ar)} · مقابل هدف المبيعات`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--brand2)">${fmtSar(sd.sales_halalas)}</span><span style="font-size:12px;color:var(--muted)">${wins.won} صفقة مكسوبة · ${G.winRate} ${wins.winRate}%</span></div>
    ${attain(sd.sales_halalas, sd.target_sales_halalas, 'var(--brand2)')}
    <div class="dd-sec">الصفقات المكسوبة</div>
    <div>${ddRows(secWon.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(d.client || '—')}</span></span><b class="tnum" style="flex:none">${fmtSar(d.value_halalas)}</b></div>`))}</div>`)}
  ${ddWrap('att-late-dlv', 'مخرجات تحتاج متابعة', `${esc(sd.sector.name_ar)} · شهور سابقة لم تصل للفوترة`, `
    <div>${ddRows(lateDlv.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.project || '')} · ${esc(d.name_ar)} <span style="color:var(--faint);font-size:10.5px">شهر ${d.month}</span></span><b class="tnum" style="flex:none">${fmtSar(d.amount_halalas || 0)}</b></div>`))}</div>`)}`;

  const switcher = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    ${allSectors.map((s) => `<a href="/app/sector?year=${year}&sector=${s.id}" class="chip ${s.id === sectorId ? 'on' : ''}"><span class="dot" style="background:${s.color || '#244A99'}"></span>${esc(s.name_ar)}</a>`).join('')}
    <a class="btn btn-sm" style="margin-inline-start:.3rem" href="/app/ceo?year=${year}&sector=${sectorId}">لوحة القيادة لهذا القطاع</a>
  </div>` : '';

  const body = `
    ${switcher}
    <div style="display:grid;grid-template-columns:1.35fr 1fr;gap:.9rem;margin-bottom:.9rem">
      <div style="display:flex;flex-direction:column;gap:.9rem">${attnCard}${targetsCard}</div>
      <div style="display:flex;flex-direction:column;gap:.9rem">${oppsCard}${contractsCard}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${projectsCard}
      <div style="display:flex;flex-direction:column;gap:.9rem">${capCard}${decisionsCard}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem">
      ${clientsCard}${reportsCard}
    </div>
    ${DD}`;
  return layout({ user, active: 'sector', title: `مركز القطاع — ${esc(sd.sector.name_ar)}`, subtitle: `قصة القطاع: ما يحتاجك، أين نقف، وإلى أين نتجه · ${year}`, body, year });
}
