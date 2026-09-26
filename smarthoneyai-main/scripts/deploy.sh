#!/bin/sh
set -eu

compose="docker compose"

node scripts/guard-production-fixtures.mjs

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example and replace every placeholder." >&2
  exit 1
fi

for path in \
  secrets/postgres_password \
  secrets/redis_password \
  secrets/session_secret \
  secrets/agent_signing_secret \
  secrets/policy_signing_private_key \
  secrets/policy_signing_public_key \
  secrets/grafana_admin_password \
  secrets/hf_token \
  secrets/tls/fullchain.pem \
  secrets/tls/privkey.pem
do
  if [ ! -s "$path" ]; then
    echo "Missing required secret: $path" >&2
    exit 1
  fi
done

if [ ! -e secrets/smtp_password ]; then
  echo "Missing optional SMTP secret file: secrets/smtp_password. Run scripts/init-secrets.sh; the file may remain empty when SMTP is disabled." >&2
  exit 1
fi

for variable in PLATFORM_ADMIN_EMAIL PLATFORM_ORGANIZATION_NAME PLATFORM_ORGANIZATION_SLUG
do
  value="$(sed -n "s/^${variable}=//p" .env | tail -n 1)"
  if [ -z "$value" ]; then
    echo "Missing required production setting in .env: $variable" >&2
    exit 1
  fi
done

if grep -Eq 'replace-with|ChangeThis|example\.com' .env; then
  echo "Refusing deployment because .env still contains example values." >&2
  exit 1
fi

app_url="$(sed -n 's/^APP_URL=//p' .env | tail -n 1)"
case "$app_url" in
  https://*) ;;
  *) echo "APP_URL must be the public HTTPS origin." >&2; exit 1 ;;
esac

model_revision="$(sed -n 's/^HF_MODEL_REVISION=//p' .env | tail -n 1)"
if ! printf '%s' "$model_revision" | grep -Eq '^[a-fA-F0-9]{40}$' || printf '%s' "$model_revision" | grep -Eq '^0+$'; then
  echo "HF_MODEL_REVISION must be a non-placeholder 40-character immutable commit." >&2
  exit 1
fi

command -v openssl >/dev/null 2>&1 || { echo "openssl is required to validate the production certificate" >&2; exit 1; }
host="${app_url#https://}"
host="${host%%/*}"
host="${host%%:*}"
openssl x509 -in secrets/tls/fullchain.pem -checkend 604800 -noout >/dev/null || { echo "TLS certificate is expired or expires within seven days." >&2; exit 1; }
openssl x509 -in secrets/tls/fullchain.pem -checkhost "$host" -noout >/dev/null || { echo "TLS certificate does not match $host." >&2; exit 1; }

$compose config --quiet
$compose pull postgres redis nginx prometheus alertmanager grafana
$compose build --pull migrate web api worker
$compose up -d --remove-orphans

base_url="${APP_URL:-$app_url}"
if [ -z "$base_url" ]; then
  base_url="$(sed -n 's/^APP_URL=//p' .env | tail -n 1)"
fi
APP_URL="$base_url" sh scripts/health-check.sh
