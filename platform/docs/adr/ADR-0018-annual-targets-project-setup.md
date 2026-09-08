# ADR-0018 — Annual targets, project setup and preservation

Date: 2026-09-06. Status: implemented locally; not deployed. Owner direction is in BLUEPRINT.

## Problem

Sector targets lacked a year in readers, project conversion treated inherited amount as confirmed
contract and new health as green, reverse mirroring inferred sales year from execution, and boot
could run historical business repairs without per-record review.

## Decision

Reuse annual budget rows; add only revision via migration043. Do not migrate sector targets to
an assumed year or merge duplicate budgets. Read missing/conflicted annual values as unknown.
Write through existing budget grants and sector row checks with atomic revision condition and
an audit containing year, revision, reason, actor and before/after. Preserve monthly/cost fields.

A new won project retains its source identity, starts not-started/unassessed and exposes a guided
setup over persisted existing sections. Contract amount remains unconfirmed until entered.
A manually created project's mirrored opportunity has an explicit commercial year or unresolved
excluded status. Confirming that previously unknown year makes a new source=project mirror count;
known historic exclusions remain untouched. Won reversal must not auto-delete a linked project.

Unknown milestone dates cannot prove schedule health. Existing progress formulas are preserved
with explanatory evidence until owner review. No automatic historical recalculation.

Remove all historical business and demo invocations from normal boot, retaining scripts separately.
Migrations remain immutable; actual pending migration DML must be reviewed before release.

## Consequences and limits

Old unperiodized targets stay preserved and visible as evidence but no longer count in every year.
A guided checklist is not an approval state; cancellation and approved period-distribution editing
remain separate work. Existing monthly plans need consistency review when annual figures change.
No live data was edited. PostgreSQL and actual browser verification remain release requirements.
