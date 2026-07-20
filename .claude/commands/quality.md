---
description: Run ALL quality gates (syntax, glossary, tests, fresh-DB smoke, sweep, RTL/a11y, build sanity, email render, io round-trip, perf). Never skip or weaken a failing gate.
---
Run the full Sanad quality pipeline from `platform/`, in this order, stopping to root-cause (not bypass) any failure. Report a gate-by-gate table at the end.

1. **Syntax**: `find src scripts -name '*.js' -o -name '*.mjs' | xargs -I{} node --check {}` — zero errors.
2. **Glossary/jargon**: `node scripts/check-glossary.mjs` — zero banned terms in user-visible strings.
3. **Unit+integration+security tests** (SQLite): `node --experimental-sqlite --test "tests/**/*.test.js"` — all pass.
4. **Fresh-DB smoke**: temp `SANAD_DB`, run `scripts/migrate.js` + `scripts/seed-rbac.js` + `scripts/seed.js` — boots clean.
5. **Live-render sweep**: boot the server on a free port with the seeded demo DB, run `node scripts/sweep.mjs http://127.0.0.1:<port>` — zero deviations (status, leaks, jargon).
6. **RTL + a11y (Playwright)**: `node scripts/e2e.mjs` — rtl.spec (no horizontal scroll 1440/390) + a11y.spec (no serious/critical axe violations) pass.
7. **Build sanity**: verify `.railwayignore`/`.gitignore` still exclude secrets AND include vendor/brand/fonts; `node --experimental-sqlite scripts/migrate.js` idempotent on an already-migrated DB.
8. **Email render**: render all report templates to `data/outbox/` via the engine test-send path — valid HTML, no leaks, Arabic subjects.
9. **Import/export round-trip**: run the io round-trip test cases (export → reimport = 100% skip) for every adapter.
10. **Perf smoke**: from the sweep timings, P95 page render < 800ms locally; flag any page over it.

If a gate fails: fix the root cause, add a regression test, re-run from gate 1. Finish with the summary table + overall verdict.
