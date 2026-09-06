// حارس توريد محرّك قراءة البطاقات: يعمل داخل متصفّح المستخدم ويُخدَم من أصل سند نفسه (ADR-0014).
//   • الملفّات السبعة موجودة تحت public/vendor/tesseract-5.1.1 وبأحجامٍ فوق حدٍّ أدنى — ملفٌّ
//     ناقص أو مبتور (تنزيلٌ انقطع، أو بديلٌ فارغ) يُكتشف هنا لا في قاعة المعرض.
//   • ملفّا اللغة مضغوطان فعلاً (1F 8B) — المحرّك يفكّ الضغط بنفسه ويسقط بصمتٍ لو لم يكونا.
//   • الرخصة أباتشي ومرفقة، وشيفرة الصفحات لا تذكر شبكة التوزيع الافتراضية للمكتبة — فلا
//     اعتماد على شبكةٍ خارجية في القاعة، ولا صورةٌ ولا نصٌّ يغادر المنصّة.
//   • قوائم استبعاد النشر لا تُسقط المجلّد ولا ملفّات .gz ولا النواة من حمولة النشر.
//   • وعبر التطبيق الحقيقي: ملفّ التوريد يخرج بـimmutable، وملفّ الشيفرة العادي لا يخرج به.
//   • وصفحة الفعالية تشير إلى المسارات الثلاثة المورَّدة (العامل، النواة، اللغات) وتحمّل العامل
//     من مساره المباشر لا من رابطٍ مؤقّت (workerBlobURL: false) — فسياسة المصدر تبقى صارمة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const PLATFORM = new URL('../..', import.meta.url).pathname;
const VENDOR = 'src/web/public/vendor/tesseract-5.1.1';
const read = (p) => readFileSync(resolve(PLATFORM, p), 'utf8');
const KB = 1024, MB = 1024 * KB;

// الملفّ وحدّه الأدنى بالبايت — ملفٌّ دون حدّه ليس المحرّك.
const FILES = [
  ['tesseract.min.js', 50 * KB],
  ['worker.min.js', 100 * KB],
  ['tesseract-core-simd-lstm.wasm.js', 3.5 * MB],
  ['lang/eng.traineddata.gz', 1.5 * MB],
  ['lang/ara.traineddata.gz', 0.5 * MB],
  ['LICENSE.md', 1],
  ['VENDORED.md', 1],
];

for (const [f, floor] of FILES) {
  test(`الملفّ ${f} موجود وحجمه فوق الحدّ الأدنى`, () => {
    let st = null;
    try { st = statSync(resolve(PLATFORM, VENDOR, f)); } catch { /* يُبلَّغ أدناه */ }
    assert.ok(st, `${VENDOR}/${f} غير موجود — المحرّك ناقص ولن يعمل القارئ`);
    assert.ok(st.size > floor, `${f} حجمه ${st.size} بايت دون الحدّ ${floor} — ملفٌّ مبتور أو بديل فارغ`);
  });
}

test('ملفّا اللغة مضغوطان فعلاً بـgzip — يبدآن بـ1F 8B', () => {
  for (const f of ['lang/eng.traineddata.gz', 'lang/ara.traineddata.gz']) {
    const fd = openSync(resolve(PLATFORM, VENDOR, f), 'r');
    const head = Buffer.alloc(2);
    readSync(fd, head, 0, 2, 0);
    closeSync(fd);
    assert.deepEqual([...head], [0x1f, 0x8b], `${f} لا يبدأ بترويسة gzip — المحرّك يفكّ الضغط بنفسه فيسقط بصمت`);
  }
});

test('الرخصة مرفقة وهي أباتشي', () => {
  assert.match(read(`${VENDOR}/LICENSE.md`), /Apache/, 'ملفّ الرخصة لا يذكر Apache — راجع مصدر التوريد');
});

test('شيفرة الصفحات لا تذكر شبكة التوزيع الافتراضية للمكتبة — كل شيء من أصل سند', () => {
  const dir = resolve(PLATFORM, 'src/web/public/pages');
  for (const f of readdirSync(dir)) {
    if (!statSync(join(dir, f)).isFile()) continue;
    const txt = readFileSync(join(dir, f), 'utf8');
    for (const cdn of ['jsdelivr', 'projectnaptha']) {
      assert.ok(!txt.includes(cdn), `pages/${f} يذكر «${cdn}» — القارئ سيجلب من شبكةٍ خارجية لا من أصلنا`);
    }
  }
});

// ── صفحة الفعالية: المسارات الثلاثة من مجلّد التوريد، والعامل من مساره لا من رابط مؤقّت ──
const PAGE = 'src/web/public/pages/events.js';
test('شيفرة صفحة الفعالية تشير إلى مسارات التوريد الثلاثة (العامل، النواة، اللغات) من أصل سند', () => {
  const txt = read(PAGE);
  assert.ok(txt.includes("VENDOR = '/static/vendor/tesseract-5.1.1/'"),
    `${PAGE} لا يعرّف مجلّد التوريد /static/vendor/tesseract-5.1.1/ — القارئ سيبحث عن ملفّاته في غير مكانها`);
  for (const [key, file] of [['workerPath', 'worker.min.js'], ['corePath', 'tesseract-core-simd-lstm.wasm.js'], ['langPath', 'lang']]) {
    assert.ok(txt.includes(`${key}: VENDOR + '${file}'`),
      `${PAGE} لا يضبط ${key} على VENDOR + '${file}' — الملفّ لن يُجلَب من التوريد`);
  }
});

test('العامل يُحمَّل من مساره المباشر لا من رابطٍ مؤقّت — workerBlobURL: false', () => {
  assert.ok(read(PAGE).includes('workerBlobURL: false'),
    `${PAGE} بلا workerBlobURL: false — العامل سيُغلَّف في رابطٍ مؤقّت تمنعه سياسة المصدر`);
});

for (const f of ['.railwayignore', '.dockerignore']) {
  test(`${f} لا يُسقط المحرّك من حمولة النشر — لا src ولا *.gz ولا wasm`, () => {
    const bad = read(f).split('\n').filter((l) => /^(src|\*\.gz|.*wasm)/.test(l));
    assert.deepEqual(bad, [], `${f} يستبعد ما يحتاجه القارئ: ${bad.join(' | ')}`);
  });
}

// ── عبر التطبيق الحقيقي (بلا تطعيم): ترويسة التخزين على /static ───────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'sanad-ocr-'));
process.env.SANAD_DB = join(dir, 't.db');
let db, server, base;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  await migrate();
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((res) => server.close(res));
  if (db) await db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('ملفّ التوريد يخرج بتخزينٍ سنةً بلا مراجعة (immutable) — وملفّ الشيفرة العادي لا', async () => {
  const v = await fetch(`${base}/static/vendor/tesseract-5.1.1/LICENSE.md`);
  await v.text();
  assert.equal(v.status, 200, 'ملفّ التوريد لا يُخدَم من /static');
  assert.match(v.headers.get('cache-control') || '', /immutable/,
    'ملفّ التوريد بلا immutable — مراجعةٌ فاشلة على شبكة المعرض تُسقط القارئ');
  const a = await fetch(`${base}/static/app.js`);
  await a.text();
  assert.equal(a.status, 200, 'app.js لا يُخدَم من /static');
  assert.doesNotMatch(a.headers.get('cache-control') || '', /immutable/,
    'app.js صار immutable — بعد كل نشرٍ يبقى المتصفّح على شيفرةٍ قديمة');
});
