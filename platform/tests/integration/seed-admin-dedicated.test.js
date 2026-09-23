// حسابٌ مخصَّص لإدارة النظام — لا دورٌ يُعلَّق على موظف.
//
// إدارة النظام **وظيفة لا شخص**. وتعليقُها على حساب موظف يخلط أمرين: من يعمل في الشركة، ومن
// يملك مفاتيحها. فإذا غادر الموظف أو تغيّر دوره، غادرت معه صلاحيةٌ لا تخصّه أصلاً.
//
// وكان إنشاء هذا الحساب متعذّراً على قاعدةٍ عاملة: `seed-admin` يتخطّى نفسه لوجود مديرٍ قائم،
// و`assertNotLastAdmin` يمنع تنحية القائم قبل وجود بديل — قفلٌ مطبق لا مخرج منه من داخل
// المنتج. فيُفتح بابٌ مُعلَن (SANAD_ADMIN_FORCE=1) لا ضمني.
//
// والحارس هنا يثبّت الحدّ: المفتاح يتجاوز شرط «يوجد مدير» وحده، **ولا يتجاوز منع التكرار**.
// مفتاحٌ يُنشئ حساباً جديداً في كل إقلاع يصنع طابوراً من المديرين بلا أن ينتبه أحد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-sysadm-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let seedAdmin, db, verifyPassword;

before(async () => {
  ({ seedAdmin } = await import('../../scripts/seed-admin.js'));
  db = await import('../../src/core/db/index.js');
  ({ verifyPassword } = await import('../../src/core/auth/password.js'));
  // قاعدة «عاملة»: فيها مديرٌ نشط أصلاً — وهي الحالة التي كان الإنشاء متعذّراً فيها
  await db.insert('app_user', {
    id: 'u_existing_admin', username: 'existing.admin', email: 'existing@evc.sa',
    name_ar: 'مدير قائم', role_id: 'admin', scope: 'company', active: 1,
    created_at: new Date().toISOString(),
  });
});

after(() => rmSync(dir, { recursive: true, force: true }));

function env({ email, user, pass, force }) {
  process.env.SANAD_ADMIN_EMAIL = email || '';
  process.env.SANAD_ADMIN_USER = user || '';
  process.env.SANAD_ADMIN_PASS = pass || '';
  if (force) process.env.SANAD_ADMIN_FORCE = '1'; else delete process.env.SANAD_ADMIN_FORCE;
}

test('بلا المفتاح: لا يُنشأ شيء على قاعدةٍ فيها مدير — السلوك القديم كما هو', async () => {
  env({ email: 'sysadmin@evc.sa', user: 'sysadmin', pass: 'x' });
  const r = await seedAdmin();
  assert.equal(r.created, false);
  assert.equal(r.reason, 'admin-present', 'تغيّر سبب التخطّي — الحماية الافتراضية تبدّلت');
});

test('وبالمفتاح المُعلَن: يُنشأ حساب إدارة النظام بكلمة مرور تعمل', async () => {
  env({ email: 'sysadmin@evc.sa', user: 'sysadmin', pass: 'Str0ng-Pass-For-Test', force: true });
  const r = await seedAdmin();
  assert.equal(r.created, true, 'لم يُنشأ رغم إعلان التجاوز');
  const u = await db.get("SELECT * FROM app_user WHERE username = 'sysadmin'");
  assert.ok(u, 'الحساب غير موجود');
  assert.equal(u.role_id, 'admin');
  assert.equal(Number(u.active), 1, 'أُنشئ غير نشط — لا يستطيع الدخول');
  assert.ok(verifyPassword('Str0ng-Pass-For-Test', u.password_hash), 'كلمة المرور لا تتحقّق');
});

test('وهو غير مرتبط بأي موظف — إدارة النظام وظيفة لا شخص', async () => {
  const u = await db.get("SELECT * FROM app_user WHERE username = 'sysadmin'");
  assert.equal(u.employee_id ?? null, null, 'رُبط حساب إدارة النظام بسجل موظف');
  assert.equal(u.sector_id ?? null, null, 'أُسنِد حساب إدارة النظام إلى قطاع');
  assert.equal(u.scope, 'company', 'نطاقه ليس شركياً');
});

test('والمفتاح لا يتجاوز منع التكرار: إعادة التشغيل لا تُنشئ ثانياً', async () => {
  env({ email: 'sysadmin@evc.sa', user: 'sysadmin', pass: 'Str0ng-Pass-For-Test', force: true });
  const r = await seedAdmin();
  assert.equal(r.created, false, 'أُنشئ حساب ثانٍ بنفس البريد');
  assert.equal(r.reason, 'exists');
  const n = await db.get("SELECT COUNT(*) n FROM app_user WHERE lower(email) = 'sysadmin@evc.sa'");
  assert.equal(Number(n.n), 1, 'تكرّر الحساب في القاعدة');
});

test('والإنشاء مسجَّل في سجل التدقيق — لا مفتاح يعمل بصمت', async () => {
  const a = await db.get(
    "SELECT * FROM audit_log WHERE resource = 'app_user' AND action = 'create' ORDER BY at DESC LIMIT 1");
  assert.ok(a, 'لا أثر لإنشاء حساب إدارة النظام');
  assert.match(String(a.detail_json || ''), /sysadmin@evc\.sa/, 'الأثر لا يذكر الحساب المُنشأ');
});
