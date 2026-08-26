// قاعدة البيانات في الإنتاج — لا مهرب، ولا تعطيلٌ للتطوير والاختبار.
//
// العلّة التي يغلقها هذا الملف: `USE_PG = !!config.databaseUrl`، فقيمةٌ فارغة تعني SQLite.
// وكان `STAGING=1` يُسقط اشتراط `DATABASE_URL` في الإنتاج — والرايةُ مضبوطةٌ على الخدمة
// الحيّة الآن، يحجبها وجودُ الرابط وحده. فمسحُ ذلك الحقل في اللوحة — لا حذفُه — كان يُقلع
// المنصة **خضراءَ فارغة** على ملفٍ محلّي زائل: مسبار الجاهزية يمرّ، والنشرة تنجح، وكلُّ
// الحسابات تفشل بالدخول. يبدو فقداناً كاملاً للبيانات وهو ليس كذلك — وما يُكتب في تلك
// النافذة يضيع فعلاً مع أول إعادة تشغيل، بلا نسخةٍ احتياطية.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// الإعداد يُبنى مرةً عند التحميل، فكل حالةٍ تُعيد استيراده بمعرّفٍ جديد — نمط session-config.
let seq = 0;
async function loadWith(env) {
  const keys = ['NODE_ENV', 'DATABASE_URL', 'STAGING'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await import(`../../src/core/config.js?guard=${++seq}`);
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('الإنتاج بلا رابط قاعدة يرفض الإقلاع — ولو كانت راية التجربة مرفوعة', async () => {
  for (const staging of [undefined, '1', 'true']) {
    const env = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) };
    if (staging) env.STAGING = staging;
    const m = await loadWith(env);
    assert.throws(() => m.assertProdDatabase(), /DATABASE_URL/, `مرّت الحالة STAGING=${staging}`);
  }
});

test('وقيمةٌ من مسافاتٍ وحدها = غير مضبوط، لا رابطٌ فاسد', async () => {
  // مسحُ الحقل في اللوحة يُنتج هذا بالضبط. بلا التطبيع يمرّ نصٌّ غير فارغ إلى المُحرّك
  // فيُخفق بعبارةٍ غامضة لا تذكر اسم المتغيّر أصلاً.
  const m = await loadWith({ NODE_ENV: 'production', DATABASE_URL: '   ', SESSION_SECRET: 'x'.repeat(32) });
  assert.equal(m.config.databaseUrl, null, 'مرّت المسافات رابطاً');
  assert.throws(() => m.assertProdDatabase(), /DATABASE_URL/);
});

test('والإنتاج برابطٍ حقيقي يمرّ', async () => {
  const m = await loadWith({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h:5432/db', SESSION_SECRET: 'x'.repeat(32) });
  assert.doesNotThrow(() => m.assertProdDatabase());
});

// الحارس يجب ألا يكسر ما تقوم عليه التنمية والاختبارات: الطقم كله يعمل على SQLite عمداً.
test('والتطوير والاختبار بلا رابط يمرّان صامتَين — SQLite محرّكهما المقصود', async () => {
  for (const env of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }, { NODE_ENV: 'development', DATABASE_URL: '' }]) {
    const m = await loadWith(env);
    assert.doesNotThrow(() => m.assertProdDatabase(), `كُسر وضعٌ مشروع: ${JSON.stringify(env)}`);
  }
});

test('ولا قراءةَ لراية التجربة في الإعداد — الإعفاء أُزيل لا أُعيدت تسميته', () => {
  // إعادةُ التسمية لا تُغلق الثقب: الراية مضبوطةٌ على الخدمة الحيّة، وكُرّاسة فصل البيئات
  // تُوصي بنسخ متغيّرات الإنتاج إلى أي بيئةٍ جديدة — فتُنسخ معها.
  const src = readFileSync(new URL('../../src/core/config.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  assert.ok(!/process\.env\.STAGING/.test(code), 'عاد الإعفاء — ثقبُ القاعدة الفارغة مفتوح من جديد');
});

test('والحارس يُنادى في مطلع الترحيلة، قبل أول كتابة', () => {
  // `assertProdSecrets` يعمل عند بناء التطبيق — أي بعد أن يكون سكربت الإقلاع قد أنشأ
  // المخطط كاملاً وبذر اثنتي عشرة خطوة في القاعدة الخطأ.
  const mig = readFileSync(new URL('../../scripts/migrate.js', import.meta.url), 'utf8');
  const guard = mig.indexOf('assertProdDatabase()');
  const firstWrite = mig.indexOf("await exec('CREATE TABLE IF NOT EXISTS schema_migration");
  assert.ok(guard > 0, 'لا حارس في الترحيلة');
  assert.ok(guard < firstWrite, 'الحارس بعد أول كتابة — فات الأوان');
});

test('والمحرّك المختار يُعلَن عند الإقلاع', () => {
  const db = readFileSync(new URL('../../src/core/db/index.js', import.meta.url), 'utf8');
  assert.match(db, /logInfo\('db_driver'/, 'القرار الأخطر في زمن التشغيل ما زال صامتاً');
});
