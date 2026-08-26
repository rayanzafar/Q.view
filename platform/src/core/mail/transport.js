// قناة البريد. 'preview' (تطوير) يكتب ملفاً في data/outbox ولا يلمس الشبكة إطلاقاً.
// 'smtp' (تشغيل) يُرسل فعلاً — ولا يفعل ذلك إلا بعد المرور على حارس المستقبِلين أدناه.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, ROOT } from '../config.js';
import { accountEmails, refreshAccountEmails } from './accounts.js';

// نتيجة الإرسال تميّز ثلاث حالات لا حالةً واحدة. كان الوضعان (معاينة/إرسال) يُسجَّلان معاً
// «أُرسلت»، فيبدو الطابور ناجحاً وما غادرت رسالةٌ واحدة — أخطر ما في الوحدة لأنه يكذب بصمت.
export const DELIVERY = { SENT: 'sent', PREVIEWED: 'previewed', BLOCKED: 'blocked' };

const norm = (a) => String(a || '').trim().toLowerCase();

// حارس المستقبِلين — يُفرَض دائماً إلا إذا أُعلن الإطلاق صراحةً (SANAD_MAIL_UNRESTRICTED=1).
// فشلٌ مغلق عن قصد: قائمة سماحٍ فارغة تمنع كل شيء ولا تفتحه. السبب مباشر — قاعدة التجربة
// تحمل عناوين موظفين حقيقيين على evc.sa، وتشغيلُ الإرسال بلا حارس يعني رسائل حقيقية منها.
//
// ومصدرا السماح اثنان لا واحد:
//  ① **حسابات المنصة نفسها** — عنوانٌ أدخله مديرُ النظام ليُستعمل، وأولُ ما يلزمه رمزُ دخول.
//    وبه صارت القائمة **تتحدّث بنفسها**: حسابٌ يُنشأ من الشاشة يصله الرمز بلا كتابةٍ يدوية ولا
//    إعادة تشغيل. (انظر `accounts.js` — وهناك الحدود: المُغلق عليه والمحذوف لا يُقرآن.)
//  ② والقائمة اليدوية فوقه — لما ليس حساباً في المنصة (بريد المالك الشخصي مثلاً).
export function filterRecipients(list) {
  const addrs = (list || []).map((a) => String(a || '').trim()).filter(Boolean);
  if (config.mailUnrestricted) return { allowed: addrs, blocked: [] };
  const accounts = accountEmails();
  const allowed = [], blocked = [];
  for (const a of addrs) {
    const n = norm(a);
    (config.mailAllowlist.includes(n) || accounts.has(n) ? allowed : blocked).push(a);
  }
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
    // لقطةُ الحسابات تُحدَّث قبل الفلترة لا بعدها: حسابٌ أُنشئ قبل ثوانٍ يجب أن يصله رمزه الآن،
    // وهذا هو بيت القصيد — «طريقة يتحدّث دائماً» بلا يدٍ ولا إعادة تشغيل.
    await refreshAccountEmails();
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
    // ── قناتان: الأصلية ثم الاحتياطية ──
    // البريد بابُ المنصة الوحيد (الدخول برمزٍ بريدي)، فسكوتُه يعني ألا يدخل أحد. والقناة
    // الثانية بمزوّدٍ ونطاقٍ مختلفين تُجرَّب **فقط** حين تُخفق الأولى إخفاقاً حقيقياً.
    // وثلاثة قيود متعمَّدة:
    //  ① الحجب ليس إخفاقاً: حارس المستقبِلين حكمٌ لا عطل، فلا يُجرَّب عليه بديل (يقع قبل هنا).
    //  ② لا تُبتلع أخطاء الأولى: إن أخفقت الثانية أيضاً رُفع خطأ الأولى — فهي التي يجب إصلاحها.
    //  ③ اللجوء إلى البديل **يُقال**: يُكتب في أثر الرسالة ويُطبع في سجل الخادم. قناةٌ احتياطية
    //    تعمل بصمت شهراً تعني أن الأصلية معطوبة منذ شهرٍ ولا أحد يدري.
    const { sendViaSmtp, CHANNEL, channelConfig, channelReady } = await import('./smtp.js');
    const blocked = [...gTo.blocked, ...gCc.blocked];
    const msg = { to: gTo.allowed, cc: gCc.allowed, subject, html };
    try {
      const res = await sendViaSmtp(msg, CHANNEL.PRIMARY);
      return { ...res, delivery: DELIVERY.SENT, blocked };
    } catch (primaryErr) {
      const reason = String(primaryErr?.message || primaryErr).slice(0, 200);
      if (!channelReady(channelConfig(CHANNEL.FALLBACK))) {
        console.error('[mail] أخفقت القناة الأصلية ولا قناة احتياطية مُعدَّة:', reason);
        throw primaryErr;
      }
      console.error('[mail] أخفقت القناة الأصلية — التحويل إلى الاحتياطية. السبب:', reason);
      try {
        const res = await sendViaSmtp(msg, CHANNEL.FALLBACK);
        console.error('[mail] غادرت عبر القناة الاحتياطية:', res.from);
        return {
          ...res,
          delivery: DELIVERY.SENT,
          blocked,
          note: `أُرسلت عبر القناة الاحتياطية (${res.from}) — القناة الأصلية أخفقت: ${reason}`,
        };
      } catch (fallbackErr) {
        console.error('[mail] وأخفقت الاحتياطية أيضاً:', String(fallbackErr?.message || fallbackErr).slice(0, 200));
        throw primaryErr;      // خطأ الأولى هو ما يجب إصلاحه، فهو الذي يُرفع
      }
    }
  }
  // قناة المعاينة — تكتب على القرص ولا تغادر الجهاز، فحالتها «عُوينت» لا «أُرسلت».
  const dir = resolve(ROOT, 'data/outbox');
  mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}_${String(subject || 'mail').replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 40)}.html`;
  writeFileSync(resolve(dir, fname), html || '');
  return { delivery: DELIVERY.PREVIEWED, transport: 'preview', file: fname, to, cc, subject, blocked: [] };
}
