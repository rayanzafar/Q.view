// «صحة المنصة» — الشاشة التي تعرض ما انكسر، وقاعدتُها الحاكمة أنها لا تعرضه خاماً.
//
// أخطرُ ما في هذه الشاشة أن مصدرَ نصّها **ليس المنصة**: رسالةُ العطب يكتبها المشغّل أو
// المحرّك أو مكتبةٌ لا نملكها، فتصل بالإنجليزية وفيها `undefined` و`null` و`TypeError`.
// وأول رسالةٍ كهذه تبلغ الشاشة تُحمّر مسحَ ما بعد النشر — أي أن الشاشة التي تُبنى لتقول
// «شيءٌ انكسر» تصير هي نفسها ما انكسر. فالحارس هنا يزرع أسوأ صفٍّ ممكن ويطالب بألا يظهر
// منه حرفٌ محظور واحد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { visibleText, bannedTermIn } from '../../scripts/check-glossary.mjs';

const dir = mkdtempSync(join(tmpdir(), 'sanad-opspage-'));
process.env.SANAD_DB = join(dir, 'p.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const ADMIN = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', sector_id: null };
const LEAD = { id: 'u_lead', username: 'lead', name_ar: 'قائد قطاع', role_id: 'sector_lead', scope: 'sector', sector_id: 'sec_1' };

let db, opsPage, PAGE_ACCESS, store;
before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ opsPage } = await import('../../src/web/pages.js'));
  ({ PAGE_ACCESS } = await import('../../src/core/policy/pages.js'));
  store = await import('../../src/core/obs/store.js');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('الشاشة الفارغة تقول «كل شيء يعمل» ولا تترك القارئ أمام جدولٍ بلا صفوف', async () => {
  const html = await opsPage(ADMIN, {});
  assert.match(html, /صحة المنصة/);
  assert.match(html, /لا أعطال مسجَّلة/);
  assert.ok(!/<tbody>\s*<\/tbody>/.test(html), 'جدولٌ فارغ مكان الحالة المصمَّمة');
  assert.equal(bannedTermIn(visibleText(html)), null);
});

// الصفُّ المسموم: كلُّ حقلٍ فيه أسوأ قيمةٍ يمكن أن تصل من مُشغّلٍ لا نملكه.
const POISON = {
  fingerprint: 'a1b2c3d4e5f60718',
  kind: 'http',
  source: '/app/project/:id',
  method: 'GET',
  status: 500,
  err_kind: 'TypeError',
  err_code: 'ERR_INVALID_STATE',
  message: "Cannot read properties of undefined (reading 'id') — null NaN [object Object]",
  stack: 'TypeError: undefined is not a function\n    at Object.<anonymous> (/app/src/x.js:1:1)',
  hits: 7,
  first_at: '2026-08-26T06:00:00.000Z',
  last_at: '2026-08-26T07:00:00.000Z',
  last_req_id: 'req_XYZ',
  last_user: 'ammar',
  last_role: 'sector_lead',
  top_role_rank: 2,
  digestable: 1,
};

test('ونصُّ العطب الخام لا يبلغ الشاشة — لا رسالته ولا أثر استدعائه ولا كلمةٌ محظورة', async () => {
  await db.insert('error_event', POISON);
  const html = await opsPage(ADMIN, {});
  const shown = visibleText(html);
  assert.equal(bannedTermIn(shown), null, 'كلمةٌ محظورة بلغت النصَّ المعروض');
  assert.ok(!shown.includes('Cannot read properties'), 'الرسالة الخام معروضة');
  assert.ok(!html.includes('at Object.<anonymous>'), 'أثر الاستدعاء بلغ الصفحة');
  assert.ok(!shown.includes('TypeError'), 'نوع العطب الإنجليزي معروض بدل مقابله العربي');
});

test('والمعرَّف الوحيد المعروض رمزٌ ست عشري — أبجديّةٌ لا تستطيع تهجئة كلمةٍ محظورة', async () => {
  const html = await opsPage(ADMIN, {});
  assert.match(html, />a1b2c3d4</, 'الرمز القصير غير معروض');
  assert.ok(!visibleText(html).includes('a1b2c3d4e5f60718'), 'البصمة كاملةً معروضة بلا داعٍ');
});

test('وما يقوله الصفّ: كم مرة، ومن تأثّر، ومتى — بلا رقمٍ مخترع', async () => {
  const html = await opsPage(ADMIN, {});
  assert.match(html, /قائد قطاع/, 'رتبة من تأثّر غير معروضة — وهي ترتيب القراءة كله');
  assert.match(html, />7</, 'عدّ التكرار غير معروض');
  assert.match(html, /إسكات/);
});

// الإسكات لا يحذف: القائمة تبقى كاملةً وإلا صار «لا أعطال» كذبةً مريحة.
test('والمُسكَت يبقى في القائمة ولا يختفي منها', async () => {
  await store.muteFault(POISON.fingerprint, true);
  const groups = await store.faultGroups({ limit: 50 });
  const row = groups.find((g) => g.fingerprint === POISON.fingerprint);
  assert.ok(row, 'اختفى العطل بمجرد إسكاته');
  assert.ok(row.muted_at, 'لم يُسجَّل الإسكات');
  const html = await opsPage(ADMIN, {});
  assert.match(html, /إلغاء الإسكات/, 'لا سبيل للتراجع عن الإسكات من الشاشة');
  assert.equal(bannedTermIn(visibleText(html)), null);
});

test('والشاشة لمدير النظام وحده — لا لقائد قطاع', () => {
  assert.equal(typeof PAGE_ACCESS.ops, 'function', 'الشاشة خارج جدول الصلاحيات — تُفتح للجميع');
  assert.equal(PAGE_ACCESS.ops(ADMIN), true);
  assert.equal(PAGE_ACCESS.ops(LEAD), false);
});

// سطرُ التدقيق يقرأه إنسان في «سجل التدقيق»، ومفتاحٌ لا ترجمة له تُطبَع قيمتُه وحدها —
// فـ`{muted:true}` كانت تصل الشاشة كلمةً إنجليزية. الوصف يُكتب مترجَماً من المصدر.
test('وسطرُ تدقيق الإسكات عربيٌّ في الشاشة — لا مفتاحٌ ولا قيمةٌ إنجليزية', async () => {
  const { muteFaultFor } = await import('../../src/core/obs/admin.js');
  const { resourceLabel } = await import('../../src/web/i18n/glossary.js');
  await muteFaultFor({ user: ADMIN, ip: '1' }, POISON.fingerprint, true);
  const row = (await db.all("SELECT * FROM audit_log WHERE resource = 'error_event' ORDER BY at DESC"))[0];
  assert.ok(row, 'الإسكات لم يُدقَّق');
  assert.equal(bannedTermIn(visibleText(String(row.detail_json))), null);
  assert.ok(!/true|false/.test(String(row.detail_json)), 'قيمةٌ منطقية إنجليزية في وصف التدقيق');
  assert.equal(resourceLabel('error_event'), 'عطل', 'اسم السجل يسقط إلى «سجل» العامّة');
});

test('وقائد قطاع لا يُسكت عطلاً — الحارس في الخدمة لا في المسار', async () => {
  const { muteFaultFor } = await import('../../src/core/obs/admin.js');
  await assert.rejects(() => muteFaultFor({ user: LEAD, ip: '1' }, POISON.fingerprint, true),
    (e) => /صلاحية مدير النظام/.test(String(e.message)));
});
