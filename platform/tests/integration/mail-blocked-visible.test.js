// ── لماذا لا يصل رمز الدخول، ومن يعرف السبب ─────────────────────────────────
//
// «عبدالرحمن طلب الرمز وحسابه مفعّل وما وصله» ثم «حسين الجفري طلب وما وصله كمان» — وسؤال
// المالك بعدهما: «كيف ممكن يكون في طريقة يتحدّث دائماً».
//
// وكانت العلّة ثلاثاً لا واحدة، وكلها مُثبَتة من البيانات الحيّة:
//  ① قائمة المستقبِلين تُكتب باليد وتُقرأ مرةً عند الإقلاع، فكل حسابٍ جديد محجوبٌ حتى يتذكّر
//    أحدٌ أن يكتب عنوانه **ويعيد تشغيل الخدمة**. (عبدالرحمن: أربع محاولات كلها «حُجبت».)
//  ② طلبُ **دخولٍ** لحسابٍ ينتظر التفعيل كان يسقط في فرعٍ صامت: لا رسالة ولا سطر ولا سبب.
//    (حسين: حسابه «دعوة معلّقة» وبريده صحيحٌ ومسموح — ولا أثر له في السجل إطلاقاً.)
//  ③ والفرع الصامت لا يترك أثراً، فيفتح المدير مركز البريد فلا يجد شيئاً — والصمت أسوأ من
//    الحجب: مع الحجب يُعرَف السبب، ومع الصمت لا يُعرَف حتى أن أحداً حاول.
//
// **وكل بندٍ هنا سقط قبل إصلاحه.**
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mailblock-'));
process.env.SANAD_DB = join(dir, 't.db');
// قناة الإرسال مفعَّلة والحارس عامل — نفس شكل البيئة الحيّة. والقائمة اليدوية فيها عنوانٌ
// واحد ليس حساباً في المنصة، فيُثبت أن المصدرين يعملان معاً لا أحدهما.
process.env.MAIL_TRANSPORT = 'smtp';
process.env.SANAD_MAIL_ALLOWLIST = 'owner.personal@gmail.com';
delete process.env.SANAD_MAIL_UNRESTRICTED;
delete process.env.SANAD_MAIL_ACCOUNTS_ALLOWED;
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, identity, otp, transport, accounts, config;
const T = '2026-08-04T09:00:00Z';
const ADMIN = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', sector_id: null };
const CTX = { user: ADMIN, ip: '1' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  identity = await import('../../src/modules/identity/identity.js');
  otp = await import('../../src/core/auth/otp.js');
  transport = await import('../../src/core/mail/transport.js');
  accounts = await import('../../src/core/mail/accounts.js');
  ({ config } = await import('../../src/core/config.js'));

  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin',
    scope: 'company', email: 'admin@evc.sa', active: 1, created_at: T });
  // «عبدالرحمن»: نشط وبريده مكتوب وليس في القائمة اليدوية — وكان هذا وحده يكفي لحجبه.
  await db.insert('app_user', { id: 'u_active', username: null, name_ar: 'عبدالرحمن خالد', role_id: 'employee',
    scope: 'own', email: 'abdulrahman@evc.sa', active: 1, created_at: T });
  // «حسين»: حسابه ينتظر التفعيل ولم يُغلق عليه.
  await db.insert('app_user', { id: 'u_pending', username: null, name_ar: 'حسين الجفري', role_id: 'employee',
    scope: 'own', email: 'hussien@evc.sa', active: 0, created_at: T });
  // وحسابٌ أُغلق عليه عمداً — الفرق بينه وبين المنتظِر ختمُ التعطيل.
  await db.insert('app_user', { id: 'u_off', username: null, name_ar: 'حساب مُغلق', role_id: 'employee',
    scope: 'own', email: 'closed@evc.sa', active: 0, deactivated_at: T, created_at: T });
  await accounts.refreshAccountEmails({ force: true });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── ① القائمة تتحدّث بنفسها ─────────────────────────────────────────────────
test('حساب المنصة مسموحٌ بحكم وجوده — والقائمة اليدوية تبقى عاملةً فوقه لا بدلاً منه', () => {
  assert.deepEqual(transport.filterRecipients(['abdulrahman@evc.sa']).blocked, [], 'حسابٌ في المنصة');
  assert.deepEqual(transport.filterRecipients(['owner.personal@gmail.com']).blocked, [], 'وعنوانٌ في القائمة اليدوية');
  assert.deepEqual(transport.filterRecipients(['legacy@old-client.com']).allowed, [],
    'وعنوانٌ ليس هذا ولا ذاك يبقى محجوباً — وهو ما بُني الحارس له');
});

test('وحسابٌ يُنشأ الآن يصله الرمز بلا كتابةٍ يدوية ولا إعادة تشغيل', async () => {
  await db.insert('app_user', { id: 'u_fresh', name_ar: 'موظف جديد', role_id: 'employee',
    scope: 'own', email: 'fresh@evc.sa', active: 1, created_at: T });
  await accounts.refreshAccountEmails({ force: true });
  assert.equal(transport.mailBlockedFor('fresh@evc.sa'), false,
    'كان يبقى محجوباً حتى يتذكّر أحدٌ أن يكتب عنوانه ويعيد تشغيل الخدمة');
});

test('والحساب المُغلق عليه عمداً لا يُفتح له بريد — تعطيلٌ يترك بريده مفتوحاً ليس تعطيلاً', async () => {
  await accounts.refreshAccountEmails({ force: true });
  assert.equal(transport.mailBlockedFor('closed@evc.sa'), true);
});

test('ويُطفأ الاشتقاق صراحةً فتعود القائمة المغلقة باليد وحدها — القرار بيد المُشغّل', async () => {
  const saved = config.mailAccountsAllowed;
  config.mailAccountsAllowed = false;
  await accounts.refreshAccountEmails({ force: true });
  assert.equal(transport.mailBlockedFor('abdulrahman@evc.sa'), true, 'الحسابات لم تعد مصدر سماح');
  assert.equal(transport.mailBlockedFor('owner.personal@gmail.com'), false, 'والقائمة اليدوية باقية');
  config.mailAccountsAllowed = saved;
  await accounts.refreshAccountEmails({ force: true });
});

// ── ② المدعوّ يستطيع تفعيل حسابه من شاشة الدخول ─────────────────────────────
test('حسابٌ ينتظر التفعيل يُرسَل له رمز تفعيل عند طلبه الدخول — لا صمت', async () => {
  const before = Number((await db.get('SELECT COUNT(*) n FROM login_code WHERE user_id = ?', ['u_pending'])).n);
  await otp.requestCode({ email: 'hussien@evc.sa', ip: '1' });   // غرضه «دخول» كما تفعل الشاشة
  const after = Number((await db.get('SELECT COUNT(*) n FROM login_code WHERE user_id = ?', ['u_pending'])).n);
  assert.equal(after, before + 1, 'صدر له رمز — وكان لا يصدر شيء إطلاقاً');
  const lc = await db.get('SELECT purpose FROM login_code WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', ['u_pending']);
  assert.equal(lc.purpose, 'invite', 'ورمزُ تفعيل لا رمزُ دخول — النصّ يقول له ما يفعل به');
  const log = await db.get('SELECT detail FROM email_log ORDER BY at DESC LIMIT 1');
  assert.match(log.detail, /رمز تفعيل إلى hussien@evc\.sa/, 'وله أثرٌ في مركز البريد');
});

// ── ③ لا فرع صامت ──────────────────────────────────────────────────────────
test('والمُغلق عليه عمداً يبقى ممنوعاً — والمحاولة تُسجَّل بدل أن تُبتلع صامتة', async () => {
  const before = Number((await db.get('SELECT COUNT(*) n FROM login_code WHERE user_id = ?', ['u_off'])).n);
  await otp.requestCode({ email: 'closed@evc.sa', ip: '1' });
  const after = Number((await db.get('SELECT COUNT(*) n FROM login_code WHERE user_id = ?', ['u_off'])).n);
  assert.equal(after, before, 'لا رمز للمُغلق عليه');
  const log = await db.get('SELECT event, detail FROM email_log ORDER BY at DESC LIMIT 1');
  assert.equal(log.event, 'failed');
  assert.match(log.detail, /الحساب مُغلق عليه/, 'والمدير يقرأ أن محاولةً وقعت ولماذا رُدّت');
});

// وحدٌّ قائم لا يُنقَض: بريدٌ لا حساب له يبقى صامتاً. سطرٌ لكل عنوان يُطلَب له رمز يجعل السجلّ
// نفسه قابلاً للاستكشاف، ويسمح بإغراقه بعناوين مختلقة حتى تُدفن فيه الأحداث الحقيقية.
test('وبريدٌ لا حساب له يبقى صامتاً — لا أثر يكشف من له حساب ولا يُغرَق به السجل', async () => {
  const before = Number((await db.get('SELECT COUNT(*) n FROM email_log')).n);
  await otp.requestCode({ email: 'ghost@evc.sa', ip: '1' });
  const after = Number((await db.get('SELECT COUNT(*) n FROM email_log')).n);
  assert.equal(after, before, 'كُتب أثرٌ لبريدٍ لا حساب له');
  const audits = await db.all("SELECT id FROM audit_log WHERE detail_json LIKE '%ghost@evc.sa%'");
  assert.equal(audits.length, 0, 'ذُكر البريد المجهول في سجل التدقيق');
});

// ومن دخل من قبل ثم أُوقف حسابُه موقوفٌ فعلاً لا منتظِر — ودعوتُه تعيد فتح بابٍ أُغلق عمداً.
test('ومن دخل ثم أُوقف لا يُدعى — «ينتظر التفعيل» يشترط ألّا يكون دخل قط', async () => {
  await db.insert('app_user', { id: 'u_was_in', name_ar: 'دخل ثم أُوقف', role_id: 'employee', scope: 'own',
    email: 'wasin@evc.sa', active: 0, last_login_at: T, created_at: T });
  await accounts.refreshAccountEmails({ force: true });
  const before = Number((await db.get('SELECT COUNT(*) n FROM login_code WHERE user_id = ?', ['u_was_in'])).n);
  await otp.requestCode({ email: 'wasin@evc.sa', ip: '1' });
  const after = Number((await db.get('SELECT COUNT(*) n FROM login_code WHERE user_id = ?', ['u_was_in'])).n);
  assert.equal(after, before, 'لا رمز لمن أُوقف بعد أن كان يدخل');
});

test('ومسار الدخول العام لا يُفشي شيئاً: نفس الردّ لبريدٍ مسجَّل وآخر لا وجود له', async () => {
  const known = await otp.requestCode({ email: 'closed@evc.sa', ip: '1' });
  const ghost = await otp.requestCode({ email: 'nobody@evc.sa', ip: '1' });
  assert.deepEqual(known, ghost, 'الردّان متطابقان حرفاً بحرف — ولا خانةَ سببٍ تجعل الفرق قابلاً للقياس');
});

// ── ④ والمدير يعرف السبب حين يضغط الزرّ ────────────────────────────────────
test('زرّ «إرسال رمز» يقول السبب في مكانه — لا يُحال إلى شاشةٍ أخرى', async () => {
  const r = await identity.resendInvite(CTX, 'u_active');
  assert.equal(r.delivered, false, 'لا خادم بريد في الاختبار فالإرسال يفشل');
  assert.ok(r.reason && r.reason.length > 5, 'والسبب يعود مع الردّ لا «راجع مركز البريد»');
  const aud = await db.get(
    "SELECT detail_json FROM audit_log WHERE resource = 'app_user' AND resource_id = 'u_active' ORDER BY at DESC LIMIT 1");
  assert.match(String(aud.detail_json), /لم تغادر الرسالة/, 'والأثر يحفظ السبب كذلك');
});

// ── ⑤ الوسم على الشاشة: يظهر حيث يصدق فقط ──────────────────────────────────
test('قائمة الحسابات تسم من لن يصله رمز — والمُغلق عليه وحده هنا', async () => {
  const rows = await identity.listUsers(ADMIN, {});
  assert.equal(rows.find((u) => u.id === 'u_off').mail_blocked, true, 'المُغلق عليه لا يصله شيء');
  assert.equal(rows.find((u) => u.id === 'u_active').mail_blocked, false, 'والحساب النشط صار مسموحاً بحكم وجوده');
  assert.equal(rows.find((u) => u.id === 'u_pending').mail_blocked, false, 'والمنتظِر كذلك — ورمزُه رمزُ تفعيل');
});

test('وشاشة إدارة الهوية تعرض التحذير على صفّه وحده — لا وعدٌ في الخدمة بلا موضعٍ يقرؤه أحد', async () => {
  const { usersPage } = await import('../../src/web/views/govern.js');
  const html = await usersPage(ADMIN);
  const rowOf = (uid) => (html.split(`data-uid="${uid}"`)[1] || '').split('</tr>')[0];
  assert.match(rowOf('u_off'), /لن يصله رمز — عنوانه خارج قائمة الإرسال/);
  assert.ok(!/لن يصله رمز/.test(rowOf('u_active')), 'ولا يظهر على النشط — وإلا صار التحذير ضجيجاً');
  assert.ok(!/لن يصله رمز/.test(rowOf('u_pending')), 'ولا على المنتظِر');
});

// ── وعيبٌ وقعتُ فيه وأسقطته الحزمة ─────────────────────────────────────────
// حسبتُ الحجب من القائمة وحدها، فوُسم **كل** حساب في بيئة التطوير — والحارس لا يُطبَّق في قناة
// المعاينة أصلاً (الرسالة تُكتب على القرص لا تُرسَل). وتحذيرٌ يعمّ يصير ضجيجاً يُتجاهَل، فحين
// يصدق يوماً لا يُصدَّق.
test('في قناة المعاينة لا يُوسَم أحد — الحارس لا يعمل هناك، فالوسم يكذب', () => {
  assert.equal(config.mailTransport, 'smtp', 'هذا الملف يعمل بقناة الإرسال');
  assert.equal(transport.mailBlockedFor('legacy@old-client.com'), true, 'وفيها العنوان الغريب محجوب');
  const saved = config.mailTransport;
  config.mailTransport = 'preview';
  assert.equal(transport.mailBlockedFor('legacy@old-client.com'), false, 'وفي المعاينة لا حجب ولا وسم');
  config.mailTransport = saved;
});

test('ورفعُ الحارس صراحةً يرفع الوسم معه — لا تحذير بلا سبب', () => {
  const saved = config.mailUnrestricted;
  config.mailUnrestricted = true;
  assert.equal(transport.mailBlockedFor('legacy@old-client.com'), false);
  config.mailUnrestricted = saved;
});
