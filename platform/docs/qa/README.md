# QA lane — disposable local testing

Agent-driven and manual exploratory QA runs against a **throwaway local instance**, never the live deployment. The live Railway staging (staging.os.evcsol.com) is out of reach by design: the pre-guard hook denies `railway` commands and staging URLs outside a release session (`SANAD_RELEASE=1`).

## How to run one
```
cd platform
node scripts/qa-up.mjs                 # boot a seeded disposable instance (--scenarios for story data)
node scripts/sweep.mjs <printed-base>  # smoke: 16 roles × 21 pages × APIs, must be clean
# … explore the frontend (Playwright) + backend (HTTP) under one charter …
node scripts/qa-up.mjs --down          # tear down
```
Or drive it with an agent: **`/qa-explore <charter>`** launches the `qa-explorer` agent (Opus) following the `qa-explore` skill. Both are report-only — findings are filed, product code is not changed.

## Why it is safe
A local boot is air-gapped by construction: embedded SQLite (no `DATABASE_URL`), loopback host, mail written to `data/outbox/` (no network), AI local engine. `qa-up` never touches the team's dev DB (`data/sanad.db`); `sweep` defaults `SANAD_DB` to its own throwaway (`scripts/lib/throwaway-rbac-db.mjs`). See `.claude/skills/qa-explore/SKILL.md` for the full protocol and prohibitions.

## Findings
Each session writes a report here under `reports/YYYY-MM-DD-<charter>.md` (severity, persona, repro, expected-vs-actual, screenshots). Genuinely new defects also get a `KI-###` row in `../KNOWN-ISSUES.md` — the triage queue; the fixing commit later removes the row and adds a regression test (docs contract).

## Reports
- [2026-08-08 — «سحب الفرصة» withdrawal + v5.2 visibility (bd/sectorlead/deptmgr)](reports/2026-08-08-opportunity-withdrawal-and-v52-visibility.md) — flow + authz/IDOR verified correct; 2 low defects (KI-029 reason not server-enforced, KI-030 Arabic gender disagreement).
