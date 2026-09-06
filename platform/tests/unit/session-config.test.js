// أرقام الجلسة تُتحقَّق عند التحميل — لا تصل الحسابَ NaN ولا قيمةً سالبة.
//
// العيب المُغطّى: الدليل التشغيلي يطلب من المُشغِّل كتابة ثلاثة أرقام بيده في لوحة البيئة.
// وخطأٌ مطبعي واحد («30 days») كان يجعل `Number(...)` = NaN، فيصير `new Date(NaN).toISOString()`
// رميةً في وسيطة الطلب — أي **٥٠٠ لكل مستخدمٍ داخل**، بينما `/health` و`/ready` تبقيان خضراوين
// لأنهما فوق حلّ الجلسة. منصةٌ تُعلن سلامتها ولا يعملها أحد.
// وقيمةٌ سالبة في السقف كانت تقلب مهلة الكنسة إلى المستقبل فتمحو الجلسات **الحيّة**.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ENV = ['SESSION_TTL_HOURS', 'SESSION_MAX_DAYS', 'SESSION_TOUCH_MINUTES'];

// الوحدة تُحمَّل من جديد لكل حالة: `config` كائنٌ يُبنى مرةً عند الاستيراد.
async function loadWith(env) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const { config } = await import(`../../src/core/config.js?v=${encodeURIComponent(JSON.stringify(env))}`);
    return { ttl: config.sessionTtlHours, cap: config.sessionMaxDays, touch: config.sessionTouchMinutes };
  } finally {
    for (const k of ENV) { delete process.env[k]; if (saved[k] !== undefined) process.env[k] = saved[k]; }
  }
}

test('الافتراضات حين لا يُضبط شيء', async () => {
  assert.deepEqual(await loadWith({}), { ttl: 12, cap: 30, touch: 5 });
});

test('قيمٌ سليمة تُقبل كما هي', async () => {
  assert.deepEqual(await loadWith({ SESSION_TTL_HOURS: '8', SESSION_MAX_DAYS: '14', SESSION_TOUCH_MINUTES: '0' }),
    { ttl: 8, cap: 14, touch: 0 });
});

for (const bad of ['30 days', 'abc', '', ' ', 'NaN', 'Infinity']) {
  test(`قيمة لا تصلح «${bad}» تسقط إلى الافتراض ولا تصل الحساب`, async () => {
    const c = await loadWith({ SESSION_TTL_HOURS: bad, SESSION_MAX_DAYS: bad, SESSION_TOUCH_MINUTES: bad });
    assert.deepEqual(c, { ttl: 12, cap: 30, touch: 5 });
    // والبرهان العملي: الحساب الذي كان يرمي يصير قابلاً للقراءة.
    assert.equal(typeof new Date(Date.now() + c.ttl * 3600000).toISOString(), 'string');
  });
}

test('سقفٌ سالب يُرفض — وإلا محت الكنسة الجلسات الحيّة', async () => {
  const c = await loadWith({ SESSION_MAX_DAYS: '-1' });
  assert.equal(c.cap, 30, 'قيمة سالبة عبرت إلى مهلة الكنسة');
  // مهلة الكنسة يجب أن تقع في الماضي دائماً — وإلا حذفت ما ينتهي غداً.
  assert.ok(new Date(Date.now() - c.cap * 86400000).toISOString() < new Date().toISOString());
});

test('نافذةٌ صفرية تُرفض — وإلا طُرد الجميع لحظة الإقلاع', async () => {
  assert.equal((await loadWith({ SESSION_TTL_HOURS: '0' })).ttl, 12);
});
