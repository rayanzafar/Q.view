// Designed empty states: pages with no data for the current persona must show an intentional
// empty state (.empty-state component OR a meaningful Arabic explanation), never a blank shell.
import { login, open } from './_helpers.mjs';

const CASES = [
  // demo.employee has no pending approvals (the seeded request targets the sector_lead step).
  { username: 'demo.employee', path: '/app/approvals', anyOf: ['لا طلبات بانتظارك'] },
  // demo.employee owns no opportunities → the personal pipeline shows the designed notice card.
  { username: 'demo.employee', path: '/app/my-opportunities', anyOf: ['لا فرص باسمك بعد'] },
  // demo.viewer has read-only scope and no assigned tasks → designed inline prompt.
  { username: 'demo.viewer', path: '/app/tasks', anyOf: ['لا مهام'] },
];

export default async function statesSpec({ browser, base, t }) {
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, base, c.username);
    const res = await open(page, base, c.path);
    if (!res || res.status() !== 200) { t.fail(`${c.username} ${c.path}`, `HTTP ${res?.status()}`); await ctx.close(); continue; }

    const state = await page.evaluate((needles) => {
      const el = document.querySelector('.empty-state');
      const text = document.body.innerText || '';
      return {
        hasComponent: !!el && el.offsetParent !== null,
        matched: needles.find((n) => text.includes(n)) || null,
        bodyLength: text.replace(/\s+/g, ' ').length,
      };
    }, c.anyOf);

    if (state.hasComponent || state.matched) {
      t.pass(`${c.username} ${c.path} shows a designed empty state (${state.hasComponent ? '.empty-state' : `«${state.matched}»`})`);
    } else {
      t.fail(`${c.username} ${c.path}`, `no .empty-state and none of [${c.anyOf.join(', ')}] in visible text (bodyLength=${state.bodyLength})`);
    }
    await ctx.close();
  }
}
