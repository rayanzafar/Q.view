// انضباط المراقبة — خصائص بنيوية لا تُحفظ بالانتباه بل بالشكل.
//
// أداةُ التشخيص خطرةٌ بطبيعتها: تعمل **لحظة العطب**، أي في أسوأ لحظةٍ ممكنة. فإن أبطأت
// الاستجابة، أو رمت، أو انتظرت قاعدةً هي نفسها ما تعطّل، حوّلت عطباً قابلاً للتشخيص إلى
// انقطاعٍ كامل. وكلُّ حارسٍ هنا يمنع فئةً من ذلك — ويسقط إن أُعيدت.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const codeOf = (p) => read(p).split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

test('G1: عقدُ سجل الإقلاع مع بوابة النشر سليمٌ من طرفَيه', () => {
  // بوابة النشر تقرأ سجل المستضيف بحثاً عن نصَّين. تغييرُ أيٍّ من الطرفين يُعمي البوابة
  // بصمت: تمرّ نشرةٌ بترحيلةٍ فاشلة ولا يعترض أحد. فيُثبَّت الطرفان معاً.
  assert.ok(read('scripts/migrate.js').includes('applied migration'), 'تغيّر نصّ الترحيلة المطبَّقة');
  assert.ok(read('scripts/deploy.mjs').includes('applied migration'), 'تغيّر ما تبحث عنه بوابة النشر');
  assert.ok(read('scripts/boot.sh').includes('فشلت الترحيلة'), 'تغيّر نصّ فشل الترحيلة');
  assert.ok(read('scripts/deploy.mjs').includes('فشلت الترحيلة'), 'بوابة النشر لم تعد تبحث عن فشل الترحيلة');
});

test('G2: المُسجِّل لا يستورد من التطبيق شيئاً', () => {
  const imports = [...read('src/core/obs/log.js').matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  for (const spec of imports) assert.ok(spec.startsWith('node:'), `استوردَ «${spec}»`);
});

test('G4: معالج الأخطاء متزامن — لا انتظار على مسار الاستجابة', () => {
  // `await` هنا يعني: حين تتعطّل قاعدة البيانات تصير كل استجابة 500 معلّقةً بمهلة الاتصال،
  // فتُستنزف حصص المجمّع، فيعجز مسبار الجاهزية عن الرد، فيُعيد المستضيف التشغيل — وبعد
  // ثلاث مرات يتوقف عن الإعادة. عطبٌ عابر يصير انقطاعاً دائماً.
  const src = codeOf('src/core/http/errors.js');
  const i = src.indexOf('export function errorHandler()');
  assert.ok(i > 0, 'لم يُعثر على معالج الأخطاء');
  const body = src.slice(i, src.indexOf('\n}', i));
  assert.ok(!/\bawait\b/.test(body), 'دخل انتظارٌ إلى معالج الأخطاء');
  assert.ok(!/\basync\b/.test(body.split('\n')[0] + body.slice(0, 200)), 'صار المعالج غير متزامن');
});

test('G5: السطر القاتل يُكتب متزامناً قبل الخروج، لا بعده', () => {
  const src = codeOf('src/server.js');
  const h = src.indexOf("process.on('uncaughtException'");
  assert.ok(h > 0, 'لا معالج للاستثناء غير الملتقَط');
  const body = src.slice(h, h + 700);
  const w = body.indexOf('writeFatalSync');
  const x = body.indexOf('process.exit(1)');
  assert.ok(w > 0, 'لا كتابة متزامنة — السطر قد يُبتر مع الخروج');
  assert.ok(w < x, 'الكتابة بعد الخروج فلا تُنفَّذ أبداً');
});

test('G9: أغلفة المسارات الستة عشر لم تُمسّ', () => {
  // نقطة الالتقاط واحدة عمداً. تعديل الأغلفة يعني ستة عشر موضعاً تنحرف، ويفوت مع ذلك
  // حوارسَ الجلسة وصفحات العرض ومسارات الدخول.
  assert.ok(read('src/modules/api.routes.js').includes('const h = (fn) =>'), 'تغيّر غلاف المسارات');
});

test('والالتقاط لا يقع إلا في معالج الأخطاء — لا نسخة ثانية تُضاعف السطور', () => {
  for (const p of ['src/modules/api.routes.js', 'src/web/routes.js']) {
    assert.ok(!codeOf(p).includes("logError('http_error'"), `التقاطٌ ثانٍ في ${p}`);
  }
});

test('ولا يُسجَّل جسمُ الطلب ولا نصّ استعلامه — فيهما رمزُ دخولٍ واسمُ عميل', () => {
  const src = codeOf('src/core/http/errors.js') + codeOf('src/core/obs/reqctx.js');
  assert.ok(!/req\.body/.test(src), 'جسم الطلب دخل السجل — ومسار التحقّق يحمل رمز الدخول');
  assert.ok(!/req\.query/.test(src), 'نصّ الاستعلام دخل السجل — والبحث يحمل أسماء العملاء');
});
