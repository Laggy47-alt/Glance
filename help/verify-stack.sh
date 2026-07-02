#!/usr/bin/env bash
# Glance self-hosted end-to-end verification.
# Usage:
#   export SUPABASE_URL=https://supabase.abcglance.co.za
#   export ANON_KEY=eyJ...          # anon/publishable key
#   export SERVICE_ROLE=eyJ...      # service role key (optional; skips some checks if missing)
#   export ADMIN_USER=admin
#   export ADMIN_PASS='Abcsec2008'
#   export ORG_SLUG=abc-2026
#   bash help/verify-stack.sh
set -u
: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${ANON_KEY:?set ANON_KEY}"
: "${ADMIN_USER:=admin}"
: "${ADMIN_PASS:?set ADMIN_PASS}"
: "${ORG_SLUG:=abc-2026}"

pass() { printf "\033[32m✔ %s\033[0m\n" "$*"; }
fail() { printf "\033[31m✘ %s\033[0m\n" "$*"; }
info() { printf "\033[36m➜ %s\033[0m\n" "$*"; }

H_ANON=(-H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")

info "1/8  REST reachable"
code=$(curl -sk -o /dev/null -w '%{http_code}' "${H_ANON[@]}" "$SUPABASE_URL/rest/v1/organizations?select=id&limit=1")
[[ "$code" == "200" ]] && pass "REST 200" || fail "REST $code"

info "2/8  unifi-ingest reachable (should return JSON, not HTML)"
body=$(curl -sk "$SUPABASE_URL/functions/v1/unifi-ingest" -X POST -H 'content-type: application/json' -d '{}')
echo "$body" | head -c 200; echo
echo "$body" | grep -q '^{' && pass "returns JSON" || fail "returned HTML/other (Cloudflare origin misrouted?)"

info "3/8  functions container SUPABASE_URL (via any public URL echo)"
# admin-users/seed returns organization_id; if internal URL leaks anywhere new rows will have kong:8000
echo "  (checked via new events below)"

info "4/8  login as $ADMIN_USER@$ORG_SLUG.local.app"
login=$(curl -sk "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_USER@$ORG_SLUG.local.app\",\"password\":\"$ADMIN_PASS\"}")
TOKEN=$(echo "$login" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)
[[ -n "$TOKEN" ]] && pass "logged in" || { fail "login failed: $login"; exit 1; }

H_USER=(-H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN")

info "5/8  admin-users list-orgs (super-admin check)"
orgs=$(curl -sk "$SUPABASE_URL/functions/v1/admin-users/list-orgs" -X POST "${H_USER[@]}" -H 'content-type: application/json' -d '{}')
echo "$orgs" | head -c 300; echo
echo "$orgs" | grep -q '"ok":true' && pass "list-orgs ok" || fail "list-orgs failed"

info "6/8  latest unifi_events + media_items (public storage host check)"
curl -sk "${H_USER[@]}" "$SUPABASE_URL/rest/v1/media_items?select=id,snapshot_url,clip_url,created_at&order=created_at.desc&limit=3" | head -c 600; echo
urls=$(curl -sk "${H_USER[@]}" "$SUPABASE_URL/rest/v1/media_items?select=snapshot_url&order=created_at.desc&limit=5")
if echo "$urls" | grep -q 'kong:8000\|http://localhost'; then
  fail "media_items still contain internal hosts — functions SUPABASE_URL not applied. Recreate the functions container."
else
  pass "media URLs use public host"
fi

info "7/8  unifi_camera_sites populated (bridge inventory)"
cams=$(curl -sk "${H_USER[@]}" "$SUPABASE_URL/rest/v1/unifi_camera_sites?select=id&limit=1")
[[ "$cams" != "[]" ]] && pass "cameras present" || fail "no cameras — bridge hasn't posted inventory yet"

info "8/8  hikvision + frigate instances reachable"
curl -sk "${H_USER[@]}" "$SUPABASE_URL/rest/v1/hikvision_instances?select=id,name,last_seen_at&limit=5"
echo
curl -sk "${H_USER[@]}" "$SUPABASE_URL/rest/v1/frigate_instances?select=id,name,last_seen_at&limit=5"
echo

pass "verification complete"
