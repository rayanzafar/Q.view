// Accessibility gate: axe-core (vendored via devDependency) against every page as demo.admin.
// Fails on serious/critical violations that are not in the documented exception list
// tests/e2e/a11y-known.json — entries there are triaged product findings awaiting fixes,
// each pinned to {page, rule} so NEW violations of the same rule elsewhere still fail.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { login, open, PAGES } from './_helpers.mjs';

export default async function a11ySpec({ browser, base, t, platformRoot }) {
  const axeSource = readFileSync(resolve(platformRoot, 'node_modules/axe-core/axe.min.js'), 'utf8');
  const known = JSON.parse(readFileSync(resolve(platformRoot, 'tests/e2e/a11y-known.json'), 'utf8'));
  const isKnown = (page, rule) => known.some((k) => k.page === page && k.rule === rule);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, base, 'demo.admin');

  let totalViolations = 0, knownHits = 0;
  for (const p of PAGES) {
    await open(page, base, `/app/${p}`);
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') || '' }));
    });
    const serious = result.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of serious) {
      if (isKnown(p, v.id)) { knownHits++; continue; }
      totalViolations++;
      t.fail(`a11y /app/${p}`, `${v.impact} ${v.id} ×${v.nodes} (e.g. ${v.sample})`);
    }
  }
  if (!totalViolations) t.pass(`a11y: ${PAGES.length} pages free of serious/critical violations (${knownHits} documented exception hits)`);
  await ctx.close();
}
