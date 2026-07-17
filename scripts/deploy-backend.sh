#!/usr/bin/env bash
# Pull + deploy edge functions + apply new SQL migrations.
# Run from the BACKEND sparse-checkout clone (see help/SPLIT_DEPLOY.md).
set -euo pipefail

# --- config (override via env) ---
SUPABASE_DB_URL="${SUPABASE_DB_URL:-}"         # postgres://... for psql
DEPLOY_FUNCTIONS="${DEPLOY_FUNCTIONS:-1}"      # 1 = deploy edge functions
APPLY_MIGRATIONS="${APPLY_MIGRATIONS:-1}"      # 1 = apply self-hosted-migrations/*.sql
RESTART_FUNCTIONS="${RESTART_FUNCTIONS:-0}"    # 1 = docker compose restart functions
COMPOSE_DIR="${COMPOSE_DIR:-$HOME/supabase-project}"

echo "==> [backend] git pull"
BEFORE="$(git rev-parse HEAD)"
git pull --ff-only
AFTER="$(git rev-parse HEAD)"

# --- Apply new SQL migrations ---
if [ "$APPLY_MIGRATIONS" = "1" ]; then
  if [ -z "$SUPABASE_DB_URL" ]; then
    echo "!! SUPABASE_DB_URL not set — skipping migrations"
  else
    echo "==> [backend] applying new migrations since $BEFORE"
    CHANGED_SQL="$(git diff --name-only --diff-filter=A "$BEFORE" "$AFTER" -- 'self-hosted-migrations/*.sql' || true)"
    if [ -z "$CHANGED_SQL" ]; then
      echo "   (no new SQL migrations)"
    else
      for f in $CHANGED_SQL; do
        echo "   -> $f"
        psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
      done
    fi
  fi
fi

# --- Deploy changed edge functions ---
if [ "$DEPLOY_FUNCTIONS" = "1" ]; then
  echo "==> [backend] deploying changed edge functions"
  CHANGED_FNS="$(git diff --name-only "$BEFORE" "$AFTER" -- 'supabase/functions/*' \
      | awk -F/ 'NF>=3 && $1=="supabase" && $2=="functions" {print $3}' \
      | sort -u || true)"
  if [ -z "$CHANGED_FNS" ]; then
    echo "   (no edge function changes)"
  else
    for fn in $CHANGED_FNS; do
      [ -d "supabase/functions/$fn" ] || continue
      echo "   -> $fn"
      supabase functions deploy "$fn" --no-verify-jwt
    done
  fi
fi

if [ "$RESTART_FUNCTIONS" = "1" ]; then
  echo "==> [backend] docker compose restart functions"
  ( cd "$COMPOSE_DIR" && docker compose restart functions )
fi

echo "==> [backend] done"
