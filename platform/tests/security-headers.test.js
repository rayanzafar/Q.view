// ترويسات الأمان: مسارا المعاينة الداخليان (تقرير/بريد) يُضمَّنان فعلياً بـ<iframe> من نفس الأصل؛
// عطل حقيقي كان X-Frame-Options: DENY يمنعهما تماماً حتى من نفس الأصل فتظهر المعاينة فارغة بصمت
// (لا خطأ ظاهر للمستخدم — فقط لا شيء يظهر). هذا الاختبار حارس رجعي: يثبت أن الاستثناء مضبوط على
// هذين المسارين فقط، وأن كل صفحة أخرى تبقى محجوبة بالكامل (DENY) كما كانت.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityHeaders } from '../src/core/http/security.js';

function callWith(path) {
  const headers = {};
  const req = { path };
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  securityHeaders()(req, res, () => {});
  return headers;
}

test('security headers: مسار معاينة التقرير يسمح بالتضمين من نفس الأصل فقط', () => {
  const h = callWith('/app/reports/preview/sector_weekly_status');
  assert.equal(h['X-Frame-Options'], 'SAMEORIGIN');
  assert.match(h['Content-Security-Policy-Report-Only'], /frame-ancestors 'self'/);
});

test('security هيدرز: مسار معاينة رسالة البريد يسمح بالتضمين من نفس الأصل فقط', () => {
  const h = callWith('/app/mail/preview/some-file.html');
  assert.equal(h['X-Frame-Options'], 'SAMEORIGIN');
});

test('security headers: كل صفحة أخرى تبقى محجوبة بالكامل عن أي تضمين (DENY)', () => {
  for (const p of ['/app/ceo', '/app/reports', '/app/projects', '/app/mail', '/login', '/app/opportunity/o1']) {
    const h = callWith(p);
    assert.equal(h['X-Frame-Options'], 'DENY', `expected DENY for ${p}`);
    assert.match(h['Content-Security-Policy-Report-Only'], /frame-ancestors 'none'/);
  }
});

// قارئ البطاقات داخل المتصفّح (ADR-0014): عاملٌ من أصلنا يشغّل WebAssembly. الترويسة اليوم
// Report-Only، لكن المخالفة تُسجَّل خطأً في وحدة التحكم — وفحوص المتصفّح تعدّ ذلك سقوطاً.
// والتوجيهان يُكتبان الآن كي لا يكسر التحويلُ إلى enforcing القارئَ بصمت في نشرةٍ لاحقة.
test('security headers: سياسة المحتوى تسمح لقارئ البطاقات بعاملٍ من أصلنا وبتشغيل WebAssembly', () => {
  const h = callWith('/app/event/ev1');
  assert.match(h['Content-Security-Policy-Report-Only'], /script-src [^;]*'wasm-unsafe-eval'/,
    "script-src بلا 'wasm-unsafe-eval' — نواة القراءة لا تُنشأ داخل العامل");
  assert.match(h['Content-Security-Policy-Report-Only'], /worker-src 'self'/,
    "worker-src 'self' غائب — المتصفّح يرفض عامل القراءة القادم من أصلنا");
});
