// رسائل الدخول. منفصلة عن قوالب التقارير عمداً: ذيل التقارير يقول «تقرير آلي … تُحجب الأرقام
// الحساسة حسب صلاحية المستلم»، وهو كلامٌ لا معنى له في رسالة رمز دخول — بل يشوّش على المتلقّي
// في اللحظة التي يحتاج فيها إلى سطرٍ واحد واضح.
const BRAND = '#244A99', BRAND2 = '#834798', INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// الرمز يُعرض متباعد الأرقام وبخط ثابت العرض: يُقرأ من الجوال ويُنسخ بلا لبس بين ٦ و٨ و٠.
// و`dir=ltr` على الرمز وحده كي لا يعكس ترتيبَ أرقامه سياقُ الصفحة العربي.
function shell({ title, lead, code, footNote }) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
  <tr><td style="background:linear-gradient(120deg,${BRAND},${BRAND2});padding:20px 24px;color:#fff">
    <div style="font-size:13px;opacity:.9">EVC · رؤية الخبراء الاستشارية · منصة سند</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(title)}</div>
  </td></tr>
  <tr><td style="padding:22px 24px">
    <div style="font-size:14px;line-height:1.9;color:${INK}">${esc(lead)}</div>
    <div dir="ltr" style="margin:20px 0;padding:16px;text-align:center;background:#f8fafc;border:1px solid ${LINE};border-radius:12px;
      font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${BRAND}">${esc(code)}</div>
    <div style="font-size:12.5px;line-height:1.9;color:${MUTED}">${esc(footNote)}</div>
  </td></tr>
  <tr><td style="padding:14px 24px;background:#f8fafc;border-top:1px solid ${LINE};font-size:11px;color:${MUTED};line-height:1.8">
    لم تطلب هذا الرمز؟ تجاهل الرسالة ولا تفعل شيئاً — لا أحد يدخل بحسابك بلا هذا الرمز.<br>
    ولن يطلب منك أحدٌ من سند أو من فريق الدعم هذا الرمز، لا هاتفياً ولا بالرسائل.
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

// رسالة رمز الدخول العادي.
export function signInCodeMail({ code, minutes }) {
  return {
    subject: `رمز الدخول إلى سند: ${code}`,
    html: shell({
      title: 'رمز الدخول',
      lead: 'استخدم هذا الرمز لإكمال الدخول إلى منصة سند:',
      code,
      footNote: `الرمز صالح ${minutes} دقائق، ولمرة واحدة فقط. وطلبُ رمزٍ جديد يُلغي هذا فوراً.`,
    }),
  };
}

// رسالة تفعيل حساب جديد — نفس الآلية، ونصٌّ يشرح أنها أول مرة.
export function inviteCodeMail({ code, minutes, inviterName }) {
  return {
    subject: `رمز تفعيل حسابك في سند: ${code}`,
    html: shell({
      title: 'تفعيل حسابك',
      lead: inviterName
        ? `أنشأ ${inviterName} حساباً لك في منصة سند. استخدم هذا الرمز لتفعيله والدخول لأول مرة:`
        : 'أُنشئ لك حساب في منصة سند. استخدم هذا الرمز لتفعيله والدخول لأول مرة:',
      code,
      footNote: `الرمز صالح ${minutes} دقائق، ولمرة واحدة فقط. بعد الدخول لن تحتاج كلمة مرور — يصلك رمزٌ جديد في كل مرة.`,
    }),
  };
}
