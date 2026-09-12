// معرّف النشرة: يُقرأ من الجذر إن وُجد وصحَّ شكله، وإلا null — ولا يُصدَّق ملفٌ بمحتوى غريب.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readBuildId, BUILD_ID_FILE, deploymentTagOf, deploymentTag, announcedBuildId } from '../../src/core/http/build-id.js';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);

test('لا ملف ⇒ null (تشغيل محلي)', () => {
  const d = mkdtempSync(join(tmpdir(), 'sanad-build-'));
  assert.equal(readBuildId(d), null);
});

test('ملفٌ بمعرّفٍ سليم ⇒ يُعاد مقصوصاً', () => {
  const d = mkdtempSync(join(tmpdir(), 'sanad-build-'));
  writeFileSync(join(d, BUILD_ID_FILE), '9bfc032a1b2c-20260828181000\n');
  assert.equal(readBuildId(d), '9bfc032a1b2c-20260828181000');
});

test('محتوى غريب (مسافات، أطول من 64، أحرف تحكّم) ⇒ null لا تسريب', () => {
  const d = mkdtempSync(join(tmpdir(), 'sanad-build-'));
  writeFileSync(join(d, BUILD_ID_FILE), 'postgres://user:pw@host/db');
  assert.equal(readBuildId(d), null);
  writeFileSync(join(d, BUILD_ID_FILE), 'a'.repeat(65));
  assert.equal(readBuildId(d), null);
});

test('الملف مُهمَل من git ولا يستثنيه .railwayignore (يجب أن يُشحَن مع الصورة)', () => {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^\.build-id$/m);
  const ri = readFileSync(join(ROOT, '.railwayignore'), 'utf8');
  assert.doesNotMatch(ri, /build-id/);
});

test('خطُّ النشر يكتب المعرّف قبل الرفع وينتظره بعينه — أو وسمَ النشرة المشتقّ من معرّف Railway — في /ready', () => {
  const src = readFileSync(join(ROOT, 'scripts/deploy.mjs'), 'utf8');
  const stamp = src.indexOf("writeFileSync(join(ROOT, '.build-id')");
  const up = src.indexOf("['up', '--detach'");
  assert.ok(stamp > 0 && up > stamp, 'المعرّف يُكتب قبل railway up');
  assert.match(src, /accepted\.includes\(j\.build\)/);
  assert.match(src, /deploymentTagOf\(depId\)/, 'الوسم يُشتق من معرّف النشرة الملتقط من مخرجات الرفع');
  const srv = readFileSync(join(ROOT, 'src/server.js'), 'utf8');
  assert.match(srv, /build: buildId/);
  assert.match(srv, /announcedBuildId\(ROOT\)/, 'الخادم يعلن الملف أو الوسم');
});

// نشرة v5.74: ملف .build-id لم يصل إلى الحاوية (الطرفية 5.41 تُهمل ما في .gitignore عند الرفع) فأنذر
// الخطّ كذباً بعد سبع دقائق — الطريق الثاني وسمٌ من معرّف النشرة الذي تحقنه Railway في البيئة.
test('وسم النشرة: من معرّف Railway (UUID) بصمةٌ مقتطعة لا المعرّف الخام؛ غير ذلك null', () => {
  const tag = deploymentTagOf('93cacc67-57f8-4246-8e38-672136f4439a');
  assert.match(tag, /^dep-[0-9a-f]{12}$/);
  assert.equal(tag, deploymentTagOf('93CACC67-57F8-4246-8E38-672136F4439A'), 'لا حساسية لحالة الأحرف');
  assert.notEqual(tag, deploymentTagOf('93cacc67-57f8-4246-8e38-672136f4439b'));
  assert.ok(!tag.includes('93cacc67'), 'المعرّف الخام لا يظهر');
  assert.equal(deploymentTagOf(''), null); assert.equal(deploymentTagOf(null), null);
  assert.equal(deploymentTagOf('postgres://user:pw@host/db'), null);
  assert.equal(deploymentTag({}), null);
  assert.equal(deploymentTag({ RAILWAY_DEPLOYMENT_ID: '93cacc67-57f8-4246-8e38-672136f4439a' }), tag);
});

test('/ready يعلن الملف إن شُحن، وإلا الوسم من البيئة، وإلا null', () => {
  const d = mkdtempSync(join(tmpdir(), 'sanad-build-'));
  const env = { RAILWAY_DEPLOYMENT_ID: '93cacc67-57f8-4246-8e38-672136f4439a' };
  assert.equal(announcedBuildId(d, {}), null);
  assert.equal(announcedBuildId(d, env), deploymentTagOf(env.RAILWAY_DEPLOYMENT_ID));
  writeFileSync(join(d, BUILD_ID_FILE), 'efc057179f2f-20260905171658\n');
  assert.equal(announcedBuildId(d, env), 'efc057179f2f-20260905171658', 'الملف أولاً حين يُشحن');
});
