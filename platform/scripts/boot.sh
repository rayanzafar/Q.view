#!/bin/sh
# Normal boot invokes migrations and technical security bootstrap, not data repairs.
# Immutable older migrations may contain data changes: release review must check the
# target's pending migration list before deployment, with its mandatory backup.
# Existing business records must not be corrected implicitly by a restart. Historical repairs
# (people/grants, stage dates, allocation, opportunity/project links and departments,
# legacy activity import) are NOT boot steps. Their existing scripts remain available
# for separately reviewed, per-record reconciliation after the owner's confirmation.
# A one-time migration stamp is not confirmation of an individual business change.
#
# Demo seeds are also deliberately absent, even if SANAD_SEED_DEMO=1 persists in the
# deployment environment: those scripts can rewrite accounts and link employees.
# Disposable QA creates its own fixtures through scripts/qa-up.mjs before the server.
# No environment switch re-enables business repairs on this boot path.
#
# Schema migration failure is fatal: never serve against a half-applied schema.
node --experimental-sqlite scripts/migrate.js || { echo "!! فشلت الترحيلة — يُوقَف الإقلاع كي لا يعمل الخادم على مخطط قديم" >&2; exit 1; }
# System role grants come from the versioned policy matrix; custom roles are untouched.
node --experimental-sqlite scripts/seed-rbac.js || true
# Initial admin provisioning has its own explicit identity and existing-account guards.
node --experimental-sqlite scripts/seed-admin.js || true
# PID 1 belongs to the server for graceful shutdown.
exec node --experimental-sqlite src/server.js
