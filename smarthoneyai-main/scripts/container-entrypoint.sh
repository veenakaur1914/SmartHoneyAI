#!/bin/sh
set -eu

read_secret() {
  variable="$1"
  path="$2"
  if [ -f "$path" ]; then
    value="$(cat "$path")"
    export "$variable=$value"
  fi
}

read_secret POSTGRES_PASSWORD /run/secrets/postgres_password
read_secret REDIS_PASSWORD /run/secrets/redis_password
read_secret SESSION_SECRET /run/secrets/session_secret
read_secret AGENT_SIGNING_SECRET /run/secrets/agent_signing_secret
read_secret POLICY_SIGNING_PRIVATE_KEY /run/secrets/policy_signing_private_key
read_secret POLICY_SIGNING_PUBLIC_KEY /run/secrets/policy_signing_public_key
read_secret HF_TOKEN /run/secrets/hf_token
read_secret TELEGRAM_BOT_TOKEN /run/secrets/telegram_bot_token
read_secret SMTP_PASSWORD /run/secrets/smtp_password

find_prisma_cli() {
  find /app/node_modules/.pnpm -path '*/node_modules/prisma/build/index.js' -type f | head -n 1
}

run_prisma_deploy() {
  prisma_cli="$(find_prisma_cli)"
  if [ -z "$prisma_cli" ]; then
    echo "Prisma CLI is missing from the migration image" >&2
    exit 1
  fi
  node "$prisma_cli" migrate deploy --schema /app/packages/database/prisma/schema.prisma
}

run_prisma_seed() {
  tsx_cli="$(find /app/node_modules/.pnpm -path '*/node_modules/tsx/dist/cli.mjs' -type f | head -n 1)"
  if [ -z "$tsx_cli" ]; then
    echo "tsx is missing from the migration image" >&2
    exit 1
  fi
  node "$tsx_cli" /app/packages/database/prisma/seed.ts
}

if [ "${INTERNAL_SERVICE_URLS:-0}" = "1" ]; then
  if [ -n "${POSTGRES_PASSWORD:-}" ]; then
    export DATABASE_URL="postgresql://${POSTGRES_USER:-honeypot}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-honeypot_ai}"
  fi
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    export REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"
  fi
fi

if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  run_prisma_deploy
fi

if [ "${APP_COMMAND:-}" = "prisma:deploy" ]; then
  run_prisma_deploy
  exit 0
fi

if [ "${APP_COMMAND:-}" = "prisma:seed" ]; then
  run_prisma_seed
  exit 0
fi

if [ "${DEPLOYED_PACKAGE:-0}" = "1" ]; then
  case "${APP_FILTER:-}" in
    @honeypot/api) exec node dist/server.js ;;
    @honeypot/worker) exec node dist/worker.js ;;
    @honeypot/network-sensor-agent) exec node dist/index.js ;;
    @honeypot/web) exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 ;;
    *) echo "Unsupported deployed package: ${APP_FILTER:-unset}" >&2; exit 1 ;;
  esac
fi

exec pnpm --filter "$APP_FILTER" "$APP_COMMAND"
