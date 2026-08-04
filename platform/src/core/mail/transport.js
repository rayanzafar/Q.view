// قناة البريد. 'preview' (تطوير) يكتب ملفاً في data/outbox ولا يلمس الشبكة إطلاقاً.
// 'smtp' (تشغيل) يُرسل فعلاً — ولا يفعل ذلك إلا بعد المرور على حارس المستقبِلين أدناه.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, ROOT } from '../config.js';

// نتيجة الإرسال تميّز ثلاث حالات لا حالةً واحدة. كان الوضعان (معاينة/إرسال) يُسجَّلان معاً
// «أُرسلت»، فيبدو الطابور ناجحاً وما غادرت رسالةٌ واحدة — أخطر ما في الوحدة لأنه يكذب بصمت.
export const DELIVERY = { SENT: 'sent', PREVIEWED: 'previewed', BLOCKED: 'blocked' };

const norm = (a) => String(a || '').trim().toLowerCase();

// حارس المستقبِلين — يُفرَض دائماً إلا إذا أُعلن الإطلاق صراحةً (SANAD_MAIL_UNRESTRICTED=1).
// فشلٌ مغلق عن قصد: قائمة سماحٍ فارغة تمنع كل شيء ولا تفتحه. السبب مباشر — قاعدة التجربة
// تحمل عناوين موظفين حقيقيين على evc.sa، وتشغيلُ الإرسال بلا حارس يعني رسائل حقيقية منها.
export function filterRecipients(list) {
  const addrs = (list || []).map((a) => String(a || '').trim()).filter(Boolean);
  if (config.mailUnrestricted) return { allowed: addrs, blocked: [] };
  const allowed = [], blocked = [];
  for (const a of addrs) (config.mailAllowlist.includes(norm(a)) ? allowed : blocked).push(a);
  return { allowed, blocked };
}

// هل يُحجَب هذا العنوان فعلاً لو أُرسل إليه الآن — بحساب **القناة** لا القائمة وحدها.
// وهذا الشرط ليس تفصيلاً: الحارس لا يُطبَّق في قناة المعاينة إطلاقاً (الفرع الثاني أدناه لا
// يمرّ به)، فحسابُ الحجب من القائمة وحدها يَسِم **كل** حساب في بيئة التطوير بأنه محجوب —
// تحذيرٌ يعمّ فيصير ضجيجاً يُتجاهَل، وحين يصدق يوماً لا يُصدَّق. وقعتُ في ذلك وأسقطه اختبار.
export function mailBlockedFor(email) {
  if (config.mailTransport !== 'smtp') return false;
  if (config.mailUnrestricted) return false;
  const addr = String(email || '').trim();
  if (!addr) return false;
  return !filterRecipients([addr]).allowed.length;
}

export async function sendMail({ to, cc, subject, html }) {
  if (config.mailTransport === 'smtp') {
    const gTo = filterRecipients(to);
    const gCc = filterRecipients(cc);
    // لا مستقبِل مسموح ⇒ لا تُلمس الشبكة، وتُسجَّل الحالة «محجوبة» لا «أُرسلت».
    if (!gTo.allowed.length && !gCc.allowed.length) {
      return {
        delivery: DELIVERY.BLOCKED, transport: 'smtp', subject,
        blocked: [...gTo.blocked, ...gCc.blocked],
        reason: 'كل المستقبِلين خارج قائمة العناوين المسموح بها في هذه البيئة',
      };
    }
    const { sendViaSmtp } = await import('./smtp.js');
    const res = await sendViaSmtp({ to: gTo.allowed, cc: gCc.allowed, subject, html });
    return { ...res, delivery: DELIVERY.SENT, blocked: [...gTo.blocked, ...gCc.blocked] };
  }
  // قناة المعاينة — تكتب على القرص ولا تغادر الجهاز، فحالتها «عُوينت» لا «أُرسلت».
  const dir = resolve(ROOT, 'data/outbox');
  mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}_${String(subject || 'mail').replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 40)}.html`;
  writeFileSync(resolve(dir, fname), html || '');
  return { delivery: DELIVERY.PREVIEWED, transport: 'preview', file: fname, to, cc, subject, blocked: [] };
}
