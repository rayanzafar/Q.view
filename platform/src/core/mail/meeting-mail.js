// رسائل اجتماعات الفعاليات. منفصلة عن قوالب التقارير عمداً — كرسائل الدخول والاعتمادات
// وللسبب نفسه: ذيل التقارير («تقرير آلي … تُحجب الأرقام الحساسة») كلامٌ لا معنى له في دعوة.
//
// قاعدتان موروثتان من رسائل الاعتمادات حرفياً:
//   • العنوان يقول ماذا وصل ولا يحمل تفصيلاً: عناوين الرسائل تُقرأ من قوائم وشاشات مقفلة،
//     وأسماء الاجتماعات والحاضرين ليست لعينٍ عابرة.
//   • رسالتان فقط: الدعوة عند الإنشاء، والتنبيه عند تغيّر الموعد. لا تذكير دورياً —
//     سياسة البريد المعلنة: التذكيرات مطفأة، والبريد لحظة الحدث وحده.
const BRAND = '#244A99', BRAND2 = '#834798', INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shell({ title, inner, platformUrl, eventId }) {
  const back = `${platformUrl}/app/event/${encodeURIComponent(eventId || '')}?tab=meetings`;
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
  <tr><td style="padding:22px 24px">${inner}
    <div style="text-align:center;margin:16px 0 4px">
      <a href="${esc(back)}" style="font-size:12px;color:${MUTED};text-decoration:none">تفاصيل الفعالية واجتماعاتها في سند</a>
    </div>
  </td></tr>
  <tr><td style="padding:14px 24px;background:#f8fafc;border-top:1px solid ${LINE};font-size:11px;color:${MUTED};line-height:1.8">
    وصلتك هذه الرسالة لأنك من المدعوين إلى هذا الاجتماع في منصة سند.
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

/**
 * دعوة اجتماع أو تنبيه بتغيّر موعده.
 * kind: «new» دعوة عند الإنشاء · «time» تنبيه عند تغيّر الموعد.
 * dayLabel نصٌّ جاهز («الأحد · 31 أغسطس 2026») يبنيه المنادي من مصدر الوقت الواحد.
 */
export function meetingInviteMail({ kind = 'new', title, eventName, dayLabel, startTime, endTime,
  location, joinUrl, eventId, platformUrl }) {
  const isNew = kind !== 'time';
  const row = (label, value) => (value ? `<tr>
    <td style="padding:6px 0;font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top">${esc(label)}</td>
    <td style="padding:6px 10px;font-size:14px;color:${INK}">${esc(value)}</td></tr>` : '');
  const joinBtn = joinUrl ? `<div style="text-align:center;margin:18px 0 4px">
      <a href="${esc(joinUrl)}" style="display:inline-block;background:${BRAND};color:#fff;font-size:14px;font-weight:700;
        padding:11px 26px;border-radius:10px;text-decoration:none">رابط الاجتماع</a>
    </div>` : '';
  const inner = `
    <div style="font-size:14px;line-height:1.9">${isNew ? 'دُعيت إلى اجتماع' : 'تغيّر موعد اجتماعٍ أنت من المدعوين إليه'}${eventName ? ` ضمن «${esc(eventName)}»` : ''}:</div>
    <div style="font-size:16px;font-weight:700;margin:10px 0 6px">${esc(title)}</div>
    <table role="presentation" dir="rtl" cellpadding="0" cellspacing="0" style="margin:4px 0">
      ${row('اليوم', dayLabel)}
      ${row('الوقت', startTime && endTime ? `من ${startTime} إلى ${endTime} بتوقيت الرياض` : '')}
      ${row('المكان', location)}
    </table>
    ${joinBtn}`;
  return {
    subject: isNew ? 'دعوة اجتماع في سند' : 'تغيّر موعد اجتماع في سند',
    html: shell({ title: isNew ? 'دعوة اجتماع' : 'تغيّر موعد اجتماع', inner, platformUrl, eventId }),
  };
}
