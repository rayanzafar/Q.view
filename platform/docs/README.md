# docs/ — map and maintenance contract

The code is the source of truth; these documents are its ledger. Four of them form the **standing dev baseline** (ARCHITECTURE, FEATURES, KNOWN-ISSUES, CHANGELOG) and are enforced by `scripts/check-docs.mjs`, which runs inside `npm run quality` and fails the build when a page, migration, or module is missing from FEATURES.md, when a baseline doc is missing/empty, or when KNOWN-ISSUES contains `TODO(` placeholders.

## The map

| File | What it is | When it must change |
|---|---|---|
| `README.md` | This map + the maintenance contract. | When a doc is added/retired or a rule changes. |
| `ARCHITECTURE.md` | System map: runtime, layers, data flow, deploy topology. | Same commit as any structural change (new layer, driver, boot step, cross-module contract). |
| `FEATURES.md` | Feature registry: every page (`## Pages`, keys in backticks), every migration (`| NNN ` rows), every `src/modules/<name>`, with routes/APIs. | **Same commit** as any new/renamed page, route, migration, or module. The gate enforces presence; you keep the row's content truthful. |
| `KNOWN-ISSUES.md` | Open defects and deliberately deferred work, one row each. | Row **added the moment a defect is discovered**; row **removed in the fixing commit** (which also adds a regression test + CHANGELOG entry). Never `TODO(` stubs — write the item fully or not at all. |
| `CHANGELOG.md` | Per-change narrative: what, why, gates run, honest defect notes. | One entry per notable change, **monotonic version**, explicit deployed/not-deployed marker (deploy status per entry, not assumed). |
| `SECURITY-REPORT.md` | Security posture: closed gaps, residual risks, pre-launch items. | After every security-relevant merge (authz, session, secrets, redaction, headers). |
| `PRODUCTION-READINESS.md` | Go-live assessment; external blockers with exact owner actions. | When a blocker opens/closes or a readiness fact changes. |
| `OPEN-DECISIONS.md` | Owner decisions pending (D1–D17), each with the interim assumption in force. | When a decision is taken (remove/resolve) or a new one surfaces. |
| `SESSION-HANDOFF.md` | Historical continuity brief for a past session hand-over. | Frozen — background reading only; do not update, write a new one if a hand-over needs it. |
| `CONSULTING-REVIEW.md` | Tier-1 consulting review of executive dashboards/reports (Arabic). | Historical input — frozen. |
| `benchmarks.md` | Research summary: best-practice patterns adapted for EVC. | Historical input — frozen. |
| `adr/ADR-000*.md` | Architecture Decision Records (monolith/SSR, data conventions, DB driver). | New ADR for every **irreversible or structural** decision; existing ADRs are amended with status notes, never rewritten. |
| `guides/` | Runbooks: `GO-LIVE.md`, `DEPLOYMENT.md`, `ROLLBACK.md`, `BACKUP-RESTORE-DRILL.md`, `ADMIN-and-USER.md`. | When the procedure they describe changes (env vars, boot steps, drill results). |
| `specs/07-contracts-delivery2.md` | The **frozen delivery contract**: routes, API shapes, DDL. | Extending is fine; contradicting is not (see `/CLAUDE.md`). |
| `specs/01–06, 00, 08` | Original analysis/specs — **frozen historical reference**. Known stale in places (e.g. `*_sar NUMERIC` vs implemented `*_halalas INTEGER`). | Never — on any divergence, **code + ADRs win** (declared in `specs/README.md`). |
| `evidence/` | Screenshot evidence packs per deploy/lane (Playwright). | Appended by `scripts/evidence.mjs` at each verified deploy; never edited by hand. |

## The contract, in one paragraph

A change is not done when the code works; it is done when the ledger matches. Page/route/migration/module ⇒ FEATURES row, same commit. Structural change ⇒ ARCHITECTURE, same commit; irreversible decision ⇒ new ADR. Defect found ⇒ KNOWN-ISSUES row now; defect fixed ⇒ row deleted + regression test + CHANGELOG entry. Notable change ⇒ CHANGELOG entry with monotonic version and deploy marker. Security-relevant merge ⇒ SECURITY-REPORT update. `npm run quality` runs `scripts/check-docs.mjs` and turns drift into a red build — do not weaken the gate; update the doc.
