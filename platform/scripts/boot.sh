#!/bin/sh
# Production boot: schema + seeds, then server. Seed steps are idempotent and may return a non-zero
# code on a re-run/partial no-op; that must NOT stop the boot, so each is guarded with `|| true`.
# `exec` hands PID 1 to the server for correct signal handling (graceful shutdown).
node --experimental-sqlite scripts/migrate.js || true
node --experimental-sqlite scripts/seed-rbac.js || true
node --experimental-sqlite scripts/seed-staging.js || true
# idempotent legacy-history backfill (INSERT … ON CONFLICT DO NOTHING) — safe on every boot
node --experimental-sqlite scripts/backfill-legacy-activity.js || echo "backfill skipped"
# توحيد العملاء: دمج المكررين + تصنيف الأنواع. idempotent وقابل للعكس بذاته (حذف ناعم +
# تدقيق كامل بالتعيينات، لا حذف صلب) فلا يحتاج نسخة قبله؛ محروس بـ|| كي لا يوقف الإقلاع أبداً.
node --experimental-sqlite scripts/unify-clients.js || echo "unify-clients skipped"
exec node --experimental-sqlite src/server.js
