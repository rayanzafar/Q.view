# QA session — «سحب الفرصة» (opportunity withdrawal) + v5.2 visibility

- **Date**: 2026-08-08
- **Charter**: الفرص — the «سحب الفرصة» withdrawal flow, and the v5.2 visibility model, as `demo.bd` vs `demo.sectorlead` vs `demo.deptmgr`.
- **Instance**: disposable local boot (pre-booted by parent), base `http://127.0.0.1:34931`, temp DB `/tmp/sanad-qa-qWfJZX/sanad.db`, `scenarios:false`. Report-only; no product code changed; no deploy; loopback only.
- **Tooling**: `scripts/sweep.mjs` (smoke), Playwright (Chromium resolved via `scripts/e2e.mjs chromiumPath()`; pinned `/opt/pw-browsers/chromium-1194` was absent, fell back to Playwright-managed `~/.cache/ms-playwright/chromium-1228` as `scripts/e2e.mjs` allows), cookie-jar HTTP probes (login pattern from `scripts/sweep.mjs`), read-only `node:sqlite` against the temp DB.
- **Screenshots**: session scratchpad (not committed — repo-bloat rule): `opps-bd.png`, `opps-sectorlead.png`, `opps-deptmgr.png`, `bd-seeded-menu.png`, `bd-detail-created.png`, `bd-created-menu.png`, `bd-withdraw-modal.png`, `bd-withdraw-reason-required.png`.

## Verdict
The withdrawal flow and the v5.2 visibility model **work as designed** end-to-end (UI + API). Authz is honest across every probe. Two **low**-severity defects were found (one contract-vs-implementation gap, one Arabic copy bug), plus two informational notes. Smoke sweep clean: 848 requests, 0 leaks, 0 banned jargon, all statuses matched.

---

## What was exercised

### Smoke
`node scripts/sweep.mjs http://127.0.0.1:34931` → **clean**: 16 roles × 21 pages × 26 API probes + AI lane, 848 requests, 0 leaks, 0 jargon, P95 8 ms. (`scratchpad/sweep.json`)

### Frontend (Playwright)
- **v5.2 list visibility** at 1440 + 390, no console errors, no leak tokens, no horizontal overflow for any of the three personas.
- **demo.bd withdrawal**: seeded card ⋯ menu, a bd-**created** opportunity's ⋯ menu + detail page, the withdraw modal (cascade preview + required reason), reason-required inline error, and the successful withdraw.

### Backend (HTTP, per-persona cookie jars)
`removal-check` + `DELETE /api/opportunities/:id` for creator / non-creator / cross-sector IDOR / same-sector-not-owned / delete-grant holder / non-existent.

### Number vs truth
demo.bd pipeline header cross-checked against the temp SQLite read-only.

---

## v5.2 visibility — CONFIRMED CORRECT (informational)

Opportunity LIST at `/app/opportunities` (card markers counted as `data-action="open-opp"`; each opp renders twice — kanban card + table row — so occurrences = 2 × opp count):

| Persona | Role / scope | Opps shown | DB truth (owner/sector) | Verdict |
|---|---|---|---|---|
| `demo.bd` | `bd_manager` / **own** | 6 (12 markers) | 6 opps where `owner_user_id = demo.bd` | ✓ sees only their own |
| `demo.sectorlead` | `sector_lead` / **sector** | 7 (14 markers) | 7 opps in `SOLUTIONS` | ✓ whole sector |
| `demo.deptmgr` | `department_manager` / **department** | 0 | 0 (see note B) | ✓ fails closed, clean empty state |

`demo.bd` seeing only its own book is exactly the v5.2 flip (ADR-0005, KI-025). `demo.deptmgr` correctly renders «… · 0 فرصة · القيمة المرجّحة ‏0 ر.س.‏» with no leak/error — the documented fail-closed behavior for a department manager with an empty department set (`src/core/rbac/scope.js:98-111`).

---

## Withdrawal flow — CONFIRMED CORRECT (informational)

`demo.bd` created an opportunity via the app's own JSON API (`POST /api/opportunities` → 200, `created_by = demo.bd`), which is the only way to reach the creator path on this seed (see note A):

- **List ⋯ menu**: the created card carries `data-candel="1"`; the menu shows «سحب الفرصة…». A seeded opp `demo.bd` *owns but did not create* (`FX-OPP-1`, `created_by = null`, bd has no delete grant) correctly shows **no** withdraw control — only the edit actions. (`bd-seeded-menu.png`, `bd-created-menu.png`)
- **Detail page** `/app/opportunity/:id`: the «سحب الفرصة…» bar renders for the created opp. (`bd-detail-created.png`)
- **Withdraw modal**: shows the cascade preview («لا يتبعها شيء — تُسحب وحدها» + «سجل مراحلها يبقى في الأثر») and a required reason field; the `removal-check` call correctly returned `blockers:[]`, `removable:true`, and the full cascade list (all counts 0 on this seed — no dependents, no time entries, no source project). (`bd-withdraw-modal.png`)
- **Reason required (client)**: clicking «سحب الفرصة» with an empty reason surfaces the inline Arabic error «اكتب سبب السحب أولاً — يُسجَّل في الأثر» and does not submit. (`bd-withdraw-reason-required.png`)
- **Withdraw succeeds**: with a reason, the opp disappears from the list (soft delete), toast «سُحبت الفرصة — والسبب مسجَّل».

### Backend authz matrix — all correct

| # | Persona | Call | Status | Expected | ✓ |
|---|---|---|---|---|---|
| 1 | demo.bd | `POST /api/opportunities` (create) | 200 | 200 | ✓ |
| 2 | demo.bd | `GET /opportunities/:own/removal-check` | 200 (`removable:true`) | 200 | ✓ |
| 3 | demo.bd | `DELETE /opportunities/:own` (creator, ownDelete) | 200 | 200 | ✓ |
| 4 | demo.pm | `DELETE /opportunities/FX-OPP-1` (non-creator, no delete grant) | **403** | 403 | ✓ |
| 5 | demo.consultant | `DELETE /opportunities/FX-OPP-1` (non-creator) | **403** | 403 | ✓ |
| 6 | demo.bd | `DELETE /opportunities/FX-OPP-CONS` (IDOR, CONSULTING sector) | **403** | 403 | ✓ |
| 7 | demo.bd | `DELETE /opportunities/FX-OPP-7` (IDOR, same sector, not owner/creator) | **403** | 403 | ✓ |
| 8 | demo.bd | `GET /opportunities/FX-OPP-CONS/removal-check` (cross-sector read) | **403** | 403 | ✓ |
| 9 | demo.bd | `DELETE /opportunities/<missing>` | 404 | 404 | ✓ |
| 10 | demo.sectorlead | `DELETE /opportunities/FX-OPP-7` (delete grant, sector scope) | 200 | 200 | ✓ |

Forbidden bodies are the clean Arabic «حذف الفرصة يتطلب صلاحية إدارية على قطاعه» / «صلاحيتك لا تسمح بهذا الإجراء». No stack traces, no 500s, no unredacted fields.

### Number vs truth — MATCHES
demo.bd `/app/opportunities` header shows **«6 فرصة · القيمة المرجّحة 2,570,000»**. Read-only DB computation for `owner_user_id = demo.bd`: count = **6**; open-only weighted (Σ value×win%, excluding won/lost) = 1,500,000 + 750,000 + 120,000 + 200,000 = **2,570,000 SAR**. Exact match — the weighted pipeline correctly excludes the won (900,000) and lost opps.

---

## Findings

### F-1 — Withdrawal reason is enforced only in the browser, not by the API (audit gap) — **low**
- **Severity**: low (accountability/contract gap; actor is authorized and audited; soft-delete is recoverable — no data/money/security exposure).
- **Persona**: any withdrawer (reproduced as `demo.bd`).
- **Endpoint**: `DELETE /api/opportunities/:id`.
- **Repro**:
  1. As `demo.bd`, `POST /api/opportunities` to create an opp (created_by = self).
  2. `DELETE /api/opportunities/:id` with an **empty body** (no `reason`).
  3. Observe HTTP **200** and inspect `audit_log` for that resource.
- **Expected**: per CHANGELOG v5.1 the withdraw «**يطلب سبباً يُسجَّل في التدقيق**» (requires a reason recorded in audit) — a reasonless withdraw should be refused server-side (as the comparable "won reversal" is: `moveStage` throws `badRequest('… اكتب سبب التراجع قبل الحفظ.')`, `src/modules/crm/opportunities.js:379-381`).
- **Actual**: the DELETE succeeds and the audit row reads `"حذف الفرصة «QA سحب بلا سبب»"` with **no `— السبب:` suffix**. The reason requirement lives only in the page JS (`src/web/public/pages/opps.js:438`, `src/web/views/opportunity-detail.js`); the service treats it as optional (`opts.reason ? … : ''`, `src/core/lifecycle/remove.js:317-318`) and the route passes it through without a check (`src/modules/api.routes.js:108`).
- **Evidence**: probe output (audit detail with/without `السبب`) — `scratchpad/probe.mjs`; tracked as **KI-029**.

### F-2 — Arabic gender disagreement in the "already withdrawn / not found" message — **low**
- **Severity**: low (user-facing copy defect; Arabic-correctness bar).
- **Persona**: any user double-submitting or racing a withdraw (reproduced as `demo.bd`).
- **Endpoint**: `DELETE /api/opportunities/:id` on an already-withdrawn or non-existent opp.
- **Repro**: `DELETE /api/opportunities/<missing-or-already-withdrawn-id>` as any user allowed to delete.
- **Expected**: «الفرصة **غير موجودة أو محذوفة** سابقاً» (feminine agreement).
- **Actual**: «الفرصة **غير موجود أو محذوف** سابقاً» — masculine adjectives on the feminine noun «الفرصة». The message uses a shared template `${cfg.label} غير موجود أو محذوف سابقاً` (`src/core/lifecycle/remove.js:271`); it reads correctly for masculine labels («المشروع» / «الحساب») but wrong for «الفرصة». Reachable on a concurrent/stale withdraw.
- **Evidence**: probe #9 body — `scratchpad/probe.mjs`; tracked as **KI-030**.

### Note A — On the default demo seed, `demo.bd` never sees «سحب الفرصة» on their existing book — informational
All six seeded opps `demo.bd` owns have `created_by = null`, and `bd_manager` has no `delete` grant (only create/read/update). So `candel = canDeleteAny || created_by === user.id` is false for every seeded card — the withdraw control appears only after `demo.bd` creates a new opp. This is **correct behavior** (creator-or-delete-grant), but worth flagging: an evaluator walking the demo data would conclude the feature is missing for BD unless they create an opportunity first. Not a code defect.

### Note B — v5.2 department-manager visibility can only be seen in its fail-closed state on a default boot — informational (ref KI-009)
There are **0 departments** in this seed and `demo.deptmgr` manages none, because `seedDemoOrg` is skipped every boot — the already-tracked **KI-009** (`seed-roles` crash under demo-seed). Consequently the *positive* department-manager path (seeing their department's primary + partner opps) cannot be exercised here; only the fail-closed empty case is observable. This is a **test-coverage limitation caused by KI-009**, not a new defect — `tests/security/opportunity-visibility.test.js` covers the positive path at the unit level. Consider `--scenarios` or fixing KI-009 to make department-manager visibility demoable.

### Note C — `removal-check` reports `removable:true` for an opp the caller cannot delete — informational
`GET /opportunities/FX-OPP-1/removal-check` as `demo.bd` returns 200 `removable:true` (the endpoint guards **read**, then previews data-blockers), yet `DELETE` on it returns 403. The UI never reaches this (the button is gated by `data-candel`), and no data beyond what `demo.bd` can already read is exposed, so this is not a security issue — but the preview's `removable` reflects data blockers, not the caller's delete authority, which could mislead a direct API consumer. Left as an observation (no KI).

---

## Environment integrity
No `railway`/staging/`.env` access; all traffic to `http://127.0.0.1:34931`. Only mutations were net-zero create+withdraw pairs plus the intentional `demo.sectorlead` delete of `FX-OPP-7` (delete-grant probe). The dev DB (`platform/data/sanad.db`) was never touched — all reads used `SANAD_DB=/tmp/sanad-qa-qWfJZX/sanad.db`.
