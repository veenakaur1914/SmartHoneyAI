#!/bin/sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
timestamp="${BOT_SIM_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
simulation_id="${BOT_SIMULATION_ID:-bot-$timestamp}"
artifact_dir="${BOT_SIM_ARTIFACT_DIR:-$root_dir/output/simulations/$simulation_id}"
secret_dir="${E2E_SECRET_DIR:-$root_dir/secrets/e2e}"
https_port="${HTTPS_PORT:-443}"

if [ "$https_port" = "443" ]; then
  platform_url="https://localhost"
else
  platform_url="https://localhost:$https_port"
fi

export BOT_SIMULATION_ID="$simulation_id"
export BOT_SIM_RESULT_PATH="$artifact_dir/result.json"
export BOT_SIM_REPORT_PATH="${BOT_SIM_REPORT_PATH:-$root_dir/output/reports/honeypot-bot-simulation-$timestamp.md}"
export E2E_SECRET_DIR="$secret_dir"
export NODE_EXTRA_CA_CERTS="$secret_dir/tls/fullchain.pem"
export BASE_URL="${BASE_URL:-$platform_url}"
export APP_ORIGIN="${APP_ORIGIN:-$BASE_URL}"
export E2E_APP_URL="${E2E_APP_URL:-$BASE_URL}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@smarthoneyai.local}"
export WORDPRESS_URL="${WORDPRESS_URL:-http://localhost:8080}"
export PLATFORM_ORGANIZATION_NAME="${PLATFORM_ORGANIZATION_NAME:-SmartHoneyAI Local Acceptance}"
export PLATFORM_ORGANIZATION_SLUG="${PLATFORM_ORGANIZATION_SLUG:-smarthoneyai-local-acceptance}"
export SMTP_HOST="${SMTP_HOST:-smtp.local.invalid}"
export SMTP_USER="${SMTP_USER:-local-demo}"
export SMTP_FROM="${SMTP_FROM:-SmartHoneyAI <security@localhost.invalid>}"

node "$root_dir/scripts/synthetic-target-guard.mjs" "$BASE_URL" "$WORDPRESS_URL"
mkdir -p "$artifact_dir"

docker compose -p honeypot-ai-e2e \
  -f "$root_dir/docker-compose.yml" \
  -f "$root_dir/docker-compose.wordpress-demo.yml" \
  config --quiet

simulation_log="$artifact_dir/simulation.log"
set +e
node "$root_dir/scripts/bot-attack-simulation.mjs" > "$simulation_log" 2>&1
simulation_status=$?
set -e
cat "$simulation_log"
if [ "$simulation_status" -ne 0 ]; then
  exit "$simulation_status"
fi

docker compose -p honeypot-ai-e2e \
  -f "$root_dir/docker-compose.yml" \
  -f "$root_dir/docker-compose.wordpress-demo.yml" \
  ps --format json > "$artifact_dir/compose-ps.json"

chmod 600 "$artifact_dir/result.json" "$artifact_dir/simulation.log" "$artifact_dir/compose-ps.json" "$BOT_SIM_REPORT_PATH"
printf 'Bot simulation artifacts: %s\n' "$artifact_dir"
printf 'Bot simulation report: %s\n' "$BOT_SIM_REPORT_PATH"
