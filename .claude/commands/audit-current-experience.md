---
description: Audit an existing platform experience end-to-end (data → service → page → roles) and produce a gap list vs the product philosophy. Usage: /audit-current-experience <page-or-area>
---
Area: $ARGUMENTS

Audit it like a skeptical product consultant, with evidence:
1. **Render it for real** as 3 roles (admin, sector lead, a restricted role) against seeded data — screenshots or saved HTML, note every number shown.
2. **Trace each number** to its query/metric function — is it correct, year-scoped, scope-filtered, halalas-exact? Cross-check totals against `src/core/reports/metrics.js` or finance sources.
3. **Philosophy gaps**: does the page lead with "what needs attention/decision"? progressive disclosure? drill-downs on every aggregate? next actions? designed empty/error states? glossary-clean Arabic? RTL/number rendering? mobile?
4. **Permission gaps**: anything visible/actionable that the role shouldn't have (check server, not just UI).
Output: a ranked findings table (what, evidence, severity, proposed fix, effort S/M/L) + the 3 fixes with highest user value. Do not fix anything in this command — it feeds /design-feature.
