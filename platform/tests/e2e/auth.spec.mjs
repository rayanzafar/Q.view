// الدخول برمز البريد — المسار الأساسي الجديد، على متصفّح حقيقي من أوله إلى آخره.
//
// كُتب لأن الخمسة الأخرى كلها تدخل بكلمة المرور عبر `login()` المشترك، فكان المسار الذي
// سيستعمله كل موظف في EVC **بلا أي تغطية في التكامل المستمر**. وقد أثبت ذلك نفسه: إعادة تصميم
// صفحة الدخول أسقطت الخمسة جميعاً لأنها أخفت حقل كلمة المرور داخل طيّة — عيبٌ التقطه المتصفّح
// ولم يلتقطه ٨٩٧ اختباراً وحدةً وتكاملاً، لأن أياً منها لا يفتح صفحة الدخول أصلاً.
//
// الرمز يُقرأ من صندوق المعاينة (وضع preview يكتب الرسالة ملفاً بدل إرسالها) — وهي نفس
// الطريقة التي سيقرأ بها المُشغّل رسالةً حقيقية، فالمسار مُختبَر لا محاكى.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTBOX = resolve(PLATFORM, 'data/outbox');
const EMAIL = 'demo.ceo@evc.com.sa';

// أحدث رسالة كُتبت **بعد** لحظة الطلب: صندوق المعاينة يتراكم بين التشغيلات، وأخذُ الأحدث
// مطلقاً قد يلتقط رمزاً من جولة سابقة فيمرّ الاختبار على رمزٍ لا علاقة له بهذه الدورة.
function codeSince(sinceMs) {
  let files = [];
  try {
    files = readdirSync(OUTBOX).filter((f) => f.endsWith('.html'))
      .map((f) => ({ f, t: statSync(resolve(OUTBOX, f)).mtimeMs }))
      .filter((x) => x.t >= sinceMs)
      .sort((a, b) => b.t - a.t);
  } catch { return null; }
  for (const { f } of files) {
    const m = readFileSync(resolve(OUTBOX, f), 'utf8').match(/letter-spacing:10px[^>]*>(\d{6})</);
    if (m) return m[1];
  }
  return null;
}

export default async function authSpec({ browser, base, t }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ar-SA' });
  const page = await ctx.newPage();

  // ١ — الشاشة تبدأ بالبريد، وكلمة المرور بديلٌ مطويّ لا واجهة أولى.
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  const emailVisible = await page.locator('input[name=email]').isVisible().catch(() => false);
  t[emailVisible ? 'pass' : 'fail']('login starts with the email step', emailVisible ? '' : 'no visible email field');
  const pwVisible = await page.locator('input[name=password]').isVisible().catch(() => false);
  t[!pwVisible ? 'pass' : 'fail']('the password form is collapsed, not the primary path');

  // ٢ — طلب الرمز ينقل إلى الخطوة الثانية بنفس الردّ لأي بريد.
  const since = Date.now();
  await page.fill('input[name=email]', EMAIL);
  await page.click('form[action="/auth/otp/request-web"] button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  const codeField = await page.locator('input[name=code]').isVisible().catch(() => false);
  t[codeField ? 'pass' : 'fail']('requesting a code moves to the code step');

  // ٣ — الرمز وصل فعلاً إلى الرسالة، وستةُ أرقام.
  let code = null;
  for (let i = 0; i < 20 && !code; i++) { code = codeSince(since); if (!code) await page.waitForTimeout(150); }
  t[code ? 'pass' : 'fail']('a six-digit code reached the mailbox', code ? '' : 'no code found in the preview outbox');
  if (!code) { await ctx.close(); return; }

  // ٤ — رمز خاطئ يُردّ برسالته الخاصة ويبقى على خطوته.
  await page.fill('input[name=code]', '000000');
  await page.click('form[action="/auth/otp/verify-web"] button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  const wrongMsg = await page.locator('.err').textContent().catch(() => '') || '';
  t[/غير صحيح/.test(wrongMsg) ? 'pass' : 'fail']('a wrong code is refused with its own Arabic message', wrongMsg.trim());
  const stillOnCode = await page.locator('input[name=code]').isVisible().catch(() => false);
  t[stillOnCode ? 'pass' : 'fail']('and it stays on the code step instead of restarting');

  // ٥ — الرمز الصحيح يدخل.
  await page.fill('input[name=code]', code);
  await page.click('form[action="/auth/otp/verify-web"] button[type=submit]');
  await page.waitForURL('**/app/**', { timeout: 15000 }).catch(() => {});
  const landed = page.url().includes('/app/');
  t[landed ? 'pass' : 'fail']('the correct code signs in', landed ? '' : `landed on ${page.url()}`);

  // ٦ — ولمرة واحدة: نفس الرمز من متصفّح نظيف لا يفتح جلسة ثانية.
  const ctx2 = await browser.newContext({ locale: 'ar-SA' });
  const p2 = await ctx2.newPage();
  await p2.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await p2.fill('input[name=email]', EMAIL);
  await p2.click('form[action="/auth/otp/request-web"] button[type=submit]');
  await p2.waitForLoadState('domcontentloaded');
  await p2.fill('input[name=code]', code);
  await p2.click('form[action="/auth/otp/verify-web"] button[type=submit]');
  await p2.waitForLoadState('domcontentloaded');
  const reused = p2.url().includes('/app/');
  t[!reused ? 'pass' : 'fail']('a consumed code cannot open a second session', reused ? 'it signed in again' : '');

  await ctx2.close();
  await ctx.close();
}
