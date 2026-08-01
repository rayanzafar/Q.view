// القفل مؤقت — وكان دائماً. حجبُ خدمةٍ على موظفٍ بعينه بلا اختراق.
//
// العيب: `fail()` كانت تزيد العدّاد وتُجدّد ختم القفل مهما كان سبب الفشل — والقفل نفسه سببٌ
// منها. فكل طلبٍ يصل والحساب مقفول يُعيد الختم خمس عشرة دقيقة، **ولو كانت كلمة المرور صحيحة**
// (فحص القفل يسبق فحص كلمة المرور)، والعدّاد لا يُصفَّر إلا بدخولٍ ناجح متعذّر أثناء القفل.
// فطلبٌ واحد كل ربع ساعة يكفي لحجز أي حساب معلوم الاسم إلى الأبد — وأسماء المستخدمين معروضة
// في شاشة المستخدمين وسجل التدقيق. واكتُشف على staging: عشرة من حسابات العرض كانت مقفولة
// دائماً، وإعادةُ كتابة كلمات مرورها في كل إقلاع لا تُخرجها لأن القفل يُفحص قبل كلمة المرور.
//
// هذا الملف يثبّت الشرطين معاً، ولا يقيس أحدهما بالآخر: الحماية من التخمين باقية (ستّ خاطئات
// تقفل)، والقفل ينقضي فعلاً ولا يُجدَّد بمحاولةٍ أثناءه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-lock-'));
process.env.SANAD_DB = join(dir, 'l.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const db = await import('../../src/core/db/index.js');
const { login } = await import('../../src/core/auth/service.js');
const { hashPassword } = await import('../../src/core/auth/password.js');
const { config } = await import('../../src/core/config.js');

const PW = 'Correct-Horse-9';
const TS = '2026-07-01T00:00:00Z';
const mk = async (username) => {
  await db.insert('app_user', { id: 'u_' + username, username, name_ar: username, role_id: 'admin',
    scope: 'company', password_hash: hashPassword(PW), active: 1, created_at: TS });
};
const state = (username) => db.get('SELECT failed_attempts, locked_until FROM app_user WHERE username = ?', [username]);
const attempt = (username, password) => login({ username, password, ip: '127.0.0.1', userAgent: 'test' });

before(async () => {
  for (const n of ['lock.guess', 'lock.expire', 'lock.siege', 'lock.owner']) await mk(n);
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('الحماية من التخمين باقية: ست محاولات خاطئة تقفل الحساب', async () => {
  for (let i = 0; i < config.maxFailedAttempts; i++) {
    const r = await attempt('lock.guess', 'wrong-' + i);
    assert.equal(r.ok, false);
  }
  const s = await state('lock.guess');
  assert.equal(Number(s.failed_attempts), config.maxFailedAttempts);
  assert.ok(s.locked_until, 'وقد قُفل');
  assert.equal((await attempt('lock.guess', PW)).reason, 'locked', 'وكلمة المرور الصحيحة تُردّ أثناء القفل — وهذا مقصود');
});

test('النافذة تنقضي فعلاً: القفل المنتهي يُمحى وعدّاده يُصفَّر قبل أي حكم', async () => {
  await db.run('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE username = ?',
    [config.maxFailedAttempts, new Date(Date.now() - 60_000).toISOString(), 'lock.expire']);
  const r = await attempt('lock.expire', PW);
  assert.equal(r.ok, true, 'ختمٌ سقطت مدّته لا يمنع صاحبه — وإلا فالقفل ليس مؤقتاً');
  const s = await state('lock.expire');
  assert.equal(Number(s.failed_attempts), 0);
  assert.equal(s.locked_until, null);
});

test('المحاولة أثناء القفل لا تُجدّده — وهذا هو العيب الذي كان يجعله دائماً', async () => {
  const until = new Date(Date.now() + 60_000).toISOString();
  await db.run('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE username = ?',
    [config.maxFailedAttempts, until, 'lock.siege']);
  // ثلاث محاولات أثناء القفل — بكلمة مرور خاطئة وصحيحة معاً.
  for (const pw of ['wrong', PW, 'wrong']) {
    assert.equal((await attempt('lock.siege', pw)).reason, 'locked');
  }
  const s = await state('lock.siege');
  assert.equal(s.locked_until, until, 'الختم كما هو — لا دقيقةً واحدة أُضيفت');
  assert.equal(Number(s.failed_attempts), config.maxFailedAttempts, 'ولا عدّاد تحرّك');
});

test('الحصار المستمر لا يحجز أحداً إلى الأبد: النافذة تنقضي ولو طُرِق الحساب فيها', async () => {
  // هذا هو السيناريو الحقيقي: مهاجمٌ (أو مُختبِرٌ آلي) يطرق الحساب أثناء قفله، ثم يأتي صاحبه.
  await db.run('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE username = ?',
    [config.maxFailedAttempts, new Date(Date.now() + 50).toISOString(), 'lock.owner']);
  await attempt('lock.owner', 'siege-1');
  await attempt('lock.owner', 'siege-2');
  await new Promise((r) => setTimeout(r, 120)); // تنقضي النافذة
  const r = await attempt('lock.owner', PW);
  assert.equal(r.ok, true, 'صاحب الحساب يدخل بعد انقضاء نافذته — والطَّرق أثناءها لم يُمدّها');
  assert.ok(r.sessionId);
});

test('كل محاولة تترك أثراً في سجل الدخول — ولو رُدّت بالقفل', async () => {
  const n = (await db.get(
    "SELECT COUNT(*) c FROM login_history WHERE user_id = 'u_lock.siege' AND ok = 0")).c;
  assert.ok(Number(n) >= 3, '«حاول أحدٌ الدخول» واقعةٌ تُسجَّل — وإلا صار الحصار صامتاً');
});
