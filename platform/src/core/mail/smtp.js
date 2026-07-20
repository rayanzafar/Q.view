// قناة SMTP الاختيارية — تُفعَّل فقط عند MAIL_TRANSPORT=smtp مع أسرار SMTP_* في البيئة.
// nodemailer يُستورد ديناميكياً كي لا يكون اعتماداً إلزامياً؛ غيابه أو غياب الأسرار
// يُرجِع خطأً عربياً واضحاً يظهر في مركز البريد (عائق خارجي: بيانات SMTP الحقيقية).
export async function sendViaSmtp({ to, cc, subject, html }) {
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass) throw new Error('قناة البريد الحقيقية غير مفعّلة — تحتاج بيانات خادم البريد (SMTP) من مزوّد النطاق');
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; }
  catch { throw new Error('حزمة الإرسال غير مثبتة في هذه البيئة — ثبّت nodemailer عند تفعيل القناة الحقيقية'); }
  const t = nodemailer.createTransport({ host, port: Number(process.env.SMTP_PORT || 465), secure: (process.env.SMTP_SECURE ?? 'true') !== 'false', auth: { user, pass } });
  const info = await t.sendMail({ from, to: (to || []).join(', '), cc: (cc || []).join(', '), subject, html });
  return { transport: 'smtp', id: info.messageId, to, cc, subject };
}
