---
name: sanad-conventions
description: Core engineering conventions for the Sanad platform — DB access, money, IDs, soft delete, transactions, portable SQL, RBAC, audit. Load before writing ANY platform/src code.
---
# Sanad conventions (the short law)

## Database
- Only through `src/core/db/index.js`: `all(sql, params)`, `get`, `run`, `exec`, `tx(fn)`, `insert(table, obj)`, `update(table, id, obj)`.
- Placeholders always `?` (rewritten to `$n` on Postgres). Values never interpolated into SQL strings.
- `insert`/`update` build parameterized SQL from object keys — preferred for writes.
- Transactions: `await tx(async () => { …multiple writes… })` — nested helper calls join the same tx automatically.

## Portable SQL (must run on SQLite AND Postgres)
- NO `date('now')`, `strftime`, `julianday` — compute in JS (`nowIso()`, slice dates) and BIND them; compare with `substr(col, 1, 10)`.
- Strict GROUP BY: every selected non-aggregated column appears in GROUP BY (grouping by PK is enough for its row's columns).
- A bare nullable param used as `? IS NULL` needs `CAST(? AS TEXT)`.
- Booleans are INTEGER 0/1. Quote aliases you'll read case-sensitively: `COUNT(*) AS "count"`.
- Aggregates return JS numbers on both drivers (PG type parsers installed) — never `parseInt` result fields defensively.

## Values
- IDs: `id('prefix')` → `emp_x…`; prefixes: act, imp, row, sv, doc, cli, opp, prj… keep 3–4 letters.
- Time: `nowIso()` ISO-8601 UTC TEXT. Dates as `YYYY-MM-DD` strings.
- Money: INTEGER **halalas**. `toHalalas(sar)` on input, `toSar`/`fmtSar` on output. Sum halalas, round once.
- Soft delete: `update(table, id, { deleted_at: nowIso() })`; every read filters `deleted_at IS NULL`.

## Authorization + audit (server-side, always)
- `can(user, action, resource, row?)` from `src/core/rbac/index.js`; action ∈ create/read/update/delete/approve/export/admin. Scope chain: company > sector > department > project > own — services filter lists with the scope helpers, and verify row-level sector/ownership on single-row ops (IDOR guard).
- Sensitive fields salary/margin/cost/ip: gate with `canSeeSensitive(user, field)`; redact in every serialization path (JSON, HTML, export).
- EVERY write: `await audit(ctx, { action, resource, resourceId, sectorId, detail })` where `ctx = { user, ip }`.
- Errors: `throw badRequest('عربي واضح')` / `forbidden()` / `notFound()` from `src/core/http/errors.js`.

## Module shape
`src/modules/<area>/<area>.js` (exported async service functions taking `(ctx|user, …)`) + `<area>.routes.js` (Express Router, thin: parse → call service → res.json). Mounted by ONE line in `api.routes.js` (integration session does this). Tests ship with the module.
