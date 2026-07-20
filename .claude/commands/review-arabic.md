---
description: Independent Arabic copy review of changed files (glossary consistency, jargon, tone, errors) via the arabic-reviewer agent.
---
Determine the changed files (git diff against the last deployed tag, or $ARGUMENTS if paths were given). Launch the **arabic-reviewer** agent on them with the glossary (`platform/src/web/i18n/glossary.js`) as reference. Then triage its findings: apply every *blocker* fix yourself immediately (respecting the glossary), list *polish* items with your disposition, and re-run `node platform/scripts/check-glossary.mjs` to confirm zero banned terms. Report: findings table (file, before → after, severity, status).
