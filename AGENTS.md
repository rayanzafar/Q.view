# Sanad — shared entry point for coding agents

Read `CLAUDE.md`, then `platform/CLAUDE.md` before any work. Those files remain the
authoritative engineering and release rules; this file does not relax them.

Read `platform/docs/BLUEPRINT.md` for the current delivery wave and acceptance
criteria. Use the existing services, SSR design system, permission checks and
audit trail. Keep decisions and verification evidence beside the code.

Use one implementation owner per change. A review checks the requirement, diff,
tests and actual rendered interface; it is not an endorsement of another agent's
summary. Report what could not be tested. Never claim an external connection,
push, deployment or data repair happened without verifying it.

Current release boundary: deliver a complete batch for owner trial; production
requires the owner's explicit acceptance. Historical spreadsheets are evidence
to reconcile, not an instruction to overwrite current business records.
