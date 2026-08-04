// حراسةٌ على انضباط النشر: أسرارٌ لا تُرفع إلى صورةٍ أو منصّة، وترحيلةٌ فاشلة تُوقف الإقلاع.
//   • كل قائمة استبعاد (git/docker/railway) تُقصي .env ولقطات القاعدة وملفات backfill.
//   • .railwayignore يستعمل نمطاً عاماً للقطات (لا اسمين محدَّدين) ويُقصي backfill.
//   • boot.sh يجعل فشل الترحيلة قاتلاً (لا يعمل الخادم على مخطط قديم بصمت).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLATFORM = new URL('../..', import.meta.url).pathname;
const read = (p) => readFileSync(resolve(PLATFORM, p), 'utf8');

// .env و seed/*.snapshot.json (رواتب/عناوين) و seed/*.backfill.json (أسرار) — لا تُرفع أبداً.
for (const f of ['.dockerignore', '.railwayignore']) {
  test(`${f} يُقصي الأسرار (env + snapshot + backfill)`, () => {
    const txt = read(f);
    assert.match(txt, /^\.env$/m, `${f} لا يُقصي .env`);
    assert.match(txt, /seed\/\*\.snapshot\.json/, `${f} لا يُقصي لقطات القاعدة بنمط عام`);
    assert.match(txt, /seed\/\*\.backfill\.json/, `${f} لا يُقصي ملفات backfill`);
  });
}

test('.railwayignore لا يعتمد على أسماء لقطات محدَّدة (لأن الجديدة ستُرفع)', () => {
  const txt = read('.railwayignore');
  assert.doesNotMatch(txt, /seed\/legacy-state\.snapshot\.json/, 'ما زال يعتمد اسماً محدَّداً بدل النمط العام');
});

test('boot.sh يجعل فشل الترحيلة قاتلاً — لا |true على خطوة الترحيلة', () => {
  const txt = read('scripts/boot.sh');
  const migrateLine = txt.split('\n').find((l) => l.includes('scripts/migrate.js') && !l.trim().startsWith('#'));
  assert.ok(migrateLine, 'لا سطر لتشغيل الترحيلة في boot.sh');
  assert.doesNotMatch(migrateLine, /\|\|\s*true/, 'خطوة الترحيلة ما زالت مبتلِعةً للفشل (|| true)');
  assert.match(migrateLine, /exit 1/, 'فشل الترحيلة لا يوقف الإقلاع');
});
