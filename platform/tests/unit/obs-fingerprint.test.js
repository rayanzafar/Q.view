// بصمة العطب — ما يُجمَع وما يبقى منفصلاً.
//
// التجميع الخاطئ أسوأ من غيابه: مجموعةٌ تخفي عطبَين تُقرأ مرةً ثم تُهمَل. وهذه الحالات
// كلها مأخوذةٌ من نصوصٍ حقيقية في هذا المستودع، لا مخترَعة.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, normMessage, topAppFrame, shortCode } from '../../src/core/obs/fingerprint.js';

const fp = (o) => fingerprint({ kind: 'http', errKind: 'Error', source: '/app/x', stack: 'at f (src/a.js:1:2)', ...o });

test('يُجمَع ما يختلف بقيمةٍ محقونة فقط', () => {
  assert.equal(fp({ message: 'duplicate key prj_abc123x' }), fp({ message: 'duplicate key prj_zzz999y' }));
  assert.equal(fp({ message: 'جدول «الموظفون» غير مُدرَج' }), fp({ message: 'جدول «المشاريع» غير مُدرَج' }));
  // مسارُ «تقرير غير معروف» يأخذ مفتاحه من العنوان — أي أن أي داخلٍ يولّد مجموعاتٍ بلا حدّ.
  assert.equal(fp({ message: 'تقرير غير معروف: aaa' }), fp({ message: 'تقرير غير معروف: bbb' }));
});

test('والأرقام العربية والإنجليزية تُطبَّع سواءً', () => {
  assert.equal(normMessage('تأخّرت ٤٢ يوماً'), normMessage('تأخّرت 99 يوماً'));
});

test('وعلاماتُ الاتجاه غير المرئية لا تُنتج بصمتين لنصٍّ واحد', () => {
  // نصٌّ من استيراد إكسل وآخرُ مكتوبٌ بيد يبدوان متطابقَين ويختلفان بايتاً.
  assert.equal(fp({ message: 'قيمة غير صالحة‏' }), fp({ message: 'قيمة غير صالحة' }));
  assert.equal(fp({ message: 'قيمة غير صالحة'.normalize('NFD') }), fp({ message: 'قيمة غير صالحة'.normalize('NFC') }));
});

test('ولا يُجمَع ما هو مختلفٌ فعلاً', () => {
  const a = fp({ message: 'قناة البريد الأصلية غير مفعّلة', stack: 'at s (src/core/mail/smtp.js:20:1)' });
  const b = fp({ message: 'قناة البريد الاحتياطية غير مفعّلة', stack: 'at s (src/core/mail/smtp.js:20:1)' });
  assert.notEqual(a, b, 'اندمجت الأصلية بالاحتياطية — عطبٌ يمنع الدخول مع آخر متوقَّع');
  assert.notEqual(fp({ errKind: 'TypeError' }), fp({ errKind: 'RangeError' }));
  assert.notEqual(fp({ source: '/app/a' }), fp({ source: '/app/b' }));
});

test('ورقمُ السطر لا يدخل البصمة — وإلا صار كل نشرٍ «عطباً جديداً» للعلّة نفسها', () => {
  assert.equal(
    fp({ stack: 'Error\n    at run (src/modules/pmo/tasks.js:10:5)' }),
    fp({ stack: 'Error\n    at run (src/modules/pmo/tasks.js:97:9)' }),
  );
});

test('وأثرٌ من الحاوية يطابق أثراً من جهاز التطوير', () => {
  const dev = `Error\n    at run (${process.cwd()}/src/modules/pmo/tasks.js:10:5)`;
  const box = 'Error\n    at run (/app/src/modules/pmo/tasks.js:10:5)';
  assert.equal(topAppFrame(dev), topAppFrame(box));
  assert.equal(fp({ stack: dev }), fp({ stack: box }));
});

test('وإطاراتُ المُشغّل والحِزم تُتخطّى — ترقيتُه لا تُعيد بصمَ كل شيء', () => {
  const s = 'Error\n    at node:internal/process/task_queues:95:5\n    at x (node_modules/pg/lib/client.js:1:1)\n    at real (src/modules/crm/opportunities.js:3:1)';
  assert.equal(topAppFrame(s), 'src/modules/crm/opportunities.js#real');
});

test('ورميةٌ بلا أثر لا تبتلع كل شيء في مجموعةٍ واحدة', () => {
  const noStack = fp({ message: 'أ', stack: '' });
  const noStack2 = fp({ message: 'ب', stack: '' });
  assert.notEqual(noStack, noStack2, 'كلُّ ما لا أثر له صار مجموعةً واحدة عملاقة');
});

// الرمزُ المعروض هو المعرّف الوحيد الذي يراه إنسان. أبجديّة الست عشرة لا تستطيع تهجئة
// كلمةٍ يحظرها ماسحُ التسريبات — فالسلامة بالبناء لا بالحظّ.
test('والرمز المعروض ست عشريٌّ محض — لا يهجّي كلمةً محظورة أبداً', () => {
  for (let i = 0; i < 300; i++) {
    const code = shortCode(fp({ message: 'م' + i, stack: `at f${i} (src/a${i}.js:1:1)` }));
    assert.match(code, /^[0-9a-f]{8}$/, `رمزٌ غير ست عشري: ${code}`);
    for (const banned of ['null', 'undefined', 'NaN', 'object']) {
      assert.ok(!code.toLowerCase().includes(banned.toLowerCase()), `رمزٌ يهجّي كلمةً محظورة: ${code}`);
    }
  }
});
