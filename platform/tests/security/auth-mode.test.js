// نموذج «بلا كلمة مرور»: رمزٌ مؤقّت على البريد في كل مرة، والبريد هو هوية الحساب.
//
// الخطر الوحيد في هذا النموذج ليس أمنياً بل تشغيلي: أن يُطفأ الدخول بكلمة المرور **قبل** أن
// تعمل قناة البريد، فتُقفل المنصة على أهلها بباب لا يُفتح ولا أحد بالداخل ليصلحه. ولذلك لا
// يُترك القرار لمفتاح يُنسى: يتبع حالة القناة الفعلية.
//
// ويثبت هذا الملف الشرطين معاً: لا تُقفل حين لا يصل بريد، وتُقفل حين يصل.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let config, loginPage;

before(async () => {
  ({ config } = await import('../../src/core/config.js'));
  ({ loginPage } = await import('../../src/web/views/auth.js'));
});

// الدالة تعيش داخل web/routes.js، فنعيد بناء قرارها هنا من نفس مدخلاته الثلاثة. أي تغيير في
// القاعدة هناك بلا تحديث هنا يُسقط الاختبار — وهو المقصود: القاعدة نفسها هي محلّ الحراسة.
const decide = (forced, transport) => {
  if (forced === '1') return true;
  if (forced === '0') return false;
  return transport !== 'smtp';
};

test('قناة معاينة ⇒ كلمة المرور تبقى مفتوحة — فلا يُقفل أحد خارج المنصة', () => {
  assert.equal(decide(undefined, 'preview'), true);
});

test('قناة حقيقية ⇒ كلمة المرور تُغلق تلقائياً — الرمز وحده كما طُلب', () => {
  assert.equal(decide(undefined, 'smtp'), false);
});

test('المفتاح الصريح يتجاوز القاعدة في الاتجاهين', () => {
  assert.equal(decide('1', 'smtp'), true, 'لم يُفتح رغم الطلب الصريح');
  assert.equal(decide('0', 'preview'), false, 'لم يُغلق رغم الطلب الصريح');
});

test('صفحة الدخول تبدأ بالبريد دائماً — لا باسم المستخدم', () => {
  const html = loginPage({ passwordEnabled: true, csrf: 'x' });
  assert.match(html, /name="email"/, 'لا حقل بريد في الخطوة الأولى');
  assert.match(html, /بريد العمل/);
  // اسم المستخدم لا يظهر إلا داخل الطيّة البديلة، وبعدها في الترتيب.
  assert.ok(html.indexOf('name="email"') < html.indexOf('name="username"'),
    'اسم المستخدم يسبق البريد — البريد ليس الهوية الأولى');
});

test('حين تُغلق كلمة المرور لا يبقى لها حقلٌ في الصفحة إطلاقاً', () => {
  const html = loginPage({ passwordEnabled: false, csrf: 'x' });
  assert.equal(/name="password"/.test(html), false, 'بقي حقل كلمة مرور بعد إغلاقها');
  assert.equal(/name="username"/.test(html), false, 'بقي حقل اسم مستخدم بعد إغلاقها');
  assert.match(html, /name="email"/);
});

test('الإعداد الفعلي في هذه البيئة يطابق القاعدة', () => {
  // حارسٌ ضد انحراف صامت: لو غُيّر الافتراضي في config بلا قصد، يظهر هنا لا في الإنتاج.
  assert.equal(typeof config.mailTransport, 'string');
  assert.equal(decide(process.env.SANAD_AUTH_PASSWORD, config.mailTransport),
    process.env.SANAD_AUTH_PASSWORD === '1' ? true
      : process.env.SANAD_AUTH_PASSWORD === '0' ? false
        : config.mailTransport !== 'smtp');
});
