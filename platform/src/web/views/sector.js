// Sector command center.
import { layout, card, pill, tr, utilStrip } from '../layout.js';
import { fmtSar } from '../../core/util/ids.js';
import { all, get } from '../../core/db/index.js';
import { sectorDashboard, sectorStaffing, sectorClients, sectorWins } from '../../core/reports/metrics.js';
import { config } from '../../core/config.js';
import { esc, ddWrap, attain, ddRows } from './_shared.js';

export async function sectorPage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  // Company-scope users (owner/CEO office/finance/admin) can inspect ANY sector via ?sector= chips;
  // sector-scoped users stay locked to their own sector regardless of the query param.
  const allSectors = await all('SELECT id, name_ar, color FROM sector WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order');
  const requested = opts.sector && allSectors.some((s) => s.id === opts.sector) ? opts.sector : null;
  const sectorId = user.scope === 'company'
    ? (requested || user.sector_id || allSectors[0]?.id || 'SOLUTIONS')
    : (user.sector_id || 'SOLUTIONS');
  const sd = await sectorDashboard(user, sectorId, { year });
  // Open pipeline BY STAGE for THIS sector (not the user's whole visibility scope).
  const pipe = await all(`SELECT st.id, st.name_ar, st.color, COUNT(*) AS "count", COALESCE(SUM(o.value_halalas),0) AS value_halalas
     FROM opportunity o JOIN stage st ON st.id = o.stage_id
     WHERE st.is_won = 0 AND st.is_lost = 0 AND o.deleted_at IS NULL AND o.sector_id = ?
     GROUP BY st.id, st.name_ar, st.color, st.sort_order ORDER BY st.sort_order`, [sectorId]);
  if (!sd) return layout({ user, active: 'sector', title: 'مركز القطاع', body: '<div style="color:var(--muted)">لا يوجد قطاع مرتبط</div>' });
  const staff = await sectorStaffing(sectorId, year);
  const clients = await sectorClients(sectorId);
  const wins = await sectorWins(sectorId, year);
  // Active contract book (the year-signed figure alone reads as "0" whenever contracts were signed
  // in prior years — the owner needs the LIVE book, with year-signed as secondary context).
  const activeC = await get(`SELECT COUNT(*) n, COALESCE(SUM(value_halalas),0) v FROM contract
     WHERE sector_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'`, [sectorId]);
  const secContracts = await all(`SELECT c.id, c.code, c.value_halalas, c.status, c.start_date, cl.name_ar client,
     (SELECT COALESCE(SUM(i.amount_halalas),0) FROM invoice i WHERE i.contract_id = c.id AND i.status != 'DRAFT' AND i.deleted_at IS NULL) invoiced
     FROM contract c LEFT JOIN client cl ON cl.id = c.client_id
     WHERE c.sector_id = ? AND c.deleted_at IS NULL ORDER BY c.value_halalas DESC LIMIT 10`, [sectorId]);
  // Revenue by project (the owner's ask: WHICH projects produced the revenue, and each one's
  // realization % of its own contract value).
  // Canonical project value = contract ‖ budget ‖ PO (Solutions carries it in budget, not contract),
  // so the realized-% has a denominator even when the source has no contract value.
  const revByProject = await all(`SELECT p.id, p.name_ar,
       COALESCE(NULLIF(p.contract_value_halalas,0), NULLIF(p.budget_halalas,0), NULLIF(p.po_value_halalas,0)) cv,
       CASE WHEN COALESCE(p.contract_value_halalas,0)>0 THEN 'عقد' WHEN COALESCE(p.budget_halalas,0)>0 THEN 'ميزانية'
            WHEN COALESCE(p.po_value_halalas,0)>0 THEN 'أمر شراء' ELSE NULL END cvbasis,
       COALESCE(SUM(rl.amount_halalas),0) rev
     FROM revenue_line rl LEFT JOIN project p ON p.id = rl.project_id
     WHERE rl.sector_id = ? AND rl.year = ? GROUP BY p.id, p.name_ar, p.contract_value_halalas, p.budget_halalas, p.po_value_halalas
     ORDER BY rev DESC LIMIT 12`, [sectorId, year]);
  const secWon = await all(`SELECT o.title_ar, o.value_halalas, c.name_ar client FROM opportunity o
     JOIN stage st ON st.id = o.stage_id LEFT JOIN client c ON c.id = o.client_id
     WHERE o.sector_id = ? AND o.year = ? AND st.is_won = 1 AND o.exclude_from_sales = 0 AND o.deleted_at IS NULL
     ORDER BY o.value_halalas DESC LIMIT 8`, [sectorId, year]);
  const revPctS = sd.target_revenue_halalas ? Math.round((sd.revenue_halalas / sd.target_revenue_halalas) * 100) : null;
  const salesPctS = sd.target_sales_halalas ? Math.round((sd.sales_halalas / sd.target_sales_halalas) * 100) : null;
  const tasks = await all(`SELECT t.title, t.status, t.priority, t.due_date, COALESCE(u.name_ar,u.username,'—') assignee
     FROM task t LEFT JOIN app_user u ON u.id=t.assignee_user_id
     WHERE t.sector_id=? AND t.deleted_at IS NULL AND t.status != 'DONE' ORDER BY t.due_date LIMIT 12`, [sectorId]);
  // Stat tile: clickable (opens drill-down) + optional attainment bar vs target.
  const stat = (label, val, sub, o = {}) => card(`<div ${o.dd ? `role="button" tabindex="0" onclick="Sanad.openDD('${o.dd}')" onkeydown="if(event.key==='Enter'||event.key===' ')Sanad.openDD('${o.dd}')"` : ''} style="padding:.85rem 1rem">
    <div style="font-size:11px;color:var(--muted)">${label}${o.dd ? ' <span style="color:var(--faint)">⊕</span>' : ''}</div>
    <div class="metric tnum" style="font-size:1.35rem;color:${o.tone || 'var(--ink2)'}">${val}</div>
    ${sub ? `<div style="font-size:10.5px;color:var(--muted)">${sub}</div>` : ''}
    ${o.bar ? `<div class="bar" style="margin-top:.4rem;height:5px"><span style="width:${Math.min(100, o.bar.p || 0)}%;background:${o.bar.color || 'var(--brand)'}"></span></div>` : ''}
  </div>`, o.dd ? 'cardclick card-h' : '');
  const maxPipe = Math.max(1, ...pipe.map((s) => s.value_halalas));
  const pipeRow = pipe.filter((s) => s.count > 0).map((s) => `<div style="padding:.3rem 0">
    <div style="display:flex;align-items:center;gap:.5rem;font-size:12.5px">
      <span style="width:9px;height:9px;border-radius:3px;background:${s.color}"></span>
      <span style="flex:1">${esc(s.name_ar)}</span><span style="font-weight:800" class="tnum">${s.count}</span>
      <span style="color:var(--muted);font-size:11px" class="tnum">${fmtSar(s.value_halalas)}</span></div>
    <div class="bar" style="margin-top:.22rem"><span style="width:${Math.round(s.value_halalas / maxPipe * 100)}%;background:${s.color}"></span></div></div>`).join('') || '<div style="color:var(--faint);font-size:12px">لا فرص</div>';
  const utilTone = (u) => u > 100 ? 'var(--red)' : u >= 70 ? 'var(--green)' : u >= 40 ? 'var(--amber)' : 'var(--muted)';
  const staffRows = staff.employees.slice(0, 12).map((e) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .6rem;font-size:12.5px">${esc(e.name)}<div style="font-size:10.5px;color:var(--muted)">${esc(e.job || '')}</div></td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:12px" class="tnum">${e.projects}</td>
    <td style="padding:.4rem .6rem;width:150px">${utilStrip(e.months, staff.currentMonth)}</td>
    <td style="padding:.4rem .6rem;text-align:center" class="tnum"><span style="font-weight:800;font-size:13px;color:${utilTone(e.current)}">${e.current}%</span><div style="font-size:9.5px;color:var(--faint)">سنويًا ${e.utilization}%</div></td></tr>`).join('') || '<tr><td colspan="4" style="padding:1rem;color:var(--muted);font-size:12px">لا تسكين مسجّل لهذا القطاع في ' + year + '</td></tr>';
  const clientRows = clients.map((c) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .6rem;font-size:12.5px">${esc(c.name_ar)}</td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:12px" class="tnum">${c.opps}</td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:12px" class="tnum">${c.projects}</td>
    <td style="padding:.4rem .6rem;text-align:left;font-size:12px;font-weight:700" class="tnum">${fmtSar(c.pipeline_halalas)}</td></tr>`).join('') || '<tr><td colspan="4" style="padding:1rem;color:var(--muted);font-size:12px">لا عملاء</td></tr>';
  const taskRows = tasks.map((t) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .6rem;font-size:12.5px">${esc(t.title)}</td>
    <td style="padding:.4rem .6rem;font-size:11px;color:var(--muted)">${esc(t.assignee)}</td>
    <td style="padding:.4rem .6rem;text-align:center">${pill(tr(t.status), t.status === 'BLOCKED' ? 'red' : t.status === 'IN_PROGRESS' ? 'blue' : 'slate')}</td>
    <td style="padding:.4rem .6rem;text-align:center;font-size:11px;color:var(--muted)" class="tnum">${t.due_date || '—'}</td></tr>`).join('') || '<tr><td colspan="4" style="padding:1rem;color:var(--muted);font-size:12px">لا مهام مفتوحة</td></tr>';
  const th = (t) => `<th style="padding:.4rem .6rem;font-size:10.5px;color:var(--muted);font-weight:700;text-align:${t.a || 'right'}">${t.t}</th>`;
  // Bonuses/incentives (المكافآت): no bonus/incentive table exists in the data snapshot, and individual
  // salary is HR-gated by design. We show the REAL incentive-pool basis (won-deal value) — never fabricated
  // per-person figures — and state transparently that individual distribution needs an HR/payroll source.
  const avgWon = wins.won ? Math.round(wins.wonValue_halalas / wins.won) : 0;
  const bonusesCard = card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:800;font-size:13.5px">المكافآت والحوافز</div><span style="font-size:10px;color:var(--amber);font-weight:700">مصدر HR غير مربوط</span></div>
    <div style="padding:.6rem 1rem">
      <div style="display:flex;justify-content:space-between;padding:.3rem 0;border-bottom:1px dashed var(--line)"><span style="font-size:12px;color:var(--muted)">أساس الحوافز · قيمة الصفقات المكسوبة ${year}</span><span class="tnum" style="font-weight:800;font-size:13px;color:var(--green)">${fmtSar(wins.wonValue_halalas)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:.3rem 0;border-bottom:1px dashed var(--line)"><span style="font-size:12px;color:var(--muted)">صفقات مكسوبة</span><span class="tnum" style="font-weight:800;font-size:13px">${wins.won}</span></div>
      <div style="display:flex;justify-content:space-between;padding:.3rem 0"><span style="font-size:12px;color:var(--muted)">متوسط قيمة الصفقة</span><span class="tnum" style="font-weight:800;font-size:13px">${fmtSar(avgWon)}</span></div>
      <div style="margin-top:.5rem;font-size:10.5px;color:var(--faint);line-height:1.6;background:var(--bg,#f6f7fb);border-radius:8px;padding:.5rem .6rem">توزيع المكافآت الفردية يتطلب ربط مصدر بيانات الموارد البشرية/الرواتب أو تعريف قاعدة الحوافز. الأساس أعلاه محسوب من الصفقات الفعلية.</div>
    </div>`);
  // ── Drill-down templates: revenue-by-project (owner ask), contract book, sales/wins ──
  const secDD = `
  ${ddWrap('secrev', `إيراد القطاع حسب المشروع · ${year}`, `${esc(sd.sector.name_ar)} · المحقق مقابل قيمة كل مشروع`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--green)">${fmtSar(sd.revenue_halalas)}</span><span style="font-size:12px;color:var(--muted)">إجمالي المحقق ${year}</span></div>
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
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.client || c.code || 'عقد')}${c.code ? ` <span style="color:var(--faint);font-size:10.5px">${esc(c.code)}</span>` : ''}</span>
          <b class="tnum" style="flex:none">${fmtSar(c.value_halalas)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted)"><span>${tr(c.status)}${c.start_date ? ' · ' + String(c.start_date).slice(0, 10) : ''}</span><span class="tnum">فُوتر ${ip}%</span></div>
        <div class="bar" style="margin-top:.25rem;height:5px"><span style="width:${ip}%;background:var(--blue)"></span></div>
      </div>`; }))}</div>`)}
  ${ddWrap('secwins', `المبيعات والفوز · ${year}`, `${esc(sd.sector.name_ar)} · مقابل هدف المبيعات`, `
    <div class="dd-kpi"><span class="v tnum" style="color:var(--brand2)">${fmtSar(sd.sales_halalas)}</span><span style="font-size:12px;color:var(--muted)">${wins.won} صفقة مكسوبة · معدل ${wins.winRate}%</span></div>
    ${attain(sd.sales_halalas, sd.target_sales_halalas, 'var(--brand2)')}
    <div class="dd-sec">الصفقات المكسوبة</div>
    <div>${ddRows(secWon.map((d) => `<div class="dd-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title_ar)}<span style="color:var(--faint);font-size:10.5px"> · ${esc(d.client || '—')}</span></span><b class="tnum" style="flex:none">${fmtSar(d.value_halalas)}</b></div>`))}</div>`)}`;

  const switcher = user.scope === 'company' ? `<div class="chips"><span class="lbl">القطاع:</span>
    ${allSectors.map((s) => `<a href="/app/sector?year=${year}&sector=${s.id}" class="chip ${s.id === sectorId ? 'on' : ''}"><span class="dot" style="background:${s.color || '#2563eb'}"></span>${esc(s.name_ar)}</a>`).join('')}
    <a class="btn btn-sm" style="margin-inline-start:.3rem" href="/app/ceo?year=${year}&sector=${sectorId}">لوحة القيادة لهذا القطاع</a>
  </div>` : '';
  const body = `
    ${switcher}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:.85rem;margin-bottom:.9rem">
      ${stat(`إيراد ${year}`, fmtSar(sd.revenue_halalas),
        revPctS != null ? `الهدف ${fmtSar(sd.target_revenue_halalas)} · تحقّق ${revPctS}%` : `انقر لتفاصيل المشاريع`,
        { dd: 'secrev', tone: 'var(--green)', bar: revPctS != null ? { p: revPctS, color: 'var(--green)' } : null })}
      ${stat(`مبيعات ${year}`, fmtSar(sd.sales_halalas),
        salesPctS != null ? `الهدف ${fmtSar(sd.target_sales_halalas)} · تحقّق ${salesPctS}%` : `${wins.won} صفقة مكسوبة`,
        { dd: 'secwins', tone: 'var(--brand2)', bar: salesPctS != null ? { p: salesPctS, color: 'var(--brand2)' } : null })}
      ${stat('العقود النشطة', fmtSar(activeC.v), `${activeC.n} عقد نشط · موقّع ${year}: ${sd.contracts_count} (${fmtSar(sd.contracts_halalas)})`, { dd: 'seccontracts' })}
      ${stat('إشغال الفريق الآن', (staff.teamCurrent ?? staff.teamUtil) + '%', `سنويًا ${staff.teamUtil}% · ${staff.headcount} موظف`, { tone: utilTone(staff.teamCurrent ?? staff.teamUtil) })}
      ${stat('الفوز', wins.won + ' فرصة', `نسبة ${wins.winRate}% · خسارة ${wins.lost}`, { dd: 'secwins', tone: 'var(--green)' })}
      ${stat('مشاريع قائمة', sd.projects.IN_PROGRESS || 0, `مخاطر مفتوحة ${sd.openRisks}`)}
    </div>
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:.9rem;margin-bottom:.9rem">
      ${card(`<div style="padding:.85rem 1rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)"><div style="font-weight:800;font-size:13.5px">التسكين الشهري واليوتيليزيشن</div><span style="font-size:10.5px;color:var(--muted)">أخضر ≥80% · أصفر · أحمر تجاوز</span></div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>${th({ t: 'الموظف' })}${th({ t: 'مشاريع', a: 'center' })}${th({ t: 'يناير → ديسمبر', a: 'center' })}${th({ t: 'الإشغال (الآن·سنوي)', a: 'center' })}</tr></thead><tbody>${staffRows}</tbody></table>`)}
      <div style="display:flex;flex-direction:column;gap:.9rem">
        ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">خط الفرص حسب المرحلة</div><div style="padding:.6rem 1rem">${pipeRow}</div>`)}
        ${bonusesCard}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">العملاء وخط أنابيبهم</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>${th({ t: 'العميل' })}${th({ t: 'فرص', a: 'center' })}${th({ t: 'مشاريع', a: 'center' })}${th({ t: 'الخط', a: 'left' })}</tr></thead><tbody>${clientRows}</tbody></table>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">المهام المُسكَّنة المفتوحة</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>${th({ t: 'المهمة' })}${th({ t: 'المسؤول' })}${th({ t: 'الحالة', a: 'center' })}${th({ t: 'الاستحقاق', a: 'center' })}</tr></thead><tbody>${taskRows}</tbody></table>`)}
    </div>
    ${secDD}`;
  return layout({ user, active: 'sector', title: `مركز القطاع — ${esc(sd.sector.name_ar)}`, subtitle: `قيادة القطاع · السنة المالية ${year}`, body, year });
}
