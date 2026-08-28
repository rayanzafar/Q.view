// معرّف النشرة: يُقرأ من الجذر إن وُجد وصحَّ شكله، وإلا null — ولا يُصدَّق ملفٌ بمحتوى غريب.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readBuildId, BUILD_ID_FILE } from '../../src/core/http/build-id.js';

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

test('خطُّ النشر يكتب المعرّف قبل الرفع وينتظره بعينه في /ready', () => {
  const src = readFileSync(join(ROOT, 'scripts/deploy.mjs'), 'utf8');
  const stamp = src.indexOf("writeFileSync(join(ROOT, '.build-id')");
  const up = src.indexOf("['up', '--detach'");
  assert.ok(stamp > 0 && up > stamp, 'المعرّف يُكتب قبل railway up');
  assert.match(src, /j\.build === BUILD_ID/);
  const srv = readFileSync(join(ROOT, 'src/server.js'), 'utf8');
  assert.match(srv, /build: buildId/);
});
