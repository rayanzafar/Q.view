// حدود «رسالة التجربة» — نقطةُ إرسالٍ بريديّ، فحدودها أهم من نجاحها.
//
// أي مسارٍ يُخرج بريداً هو أداةُ إزعاجٍ محتملة. وهذه مُقيَّدة بقيدين بنيويين لا بفحصٍ يُنسى:
//  ① لا حقل مستقبِل في الطلب إطلاقاً — العنوان يُقرأ من حساب صاحب الطلب في القاعدة. فلا
//    تصلح لإرسال شيءٍ إلى أحدٍ غيره مهما بلغ الطلب من خبث، ولا تحتاج حدَّ معدّل.
//  ② مدير النظام وحده.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mailtest-'));
process.env.SANAD_DB = join(dir, 'm.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, selftest;
const T = new Date().toISOString();
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const ADMIN = { id: 'u_adm', username: 'adm', role_id: 'admin', scope: 'company' };
const CEO = { id: 'u_ceo', username: 'ceo', role_id: 'ceo_office', scope: 'company' };
const EMP = { id: 'u_emp', username: 'emp', role_id: 'employee', scope: 'own' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  selftest = await import('../../src/core/mail/selftest.js');
  await db.insert('app_user', { id: 'u_adm', username: 'adm', email: 'admin@evc.sa', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_ceo', username: 'ceo', email: 'ceo@evc.sa', role_id: 'ceo_office', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_emp', username: 'emp', email: 'emp@evc.sa', role_id: 'employee', scope: 'own', active: 1, created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('مدير النظام وحده — ومكتب الرئيس يقرأ الشاشة ولا يُرسل منها', async () => {
  await assert.rejects(() => selftest.sendChannelTest(ctx(EMP), { channel: 'primary' }), /صلاحية/);
  await assert.rejects(() => selftest.sendChannelTest(ctx(CEO), { channel: 'primary' }), /صلاحية/);
  await assert.rejects(() => selftest.sendChannelTest({ user: null }, {}), /صلاحية/);
});

test('لا مستقبِل في الطلب: العنوان من حساب صاحب الطلب، فلا تصلح للإرسال إلى غيره', async () => {
  // محاولةُ حقن عنوانٍ بكل الأسماء المحتملة — كلها تُتجاهَل بحكم أن الدالة لا تقرأ إلا الحساب.
  const res = await selftest.sendChannelTest(ctx(ADMIN),
    { channel: 'primary', to: 'victim@example.com', email: 'victim@example.com', recipient: 'victim@example.com' });
  assert.equal(res.to, 'admin@evc.sa', 'خرج العنوان من جسم الطلب — ثغرة إرسال');

  // والحدّ بنيوي لا سلوكيّ: المصدر نفسه لا يقرأ مستقبِلاً من الطلب.
  const src = readFileSync(new URL('../../src/core/mail/selftest.js', import.meta.url), 'utf8');
  assert.ok(!/\b(to|recipient|email)\s*[,}]/.test(src.slice(src.indexOf('export async function sendChannelTest'), src.indexOf('const row'))),
    'صار الطلب يحمل مستقبِلاً — يلزم حدّ معدّل وقائمة سماح صريحة عندئذٍ');
});

test('وحسابٌ بلا عنوان بريد يُقال له ذلك، ولا يُرسَل إلى فراغ', async () => {
  await db.insert('app_user', { id: 'u_nomail', username: 'nomail', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await assert.rejects(
    () => selftest.sendChannelTest(ctx({ id: 'u_nomail', role_id: 'admin', scope: 'company' }), { channel: 'primary' }),
    /لا عنوان بريد/);
});

test('وضع المعاينة يُقال معاينةً لا إرسالاً — والنتيجة تُقيَّد في السجل', async () => {
  const before = (await db.all('SELECT COUNT(*) n FROM email_log'))[0].n;
  const res = await selftest.sendChannelTest(ctx(ADMIN), { channel: 'primary' });
  assert.equal(res.ok, false, 'ادّعت المعاينة إرسالاً');
  assert.equal(res.event, 'previewed');
  const after = (await db.all('SELECT COUNT(*) n FROM email_log'))[0].n;
  assert.equal(after, before + 1, 'لم تُقيَّد نتيجة التجربة في السجل');
  const last = (await db.all('SELECT detail FROM email_log ORDER BY at DESC LIMIT 1'))[0];
  assert.match(last.detail, /تجربة القناة/, 'الأثر لا يقول إنها رسالة تجربة');
});

test('واختبار قناةٍ بعينها لا يتحوّل إلى الأخرى — وإلا كذب الاختبار', async () => {
  const src = readFileSync(new URL('../../src/core/mail/selftest.js', import.meta.url), 'utf8');
  // يُنادى المرسِل مباشرةً بالقناة المطلوبة، لا عبر sendMail الذي يحمل منطق التحويل.
  assert.match(src, /sendViaSmtp\([\s\S]*?,\s*which\)/, 'لا يُنادى المرسِل بالقناة المطلوبة مباشرةً');
  assert.ok(!src.includes('sendMail('), 'يمرّ عبر مسار التحويل — فقد يقول «نجحت الاحتياطية» والناجح الأصلية');
});
