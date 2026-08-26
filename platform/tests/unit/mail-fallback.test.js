// قناة البريد الاحتياطية — الباب الوحيد للمنصة لا يُترك بمفصلةٍ واحدة.
//
// الدخول إلى سند برمزٍ يصل بالبريد، والدعوة كذلك. فإن سكتت قناة البريد لم يدخل أحد — لا
// المالك ولا مدير النظام. ولذلك قناةٌ ثانية بمزوّدٍ ونطاقٍ مختلفين: عطبُ النطاق الأول
// (SPF/DMARC، حظرُ مزوّد، انقطاع) لا يُصلحه خادمٌ ثانٍ على النطاق نفسه.
//
// وأخطر ما يُثبَّت هنا ليس أن البديل يعمل، بل **متى لا يعمل**: الحجب حكمٌ لا عطل، فلا يُجرَّب
// عليه بديل؛ وإخفاق البديل لا يبتلع خطأ الأصلية؛ ونجاحُ البديل يُقال في الأثر ولا يمرّ صامتاً.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/core/mail/transport.js', import.meta.url), 'utf8');
const smtp = readFileSync(new URL('../../src/core/mail/smtp.js', import.meta.url), 'utf8');
const cfg = readFileSync(new URL('../../src/core/config.js', import.meta.url), 'utf8');

test('القناة الاحتياطية لها مزوّدها ومُرسِلها المستقلان في الإعداد', () => {
  for (const k of ['SMTP_FALLBACK_HOST', 'SMTP_FALLBACK_USER', 'SMTP_FALLBACK_PASS', 'SMTP_FALLBACK_FROM']) {
    assert.ok(cfg.includes(k), `مفتاح الإعداد ${k} غائب`);
  }
  // المُرسِل المستقل شرطٌ لا رفاهية: المزوّد الثاني لا يأذن بالإرسال باسم نطاق الأول.
  assert.match(cfg, /smtpFallback:\s*\{[\s\S]*?from:/, 'القناة الاحتياطية بلا عنوان مُرسِل خاص');
  // ولا افتراض صامت لأي منها — نفس مذهب القناة الأصلية.
  assert.ok(!/SMTP_FALLBACK_FROM \|\| ['"][^'"]+['"]/.test(cfg), 'عنوان مُرسِل احتياطي مفترَض بصمت');
});

test('الإرسال يمرّ بالقناة الأصلية أولاً، والاحتياطية لا تُجرَّب إلا بعد إخفاقها', () => {
  const i = src.indexOf('CHANNEL.PRIMARY');
  const j = src.indexOf('CHANNEL.FALLBACK', i);
  assert.ok(i > 0 && j > i, 'ترتيب القناتين معكوس أو إحداهما غائبة');
  // والبديل داخل `catch` لا في المسار الناجح
  assert.match(src, /catch \(primaryErr\)[\s\S]{0,600}CHANNEL\.FALLBACK/, 'البديل يُجرَّب خارج فرع الإخفاق');
});

test('الحجب ليس إخفاقاً: مستقبِلٌ خارج قائمة السماح لا يستدعي القناة الاحتياطية', () => {
  // فرع الحجب يعود قبل أن يُستورد مرسِل SMTP أصلاً — فلا محاولة ولا بديل.
  const blockedReturn = src.indexOf('DELIVERY.BLOCKED');
  const importSmtp = src.indexOf("await import('./smtp.js')");
  assert.ok(blockedReturn > 0 && importSmtp > blockedReturn,
    'الحجب يقع بعد محاولة الإرسال — يعني تجربة قناتين على عنوانٍ محجوبٍ عمداً');
});

test('إخفاق البديل لا يبتلع خطأ الأصلية — فهي التي تُصلَح', () => {
  assert.match(src, /catch \(fallbackErr\)[\s\S]{0,400}throw primaryErr/,
    'رُفع خطأ البديل بدل خطأ الأصلية، فيُطارَد العطل في المكان الخطأ');
});

test('نجاحٌ عبر البديل يُقال في أثر الرسالة ولا يمرّ صامتاً', () => {
  assert.match(src, /note:\s*`أُرسلت عبر القناة الاحتياطية/, 'اللجوء إلى البديل بلا أثر مكتوب');
  const engine = readFileSync(new URL('../../src/core/reports/engine.js', import.meta.url), 'utf8');
  const otp = readFileSync(new URL('../../src/core/auth/otp.js', import.meta.url), 'utf8');
  assert.ok(engine.includes('res.note'), 'طابور التقارير لا يكتب أثر القناة الاحتياطية');
  assert.ok(otp.includes('res.note'), 'رمز الدخول لا يكتب أثر القناة الاحتياطية');
});

test('وقناةٌ احتياطية غير مُعدَّة ليست عطلاً — تُرفع علّة الأصلية كما هي', () => {
  assert.match(src, /channelReady\(channelConfig\(CHANNEL\.FALLBACK\)\)/, 'لا فحص لجاهزية البديل قبل تجربته');
  assert.match(smtp, /export const channelReady/, 'دالة الجاهزية غير مُصدَّرة');
});

test('كل قناة تُبنى من إعدادها هي — لا قراءةَ إعدادٍ ثابتٍ داخل المرسِل', () => {
  assert.match(smtp, /export async function sendViaSmtp\([^)]*,\s*which/, 'المرسِل لا يأخذ قناته وسيطاً');
  // لو قرأ المرسِل `config.smtp` مباشرةً لأرسل البديل بأسرار الأصلية.
  assert.ok(!/const \{[^}]*\} = config\.smtp;/.test(smtp), 'المرسِل ما زال يقرأ إعداد الأصلية مباشرةً');
});
