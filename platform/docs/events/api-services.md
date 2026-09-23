# API and services

All routes below are relative to `/api` and require the authenticated request context installed by [the API router](../../src/modules/api.routes.js). JSON handlers return JSON; image and Excel handlers are called out separately. Permission failures follow the application’s Arabic forbidden response, absent/deleted records return the service’s Arabic not-found response (for example **`الفعالية غير موجودة`**), and validation errors return Arabic bad-request messages. The exact permission rules are in [Permissions](permissions-integrations.md#authorisation).

## Events and contacts

### JSON field shapes

| Payload / response object | Fields |
|---|---|
| Event create/patch | `name_ar`, `venue`, `starts_on`, `ends_on`, `booth_no`; create requires name and both dates. Returned event is `id,name_ar,venue,starts_on,ends_on,booth_no,created_by,created_by_name,created_at,updated_at,closed_at,status`. |
| Contact create | `kind`, `person_name`, `org_name`, `job_title`, `phone`, `email`, `website`, `note`, `raw_text`, `sector_id`, `capture_key`. The response identifies the contact and candidate duplicate; contact list rows omit raw text and normalisation/idempotency fields. |
| Contact generic patch | Any accepted create field except `raw_text` and `capture_key`; `kind`, `sector_id`, `note`, and contact fields are supported. It cannot carry `outcome`, outcome audit fields, duplicate pointer, capture identity/time, or deletion state. |
| Outcome patch | `outcome`, optional `outcome_note`. The response contains the updated contact with `outcome`, `outcome_note`, `outcome_by`, `outcome_by_name`, and `outcome_at`. |
| Partner create/patch | `org_name`, `partner_kind`, `contact_name`, `phone`, `email`, `website`, `scope_note`, `status`, `next_step`, `next_date`, `contact_id`; creation requires organisation. Returned partner also supplies captured/update metadata. |
| Meeting create/patch | `title`, `meeting_date`, `start_time`, `end_time`, `join_url`, `location`, `note`, `attendee_ids`; create requires title/date/start/end. Returned meeting includes its attendee objects and derived state. `POST /meetings/check` accepts the prospective date/time and attendee ids plus optional `except_id`, which excludes that meeting from its own overlap result during edit. `meeting_id` is not read by this endpoint. |
| Image requests | Raw bytes in the request body with `x-file-name`; QR additionally uses encoded `x-title`. There is no JSON/base64 upload shape. |

The single-contact response is the only normal JSON contact response that includes `raw_text`; it also includes `photos[]` (each image’s id, hash, MIME, byte size, uploader name/time, URL, and derived cover flag) and `may_edit`. `GET /photos` returns the same image metadata inside `{photos,may_edit}`. Image-byte routes do not return JSON.

| Method and path | Input | Success output | Validation and service behaviour |
|---|---|---|---|
| `POST /events/parse-card` | JSON `{text}`; service truncates text to 12,000 characters | Parsed person/org/title/phone/email/website plus `extra_phones` | No write or external network call. The parser’s own defensive ceiling is 24,000 characters/80 lines/200 characters per line and it returns empty fields for unusable text. |
| `GET /events` | `includeClosed` truthy optional | Event array with computed `status`, `contacts`, `partners` | Reads active events; closed rows excluded unless requested. |
| `POST /events` | `name_ar`, `starts_on`, `ends_on`; optional `venue`, `booth_no` | Created event with computed status | Requires manager create permission, non-empty name, real `YYYY-MM-DD` dates, and end not before start. Transaction plus event-create audit. |
| `GET /events/:id` | — | `{event, summary}` | Summary has contact totals, `byKind`, `byOutcome`, today, unreviewed, possible duplicate, and partner counts. |
| `PATCH /events/:id` | Any of create fields | Updated event | Update permission; at least one accepted field; same field/date rules. Ignores unknown fields. |
| `POST /events/:id/close` | `{reopen}` truthy to reopen | Updated event | Update permission. Writes/clears `closed_at`; it does not derive closure from date. |
| `DELETE /events/:id` | — | `{ok:true}` | Admin-only event delete. Soft-deletes event and physically removes all its blobs in one transaction. |
| `GET /events/:id/contacts` | `q`, `kind`, `outcome`, `mine`, `dup`, `limit` | Contact list, newest first, with derived photo data | `limit` integer 1–500 (default 100). Text searches person/org/phone/email and normalised phone; literal kind/outcome filters; `mine` uses caller id; `dup` needs a duplicate pointer. |
| `GET /events/:id/contacts/recent` | `limit` | `{rows,teamToday}` | Caller’s recent rows only, integer 1–50 (default 12). |
| `POST /events/:id/contacts` | Required `kind`; at least one of `person_name`, `org_name`, `phone`; optional fields in [data model](data-model.md#tables), `capture_key` | `{contact, possibleDuplicate, resumed}` | Open event and contact-create permission required. Validates kind, sector existence, field bounds; capture key retries recover the existing caller/event row, with `resumed:true`. Detects but permits same-event duplicates. |
| `GET /events/contacts/:cid` | — | Full contact, `may_edit`, ordered `photos` | Includes `raw_text` unlike list output. |
| `PATCH /events/contacts/:cid` | Editable contact fields and optional kind/sector/note | Updated contact row only; its `possible_duplicate_of` scalar reflects the recalculation | Contact-update permission. Rejects empty identity after merge, invalid kind/sector, and forbidden raw/idempotency/outcome fields. Recalculates candidate only against older contacts. Duplicate summary wrapping is returned only by contact create/resume. |
| `POST /events/contacts/:cid/outcome` | `outcome`, optional `outcome_note` | Updated contact | Contact-update permission; outcome must be in the five-value set. Records actor/time/name and dedicated audit. |
| `DELETE /events/contacts/:cid` | — | `{ok:true}` | Capturer with update permission may delete own card; cleanup permission permits another’s. Soft-deletes row and physically removes its photo blobs. |
| `GET /events/:id/contacts/export.xlsx` | Same `q/kind/outcome/mine/dup` filters | Binary XLSX attachment | Uses exactly the listing filter logic, maximum 5,000 rows; excludes raw text, normalisation fields, and idempotency key. Private/no-store, nosniff response and export audit include applied filters/row count. |

## Partners, photos, QR and meetings

| Method and path | Input | Success output | Validation and service behaviour |
|---|---|---|---|
| `GET /events/:id/partners` | — | Active partner list | Event read permission. |
| `POST /events/:id/partners` | `org_name`; optional partner fields | Created partner | Create permission; validates enums, date, field bounds, and any `contact_id` belongs to that event. No partner duplicate/idempotency facility. |
| `PATCH /events/partners/:pid` | Accepted partner fields | Updated partner | Creator or reviewer/update authority; validates the merged record. |
| `DELETE /events/partners/:pid` | — | `{ok:true}` | Creator/reviewer rule plus cross-user cleanup grant; soft delete. |
| `POST /events/contacts/:cid/photo` | Raw image body; encoded `x-file-name` header | `{ok,id,sha256,mime,size_bytes,added,photo_count,photo_url,url}` | Contact update permission. 8 MiB transport/service bound, JPEG/PNG/WEBP signature sniffing, per-card six and rolling user limits. Same SHA on that card returns existing blob with `added:false`, no write/audit. |
| `GET /events/contacts/:cid/photo` | optional `download=1` | Cover-image bytes | Authenticated reader only. Inline normally, attachment with `download`; content type comes from stored sniffed MIME. |
| `GET /events/contacts/:cid/photos` | — | `{photos,may_edit}` | Ordered image metadata, cover flag and uploader name. |
| `GET /events/contacts/:cid/photos/:bid` | optional `download=1` | Image bytes | The blob must be a photo of that contact; another contact’s photo or QR id is not found. |
| `DELETE /events/contacts/:cid/photos/:bid` | — | `{ok,photo_count,cover_sha,photo_url}` | Contact update permission; physical blob deletion. |
| `GET /events/:id/qr` | — | QR metadata list | Reader permission. |
| `POST /events/:id/qr` | Raw image body; encoded `x-title`, `x-file-name` | Created QR metadata | Event update permission; title at most 120, image validation/8 MiB and event/rolling limits. |
| `GET /events/:id/qr/:bid` | optional `download=1` | QR image bytes | Authenticated reader only; blob must belong to that event and be QR kind. |
| `DELETE /events/:id/qr/:bid` | — | `{ok:true}` | Event update permission; physical blob deletion. |
| `GET /events/:id/meetings` | `scope=all` optional | Meetings with attendees and derived state | Default is caller’s meetings; `all` returns all visible event meetings. |
| `POST /events/meetings/check` | `meeting_date`, `start_time`, `end_time`, optional `attendee_ids`, optional `except_id` | `{conflicts}` | Read permission. Missing/invalid day/time or end not after start returns an empty conflict list; otherwise caller is included among attendee ids and `except_id` is omitted from the cross-event overlap probe. It never blocks a save. |
| `GET /events/meetings/:mid` | — | Meeting and attendee data | Reader permission and active parent. |
| `POST /events/:id/meetings` | `title`, `meeting_date`, `start_time`, `end_time`; optional join/location/note/attendee ids | Created meeting | Create authority, Riyadh date/time, end after start, max 100 attendees, active selectable people, HTTP(S) link. Creator is added as attendee. |
| `PATCH /events/meetings/:mid` | Any accepted meeting/attendee fields | Updated meeting | Creator or meeting manager. Same merged validation; invitations are queued for additions/time changes. |
| `DELETE /events/meetings/:mid` | — | `{ok:true}` | Creator or meeting manager; soft deletes meeting and sends no cancellation email. |

## Binary response guarantees

Photo and QR GETs set stored `Content-Type`, `Content-Length`, `ETag` from SHA-256 and return 304 on matching `If-None-Match`. They set `X-Content-Type-Options: nosniff`, `Vary: Cookie`, and `Cache-Control: private, no-cache` unless session handling already set `no-store`. Their raw parser rejects compressed inflate, maps an over-limit Express 413 to the service’s Arabic 400, and maps malformed raw receipt to **`تعذّر استلام الصورة — أعد الالتقاط`**. Excel is an attachment with `private, no-store` and `nosniff`.

## Audit trail

Every successful mutation audits its resource: event create/update/close/delete; contact create/update/outcome/delete/photo; export; partner create/update/delete; blob QR create/delete and photo delete; meeting create/update/delete. These calls are in [events service](../../src/modules/events/events.js) and [meeting service](../../src/modules/events/meetings.js). SHA-duplicate photo retry intentionally performs no write and no audit.

| Operation | Audit action/resource | Material detail recorded |
|---|---|---|
| Create event | `create/event` | Arabic name and start/end dates |
| Update event | `update/event` | Accepted field names; close/reopen writes `closed` boolean |
| Delete event | `delete/event` | Event Arabic name |
| Create/update/outcome/delete contact | `create`, `update`, or `delete` / `event_contact` | Creation identity/kind/duplicate context; update field names and duplicate context; outcome value; deletion identity context |
| Export contacts | `export/event_contact` | Event id, applied filters, and exported row count |
| Create/update/delete partner | corresponding action / `event_partner` | Organisation, field names, or identity context |
| Add/delete card image | `photo/event_contact` or `delete/event_blob` | Image id/hash/MIME/size/count or removed blob detail |
| Add/delete QR | `create/event_blob` or `delete/event_blob` | QR title/image details or removed blob |
| Create/update/delete meeting | corresponding action / `event_meeting` | Title/time/attendee changes, including added/removed invitee names where relevant |
