// Executive email templates — Outlook/Gmail-safe HTML (tables + inline CSS, RTL).
// Sensitive figures are passed pre-redacted by the caller (report engine).
import { fmtSar } from '../util/ids.js';

const BRAND = '#2563eb', BRAND2 = '#9333ea', INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0';

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
    items.map((i) => `<li>${i}</li>`).join('') + '</ul>';
}

// Weekly Executive Brief
export function weeklyExecBrief(data) {
  const t = data.totals;
  const body = [
    section('الملخص التنفيذي',
      `<table role="presentation" width="100%" cellspacing="8"><tr>
        ${kpiRow('الإيراد المحقق', fmtSar(t.revenue), `المستهدف ${fmtSar(t.target_revenue)}`)}
        ${kpiRow('المبيعات المحققة', fmtSar(t.sales), `المستهدف ${fmtSar(t.target_sales)}`)}
        ${kpiRow('خط الأنابيب', fmtSar(data.pipeline_halalas), `${data.oppCount || ''} فرصة`)}
      </tr></table>`),
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
    `<tr><td style="padding:8px;border-bottom:1px solid ${LINE};font-size:13px">${p.name_ar}</td>
      <td style="padding:8px;border-bottom:1px solid ${LINE};text-align:center">
        <span style="background:${p.rag === 'RED' ? '#fee2e2' : p.rag === 'AMBER' ? '#fef3c7' : '#dcfce7'};
        color:${p.rag === 'RED' ? '#dc2626' : p.rag === 'AMBER' ? '#d97706' : '#059669'};
        padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">${p.rag}</span></td>
      <td style="padding:8px;border-bottom:1px solid ${LINE};text-align:center;font-size:13px">${Math.round(p.progress_pct || 0)}%</td></tr>`).join('');
  const body = [
    section('حالة القطاع', `<div style="font-size:13px;color:${MUTED}">${data.sectorName} · ${data.period}</div>`),
    section('المشاريع', `<table role="presentation" width="100%" cellspacing="0">
      <tr><th align="start" style="font-size:11px;color:${MUTED};padding:6px 8px">المشروع</th>
      <th style="font-size:11px;color:${MUTED};padding:6px 8px">الحالة</th>
      <th style="font-size:11px;color:${MUTED};padding:6px 8px">الإنجاز</th></tr>${rows || ''}</table>`),
    section('المخاطر والإجراءات القادمة', list(data.risks)),
  ].join('');
  return { subject: `حالة القطاع الأسبوعية — ${data.sectorName}`, html: shell({ title: 'حالة القطاع الأسبوعية', period: `${data.sectorName} · ${data.period}`, bodyRows: body }) };
}

export const TEMPLATES = { weekly_exec_brief: weeklyExecBrief, sector_weekly_status: sectorWeeklyStatus };
