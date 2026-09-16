// الرمز لا يُكتب في عنوان الرسالة — أبداً.
//
// كان العنوان «رمز الدخول إلى سند: ١٢٣٤٥٦». والعنوان ليس محتوىً محمياً: يُعرض في **قائمة**
// الرسائل، وفي إشعار الشاشة المقفلة، وفي لوحة مزوّد البريد — فيُقرأ الرمز الحيّ بلا فتح أي
// رسالة ومن أي شاشةٍ تمرّ عليها عين. وبما أن الرمز وسيلة الدخول **الوحيدة** بعد إطفاء كلمة
// المرور، فقراءته دخولٌ بحساب صاحبه. رُئي فعلاً في قائمة الرسائل أثناء تشغيل القناة.
//
// والفحص هنا على **مخرَج القالب** لا على نصٍّ ثابت: أي صياغة جديدة للعنوان تمرّ عليه. ويفحص
// صيغتَي الرقم — اللاتينية والعربية-الهندية — لأن تغيير أرقام العرض يوماً لا يجوز أن يفتح
// الباب من جديد. ويؤكّد في الوقت نفسه أن الرمز **موجود في المتن**: عنوانٌ نُزع منه الرمز
// ومتنٌ لا يحمله يعني رسالةً لا تُفيد صاحبها بشيء.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInCodeMail, inviteCodeMail } from '../../src/core/mail/auth-mail.js';

// الترجمة إلى الأرقام العربية-الهندية: لو عُرض الرمز بها يوماً وجب أن يظل محجوباً عن العنوان.
const toArabicDigits = (s) => String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

const CODES = ['123456', '000000', '999999', '104729'];

test('عنوان رسالة رمز الدخول لا يحمل الرمز بأي صيغة', () => {
  for (const code of CODES) {
    const m = signInCodeMail({ code, minutes: 10 });
    assert.ok(m.subject, 'الرسالة بلا عنوان');
    assert.equal(m.subject.includes(code), false,
      `الرمز «${code}» ظهر في العنوان: «${m.subject}» — يُقرأ من قائمة الرسائل بلا فتحها`);
    assert.equal(m.subject.includes(toArabicDigits(code)), false,
      `الرمز ظهر في العنوان بالأرقام العربية: «${m.subject}»`);
    // ولا أي تسلسل من ستة أرقام مهما كان — العنوان لا مكان فيه لرقمٍ سرّي
    assert.equal(/[0-9٠-٩]{4,}/.test(m.subject), false,
      `العنوان يحمل تسلسلاً رقمياً طويلاً: «${m.subject}»`);
  }
});

test('عنوان رسالة التفعيل كذلك — وهو أخطر، به يُفتح الحساب أول مرة', () => {
  for (const code of CODES) {
    const m = inviteCodeMail({ code, minutes: 10, inviterName: 'مدير النظام' });
    assert.equal(m.subject.includes(code), false, `الرمز في عنوان التفعيل: «${m.subject}»`);
    assert.equal(m.subject.includes(toArabicDigits(code)), false, `الرمز بالعربية في عنوان التفعيل: «${m.subject}»`);
    assert.equal(/[0-9٠-٩]{4,}/.test(m.subject), false, `تسلسل رقمي في عنوان التفعيل: «${m.subject}»`);
  }
});

test('والرمز موجود في المتن — العنوان نُزع منه السرّ لا الفائدة', () => {
  for (const code of CODES) {
    assert.ok(signInCodeMail({ code, minutes: 10 }).html.includes(code), 'رمز الدخول غائب عن المتن');
    assert.ok(inviteCodeMail({ code, minutes: 10 }).html.includes(code), 'رمز التفعيل غائب عن المتن');
  }
});

test('والعنوان يبقى مفهوماً: يقول ما وصل بلا أن يحمله', () => {
  const a = signInCodeMail({ code: '123456', minutes: 10 }).subject;
  const b = inviteCodeMail({ code: '123456', minutes: 10 }).subject;
  for (const s of [a, b]) {
    assert.ok(s.length >= 10, `عنوان مبتور: «${s}»`);
    assert.match(s, /[؀-ۿ]/, `العنوان يجب أن يكون عربياً: «${s}»`);
  }
  assert.notEqual(a, b, 'رسالة الدخول ورسالة التفعيل تُميَّزان من عنوانيهما');
});
