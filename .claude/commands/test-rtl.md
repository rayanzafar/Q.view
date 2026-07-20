---
description: RTL/bidi regression pass — render key pages at 1440+390, assert no horizontal scroll, no clipped/reordered numbers, correct mirroring.
---
Run `node scripts/e2e.mjs rtl` (rtl.spec across all PAGE_ACCESS pages as demo.admin + demo.sectorlead). The spec asserts: scrollWidth ≤ clientWidth at both widths; every `.tnum` renders its full value (compare innerText length vs data-value when present); month strips remain LTR; drawers open from the correct side. On failure: screenshot the offender to the scratchpad, fix (bidi isolation / flex shrink rules / logical properties), add the case to rtl.spec, re-run. Report pages checked + failures + fixes.
