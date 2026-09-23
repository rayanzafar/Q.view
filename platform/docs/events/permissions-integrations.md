# Permissions and integrations

## Authorisation

The page gate is `can(user,'read','event')`; all event API routes first require an authenticated session. Event resources use company-level access rather than sector/department list scoping. A user’s ordinary role and unexpired personal grants are both evaluated by the shared RBAC implementation. Exact capability decisions stay server-side in [events service](../../src/modules/events/events.js).

| Actor | Read event/contact/partner/meeting | Create/update/close event | Delete event | Cards and card photos | Partners | Meetings |
|---|---|---|---|---|---|---|---|
| `admin` | All | All | Yes | Create/update/delete all | Create/update/delete all | Create/update/delete all |
| `sector_lead`, `ceo_office` | All | Create, update, close | No | Create/update/delete all | Create/update/delete all | Create/update/delete all |
| `bd_head` | All | Create, update, close | No | Create/update all; delete own captured card | Create/update any (review role); delete own | Create/update own; delete own |
| `department_manager`, `project_manager`, `bd_manager`, `bd_team`, `procurement`, `hr`, `operations`, `consultant`, `employee`, `approver` | All | No | No | Create/update all; delete own captured card | Create/update own; delete own | Create/update own; delete own |
| `line_manager`, `office_member`, `office_coordinator` | All in current service behaviour | No | No | Create/update all; delete own captured card | Create/update own; delete own | Create/update own; delete own |
| `viewer` | All, read-only | No | No | No | No | No |
| `external` | No | No | No | No | No | No |

The table deliberately separates permission metadata from the current service calls. Events are company resources and none of their list/read/write checks passes a target row to `can()`. Consequently `line_manager`, `office_member`, and `office_coordinator` have department-scoped matrix grants but `can()` treats them as existing permissions, and the current event service exposes company-wide event data/actions shown above. This is current behaviour, not a row-isolation guarantee. Other role rows carry company grants.

Meeting modification is creator-or-event-manager; meeting read is event-meeting read. Generic contact edits and all card photo additions/deletions use contact-update authority without capturer ownership, so every non-viewer internal role can edit any active card and its photos. Contact deletion is tighter: an ordinary role can delete its own captured card, while the event managers can delete any. Partner update requires both partner-update authority and ownership or one of the review roles (`admin`, `sector_lead`, `bd_head`, `ceo_office`); delete follows ownership or a delete grant. The matrix supplies the extra partner/contact/meeting delete grants only to `sector_lead` and `ceo_office` (besides admin’s wildcard).

Personal grant pairs are company-level: `event:create`, `event:update`, `event_contact:delete`, and `event_partner:delete`. The **`إدارة الفعاليات`** bundle supplies the first two; **`تنظيف سجلات الفعاليات`** supplies the latter two. `event:delete` is intentionally no longer grantable: stale stored rows are filtered by `grantsForUser()` and do not open event deletion. See [matrix rules](../../src/core/rbac/matrix.js), [grant declaration](../../src/modules/identity/grants.js), and [ADR-0013](../adr/ADR-0013-events-isolated-module.md).

## Browser drafts and card recognition

Drafts remain in the browser’s `sessionStorage`, keyed to current event and user, with a 24-hour expiry and no photo bytes. Local OCR loads self-hosted Tesseract assets with Arabic and English language data and executes in the browser. The recognition image and text do not leave the device for OCR. Pasted card text sent to `POST /events/parse-card` is parsed by local application code, also without an external API call.

The parser normalises Unicode NFC, removes zero-width characters, folds Arabic/Persian digits, extracts email/site/phone (excluding fax), and uses Arabic/English heuristics for organisation, title, and name. It is assistive: it returns fields to review, does not create a contact, and cannot establish that an OCR result is correct. [ADR-0014](../adr/ADR-0014-ocr-in-browser-self-hosted.md) records the self-hosted/browser-only decision.

## Photos and QR kiosk

Photos and QR images live in database blobs because the deployed container filesystem is not durable. Reads have no public route: they require the same authenticated event reader and stored-blob ownership checks. MIME is determined from accepted file signatures rather than request headers, and response headers prevent content sniffing and shared caching. QR images are a private, authenticated kiosk display; they do not make a visitor-facing public QR destination or form.

The card photo upload is additive. The first retained image is a calculated cover, and a matching SHA-256 on that same card is a successful idempotent response without additional storage. Six images per card and 12 QR images per event are service limits. Deleting a card photo, QR image, or event permanently deletes blob bytes. There is no undelete basket.

## Meetings, notifications and mail

Meeting times use `meeting_date`, `start_time`, and `end_time` as Riyadh (+03:00) wall-clock text. The system checks overlaps for invitees across events and reports them as warnings; it does not reserve time or prevent save. New invitees and relevant meeting time changes create in-app notifications and queue emails. Deleting a meeting sends each attendee other than the deleting user an in-app **`أُلغي اجتماع`** notification, but does not queue a cancellation email. No recurring meetings, calendar feed, or ICS attachment is implemented.

Delivery is owned by the existing mail subsystem, not the events module. Its preview transport writes local preview HTML; SMTP requires configured host/user/password/from values and has connection/greeting/socket timeouts. The scheduler is in-process every 60 seconds except where the production arrangement supplies its external worker. The queue has status/attempt handling (up to four attempts), including sent, previewed, blocked, and failed outcomes. These are integration mechanics, not evidence a particular invitation was delivered. Refer to [mail configuration](../guides/MAIL-CHANNELS.md) and [mail transport](../../src/core/mail/smtp.js).

## Home and other product boundaries

On **`صفحتي`**, `activeEvents(today)` supplies a banner only to users admitted to `الفعاليات`; it includes open events whose dates include today. The main calendar remains sourced from tasks, milestones, and deliverables, not event meetings. The events area does not write CRM, projects, clients, documents, or calendar records. Partner and outcome labels do not create a CRM partner, an opportunity, or a formal agreement.
