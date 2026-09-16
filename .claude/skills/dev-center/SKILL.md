---
name: dev-center
description: Work Sanad's «مركز التطوير» product desk as an agent — read triaged items, fix approved ones, capture before/after evidence, resolve with a version tag. Load before touching product_item data or acting on a SND-NNN item.
---

# مركز التطوير — how an agent works this desk

«مركز التطوير» (`/app/dev-center`) is where Sanad's own bugs and suggestions live, plus the
company's sold products. This skill is the working contract for a Claude session acting as a
member of a product team.

## Item keys

Every item has a stable key `<PREFIX>-NNN` — Sanad's prefix is `SND`, so `SND-042`. The prefix
belongs to the product (`product.item_prefix`) and the number comes from that product's own
counter, so numbers never collide across products and never get reused.

**Always name the item by its key, never by its internal id** — in commit messages, in task
titles, in comments, in reports. The key is what the reporter sees in their email and what the
owner reads on the screen. An approved item's task is titled with the key already.

## Connecting

The assistant connects through **«ربط المساعد»** in the Sanad sidebar — OAuth 2.1 + PKCE at
`/mcp`, i.e. `/mcp` in an interactive Claude Code session, once per person. The link carries the
**employee's own identity**: every tool call runs with that person's permissions and every audit
row names them, with the assistant shown as «‹اسم المساعد› · عبر ‹صاحب الحساب›».

There are **no per-product service keys**. Do not try
`claude mcp add --header "Authorization: Bearer sk_…"` — that design was dropped (ADR-0019,
ADR-0020) and nothing on the server accepts it.

Tools appear only for members of at least one product, and the decision tools
(approve/decline) refuse anyone who is not that product's manager.

## The tools (exact names — `src/modules/products/tools.js`)

Read (no preview needed):
`sanad_dc_list_products` · `sanad_dc_list_items` · `sanad_dc_get_item` · `sanad_dc_list_comments`

Add-only writes (they change nothing that already exists, so they are one step):
`sanad_dc_add_comment` · `sanad_dc_upload_image`

Everything that changes state is **preview → apply**, in pairs. The preview returns a one-shot
token valid 15 minutes; the apply tool takes **that token and nothing else** — pass any other
field and it refuses:

| preview | apply | what it does |
|---|---|---|
| `sanad_dc_preview_triage` | `sanad_dc_apply_triage` | size, estimated hours, priority, developer note |
| `sanad_dc_preview_status` | `sanad_dc_apply_status` | move the item between states (this is also how an item is resolved, needs-info'd, or marked duplicate) |
| `sanad_dc_preview_approve` | `sanad_dc_apply_approve` | approve + assign; creates the task in the same transaction |
| `sanad_dc_preview_decline` | `sanad_dc_apply_decline` | decline with the reason the reporter will read |
| `sanad_dc_preview_create_item` | `sanad_dc_apply_create_item` | file an item on someone's behalf |

There is **no** `sanad_dc_resolve` and no `get_item`: resolving is `preview_status` with
`status: RESOLVED` and a `versionId`, and reading one item is `sanad_dc_get_item`. Do not guess a
tool name — if it is not in this list it does not exist.

## The four workflows

### ١. Triage a new item
Read the item (`sanad_dc_get_item`) and its images. Then set, through
`sanad_dc_preview_triage` → `sanad_dc_apply_triage`: size (S/M/L), estimated hours, developer
priority, and a developer note saying **what will actually be changed** in the code — not a
restatement of the complaint. Move it to «بانتظار الاعتماد» when the study is done. If the
report is not actionable as written, move it to «بحاجة لتوضيح» with the question — the reporter
gets that question by email and answers from their tracking page. Both moves go through
`sanad_dc_preview_status` → `sanad_dc_apply_status`.

### ٢. Fix an approved item
Only «معتمد» items get worked — a manager approves with
`sanad_dc_preview_approve` → `sanad_dc_apply_approve`, which creates the task and assigns it in
the same transaction, so the work is tracked where all work is tracked. Move the item to
«قيد التنفيذ» when you start (`preview_status` → `apply_status`). Keep the item key in the
branch name and the commit message.

### ٣. Capture before/after evidence
Load the **`playwright-evidence`** skill and drive a disposable local instance (`/qa-explore`
or `scripts/qa-up.mjs`) — never the live deployment. Shoot the same screen twice, at the same
width, with the same data: once on the code before the fix, once after. Upload each with
`sanad_dc_upload_image` (`kind: before` / `kind: after`). The printable report puts them side by side, and that
pair is the whole evidence the owner reads.

### ٤. Resolve with a version tag
Resolving is `sanad_dc_preview_status` → `sanad_dc_apply_status` with the resolved state **and a
version** (`versionId`) — create the version on the product's settings tab if this release does
not have one yet, labelled the way the changelog labels it (`v5.83`). Resolving emails the
reporter, marks the linked task done, and notifies the reporters of every item marked duplicate
of this one. So do it once, and only when the fix is actually in the branch.

## Rules that do not bend

- **Any staging access is a release action, gated on `export SANAD_RELEASE=1`** — and staging
  deploys go through `SANAD_RELEASE=1 npm run deploy` from `platform/`, never `railway up`.
  Reading a live item, running the seed against live, opening the staging URL: all release
  actions. Exploratory work runs on a disposable local instance.
- **The decline reason reaches the reporter.** Write it as something a colleague can read.
- **No raw stored value in anything a person reads.** Arabic labels come from
  `src/modules/products/labels.js` (re-exported by the glossary) — never type `RESOLVED`,
  `bug` or `critical` into a comment, an email or a screen.
- Never invent a reporter. An item added on behalf of someone (`preview_create_item`, or
  «سجّل عن غيرك» on the product screen) picks them from the platform's own accounts when they
  have one — so the mail of every step reaches them — and carries a free-typed name only when
  they have no account. The **sector is required either way**, because that is what the reports
  group by.
