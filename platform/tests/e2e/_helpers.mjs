// Shared helpers for the Playwright specs run by scripts/e2e.mjs.
import { DEMO_PW, PAGES } from '../../scripts/lib/expectations.mjs';

export { DEMO_PW, PAGES };

// Form-login through the real /login page; resolves once the app shell is loaded.
export async function login(page, base, username) {
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await page.fill('[name=username]', username);
  await page.fill('[name=password]', DEMO_PW);
  await Promise.all([page.waitForURL('**/app/**', { timeout: 15000 }), page.click('button[type=submit]')]);
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
