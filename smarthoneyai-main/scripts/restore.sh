#!/bin/sh
set -eu

backup="${1:-}"
identity="${AGE_IDENTITY_FILE:?Set AGE_IDENTITY_FILE to the age private key path}"
database="${POSTGRES_DB:-honeypot_ai}"
user="${POSTGRES_USER:-honeypot}"

if [ -z "$backup" ] || [ ! -f "$backup" ]; then
  echo "Usage: AGE_IDENTITY_FILE=/secure/key CONFIRM_RESTORE=$database sh scripts/restore.sh backups/file.dump.age" >&2
  exit 1
fi

if [ "${CONFIRM_RESTORE:-}" != "$database" ]; then
  echo "Restore replaces current data. Set CONFIRM_RESTORE=$database to continue." >&2
  exit 1
fi

command -v age >/dev/null 2>&1 || { echo "age is required" >&2; exit 1; }
tmp="$(mktemp "${TMPDIR:-/tmp}/honeypot-restore.XXXXXX")"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
age --decrypt --identity "$identity" --output "$tmp" "$backup"

docker compose stop web api worker
docker compose exec -T postgres psql --username "$user" --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$database' AND pid <> pg_backend_pid();"
docker compose exec -T postgres pg_restore \
  --username "$user" \
  --dbname "$database" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error < "$tmp"
docker compose up -d api worker web nginx

echo "Restore completed. Run APP_URL=https://your-domain sh scripts/health-check.sh and complete the restore checklist."

