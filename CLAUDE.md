# Q.view — EVC Business Operating Platform (سند)

Arabic-first enterprise platform for EVC (رؤية الخبراء الاستشارية): CRM opportunities, project portfolio (PMO), finance, staffing, clients, reports. The product code lives entirely in **`platform/`** — read `platform/CLAUDE.md` before touching it.

## Repository map
- `platform/` — the app (Node 22 + Express 5, SSR, dual SQLite/Postgres). All work happens here.
- `docs/` — original consulting analysis of the legacy platform (background reading only).
- `.claude/` — agents, skills, commands, hooks used to build and review this repo. Use them.

## Non-negotiable rules
1. **Old production platform `os.evcsol.com` is READ-ONLY.** It is the customer's live backup. Never deploy to it, never mutate its Railway project (`honest-spirit`), never write through its APIs.
2. **Staging deploys** go to Railway via `railway up` from `platform/` (staging.os.evcsol.com). Production releases happen only when the owner explicitly says so.
3. **Never commit secrets or sensitive data**: `seed/*.snapshot.json`, `seed/*.demo.json`, `.env`, `data/backups/*`, salaries, IPs, tokens. The Bash hook blocks these; do not work around it.
4. **Git**: work and push only on branch `claude/evc-platform-analysis-r5nsri`. GitHub pushes may 403 (App lacks write) — commit locally, deploy via Railway, report the blocker; don't retry pushes in a loop.
5. **Before any migration/backfill against live staging**: run `platform/scripts/pg-backup.sh` first (the hook reminds you; treat it as mandatory).
6. UI copy is Arabic-only, jargon-free — see `platform/src/web/i18n/glossary.js`. Never show technical terms (API/Schema/JSON/null/undefined) to users.

## Working style
- Follow the delivery contracts in `platform/docs/specs/07-contracts-delivery2.md` — routes, API shapes, and DDL there are frozen; extending them is fine, contradicting them is not.
- Verify like an owner: after changes, run `/quality` (or the relevant slice of it) and check the real rendered pages, not just unit tests.
- Small, reviewed, committed increments. Every write to the DB goes through the service layer with `audit(ctx, …)`.
