---
description: Boot a disposable local Sanad instance and run an agent-driven exploratory QA session under a charter (frontend + backend), then collect the findings report. Report-only; never touches the live deployment.
argument-hint: <charter, e.g. "الفرص — سحب الفرصة as demo.bd vs demo.sectorlead">
---
Run a full exploratory QA pass against a throwaway local instance. The charter is: **$ARGUMENTS** (if empty, pick one high-value surface from the last CHANGELOG entry's claims and state your choice).

Steps:
1. From `platform/`, boot: `node scripts/qa-up.mjs` (add `--scenarios` if the charter needs story-shaped data). Capture the base URL and temp DB path from its output / `qa-instance.json`.
2. Smoke it: `node scripts/sweep.mjs <base>` — it must be clean before exploring. If it is not clean for an infrastructure reason, fix the boot, not the report.
3. Launch the **qa-explorer** agent (model: opus) with the charter and the base URL, instructing it to follow the `qa-explore` skill: explore the frontend with the pinned Chromium (patterns in `tests/e2e/_helpers.mjs`) and probe the backend over HTTP, filing findings to `platform/docs/qa/reports/YYYY-MM-DD-<charter-slug>.md` with severity, persona, repro steps, expected-vs-actual, and screenshots. Report-only — it must not edit product code, commit, deploy, or touch the live deployment.
4. When the agent returns, tear down: `node scripts/qa-up.mjs --down`; confirm no stray server and that `platform/data/sanad.db` is unchanged.
5. Print a summary: the charter, findings ranked by severity, the report path, and any new `KNOWN-ISSUES.md` rows added — then stop. Do not fix the findings in this session; fixes go through the normal dev flow with regression tests.
