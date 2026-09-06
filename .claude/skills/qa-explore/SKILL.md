---
name: qa-explore
description: Drive a disposable local Sanad instance as an end-to-end QA session — boot it, smoke it, explore the frontend (Playwright) and backend (HTTP) under a charter, and file structured findings. Report-only; never edits product code, never touches the live deployment. Load before any exploratory/manual QA pass.
---
# QA exploration — the disposable-instance playbook

You are testing Sanad the way an owner would: boot a throwaway copy, use it hard, and write down every real defect with a repro. You **find and report** — you do not fix product code, commit, push, or deploy. Fixes go through the normal dev flow afterward.

## The environment is air-gapped by construction — keep it that way
A local instance uses embedded SQLite (never a live DB), binds loopback only, writes mail to files, and runs the AI local engine. You keep it safe by **never** doing any of these:
- Never run `railway` anything, never target `staging.os.evcsol.com` or any `*.up.railway.app` — the pre-guard hook denies these outside a release session, and QA is never a release session.
- Never set `DATABASE_URL`, `AI_ENGINE`, or `MAIL_TRANSPORT`. Never read, print, or copy any `.env` file (the repo root `.env` holds a live token).
- Never `git commit`/`push`, never edit files under `platform/src`, `platform/migrations`, or `platform/scripts`. Your only writes are your report and screenshots.
- Work only against the `http://127.0.0.1:<port>` base that `qa-up` prints.

## Protocol

### 1 — Boot
```
cd platform && node scripts/qa-up.mjs            # add --scenarios for story-shaped data
```
It prints the base URL, the temp DB path, the PID, and writes state to `<scratchpad>/qa-instance.json` (or `/tmp/sanad-qa/qa-instance.json`). All 16 demo personas exist locally (unlike staging): usernames `demo.<role>` — admin, ceo, sectorlead, bd, pm, hr, consultant, employee, viewer, deptmgr, linemgr, bdhead, ops, procurement, approver, external. The password is exported as `DEMO_PW` from `scripts/seed.js` — read it, never hardcode it.

### 2 — Smoke (must be clean before you explore)
```
node scripts/sweep.mjs <base>
```
This logs in as every persona and checks all 21 pages + API probes for status, `undefined|NaN|[object|null` leaks, and banned Arabic jargon. A broken environment is not a finding — if the sweep is dirty for infra reasons, fix the boot, not the report. (The sweep defaults `SANAD_DB` to its own throwaway, so it never touches the dev DB.)

### 3 — Pick one charter
One focus per session; log it at the top of the report. Examples:
- **A page**: one screen from `scripts/lib/expectations.mjs` PAGES, every state and interaction.
- **A flow**: opportunity → won → mirrored project → deliverable → progress claim → collection; or task quick-add → approval → reopen → delete.
- **A persona pair**: what `demo.bd` sees vs `demo.sectorlead` vs `demo.deptmgr` on الفرص (the v5.2 visibility model), or salary redaction across roles.
- **A regression sweep** of the last CHANGELOG entry's claims.

### 4 — Explore the frontend (Playwright)
Reuse the proven patterns — read `tests/e2e/_helpers.mjs` (`login`, `open`, `collectErrors`, `pagesFor`) and the `playwright-evidence` skill. Launch the pinned Chromium via `chromiumPath()` from `scripts/e2e.mjs`. Per persona in your charter: log in, walk the surface, and **exercise real interactions** — submit forms, drag kanban cards, open drill-downs and modals, use filters, reload mid-flow. Watch for:
- Console/page errors (`collectErrors`; ignore resource-load 401/403/404 via `realConsoleErrors`).
- Leak regex `undefined|NaN|[object|null(?![a-z])` in visible text.
- Banned jargon (`BANNED_UI_TERMS` from `glossary.js`) shown to the user.
- RTL overflow at 1440 and 390 (`scrollWidth - clientWidth > 1`), clipped/reordered numbers.
- Dead buttons, actions that 403 the user after appearing to succeed, wrong empty states.
- **Numbers vs truth**: open the temp SQLite (`SANAD_DB` path from the state file) read-only and cross-check a figure the page shows against the row it came from.
- **Authz surprises**: compare what two personas see of the same record; a value one role must not see appearing for another is a finding.

### 5 — Probe the backend (HTTP)
Same session, with a persona's cookie jar (the `sweep.mjs` login pattern): hit APIs directly with malformed input, boundary values (money is integer halalas — try 0, negative, non-numeric, huge), and IDOR probes using the fixture's cross-sector row. A 500, a stack trace, an unredacted field, or a mutation that should have been forbidden is a finding.

### 6 — File findings — report only
Write one report per session to `platform/docs/qa/reports/YYYY-MM-DD-<charter-slug>.md` and add its line to `platform/docs/qa/README.md`. Each finding must have: **severity** (high/med/low), **persona**, **URL/endpoint**, **numbered repro steps**, **expected vs actual**, and a **screenshot** (save small crops to the scratchpad — never commit large images; repo-bloat rule). A finding without repro steps and evidence is not a finding — re-verify or drop it.
- **Dedupe** against `platform/docs/KNOWN-ISSUES.md` and the open items in `platform/docs/CHANGELOG.md` before writing — don't re-report a known deferral.
- For each genuinely new defect, also add a `KI-###` row to `KNOWN-ISSUES.md` (that file is the triage queue; the fixing commit later removes the row + adds a regression test per the docs contract). This is the one product-doc write you may make — it is a bug report, not a code change.

### 7 — Teardown
```
node scripts/qa-up.mjs --down
```
Confirm the server PID is gone and no temp instance is left. Leave the dev DB (`platform/data/sanad.db`) untouched — verify its checksum is unchanged if you touched anything unusual.

## Finding-quality bar
Report the defect, not the fix. State what a user does, what they see, and what they should have seen. Judge Arabic UX coherence (is the copy clear and jargon-free?), number correctness, and authz honesty — these are where a human owner feels the product, and where deterministic tests are weakest.
