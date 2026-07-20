#!/bin/sh
# Stop hook: when source changed since the last run, run the fast unit suite (informational only).
# Always exits 0 — it reports, it never traps the session in a loop.
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
MARK="$ROOT/.claude/.edited"
LAST="$ROOT/.claude/.tested"
[ -f "$MARK" ] || exit 0
if [ -f "$LAST" ] && [ "$LAST" -nt "$MARK" ]; then exit 0; fi
cd "$ROOT/platform" 2>/dev/null || exit 0
if ls tests/unit/*.test.js >/dev/null 2>&1; then
  OUT=$(timeout 90 node --experimental-sqlite --test tests/unit/ 2>&1 | tail -6)
  echo "[stop-hook] fast unit suite:"
  echo "$OUT"
fi
date > "$LAST"
exit 0
