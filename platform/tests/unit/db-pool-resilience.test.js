// مرونة مجمّع اتصالات Postgres — حارسٌ على سطرٍ واحدٍ يمنع انقطاعاً كاملاً.
//
// القصة: node-postgres يُطلق حدث 'error' على المجمّع حين يقتل **الخادمُ** اتصالاً خاملاً
// (إعادة تشغيل Postgres، صيانة المزوّد، مهلة جلسةٍ خاملة). وحدثُ 'error' بلا مستمعٍ على
// EventEmitter يُرمى استثناءً غير ملتقَط ⇒ `process.exit(1)` ⇒ إعادة تشغيل من Railway،
// وRailway يتوقف عن إعادة التشغيل بعد `restartPolicyMaxRetries`. أي أن إعادة تشغيلٍ
// روتينية لقاعدة البيانات كانت قادرةً على إسقاط المنصة إسقاطاً دائماً.
//
// ولماذا فحصُ المصدر لا سلوكٌ حيّ: طقم الاختبارات كله على SQLite (لا DATABASE_URL)، فمسار
// المجمّع لا يُنشأ أصلاً هنا. البرهان الحيّ إعادةُ تشغيل Postgres على نسخةٍ محلية — مذكورٌ
// في خطة الإطلاق — وهذا الحارس يمنع اختفاء السطر بصمت في تعديلٍ لاحق.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/core/db/index.js', import.meta.url), 'utf8');
const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

test('مجمّع Postgres يستمع لخطأ الاتصال الخامل — وإلا أسقطت إعادةُ تشغيلٍ روتينية المنصة', () => {
  assert.match(code, /_pgPool\.on\(\s*['"]error['"]/,
    'لا مستمع لحدث error على المجمّع — عودةُ العلّة تعني توقّفاً دائماً بعد صيانة قاعدة البيانات');
});

test('والمستمع مُسجَّل قبل إعادة المجمّع للمستدعي، لا بعدها', () => {
  // و`return _pgPool;` يردُ مرتين: حارسُ العودة المبكرة في أول الدالة، ثم عودةُ الإنشاء في
  // آخرها. المقصود الأخيرة — فالمقارنة على lastIndexOf لا على أول ورود.
  const on = code.indexOf("_pgPool.on('error'");
  const ret = code.lastIndexOf('return _pgPool;');
  assert.ok(on > 0, 'لا مستمع أصلاً');
  assert.ok(ret > on, 'سُجِّل المستمع بعد `return` فلا يُنفَّذ أبداً');
});
