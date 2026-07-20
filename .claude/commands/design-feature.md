---
description: Design a feature within Sanad constraints (data → service → API → UI → tests) using the architect agent, before any code. Usage: /design-feature <feature>
---
Feature: $ARGUMENTS

Launch the **architect** agent with this feature, the relevant `/audit-current-experience` findings if any, and the benchmarks digest (`platform/docs/benchmarks.md`). Require its standard ≤80-line design (data reuse first, service surface + permissions, API per contracts doc, UI decision-story order + states + glossary terms, the ≤4 integration one-liners, test assertions, risks). Review the design yourself against `docs/specs/07-contracts-delivery2.md` — reject contract drift. Record the approved design as a dated section in `platform/docs/specs/08-feature-designs.md` and state which workpackage/lane implements it.
