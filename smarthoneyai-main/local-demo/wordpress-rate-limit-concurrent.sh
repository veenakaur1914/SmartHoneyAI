#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$script_dir/isolated-target-guard.sh"
base_url="${WORDPRESS_INTERNAL_URL:-http://wordpress}"
assert_isolated_wordpress_target "$base_url"
host="${WORDPRESS_TEST_HOST:-localhost:8080}"
source_ip="${WORDPRESS_TEST_SOURCE:-8.8.4.4}"
user_agent="${WORDPRESS_TEST_USER_AGENT:-HoneypotE2E/1.0}"
requests="${WORDPRESS_CONCURRENT_REQUESTS:-8}"
allowed="${WORDPRESS_EXPECTED_ALLOWED:-2}"
secret="$(cat /run/secrets/wordpress_test_source_secret)"
tmp_dir="$(mktemp -d)"
trap 'secret=""; rm -rf "$tmp_dir"' EXIT HUP INT TERM

case "$requests:$allowed" in
  *[!0-9:]*|:*|*:|*:*:*) echo 'Concurrent request settings must be integers.' >&2; exit 2 ;;
esac
[ "$requests" -ge 2 ] && [ "$requests" -le 32 ] && [ "$allowed" -ge 1 ] && [ "$allowed" -lt "$requests" ] || {
  echo 'Concurrent request settings are outside the safe local-test bounds.' >&2
  exit 2
}

i=1
while [ "$i" -le "$requests" ]; do
  (
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      -A "$user_agent" \
      -H "Host: $host" \
      -H "X-Honeypot-Test-Secret: $secret" \
      -H "X-Honeypot-Test-Remote-Addr: $source_ip" \
      "$base_url/" > "$tmp_dir/$i.status"
  ) &
  i=$((i + 1))
done
wait

allowed_count="$(grep -l '^200$' "$tmp_dir"/*.status | wc -l | tr -d ' ')"
limited_count="$(grep -l '^429$' "$tmp_dir"/*.status | wc -l | tr -d ' ')"
expected_limited=$((requests - allowed))
if [ "$allowed_count" -ne "$allowed" ] || [ "$limited_count" -ne "$expected_limited" ]; then
  printf 'Expected %s HTTP 200 and %s HTTP 429 responses; got %s and %s. Statuses: ' \
    "$allowed" "$expected_limited" "$allowed_count" "$limited_count" >&2
  tr '\n' ' ' < "$(find "$tmp_dir" -name '*.status' | sort | head -n 1)" >&2 || true
  for status_file in "$tmp_dir"/*.status; do printf '%s ' "$(cat "$status_file")" >&2; done
  printf '\n' >&2
  exit 1
fi

printf 'Concurrent rate limit passed: %s allowed and %s limited across %s simultaneous requests.\n' \
  "$allowed_count" "$limited_count" "$requests"
