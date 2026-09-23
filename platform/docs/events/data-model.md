# Data model

The feature schema is created by migrations [038](../../migrations/038_events.sql), [039](../../migrations/039_event_blob_title.sql), [040](../../migrations/040_event_meetings.sql), and [041](../../migrations/041_event_card_photos.sql). All dates are ISO text. Most domain enumerations and cross-field rules are enforced in services, not SQL constraints.

## Tables

| Table | Columns | Purpose and lifetime |
|---|---|---|
| `event` | `id` PK; `name_ar`; `venue`; `starts_on`; `ends_on`; `booth_no`; `created_by`, `created_by_name`, `created_at`, `updated_at`; `closed_at`; `deleted_at` | One exhibition/conference. `name_ar`, start, and end are required in service input. `closed_at` is a manual capture stop. Deletion is soft. |
| `event_contact` | `id` PK; `event_id`; `kind`; person/org/title; `phone`, `phone_norm`; `email`, `email_norm`; `website`; `note`; immutable `raw_text`; `name_norm`, `org_norm`; `sector_id`; `capture_key`; `possible_duplicate_of`; outcome, note/by/name/at; capture/by/name/at; `updated_at`, `deleted_at` | Captured person/card. It must have one of person, organisation, phone. A deleted contact is filtered from all ordinary reads. |
| `event_partner` | `id` PK; `event_id`; `org_name`, `org_norm`; `partner_kind`; contact details; `scope_note`; `status`; `next_step`, `next_date`; optional `contact_id`; capture/by/name/at; `updated_at`, `deleted_at` | Potential organisation relationship. It may point to a card in the same event but that reference has no SQL foreign key. |
| `event_blob` | `id` PK; `event_id`; `kind`; `ref_id`; bytes `content`; `mime`, `size_bytes`, `sha256`; `uploaded_by`, `created_at`; nullable `title` | Card photos (`kind='card'`) and kiosk QR images (`kind='qr'`). Blob deletions are physical. |
| `event_meeting` | `id` PK; `event_id`; `title`; `meeting_date`; `start_time`, `end_time`; `join_url`; `location`; `note`; creator/by-name/time; `updated_at`, `deleted_at` | Same-day Riyadh wall-clock meeting. Soft delete hides it. |
| `event_meeting_attendee` | `id` PK; `meeting_id`; `user_id`, `user_name`; `added_by`, `added_at` | Current attendee list. Removing an attendee physically deletes this row; user name remains copied at insertion. |

`event_contact.event_id`, `event_partner.event_id`, `event_meeting.event_id`, and `event_meeting_attendee.meeting_id` are the declared internal foreign keys. The schema intentionally has no foreign keys for blob ownership, sector, duplicate reference, partner contact, attendee user, or event creator/capturer/reviewer identities. Names are copied into records so they remain readable if an account changes or is removed. There is no `ON DELETE CASCADE`; event deletion hides child rows through parent joins and explicitly erases its blobs.

## Complete column definitions

`TEXT` and `INTEGER` below are migration declarations (the portable migration runner adapts types for PostgreSQL); `BLOB` holds image bytes. `NOT NULL` is a database constraint, while enumerations and most content validation are service rules.

| Table | Column definition | Default / relationship |
|---|---|---|
| `event` | `id TEXT PRIMARY KEY`; `name_ar TEXT NOT NULL`; `venue TEXT`; `starts_on TEXT NOT NULL`; `ends_on TEXT NOT NULL`; `booth_no TEXT`; `created_by TEXT NOT NULL`; `created_by_name TEXT`; `created_at TEXT NOT NULL`; `updated_at TEXT`; `closed_at TEXT`; `deleted_at TEXT` | No declared FK for creator. Dates are real `YYYY-MM-DD` only by service validation. |
| `event_contact` | `id TEXT PRIMARY KEY`; `event_id TEXT NOT NULL REFERENCES event(id)`; `kind TEXT NOT NULL`; `person_name TEXT`; `org_name TEXT`; `job_title TEXT`; `phone TEXT`; `phone_norm TEXT`; `email TEXT`; `email_norm TEXT`; `website TEXT`; `note TEXT`; `raw_text TEXT`; `name_norm TEXT`; `org_norm TEXT`; `sector_id TEXT`; `capture_key TEXT`; `possible_duplicate_of TEXT`; `outcome TEXT NOT NULL`; `outcome_note TEXT`; `outcome_by TEXT`; `outcome_by_name TEXT`; `outcome_at TEXT`; `captured_by TEXT NOT NULL`; `captured_by_name TEXT`; `captured_at TEXT NOT NULL`; `updated_at TEXT`; `deleted_at TEXT` | `outcome` defaults to **`لم تُراجع`**. Sector, duplicate and user identities deliberately have no FK. |
| `event_partner` | `id TEXT PRIMARY KEY`; `event_id TEXT NOT NULL REFERENCES event(id)`; `org_name TEXT NOT NULL`; `org_norm TEXT NOT NULL`; `partner_kind TEXT`; `contact_name TEXT`; `phone TEXT`; `email TEXT`; `website TEXT`; `scope_note TEXT`; `status TEXT NOT NULL`; `next_step TEXT`; `next_date TEXT`; `contact_id TEXT`; `captured_by TEXT NOT NULL`; `captured_by_name TEXT`; `captured_at TEXT NOT NULL`; `updated_at TEXT`; `deleted_at TEXT` | `status` defaults to **`مبدئية`**. `contact_id` is service-checked but has no FK. |
| `event_blob` | `id TEXT PRIMARY KEY`; `event_id TEXT NOT NULL`; `kind TEXT NOT NULL`; `ref_id TEXT NOT NULL`; `content BLOB NOT NULL`; `mime TEXT NOT NULL`; `size_bytes INTEGER NOT NULL`; `sha256 TEXT NOT NULL`; `uploaded_by TEXT NOT NULL`; `created_at TEXT NOT NULL`; `title TEXT` | No FK declaration. `title` was added nullable by migration 039; card blobs leave it empty and QR blobs use it. |
| `event_meeting` | `id TEXT PRIMARY KEY`; `event_id TEXT NOT NULL REFERENCES event(id)`; `title TEXT NOT NULL`; `meeting_date TEXT NOT NULL`; `start_time TEXT NOT NULL`; `end_time TEXT NOT NULL`; `join_url TEXT`; `location TEXT`; `note TEXT`; `created_by TEXT NOT NULL`; `created_by_name TEXT`; `created_at TEXT NOT NULL`; `updated_at TEXT`; `deleted_at TEXT` | Creator is intentionally not an FK. Meeting time strings are Riyadh wall-clock values. |
| `event_meeting_attendee` | `id TEXT PRIMARY KEY`; `meeting_id TEXT NOT NULL REFERENCES event_meeting(id)`; `user_id TEXT NOT NULL`; `user_name TEXT`; `added_by TEXT`; `added_at TEXT NOT NULL` | `user_id`/`added_by` are intentionally not FKs. |

## Indexes and uniqueness

| Table | Index / constraint | Meaning |
|---|---|---|
| `event` | `ix_event_dates(starts_on, ends_on)` | Date-range list and active-event lookup support. |
| `event_contact` | `ix_evc_event_time(event_id,captured_at)`, `ix_evc_event_phone(event_id,phone_norm)`, `ix_evc_event_name(event_id,name_norm,org_norm)`, `ix_evc_event_email(event_id,email_norm)`, `ix_evc_captured_by(captured_by,captured_at)` | Event history, duplicate candidates, and “mine” queries. |
| `event_contact` | `ux_evc_capture_key(event_id,capture_key)` | A browser retry returns the same captured card instead of creating another one. Null capture keys remain SQL-null semantics. |
| `event_partner` | `ix_evp_event(event_id,captured_at)` | Event partner history. |
| `event_blob` | `ix_evb_event(event_id)`, `ix_evb_ref(kind,ref_id,created_at)` | Event deletion and ordered card-photo reads. Migration 041 removed the earlier unique `(kind,ref_id)` index, allowing multiple card photos. |
| `event_meeting` | `ix_evm_event(event_id,meeting_date,start_time)`, `ix_evm_date(meeting_date)` | Event schedule and day comparisons. |
| `event_meeting_attendee` | `ux_evma_meeting_user(meeting_id,user_id)`, `ix_evma_user(user_id)` | One attendee once per meeting and personal schedule lookup. |

## Normalisation, duplicate and lifecycle rules

Phone values fold Arabic/Persian digits and normalise Saudi forms. Email is lower-cased; person and organisation values use the shared entity-name normaliser. On create or generic edit, the service finds the oldest earlier active card in the *same event* matching normalised phone, normalised email, or both normalised person and organisation. It stores that id in `possible_duplicate_of`; duplicate detection flags rather than rejects. It never compares across events. `capture_key` idempotency is distinct from this business duplicate flag.

`raw_text` is preserved as the original pasted content and is not accepted by the generic contact update. Outcome is independently changed with its own audit fields. Contacts, partners, and meetings soft-delete; a photo, a QR blob, a deleted contact’s photo, and all event blobs when an event is deleted are permanently removed byte rows. The first photo by `(created_at,id)` is the derived cover; no `is_cover` column is stored.

Event deletion sets `event.deleted_at`, physically deletes `event_blob` records for the event, and leaves soft-visible child source rows in storage. Ordinary reads reach contacts, partners, and meetings through an active event and consequently conceal them. There is no restore endpoint.

## Value sets and limits

| Field | Accepted current values / bound |
|---|---|
| Contact `kind` | `تعريف بالشركة`, `شراكة`, `تعاون`, `توظيف` |
| Contact `outcome` | `لم تُراجع`, `تواصلنا`, `صارت فرصة`, `صارت شراكة`, `لا متابعة` |
| Partner `partner_kind` | `شراكة تقنية`, `تجارية / تسويقية`, `تنفيذ من الباطن`, `جهة حكومية`, `تدريب وتوظيف`, `أخرى` |
| Partner `status` | `مبدئية`, `قيد النقاش`, `مذكّرة تفاهم`, `اتفاقية موقّعة`, `نشطة`, `متوقّفة` |
| General compact field | 160 characters unless the service gives a narrower bound; booth is 40 |
| Contact / partner note | 4,000 characters; contact raw text stored at 12,000 characters |
| Parser bounds | The parser’s internal defensive bound is 24,000 characters, 80 lines, and 200 characters per line. Reachable `POST /events/parse-card` input is first truncated by the service to 12,000 characters; the implemented capture textarea itself has `maxlength=4000`. |
| Image request | Raw `image/*` or `application/octet-stream`, at most 8 MiB; only JPEG, PNG, WEBP signatures accepted |
| Uploaded files | At most six card photos per card, 12 QR images per event, 300 uploaded files and 500 MiB rolling per user/day |
| Export | At most 5,000 contacts after the same applied filters |
| Meeting | Valid day and HH:MM, end later than start on that day, at most 100 attendees, optional HTTP(S) link |
