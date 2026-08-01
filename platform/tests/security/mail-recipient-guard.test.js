// حارس المستقبِلين (core/mail/transport.js). كُتب لأن قاعدة التجربة تحمل عناوين موظفين
// حقيقيين على evc.sa: تشغيل القناة الحقيقية بلا حارس كان يعني رسائل فعلية إليهم من بيئة تجربة.
// ويُثبت هنا أيضاً أن «عُوينت» لم تعد تُسجَّل «أُرسلت» — وهو ما كان يجعل الطابور يبدو ناجحاً
// وما غادرت رسالةٌ واحدة.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.MAIL_TRANSPORT = 'smtp';
process.env.SANAD_MAIL_ALLOWLIST = 'lab@evc.sa, Owner@EVC.sa';
delete process.env.SANAD_MAIL_UNRESTRICTED;

let sendMail, filterRecipients, DELIVERY;

before(async () => {
  ({ sendMail, filterRecipients, DELIVERY } = await import('../../src/core/mail/transport.js'));
});

test('العنوان خارج القائمة يُحجب، والمسموح يمرّ — والمطابقة لا تفرّق بين كبير الأحرف وصغيره', () => {
  const r = filterRecipients(['lab@evc.sa', 'staff@evc.sa', 'OWNER@evc.sa']);
  assert.deepEqual(r.allowed, ['lab@evc.sa', 'OWNER@evc.sa']);
  assert.deepEqual(r.blocked, ['staff@evc.sa']);
});

test('كل المستقبِلين خارج القائمة ⇒ لا تُلمس الشبكة والحالة «محجوبة» لا «أُرسلت»', async () => {
  const res = await sendMail({ to: ['a@evc.sa', 'b@evc.sa'], subject: 'تجربة', html: '<p>x</p>' });
  assert.equal(res.delivery, DELIVERY.BLOCKED);
  assert.notEqual(res.delivery, DELIVERY.SENT);
  assert.equal(res.blocked.length, 2);
  // غياب أسرار SMTP يرمي خطأً؛ بلوغُنا BLOCKED بلا رمي يثبت أن الحجب سبق أي محاولة اتصال.
  assert.ok(res.reason && /قائمة/.test(res.reason));
});

// حارسٌ يمنع كل شيء ليس حارساً بل قفلاً. هذا يثبت أن المسموح يَعبُر فعلاً إلى طبقة الشبكة:
// وجود عنوان واحد مسموح يدفع النداء إلى قناة SMTP، فترمي لغياب الأسرار — وهو بلوغٌ لا حجب.
test('العنوان المسموح يَعبُر الحارس ويصل إلى قناة الإرسال', async () => {
  await assert.rejects(
    () => sendMail({ to: ['lab@evc.sa', 'stranger@evc.sa'], subject: 'تجربة', html: '<p>x</p>' }),
    /قناة البريد الحقيقية غير مفعّلة/,
  );
});

test('قائمة سماح فارغة تمنع كل شيء — الفشل مغلق لا مفتوح', async () => {
  const { config } = await import('../../src/core/config.js');
  const saved = config.mailAllowlist;
  config.mailAllowlist = [];
  try {
    const res = await sendMail({ to: ['anyone@evc.sa'], subject: 'تجربة', html: '<p>x</p>' });
    assert.equal(res.delivery, DELIVERY.BLOCKED);
  } finally { config.mailAllowlist = saved; }
});

test('قناة المعاينة تُسجَّل «عُوينت» لا «أُرسلت»', async () => {
  const { config } = await import('../../src/core/config.js');
  const saved = config.mailTransport;
  config.mailTransport = 'preview';
  try {
    const res = await sendMail({ to: ['x@evc.sa'], subject: 'معاينة', html: '<p>x</p>' });
    assert.equal(res.delivery, DELIVERY.PREVIEWED);
    assert.notEqual(res.delivery, DELIVERY.SENT);
  } finally { config.mailTransport = saved; }
});
