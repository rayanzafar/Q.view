// مركز البريد يقول **مِن أي عنوان** يخرج البريد — لا «مفعّل» وحدها.
//
// لماذا: عنوان المُرسِل هو ما يقرّر إن كانت الرسالة تصل أصلاً. نطاقٌ غير موثَّق لدى مزوّد
// الإرسال يعني رفضاً أو حجزاً في البريد المزعج؛ ونطاقُ تجربة (يمنحه المزوّد ليعمل فوراً)
// يعني وصولاً **لصاحب حساب المزوّد وحده** مهما طالت قائمة السماح. وكلتا الحالتين كانت تبدو
// من الشاشة «بريد حقيقي مفعّل» — فيُطلَق الشيء وهو معطَّل عملياً على كل من عداك.
//
// وقد وقع هذا فعلاً: القناة شُغِّلت والمُرسِل نطاق تجربة، فبدت الشاشة خضراء بينما لا يصل
// أحداً غير صاحب الحساب. والشاشة التي تُخفي هذا لا تُخفي تفصيلاً بل تُخفي أن الميزة معطَّلة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mailfrom-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let mailPage, config, saved;
const admin = { id: 'u_t', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company' };

before(async () => {
  ({ mailPage } = await import('../../src/web/views/mail.js'));
  ({ config } = await import('../../src/core/config.js'));
  saved = { transport: config.mailTransport, from: config.smtp.from, allow: config.mailAllowlist };
});

after(() => {
  config.mailTransport = saved.transport;
  config.smtp.from = saved.from;
  config.mailAllowlist = saved.allow;
  rmSync(dir, { recursive: true, force: true });
});

// الإعداد يُضبط على الكائن نفسه لا على البيئة: الإعداد يُقرأ مرة واحدة عند التحميل، وضبط
// متغيّر بيئة بعدها لا يغيّر شيئاً — فيمرّ اختبارٌ لا يفحص ما يظنّ أنه يفحصه.
function withMail({ transport = 'smtp', from = null, allow = ['rayn@evc.sa'] }) {
  config.mailTransport = transport;
  config.smtp.from = from;
  config.mailAllowlist = allow;
  return mailPage(admin);
}

test('عنوان المُرسِل معروضٌ على الشاشة حين تكون القناة الحقيقية مشغَّلة', async () => {
  const html = await withMail({ from: 'سند <no-reply@send.evcsol.com>' });
  assert.ok(html.includes('no-reply@send.evcsol.com'),
    'الشاشة تقول «مفعّل» ولا تقول مِن أي عنوان تخرج الرسائل');
});

test('نطاق التجربة يُعلَن تحذيراً — لا يُعرض كأنه تشغيلٌ سليم', async () => {
  const html = await withMail({ from: 'onboarding@resend.dev' });
  assert.ok(html.includes('onboarding@resend.dev'), 'العنوان غائب');
  assert.match(html, /نطاق تجربة/, 'نطاق التجربة عُرض بلا تمييز عن نطاق حقيقي');
  // والتحذير يقول العاقبة لا التصنيف وحده: لمن تصل الرسائل فعلاً.
  assert.match(html, /لا تصل إلا صاحب حساب المزوّد/, 'التحذير لا يشرح أثره العملي');
});

test('غياب المُرسِل يُقال صراحةً — لا يُترك فراغاً يُقرأ نجاحاً', async () => {
  const html = await withMail({ from: null });
  assert.match(html, /بلا عنوان مُرسِل/, 'المُرسِل الغائب لم يُعلَن');
  assert.match(html, /لن تخرج أي رسالة/, 'الأثر العملي للغياب غير مذكور');
  // وأخطر ما في الفراغ أن يُطبع خاماً على الشاشة
  assert.equal(/\bnull\b|\bundefined\b/.test(html), false, 'قيمة خام تسرّبت إلى الشاشة');
});

test('نطاق الشركة الموثَّق يُعرض بلا تحذير — التحذير الدائم يُهمَل', async () => {
  const html = await withMail({ from: 'no-reply@send.evcsol.com' });
  assert.equal(/نطاق تجربة/.test(html), false, 'تحذيرٌ في غير موضعه');
  assert.equal(/بلا عنوان مُرسِل/.test(html), false, 'أُعلن الغياب والعنوان موجود');
});

test('وضع المعاينة لا يدّعي مُرسِلاً — لا بريد يخرج أصلاً', async () => {
  const html = await withMail({ transport: 'preview', from: 'onboarding@resend.dev' });
  assert.equal(html.includes('onboarding@resend.dev'), false,
    'وضع المعاينة عرض عنوان مُرسِل، وهو لا يُرسل شيئاً');
  assert.match(html, /وضع المعاينة/, 'حالة المعاينة نفسها غير معلنة');
});
