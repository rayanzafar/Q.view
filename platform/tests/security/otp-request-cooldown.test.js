// مهلةُ تكرار طلب الرمز (KI-090). الواقعة: ثلاث ضغطات على «أرسل رمز الدخول» في إحدى عشرة ثانية
// (2026-08-30) — فثلاث رسائل متطابقة، وكلُّ واحدةٍ تُبطل رمزَ ما قبلها، فمن جرّب رمزَ أول رسالةٍ
// وصلته وجده ميّتاً فأعاد الطلب، والدائرة تدور. العلاج المفحوص هنا: طلبٌ ثانٍ خلال المهلة
// لا يُرسل رسالةً ولا يُبطل الرمز الحيّ — والشاشةُ تعِد بما يفعله الخادم لا بغيره.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-otp-cooldown.db');
process.env.SANAD_DB = TEST_DB;
process.env.MAIL_TRANSPORT = 'preview';

let db, otp, hashPassword, ids;
const USER = 'u_cooldown_test', EMAIL = 'cooldown.tester@evc.sa';
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

async function plantCode(userId, code) {
  const cid = ids.id('lc');
  await db.run('UPDATE login_code SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL', [ids.nowIso(), userId]);
  await db.insert('login_code', {
    id: cid, user_id: userId, code_hash: hashPassword(code), purpose: 'signin', attempts: 0,
    expires_at: new Date(Date.now() + 10 * 60000).toISOString(), ip: '127.0.0.1', created_at: ids.nowIso(),
  });
  return cid;
}

const liveCodes = () => db.all(
  'SELECT id, created_at FROM login_code WHERE user_id = ? AND consumed_at IS NULL', [USER]);
const countLog = async () => Number((await db.get('SELECT COUNT(*) n FROM email_log')).n);

async function ageLiveCodes() {
  const aged = new Date(Date.now() - (otp.OTP_REQUEST_COOLDOWN_SECONDS + 1) * 1000).toISOString();
  await db.run('UPDATE login_code SET created_at = ? WHERE user_id = ? AND consumed_at IS NULL', [aged, USER]);
}

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  ids = await import('../../src/core/util/ids.js');
  ({ hashPassword } = await import('../../src/core/auth/password.js'));
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  otp = await import('../../src/core/auth/otp.js');
  await db.insert('app_user', {
    id: USER, username: USER, email: EMAIL, name_ar: 'مُختبِر المهلة', scope: 'own',
    active: 1, must_change_pw: 0, failed_attempts: 0, created_at: ids.nowIso(),
  });
});

after(async () => { await db.close(); wipe(); });

test('الطلب الثاني خلال المهلة: لا رسالة جديدة، ولا إبطال للرمز الحيّ', async () => {
  await otp.requestCode({ email: EMAIL, ip: '127.0.0.1' });
  const [first] = await liveCodes();
  assert.ok(first, 'الطلب الأول لم يُنشئ رمزاً');
  const logs = await countLog();

  const again = await otp.requestCode({ email: EMAIL, ip: '127.0.0.1' });
  assert.equal(again.ok, true);
  assert.equal(again.suppressed, true, 'الطلب المكرَّر عومل كطلبٍ جديد');
  const nowLive = await liveCodes();
  assert.equal(nowLive.length, 1, 'صار للمستخدم أكثر من رمز حيّ');
  assert.equal(nowLive[0].id, first.id, 'أُبدل الرمز الحيّ رغم المهلة');
  assert.equal(await countLog(), logs, 'خرجت رسالةٌ ثانية خلال المهلة');
});

test('والصمت ليس عودةً إلى العتمة: الطلب المكبوح يترك سطراً في سجل التدقيق', async () => {
  const rows = await db.all(
    "SELECT detail_json FROM audit_log WHERE resource = 'login_code' AND detail_json LIKE '%لم تُرسَل رسالة جديدة%'");
  assert.ok(rows.length >= 1, 'الطلب المكبوح صامتٌ في السجل — وهذا الصمت هو ما أعمى التشخيص من قبل');
});

test('ورمز الرسالة التي وصلت فعلاً يفتح الباب بعد ضغطةٍ مكرَّرة — لا «انتهت صلاحيته»', async () => {
  await plantCode(USER, '424242');
  const again = await otp.requestCode({ email: EMAIL, ip: '127.0.0.1' });
  assert.equal(again.suppressed, true);
  const r = await otp.verifyCode({ email: EMAIL, code: '424242', ip: '127.0.0.1' });
  assert.equal(r.ok, true, 'الضغطة المكرَّرة أماتت رمزَ الرسالة الواصلة — وهذا عينُ العيب المُصلَح');
});

test('وبعد انقضاء المهلة يعود الأصل: رمزٌ جديد يُرسَل ويُبطل السابق', async () => {
  const planted = await plantCode(USER, '535353');
  await ageLiveCodes();
  const logs = await countLog();
  const r = await otp.requestCode({ email: EMAIL, ip: '127.0.0.1' });
  assert.equal(r.suppressed, undefined, 'طلبٌ خارج المهلة عومل كمكرَّر');
  assert.equal(await countLog(), logs + 1, 'لم تخرج رسالة رغم انقضاء المهلة');
  const old = await db.get('SELECT consumed_at FROM login_code WHERE id = ?', [planted]);
  assert.ok(old.consumed_at, 'الرمز السابق بقي حياً مع الجديد — بابان مفتوحان');
});

// ── مسار شاشة الهوية: الدعوة وإعادةُ الإرسال ──
// مدير نظامٍ يدعو موظفاً ثم يضغط «إعادة إرسال» خلال لحظات: تُكبح الرسالة، والسجل يقولها
// صراحةً لا «أُعيد الإرسال» — فسجلٌّ يشهد بإرسالٍ لم يقع هو عينُ الكذب الذي يمنع التشخيص.
test('دعوةٌ ثم إعادةُ إرسالٍ خلال المهلة: تُكبح، والسجل يقول الحقيقة بصنف الرمز الصحيح', async () => {
  const identity = await import('../../src/modules/identity/identity.js');
  await db.insert('app_user', {
    id: 'u_cd_admin', username: 'cd.admin', email: 'cd.admin@evc.sa', name_ar: 'مدير الفحص',
    role_id: 'admin', scope: 'company', active: 1, must_change_pw: 0, failed_attempts: 0, created_at: ids.nowIso(),
  });
  const ctx = { user: await db.get("SELECT * FROM app_user WHERE id = 'u_cd_admin'"), ip: '127.0.0.1' };

  const invited = await identity.inviteUser(ctx, {
    email: 'cd.invited@evc.sa', name_ar: 'مدعوّ الفحص', role_id: 'employee', scope: 'own',
  });
  assert.equal(invited.ok, true);
  const logs = await countLog();

  const r = await identity.resendInvite(ctx, invited.id);
  assert.equal(r.ok, true);
  assert.equal(r.delivered, true);
  assert.equal(await countLog(), logs, 'خرجت رسالةُ إعادة إرسالٍ خلال المهلة');
  // أثر الكبح من الخدمة الجوهرية — بصنف «تفعيل حساب» لا «دخول» (الحساب لم يُفعَّل بعد)
  const core = await db.all(
    "SELECT detail_json FROM audit_log WHERE resource = 'login_code' AND detail_json LIKE '%رمز تفعيل حساب مرةً أخرى%'");
  assert.ok(core.length >= 1, 'كبحُ رمز الدعوة لم يُسجَّل بصنفه');
  // وأثر شاشة الهوية يقول ما وقع فعلاً — لا «إعادة إرسال» لم تحدث
  const honest = await db.all(
    "SELECT detail_json FROM audit_log WHERE resource = 'app_user' AND detail_json LIKE '%ما زال صالحاً%'");
  assert.ok(honest.length >= 1, 'شاشة الهوية سجّلت إعادةَ إرسالٍ لم تقع');
});

// تصحيحُ بريدٍ مخطوء: الرمز الحيّ ذهب إلى العنوان الخطأ، فيُحرق مع التغيير — وإلا كبحت
// المهلةُ إعادةَ الإرسال إلى العنوان الصحيح، وبقي في الصندوق الخطأ مفتاحُ دخولٍ صالح.
test('تغييرُ بريد الحساب يحرق رموزه الحيّة — وإعادةُ الإرسال بعده تُرسَل فوراً لا تُكبح', async () => {
  const identity = await import('../../src/modules/identity/identity.js');
  const ctx = { user: await db.get("SELECT * FROM app_user WHERE id = 'u_cd_admin'"), ip: '127.0.0.1' };
  const invited = await db.get("SELECT id FROM app_user WHERE email = 'cd.invited@evc.sa'");

  const liveBefore = await db.all(
    'SELECT id FROM login_code WHERE user_id = ? AND consumed_at IS NULL', [invited.id]);
  assert.ok(liveBefore.length === 1, 'لا رمز حيّ من الدعوة — الاختبار لا يفحص شيئاً');

  await identity.updateUser(ctx, invited.id, { email: 'cd.corrected@evc.sa' });
  const liveAfter = await db.all(
    'SELECT id FROM login_code WHERE user_id = ? AND consumed_at IS NULL', [invited.id]);
  assert.equal(liveAfter.length, 0, 'رمزُ العنوان القديم بقي حياً بعد تغيير البريد');

  const logs = await countLog();
  await identity.resendInvite(ctx, invited.id);
  assert.equal(await countLog(), logs + 1, 'كُبحت إعادةُ الإرسال إلى العنوان المصحَّح — لم تخرج رسالة');
});

// عدّاد «إرسال رمز جديد» في الشاشة يقرأ طوله من ثابت الخادم نفسه: لو افترقا لَظهر زرٌّ مفتوح
// يَعِد بإرسالٍ يرفضه الخادم بصمت — فالفحص يُثبت أن المصدر واحد.
test('شاشة الدخول: عدّاد إعادة الإرسال بطول مهلة الخادم، والنماذج محروسة من الضغط المزدوج', async () => {
  const { loginPage } = await import('../../src/web/views/auth.js');
  const html = loginPage({ step: 'code', email: EMAIL, csrf: 't' });
  const m = html.match(/n = (\d+);/);
  assert.ok(m, 'عدّاد إعادة الإرسال غائب عن خطوة الرمز');
  assert.equal(Number(m[1]), otp.OTP_REQUEST_COOLDOWN_SECONDS, 'عدّاد الشاشة يخالف مهلة الخادم');
  assert.match(html, /form\[data-busy\]/, 'حارس الضغط المزدوج غائب');
  for (const step of ['code', 'email']) {
    const page = loginPage({ step, email: EMAIL, csrf: 't', passwordEnabled: true });
    assert.ok(page.includes('data-busy='), `نماذج خطوة «${step}» بلا وسم انشغال`);
  }
});
