// RTL/layout integrity: for two representative lenses (company-wide admin + sector-scoped lead),
// every page must render at desktop AND mobile widths with NO horizontal document overflow,
// zero console errors and zero uncaught page errors.
import { login, open, collectErrors, pagesFor, realConsoleErrors } from './_helpers.mjs';

const ROLES = ['demo.admin', 'demo.sectorlead'];
const WIDTHS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

export default async function rtlSpec({ browser, base, t }) {
  for (const username of ROLES) {
    for (const viewport of WIDTHS) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      const { consoleErrors, pageErrors } = collectErrors(page);
      await login(page, base, username);
      let bad = 0;
      const pages = await pagesFor(username);
      for (const p of pages) {
        const res = await open(page, base, `/app/${p}`);
        if (!res || res.status() !== 200) { bad++; t.fail(`${username}@${viewport.width} /app/${p}`, `HTTP ${res?.status()}`); continue; }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) { bad++; t.fail(`${username}@${viewport.width} /app/${p}`, `horizontal overflow ${overflow}px`); }
      }
      const realErrs = realConsoleErrors(consoleErrors);
      if (realErrs.length) { bad++; t.fail(`${username}@${viewport.width} console`, realErrs.slice(0, 3).join(' | ')); }
      if (pageErrors.length) { bad++; t.fail(`${username}@${viewport.width} pageerror`, pageErrors.slice(0, 3).join(' | ')); }
      if (!bad) t.pass(`${username} @ ${viewport.width}px — ${pages.length} pages, no overflow, no console/page errors`);
      await ctx.close();
    }
  }
}
