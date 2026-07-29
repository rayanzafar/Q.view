// إدارة الهوية (modules/identity). ثلاثة أبواب لو بقيت مفتوحة لَخرجت المنصة عن السيطرة:
// مديرٌ يعطّل نفسه فيقفل الباب خلفه، ونظامٌ يبقى بلا مدير نظام واحد، وتعطيلٌ يترك صاحبه
// داخلاً حتى تنتهي جلسته من تلقائها — أي إلى اثنتي عشرة ساعة بعد قرار المنع.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-identity.db');
process.env.SANAD_DB = TEST_DB;
process.env.MAIL_TRANSPORT = 'preview';

let db, ids, identity;
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

const ADMIN = 'u_idn_admin', ADMIN2 = 'u_idn_admin2', STAFF = 'u_idn_staff';
const ctxOf = (u) => ({ user: u, ip: '127.0.0.1' });
let adminUser, staffUser;

async function mkUser(id, { role = 'employee', email, active = 1, name = 'مُختبِر' } = {}) {
  await db.insert('app_user', {
    id, username: id, email, name_ar: name, role_id: role, scope: role === 'admin' ? 'company' : 'own',
    active, must_change_pw: 0, failed_attempts: 0, created_at: ids.nowIso(),
  });
  return await db.get('SELECT * FROM app_user WHERE id = ?', [id]);
}

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  ids = await import('../../src/core/util/ids.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  const { initRbac } = await import('../../src/core/rbac/index.js');
  await initRbac();
  identity = await import('../../src/modules/identity/identity.js');
  adminUser = await mkUser(ADMIN, { role: 'admin', email: 'admin.idn@evc.sa', name: 'مدير النظام' });
  staffUser = await mkUser(STAFF, { role: 'employee', email: 'staff.idn@evc.sa', name: 'موظف' });
});

after(async () => { await db.close(); wipe(); });

test('غير مدير النظام لا يرى الحسابات ولا يدعو أحداً', async () => {
  await assert.rejects(() => identity.listUsers(staffUser), /صلاحية مدير النظام/);
  await assert.rejects(() => identity.inviteUser(ctxOf(staffUser), {
    email: 'x@evc.sa', name_ar: 'س', role_id: 'employee',
  }), /صلاحية مدير النظام/);
});

test('الدعوة تُنشئ حساباً معطّلاً بلا كلمة مرور — ورمزاً واحداً بغرض التفعيل', async () => {
  const r = await identity.inviteUser(ctxOf(adminUser), {
    email: 'New.Hire@EVC.sa', name_ar: 'موظف جديد', role_id: 'consultant', scope: 'own',
  });
  assert.equal(r.ok, true);
  const u = await db.get('SELECT * FROM app_user WHERE id = ?', [r.id]);
  assert.equal(Number(u.active), 0, 'الحساب المدعوّ أُنشئ نشطاً قبل التفعيل');
  assert.equal(u.password_hash, null, 'أُنشئت كلمة مرور لحساب يُفترض أنه بلا كلمة مرور');
  assert.equal(u.email, 'new.hire@evc.sa', 'البريد لم يُطبَّع عند الحفظ');
  const codes = await db.all("SELECT purpose FROM login_code WHERE user_id = ? AND consumed_at IS NULL", [r.id]);
  assert.equal(codes.length, 1);
  assert.equal(codes[0].purpose, 'invite');
});

test('بريدٌ مستعمل لا يُنشئ حساباً ثانياً — ولو اختلفت حالة الأحرف', async () => {
  await assert.rejects(() => identity.inviteUser(ctxOf(adminUser), {
    email: 'NEW.HIRE@evc.SA', name_ar: 'مكرّر', role_id: 'employee',
  }), /مرتبط بحساب/);
});

test('التعطيل يُنهي الجلسات القائمة فوراً ويحرق الرموز المعلَّقة', async () => {
  const sid = ids.id('sess');
  await db.insert('session', {
    id: sid, user_id: STAFF, created_at: ids.nowIso(),
    expires_at: new Date(Date.now() + 12 * 3600000).toISOString(), ip: '127.0.0.1',
  });
  const { hashPassword } = await import('../../src/core/auth/password.js');
  await db.insert('login_code', {
    id: ids.id('lc'), user_id: STAFF, code_hash: hashPassword('123456'), purpose: 'signin',
    expires_at: new Date(Date.now() + 600000).toISOString(), attempts: 0, created_at: ids.nowIso(),
  });

  const r = await identity.setUserActive(ctxOf(adminUser), STAFF, false);
  assert.equal(r.sessionsRevoked, 1, 'الجلسة القائمة بقيت حيّة بعد التعطيل');
  const s = await db.get('SELECT revoked_at FROM session WHERE id = ?', [sid]);
  assert.ok(s.revoked_at, 'الجلسة لم تُبطل');
  const live = await db.all('SELECT id FROM login_code WHERE user_id = ? AND consumed_at IS NULL', [STAFF]);
  assert.equal(live.length, 0, 'بقي رمز دخول حيّ لحساب مُنع من الدخول');

  await identity.setUserActive(ctxOf(adminUser), STAFF, true);
});

test('لا تعطّل نفسك — ولا تغيّر دورك بنفسك', async () => {
  await assert.rejects(() => identity.setUserActive(ctxOf(adminUser), ADMIN, false), /حسابك أنت/);
  await assert.rejects(() => identity.updateUser(ctxOf(adminUser), ADMIN, { role_id: 'employee' }), /دورك بنفسك/);
});

test('آخر مدير نظام نشط لا يُعطَّل ولا يُخفَّض — وإلا بقيت المنصة بلا من يديرها', async () => {
  const other = await mkUser(ADMIN2, { role: 'admin', email: 'admin2.idn@evc.sa', name: 'مدير ثانٍ' });
  // بوجود مديرَين: التعطيل مسموح
  const ok = await identity.setUserActive(ctxOf(adminUser), ADMIN2, false);
  assert.equal(ok.ok, true);
  // والآن adminUser هو الوحيد النشط — فمدير ثانٍ (لو أُعيد) لا يستطيع تعطيله
  await db.run("UPDATE app_user SET active = 1 WHERE id = ?", [ADMIN2]);
  const other2 = await db.get('SELECT * FROM app_user WHERE id = ?', [ADMIN2]);
  await identity.setUserActive(ctxOf(other2), ADMIN, false);   // مسموح: يبقى ADMIN2 نشطاً
  await db.run("UPDATE app_user SET active = 1 WHERE id = ?", [ADMIN]);
  await db.run("UPDATE app_user SET active = 0 WHERE id = ?", [ADMIN2]);
  // الآن ADMIN وحده نشط: محاولة تعطيله من مدير آخر تُردّ
  await assert.rejects(() => identity.setUserActive(ctxOf(other2), ADMIN, false), /آخر مدير نظام نشط/);
  await assert.rejects(() => identity.updateUser(ctxOf(other2), ADMIN, { role_id: 'employee' }), /آخر مدير نظام نشط/);
  assert.ok(other && other2);
});

// بريدان مختلفان بنفس الجزء قبل @ يعطيان اسم المستخدم نفسه، وعمودُه فريد — فيرتطم القيد
// ويظهر خطأ قاعدة بيانات خام مكان رسالة عربية. الرقم اللاحق يحسمه بلا أن يرى المشرف شيئاً.
test('بريدان يشتركان في الجزء قبل @ لا يُسقطان الدعوة بخطأ خام', async () => {
  const a = await identity.inviteUser(ctxOf(adminUser), { email: 'sameer@evc.sa', name_ar: 'سمير الأول', role_id: 'employee' });
  const b = await identity.inviteUser(ctxOf(adminUser), { email: 'sameer@partner.example', name_ar: 'سمير الثاني', role_id: 'employee' });
  const ua = await db.get('SELECT username FROM app_user WHERE id = ?', [a.id]);
  const ub = await db.get('SELECT username FROM app_user WHERE id = ?', [b.id]);
  assert.equal(ua.username, 'sameer');
  assert.notEqual(ub.username, ua.username, 'اسمان متطابقان — القيد الفريد كان سيرتطم');
});

test('الدور والنطاق من قائمة معلومة — لا قيمة حرّة تُكتب في الحساب', async () => {
  await assert.rejects(() => identity.inviteUser(ctxOf(adminUser), {
    email: 'bad.role@evc.sa', name_ar: 'س', role_id: 'superuser',
  }), /اختر دوراً/);
  await assert.rejects(() => identity.inviteUser(ctxOf(adminUser), {
    email: 'bad.scope@evc.sa', name_ar: 'س', role_id: 'employee', scope: 'everything',
  }), /نطاق البيانات/);
});

test('كل تغيير يترك سطر تدقيق باسم فاعله', async () => {
  const before = (await db.all("SELECT id FROM audit_log WHERE resource = 'app_user'")).length;
  await identity.updateUser(ctxOf(adminUser), STAFF, { name_ar: 'اسم معدَّل' });
  const rows = await db.all("SELECT user_id, action, detail_json FROM audit_log WHERE resource = 'app_user' ORDER BY at DESC");
  assert.ok(rows.length > before);
  assert.equal(rows[0].user_id, ADMIN);
  assert.match(String(rows[0].detail_json), /اسم معدَّل|تعديل/);
});

test('سجل الدخول يُقرأ من الجدول المهجور — وكان يُكتب ولا يقرؤه أحد', async () => {
  await db.insert('login_history', { id: ids.id('lh'), user_id: STAFF, at: ids.nowIso(), ip: '10.0.0.9', ok: 1 });
  const rows = await identity.userLoginHistory(adminUser, STAFF);
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].ip, '10.0.0.9');
});

// ── «دعوة معلَّقة» ليست «معطَّل» ──
// ظهر على البيانات الحقيقية فور تعطيل حسابٍ مكرَّر بطلب المالك: الشاشة عرضته «دعوة معلَّقة»
// ومعه زرّ «إعادة الدعوة» — أي أنها تعرض على المسؤول أن يُعيد دعوة من عطّله للتوّ، وتعدّه في
// عدّاد الدعوات المنتظِرة. والسبب استنتاجٌ خاطئ: «غير نشط ولم يدخل قط» تصدق على الحالتين معاً.
// الفرق مسجَّل لا مُستنتَج: الدعوة تُصدِر رمزاً بغرض «دعوة».
test('الحساب المعطَّل لا يُقرأ دعوةً معلَّقة، والمدعوّ يُقرأ كذلك', async () => {
  const now = ids.nowIso();
  // (أ) حسابٌ عُطِّل ولم يدخل قط — ولم يُدعَ إطلاقاً
  await mkUser('u_disabled_never', { email: 'dn.idn@evc.sa', active: 0, name: 'معطَّل لم يدخل' });
  // (ب) حسابٌ مدعوّ فعلاً — صدر له رمز بغرض «دعوة»
  await mkUser('u_invited_probe', { email: 'iv.idn@evc.sa', active: 0, name: 'مدعوّ' });
  await db.insert('login_code', { id: 'lc_inv_probe', user_id: 'u_invited_probe', code_hash: 'x',
    purpose: 'invite', expires_at: now, attempts: 0, created_at: now });

  const rows = await identity.listUsers(adminUser);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.u_disabled_never.was_invited, false, 'حسابٌ لم يُدعَ قط عُدّ مدعوّاً — فيُعرض عليه «إعادة الدعوة»');
  assert.equal(byId.u_invited_probe.was_invited, true, 'حسابٌ مدعوّ لم يُعدّ مدعوّاً');
});
