// قناة SMTP الاختيارية — تُفعَّل فقط عند MAIL_TRANSPORT=smtp مع أسرار SMTP_* في البيئة.
// nodemailer يُستورد ديناميكياً كي لا يُحمَّل في التطوير/الاختبار؛ وهو مُدرَج في dependencies
// ليكون حاضراً في صورة الإنتاج. غياب الأسرار يُرجِع خطأً عربياً واضحاً يظهر في مركز البريد.
import { config } from '../config.js';

export async function sendViaSmtp({ to, cc, subject, html }) {
  const { host, port, user, pass, from } = config.smtp;   // مصدر واحد للإعداد (from يقرأ MAIL_FROM)
  // القناة **لا تعرف مزوّداً بعينه**: أي خادم بريد يصلح — بريد الشركة، أو مزوّد إرسال، أو صندوق
  // عادي بكلمة مرور تطبيق. والرسالة كانت تقول «من مزوّد النطاق» فتوحي بأن الأمر يحتاج مشرف
  // النطاق وحده، فيُؤجَّل التشغيل انتظاراً لإذنٍ لا يلزم.
  if (!host || !user || !pass) throw new Error('قناة البريد الحقيقية غير مفعّلة — تحتاج عنوان خادم بريد واسم مستخدم وكلمة مرور (أي مزوّد يصلح)');
  // المُرسِل بلا قيمة يعني إرسالاً بعنوانٍ لا نملكه أو رفضاً من الخادم — يُقال صراحةً هنا
  // لا يُترك ليظهر خطأً غامضاً من المزوّد. (والافتراضي حُذف من الإعداد: شُرح سببه هناك.)
  if (!from) throw new Error('عنوان المُرسِل غير محدَّد — اضبط MAIL_FROM بعنوانٍ على نطاقٍ موثَّق لدى مزوّد الإرسال');
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; }
  catch { throw new Error('حزمة الإرسال غير مثبتة في هذه البيئة — ثبّت nodemailer عند تفعيل القناة الحقيقية'); }
  // secure=true للمنفذ 465 (TLS ضمني)؛ 587 وغيره STARTTLS (secure=false) — ما لم يُحدَّد SMTP_SECURE صراحةً.
  const secure = process.env.SMTP_SECURE != null ? process.env.SMTP_SECURE !== 'false' : Number(port) === 465;
  const t = nodemailer.createTransport({ host, port: Number(port), secure, auth: { user, pass } });
  const info = await t.sendMail({ from, to: (to || []).join(', '), cc: (cc || []).join(', '), subject, html });
  return { transport: 'smtp', id: info.messageId, to, cc, subject };
}
