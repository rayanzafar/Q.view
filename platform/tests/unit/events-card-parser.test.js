// قارئ بطاقة العمل — محليٌّ صِرف، لا يرمي، ولا يخرج منه نداءٌ واحد.
//
// ما تحرسه هذه الفحوص: الجوال السعودي بكل صيغه (مع الأرقام العربية-الهندية) يعود بصيغة
// واحدة، والدولي يبقى دولياً، والبريد لا يُقرأ موقعاً، والبطاقة ثنائية اللغة تُفضَّل فيها
// العربية، وسطر الفاكس لا يصير اسماً ولا جوالاً، والنصّ التالف يعود بحقولٍ فارغة بلا انفجار.
// والفحص الأخير هو الأهم: القارئ لا يلمس الشبكة — كما في tests/security/ai-engine-local.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardText, foldDigits } from '../../src/modules/events/card-parser.js';

const realFetch = globalThis.fetch;
let calls = [];
before(() => { globalThis.fetch = async (...a) => { calls.push(a); throw new Error('لا نداء خارجياً من قارئ البطاقة'); }; });
after(() => { globalThis.fetch = realFetch; });

test('الجوال السعودي بكل صيغه — ومنها الأرقام العربية-الهندية — يعود ٠٥ ثم ثمانية أرقام', () => {
  for (const raw of ['+966 50 123 4567', '00966501234567', '0501234567', '٠٥٠١٢٣٤٥٦٧', '966-50-123-4567',
    '+966 (50) 123-4567', 'جوال: ٠٥٠١٢٣٤٥٦٧', 'Mobile: +966501234567', '۰۵۰۱۲۳۴۵۶۷']) {
    const r = parseCardText(`أحمد العلي\n${raw}`);
    assert.equal(r.phone, '0501234567', `الصيغة «${raw}» لم تُقرأ جوالاً سعودياً موحَّداً`);
    assert.deepEqual(r.extra_phones, [], `الصيغة «${raw}» أنتجت هاتفاً زائداً`);
  }
  assert.equal(foldDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹'), '0123456789 0123456789', 'طيّ الأرقام بالنظامين');
});

test('الرقم الدولي يبقى دولياً بعلامة زائد، والأرضي السعودي يُقرأ بصيغته المحلية', () => {
  const r = parseCardText('Sara Ali\nMobile: +971 50 123 4567\nTel: 011 234 5678');
  assert.equal(r.phone, '+971501234567', 'الدولي انقلب سعودياً');
  assert.deepEqual(r.extra_phones, ['0112345678'], 'الأرضي غاب عن الهواتف الأخرى');
  // والجوال السعودي يتقدّم على الدولي حين يجتمعان.
  const both = parseCardText('Sara Ali\n+971 50 123 4567\n+966 55 987 6543');
  assert.equal(both.phone, '0559876543');
  assert.deepEqual(both.extra_phones, ['+971501234567']);
});

test('البريد والموقع يُقرآن معاً — ونطاق البريد لا يُعرض موقعاً', () => {
  const r = parseCardText('Ahmed Ali\nAhmed@Elite.sa\nwww.elite.sa');
  assert.equal(r.email, 'ahmed@elite.sa', 'البريد يُحفظ بحروف صغيرة');
  assert.equal(r.website, 'www.elite.sa');
  const only = parseCardText('Ahmed Ali\nahmed@elite.com.sa\nMobile: 0501234567');
  assert.equal(only.email, 'ahmed@elite.com.sa');
  assert.equal(only.website, null, 'نطاق البريد قُرئ موقعاً وهو ليس كذلك');
  const site = parseCardText('Ahmed Ali\nhttps://www.evc.sa/ar');
  assert.equal(site.website, 'www.evc.sa/ar', 'البروتوكول لا يُعرض');
});

test('البطاقة ثنائية اللغة: الاسم والجهة والمسمّى تُفضَّل فيها العربية', () => {
  const r = parseCardText([
    'Ahmed Al-Ali', 'أحمد العلي', 'Sales Manager', 'مدير المبيعات',
    'Elite Consulting Co.', 'شركة النخبة للاستشارات',
    'Mobile: +966 50 123 4567', 'ahmed@elite.sa', 'www.elite.sa',
  ].join('\n'));
  assert.equal(r.person_name, 'أحمد العلي');
  assert.equal(r.job_title, 'مدير المبيعات');
  assert.equal(r.org_name, 'شركة النخبة للاستشارات');
  assert.equal(r.phone, '0501234567');
  assert.equal(r.email, 'ahmed@elite.sa');
  assert.equal(r.website, 'www.elite.sa');
});

test('بطاقة إنجليزية فقط: اللقب يبقى في الاسم، والمسمّى المركّب لا يُقرأ جهةً', () => {
  const r = parseCardText('Eng. Sara Al-Otaibi\nChief Technology Officer\nElm Company\nsara@elm.sa\nM: 055 123 4567');
  assert.equal(r.person_name, 'Eng. Sara Al-Otaibi', 'اللقب يُحفظ مع الاسم كما كُتب');
  assert.equal(r.job_title, 'Chief Technology Officer', '«Technology» كلمة جهة لكنها هنا داخل مسمّى');
  assert.equal(r.org_name, 'Elm Company');
  assert.equal(r.phone, '0551234567');
});

test('سطر الفاكس لا يصير اسماً ولا جوالاً — ولا يظهر رقمه في الهواتف الأخرى', () => {
  const r = parseCardText('خالد السالم\nمدير المشاريع\nهاتف: 011 234 5678\nفاكس: 011 234 5679\nFax: 011 234 5680');
  assert.equal(r.person_name, 'خالد السالم');
  assert.equal(r.job_title, 'مدير المشاريع');
  assert.equal(r.phone, '0112345678', 'الهاتف الأرضي هو الرقم الوحيد المقبول هنا');
  assert.ok(!r.extra_phones.includes('0112345679') && !r.extra_phones.includes('0112345680'), 'رقم الفاكس تسرّب');
  assert.ok(!/فاكس|fax/i.test(String(r.person_name) + String(r.org_name) + String(r.job_title)), 'كلمة «فاكس» صارت حقلاً');
  // فاكس وهاتف على سطر واحد: يُقرأ ما قبل التسمية ويُهمَل ما بعدها.
  const one = parseCardText('سعد الغامدي\nTel: 011 111 2222 Fax: 011 111 3333');
  assert.equal(one.phone, '0111112222');
  assert.deepEqual(one.extra_phones, []);
});

test('سطور العنوان وصندوق البريد لا تُقرأ اسماً — والجوال لا يُقتطع من سجلٍّ تجاري', () => {
  const r = parseCardText('ص.ب 12345 الرياض 11564\nP.O. Box 9876 Riyadh\nنورة الحربي\nس.ت 1010512345678\nجوال 0509998877');
  assert.equal(r.person_name, 'نورة الحربي');
  assert.equal(r.phone, '0509998877', 'اقتُطع جوال من داخل السجل التجاري');
  assert.deepEqual(r.extra_phones, []);
});

test('النصّ التالف يعود بحقولٍ فارغة ولا يرمي أبداً', () => {
  const blank = { person_name: null, org_name: null, job_title: null, phone: null, email: null, website: null, extra_phones: [] };
  for (const bad of ['', '   ', null, undefined, 12345, '!!!@@@###', '​‏﻿', {}, [], () => 1, 'x'.repeat(20000), '9'.repeat(400)]) {
    let out;
    assert.doesNotThrow(() => { out = parseCardText(bad); }, `المدخل ${String(bad).slice(0, 20)} أسقط القارئ`);
    assert.deepEqual(Object.keys(out).sort(), Object.keys(blank).sort(), 'شكل الردّ ثابت مهما كان المدخل');
    assert.equal(out.email, null);
    assert.equal(out.phone, null);
  }
  assert.deepEqual(parseCardText('!!!@@@###'), blank);
});

test('كل حقل نصّي مقصوصٌ على مئة وستين حرفاً', () => {
  const long = 'شركة ' + 'النخبة '.repeat(60);
  const r = parseCardText(`${long}\nأحمد العلي`);
  assert.ok(r.org_name.length <= 160, 'اسم الجهة تجاوز الحدّ');
});

test('ولا مكالمة خارجية واحدة تخرج من القارئ', () => {
  calls = [];
  for (let i = 0; i < 5; i++) parseCardText(`اسم ${i} تجريبي\nشركة تجريبية\nجوال 050000000${i}\nx${i}@test.sa`);
  assert.equal(calls.length, 0, 'خرجت مكالمة من قارئ البطاقة والمحرّك محلي');
});
