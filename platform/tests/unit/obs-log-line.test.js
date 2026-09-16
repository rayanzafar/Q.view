// سطر السجل المنظَّم — الخصائص التي يقوم عليها كل ما بُني فوقه.
//
// المستضيف يقرأ **سطراً واحداً** من نوع كائنٍ نصّي ويحوّل مفاتيحه إلى حقولٍ تُبحَث. فسطرٌ
// مكسور = بحثٌ ضائع، وسطرٌ يرمي = أداةُ تشخيصٍ تُسقط ما جاءت تشخّصه. كلا الأمرين يُثبَّت هنا.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatLine, trimStack } from '../../src/core/obs/log.js';

test('سطرٌ واحد، صالحٌ للقراءة، يحمل المستوى والحدث ووقتَه', () => {
  const line = formatLine('error', 'http_error', { status: 500, path: '/app/x' });
  assert.equal(line.split('\n').length, 2, 'أكثر من سطر — يُقرأ عند المستضيف سطوراً منفصلة');
  assert.ok(line.endsWith('\n'));
  const o = JSON.parse(line);
  assert.equal(o.level, 'error');
  assert.equal(o.event, 'http_error');
  assert.equal(o.status, 500);
  assert.ok(o.ts, 'بلا وقت');
});

test('وأثرُ الاستدعاء يبقى داخل السطر الواحد مهرَّباً لا مبتوراً', () => {
  const err = new Error('انفجار');
  const line = formatLine('error', 'http_error', { stack: trimStack(err) });
  assert.equal(line.split('\n').length, 2, 'الأثر كسر السطر — لا يُقرأ');
  assert.ok(JSON.parse(line).stack.includes('انفجار'), 'ضاع الأثر');
});

// أخطر ما في مُسجِّل: أن يرمي وهو يُبلِّغ عن رمية. المُدخلات هنا كلها واقعية.
test('لا يرمي مهما سُمِّم المُدخَل — ويقول إنه منقوص', () => {
  const circular = {}; circular.self = circular;
  const throwing = { get boom() { throw new Error('خاصية ترمي'); } };
  for (const bad of [{ circular }, { big: 10n }, { throwing }]) {
    const line = formatLine('error', 'x', bad);
    assert.equal(line.split('\n').length, 2);
    const o = JSON.parse(line);            // يجب أن يبقى مقروءاً
    assert.equal(o.event, 'x');
    if (o.degraded) assert.equal(o.degraded, 1, 'النقص يُقال ولا يُخفى');
  }
});

test('وأثرُ الاستدعاء يُجرَّد من مسار الجذر — عطبٌ واحد لا يُقرأ عطبَين', () => {
  const err = new Error('x');
  err.stack = `Error: x\n    at f (${process.cwd()}/src/modules/pmo/tasks.js:10:5)\n    at g (/app/src/core/db/index.js:20:1)`;
  const s = trimStack(err);
  assert.ok(!s.includes(process.cwd()), 'بقي مسار جهاز التطوير في الأثر');
  assert.ok(!s.includes('/app/'), 'بقي مسار الحاوية في الأثر');
  assert.ok(s.includes('src/modules/pmo/tasks.js'), 'ضاع موضع العطب');
});

test('والأثر مقلَّم — لا يُغرق السطر بمئة إطار', () => {
  const err = new Error('عميق');
  err.stack = 'Error: عميق\n' + Array.from({ length: 60 }, (_, i) => `    at f${i} (src/a.js:${i}:1)`).join('\n');
  const s = trimStack(err);
  assert.ok(s.split('\n').length <= 13, 'لم يُقلَّم');
  assert.ok(s.length <= 4000);
});

// القاعدة البنيوية: لا يستورد شيئاً من التطبيق. لو قرأ الإعداد لصار خطأٌ في الإعداد صمتاً
// كاملاً؛ ولو لمس قاعدة البيانات لعجز عن التبليغ في اللحظة التي تسقط فيها.
test('المُسجِّل لا يستورد من التطبيق شيئاً — لا إعداد ولا قاعدة بيانات', () => {
  const src = readFileSync(new URL('../../src/core/obs/log.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'لم تُقرأ الاستيرادات');
  for (const spec of imports) {
    assert.ok(spec.startsWith('node:'), `استوردَ «${spec}» — أداةُ التشخيص صارت تعتمد على ما تشخّصه`);
  }
});

test('ولا سجلَّ وصولٍ في المنصة — صفر سطر لكل طلبٍ ناجح', () => {
  const src = readFileSync(new URL('../../src/core/obs/log.js', import.meta.url), 'utf8');
  assert.ok(!/access_log|request_log|logRequest/.test(src), 'ظهر سجل وصول — سقف أسطر المستضيف يُبتلع');
});
