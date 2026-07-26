// Executive email templates — Outlook/Gmail-safe HTML (tables + inline CSS, RTL).
// Sensitive figures are passed pre-redacted by the caller (report engine).
import { fmtSar } from '../util/ids.js';

// ألوان هوية EVC الرسمية (نفس توكنات الواجهة #244A99/#834798) — البريد جزء من الهوية لا استثناء منها
const BRAND = '#244A99', BRAND2 = '#834798', INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0';
const GREEN = '#059669', RED = '#dc2626';

// كل اسم/عنوان مصدره بيانات عمل (عميل/فرصة/مشروع/قطاع/عضو) يجب أن يمر من هنا قبل الحقن في HTML —
// هذا الملف الوحيد بالمنصة كان بلا تهريب إطلاقاً (كل ملفات SSR الأخرى تستخدم esc() دائماً).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shell({ title, period, bodyRows, locale = 'ar' }) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html dir="${dir}" lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
  <tr><td style="background:linear-gradient(120deg,${BRAND},${BRAND2});padding:20px 24px;color:#fff">
    <div style="font-size:13px;opacity:.9">EVC · رؤية الخبراء الاستشارية · منصة سند</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">${title}</div>
    <div style="font-size:12px;opacity:.85;margin-top:2px">${period || ''}</div>
  </td></tr>
  <tr><td style="padding:20px 24px">${bodyRows}</td></tr>
  <tr><td style="padding:14px 24px;background:#f8fafc;border-top:1px solid ${LINE};font-size:11px;color:${MUTED}">
    تقرير آلي من منصة سند · مصدر البيانات: قاعدة سند · تُحجب الأرقام الحساسة حسب صلاحية المستلم ·
    <a href="#" style="color:${BRAND};text-decoration:none">فتح المنصة</a>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function kpiRow(label, value, sub) {
  return `<td style="padding:10px;border:1px solid ${LINE};border-radius:10px;background:#f8fafc" valign="top">
    <div style="font-size:11px;color:${MUTED}">${label}</div>
    <div style="font-size:20px;font-weight:700;color:${INK}">${value}</div>
    ${sub ? `<div style="font-size:11px;color:${MUTED};margin-top:2px">${sub}</div>` : ''}</td>`;
}

function section(title, inner) {
  return `<div style="font-size:14px;font-weight:700;margin:16px 0 8px">${title}</div>${inner}`;
}

function list(items) {
  if (!items || !items.length) return `<div style="color:${MUTED};font-size:13px">لا يوجد</div>`;
  return '<ul style="margin:0;padding-inline-start:18px;font-size:13px;line-height:1.9">' +
    items.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>';
}

// Weekly Executive Brief
export function weeklyExecBrief(data) {
  const t = data.totals;
  const dealRows = (deals, showWin) => !deals || !deals.length ? `<div style="color:${MUTED};font-size:13px">لا يوجد</div>` :
    `<table role="presentation" width="100%" cellspacing="0" style="font-size:13px">
      <tr><th align="start" style="color:${MUTED};font-size:11px;padding:4px 6px">العميل</th>
      <th align="start" style="color:${MUTED};font-size:11px;padding:4px 6px">الفرصة</th>
      <th style="color:${MUTED};font-size:11px;padding:4px 6px">القيمة</th>${showWin ? `<th style="color:${MUTED};font-size:11px;padding:4px 6px">%</th>` : ''}</tr>
      ${deals.map((d) => `<tr><td style="padding:5px 6px;border-top:1px solid ${LINE};font-weight:600">${esc(d.client)}</td>
        <td style="padding:5px 6px;border-top:1px solid ${LINE}">${esc(d.title)}</td>
        <td style="padding:5px 6px;border-top:1px solid ${LINE};text-align:center">${fmtSar(d.value_halalas)}</td>
        ${showWin ? `<td style="padding:5px 6px;border-top:1px solid ${LINE};text-align:center">${Math.round(d.win_pct || 0)}%</td>` : ''}</tr>`).join('')}
    </table>`;
  const body = [
    section('الملخص التنفيذي',
      `<table role="presentation" width="100%" cellspacing="8"><tr>
        ${kpiRow('الإيراد المحقق', fmtSar(t.revenue), `المستهدف ${fmtSar(t.target_revenue)}`)}
        ${kpiRow('المبيعات المحققة', fmtSar(t.sales), `المستهدف ${fmtSar(t.target_sales)}`)}
        ${kpiRow('خط الفرص', fmtSar(data.pipeline_halalas), `${data.oppCount || ''} فرصة`)}
      </tr></table>`),
    section('أبرز الصفقات المكتسبة (السنة الحالية)', dealRows(data.topDeals, false)),
    section('أكبر الفرص المفتوحة', dealRows(data.topPipeline, true)),
    section('أبرز الإنجازات', list(data.achievements)),
    section('التحديات', list(data.challenges)),
    section('القرارات المطلوبة', list(data.decisions)),
    section('مخاطر الأسبوع القادم', list(data.risks)),
  ].join('');
  return { subject: `الموجز التنفيذي الأسبوعي — ${data.period}`, html: shell({ title: 'الموجز التنفيذي الأسبوعي', period: data.period, bodyRows: body }) };
}

// Sector Weekly Status
export function sectorWeeklyStatus(data) {
  const rows = (data.projects || []).map((p) =>
    `<tr><td style="padding:8px;border-bottom:1px solid ${LINE};font-size:13px">${esc(p.name_ar)}</td>
      <td style="padding:8px;border-bottom:1px solid ${LINE};text-align:center">
        <span style="background:${p.rag === 'RED' ? '#fee2e2' : p.rag === 'AMBER' ? '#fef3c7' : '#dcfce7'};
        color:${p.rag === 'RED' ? '#dc2626' : p.rag === 'AMBER' ? '#d97706' : '#059669'};
        padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">${p.rag}</span></td>
      <td style="padding:8px;border-bottom:1px solid ${LINE};text-align:center;font-size:13px">${Math.round(p.progress_pct || 0)}%</td></tr>`).join('');
  const body = [
    section('حالة القطاع', `<div style="font-size:13px;color:${MUTED}">${esc(data.sectorName)} · ${data.period}</div>`),
    section('المشاريع', `<table role="presentation" width="100%" cellspacing="0">
      <tr><th align="start" style="font-size:11px;color:${MUTED};padding:6px 8px">المشروع</th>
      <th style="font-size:11px;color:${MUTED};padding:6px 8px">الحالة</th>
      <th style="font-size:11px;color:${MUTED};padding:6px 8px">الإنجاز</th></tr>${rows || ''}</table>`),
    section('المخاطر والإجراءات القادمة', list(data.risks)),
  ].join('');
  return { subject: `حالة القطاع الأسبوعية — ${data.sectorName}`, html: shell({ title: 'حالة القطاع الأسبوعية', period: `${esc(data.sectorName)} · ${data.period}`, bodyRows: body }) };
}

// Monthly Sector Performance — target vs actual, margin, RAG, YoY.
export function monthlySectorPerformance(data) {
  const row = (label, val, sub) => `<td style="padding:10px;border:1px solid ${LINE};border-radius:10px;background:#f8fafc" valign="top">
    <div style="font-size:11px;color:${MUTED}">${label}</div><div style="font-size:18px;font-weight:700">${val}</div>
    ${sub ? `<div style="font-size:11px;color:${MUTED}">${sub}</div>` : ''}</td>`;
  const yoy = (v) => v == null ? '' : `<span style="color:${v >= 0 ? GREEN : RED};font-weight:700;font-size:12px"> ${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%</span>`;
  const body = [
    section(`الأداء الشهري — ${esc(data.sectorName)} · ${data.period}`,
      `<table role="presentation" width="100%" cellspacing="8"><tr>
        ${row('الإيراد', fmtSar(data.revenue_halalas), `الهدف ${fmtSar(data.target_revenue_halalas)}`)}
        ${row('التعاقدات', fmtSar(data.sales_halalas), `الهدف ${fmtSar(data.target_sales_halalas)}`)}
        ${row('الهامش الإجمالي', data.margin_pct != null ? data.margin_pct + '%' : '—', `الهدف ${data.target_margin_pct || 0}%`)}
      </tr><tr>
        ${row('النمو السنوي (إيراد)', (data.revenue_yoy != null ? data.revenue_yoy + '%' : '—'), 'مقابل السنة السابقة')}
        ${row('التعاقد إلى الإيراد', data.book_to_bill != null ? data.book_to_bill + '×' : '—', 'حجوزات/إيراد')}
        ${row('مشاريع (أخضر/أصفر/أحمر)', `${data.rag.GREEN || 0}/${data.rag.AMBER || 0}/${data.rag.RED || 0}`, 'حالة المحفظة')}
      </tr></table>`),
    section('أبرز مشاريع القطاع', data.projects && data.projects.length ?
      `<table width="100%" cellspacing="0" style="font-size:13px">${data.projects.map((p) => `<tr>
        <td style="padding:6px;border-top:1px solid ${LINE}">${esc(p.name_ar)}</td>
        <td style="padding:6px;border-top:1px solid ${LINE};text-align:center">${Math.round(p.progress_pct || 0)}%</td>
        <td style="padding:6px;border-top:1px solid ${LINE};text-align:center"><span style="background:${p.rag === 'RED' ? '#fee2e2' : p.rag === 'AMBER' ? '#fef3c7' : '#dcfce7'};color:${p.rag === 'RED' ? RED : p.rag === 'AMBER' ? '#b45309' : GREEN};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">${p.rag}</span></td></tr>`).join('')}</table>` : list([])),
  ].join('');
  return { subject: `أداء القطاع الشهري — ${data.sectorName} · ${data.period}`,
    html: shell({ title: 'أداء القطاع الشهري', period: `${esc(data.sectorName)} · ${data.period}`, bodyRows: body }) };
}

// Project Status Report (RAG) — scope/progress/time/cost/deliverables/risks.
export function projectStatusReport(data) {
  const p = data.project;
  const ragColor = p.rag === 'RED' ? RED : p.rag === 'AMBER' ? '#b45309' : GREEN;
  const kpi = (l, v) => `<td style="padding:10px;border:1px solid ${LINE};border-radius:10px;background:#f8fafc"><div style="font-size:11px;color:${MUTED}">${l}</div><div style="font-size:17px;font-weight:700">${v}</div></td>`;
  const body = [
    `<div style="display:inline-block;background:${ragColor};color:#fff;padding:4px 14px;border-radius:99px;font-weight:700;margin-bottom:10px">حالة RAG: ${p.rag}</div>`,
    section('نظرة عامة', `<table width="100%" cellspacing="8"><tr>
      ${kpi('الإنجاز', Math.round(p.progress_pct || 0) + '%')}
      ${kpi('قبول المخرجات', data.kpis.deliverableAcceptanceRate + '%')}
      ${kpi('مهام متأخرة', data.kpis.lateTasks)}
      ${kpi('قيمة العقد', fmtSar(p.contract_value_halalas))}
    </tr></table>`),
    section('المخرجات القادمة/المتأخرة', list(data.deliverables)),
    section('المخاطر والقضايا المفتوحة', list(data.risks)),
  ].join('');
  return { subject: `تقرير حالة المشروع — ${p.name_ar}`,
    html: shell({ title: 'تقرير حالة المشروع', period: `${esc(p.name_ar)} · ${data.period}`, bodyRows: body }) };
}

// Workforce & Utilization — per-person billable utilization (aggregate; anti-surveillance).
export function workforceUtilization(data) {
  const rows = (data.people || []).map((u) => `<tr>
    <td style="padding:6px;border-top:1px solid ${LINE}">${esc(u.name_ar)}</td>
    <td style="padding:6px;border-top:1px solid ${LINE};text-align:center">${u.total || 0}h</td>
    <td style="padding:6px;border-top:1px solid ${LINE};text-align:center">${u.billable || 0}h</td>
    <td style="padding:6px;border-top:1px solid ${LINE};text-align:center"><b style="color:${u.utilization_pct >= 65 ? GREEN : u.utilization_pct >= 50 ? '#b45309' : RED}">${u.utilization_pct || 0}%</b></td></tr>`).join('');
  const body = [
    section(`القوى العاملة — ${esc(data.sectorName)} · ${data.period}`,
      `<div style="font-size:13px;color:${MUTED}">متوسط الإشغال القابل للفوترة: <b style="color:${INK}">${data.avgUtil}%</b> · عدد الأعضاء: ${(data.people || []).length}</div>`),
    section('الإشغال حسب العضو', data.people && data.people.length ?
      `<table width="100%" cellspacing="0" style="font-size:13px">
        <tr><th align="start" style="color:${MUTED};font-size:11px;padding:4px 6px">العضو</th><th style="color:${MUTED};font-size:11px">إجمالي</th><th style="color:${MUTED};font-size:11px">قابل للفوترة</th><th style="color:${MUTED};font-size:11px">الإشغال</th></tr>${rows}</table>`
      : `<div style="color:${MUTED};font-size:13px">لا توجد ساعات مسجّلة للفترة — تُفعَّل عند اعتماد الإدخال التشغيلي للوقت.</div>`),
    `<div style="font-size:11px;color:${MUTED};margin-top:8px">ملاحظة حوكمة: الإشغال مقياس سعة تشغيلية لا تقييم فردي؛ لا تُستخدم كترتيب علني.</div>`,
  ].join('');
  return { subject: `تقرير القوى العاملة — ${data.sectorName}`,
    html: shell({ title: 'القوى العاملة والإشغال', period: `${esc(data.sectorName)} · ${data.period}`, bodyRows: body }) };
}

// Opportunity Pipeline — by stage, coverage, top open deals, win rate.
export function opportunityPipeline(data) {
  const stageRows = (data.pipeline || []).map((s) => `<tr>
    <td style="padding:6px;border-top:1px solid ${LINE}"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${s.color};margin-inline-end:6px"></span>${esc(s.name_ar)}</td>
    <td style="padding:6px;border-top:1px solid ${LINE};text-align:center">${s.count}</td>
    <td style="padding:6px;border-top:1px solid ${LINE};text-align:center">${fmtSar(s.value_halalas)}</td></tr>`).join('');
  const dealRows = (data.topOpen || []).map((d) => `<tr>
    <td style="padding:5px 6px;border-top:1px solid ${LINE};font-weight:600">${esc(d.client)}</td>
    <td style="padding:5px 6px;border-top:1px solid ${LINE}">${esc(d.title)}</td>
    <td style="padding:5px 6px;border-top:1px solid ${LINE};text-align:center">${fmtSar(d.value_halalas)}</td>
    <td style="padding:5px 6px;border-top:1px solid ${LINE};text-align:center">${Math.round(d.win_pct || 0)}%</td></tr>`).join('');
  const body = [
    section(`خط الفرص — ${esc(data.sectorName)} · ${data.period}`,
      `<div style="font-size:13px;color:${MUTED}">نسبة الفوز: <b style="color:${INK}">${data.winRate}%</b> · تغطية خط الفرص: <b style="color:${INK}">${data.coverage != null ? data.coverage + '×' : '—'}</b> · مرجّح: <b style="color:${INK}">${fmtSar(data.weighted_halalas)}</b></div>`),
    section('التوزيع حسب المرحلة', `<table width="100%" cellspacing="0" style="font-size:13px"><tr><th align="start" style="color:${MUTED};font-size:11px;padding:4px 6px">المرحلة</th><th style="color:${MUTED};font-size:11px">العدد</th><th style="color:${MUTED};font-size:11px">القيمة</th></tr>${stageRows}</table>`),
    section('أكبر الفرص المفتوحة', data.topOpen && data.topOpen.length ? `<table width="100%" cellspacing="0" style="font-size:13px"><tr><th align="start" style="color:${MUTED};font-size:11px;padding:4px 6px">العميل</th><th align="start" style="color:${MUTED};font-size:11px">الفرصة</th><th style="color:${MUTED};font-size:11px">القيمة</th><th style="color:${MUTED};font-size:11px">%</th></tr>${dealRows}</table>` : list([])),
  ].join('');
  return { subject: `تقرير خط الفرص — ${data.sectorName}`,
    html: shell({ title: 'تقرير خط الفرص', period: `${esc(data.sectorName)} · ${data.period}`, bodyRows: body }) };
}

export const TEMPLATES = {
  weekly_exec_brief: weeklyExecBrief,
  sector_weekly_status: sectorWeeklyStatus,
  monthly_sector_performance: monthlySectorPerformance,
  project_status_report: projectStatusReport,
  workforce_utilization: workforceUtilization,
  opportunity_pipeline: opportunityPipeline,
};
