// الدخول برمز البريد (core/auth/otp.js). كل حالة هنا بابٌ لو بقي مفتوحاً لَفُتح الحساب:
// رمزٌ يُستعمل مرتين، رمزُ غيرك، رمزٌ ميّت، تخمينٌ بلا سقف، وإفشاءُ من له حساب في EVC.
// والرمز نفسه يجب ألا يكون مقروءاً في قاعدة البيانات — وإلا فنسخةٌ احتياطية واحدة تكفي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-otp.db');
process.env.SANAD_DB = TEST_DB;
process.env.MAIL_TRANSPORT = 'preview';

let db, otp, hashPassword, ids;
const USER = 'u_otp_test', EMAIL = 'otp.tester@evc.sa';
const OTHER = 'u_otp_other', OTHER_EMAIL = 'otp.other@evc.sa';
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

// يزرع رمزاً معلوماً مباشرةً: الاختبارات الحتمية تحتاج أن تعرف الرمز، والخدمة لا تُرجعه عمداً.
async function plantCode(userId, code, { minutes = 10, purpose = 'signin', attempts = 0 } = {}) {
  const cid = ids.id('lc');
  await db.run('UPDATE login_code SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL', [ids.nowIso(), userId]);
  await db.insert('login_code', {
    id: cid, user_id: userId, code_hash: hashPassword(code), purpose, attempts,
    expires_at: new Date(Date.now() + minutes * 60000).toISOString(), ip: '127.0.0.1', created_at: ids.nowIso(),
  });
  return cid;
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
  for (const [uid, mail] of [[USER, EMAIL], [OTHER, OTHER_EMAIL]]) {
    await db.insert('app_user', {
      id: uid, username: uid, email: mail, name_ar: 'مُختبِر', scope: 'own',
      active: 1, must_change_pw: 0, failed_attempts: 0, created_at: ids.nowIso(),
    });
  }
});

after(async () => { await db.close(); wipe(); });

test('الرمز لا يُخزَّن نصاً — لا في عموده ولا في أي عمود آخر', async () => {
  await plantCode(USER, '424242');
  const rows = await db.all('SELECT * FROM login_code WHERE user_id = ?', [USER]);
  assert.equal(rows.length >= 1, true);
  for (const r of rows) {
    for (const v of Object.values(r)) {
      assert.equal(String(v ?? '').includes('424242'), false, 'الرمز ظهر نصاً في القاعدة');
    }
  }
  assert.ok(String(rows.at(-1).code_hash).startsWith('scrypt$'));
});

test('الرمز الصحيح يفتح جلسة، ثم لا يُقبل مرة ثانية', async () => {
  await plantCode(USER, '111111');
  const ok = await otp.verifyCode({ email: EMAIL, code: '111111', ip: '127.0.0.1' });
  assert.equal(ok.ok, true);
  assert.ok(ok.sessionId);
  const again = await otp.verifyCode({ email: EMAIL, code: '111111', ip: '127.0.0.1' });
  assert.equal(again.ok, false);
  assert.equal(again.reason, otp.REASON.EXPIRED);
});

test('طلبان متزامنان على الرمز نفسه — واحدٌ فقط يظفر به', async () => {
  await plantCode(USER, '222222');
  const results = await Promise.all(
    Array.from({ length: 8 }, () => otp.verifyCode({ email: EMAIL, code: '222222', ip: '127.0.0.1' })));
  const won = results.filter((r) => r.ok);
  assert.equal(won.length, 1, `ظفر ${won.length} من الطلبات بالرمز — المزلاج لا يعمل`);
  assert.equal(new Set(won.map((r) => r.sessionId)).size, 1);
});

test('الرمز المنتهي يُرفض بسبب «انتهت صلاحيته» لا «غير صحيح»', async () => {
  await plantCode(USER, '333333', { minutes: -1 });
  const r = await otp.verifyCode({ email: EMAIL, code: '333333', ip: '127.0.0.1' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, otp.REASON.EXPIRED);
});

test('رمز مستخدم آخر لا يفتح حسابك', async () => {
  await plantCode(OTHER, '444444');
  const r = await otp.verifyCode({ email: EMAIL, code: '444444', ip: '127.0.0.1' });
  assert.equal(r.ok, false);
  // ورمز صاحبه يعمل — فالرفض بسبب الملكية لا لعطلٍ عام
  const own = await otp.verifyCode({ email: OTHER_EMAIL, code: '444444', ip: '127.0.0.1' });
  assert.equal(own.ok, true);
});

test('خمس محاولات خاطئة تحرق الرمز — فلا يُخمَّن مليونُ احتمال', async () => {
  await plantCode(USER, '555555');
  for (let i = 0; i < otp.OTP_MAX_ATTEMPTS; i++) {
    const r = await otp.verifyCode({ email: EMAIL, code: '000000', ip: '127.0.0.1' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, otp.REASON.INVALID);
  }
  // السادسة تُردّ بسبب استنفاد المحاولات، والرمز الصحيح نفسه لم يعد يعمل
  const burned = await otp.verifyCode({ email: EMAIL, code: '000000', ip: '127.0.0.1' });
  assert.equal(burned.reason, otp.REASON.ATTEMPTS);
  const correct = await otp.verifyCode({ email: EMAIL, code: '555555', ip: '127.0.0.1' });
  assert.equal(correct.ok, false, 'الرمز الصحيح عمل بعد استنفاد المحاولات');
});

test('طلب رمز جديد يُبطل السابق — فلا يبقى بابان مفتوحان', async () => {
  await plantCode(USER, '666666');
  await otp.requestCode({ email: EMAIL, ip: '127.0.0.1' });
  const r = await otp.verifyCode({ email: EMAIL, code: '666666', ip: '127.0.0.1' });
  assert.equal(r.ok, false);
});

test('بريد غير مسجَّل: نفس الردّ تماماً، وبلا أي أثر في الجدول', async () => {
  const before = (await db.all('SELECT id FROM login_code')).length;
  const r = await otp.requestCode({ email: 'ghost@evc.sa', ip: '127.0.0.1' });
  assert.deepEqual(r, { ok: true, delivered: false });
  const known = await otp.requestCode({ email: EMAIL, ip: '127.0.0.1' });
  assert.equal(known.ok, r.ok, 'اختلف الردّ بين بريد مسجَّل وغير مسجَّل');
  const rows = await db.all('SELECT user_id FROM login_code');
  assert.equal(rows.length, before + 1, 'أُنشئ رمز لبريد لا حساب له');
});

test('البريد لا يفرّق بين كبير الأحرف وصغيره ولا تُربكه المسافات', async () => {
  await plantCode(USER, '777777');
  const r = await otp.verifyCode({ email: '  OTP.Tester@EVC.SA ', code: '777777', ip: '127.0.0.1' });
  assert.equal(r.ok, true);
});

test('الحساب الموقوف لا يصله رمز دخول', async () => {
  await db.run('UPDATE app_user SET active = 0 WHERE id = ?', [USER]);
  const before = (await db.all('SELECT id FROM login_code')).length;
  const r = await otp.requestCode({ email: EMAIL, ip: '127.0.0.1' });
  assert.equal(r.ok, true);            // الردّ نفسه — لا يُفشى أن الحساب موقوف
  assert.equal((await db.all('SELECT id FROM login_code')).length, before, 'أُنشئ رمز لحساب موقوف');
  await db.run('UPDATE app_user SET active = 1 WHERE id = ?', [USER]);
});

test('رمز الدعوة يفعّل الحساب الموقوف — وهو الاستثناء الوحيد', async () => {
  await db.run('UPDATE app_user SET active = 0 WHERE id = ?', [OTHER]);
  await plantCode(OTHER, '888888', { purpose: 'invite' });
  const r = await otp.verifyCode({ email: OTHER_EMAIL, code: '888888', ip: '127.0.0.1' });
  assert.equal(r.ok, true);
  const u = await db.get('SELECT active, last_login_method FROM app_user WHERE id = ?', [OTHER]);
  assert.equal(Number(u.active), 1);
  assert.equal(u.last_login_method, 'otp');
});

// نموذجُ الدخول صفحةٌ لا واجهةَ برمجية: من يرسله متصفّحٌ ينتظر صفحة. وربطُ التحقق بدلو كلمة
// المرور كان يُسقطه إلى ٤٢٩ بحمولة خام لأن تحويلة ذاك الدلو مشروطة بمساره — فيرى الموظف نصاً
// تقنياً بين أقواس معقوفة مكان صفحة الدخول، وهو نفس العيب المُصلَح سابقاً في مسار كلمة المرور.
test('تجاوز حدّ التحقق يُعيد إلى صفحة الدخول لا إلى حمولة خام', async () => {
  const { otpVerifyLimiter } = await import('../../src/core/http/security.js');
  const seen = { redirect: null, json: null, status: null };
  const res = {
    setHeader() {}, redirect(to) { seen.redirect = to; },
    status(c) { seen.status = c; return this; }, json(b) { seen.json = b; },
  };
  // نستنزف الدلو ثم نطلب مرة أخرى
  let passed = 0;
  for (let i = 0; i < 40; i++) {
    await new Promise((done) => otpVerifyLimiter({ ip: '9.9.9.9', body: {}, cookies: {} }, res, () => { passed++; done(); }) || done());
    if (seen.redirect || seen.json) break;
  }
  assert.ok(passed > 0, 'الدلو منع الطلب الأول — الحدّ أضيق مما ينبغي');
  assert.equal(seen.json, null, 'رُدَّت حمولة خام على نموذج صفحة');
  assert.equal(seen.redirect, '/login?e=2', 'لم يُعَد المتصفّح إلى صفحة الدخول');
});

test('تنظيف الرموز المنتهية يمسح القديم ويُبقي الحيّ', async () => {
  await db.insert('login_code', {
    id: ids.id('lc'), user_id: USER, code_hash: hashPassword('999999'), purpose: 'signin',
    expires_at: new Date(Date.now() - 48 * 3600000).toISOString(), attempts: 0, ip: null, created_at: ids.nowIso(),
  });
  await plantCode(USER, '101010');
  const { removed } = await otp.purgeExpiredCodes(24);
  assert.ok(removed >= 1);
  const live = await otp.verifyCode({ email: EMAIL, code: '101010', ip: '127.0.0.1' });
  assert.equal(live.ok, true, 'التنظيف مسح رمزاً حياً');
});
