// قناة SMTP — تُفعَّل فقط عند MAIL_TRANSPORT=smtp مع أسرار SMTP_* في البيئة.
// nodemailer يُستورد ديناميكياً كي لا يُحمَّل في التطوير/الاختبار؛ وهو مُدرَج في dependencies
// ليكون حاضراً في صورة الإنتاج. غياب الأسرار يُرجِع خطأً عربياً واضحاً يظهر في مركز البريد.
//
// والدالة تأخذ **قناتها** وسيطاً ولا تقرأ الإعداد بنفسها: للمنصة قناتان (أصلية واحتياطية)
// بمزوّدَين ومُرسِلَين مختلفين، ومن يقرأ الإعداد داخله لا يصلح إلا لواحدة.
import { config } from '../config.js';

// اسمُ القناة للأثر والسجل — لا يُعرض للمستخدم، يُقرأ في مركز البريد وسجل الخادم.
export const CHANNEL = { PRIMARY: 'primary', FALLBACK: 'fallback' };

export const channelConfig = (which) => (which === CHANNEL.FALLBACK ? config.smtpFallback : config.smtp);

// حالُ القناة على ثلاثٍ لا اثنتين. ودمجُ «مضبوطةٌ بقيمةٍ خاطئة» في «غير مضبوطة» يُنتج كذباً
// في ثلاثة مواضع: البطاقة تقول «غير مضبوطة» لمن ضبط كل حقولها، والزرّ الوحيد الذي يشخّص
// العطب يُقفَل في وجهه، والسجل يقول «لا قناة احتياطية» بينما هي موجودةٌ ومعطوبة.
export function channelStatus(c) {
  if (!c) return { state: 'unset', reason: null };
  if (c.hostError) return { state: 'invalid', reason: c.hostError };
  if (!c.host || !c.user || !c.pass || !c.from) return { state: 'unset', reason: null };
  return { state: 'ready', reason: null };
}

// هل القناة صالحةٌ للمحاولة؟ يُسأل قبل الاتصال كي لا تُحسب قناةٌ غير مضبوطة «عُطلاً»، ولا
// يُطلَب من الشبكة عنوانٌ نعرف سلفاً أنه لا يُترجَم — والانتظار على مسار الدخول يُقاس بالثواني.
export const channelReady = (c) => channelStatus(c).state === 'ready';

export async function sendViaSmtp({ to, cc, subject, html }, which = CHANNEL.PRIMARY) {
  const { host, port, user, pass, from, secure } = channelConfig(which);
  const label = which === CHANNEL.FALLBACK ? 'الاحتياطية' : 'الأصلية';
  // القناة **لا تعرف مزوّداً بعينه**: أي خادم بريد يصلح — بريد الشركة، أو مزوّد إرسال، أو صندوق
  // عادي بكلمة مرور تطبيق.
  const st = channelStatus(channelConfig(which));
  if (st.state === 'invalid') throw new Error(`عنوان خادم البريد للقناة ${label} غير صالح — ${st.reason}`);
  if (!host || !user || !pass) throw new Error(`قناة البريد ${label} غير مفعّلة — تحتاج عنوان خادم بريد واسم مستخدم وكلمة مرور (أي مزوّد يصلح)`);
  // المُرسِل بلا قيمة يعني إرسالاً بعنوانٍ لا نملكه أو رفضاً من الخادم — يُقال صراحةً هنا
  // لا يُترك ليظهر خطأً غامضاً من المزوّد. (والافتراضي حُذف من الإعداد: شُرح سببه هناك.)
  if (!from) throw new Error(`عنوان المُرسِل غير محدَّد للقناة ${label} — اضبطه بعنوانٍ على نطاقٍ موثَّق لدى مزوّدها`);
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; }
  catch { throw new Error('حزمة الإرسال غير مثبتة في هذه البيئة — ثبّت nodemailer عند تفعيل القناة الحقيقية'); }
  // secure=true للمنفذ 465 (TLS ضمني)؛ 587 وغيره STARTTLS — ما لم يُحدَّد صراحةً. والقيمة
  // تصل مقروءةً منطقيةً من الإعداد: كان الفراغ يُقرأ هنا `true` فيُحاوَل التشفير الضمني على
  // منفذٍ لا يقبله، وتنقضي المهلة بعطبٍ يبدو شبكياً وهو حقلٌ مُسِح في اللوحة.
  const sec = secure != null ? secure : Number(port) === 465;
  const t = nodemailer.createTransport({ host, port: Number(port), secure: sec, auth: { user, pass } });
  const info = await t.sendMail({ from, to: (to || []).join(', '), cc: (cc || []).join(', '), subject, html });
  return { transport: 'smtp', channel: which, from, id: info.messageId, to, cc, subject };
}
