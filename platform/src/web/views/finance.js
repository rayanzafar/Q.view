// Finance pages: company financials + contract detail (claims/invoices).
import { layout, card, pill, tr } from '../layout.js';
import { fmtSar } from '../../core/util/ids.js';
import { config } from '../../core/config.js';
import { financeSummary, financeByPM, financeByContract, financeByClient, contractDetail } from '../../modules/finance/finance.js';
import { sarShort, esc, noticeCard } from './_shared.js';

export async function financePage(user, opts = {}) {
  const year = Number(opts.year) || config.fiscalYear;
  const s = await financeSummary(user, year);
  const byPM = await financeByPM(user, year);
  const byClient = await financeByClient(user, year);
  const byContract = await financeByContract(user);
  const tile = (l, v, sub, color) => card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">${l}</div>
    <div class="metric" style="font-size:1.35rem;${color ? 'color:' + color : ''}">${v}</div>${sub ? `<div style="font-size:11px;color:var(--muted)">${sub}</div>` : ''}</div>`);
  // bridge: bookings → revenue → invoiced → collected
  const bridge = [['التعاقدات', s.bookings_halalas, 'var(--brand)'], ['الإيراد المحقق', s.revenue_halalas, 'var(--brand2)'],
    ['المُفوتر', s.invoiced_halalas, '#0891b2'], ['المُحصَّل', s.collected_halalas, '#059669']];
  const maxB = Math.max(1, ...bridge.map((b) => b[1]));
  const bridgeHtml = bridge.map((b) => `<div style="flex:1;text-align:center">
    <div style="font-size:11px;color:var(--muted)">${b[0]}</div>
    <div style="font-weight:800;font-size:15px" class="tnum">${fmtSar(b[1])}</div>
    <div class="bar" style="margin-top:.35rem"><span style="width:${Math.round(b[1] / maxB * 100)}%;background:${b[2]}"></span></div></div>`).join('<div style="color:var(--faint);align-self:center;padding:0 .3rem">←</div>');
  const agingMax = Math.max(1, ...Object.values(s.aging));
  const agingHtml = Object.entries(s.aging).map(([k, v]) => `<div style="display:flex;align-items:center;gap:.5rem;font-size:12px;padding:.2rem 0">
    <span style="width:52px;color:var(--muted)">${k} يوم</span>
    <div class="bar" style="flex:1"><span style="width:${Math.round(v / agingMax * 100)}%;background:${k === '90+' ? 'var(--red)' : k === '61-90' ? 'var(--amber)' : 'var(--brand)'}"></span></div>
    <span class="tnum" style="width:90px;text-align:left">${fmtSar(v)}</span></div>`).join('');
  // Client concentration by contract value — the reliable, richly-populated finance signal (invoices in this
  // dataset are largely not contract-linked, so aggregate AR lives in the KPIs/bridge, not per-client here).
  const maxClientVal = Math.max(1, ...byClient.map((c) => c.value_halalas));
  const clientRows = byClient.slice(0, 13).map((c, i) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.42rem .7rem;font-size:var(--fs-body);color:var(--faint);width:20px" class="tnum">${i + 1}</td>
    <td style="padding:.42rem .7rem;font-size:var(--fs-body)">${esc(c.name_ar)}</td>
    <td style="padding:.42rem .7rem;text-align:center;font-size:var(--fs-meta);color:var(--muted)" class="tnum">${c.contracts}</td>
    <td style="padding:.42rem .7rem;width:150px"><div style="display:flex;align-items:center;gap:.4rem"><div class="bar" style="flex:1"><span style="width:${Math.round(c.value_halalas / maxClientVal * 100)}%;background:var(--brand)"></span></div><span style="font-size:var(--fs-meta);white-space:nowrap" class="tnum">${sarShort(c.value_halalas)}</span></div></td></tr>`).join('');
  // Portfolio-summary stats fill the right column with meaningful computed metrics (no sparse whitespace).
  const liveContracts = byContract.filter((c) => !c.unassigned);
  const totalCV = liveContracts.reduce((a, c) => a + (c.value_halalas || 0), 0);
  const totalBacklog = liveContracts.reduce((a, c) => a + (c.backlog_halalas || 0), 0);
  const avgCV = liveContracts.length ? Math.round(totalCV / liveContracts.length) : 0;
  const sumStat = (l, v, tone) => `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:.5rem 0;border-bottom:1px dashed var(--line)"><span style="font-size:12px;color:var(--muted)">${l}</span><span class="tnum" style="font-weight:800;font-size:var(--fs-title);${tone ? 'color:' + tone : ''}">${v}</span></div>`;
  // Keep the top contracts by value AND always retain the 'unassigned' reconciliation bucket (it is
  // appended last by financeByContract, so a plain slice would drop it and understate the total).
  const cTop = byContract.filter((c) => !c.unassigned).slice(0, 30);
  const cBucket = byContract.find((c) => c.unassigned);
  const cRows = [...cTop, ...(cBucket ? [cBucket] : [])].map((c) => `<tr style="border-bottom:1px solid var(--line)${c.unassigned ? '' : ';cursor:pointer'}" ${c.unassigned ? '' : `onclick="location.href='/app/contract/${c.id}'"`}>
    <td style="padding:.5rem .75rem;font-size:var(--fs-ui)">${esc(c.project_name || c.code || c.id)}<div style="font-size:11px;color:var(--muted)">${esc(c.client_name || '')}</div></td>
    <td style="padding:.5rem .75rem;font-size:var(--fs-ui);text-align:center" class="tnum">${fmtSar(c.value_halalas)}</td>
    <td style="padding:.5rem .75rem;text-align:center">${c.billed_pct == null ? '<span style="font-size:11px;color:var(--muted)">—</span>' : `<div class="bar" style="width:70px;display:inline-block;vertical-align:middle"><span style="width:${Math.min(100, c.billed_pct)}%;background:var(--brand)"></span></div> <span style="font-size:11px">${c.billed_pct}%</span>`}</td>
    <td style="padding:.5rem .75rem;font-size:var(--fs-ui);text-align:center;color:var(--muted)" class="tnum">${fmtSar(c.backlog_halalas)}</td></tr>`).join('');
  const body = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:.85rem;margin-bottom:1.25rem">
      ${tile('التعاقدات', fmtSar(s.bookings_halalas))}
      ${tile('المُفوتر', fmtSar(s.invoiced_halalas))}
      ${tile('الذمم المدينة (AR)', fmtSar(s.ar_halalas), 'مستحق غير محصَّل', 'var(--amber)')}
      ${tile('معدل التحصيل', s.collectionRate + '%')}
      ${tile('DSO', s.dso + ' يوم', 'فترة التحصيل')}
    </div>
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:1rem;margin-bottom:1.25rem">
      ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:var(--fs-title);margin-bottom:.75rem">الجسر المالي · ${year}</div>
        <div style="display:flex;align-items:stretch">${bridgeHtml}</div></div>`)}
      ${card(`<div style="padding:1rem"><div style="font-weight:800;font-size:var(--fs-title);margin-bottom:.5rem">أعمار الذمم المدينة</div>${agingHtml}</div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:1rem;margin-bottom:1.25rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center"><div style="font-weight:800;font-size:var(--fs-ui)">تركّز العملاء حسب قيمة العقود</div><span style="font-size:var(--fs-micro);color:var(--muted)">${byClient.length} عميل</span></div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:var(--fs-micro);color:var(--muted);text-align:right"><th style="padding:.4rem .7rem"></th><th style="padding:.4rem .7rem">العميل</th><th style="padding:.4rem .7rem;text-align:center">عقود</th><th style="padding:.4rem .7rem">قيمة العقود</th></tr></thead>
        <tbody>${clientRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:var(--fs-body)" colspan="4">لا عملاء بعقود</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:var(--fs-ui)">ملخص محفظة العقود</div>
        <div style="padding:.4rem 1rem .7rem">
          ${sumStat('إجمالي العقود', liveContracts.length + ' عقد')}
          ${sumStat('إجمالي قيمة العقود', fmtSar(totalCV))}
          ${sumStat('متوسط قيمة العقد', fmtSar(avgCV))}
          ${sumStat('Backlog (غير مُفوتر)', fmtSar(totalBacklog), 'var(--brand2)')}
          ${sumStat('المُحصَّل / المُفوتر', s.collectionRate + '%', s.collectionRate < 40 ? 'var(--red)' : 'var(--green)')}
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:.5rem 0"><span style="font-size:12px;color:var(--muted)">مدير المشروع الأنشط</span><span style="font-size:12px;font-weight:700">${esc((byPM.filter((p) => p.invoiced_halalas > 0)[0] || {}).pm || '—')}</span></div>
        </div>`)}
    </div>
    ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center"><div style="font-weight:800;font-size:var(--fs-ui)">العقود · اضغط أي عقد للتفصيل والمستخلصات</div><span style="font-size:11px;color:var(--muted)">${cTop.length} عقد</span></div>
      <div style="max-height:460px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:var(--fs-micro);color:var(--muted);text-align:right;position:sticky;top:0;background:var(--surface)"><th style="padding:.4rem .75rem">العقد/المشروع</th><th style="padding:.4rem .75rem;text-align:center">القيمة</th><th style="padding:.4rem .75rem;text-align:center">نسبة الفوترة</th><th style="padding:.4rem .75rem;text-align:center">Backlog</th></tr></thead>
      <tbody>${cRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:var(--fs-body)" colspan="4">لا عقود</td></tr>'}</tbody></table></div>`)}`;
  return layout({ user, active: 'finance', title: 'المالية', subtitle: `عقود · فواتير · مستخلصات · تحصيل · السنة ${year}`, body, year });
}

export async function contractDetailPage(user, contractId) {
  let d;
  try { d = await contractDetail(user, contractId); } catch (e) { return layout({ user, active: 'finance', title: 'العقد', body: noticeCard('تعذّر عرض العقد', e.message, '/app/finance', 'العودة للمالية') }); }
  const c = d.contract;
  const invRows = d.invoices.map((i) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.5rem .75rem;font-size:var(--fs-ui)">${i.kind === 'progress_claim' ? 'مستخلص #' + (i.claim_no || '') : (i.code || i.id)}${i.period_label ? `<div style="font-size:11px;color:var(--muted)">${i.period_label}</div>` : ''}</td>
    <td style="padding:.5rem .75rem;font-size:var(--fs-ui);text-align:center" class="tnum">${fmtSar(i.amount_halalas)}</td>
    <td style="padding:.5rem .75rem;text-align:center">${pill(tr(i.status), i.status === 'PAID' ? 'green' : i.status === 'OVERDUE' ? 'red' : i.status === 'PARTIALLY_PAID' ? 'amber' : 'blue')}</td>
    <td style="padding:.5rem .75rem;font-size:var(--fs-ui);text-align:center;color:var(--amber)" class="tnum">${fmtSar(i.outstanding_halalas)}</td>
    <td style="padding:.5rem .75rem;text-align:center">${i.outstanding_halalas > 0 ? `<button onclick="Sanad.recordCollection('${i.id}', ${i.outstanding_halalas / 100})" style="border:1px solid var(--line);cursor:pointer;font-size:11px;padding:.25rem .5rem;border-radius:6px;background:#fff">تسجيل تحصيل</button>` : '✓'}</td></tr>`).join('');
  const eligible = d.deliverables.filter((dl) => ['DELIVERED', 'ACCEPTED'].includes(dl.status));
  const dlvRows = d.deliverables.map((dl) => `<tr style="border-bottom:1px solid var(--line)">
    <td style="padding:.4rem .75rem;font-size:var(--fs-ui)">${esc(dl.name_ar)}</td>
    <td style="padding:.4rem .75rem;font-size:var(--fs-ui);text-align:center" class="tnum">${fmtSar(dl.amount_halalas)}</td>
    <td style="padding:.4rem .75rem;text-align:center">${pill(tr(dl.status), dl.status === 'PAID' || dl.status === 'INVOICED' ? 'green' : dl.status === 'DELIVERED' ? 'blue' : 'slate')}</td></tr>`).join('');
  const body = `
    <a href="/app/finance" style="font-size:12px;color:var(--muted)">← المالية</a>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.85rem;margin:.75rem 0 1.25rem">
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">قيمة العقد</div><div class="metric" style="font-size:1.3rem">${fmtSar(c.value_halalas)}</div></div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">نسبة الفوترة</div><div class="metric" style="font-size:1.3rem">${d.billed_pct}%</div></div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">Backlog متبقٍّ</div><div class="metric" style="font-size:1.3rem">${fmtSar(d.backlog_halalas)}</div></div>`)}
      ${card(`<div style="padding:.9rem 1rem"><div style="font-size:11px;color:var(--muted)">العميل</div><div style="font-weight:700;font-size:15px;margin-top:.4rem">${esc(d.client || '—')}</div></div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;font-size:var(--fs-ui)">المستخلصات والفواتير</div>
        ${eligible.length ? `<button onclick="Sanad.progressClaim('${c.id}')" class="text-white" style="border:none;cursor:pointer;font-size:12px;padding:.35rem .8rem;border-radius:8px;background:var(--brand-grad)">+ مستخلص من ${eligible.length} مخرج مسلّم</button>` : '<span style="font-size:11px;color:var(--muted)">لا مخرجات مؤهلة</span>'}</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">المستخلص/الفاتورة</th><th style="padding:.4rem .75rem;text-align:center">القيمة</th><th style="padding:.4rem .75rem;text-align:center">الحالة</th><th style="padding:.4rem .75rem;text-align:center">متبقٍّ</th><th style="padding:.4rem .75rem"></th></tr></thead>
        <tbody>${invRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:var(--fs-ui)" colspan="5">لا مستخلصات بعد — أنشئ واحداً من المخرجات المسلّمة</td></tr>'}</tbody></table>`)}
      ${card(`<div style="padding:1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:var(--fs-ui)">مخرجات المشروع</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:11px;color:var(--muted);text-align:right"><th style="padding:.4rem .75rem">المخرج</th><th style="padding:.4rem .75rem;text-align:center">القيمة</th><th style="padding:.4rem .75rem;text-align:center">الحالة</th></tr></thead>
        <tbody>${dlvRows || '<tr><td style="padding:1rem;color:var(--muted);font-size:var(--fs-ui)" colspan="3">لا مخرجات</td></tr>'}</tbody></table>`)}
    </div>`;
  return layout({ user, active: 'finance', title: `العقد — ${esc(c.code || c.id)}`, subtitle: esc(d.project?.name_ar || ''), body });
}
