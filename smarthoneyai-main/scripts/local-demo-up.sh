#!/bin/sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
secret_dir="${E2E_SECRET_DIR:-$root_dir/secrets/e2e}"
export E2E_SECRET_DIR="$secret_dir"

compose() {
  docker compose -p honeypot-ai-e2e \
    -f "$root_dir/docker-compose.yml" \
    -f "$root_dir/docker-compose.wordpress-demo.yml" \
    "$@"
}

https_port="${HTTPS_PORT:-9443}"
platform_url="https://localhost:$https_port"
export APP_URL="${E2E_APP_URL:-$platform_url}"
export E2E_APP_URL="$APP_URL"
export PLATFORM_ADMIN_EMAIL="${E2E_PLATFORM_ADMIN_EMAIL:-admin@smarthoneyai.local}"
export PLATFORM_ORGANIZATION_NAME="${PLATFORM_ORGANIZATION_NAME:-SmartHoneyAI Local Acceptance}"
export PLATFORM_ORGANIZATION_SLUG="${PLATFORM_ORGANIZATION_SLUG:-smarthoneyai-local-acceptance}"
export HF_MODEL_REVISION="${HF_MODEL_REVISION:-0000000000000000000000000000000000000000}"
export SMTP_HOST="${SMTP_HOST:-smtp.local.invalid}"
export SMTP_USER="${SMTP_USER:-local-acceptance}"
export SMTP_FROM="${SMTP_FROM:-SmartHoneyAI <security@localhost.invalid>}"
wordpress_url="http://localhost:${WORDPRESS_PORT:-8080}"

node "$root_dir/scripts/synthetic-target-guard.mjs" "$APP_URL" "$wordpress_url"
sh "$root_dir/scripts/local-demo-init.sh"

compose config --quiet
if [ "${E2E_NO_BUILD:-0}" = 1 ]; then
  compose up --wait --detach --no-build
else
  compose up --build --wait --detach
fi
compose run --rm \
  -e APP_COMMAND=prisma:seed \
  -e PLATFORM_ADMIN_EMAIL="$PLATFORM_ADMIN_EMAIL" \
  -e PLATFORM_ADMIN_PASSWORD="$(cat "$secret_dir/platform_admin_password")" \
  migrate
compose --profile e2e run --rm wordpress-e2e

printf 'Local demo is ready. Credentials: %s\n' "$secret_dir/credentials.txt"
printf 'Platform: %s\nWordPress: %s\n' "$APP_URL" "$wordpress_url"
