// رسائل الاعتمادات. منفصلة عن قوالب التقارير عمداً — كرسائل الدخول وللسبب نفسه: ذيل
// التقارير («تقرير آلي … تُحجب الأرقام الحساسة») كلامٌ لا معنى له في تنبيهٍ قصير.
//
// قاعدتان تحكمان كل رسالة هنا:
//   • مجمَّعة دوماً: رسالةٌ واحدة تسرد **كل** المعلَّق لحظة الإرسال — لا رسالة لكل طلب.
//   • العنوان يقول ماذا وصل ولا يحمل تفصيلاً: عناوينُ الرسائل تُقرأ من قوائم وشاشات مقفلة،
//     وأسماءُ المهام والأشخاص ليست لعينٍ عابرة (نفس قاعدة رسائل الدخول حرفياً).
import { countAr } from '../i18n/plural.js';

const BRAND = '#244A99', BRAND2 = '#834798', INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const dayAgo = (n) => (n <= 0 ? 'اليوم' : n === 1 ? 'أمس' : n === 2 ? 'منذ يومين'
  : n <= 10 ? `منذ ${n} أيام` : `منذ ${n} يوماً`);

// بندٌ واحد في الرسالة: اسمُ ما يُعتمَد بخطٍّ ثقيل، ثم نوعه ومن طلبه وعمره — سطرٌ يُقرأ
// من الجوال بلا فتح المنصة، والقرار نفسه يُتَّخذ من الصفحة (زرٌّ واحد في أسفل الرسالة).
const itemRow = (it) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE}">
  <div style="font-size:14px;font-weight:700;color:${INK}">${esc(it.label || it.kindLabel)}${it.parent ? ` <span style="font-weight:400;color:${MUTED}">· ${esc(it.parent)}</span>` : ''}</div>
  <div style="font-size:12px;color:${MUTED};margin-top:2px">${esc(it.kindLabel)}${it.requesterName ? ` · طلبها ${esc(it.requesterName)}` : ''} · ${esc(dayAgo(Number(it.ageDays) || 0))}</div>
</td></tr>`;

function shell({ title, lead, items, platformUrl }) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:${INK}">
<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
<tr><td align="center">
<table role="presentation" dir="rtl" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
  <tr><td style="background:${BRAND} linear-gradient(120deg,${BRAND},${BRAND2});padding:20px 24px;color:#fff">
    <div style="font-size:13px;opacity:.9">EVC · رؤية الخبراء الاستشارية · منصة سند</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(title)}</div>
  </td></tr>
  <tr><td style="padding:22px 24px">
    <div style="font-size:14px;line-height:1.9;color:${INK}">${esc(lead)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 4px">${items.map(itemRow).join('')}</table>
    <div style="text-align:center;margin:20px 0 4px">
      <a href="${esc(platformUrl)}/app/home" style="display:inline-block;background:${BRAND};color:#fff;font-size:14px;font-weight:700;
        padding:11px 26px;border-radius:10px;text-decoration:none">افتح صفحتك واعتمد</a>
    </div>
  </td></tr>
  <tr><td style="padding:14px 24px;background:#f8fafc;border-top:1px solid ${LINE};font-size:11px;color:${MUTED};line-height:1.8">
    وصلتك هذه الرسالة لأن طلبات اعتماد وُجِّهت إليك في منصة سند.<br>
    تتوقف الرسائل من تلقاء نفسها حين لا يبقى شيء بانتظارك.
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

// صيغة العدّ من المصدر الواحد (countAr) — لا نسخة ثانية من قاعدة الجمع هنا.
const countItems = (n) => countAr(n, { one: 'طلبٌ واحد', two: 'طلبان', few: 'طلبات', many: 'طلباً' });

/** وصل جديدٌ إلى طابورك — والرسالة تسرد الطابور كله كما هو لحظة الإرسال. */
export function newApprovalsMail({ items, platformUrl }) {
  return {
    subject: 'اعتمادات بانتظارك في سند',
    html: shell({
      title: 'بانتظار اعتمادك',
      lead: `${countItems(items.length)} بانتظار اعتمادك — القائمة كما هي لحظة الإرسال:`,
      items, platformUrl,
    }),
  };
}

/** التذكير الدوري — بفاصلٍ يضبطه مدير النظام ما دام شيءٌ معلَّقاً، ولا شيء حين لا شيء. */
export function approvalReminderMail({ items, platformUrl }) {
  return {
    subject: 'تذكير: اعتمادات بانتظارك في سند',
    html: shell({
      title: 'تذكير بما ينتظر قرارك',
      lead: `ما زال ${countItems(items.length)} بانتظار اعتمادك:`,
      items, platformUrl,
    }),
  };
}
