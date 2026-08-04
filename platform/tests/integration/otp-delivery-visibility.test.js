// لماذا لم يصل رمز الدخول؟ — السؤال الذي لم يكن للمنتج جوابٌ عليه.
//
// وقع هذا حرفياً: طُلبت رموز دخول ولم تصل، وسبب كل محاولة **مسجَّلٌ في القاعدة** منذ اليوم
// الأول، ولا سبيل إلى رؤيته من أي شاشة:
//   · رمز الدخول يُرسَل فوراً لا عبر الطابور (الطابور يُستنزف كل ٦٠ ثانية، ورمزٌ يصل بعد
//     دقيقة رمزٌ ميّت) — وثمنُ ذلك أنه **لا يترك أثراً في مركز البريد إطلاقاً**.
//   · وسجلّ التدقيق كان يعرض الوقت والفاعل والفعل والمورد و**يُسقط عمود «ماذا جرى»** الذي
//     يحمل الجواب نصاً.
//   · ومركز البريد كان يقول «مقصور على ٢ عنواناً» ولا يقول **أيّ** عنوانين — وحرفٌ ناقص في
//     أحدهما يحجب كل رسالة بينما الشاشة كلها خضراء.
//
// فالفحص هنا على الثلاثة: يُسجَّل · ويُقرأ من مركز البريد · ويُقرأ من سجلّ التدقيق. ولا يُكتب
// الرمز في أيٍّ منها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-otpvis-'));
process.env.SANAD_DB = join(dir, 't.db');
process.env.MAIL_TRANSPORT = 'smtp';                       // القناة «الحقيقية» بلا أسرار ⇒ فشلٌ واقعي
process.env.SANAD_MAIL_ALLOWLIST = 'allowed@evc.sa';
delete process.env.SANAD_MAIL_UNRESTRICTED;
// وهذا الملف يفحص **رؤية سبب الحجب**، فيلزمه حجبٌ يقع فعلاً. وقد صارت حسابات المنصة مسموحةً
// بحكم وجودها (فالقائمة تتحدّث بنفسها ولا تحتاج يداً عند كل حساب جديد) — أي أن حساباً في
// المنصة لا يُحجَب بعد اليوم. فيُطفأ الاشتقاق هنا وحده لتبقى القائمة المغلقة باليد، وتبقى
// الحالة التي بُني لها الفحص قابلةً للوقوع. والسلوك الجديد مفحوصٌ في mail-blocked-visible.
process.env.SANAD_MAIL_ACCOUNTS_ALLOWED = '0';
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let requestCode, db, mailPage, auditPage;
const ADMIN = { id: 'u_adm', name_ar: 'مدير النظام', username: 'adm', role_id: 'admin', scope: 'company' };

before(async () => {
  ({ requestCode } = await import('../../src/core/auth/otp.js'));
  db = await import('../../src/core/db/index.js');
  ({ mailPage } = await import('../../src/web/views/mail.js'));
  ({ auditPage } = await import('../../src/web/views/govern.js'));
  const now = new Date().toISOString();
  await db.insert('app_user', { id: ADMIN.id, username: 'adm', email: 'adm@evc.sa', name_ar: ADMIN.name_ar, role_id: 'admin', scope: 'company', active: 1, created_at: now });
  await db.insert('app_user', { id: 'u_blocked', username: 'blocked.one', email: 'blocked@evc.sa', name_ar: 'مستقبِل محجوب', role_id: 'employee', scope: 'own', active: 1, created_at: now });
  await db.insert('app_user', { id: 'u_allowed', username: 'allowed.one', email: 'allowed@evc.sa', name_ar: 'مستقبِل مسموح', role_id: 'employee', scope: 'own', active: 1, created_at: now });
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('العنوان خارج قائمة السماح: يُسجَّل سبب الحجب — لا صمت', async () => {
  const r = await requestCode({ email: 'blocked@evc.sa', ip: '127.0.0.1' });
  assert.equal(r.delivered, false, 'ادّعى التسليم وهو محجوب');
  const row = await db.get("SELECT event, detail FROM email_log WHERE detail LIKE '%blocked@evc.sa%' ORDER BY at DESC LIMIT 1");
  assert.ok(row, 'لم يُكتب أي أثر لمحاولة الإرسال — فلا شيء يجيب «لماذا لم يصل؟»');
  assert.equal(row.event, 'blocked', `الحالة المسجَّلة «${row.event}» لا «محجوبة»`);
  assert.match(row.detail, /رمز دخول/, 'الأثر لا يقول أي رسالة هي');
  assert.match(row.detail, /قائمة/, 'الأثر لا يقول سبب الحجب');
});

test('والعنوان المسموح يبلغ قناة الإرسال، فيُسجَّل خطؤها الحقيقي', async () => {
  await requestCode({ email: 'allowed@evc.sa', ip: '127.0.0.1' });
  const row = await db.get("SELECT event, detail FROM email_log WHERE detail LIKE '%allowed@evc.sa%' ORDER BY at DESC LIMIT 1");
  assert.ok(row, 'لا أثر للمحاولة');
  assert.equal(row.event, 'failed', 'المحاولة التي بلغت القناة وفشلت لم تُسجَّل فشلاً');
  // نصّ الخطأ كما جاء من الطبقة الأدنى — لا «حدث خطأ» مبهمة
  assert.match(row.detail, /قناة البريد الحقيقية غير مفعّلة/, 'السبب الحقيقي لم يُنقل إلى الأثر');
});

test('ولا يُكتب الرمز في الأثر — لا كاملاً ولا جزءاً منه', async () => {
  const rows = await db.all('SELECT detail FROM email_log');
  const audits = await db.all("SELECT detail_json detail FROM audit_log WHERE resource = 'login_code'");
  for (const r of [...rows, ...audits]) {
    assert.equal(/[0-9]{4,}/.test(String(r.detail || '')), false,
      `تسلسل رقمي طويل في الأثر: «${r.detail}»`);
  }
});

// كُتب هذا الحارس لأن العيب وقع لحظةَ عُرض الأثر: كانت الحالة تُخزَّن برمزها الإنجليزي
// (previewed · blocked · signin) وهي غير معروضة، فلم يظهر شيء. وأول شاشةٍ عرضت الأثر أظهرت
// المصطلح في وجه المستخدم. فالسبب يُترجَم عند نشأته لا عند عرضه — وهذا يمنع رجوعه.
test('ونصوص الأثر عربية — لا رموز حالةٍ إنجليزية تظهر لمن يقرأ السجل', async () => {
  const RAW = ['previewed', 'blocked', 'signin', 'invite', 'sent', 'failed'];
  const logs = await db.all('SELECT detail FROM email_log WHERE queue_id IS NULL');
  const audits = await db.all("SELECT detail_json detail FROM audit_log WHERE resource = 'login_code'");
  assert.ok(logs.length && audits.length, 'لا صفوف لفحصها');
  for (const r of [...logs, ...audits]) {
    // البريد نفسه لاتيني بطبيعته — يُستثنى ويُفحص ما عداه
    const withoutEmail = String(r.detail || '').replace(/[\w.+-]+@[\w.-]+/g, '');
    for (const w of RAW) {
      assert.equal(new RegExp(`\\b${w}\\b`, 'i').test(withoutEmail), false,
        `رمز حالةٍ إنجليزي «${w}» في نصٍّ يُعرض: «${r.detail}»`);
    }
  }
});

test('مركز البريد يعرض محاولات رمز الدخول — لا رسائل التقارير وحدها', async () => {
  const html = await mailPage(ADMIN);
  assert.match(html, /رمز دخول إلى blocked@evc\.sa/, 'محاولة الرمز غائبة عن مركز البريد');
  assert.match(html, /حُجبت/, 'حالة الحجب غير معروضة بمعناها');
});

test('ومركز البريد يقول أي العناوين مسموحة — لا عددها وحده', async () => {
  const html = await mailPage(ADMIN);
  assert.ok(html.includes('allowed@evc.sa'),
    'العناوين المسموح بها غير معروضة — فحرفٌ ناقص في أحدها يحجب كل رسالة والشاشة خضراء');
  assert.match(html, /العناوين المسموح بها/, 'لا عنوان للقائمة يشرحها');
});

test('وسجلّ التدقيق يعرض «ماذا جرى» — العمود الذي كان يُكتب ولا يُقرأ', async () => {
  const html = await auditPage(ADMIN);
  assert.match(html, /ماذا جرى/, 'لا عمود للتفصيل في سجل التدقيق');
  assert.match(html, /طُلب رمز دخول/, 'تفصيل الحدث غير معروض رغم تسجيله');
  assert.match(html, /لم يُسلَّم/, 'حالة عدم التسليم غير ظاهرة في السجل');
});

test('وطلبُ رمزٍ لبريدٍ غير مسجَّل يبقى صامتاً تماماً — لا أثر يكشف من له حساب', async () => {
  const before = (await db.get('SELECT COUNT(*) n FROM email_log')).n;
  const r = await requestCode({ email: 'stranger@evc.sa', ip: '127.0.0.1' });
  assert.deepEqual({ ok: r.ok, delivered: r.delivered }, { ok: true, delivered: false },
    'الردّ على بريدٍ غير مسجَّل اختلف عن الردّ على المسجَّل');
  const after = (await db.get('SELECT COUNT(*) n FROM email_log')).n;
  assert.equal(Number(after), Number(before),
    'كُتب أثرٌ لبريدٍ لا حساب له — فيصير السجلّ نفسه كاشفاً لمن يعمل في الشركة');
  const audits = await db.all("SELECT detail_json FROM audit_log WHERE detail_json LIKE '%stranger@evc.sa%'");
  assert.equal(audits.length, 0, 'ذُكر البريد المجهول في سجل التدقيق');
});
