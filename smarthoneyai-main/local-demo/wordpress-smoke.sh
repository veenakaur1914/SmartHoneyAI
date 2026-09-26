#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$script_dir/isolated-target-guard.sh"
base_url="${WORDPRESS_INTERNAL_URL:-http://wordpress}"
assert_isolated_wordpress_target "$base_url"
host="${WORDPRESS_TEST_HOST:-localhost:8080}"
source_ip="${WORDPRESS_TEST_SOURCE:-8.8.4.$(( ($(date +%s) % 200) + 20 ))}"
secret="$(cat /run/secrets/wordpress_test_source_secret)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

status="$(curl --silent --show-error --output "$tmp_dir/home" --write-out '%{http_code}' -H "Host: $host" "$base_url/")"
[ "$status" = 200 ] || { echo "WordPress home returned HTTP $status" >&2; exit 1; }

status="$(curl --silent --show-error --output "$tmp_dir/response" --write-out '%{http_code}' \
  --request POST \
  -H "Host: $host" \
  -H "X-Honeypot-Test-Secret: $secret" \
  -H "X-Honeypot-Test-Remote-Addr: $source_ip" \
  -H 'Cookie: hp_e2e_cookie=HPA-E2E-COOKIE-CANARY' \
  -H 'Authorization: Bearer HPA-E2E-AUTH-CANARY' \
  --data-urlencode 'marker=HPA-E2E-MARKER-001' \
  --data-urlencode 'username=HPA-E2E-USERNAME-CANARY' \
  --data-urlencode 'password=HPA-E2E-PASSWORD-CANARY' \
  --data-urlencode 'token=HPA-E2E-TOKEN-CANARY' \
  "$base_url/phpmyadmin")"
case "$status" in
  401|404) ;;
  *) echo "Decoy /phpmyadmin returned unexpected HTTP $status" >&2; exit 1 ;;
esac

for route in \
  /secure-admin-login \
  /wp-content/backups/site-backup.zip
do
  status="$(curl --silent --show-error --output "$tmp_dir/response" --write-out '%{http_code}' \
    -H "Host: $host" \
    -H "X-Honeypot-Test-Secret: $secret" \
    -H "X-Honeypot-Test-Remote-Addr: $source_ip" \
    "$base_url$route")"
  case "$status" in
    401|404) ;;
    *) echo "Decoy $route returned unexpected HTTP $status" >&2; exit 1 ;;
  esac
done

status="$(curl --silent --show-error --output "$tmp_dir/response" --write-out '%{http_code}' \
  -H "Host: $host" \
  -H "X-Honeypot-Test-Secret: $secret" \
  -H "X-Honeypot-Test-Remote-Addr: $source_ip" \
  "$base_url/internal/admin-console")"
[ "$status" = 403 ] || { echo "Repeat honeypot attacker was not blocked after three distinct routes (HTTP $status)" >&2; exit 1; }
secret=''

echo "Three distinct inert honeypots activated an observation-mode local block; the next request returned HTTP 403."
