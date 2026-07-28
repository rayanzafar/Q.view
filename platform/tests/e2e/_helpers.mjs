// Shared helpers for the Playwright specs run by scripts/e2e.mjs.
import { DEMO_PW, PAGES, ROLES, pageExpected, loadPageAccess } from '../../scripts/lib/expectations.mjs';

export { DEMO_PW, PAGES };

// Pages the given DEMO USERNAME is expected to open (per the same PAGE_ACCESS the router enforces).
// Specs visit only these; a denied page is covered by the permissions matrix, not by e2e.
let _pa;
export async function pagesFor(username) {
  _pa ??= await loadPageAccess();
  const role = ROLES.find((r) => r.username === username)?.role;
  return PAGES.filter((p) => pageExpected(role, p, _pa).status === 200);
}

// Console-error filter: resource-load failures for API 401/403/404s are server-enforced authz
// answering background fetches (e.g. the notification badge) — not client defects.
export const realConsoleErrors = (arr) => arr.filter((t) => !/Failed to load resource/.test(t));

// Form-login through the real /login page; resolves once the app shell is loaded.
//
// The retry is not flake-papering — it is the harness obeying a real security control. Login is
// rate-limited per IP (10 attempts, then one token every 6s — src/core/http/security.js), and the
// whole suite logs in from 127.0.0.1 dozens of times: every role at every width, plus each spec.
// So the bucket empties partway through a full run and the NEXT spec's login is refused with 429,
// which surfaced as a bare "waitForURL timeout" in whichever spec happened to run at that moment.
// Loosening the limiter for tests would delete the protection we ship; waiting for a token keeps
// the product honest and the suite deterministic. A wrong password still fails fast: only the
// rate-limit answer is retried.
const RETRY_WAIT_MS = 6500;                     // نافذة تجديد رمز واحد + هامش
export async function login(page, base, username, attempt = 0) {
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  // صفحة الدخول صارت خطوتين: البريد ثم الرمز، وكلمة المرور بديلٌ **مطويّ** داخل <details>.
  // الحقل موجود في الصفحة لكنه غير مرئي، وplaywright ينتظر الظهور فينتهي وقته — وهو ما أسقط
  // الخمسة جميعاً. نفتح الطيّة أولاً، ونخصّص زر الإرسال بنموذجه لأن الزر الأول في الصفحة صار
  // زرَّ طلب الرمز لا زرَّ كلمة المرور.
  const disclosure = page.locator('.alt2 summary');
  if (await disclosure.count()) await disclosure.click();
  await page.fill('[name=username]', username);
  await page.fill('[name=password]', DEMO_PW);
  const [nav] = await Promise.all([
    page.waitForURL('**/app/**', { timeout: 15000 }).then(() => true, () => false),
    page.click('form[action="/auth/login-web"] button[type=submit]'),
  ]);
  if (nav) return;
  const throttled = await page.evaluate(() => /محاولات كثيرة/.test(document.body.innerText || ''))
    .catch(() => false);
  if (throttled && attempt < 4) {
    await page.waitForTimeout(RETRY_WAIT_MS);
    return login(page, base, username, attempt + 1);
  }
  throw new Error(`login failed for ${username} — landed on ${page.url()}`
    + (throttled ? ' (rate-limited; retries exhausted)' : ''));
}

// Navigate and give the page a chance to settle (networkidle capped so a straggling request can
// never hang the suite — SSR pages are effectively static after load).
export async function open(page, base, path) {
  const res = await page.goto(base + path, { waitUntil: 'load', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  return res;
}

// Attach console/pageerror collectors BEFORE navigation; returns the live arrays.
export function collectErrors(page) {
  const consoleErrors = [], pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { consoleErrors, pageErrors };
}
