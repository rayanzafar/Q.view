---
name: playwright-evidence
description: How to drive the platform with Playwright in this sandbox — login as demo roles, screenshot pages, RTL/a11y checks, evidence pack generation. Load before any browser-based verification.
---
# Browser verification in this sandbox

Chromium is preinstalled: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (never `playwright install`). The `playwright` npm package is a devDependency of platform/ — if missing locally, `npm install` in platform/ (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 is preset).

## Boilerplate
```js
import { chromium } from 'playwright';
const b = await chromium.launch();            // finds /opt/pw-browsers automatically
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } }); // or 390×844 mobile
await pg.goto(BASE + '/login');
await pg.fill('[name=username]', 'demo.ceo'); // 16 accounts: demo.{admin,ceo,sectorlead,bd,pm,hr,consultant,employee,viewer,deptmgr,linemgr,bdhead,ops,procurement,approver,external}
await pg.fill('[name=password]', DEMO_PW);    // DEMO_PW from scripts/seed.js (do not hardcode elsewhere)
await pg.click('button[type=submit]');
await pg.waitForURL('**/app/**');
```
Local server for tests: boot with `SANAD_DB=<tmp> PORT=4999 node --experimental-sqlite src/server.js` after migrate+seed, or hit staging `https://staging.os.evcsol.com`.

## Standard checks
- **RTL overflow**: `await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)` must be ≤ 0 at 1440 AND 390 widths.
- **Leak scan**: page content must not match `/undefined|NaN|\[object|null(?![a-z])/` outside code samples.
- **a11y**: inject axe: `await pg.addScriptTag({ path: require.resolve('axe-core/axe.min.js') }); const r = await pg.evaluate(() => axe.run({ resultTypes: ['violations'] }))` — fail on `serious`/`critical`.
- **Console errors**: collect `pg.on('pageerror'|'console')`; any error-level entry = finding.

## Evidence pack (`scripts/evidence.mjs`)
For each role: login → for each page the role may access (PAGE_ACCESS) → `waitForLoadState('networkidle')` → full-page screenshot `docs/evidence/<date>/<role>/<page>.png` + append a row to `docs/evidence/<date>/index.md` (role, page, status, notable numbers). Keep viewport 1440×900 for consistency; add one 390px mobile shot per rebuilt page. Screenshots use demo data only — never the sensitive snapshot values (salaries) in cropped close-ups.
