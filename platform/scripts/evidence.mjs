#!/usr/bin/env node
// Per-role visual evidence pack — logs in as every demo persona (real form login through Chromium)
// and captures a full-page screenshot of every page the role can access, plus a 390px mobile shot
// of the key surfaces (ceo/sector/opportunities/team). Writes an index.md matrix (role × page,
// observed HTTP status, file links) so a reviewer can audit the whole UI without booting anything.
//
//   node scripts/evidence.mjs http://127.0.0.1:4000
//   node scripts/evidence.mjs http://127.0.0.1:4000 --out docs/evidence/2026-07-20
//   node scripts/evidence.mjs https://staging.os.evcsol.com          # via the sandbox proxy:
//     export NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
//     (Chromium picks up HTTPS_PROXY automatically through the launch proxy option below)
//
// Screenshots use demo data only. Chromium resolution reuses scripts/e2e.mjs (pinned sandbox path
// with discovery fallback) — never `playwright install` in the sandbox.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from './e2e.mjs';
import { ROLES, PAGES, DEMO_PW } from './lib/expectations.mjs';

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const base = (argv.find((a) => !a.startsWith('--')) || '').replace(/\/+$/, '');
if (!base) { console.error('usage: evidence.mjs BASE_URL [--out docs/evidence/YYYY-MM-DD]'); process.exit(2); }
const eqArg = argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);
const spaceArg = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
const outDir = resolve(PLATFORM, eqArg || spaceArg || `docs/evidence/${new Date().toISOString().slice(0, 10)}`);
mkdirSync(outDir, { recursive: true });

const MOBILE_PAGES = ['ceo', 'sector', 'opportunities', 'my-opportunities', 'projects', 'clients', 'team'];

const { chromium } = await import('playwright');
const exe = chromiumPath();
const launchOpts = exe ? { executablePath: exe } : {};
if (base.startsWith('https://') && process.env.HTTPS_PROXY) launchOpts.proxy = { server: process.env.HTTPS_PROXY };
const browser = await chromium.launch(launchOpts);
console.log(`evidence → ${base}\nout: ${outDir}\nchromium: ${exe || '(playwright-managed)'}`);

async function login(page, username) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      // كلمة المرور بديلٌ مطويّ داخل <details> منذ صار الدخول بالرمز أولاً — تُفتح الطيّة
      // وإلا انتظر playwright ظهورَ حقلٍ لن يظهر (نفس إصلاح tests/e2e/_helpers.mjs)
      const disclosure = page.locator('.alt2 summary');
      if (await disclosure.count()) await disclosure.click();
      await page.fill('[name=username]', username);
      await page.fill('[name=password]', DEMO_PW);
      await Promise.all([page.waitForURL('**/app/**', { timeout: 20000 }),
        page.click('form[action="/auth/login-web"] button[type=submit]')]);
      return true;
    } catch (e) {
      if (attempt === 0) { await page.waitForTimeout(7000); continue; } // login limiter refill
      console.error(`  login failed for ${username}: ${e.message.split('\n')[0]}`);
      return false;
    }
  }
}

async function settle(page) { await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); }

const rows = []; // { role, page, status, file, mobileFile }
for (const { username, role } of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (!(await login(page, username))) {
    for (const p of PAGES) rows.push({ role: username, page: p, status: 'login-failed', file: null, mobileFile: null });
    await ctx.close();
    continue;
  }
  mkdirSync(resolve(outDir, username), { recursive: true });
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileCtx.newPage();
  let mobileReady = false;

  for (const p of PAGES) {
    const res = await page.goto(`${base}/app/${p}`, { waitUntil: 'load', timeout: 30000 }).catch(() => null);
    const status = res ? res.status() : 'error';
    let file = null, mobileFile = null;
    if (status === 200) {
      await settle(page);
      // مفاتيح أقسام الفريق تحمل شرطة مائلة (`team/resources`) — تُسطَّح في اسم الملف.
      file = `${username}/${p.replace(/\//g, '-')}.png`;
      await page.screenshot({ path: resolve(outDir, file), fullPage: true });
      if (MOBILE_PAGES.includes(p)) {
        if (!mobileReady) mobileReady = await login(mobilePage, username);
        if (mobileReady) {
          const mres = await mobilePage.goto(`${base}/app/${p}`, { waitUntil: 'load', timeout: 30000 }).catch(() => null);
          if (mres?.status() === 200) {
            await settle(mobilePage);
            mobileFile = `${username}/${p.replace(/\//g, '-')}.mobile.png`;
            await mobilePage.screenshot({ path: resolve(outDir, mobileFile), fullPage: true });
          }
        }
      }
    }
    rows.push({ role: username, page: p, status, file, mobileFile });
  }
  console.log(`  ✓ ${username} (${role}) — ${rows.filter((r) => r.role === username && r.file).length}/${PAGES.length} pages captured`);
  await mobileCtx.close();
  await ctx.close();
}
await browser.close();

// ── index.md ──────────────────────────────────────────────────────────────────
const when = new Date().toISOString();
let md = `# حزمة الأدلة البصرية — سند\n\n`;
md += `- **المصدر**: ${base}\n- **وقت الالتقاط**: ${when}\n- **الأبعاد**: 1440×900 (كاملة الطول) + 390px لصفحات ${MOBILE_PAGES.join('/')}\n\n`;
md += `| الدور | الصفحة | الحالة | لقطة سطح المكتب | لقطة الجوال |\n|---|---|---|---|---|\n`;
for (const r of rows) {
  const desktop = r.file ? `[${r.page}.png](${r.file})` : '—';
  const mobile = r.mobileFile ? `[جوال](${r.mobileFile})` : '—';
  md += `| ${r.role} | /app/${r.page} | ${r.status} | ${desktop} | ${mobile} |\n`;
}
const captured = rows.filter((r) => r.file).length;
const denied = rows.filter((r) => typeof r.status === 'number' && r.status !== 200).length;
md += `\n**الملخص**: ${captured} لقطة مكتبية · ${rows.filter((r) => r.mobileFile).length} لقطة جوال · ${denied} صفحة محجوبة حسب الصلاحية (403/302).\n`;
writeFileSync(resolve(outDir, 'index.md'), md);
console.log(`\n✓ ${captured} desktop + ${rows.filter((r) => r.mobileFile).length} mobile screenshots · index → ${resolve(outDir, 'index.md')}`);
