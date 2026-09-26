#!/bin/sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
secret_dir="${E2E_SECRET_DIR:-$root_dir/secrets/e2e}"
timestamp="${E2E_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
artifact_dir="${E2E_ARTIFACT_DIR:-$root_dir/output/e2e/$timestamp}"
export E2E_SECRET_DIR="$secret_dir"
export E2E_RESULT_PATH="$artifact_dir/local-wordpress-e2e.json"
export NODE_EXTRA_CA_CERTS="$secret_dir/tls/fullchain.pem"
export HTTP_PORT="${HTTP_PORT:-9080}"
export HTTPS_PORT="${HTTPS_PORT:-9443}"
platform_url="https://localhost:$HTTPS_PORT"
export BASE_URL="${BASE_URL:-$platform_url}"
export APP_ORIGIN="${APP_ORIGIN:-$BASE_URL}"
export E2E_APP_URL="${E2E_APP_URL:-$BASE_URL}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@smarthoneyai.local}"
export PLATFORM_ORGANIZATION_NAME="${PLATFORM_ORGANIZATION_NAME:-SmartHoneyAI Local Acceptance}"
export PLATFORM_ORGANIZATION_SLUG="${PLATFORM_ORGANIZATION_SLUG:-smarthoneyai-local-acceptance}"
export HF_MODEL_REVISION="${HF_MODEL_REVISION:-0000000000000000000000000000000000000000}"
export SMTP_HOST="${SMTP_HOST:-smtp.local.invalid}"
export SMTP_USER="${SMTP_USER:-local-demo}"
export SMTP_FROM="${SMTP_FROM:-SmartHoneyAI <security@localhost.invalid>}"
wordpress_url="http://localhost:${WORDPRESS_PORT:-8080}"

node "$root_dir/scripts/synthetic-target-guard.mjs" "$BASE_URL" "$wordpress_url"
mkdir -p "$artifact_dir"

compose() {
  docker compose -p honeypot-ai-e2e \
    -f "$root_dir/docker-compose.yml" \
    -f "$root_dir/docker-compose.wordpress-demo.yml" \
    "$@"
}

run_logged() {
  log_file="$1"
  shift
  if "$@" > "$log_file" 2>&1; then
    status=0
  else
    status=$?
  fi
  cat "$log_file"
  return "$status"
}

sh "$root_dir/scripts/local-demo-init.sh"
export ADMIN_PASSWORD="$(cat "$secret_dir/platform_admin_password")"

if [ "${RESET_E2E:-0}" = 1 ]; then
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
fi

run_logged "$artifact_dir/stack-up.log" sh "$root_dir/scripts/local-demo-up.sh"

LOCAL_E2E=1 node "$root_dir/scripts/agent-security-smoke.mjs" \
  > "$artifact_dir/agent-security.json" \
  2> "$artifact_dir/agent-security.log"

run_logged "$artifact_dir/local-wordpress-e2e.log" node "$root_dir/scripts/local-wordpress-e2e.mjs"

node "$root_dir/scripts/connection-state-smoke.mjs" \
  > "$artifact_dir/connection-state.json" \
  2> "$artifact_dir/connection-state.log"

compose ps --format json > "$artifact_dir/compose-ps.json"
docker ps --format '{{json .}}' > "$artifact_dir/docker-ps.jsonl"

printf 'E2E artifacts: %s\n' "$artifact_dir"
printf 'Platform: %s\nWordPress: %s\n' "$BASE_URL" "$wordpress_url"
printf 'Credentials: %s\n' "$secret_dir/credentials.txt"
printf 'Teardown: docker compose -p honeypot-ai-e2e -f %s/docker-compose.yml -f %s/docker-compose.wordpress-demo.yml down --volumes --remove-orphans\n' "$root_dir" "$root_dir"
