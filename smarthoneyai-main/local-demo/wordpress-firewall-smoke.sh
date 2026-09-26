#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$script_dir/isolated-target-guard.sh"
base_url="${WORDPRESS_INTERNAL_URL:-http://wordpress}"
assert_isolated_wordpress_target "$base_url"
host="${WORDPRESS_TEST_HOST:-localhost:8080}"
source_ip="${WORDPRESS_TEST_SOURCE:-8.8.4.4}"
user_agent="${WORDPRESS_TEST_USER_AGENT:-HoneypotE2E/1.0}"
path="${WORDPRESS_FIREWALL_PATH:-/blocked-test}"
expected="${WORDPRESS_EXPECTED_STATUS:-403}"

case "$expected" in
  200|403|429) ;;
  *) echo 'WORDPRESS_EXPECTED_STATUS must be 200, 403, or 429.' >&2; exit 2 ;;
esac
case "$path" in
  /*) ;;
  *) echo 'WORDPRESS_FIREWALL_PATH must begin with /.' >&2; exit 2 ;;
esac
clean_path="$(printf '%s' "$path" | tr -d '\r\n')"
[ "$clean_path" = "$path" ] || { echo 'WORDPRESS_FIREWALL_PATH contains a newline.' >&2; exit 2; }

secret="$(cat /run/secrets/wordpress_test_source_secret)"
request_status() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    -A "$user_agent" \
    -H "Host: $host" \
    -H "X-Honeypot-Test-Secret: $secret" \
    -H "X-Honeypot-Test-Remote-Addr: $source_ip" \
    "$base_url$1"
}

status="$(request_status "$path")"
# WordPress canonically redirects a published page to its trailing-slash URL.
# Retry that exact local target only for the fail-open expectation; deny tests
# retain the original path so an exact BLOCK_ROUTE rule remains meaningful.
if [ "$expected" = 200 ] && { [ "$status" = 301 ] || [ "$status" = 308 ]; }; then
  case "$path" in
    */) ;;
    *) status="$(request_status "$path/")" ;;
  esac
fi
secret=''

if [ "$status" != "$expected" ]; then
  printf 'Firewall smoke expected HTTP %s but received %s for %s.\n' "$expected" "$status" "$path" >&2
  exit 1
fi

printf 'Firewall smoke passed: %s returned HTTP %s for the synthetic test source.\n' "$path" "$status"
