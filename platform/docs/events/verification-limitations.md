# Verification and limitations

## Executed evidence

A focused automated command was run at HEAD `0f2015b5298ad8390eb03cc5adc47873dadbd091` from `platform/`:

```text
node --experimental-sqlite --test "tests/integration/events*.test.js" "tests/security/events*.test.js" "tests/security/office-events-isolation.test.js" "tests/unit/events-card-parser.test.js" "tests/unit/mail-*.test.js" "tests/security/mail-recipient-guard.test.js" "tests/integration/events-home-banner.test.js"
```

It returned exit code 0: **130 passed, 0 failed, 0 skipped**. The selection covered event CRUD/isolation, photos and multi-photo storage, Excel export, home banner, event page/grant security, parser behaviour, and selected mail/recipient checks. A supplemental command also returned exit code 0: `node --experimental-sqlite --test tests/integration/event-meetings.test.js tests/security/event-meetings-gate.test.js 2>&1 | tail -n 100`, with **19 passed, 0 failed, 0 skipped**. This result is source/test-environment evidence; it is not a browser, PostgreSQL, SMTP, staging, or production assertion.

## Present tests not included in that command

The initial `events*.test.js` glob did **not** match singular `event-meetings.test.js` or `event-meetings-gate.test.js`; the supplemental command above covers both. The repository also contains event E2E coverage for capture, card review, meetings, management, OCR, and the home banner, but no E2E execution is claimed here. Test files establish intended checked behaviour only when their runner is actually reported as executed.

Relevant test locations include [integration events](../../tests/integration/events.test.js), [photo tests](../../tests/integration/events-photo.test.js), [multi-photo tests](../../tests/integration/events-photos-multi.test.js), [export tests](../../tests/integration/events-export.test.js), [meeting tests](../../tests/integration/event-meetings.test.js), [page gate](../../tests/security/events-page-gate.test.js), [grant tests](../../tests/security/events-grants.test.js), [parser tests](../../tests/unit/events-card-parser.test.js), and [home-banner tests](../../tests/integration/events-home-banner.test.js).

## Product limits and non-features

| Area | Current limitation |
|---|---|
| CRM handoff | A card outcome such as **`صارت فرصة`** records a review result only. It does not create or link a CRM opportunity, client, project, contact, or document. |
| Outcomes in browser UI | Contact outcomes are displayed and filtered, but the implemented page JavaScript has no selector/save action for the dedicated outcome API. |
| Partner UI | APIs and event-list partner counts exist, but no detail-page partner tab or editor is implemented. |
| OCR | Recognition is local and bounded, but output is heuristic and needs human review. Decorative/coloured Arabic cards may be inaccurate. |
| Event dates | An ended event remains capture-open until manually closed. A manual close hides it from ordinary API list results unless `includeClosed` is requested. |
| Meetings | Same-day Riyadh times only; conflicts warn but do not block; no recurrence, ICS, public calendar, or deletion cancellation email. A deletion still creates the in-app **`أُلغي اجتماع`** notification for attendees other than the deleter. |
| Images | JPEG/PNG/WEBP only; limits apply; blob deletions are irreversible; no file recovery endpoint. |
| Privacy/cache | Image and QR endpoints are authenticated and private-cache controlled, but an authorised user can open/download permitted images. |
| Security baseline | Application CSP remains Report-Only, and CSRF protection is currently enforced for URL-encoded form posts rather than JSON mutations; these are product-wide documented residual issues ([KNOWN-ISSUES](../KNOWN-ISSUES.md)). |
| Test scope | The confirmed focused run was SQLite-based. PostgreSQL compatibility, real SMTP delivery/worker behaviour, browser E2E, and deployed runtime behaviour were not executed as part of that evidence. |

## Documentation source discipline

This set reports code that is currently reachable through authenticated pages/routes and storage migrations. It intentionally excludes prototype material, operational record changes, workbooks, and post-event proposals. Existing historical ADR context is linked only where it explains an implemented current boundary.
