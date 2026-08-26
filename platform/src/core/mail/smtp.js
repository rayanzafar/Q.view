// قناة SMTP — تُفعَّل فقط عند MAIL_TRANSPORT=smtp مع أسرار SMTP_* في البيئة.
// nodemailer يُستورد ديناميكياً كي لا يُحمَّل في التطوير/الاختبار؛ وهو مُدرَج في dependencies
// ليكون حاضراً في صورة الإنتاج. غياب الأسرار يُرجِع خطأً عربياً واضحاً يظهر في مركز البريد.
//
// والدالة تأخذ **قناتها** وسيطاً ولا تقرأ الإعداد بنفسها: للمنصة قناتان (أصلية واحتياطية)
// بمزوّدَين ومُرسِلَين مختلفين، ومن يقرأ الإعداد داخله لا يصلح إلا لواحدة.
import { config } from '../config.js';

// اسمُ القناة للأثر والسجل — لا يُعرض للمستخدم، يُقرأ في مركز البريد وسجل الخادم.
export const CHANNEL = { PRIMARY: 'primary', FALLBACK: 'fallback' };

export const channelConfig = (which) => (which === CHANNEL.FALLBACK
  ? { ...config.smtpFallback, secure: config.smtpFallback.secureEnv }
  : { ...config.smtp, secure: process.env.SMTP_SECURE });

// هل القناة مُعدَّة أصلاً؟ يُسأل قبل المحاولة كي لا تُحسب قناةٌ غير مضبوطة «عُطلاً».
export const channelReady = (c) => !!(c && c.host && c.user && c.pass && c.from);

export async function sendViaSmtp({ to, cc, subject, html }, which = CHANNEL.PRIMARY) {
  const { host, port, user, pass, from, secure } = channelConfig(which);
  const label = which === CHANNEL.FALLBACK ? 'الاحتياطية' : 'الأصلية';
  // القناة **لا تعرف مزوّداً بعينه**: أي خادم بريد يصلح — بريد الشركة، أو مزوّد إرسال، أو صندوق
  // عادي بكلمة مرور تطبيق.
  if (!host || !user || !pass) throw new Error(`قناة البريد ${label} غير مفعّلة — تحتاج عنوان خادم بريد واسم مستخدم وكلمة مرور (أي مزوّد يصلح)`);
  // المُرسِل بلا قيمة يعني إرسالاً بعنوانٍ لا نملكه أو رفضاً من الخادم — يُقال صراحةً هنا
  // لا يُترك ليظهر خطأً غامضاً من المزوّد. (والافتراضي حُذف من الإعداد: شُرح سببه هناك.)
  if (!from) throw new Error(`عنوان المُرسِل غير محدَّد للقناة ${label} — اضبطه بعنوانٍ على نطاقٍ موثَّق لدى مزوّدها`);
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; }
  catch { throw new Error('حزمة الإرسال غير مثبتة في هذه البيئة — ثبّت nodemailer عند تفعيل القناة الحقيقية'); }
  // secure=true للمنفذ 465 (TLS ضمني)؛ 587 وغيره STARTTLS (secure=false) — ما لم يُحدَّد صراحةً.
  const sec = secure != null ? secure !== 'false' : Number(port) === 465;
  const t = nodemailer.createTransport({ host, port: Number(port), secure: sec, auth: { user, pass } });
  const info = await t.sendMail({ from, to: (to || []).join(', '), cc: (cc || []).join(', '), subject, html });
  return { transport: 'smtp', channel: which, from, id: info.messageId, to, cc, subject };
}
