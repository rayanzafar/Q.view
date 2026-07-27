// حارس التركيب — كل موجّه مبنيّ مركَّب فعلاً على التطبيق الحقيقي.
//
// هذا الملف يسدّ ثغرة **في طريقة اختبارنا** لا في المنتج: بقية اختبارات المسارات تُركّب الموجّه
// بيدها على تطبيق تختبره (`app.use('/api', xRouter)`) كي تعزل الوحدة — وهو صحيح لما بُنيت له،
// لكنه يعني أن موجّهاً كاملاً ومختبَراً بالكامل قد يبقى **غير مركَّب** في `api.routes.js`
// وتبقى الحزمة خضراء: الخدمة تعمل، والاختبارات تمرّ، والمستخدم يرى ٤٠٤. وقد حدث ذلك فعلاً —
// «صورة المال على المشروع» بُنيت واختُبرت ولم تُركَّب، لأن ملف التركيب مملوك لجلسة التكامل
// وحدها فلا حارة تلمسه.
//
// فالفحص هنا لا يمسّ منطق أي وحدة: يُقلع التطبيق **كما يُقلع في الإنتاج بلا أي تطعيم**،
// ويسأل كل مسار: هل تصل إليك الرسالة؟ الردّ المقبول أيّ ردّ من المنصة نفسها — ٢٠٠ أو ٤٠٣ أو
// ٤٠٤ بمعناها العربي — والمرفوض ردّ «لا مسار بهذا الاسم».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-api-mount.db');
process.env.SANAD_DB = TEST_DB;

let db, server, base;

// جلب مُستنزَف الجسد: ترك جسد الرد غير مقروء يُبقي المُحلِّل موقوفاً على مقبس حيّ، فينفجر
// التفكيك لاحقاً ويُسقط الملف كله. تُقرأ دائماً ولو لم تُستعمل.
async function req(path, { method = 'GET', as = 'admin' } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: `sanad_sid=sess_${as}` },
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* صفحة لا حمولة — نصّها يكفي للفحص */ }
  return { status: r.status, text, body };
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  const { nowIso } = await import('../../src/core/util/ids.js');
  await migrate();
  await seedRbac();

  const now = nowIso();
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع التجربة', active: 1, created_at: now });
  await db.insert('app_user', { id: 'u_admin', username: 'demo.admin', name_ar: 'مدير النظام',
    role_id: 'admin', sector_id: null, scope: 'company', active: 1, created_at: now });
  await db.insert('session', { id: 'sess_admin', user_id: 'u_admin', created_at: now,
    expires_at: new Date(Date.now() + 86400000).toISOString() });
  await db.insert('project', { id: 'P_MOUNT', name_ar: 'مشروع فحص التركيب', sector_id: 'S1',
    status: 'ACTIVE', created_at: now });

  // **بلا تطعيم**: هذا هو بيت القصيد — لا `app.use` واحد بعد `createApp`.
  const { createApp } = await import('../../src/server.js');
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((res) => server.close(res));
  await db.close();
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
});

// المسارات التي يجب أن تكون حيّة. القائمة تنمو مع كل موجّه جديد — ومن يبني موجّهاً ولا يضيفه
// هنا يترك نفس الثغرة مفتوحة للمرة القادمة.
const MOUNTED = [
  ['GET', '/api/projects/P_MOUNT/money', 'صورة المال على المشروع'],
  ['GET', '/api/projects/P_MOUNT/expenses', 'سجل مصروفات المشروع'],
  ['GET', '/api/projects/P_MOUNT/governance', 'حوكمة المشروع'],
  ['GET', '/api/clients', 'العملاء'],
  ['GET', '/api/org/health', 'صحة الهيكل'],
];

for (const [method, path, label] of MOUNTED) {
  test(`${label} — المسار مركَّب ويستقبل الطلب`, async () => {
    const r = await req(path, { method });
    assert.notEqual(r.status, 404,
      `${method} ${path} يردّ ٤٠٤ — الموجّه مبنيّ وغير مركَّب في api.routes.js`);
    assert.ok(!/Cannot (GET|POST|PATCH|DELETE)/.test(r.text),
      `${method} ${path} بلغ معالج إكسبريس الافتراضي — أي أنه غير معروف للتطبيق`);
  });
}

test('صورة المال تُعيد الأقسام التي تقرؤها الشاشة — لا هيكلاً فارغاً', async () => {
  const r = await req('/api/projects/P_MOUNT/money');
  assert.equal(r.status, 200);
  for (const key of ['bridge', 'cashIn', 'cashOut', 'expenses', 'staffing', 'cost', 'months'])
    assert.ok(r.body[key] !== undefined, `القسم «${key}» مفقود من الحمولة`);
  // مشروع بلا حركة: «غير مُسجَّل» لا «صفر ريال» — الغياب والقياس لا يُخلطان.
  assert.equal(r.body.cashIn.recorded, false, 'بلا تحصيلات ⟵ غير مُسجَّل');
  assert.equal(r.body.cashIn.total_halalas, null, 'وبلا رقم — لا صفر يُقرأ قياساً');
});

test('صفحة المشروع تمرّر الاستعلام — سنة «حركة المال» تصل من الرابط لا من داخل الصفحة وحدها', async () => {
  // نفس صنف عطل «مبنيٌّ وغير موصول» أعلاه، وفي طبقة أخرى: المبدِّل مبنيٌّ ويعمل داخل الصفحة،
  // لكن الموجّه كان يستدعي `projectDetailPage(user, id)` بلا استعلام — فالرابط لا يحمل السنة،
  // ولا يُشارَك، ولا يُفتح على سنةٍ بعينها. والفحص يقارن **صفحتين** لا صفحةً واحدة: لو أُهمل
  // الاستعلام لخرجتا متطابقتين حرفياً، وهو ما يجعل هذا الفحص قادراً على السقوط.
  const now = new Date().getUTCFullYear();
  const a = await req(`/app/project/P_MOUNT?year=${now}`);
  const b = await req(`/app/project/P_MOUNT?year=${now - 1}`);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.text, b.text,
    'الصفحتان متطابقتان رغم اختلاف السنة — الاستعلام لا يبلغ الصفحة');
});

test('مسار غير موجود يبقى غير موجود — الحارس يميّز التركيب من القبول العام', async () => {
  const r = await req('/api/projects/P_MOUNT/this-route-does-not-exist');
  assert.equal(r.status, 404,
    'لو مرّ هذا لكان الفحص أعلاه بلا معنى — كان سيمرّ على أي مسار مخترَع');
});
