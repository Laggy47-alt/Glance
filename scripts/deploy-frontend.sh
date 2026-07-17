#!/usr/bin/env bash
# Pull + build + publish the frontend only.
# Run from the FRONTEND sparse-checkout clone (see help/SPLIT_DEPLOY.md).
set -euo pipefail

# --- config (override via env) ---
WEB_ROOT="${WEB_ROOT:-/var/www/abc-glance}"
NGINX_RELOAD="${NGINX_RELOAD:-0}"   # set to 1 to reload nginx after deploy
PKG_MANAGER="${PKG_MANAGER:-npm}"   # npm | bun

echo "==> [frontend] git pull"
git pull --ff-only

echo "==> [frontend] install deps ($PKG_MANAGER)"
case "$PKG_MANAGER" in
  bun) bun install --frozen-lockfile ;;
  npm) npm ci ;;
  *)   echo "unknown PKG_MANAGER=$PKG_MANAGER" >&2; exit 1 ;;
esac

echo "==> [frontend] build"
if [ "$PKG_MANAGER" = "bun" ]; then bun run build; else npm run build; fi

echo "==> [frontend] rsync dist/ -> $WEB_ROOT"
sudo rsync -a --delete dist/ "$WEB_ROOT"/

if [ "$NGINX_RELOAD" = "1" ]; then
  echo "==> [frontend] nginx reload"
  sudo nginx -t && sudo systemctl reload nginx
fi

echo "==> [frontend] done"
