#!/usr/bin/env bash
# Deploy CosmicSeeker to cosmic.soulview.org.
#
# Usage:
#   ./scripts/deploy.sh              # build+deploy frontend + backend
#   ./scripts/deploy.sh --front-only # only PWA, skip backend
#   ./scripts/deploy.sh --back-only  # only backend, skip PWA
#
# Pattern mirrors ../classic_games/deploy.sh: bake everything locally,
# rsync the artifacts, restart the systemd unit. Server has Node 20 +
# Nginx + Certbot pre-installed; this script does NOT install anything.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="root@157.180.45.83"
REMOTE_ROOT="/var/www/cosmic-seeker"

do_front=1
do_back=1
for arg in "$@"; do
  case "$arg" in
    --front-only) do_front=1; do_back=0 ;;
    --back-only)  do_front=0; do_back=1 ;;
    --help|-h)
      grep '^#' "$0" | head -15
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if (( do_front )); then
  echo "==> building frontend"
  cd "$ROOT"
  npm run build

  echo "==> rsync dist/ → $SERVER:$REMOTE_ROOT/frontend/dist/"
  rsync -avz --delete \
    --exclude='.DS_Store' \
    "$ROOT/dist/" "$SERVER:$REMOTE_ROOT/frontend/dist/"
fi

if (( do_back )); then
  echo "==> building backend (tsc)"
  cd "$ROOT/backend"
  npm run build

  echo "==> rsync backend → $SERVER:$REMOTE_ROOT/backend/"
  rsync -avz --delete \
    --exclude='node_modules' \
    --exclude='*.db' --exclude='*.db-*' \
    --exclude='.env' --exclude='*.bak' \
    --exclude='src' --exclude='tsconfig.json' \
    "$ROOT/backend/dist" \
    "$ROOT/backend/package.json" \
    "$ROOT/backend/package-lock.json" \
    "$SERVER:$REMOTE_ROOT/backend/"

  echo "==> reinstalling prod deps + restarting service"
  ssh "$SERVER" "
    cd $REMOTE_ROOT/backend &&
    npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3 &&
    chown -R www-data:www-data $REMOTE_ROOT &&
    systemctl restart cosmic-seeker-backend.service &&
    sleep 1 &&
    systemctl is-active cosmic-seeker-backend.service
  "
fi

echo "==> verify"
curl -fsS https://cosmic.soulview.org/api/health && echo
curl -fsSI https://cosmic.soulview.org/ 2>&1 | head -1

echo "==> done."
