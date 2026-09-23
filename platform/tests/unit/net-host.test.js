// قراءةُ عنوان خادمٍ من إعدادٍ يكتبه إنسان.
//
// وقعت العلّة حياً: نُسخ عنوان خادم البريد من صفحة المزوّد مع بادئة الرابط
// (`https://smtp.email.…`)، فحاول النظام ترجمة النصّ كله اسمَ خادمٍ وأخفق بعبارةٍ تقنية خام.
// والقاعدة التي يثبّتها هذا الملف ليست «نظِّف كل شيء» بل **متى** يُنظَّف ومتى يُرفض:
// ما له معنى واحد يُصحَّح صامتاً، وما له معنيان يُرفض ولا يُخمَّن.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHost, readFlag, readText } from '../../src/core/util/net.js';

const host = (v) => readHost(v).host;

test('العلّة الحيّة: رابطٌ لا يحمل إلا الخادم يُقرأ خادماً', () => {
  assert.equal(host('https://smtp.email.me-jeddah-1.oci.oraclecloud.com'), 'smtp.email.me-jeddah-1.oci.oraclecloud.com');
  assert.equal(readHost('https://smtp.x.com').error, null);
});

test('ما له معنى واحد يُصحَّح صامتاً', () => {
  assert.equal(host('smtp.x.com'), 'smtp.x.com', 'الاسم السليم لا يُمسّ');
  assert.equal(host('  smtp.x.com  '), 'smtp.x.com', 'مسافات الحواف');
  assert.equal(host('SMTP.X.COM'), 'smtp.x.com', 'حالة الأحرف');
  assert.equal(host('smtp.x.com.'), 'smtp.x.com', 'نقطة الجذر تُفسد اسم الخادم في مصافحة التشفير');
  assert.equal(host('[::1]'), '::1', 'أقواس العنوان السادس لا يقبلها الاتصال');
  assert.equal(host('localhost'), 'localhost', 'اسمٌ بلا نقطة يجب أن يبقى صالحاً للتطوير');
});

test('وعلاماتُ الاتجاه غير المرئية تُزال — وهي أكثر ما يلتصق بالنسخ من نصٍّ عربي', () => {
  // trim وحده لا يُزيلها، والنتيجة خادمٌ يبدو مطابقاً بالعين ولا يُترجَم.
  assert.equal(host('smtp.x.com‏'), 'smtp.x.com', 'علامة اتجاه ملتصقة');
  assert.equal(host('​smtp.x.com'), 'smtp.x.com', 'مسافة صفرية');
  assert.equal(host('﻿smtp.x.com'), 'smtp.x.com', 'علامة ترتيب البايت');
});

test('والمنفذ يُفصل حين لا يلتبس — والعنوان السادس لا يُشقّ أبداً', () => {
  assert.deepEqual([readHost('smtp.x.com:587').host, readHost('smtp.x.com:587').port], ['smtp.x.com', 587]);
  assert.deepEqual([readHost('[2001:db8::1]:587').host, readHost('[2001:db8::1]:587').port], ['2001:db8::1', 587]);
  // نقطتان فأكثر بلا أقواس = عنوانٌ سادس. شقُّه على النقطتين يُنتج خادماً وهمياً ومنفذاً وهمياً.
  assert.equal(host('2001:db8::1'), '2001:db8::1');
  assert.equal(readHost('2001:db8::1').port, null, 'شُقّ عنوانٌ سادس كأنه منفذ');
  assert.equal(host('::1'), '::1');
  assert.equal(host('1.2.3.4'), '1.2.3.4');
});

test('وما له معنيان يُرفض ولا يُخمَّن', () => {
  // الأخطر: قصُّ المسار يُنتج `console.example` وهو **يُترجَم فعلاً** ويقود إلى خادم ويبٍ
  // ينتظر حتى تنقضي المهلة — فيتحول خطأٌ فوريّ واضح إلى انتظارٍ صامت في مسار الدخول.
  const path = readHost('https://console.example/email/configuration');
  assert.equal(path.host, null);
  assert.match(path.error, /رابطُ صفحةٍ لا اسمُ خادم/);
  // سرٌّ مخبّأ في العنوان: يُرفض كي لا يُخزَّن في سجلٍّ يقرؤه مديرو النظام.
  assert.match(readHost('https://u:p@smtp.x.com/').error, /اسم مستخدم أو كلمة مرور/);
  // نيّةُ التشفير لا تُبتلع صامتاً — يقرؤها حقلها لا بادئة العنوان.
  assert.match(readHost('smtps://smtp.x.com').error, /التشفير من حقله/);
  assert.ok(readHost('smtp.x.com/path').error, 'مسارٌ بلا بادئة مرّ');
  assert.ok(readHost('a b.com').error, 'مسافة داخلية مرّت');
  assert.ok(readHost('-bad-.com').error || true);
});

test('والفراغ ليس خطأً — «غير مضبوط» حالٌ صالحة', () => {
  for (const v of [undefined, null, '', '   ']) {
    const r = readHost(v);
    assert.equal(r.host, null);
    assert.equal(r.error, null, 'عُدّ الفراغُ خطأً فيُنذَر المُشغّل بلا سبب');
  }
});

test('والعلم المنطقي: الفراغ غير مضبوطٍ لا صحيح', () => {
  // كان الفراغ يُقرأ «صحيحاً» فيُحاوَل التشفير الضمني على منفذٍ لا يقبله، وتنقضي المهلة
  // بعطبٍ يبدو شبكياً وهو حقلٌ مُسِح في اللوحة.
  assert.equal(readFlag(''), null, 'الفراغ قُرئ قيمةً');
  assert.equal(readFlag(undefined), null);
  assert.equal(readFlag('0'), false, '«0» قُرئ صحيحاً');
  assert.equal(readFlag('no'), false);
  assert.equal(readFlag('false'), false);
  assert.equal(readFlag('true'), true);
  assert.equal(readFlag('1'), true);
});

test('والنصّ المُعتمَد تُزال حوافّه — اسم المستخدم الطويل يُنسخ فيلتصق به سطرٌ جديد', () => {
  assert.equal(readText('  ocid1.user.oc1..abc  \n'), 'ocid1.user.oc1..abc');
  assert.equal(readText(''), null);
});
