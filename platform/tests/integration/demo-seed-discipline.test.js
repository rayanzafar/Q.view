// حارسٌ بنيوي: لا صفَّ تجريبياً يُدرَج خارج السجل.
//
// فحوص السجل تُثبت أن ما سُجِّل يُمحى وأن غيره لا يُمسّ. لكنها **لا** تستطيع أن تُثبت أن كل ما
// بُذر قد سُجِّل: سطرُ `insert(...)` واحد يُضاف غداً إلى بذرة السيناريوهات — بحسن نيّة، وسط
// مئة سطر — يُنتج صفاً تجريبياً لا يعرفه المحو، فيبقى في القاعدة إلى الأبد. ولن يسقط له فحص:
// السجل سيقول «مُحي كل شيء» وهو صادق فيما يعرف.
//
// فالحارس هنا على **الملف نفسه** لا على سلوكه: بذرة السيناريوهات لا تستدعي `insert` مباشرةً،
// بل تمرّ كلها بـ`add` الذي يُدرج ويُسجّل في نَفَسٍ واحد. قاعدةٌ تُقرأ في ثانية، وتمسك ما لا
// يمسكه أي فحص سلوكي.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SEED = new URL('../../scripts/seed-scenarios.mjs', import.meta.url).pathname;
const src = readFileSync(SEED, 'utf8');

// يُقصّ التعليقان (السطري والكتلي) قبل الفحص: ذكرُ `insert` في شرحٍ ليس استدعاءً.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

test('بذرة السيناريوهات لا تُدرج صفاً خارج السجل', () => {
  // الاستيراد نفسه مسموح (يستعمله `add` داخلياً) — المحظور هو استدعاؤه في جسم البذرة.
  const calls = [...code.matchAll(/(?<![\w.])insert\s*\(/g)];
  const insideAdder = code.slice(code.indexOf('function makeAdder'), code.indexOf('export async function seedScenarios'));
  const allowed = [...insideAdder.matchAll(/(?<![\w.])insert\s*\(/g)].length;
  assert.equal(calls.length, allowed,
    `وُجد ${calls.length - allowed} استدعاءَ إدراج خارج «add» — كل إدراج يجب أن يمرّ به كي يُسجَّل ويُمحى لاحقاً`);
});

test('وكل جدول تبذره البذرة له تسمية عربية في السجل', async () => {
  const { SEEDABLE_TABLES } = await import('../../src/core/demo/registry.js');
  const used = new Set([...code.matchAll(/add\(\s*'([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(used.size >= 8, `الجداول المستعملة: ${[...used].join(', ')}`);
  for (const t of used) {
    assert.ok(SEEDABLE_TABLES.includes(t),
      `الجدول «${t}» يُبذر ولا تسمية عربية له — كشف ما قبل المحو سيعرضه باسمه الإنجليزي`);
  }
});

test('اسم الدفعة ثابت ومُصدَّر — المحو يُنادى به', async () => {
  const mod = await import('../../scripts/seed-scenarios.mjs');
  assert.equal(typeof mod.BATCH, 'string');
  assert.ok(mod.BATCH.length > 3);
  assert.match(mod.BATCH, /[؀-ۿ]/, 'اسم الدفعة عربي — يُكتب في سطر أوامر ويُقرأ في رسالة');
});
