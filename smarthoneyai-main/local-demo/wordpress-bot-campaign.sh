#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$script_dir/isolated-target-guard.sh"
base_url="${WORDPRESS_INTERNAL_URL:-http://wordpress}"
assert_isolated_wordpress_target "$base_url"
host="${WORDPRESS_TEST_HOST:-localhost:8080}"
source_ip="${BOT_SOURCE_IP:-8.8.8.77}"
campaign="${BOT_SIMULATION_ID:-local-bot-simulation}"
user_agent="${BOT_USER_AGENT:-Mozilla/5.0 (compatible; SmartHoneyBotSim/1.0; +local-authorized)}"

case "$campaign" in
  *[!A-Za-z0-9_-]*|'') echo 'BOT_SIMULATION_ID contains unsafe characters.' >&2; exit 2 ;;
esac

secret="$(cat /run/secrets/wordpress_test_source_secret)"
tmp_dir="$(mktemp -d)"
trap 'secret=""; rm -rf "$tmp_dir"' EXIT HUP INT TERM

request() {
  label="$1"
  method="$2"
  path="$3"
  expected="$4"
  shift 4
  output="$tmp_dir/$label.body"
  status="$(curl --silent --show-error --output "$output" --write-out '%{http_code}' \
    --request "$method" \
    -A "$user_agent" \
    -H "Host: $host" \
    -H "X-Honeypot-Test-Secret: $secret" \
    -H "X-Honeypot-Test-Remote-Addr: $source_ip" \
    "$@" \
    "$base_url$path")"
  if [ "$status" != "$expected" ]; then
    printf 'Bot request %s expected HTTP %s but received %s.\n' "$path" "$expected" "$status" >&2
    exit 1
  fi
  if grep -F "$campaign" "$output" >/dev/null 2>&1; then
    printf 'Submitted campaign marker was reflected by %s.\n' "$path" >&2
    exit 1
  fi
  printf 'BOT_RESULT %s %s %s %s\n' "$label" "$method" "$path" "$status"
}

# Three harmless credential-stuffing attempts against the fake login.
attempt=1
while [ "$attempt" -le 3 ]; do
  request "fake-login-$attempt" POST /secure-admin-login 401 \
    -H "Authorization: Bearer SIM-AUTH-$campaign" \
    -H "Cookie: bot_session=SIM-COOKIE-$campaign" \
    --data-urlencode "username=administrator-$attempt" \
    --data-urlencode "password=SIM-PASSWORD-$campaign"
  attempt=$((attempt + 1))
done

# Typical reconnaissance targets. These routes are inert decoys.
request backup-archive GET /wp-content/backups/site-backup.zip 404
request admin-console POST /internal/admin-console 401 \
  --data-urlencode "command=touch /tmp/honeypot-sim-$campaign" \
  --data-urlencode "marker=$campaign"
request phpmyadmin POST /phpmyadmin 401 \
  --data-urlencode "query=SELECT '$campaign'" \
  --data-urlencode "password=SIM-DB-PASSWORD-$campaign"

secret=''
printf 'BOT_CAMPAIGN_COMPLETE id=%s source=%s attempts=6\n' "$campaign" "$source_ip"
