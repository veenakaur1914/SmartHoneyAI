#!/bin/sh
set -eu

umask 077
backup_dir="${BACKUP_DIR:-./backups}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
recipient="${AGE_RECIPIENT:?Set AGE_RECIPIENT to the off-host age public key}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
database="${POSTGRES_DB:-honeypot_ai}"
user="${POSTGRES_USER:-honeypot}"
output="$backup_dir/honeypot-ai-$timestamp.dump.age"

command -v age >/dev/null 2>&1 || { echo "age is required" >&2; exit 1; }
mkdir -p "$backup_dir"

docker compose exec -T postgres pg_dump \
  --username "$user" \
  --dbname "$database" \
  --format custom \
  --no-owner \
  --no-privileges \
  | age --recipient "$recipient" --output "$output"

test -s "$output"
sha256sum "$output" > "$output.sha256"
find "$backup_dir" -type f -name 'honeypot-ai-*.dump.age*' -mtime "+$retention_days" -delete

if [ -n "${RCLONE_DESTINATION:-}" ]; then
  command -v rclone >/dev/null 2>&1 || { echo "RCLONE_DESTINATION is set but rclone is unavailable" >&2; exit 1; }
  rclone copy "$output" "$output.sha256" "$RCLONE_DESTINATION"
fi

echo "Encrypted backup created: $output"

