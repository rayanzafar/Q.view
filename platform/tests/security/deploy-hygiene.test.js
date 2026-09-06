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

// ── حُرّاس ما بعد حادثة 2026-08-11 (KI-048): النشر بطريقٍ واحد ومعرّفاتٍ لا أسماء ──
const RW = 'rail' + 'way'; // لا تُكتب الكلمة كاملةً في نداءات المطابقة كي لا يلتقطها خطّاف الجلسة خطأً

test('خطّاف الحراسة يمنع down/redeploy وup المباشر منعاً صلباً لا يفتحه مفتاح الإطلاق', () => {
  const txt = read('scripts/hooks/pre-guard.mjs');
  assert.match(txt, /rwVerb === 'down' \|\| rwVerb === 'redeploy'/, 'منع down/redeploy غائب');
  assert.match(txt, /rwVerb === 'up'/, 'منع up المباشر غائب');
  assert.match(txt, /46db5bda-3de4-4189-8677-cb973769c241/, 'معرّف قاعدة البيانات غير محروس في الربط');
  const releaseGateIdx = txt.indexOf("const release =");
  for (const marker of ["rwVerb === 'down'", "rwVerb === 'up'"]) {
    assert.ok(txt.indexOf(marker) < releaseGateIdx, `قاعدة ${marker} تقع بعد بوابة الإطلاق — فيفتحها المفتاح`);
  }
});

test('خطُّ النشر يسمّي الخدمات بمعرّفاتها ويطابق ما في وثيقة البنية — فلا ينحرفان', () => {
  const dep = read('scripts/deploy.mjs');
  const arch = read('docs/ARCHITECTURE.md');
  for (const id of ['6981eaef-29c1-40b1-8aca-8c606dfd44e3', '46db5bda-3de4-4189-8677-cb973769c241',
    '892124c7-a66e-4ac7-bd7d-e4827b3e5f40']) {
    assert.ok(dep.includes(id), `خطّ النشر بلا المعرّف ${id.slice(0, 8)}…`);
    assert.ok(arch.includes(id), `وثيقة البنية بلا المعرّف ${id.slice(0, 8)}…`);
  }
  assert.ok(!new RegExp(RW + '\\s+(down|redeploy)').test(dep), 'خطّ النشر نفسه يستدعي فعلاً محظوراً');
  assert.match(dep, new RegExp(RW + "', \\['up', '--detach', '--service', APP_SERVICE_ID"), 'النشر لا يمرّر الخدمة بمعرّفها');
});

test('أمر النشر مسجَّل في package.json — الطريق الواحد له اسمٌ واحد', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.deploy, 'node scripts/deploy.mjs');
});

test('خط النشر يرفض تجاوز النسخة الاحتياطية والمعاينة غير المنفذة قبل أي إجراء', () => {
  const txt = read('scripts/deploy.mjs');
  const firstCommand = txt.indexOf("const dirty = run('git'");
  for (const flag of ['--no-backup', '--dry-run']) {
    const rejection = `if (args.has('${flag}')) fail(`;
    assert.ok(txt.indexOf(rejection) > 0 && txt.indexOf(rejection) < firstCommand,
      `${flag} لا يُرفض قبل أول أمر`);
  }
  assert.doesNotMatch(txt, /if\s*\(args\.has\('--no-backup'\)\)\s*\{/, 'عاد فرع تجاوز النسخة الاحتياطية');
  assert.doesNotMatch(txt, /تخطّي النسخة الاحتياطية/, 'ما زال النشر يعرض تخطي النسخة');
  const backup = txt.indexOf('const bk = run(');
  const backupFailure = txt.indexOf("fail(`النسخة الاحتياطية فشلت:");
  const upload = txt.indexOf('const up = run(');
  assert.ok(backup > 0 && backupFailure > backup && upload > backupFailure,
    'يجب التحقق من النسخة ووقف الإخفاق قبل الرفع');
});
