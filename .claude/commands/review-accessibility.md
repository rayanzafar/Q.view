---
description: Accessibility + RTL review of changed pages (bidi numbers, mirroring, keyboard, semantics, contrast, mobile) via the a11y-rtl-reviewer agent + axe.
---
Identify changed pages (git diff on src/web/, or $ARGUMENTS). Launch the **a11y-rtl-reviewer** agent on them. Independently run the Playwright checks yourself on those pages (desktop 1440 + mobile 390): horizontal-scroll delta ≤0, axe-core serious/critical = 0, console errors = 0. Fix blockers (clipped numbers, color-only status, missing labels, keyboard traps) immediately; add each fixed defect to the rtl/a11y spec as a regression assertion. Report findings + fixes + spec additions.
