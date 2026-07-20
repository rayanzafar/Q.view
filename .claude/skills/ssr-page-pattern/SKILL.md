---
name: ssr-page-pattern
description: How to build a Sanad SSR page — layout signature, escaping, drill-downs, chips/filters, states, page-scoped JS, RTL/number rules, no-jargon Arabic. Load before writing any page in src/web/views.
---
# Sanad SSR page pattern

## Skeleton
```js
// src/web/views/<area>.js
import { layout, esc, fmtSar } from '../layout.js';
import { all, get } from '../../core/db/index.js';
import { G } from '../i18n/glossary.js';

export async function thingPage(user, opts = {}) {
  const year = Number(opts.year) || new Date().getUTCFullYear();
  // …queries (reads only; writes live in services)…
  const body = `…template literal…`;
  return layout({ user, active: 'thing', title: 'العنوان', subtitle: '…', body, year,
                  scripts: ['/static/pages/thing.js'] });
}
```
- `active` matches the NAV key. `opts` carries `{year, sector}` plus page params.
- Re-exported via the `pages.js` barrel; wired in `routes.js` PAGES + PAGE_ACCESS by the integration session — do not edit those yourself.

## Hard rules
- `esc()` around EVERY dynamic value in HTML. Embedded JSON: `JSON.stringify(x).replace(/</g,'\\u003c')` inside `<script>`.
- Numbers: wrap in `<span class="tnum">` (bidi-isolated, tabular). Currency: `fmtSar(halalas)` or `sarShort`. Never let a flex row clip a number — labels get `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis`, values get `flex:0 0 auto`.
- Drill-downs: inert `<template id="dd-key">…rows…</template>` + trigger `onclick="Sanad.openDD('key')"` (legacy pages) or `data-dd="key"` with the delegated listener (new pages). Server renders ONLY data the role may see.
- Filters: chip row pattern — `<a class="chip ${on ? 'on' : ''}" href="?sector=X&year=Y">…</a>`; preserve other query params in every chip href.
- States: every list/table has an empty state (`.empty-state` with icon + one-line explanation + next-action link); mutations show success via `Sanad.toast`; errors render the Arabic message from the server, verbatim.
- Page JS: `src/web/public/pages/<thing>.js` — delegated events only:
```js
document.addEventListener('click', (e) => { const el = e.target.closest('[data-action]'); if (!el) return; /* switch on el.dataset.action */ });
```
- Tables that can exceed the viewport: wrap in `<div class="tblwrap">` (overflow-x auto). Test at 390px: no page-level horizontal scroll.
- Copy: Arabic business language via `G.*`; banned words (API/JSON/null/undefined/ID/Entity/Queue…) never appear; buttons ≤3 words; numbers Western digits.

## Verify before handing off
`node --check` the file; render it in a one-off script against the dev DB (`SANAD_DB=data/dev.db node -e "…thingPage(adminUser).then(h=>fs.writeFileSync('/tmp/x.html',h))"`), grep output for `undefined|NaN|\[object`, and eyeball the HTML structure.
