// نبضةُ المجدول لا تتداخل مع نفسها — وإلا أُرسلت الرسالة مرتين.
//
// `setInterval` لا ينتظر دالةً غير متزامنة. فإن تجاوزت النبضةُ الدقيقة انطلقت التالية فوقها،
// والأثر ليس بطئاً: `processQueue` يختار الصفوف `QUEUED` ثم يضع `status='SENDING'` بتحديثٍ
// **غير مشروط** — ليس مطالبةً — فنبضتان متوازيتان تلتقطان الصفّ نفسه وتُرسلان الرسالة مرتين.
// وخادمُ بريدٍ بطيء وحده كافٍ لإطالة النبضة، وهو ما جعل هذه العلّة واقعيةً لا نظرية.
//
// والفحص على المصدر لأن الدالة غير مُصدَّرة وتُشغَّل بمؤقّت: تشغيل النبضة الحقيقية هنا يعني
// قاعدةً وبريداً ومؤقّتاً في اختبار وحدة. المحاكاة أدناه تُثبت **الخاصية** ذاتها بحارسٍ مطابق.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/core/jobs/scheduler.js', import.meta.url), 'utf8');
const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

test('النبضة محروسة: تعود فوراً إن كانت سابقتها تعمل', () => {
  assert.match(code, /if \(running\) return;/, 'لا حارس تداخل — نبضتان قد تعملان معاً');
  assert.match(code, /running = true;/, 'لا رفع للعلم قبل العمل');
});

test('والعلم يُخفض في finally — فنبضةٌ فاشلة لا تُوقف المجدول إلى الأبد', () => {
  // بلا finally يبقى `running` مرفوعاً بعد أول استثناء، فيصمت المجدول صمتاً تاماً:
  // لا بريد، ولا جدولة، ولا كنس — وهو عطبٌ أسوأ من التداخل الذي نعالجه.
  assert.match(code, /finally \{ running = false; \}/, 'لا إنزال مضمون للعلم');
});

test('وجسمُ النبضة انتقل إلى دالة مستقلة يستدعيها الحارس', () => {
  assert.match(code, /async function tickBody\(\)/, 'جسم النبضة لم يُفصل');
  assert.match(code, /setInterval\(tick, 60000\)/, 'المؤقّت لم يعد يستدعي الحارس');
});

// والخاصية نفسها مُحاكاةً: حارسٌ بنفس الشكل يمنع التداخل ويستأنف بعد الفشل.
test('الخاصية: عملٌ بطيء لا يُشغَّل مرتين معاً، ويستأنف بعد استثناء', async () => {
  let running = false, concurrent = 0, peak = 0, runs = 0;
  const body = async (shouldThrow) => {
    concurrent += 1; peak = Math.max(peak, concurrent); runs += 1;
    await new Promise((r) => setTimeout(r, 5));
    concurrent -= 1;
    if (shouldThrow) throw new Error('فشل مقصود');
  };
  const guarded = async (shouldThrow) => {
    if (running) return;
    running = true;
    try { await body(shouldThrow); } catch { /* كما يفعل المجدول: يُسجّل ويكمل */ } finally { running = false; }
  };
  // ثلاث نبضات متلاحقة بينما الأولى ما زالت تعمل ⇒ واحدة فقط تعمل
  await Promise.all([guarded(false), guarded(false), guarded(false)]);
  assert.equal(peak, 1, 'عملت نبضتان في اللحظة نفسها — بابُ الإرسال المكرَّر');
  assert.equal(runs, 1, 'دخلت أكثر من نبضة رغم الحارس');

  // نبضة تفشل ثم تُستأنف التالية — العلم لم يعلق
  await guarded(true);
  await guarded(false);
  assert.equal(runs, 3, 'علق العلم بعد الفشل فتوقّف المجدول');
});

test('قناة البريد لها سقوف مهلة صريحة — خادمٌ صامت لا يُعلّق الطابور', () => {
  const smtp = readFileSync(new URL('../../src/core/mail/smtp.js', import.meta.url), 'utf8');
  for (const k of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
    assert.ok(smtp.includes(k), `لا سقف ${k} — الافتراض دقيقتان للاتصال وعشر للمقبس`);
  }
  // والسقوف أقصر من دورة النبضة (٦٠ ثانية) وإلا عاد بابُ التداخل من حيث أُغلق.
  const nums = [...smtp.matchAll(/(connectionTimeout|greetingTimeout|socketTimeout):\s*(\d+)/g)]
    .map((m) => Number(m[2]));
  assert.equal(nums.length, 3, 'لم تُقرأ السقوف الثلاثة');
  for (const n of nums) assert.ok(n > 0 && n <= 30000, `سقف ${n} غير معقول أمام نبضة الدقيقة`);
});
