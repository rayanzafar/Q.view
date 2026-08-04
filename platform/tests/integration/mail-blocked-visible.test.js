// ── حسابٌ لن يصله رمزٌ أبداً: الشاشة تقولها قبل أن يصطدم صاحبها بالجدار ─────
//
// «عبدالرحمن طلب الرمز وحسابه مفعّل وما وصله الرمز — ليش، إيش المشكلة» — سؤال المالك.
//
// وما جرى فعلاً (مُثبَتٌ في سجل البريد الحيّ): أربع محاولات، كلها `blocked` — «كل المستقبِلين
// خارج قائمة العناوين المسموح بها في هذه البيئة». والشاشة تقول «أرسلنا رمزاً»، فبحث الرجل في
// بريده المزعج عن رسالةٍ لم تغادر الخادم أصلاً.
//
// والحارس نفسه صحيح ومقصود (قاعدة التجربة تحمل عناوين موظفين حقيقيين). العيب أن **القائمة
// والحسابات مصدران لا يقارنهما شيء**: الحساب يُنشأ نشطاً ويبدو سليماً وبريده مكتوب، ولا شيء
// يقول إنه محجوب حتى يحاول صاحبه. وقع ذلك على ثلاثة أشخاص.
//
// وهذا الملف يحرس الأمرين: أن السبب يصل مديرَ النظام (لا صاحبَ الحساب)، وأن الشاشة تسم الحساب
// المحجوب قبل المحاولة. **وكل بندٍ منهما يجب أن يسقط قبل إصلاحه** — وقد سقط.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mailblock-'));
process.env.SANAD_DB = join(dir, 't.db');
// الحارس مفعَّل بقائمة عناوين — نفس شكل البيئة الحيّة تماماً. والبريد معرّفُ دخولٍ فريد،
// فلكل حسابٍ عنوانه: واحدٌ داخل القائمة وآخر خارجها.
process.env.MAIL_TRANSPORT = 'smtp';
process.env.SANAD_MAIL_ALLOWLIST = 'allowed@evc.sa,ok@evc.sa';
delete process.env.SANAD_MAIL_UNRESTRICTED;
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, identity, otp, transport;
const T = '2026-08-04T09:00:00Z';
const ADMIN = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', sector_id: null };
const CTX = { user: ADMIN, ip: '1' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  identity = await import('../../src/modules/identity/identity.js');
  otp = await import('../../src/core/auth/otp.js');
  transport = await import('../../src/core/mail/transport.js');

  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin',
    scope: 'company', email: 'allowed@evc.sa', active: 1, created_at: T });
  // موظفٌ نشط وبريده مكتوب — ويبدو سليماً تماماً. لكن عنوانه خارج قائمة الإرسال.
  await db.insert('app_user', { id: 'u_blocked', username: null, name_ar: 'عبدالرحمن خالد', role_id: 'employee',
    scope: 'own', email: 'outside@evc.sa', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_ok', username: null, name_ar: 'موظف داخل القائمة', role_id: 'employee',
    scope: 'own', email: 'ok@evc.sa', active: 1, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('حارس المستقبِلين يفصل المسموح عن المحجوب — وقائمةٌ لا تشمل العنوان تعني حجباً لا تأخيراً', () => {
  assert.deepEqual(transport.filterRecipients(['allowed@evc.sa']), { allowed: ['allowed@evc.sa'], blocked: [] });
  assert.deepEqual(transport.filterRecipients(['outside@evc.sa']), { allowed: [], blocked: ['outside@evc.sa'] });
});

test('طلب الرمز لعنوانٍ خارج القائمة يُحجب ويُكتب في سجل البريد بسببه — لا «أُرسلت» كاذبة', async () => {
  const r = await otp.requestCode({ email: 'outside@evc.sa', ip: '1' });
  assert.equal(r.delivered, false, 'لم تغادر الرسالة');
  assert.match(r.reason || '', /قائمة العناوين المسموح بها/, 'والسبب مذكور نصّاً لا رمزاً');
  const log = await db.get("SELECT event, detail FROM email_log ORDER BY at DESC LIMIT 1");
  assert.equal(log.event, 'blocked', 'الحالة «محجوبة» لا «أُرسلت» — وهذا ما يجعل السجل صادقاً');
  assert.match(log.detail, /outside@evc\.sa/);
  assert.match(log.detail, /قائمة العناوين المسموح بها/);
});

test('ومسار الدخول العام لا يُفشي شيئاً: نفس الردّ لبريدٍ مسجَّل وآخر لا وجود له', async () => {
  const known = await otp.requestCode({ email: 'outside@evc.sa', ip: '1' });
  const ghost = await otp.requestCode({ email: 'nobody@evc.sa', ip: '1' });
  assert.equal(known.ok, true); assert.equal(ghost.ok, true);
  // الشاشة تقرأ `ok` وحدها — والسبب موجود للمُنادي الإداري ولا يُعرض في شاشة الدخول.
  assert.equal(known.delivered, false); assert.equal(ghost.delivered, false);
});

test('ومدير النظام يعرف السبب حين يضغط «إرسال رمز» — لا يُحال إلى شاشةٍ أخرى', async () => {
  const r = await identity.resendInvite(CTX, 'u_blocked');
  assert.equal(r.delivered, false);
  assert.match(r.reason || '', /قائمة العناوين المسموح بها/,
    'كانت الشاشة تقول «راجع مركز البريد» فيقطع المدير رحلةً ليقرأ سطراً واحداً');
  const aud = await db.get(
    "SELECT detail_json FROM audit_log WHERE resource = 'app_user' AND resource_id = 'u_blocked' ORDER BY at DESC LIMIT 1");
  assert.match(String(aud.detail_json), /لم تغادر الرسالة/, 'والأثر يحفظ السبب كذلك');
});

test('والعنوان المسموح يمرّ — فالحجب ليس عطلاً عامّاً في القناة', async () => {
  const r = await identity.resendInvite(CTX, 'u_ok').catch((e) => ({ error: e.message }));
  // لا خادم بريد في الاختبار، فالإرسال يفشل بخطأ اتصال — والمهم أنه **لم يُحجب**: تجاوز الحارس.
  assert.ok(!/قائمة العناوين المسموح بها/.test(r.reason || ''), 'العنوان المسموح لا يُحجب');
});

test('وقائمة الحسابات تسم من لن يصله رمز — قبل أن يحاول صاحبه', async () => {
  const rows = await identity.listUsers(ADMIN, {});
  const blocked = rows.find((u) => u.id === 'u_blocked');
  const ok = rows.find((u) => u.id === 'u_ok');
  assert.equal(blocked.mail_blocked, true, 'الحساب المحجوب معلَّم');
  assert.equal(ok.mail_blocked, false, 'ومن عنوانه في القائمة ليس كذلك');
});

test('وشاشة إدارة الهوية تعرض التحذير على الصف نفسه — لا وعدٌ في الخدمة بلا موضعٍ يقرؤه أحد', async () => {
  const { usersPage } = await import('../../src/web/views/govern.js');
  const html = await usersPage(ADMIN);
  assert.match(html, /لن يصله رمز — عنوانه خارج قائمة الإرسال/);
  // والتحذير على صفّ المحجوب وحده: التقاطُ سطرِ الصفّ ثم التأكد أنه يحمل الاسم الصحيح.
  const row = html.split('data-uid="u_blocked"')[1].split('</tr>')[0];
  assert.match(row, /لن يصله رمز/, 'على صفّ عبدالرحمن');
  const okRow = html.split('data-uid="u_ok"')[1].split('</tr>')[0];
  assert.ok(!/لن يصله رمز/.test(okRow), 'ولا يظهر على من عنوانه مسموح — وإلا صار التحذير ضجيجاً');
});

// ── والوسم لا يعمّ حيث لا حارس ────────────────────────────────────────────────
// عيبٌ وقعتُ فيه وأسقطته الحزمة: حسبتُ الحجب من قائمة العناوين وحدها، فوُسِم **كل** حساب في
// بيئة التطوير (قناة المعاينة، والقائمة فارغة). وتحذيرٌ يعمّ يصير ضجيجاً يُتجاهَل، فحين يصدق
// يوماً لا يُصدَّق. والحارس لا يُطبَّق في قناة المعاينة أصلاً — الرسالة تُكتب على القرص لا تُرسَل.
test('في قناة المعاينة لا يُوسَم أحد — الحارس لا يعمل هناك، فالوسم يكذب', async () => {
  const { mailBlockedFor } = await import('../../src/core/mail/transport.js');
  const { config } = await import('../../src/core/config.js');
  assert.equal(config.mailTransport, 'smtp', 'هذا الملف يعمل بقناة الإرسال');
  assert.equal(mailBlockedFor('outside@evc.sa'), true, 'وفيها العنوان الخارج محجوب');
  // القناة نفسها هي الفارق — والوحدة تقرؤها من الإعداد لا من القائمة وحدها.
  const saved = config.mailTransport;
  config.mailTransport = 'preview';
  assert.equal(mailBlockedFor('outside@evc.sa'), false, 'وفي المعاينة لا حجب ولا وسم');
  config.mailTransport = saved;
});

test('ورفعُ الحارس صراحةً يرفع الوسم معه — لا تحذير بلا سبب', async () => {
  const { mailBlockedFor } = await import('../../src/core/mail/transport.js');
  const { config } = await import('../../src/core/config.js');
  const saved = config.mailUnrestricted;
  config.mailUnrestricted = true;
  assert.equal(mailBlockedFor('outside@evc.sa'), false);
  config.mailUnrestricted = saved;
});
