---
name: add-tasks-on-behalf
description: Backfill tasks into Sanad on an employee's behalf via scripts/add-tasks-on-behalf.mjs — often already-done, backdated work a manager wants logged. Load before running that script or building its input file.
---
# Adding tasks on behalf of an employee (often backdated)

Use this when a manager/admin wants tasks logged for a specific employee that already
happened (or should be pre-created and later marked done), rather than the employee
entering them one by one. The tool is `platform/scripts/add-tasks-on-behalf.mjs` —
general-purpose, driven entirely by a JSON input file (see the script's header for the
exact shape). Read `sanad-conventions` first for the DB/audit/portable-SQL ground rules;
this skill only covers what's specific to this pipeline.

## Ask first — every time, before writing the input file
Never guess on these. If the request is even slightly ambiguous, list the candidates and
ask rather than picking one:
1. **Ambiguous domain terms** — a vendor/product/system name in a task title that could
   map to more than one project (e.g. "the camera project" when two camera-tagged
   projects exist). List the candidate `project_id`s by name and ask which one.
2. **Due-date / week mapping** — "this week" / "last week" is meaningless without an
   anchor date. Confirm the exact `YYYY-MM-DD` for each batch before generating rows.
3. **Attribution** — confirm both ends explicitly: who is *creating* the task
   (`actor_email`, shows as `created_by`) vs who it should read as *completed by*
   (`assignee_email`'s own account is always used for the done-stamp, per the script's
   design — say so, don't assume the actor completes their own backfill).
4. **Notification suppression** — ask whether pings are wanted. There is **no clean
   suppress switch** in `quickAddTask`/`notify.js` today (checked: no `ctx` flag, no
   param). Every created task fires "task assigned to you" at creation time regardless of
   `mark_done`. For a historical backfill this is almost always wrong — say this plainly
   before running, don't quietly hack around notification internals to "fix" it.
5. **Live-staging write** — this is a release action. Always run
   `platform/scripts/pg-backup.sh` first (verify the dump is non-empty) and require
   `SANAD_RELEASE=1` in the shell before touching staging Postgres.

## Pipeline
1. Build the input JSON (`actor_email`, `assignee_email`, `tasks[]` — see script header
   for fields: `title`, `description?`, `due_date`, `work_kind`, `project_id?`,
   `mark_done`, `completed_at?` for backdating, `notify`).
2. Test both drivers locally first: a scratch SQLite (`scripts/lib/qa-instance.mjs`
   `buildDb()`, or `SANAD_DB=<scratch path>`) and a throwaway local Postgres (e.g.
   `docker run --rm -e POSTGRES_PASSWORD=x -p <port>:5432 postgres:16-alpine`, then
   `scripts/migrate.js` + `scripts/seed-rbac.js` + `scripts/seed.js` +
   `scripts/lib/seed-fixture.mjs` against it). Confirm dry-run output matches intent on
   both before touching staging.
3. `platform/scripts/pg-backup.sh` against staging (mandatory, not optional — state the
   backup filename in your report).
4. `--dry-run` (the default, no flag needed) against real staging data via the
   `railway run --service Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node …'`
   recipe (`SANAD_RELEASE=1` required) — sanity-check row counts against what you agreed
   in step "Ask first" #1–2.
5. `--apply` for real. Capture the printed task ids.
6. Reconcile: query `task` by `assignee_user_id` and recent `created_at`; confirm count,
   `status`, `due_date`, `completed_at`, `completed_by`, `project_id`/`work_kind`,
   `created_by` all match the plan.
7. Report: backup filename, dry-run vs applied counts, reconciliation table, whether
   notifications actually fired (they will, until `tasks.js`/`notify.js` grow a suppress
   switch — that's a known gap, not a task for this script to solve), rollback note (soft
   delete the created task ids if the batch must be undone — there is no bulk auto-revert).

## Boundaries
- INSERT/UPDATE only, through `quickAddTask`/`updateTask` — never touches other
  employees' rows, never TRUNCATEs/DELETEs, never invents a synthetic actor id (load the
  real `app_user` row by email).
- Re-running `--apply` on the same input file creates **duplicate** tasks (no stable key
  to `ON CONFLICT` on) — run each input file once, verify by query before any re-run.
