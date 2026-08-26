// رسالة تجربة لقناةٍ بعينها — الطريقة الآمنة للتحقّق من أن البريد يعمل.
//
// لماذا وُجدت: للمنصة قناتان، والثانية لا تُجرَّب في المسار العادي إلا حين تُخفق الأولى.
// فكان التحقّق منها يستلزم **تعطيل الأولى عمداً** على البيئة التي يعمل عليها الناس، ثم
// إعادتها — إجراءٌ يعطّل الدخول لمن يحتاجه في تلك الدقائق، ويترك المنصة بلا بريدٍ إن نُسيت
// الإعادة. هنا تُختبر أي قناةٍ مباشرةً بلا لمس الإعداد ولا تعطيل شيء.
//
// وحدّان يجعلانها غير قابلة لإساءة الاستعمال:
//  ① **لا مستقبِل في الطلب**: تُرسَل إلى عنوان صاحب الطلب نفسه، يُقرأ من حسابه في القاعدة.
//    فلا تصلح لإرسال شيءٍ إلى أحد — ولا تحتاج حدّ معدّل، إذ لا ضرر في أن يُرسل المرء لنفسه.
//  ② مدير النظام وحده — وهو من يملك أسرار القناة أصلاً.
import { get } from '../db/index.js';
import { id, nowIso } from '../util/ids.js';
import { insert } from '../db/index.js';
import { audit } from '../audit/index.js';
import { forbidden, badRequest } from '../http/errors.js';
import { config } from '../config.js';
import { CHANNEL, channelConfig, channelReady, sendViaSmtp } from './smtp.js';
import { filterRecipients, DELIVERY } from './transport.js';

const LABEL = { [CHANNEL.PRIMARY]: 'الأصلية', [CHANNEL.FALLBACK]: 'الاحتياطية' };

const body = (which, when) => `<div dir="rtl" style="font-family:system-ui,sans-serif;padding:16px;line-height:1.9">
  <h2 style="margin:0 0 8px;font-size:16px">رسالة تجربة من منصة سند</h2>
  <p style="margin:0 0 6px">وصلتك هذه الرسالة عبر <b>القناة ${LABEL[which]}</b>.</p>
  <p style="margin:0;color:#555;font-size:13px">وقت الإرسال: ${when}</p>
  <p style="margin:10px 0 0;color:#555;font-size:13px">إن وجدتها في البريد المزعج فالنطاق المُرسِل يحتاج توثيقاً (SPF/DKIM) قبل دعوة الموظفين.</p>
</div>`;

export async function sendChannelTest(ctx, { channel } = {}) {
  const user = ctx?.user;
  if (!user || user.role_id !== 'admin') throw forbidden('رسالة التجربة من صلاحية مدير النظام وحده');
  const which = channel === CHANNEL.FALLBACK ? CHANNEL.FALLBACK : CHANNEL.PRIMARY;

  // العنوان من حساب صاحب الطلب لا من جسم الطلب — هذا ما يمنع استعمالها للإرسال إلى الآخرين.
  const row = await get('SELECT email FROM app_user WHERE id = ? AND deleted_at IS NULL', [user.id]);
  const to = String(row?.email || '').trim();
  if (!to) throw badRequest('لا عنوان بريد على حسابك — أضِفه أولاً من شاشة المستخدمين ثم أعِد المحاولة');

  const when = nowIso().slice(0, 16).replace('T', ' ');
  const subject = `سند — رسالة تجربة (القناة ${LABEL[which]})`;
  let event = 'failed', detail = null;

  if (config.mailTransport !== 'smtp') {
    // في وضع المعاينة لا شبكة إطلاقاً — ويُقال ذلك بدل ادّعاء إرسال.
    detail = 'قناة المعاينة مشغّلة — لم تُلمس الشبكة ولم تُرسَل رسالة';
    event = DELIVERY.PREVIEWED;
  } else if (!channelReady(channelConfig(which))) {
    detail = `القناة ${LABEL[which]} غير مضبوطة في هذه البيئة — تحتاج خادماً واسم مستخدم وكلمة مرور وعنوان مُرسِل`;
  } else if (!filterRecipients([to]).allowed.length) {
    detail = 'عنوانك خارج قائمة العناوين المسموح بها في هذه البيئة';
    event = DELIVERY.BLOCKED;
  } else {
    try {
      // القناة المطلوبة مباشرةً — بلا تحويلٍ إلى الأخرى، وإلا صار الاختبار يكذب:
      // «نجحت الاحتياطية» بينما الذي نجح هو الأصلية.
      const res = await sendViaSmtp({ to: [to], cc: [], subject, html: body(which, when) }, which);
      event = DELIVERY.SENT;
      detail = `أُرسلت من ${res.from} إلى ${to}`;
    } catch (e) {
      detail = String(e?.message || e).slice(0, 300);
    }
  }

  // أثرٌ في مركز البريد كي يُقرأ الناتج من الشاشة نفسها لا من سجل خادم.
  await insert('email_log', { id: id('el'), queue_id: null, event, detail: `تجربة القناة ${LABEL[which]} — ${detail}`, at: nowIso() });
  await audit(ctx, { action: 'mail_test', resource: 'mail', resourceId: which, detail: { channel: which, event } });
  return { ok: event === DELIVERY.SENT, channel: which, event, detail, to };
}
