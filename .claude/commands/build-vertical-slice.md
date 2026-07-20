---
description: Implement an approved feature design as a complete vertical slice (migration→service→API→page→client JS→tests), then wire + verify. Usage: /build-vertical-slice <feature>
---
Feature: $ARGUMENTS — its approved design must exist in `docs/specs/08-feature-designs.md` (if not, run /design-feature first).

Build the FULL slice, in order: (1) any migration (new numbered file only) + portable-SQL check on both drivers; (2) service functions with `can()`/scope/sensitive gates + `audit()` on every write (backend-builder agent for large scopes); (3) module router; (4) SSR page(s) per the ssr-page-pattern skill + page-scoped client JS with data-action delegation (frontend-builder agent); (5) tests: unit + integration incl. one permission-denial and one audit-row assertion (qa-tester agent); (6) integration one-liners (barrel export, PAGES+PAGE_ACCESS, NAV, router mount) — applied by the main session only; (7) verify: full test suite, then boot + render the page as 3 roles and check the real HTML. A slice with mock data, a page without its service, or a service without its page does NOT count as done. Finish with: files added/changed, test results, screenshots/HTML evidence.
