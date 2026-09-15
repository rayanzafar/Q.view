#!/usr/bin/env bash
# One-shot staging deploy/refresh for سند. Safe to re-run. Does NOT touch the old platform.
# Run ON your server (the one serving os.evcsol.com), as a user that can write to /opt/sanad.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/sanad}
REPO=${REPO:-https://github.com/rayanzafar/Q.view.git}
BRANCH=${BRANCH:-claude/evc-platform-analysis-r5nsri}
PORT=${PORT:-4100}

echo "▶ سند staging deploy → $APP_DIR (port $PORT, branch $BRANCH)"

# 1) get / update the code
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" pull origin "$BRANCH"
else
  sudo mkdir -p "$APP_DIR" && sudo chown "$(id -u):$(id -g)" "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

cd "$APP_DIR/platform"

# 2) install deps (Node 22+ required for built-in node:sqlite)
# No `|| npm install` fallback: lockfile drift must fail here, not silently resolve other versions.
npm ci --omit=dev

# 3) apply schema migrations on every deploy (new numbered files are additive; safe to re-run)
node --experimental-sqlite scripts/migrate.js

# 4) seed the demo DB the FIRST time only (never overwrites an existing db)
if [ ! -f data/sanad.db ]; then
  echo "▶ seeding demo data (first run)"
  npm run seed
else
  echo "▶ existing data/sanad.db kept (no reseed)"
fi

# 4) (re)start the service
if systemctl list-unit-files | grep -q sanad-staging.service; then
  sudo systemctl restart sanad-staging
  echo "▶ restarted sanad-staging"
else
  echo "⚠ service not installed yet — see DEPLOY-STAGING-AR.md step 4"
fi

# 5) health check
sleep 3
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && echo "✓ app healthy on :$PORT" \
  || echo "… app starting; check: journalctl -u sanad-staging -n 40"
echo "✓ done. Point staging.os.evcsol.com at this server and run certbot for TLS."
